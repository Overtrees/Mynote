// 粘贴链接卡的插入与解析：对照 Web 的 insertLinkCardAtDOM + 异步
// fetchLinkMeta 回填。先以 link-card/loading 落骨架，解析完成后按
// meta.type 决定 musicCard / link-card 并置 ready/error。
import 'package:super_editor/super_editor.dart';

import '../../../core/diag.dart';
import '../../../data/convert/doc_nodes.dart';
import '../../../services/link_meta_service.dart';

/// 在光标处插入链接卡：当前段在光标处劈开（前文留原段、后文移到卡后），
/// 有剩余文本时在卡后补一段并把光标放其末尾。返回卡片 id。
String insertPasteLinkCard({
  required MutableDocument document,
  required MutableDocumentComposer composer,
  required String url,
  String? remainder,
}) {
  final selection = composer.selection;
  if (selection == null) throw StateError('paste card requires a selection');
  final node = document.getNodeById(selection.extent.nodeId);
  if (node is! TextNode) throw StateError('paste card requires a text node');

  // 原版 insertAtomicBlockToDOM 在光标处劈开当前段：光标前文本留原段，
  // 光标后文本移到卡片之后（此前整段保留在卡前，顺序与原版相反）。
  // 仅段落可劈（任务块保持整块后插的既有行为）。
  String? tailId;
  if (node is ParagraphNode) {
    final bp = selection.base.nodePosition;
    final ep = selection.extent.nodePosition;
    if (bp is TextNodePosition && ep is TextNodePosition) {
      final from = bp.offset < ep.offset ? bp.offset : ep.offset;
      final to = bp.offset < ep.offset ? ep.offset : bp.offset;
      final full = node.text;
      if (to < full.length || from != to) {
        final head = from > 0 || to > 0
            ? full.copyText(0, from)
            : AttributedText('');
        document.replaceNodeById(
          node.id,
          ParagraphNode(id: node.id, text: head, metadata: node.metadata),
        );
        if (to < full.length) {
          final tail = ParagraphNode(
            id: Editor.createNodeId(),
            text: full.copyText(to, full.length),
          );
          tailId = tail.id;
          // 先占位插到原段后，卡片随后插到原段与尾段之间
          document.insertNodeAfter(existingNodeId: node.id, newNode: tail);
        }
      }
    }
  }

  final card = CardNode(
    id: Editor.createNodeId(),
    kind: 'link-card',
    url: url,
    status: 'loading',
    justCreated: true,
  );
  document.insertNodeAfter(existingNodeId: node.id, newNode: card);
  Diag.log('PASTE', 'card inserted id=${card.id} url=$url');

  void selectAt(String id, int offset) {
    composer.setSelectionWithReason(
      DocumentSelection.collapsed(
        position: DocumentPosition(
          nodeId: id,
          nodePosition: TextNodePosition(offset: offset),
        ),
      ),
    );
  }

  if (remainder != null && remainder.isNotEmpty) {
    final p = ParagraphNode(
      id: Editor.createNodeId(),
      text: AttributedText(remainder),
    );
    document.insertNodeAfter(existingNodeId: card.id, newNode: p);
    selectAt(p.id, remainder.length);
  } else if (tailId != null) {
    selectAt(tailId, 0);
  } else {
    final idx = document.getNodeIndexById(card.id);
    final hasNextText =
        idx + 1 < document.nodeCount && document.getNodeAt(idx + 1) is TextNode;
    if (!hasNextText) {
      final trailing = ParagraphNode(
        id: Editor.createNodeId(),
        text: AttributedText(''),
      );
      document.insertNodeAfter(existingNodeId: card.id, newNode: trailing);
      selectAt(trailing.id, 0);
    } else {
      selectAt((document.getNodeAt(idx + 1) as TextNode).id, 0);
    }
  }
  return card.id;
}

/// 异步解析并回填卡片（节点已删/已变则静默放弃，与 Web 的守卫一致）。
Future<void> resolvePasteCard({
  required MutableDocument document,
  required String cardId,
  required String url,
  LinkMetaFetcher fetchMeta = fetchLinkMeta,
}) async {
  final meta = await fetchMeta(url);
  final node = document.getNodeById(cardId);
  if (node is! CardNode || node.url != url || node.status != 'loading') {
    Diag.log('PASTE', 'resolve skipped (card changed) id=$cardId');
    return;
  }
  final title = meta?['title']?.toString();
  final ready = title != null && title.isNotEmpty;
  // L16：kind 只按返回的显式 type 重定；请求失败/无 type 时保留
  // 原卡种与已有 meta——失败只改状态，不再把音乐卡变链接卡、
  // 也不清空已解析的标题/封面（重试失败不毁数据）
  final typeRaw = meta?['type']?.toString();
  final kind = typeRaw == 'music'
      ? 'musicCard'
      : (typeRaw != null && typeRaw.isNotEmpty ? 'link-card' : node.kind);
  document.replaceNodeById(
    cardId,
    CardNode(
      id: cardId,
      kind: kind,
      url: url,
      status: ready ? 'ready' : 'error',
      meta: ready ? meta : node.meta,
      metadata: node.metadata,
    ),
  );
  Diag.log(
    'PASTE',
    'card resolved id=$cardId kind=$kind status=${ready ? 'ready' : 'error'}',
  );
}
