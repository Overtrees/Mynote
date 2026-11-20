// 编辑命令执行引擎：斜杠菜单与移动工具栏共用。
// - applySlashCommand：删 token 后执行（斜杠路径，含 token 校验与 SLASH 诊断）
// - executeEditorCommand：在给定节点/基准文本上直接执行（工具栏路径）
// 操作 MutableDocument/MutableDocumentComposer，可无头单测。
import 'package:super_editor/super_editor.dart';

import '../../../core/diag.dart';
import '../../../data/convert/inline_marks.dart';
import '../../../data/convert/doc_nodes.dart';
import 'slash_commands.dart';
import 'slash_trigger.dart';

Attribution _headerAttribution(int level) {
  switch (level) {
    case 1:
      return header1Attribution;
    case 3:
      return header3Attribution;
    case 4:
      return header4Attribution;
    case 5:
      return header5Attribution;
    case 6:
      return header6Attribution;
    case 2:
    default:
      return header2Attribution;
  }
}

/// 行内包裹纯函数：在 [start, end) 外包上 open/close。
/// 折叠（start==end）时插入成对标记、光标落中间；有选区时包裹选区，
/// 返回的新选区覆盖被包裹的原文。
(String, int, int) wrapTextRange(
  String text,
  int start,
  int end,
  String open,
  String close,
) {
  if (start == end) {
    return (
      text.replaceRange(start, start, '$open$close'),
      start + open.length,
      start + open.length,
    );
  }
  final inner = text.substring(start, end);
  return (
    text.replaceRange(start, end, '$open$inner$close'),
    start + open.length,
    end + open.length,
  );
}

/// 从 AttributedText 中删除 [start, endExclusive) 区间，保留其余区间
/// 的 attributions（copyText/copyAndAppend 语义）。
AttributedText removeTextRange(
  AttributedText text,
  int start,
  int endExclusive,
) {
  final len = text.length;
  if (start <= 0 && endExclusive >= len) return AttributedText('');
  final head = start > 0 ? text.copyText(0, start) : AttributedText('');
  final tail = endExclusive < len
      ? text.copyText(endExclusive, len)
      : AttributedText('');
  return head.copyAndAppend(tail);
}

/// 在 AttributedText 的 offset 处插入纯文本，保留原 attributions。
AttributedText insertPlainTextAt(
  AttributedText text,
  int offset,
  String inserted,
) {
  final len = text.length;
  final head = offset > 0 ? text.copyText(0, offset) : AttributedText('');
  final tail = offset < len ? text.copyText(offset, len) : AttributedText('');
  return head.copyAndAppend(AttributedText(inserted)).copyAndAppend(tail);
}

/// 用新的 AttributedText 重建文本节点（保留类型与 metadata）。
TextNode rebuildTextNode(
  TextNode node,
  AttributedText text, {
  Map<String, dynamic>? metadata,
}) {
  final meta = metadata ?? node.metadata;
  if (node is TaskNode) {
    return TaskNode(
      id: node.id,
      text: text,
      isComplete: node.isComplete,
      metadata: meta,
    );
  }
  return ParagraphNode(id: node.id, text: text, metadata: meta);
}

/// 斜杠路径：校验 token → 删 token → 执行命令。全程 SLASH 诊断打点。
/// 传入 [editor] 时全部变更走 Editor 事务（ReplaceNode/InsertNodeAfter/
/// ChangeSelection 请求），撤销可回放；缺省直接改文档（无头测试路径）。
void applySlashCommand({
  required MutableDocument document,
  required MutableDocumentComposer composer,
  required SlashCommand command,
  required SlashToken token,
  String? linkUrl,
  Editor? editor,
}) {
  try {
    final selection = composer.selection;
    if (selection == null || !selection.isCollapsed) {
      throw StateError('slash apply requires a collapsed selection');
    }
    final node = document.getNodeById(selection.extent.nodeId);
    if (node is! TextNode) {
      throw StateError(
        'slash apply requires a text node, got ${node.runtimeType}',
      );
    }
    final fullText = node.text.toPlainText();
    if (token.end > fullText.length ||
        token.start < 0 ||
        fullText.substring(token.start, token.end) != '/${token.query}') {
      throw StateError('slash token mismatch');
    }
    final remaining = removeTextRange(node.text, token.start, token.end);
    executeEditorCommand(
      document: document,
      composer: composer,
      command: command,
      nodeId: node.id,
      baseAttributed: remaining,
      caretOffset: token.start,
      linkUrl: linkUrl,
      editor: editor,
    );
    Diag.log('SLASH', 'apply ${command.id} ok');
  } catch (e) {
    Diag.error('SLASH', 'apply ${command.id}: $e');
    rethrow;
  }
}

