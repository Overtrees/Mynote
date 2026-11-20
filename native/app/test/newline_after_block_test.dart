import 'package:attributed_text/attributed_text.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/editor/newline_after_block.dart';
import 'package:super_editor/super_editor.dart';

Editor buildEditor(MutableDocument doc, MutableDocumentComposer composer) {
  return Editor(
    editables: {Editor.documentKey: doc, Editor.composerKey: composer},
    requestHandlers: [
      paragraphAfterBlockNewlineHandler,
      ...defaultRequestHandlers,
    ],
    reactionPipeline: List.from(defaultEditorReactions),
  );
}

void main() {
  test('标题块 Enter：不劈原文，块后插空段且光标移入', () {
    final heading = ParagraphNode(
      id: 'h1',
      text: AttributedText('标题文字'),
      metadata: const {'blockType': header1Attribution},
    );
    final doc = MutableDocument(nodes: [heading]);
    final composer = MutableDocumentComposer(
      initialSelection: const DocumentSelection.collapsed(
        position: DocumentPosition(
          nodeId: 'h1',
          nodePosition: TextNodePosition(offset: 2),
        ),
      ),
    );
    final editor = buildEditor(doc, composer);
    editor.execute([InsertNewlineAtCaretRequest('p-new')]);
    expect(doc.length, 2);
    expect((doc.getNodeById('h1') as ParagraphNode).text.toPlainText(), '标题文字');
    final inserted = doc.getNodeById('p-new');
    expect(inserted, isA<ParagraphNode>());
    expect((inserted as ParagraphNode).text.toPlainText(), '');
    // ParagraphNode 默认带 paragraph 归因（转换器据此输出 type=paragraph）
    expect(
      (inserted.getMetadataValue('blockType') as NamedAttribution).id,
      'paragraph',
    );
    expect(composer.selection!.extent.nodeId, 'p-new');
  });

  test('待办块 Enter：任务保持完整，块后插空段（非新待办）', () {
    final task = TaskNode(
      id: 't1',
      text: AttributedText('买牛奶'),
      isComplete: false,
    );
    final doc = MutableDocument(nodes: [task]);
    final composer = MutableDocumentComposer(
      initialSelection: const DocumentSelection.collapsed(
        position: DocumentPosition(
          nodeId: 't1',
          nodePosition: TextNodePosition(offset: 1),
        ),
      ),
    );
    final editor = buildEditor(doc, composer);
    editor.execute([InsertNewlineAtCaretRequest('p-new')]);
    expect(doc.length, 2);
    expect((doc.getNodeById('t1') as TaskNode).text.toPlainText(), '买牛奶');
    expect(doc.getNodeById('p-new'), isA<ParagraphNode>());
  });

  test('普通段落 Enter：仍走默认劈分', () {
    final para = ParagraphNode(id: 'p1', text: AttributedText('你好世界'));
    final doc = MutableDocument(nodes: [para]);
    final composer = MutableDocumentComposer(
      initialSelection: const DocumentSelection.collapsed(
        position: DocumentPosition(
          nodeId: 'p1',
          nodePosition: TextNodePosition(offset: 2),
        ),
      ),
    );
    final editor = buildEditor(doc, composer);
    editor.execute([InsertNewlineAtCaretRequest('p2')]);
    expect(doc.length, 2);
    expect((doc.getNodeById('p1') as ParagraphNode).text.toPlainText(), '你好');
    expect((doc.getNodeById('p2') as ParagraphNode).text.toPlainText(), '世界');
  });
}
