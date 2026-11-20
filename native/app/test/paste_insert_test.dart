import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/convert/doc_nodes.dart';
import 'package:mynote_app/features/editor/paste/paste_insert.dart';
import 'package:super_editor/super_editor.dart';

void main() {
  (MutableDocument, MutableDocumentComposer, String) setup() {
    final p = ParagraphNode(id: 'p1', text: AttributedText('正文'));
    final doc = MutableDocument(nodes: [p]);
    final composer = MutableDocumentComposer();
    composer.setSelectionWithReason(
      DocumentSelection.collapsed(
        position: DocumentPosition(
          nodeId: 'p1',
          nodePosition: const TextNodePosition(offset: 2),
        ),
      ),
    );
    return (doc, composer, 'p1');
  }

  test('纯 URL 粘贴：骨架卡（loading）插入当前段后，光标落卡后', () {
    final (doc, composer, _) = setup();
    final cardId = insertPasteLinkCard(
      document: doc,
      composer: composer,
      url: 'https://example.com',
    );
    expect(doc.nodeCount, 3); // 段落 + 卡 + 尾段
    final card = doc.getNodeById(cardId) as CardNode;
    expect(card.status, 'loading');
    expect(card.url, 'https://example.com');
    expect(composer.selection!.extent.nodeId, isNot(cardId));
  });

  test('带剩余文本：卡后补段，光标在剩余文本末尾', () {
    final (doc, composer, _) = setup();
    final cardId = insertPasteLinkCard(
      document: doc,
      composer: composer,
      url: 'https://example.com/a',
      remainder: '看这个很有意思',
    );
    final cardIdx = doc.getNodeIndexById(cardId);
    final remain = doc.getNodeAt(cardIdx + 1) as ParagraphNode;
    expect(remain.text.text, '看这个很有意思');
    expect(composer.selection!.extent.nodeId, remain.id);
    expect(
      (composer.selection!.extent.nodePosition as TextNodePosition).offset,
      7,
    );
  });

  test('解析回填：music meta → musicCard ready', () async {
    final (doc, composer, _) = setup();
    final cardId = insertPasteLinkCard(
      document: doc,
      composer: composer,
      url: 'https://open.spotify.com/t/1',
    );
    await resolvePasteCard(
      document: doc,
      cardId: cardId,
      url: 'https://open.spotify.com/t/1',
      fetchMeta: (_) async => {
        'title': 'Song',
        'type': 'music',
        'source': 'Spotify',
      },
    );
    final card = doc.getNodeById(cardId) as CardNode;
    expect(card.kind, 'musicCard');
    expect(card.status, 'ready');
    expect(card.meta?['title'], 'Song');
  });

  test('解析失败 → link-card error', () async {
    final (doc, composer, _) = setup();
    final cardId = insertPasteLinkCard(
      document: doc,
      composer: composer,
      url: 'https://bad.example',
    );
    await resolvePasteCard(
      document: doc,
      cardId: cardId,
      url: 'https://bad.example',
      fetchMeta: (_) async => null,
    );
    final card = doc.getNodeById(cardId) as CardNode;
    expect(card.kind, 'link-card');
    expect(card.status, 'error');
  });
}