/// 在 nodeId 节点上执行命令。baseAttributed 是命令作用的基准文本
/// （斜杠路径为删 token 后的文本，选区路径为节点全文），attributions
/// 全程保留；caretOffset 为基准文本内的光标位置；selStart/selEnd
/// 给出时行内命令对该范围施加 attribution（链接仍走标记插入）。
void executeEditorCommand({
  required MutableDocument document,
  required MutableDocumentComposer composer,
  required SlashCommand command,
  required String nodeId,
  required AttributedText baseAttributed,
  required int caretOffset,
  int? selStart,
  int? selEnd,
  String? linkUrl,
  Editor? editor,
}) {
  final baseText = baseAttributed.toPlainText();
  final node = document.getNodeById(nodeId);
  if (node is! TextNode) {
    throw StateError('command requires a text node, got ${node.runtimeType}');
  }

  // 事务模式：变更先收集为 EditRequest，末尾一次性 editor.execute，
  // 中途对文档的读取都基于原始状态（替换保 id 保位，结果等价）。
  final requests = <EditRequest>[];
  DocumentSelection? pendingSelection;

  void selectCollapsed(String id, int offset) {
    final sel = DocumentSelection.collapsed(
      position: DocumentPosition(
        nodeId: id,
        nodePosition: TextNodePosition(offset: offset),
      ),
    );
    if (editor == null) {
      composer.setSelectionWithReason(sel);
    } else {
      pendingSelection = sel;
    }
  }

  void selectRange(String id, int start, int end) {
    final sel = DocumentSelection(
      base: DocumentPosition(
        nodeId: id,
        nodePosition: TextNodePosition(offset: start),
      ),
      extent: DocumentPosition(
        nodeId: id,
        nodePosition: TextNodePosition(offset: end),
      ),
    );
    if (editor == null) {
      composer.setSelectionWithReason(sel);
    } else {
      pendingSelection = sel;
    }
  }

  void replaceNode(DocumentNode newNode) {
    if (editor == null) {
      document.replaceNodeById(node.id, newNode);
    } else {
      requests.add(
        ReplaceNodeRequest(existingNodeId: node.id, newNode: newNode),
      );
    }
  }

  void insertAfter(String existingNodeId, DocumentNode newNode) {
    if (editor == null) {
      document.insertNodeAfter(
        existingNodeId: existingNodeId,
        newNode: newNode,
      );
    } else {
      requests.add(
        InsertNodeAfterNodeRequest(
          existingNodeId: existingNodeId,
          newNode: newNode,
        ),
      );
    }
  }

  TextNode replaceText(String newText) {
    final newNode = rebuildTextNode(node, AttributedText(newText));
    replaceNode(newNode);
    return newNode;
  }

  TextNode replaceAttributed(AttributedText newText) {
    final newNode = rebuildTextNode(node, newText);
    replaceNode(newNode);
    return newNode;
  }

  /// 原子块原地替换（原版语义）：沿用当前块 id、正文被块取代，
  /// 其后按尾段落规则补空段落（下一块已是空段落则不补），光标落尾段落。
  void replaceWithBlock(DocumentNode block) {
    replaceNode(block);
    final idx = document.getNodeIndexById(node.id);
    final next = idx + 1 < document.nodeCount
        ? document.getNodeAt(idx + 1)
        : null;
    final nextIsEmptyPara =
        next is ParagraphNode && next.text.toPlainText().isEmpty;
    if (nextIsEmptyPara) {
      selectCollapsed(next.id, 0);
    } else {
      final trailing = ParagraphNode(
        id: Editor.createNodeId(),
        text: AttributedText(''),
      );
      insertAfter(block.id, trailing);
      selectCollapsed(trailing.id, 0);
    }
  }

  /// 行内样式命令：对选区施加 attribution（编辑器内直接渲染，
  /// 保存时由 serializeInlineMarks 写回标记）；无选区时按原版插入
  /// 占位文字「文字」并包裹（存储形态与 Web 一致）。
  void wrapInline(String open, String close) {
    final s = selStart ?? caretOffset;
    final e = selEnd ?? caretOffset;
    final attribution = switch (open) {
      '**' => boldAttribution,
      '*' => italicsAttribution,
      '==' => highlightAttribution,
      '~~' => strikethroughAttribution,
      '`' => codeAttribution,
      _ => null,
    };
    if (attribution != null && e > s) {
      final styled = baseAttributed.copy();
      styled.addAttribution(attribution, SpanRange(s, e - 1));
      replaceAttributed(styled);
      selectRange(node.id, s, e);
      return;
    }
    if (attribution != null && e == s) {
      final styled = insertPlainTextAt(baseAttributed, s, '文字');
      styled.addAttribution(attribution, SpanRange(s, s + 1));
      replaceAttributed(styled);
      selectRange(node.id, s, s + 2);
      return;
    }
    final (newText, ns, ne) = wrapTextRange(baseText, s, e, open, close);
    replaceText(newText);
    if (ns == ne) {
      selectCollapsed(node.id, ns);
    } else {
      selectRange(node.id, ns, ne);
    }
  }

  /// 链接命令：标记形式 [text](url)；url 来自链接表单（已校验并
  /// 编码括号），无选区时标签用占位「链接文字」（原版语义）。
  void wrapLink() {
    final s = selStart ?? caretOffset;
    final e = selEnd ?? caretOffset;
    final url = linkUrl ?? 'url';
    final label = e > s ? baseText.substring(s, e) : '链接文字';
    final newText = baseText.replaceRange(s, e, '[$label]($url)');
    replaceText(newText);
    selectRange(node.id, s + 1, s + 1 + label.length);
  }

  switch (command.type) {
    case 'heading':
      replaceNode(
        ParagraphNode(
          id: node.id,
          text: baseAttributed,
          metadata: {
            ...node.metadata,
            'blockType': _headerAttribution(command.level ?? 2),
          },
        ),
      );
      selectCollapsed(node.id, caretOffset.clamp(0, baseText.length));
    case 'paragraph':
      replaceNode(
        ParagraphNode(
          id: node.id,
          text: baseAttributed,
          metadata: {...node.metadata, 'blockType': paragraphAttribution},
        ),
      );
      selectCollapsed(node.id, caretOffset.clamp(0, baseText.length));
    case 'quote':
      replaceNode(
        ParagraphNode(
          id: node.id,
          text: baseAttributed,
          metadata: {...node.metadata, 'blockType': blockquoteAttribution},
        ),
      );
      selectCollapsed(node.id, caretOffset.clamp(0, baseText.length));
    case 'todo':
      replaceNode(
        TaskNode(
          id: node.id,
          text: baseAttributed,
          isComplete: false,
          metadata: node.metadata,
        ),
      );
      selectCollapsed(node.id, caretOffset.clamp(0, baseText.length));
    case 'divider':
      // 正文丢弃、尾段落为空（原版语义）
      replaceWithBlock(HorizontalRuleNode(id: node.id));
    case 'code_block':
      replaceAttributed(
        AttributedText('```\n')
            .copyAndAppend(baseAttributed)
            .copyAndAppend(AttributedText('\n```')),
      );
      selectCollapsed(node.id, 4 + caretOffset);
    case 'unordered_list':
      // 逐行加前缀；空正文用占位「列表项」（原版语义）
      if (!baseText.contains('\n') && baseText.isNotEmpty) {
        replaceAttributed(AttributedText('- ').copyAndAppend(baseAttributed));
        selectCollapsed(node.id, caretOffset + 2);
      } else {
        final lines = baseText.isEmpty ? ['列表项'] : baseText.split('\n');
        replaceText(lines.map((l) => '- $l').join('\n'));
        selectCollapsed(node.id, baseText.isEmpty ? 2 : caretOffset + 2);
      }
    case 'ordered_list':
      if (!baseText.contains('\n') && baseText.isNotEmpty) {
        replaceAttributed(AttributedText('1. ').copyAndAppend(baseAttributed));
        selectCollapsed(node.id, caretOffset + 3);
      } else {
        final lines = baseText.isEmpty ? ['列表项'] : baseText.split('\n');
        replaceText(
          lines
              .asMap()
              .entries
              .map((en) => '${en.key + 1}. ${en.value}')
              .join('\n'),
        );
        selectCollapsed(node.id, baseText.isEmpty ? 3 : caretOffset + 3);
      }
    case 'callout':
      // 源码形态：> [!NOTE] 换行 + 逐行 > 前缀；空正文用「提示内容」；
      // 其后按尾段落规则补空段落（下一块已是空段落则不补）
      final lines = baseText.isEmpty ? ['提示内容'] : baseText.split('\n');
      final calloutText = '> [!NOTE]\n${lines.map((l) => '> $l').join('\n')}';
      replaceText(calloutText);
      selectCollapsed(node.id, calloutText.length);
      final idx = document.getNodeIndexById(node.id);
      final next = idx + 1 < document.nodeCount
          ? document.getNodeAt(idx + 1)
          : null;
      if (!(next is ParagraphNode && next.text.toPlainText().isEmpty)) {
        insertAfter(
          node.id,
          ParagraphNode(id: Editor.createNodeId(), text: AttributedText('')),
        );
      }
    case 'inline_bold':
      wrapInline('**', '**');
    case 'inline_italic':
      wrapInline('*', '*');
    case 'inline_highlight':
      wrapInline('==', '==');
    case 'inline_strike':
      wrapInline('~~', '~~');
    case 'inline_code':
      wrapInline('`', '`');
    case 'inline_link':
      wrapLink();
    case 'musicCard':
      replaceWithBlock(
        CardNode(id: node.id, kind: 'musicCard', status: 'input'),
      );
    case 'image':
      replaceWithBlock(MediaNode(id: node.id, kind: 'image'));
    case 'gallery':
      replaceWithBlock(
        MediaNode(id: node.id, kind: 'gallery', attrs: {'items': <dynamic>[]}),
      );
    case 'imgTextCard':
      // 初始正文与原版一致（真实存入 children）
      replaceWithBlock(
        MediaNode(id: node.id, kind: 'imgTextCard', text: '点击输入文字'),
      );
    case 'imageTextRow':
      replaceWithBlock(
        MediaNode(id: node.id, kind: 'imageTextRow', text: '点击输入说明文字'),
      );
    default:
      throw StateError('unknown slash command type: ${command.type}');
  }

  // 事务模式收尾：一次性执行全部请求（撤销可回放整条命令）
  if (editor != null) {
    editor.execute([
      ...requests,
      if (pendingSelection != null)
        ChangeSelectionRequest(
          pendingSelection,
          SelectionChangeType.placeCaret,
          'slash command',
        ),
    ]);
  }
}

/// 选区快照包裹（原版 slashSelectionSnapshot 语义）：用户先选中文本再打
/// '/' 时，选区文本被 '/' 顶替；选行内命令后，把快照文本包好插回原位，
/// 新选区覆盖被包裹的原文。markers 与 Web 快捷串一致。
void applySlashInlineWrap({
  required MutableDocument document,
  required MutableDocumentComposer composer,
  required SlashCommand command,
  required SlashToken token,
  required String snapshotText,
  String? linkUrl,
  Editor? editor,
}) {
  try {
    final selection = composer.selection;
    if (selection == null || !selection.isCollapsed) {
      throw StateError('slash inline wrap requires a collapsed selection');
    }
    final node = document.getNodeById(selection.extent.nodeId);
    if (node is! TextNode) {
      throw StateError('slash inline wrap requires a text node');
    }
    final attribution = switch (command.type) {
      'inline_bold' => boldAttribution,
      'inline_italic' => italicsAttribution,
      'inline_highlight' => highlightAttribution,
      'inline_strike' => strikethroughAttribution,
      'inline_code' => codeAttribution,
      'inline_link' => null,
      _ => throw StateError('not an inline command: ${command.type}'),
    };
    // 当前文本 = 快照被 '/' 顶替后的文本；删 token 后在原位插回快照。
    final remaining = removeTextRange(node.text, token.start, token.end);
    final insertAt = token.start;
    final TextNode newNode;
    final int selStart;
    if (attribution != null) {
      final styled = insertPlainTextAt(remaining, insertAt, snapshotText);
      if (snapshotText.isNotEmpty) {
        styled.addAttribution(
          attribution,
          SpanRange(insertAt, insertAt + snapshotText.length - 1),
        );
      }
      newNode = rebuildTextNode(node, styled);
      selStart = insertAt;
    } else {
      // 链接：按 Web 标记形式 [快照](url) 插回（url 来自链接表单）。
      final withSnapshot = insertPlainTextAt(
        remaining,
        insertAt,
        '[$snapshotText](${linkUrl ?? 'url'})',
      );
      newNode = rebuildTextNode(node, withSnapshot);
      selStart = insertAt + 1;
    }
    final selEnd = selStart + snapshotText.length;
    final newSelection = DocumentSelection(
      base: DocumentPosition(
        nodeId: node.id,
        nodePosition: TextNodePosition(offset: selStart),
      ),
      extent: DocumentPosition(
        nodeId: node.id,
        nodePosition: TextNodePosition(offset: selEnd),
      ),
    );
    if (editor == null) {
      document.replaceNodeById(node.id, newNode);
      composer.setSelectionWithReason(newSelection);
    } else {
      editor.execute([
        ReplaceNodeRequest(existingNodeId: node.id, newNode: newNode),
        ChangeSelectionRequest(
          newSelection,
          SelectionChangeType.placeCaret,
          'slash command',
        ),
      ]);
    }
    Diag.log('SLASH', 'inline-wrap ${command.id} ok');
  } catch (e) {
    Diag.error('SLASH', 'inline-wrap ${command.id}: $e');
    rethrow;
  }
}
