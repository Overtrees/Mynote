import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/core/diag.dart';
import 'package:mynote_app/data/convert/doc_nodes.dart';
import 'package:mynote_app/data/convert/inline_marks.dart';
import 'package:mynote_app/features/editor/slash/slash_apply.dart';
import 'package:mynote_app/features/editor/slash/slash_commands.dart';
import 'package:mynote_app/features/editor/slash/slash_trigger.dart';
import 'package:super_editor/super_editor.dart';

SlashCommand cmd(String id) => slashCommands.firstWhere((c) => c.id == id);

(MutableDocument, MutableDocumentComposer) setup(String text, int caret) {
  final node = ParagraphNode(id: 'n1', text: AttributedText(text));
  final doc = MutableDocument(nodes: [node]);
  final composer = MutableDocumentComposer(
    initialSelection: DocumentSelection.collapsed(
      position: DocumentPosition(
        nodeId: 'n1',
        nodePosition: TextNodePosition(offset: caret),
      ),
    ),
  );
  return (doc, composer);
}

void apply(
  MutableDocument doc,
  MutableDocumentComposer composer,
  String text,
  String id,
) {
  final caret =
      (composer.selection!.extent.nodePosition as TextNodePosition).offset;
  final token = detectSlashToken(text, caret)!;
  applySlashCommand(
    document: doc,
    composer: composer,
    command: cmd(id),
    token: token,
  );
}

void main() {
  group('applySlashCommand', () {
    test('heading：段落变一级标题，token 删除', () {
      final (doc, composer) = setup('/bt', 3);
      apply(doc, composer, '/bt', 'heading');
      final node = doc.getNodeAt(0) as ParagraphNode;
      expect(node.metadata['blockType'], header1Attribution);
      expect(node.text.toPlainText(), '');
    });

    test('todo：段落变任务节点，保留斜杠前文本', () {
      final (doc, composer) = setup('买菜/db', 5);
      apply(doc, composer, '买菜/db', 'todo');
      final node = doc.getNodeAt(0) as TaskNode;
      expect(node.text.toPlainText(), '买菜');
      expect(node.isComplete, isFalse);
    });

    test('musicCard：原地替换当前块（沿用 id），补尾随空段，光标落尾随段', () {
      final (doc, composer) = setup('/yy', 3);
      apply(doc, composer, '/yy', 'musicCard');
      expect(doc.nodeCount, 2);
      final card = doc.getNodeAt(0) as CardNode;
      expect(card.id, 'n1');
      expect(card.kind, 'musicCard');
      expect(card.status, 'input');
      expect(doc.getNodeAt(1), isA<ParagraphNode>());
      expect(composer.selection!.extent.nodeId, doc.getNodeAt(1)!.id);
    });

    test('divider：变分割线并补段落', () {
      final (doc, composer) = setup('/fgx', 4);
      apply(doc, composer, '/fgx', 'divider');
      expect(doc.getNodeAt(0), isA<HorizontalRuleNode>());
      expect(doc.getNodeAt(1), isA<ParagraphNode>());
    });

    test('bold：无选区插入占位「文字」并加粗（原版语义）', () {
      final (doc, composer) = setup('/jc', 3);
      apply(doc, composer, '/jc', 'bold');
      final node = doc.getNodeAt(0) as ParagraphNode;
      expect(node.text.toPlainText(), '文字');
      expect(node.text.getAllAttributionsAt(0), contains(boldAttribution));
      expect(serializeInlineMarks(node.text), '**文字**');
      final sel = composer.selection!;
      expect((sel.base.nodePosition as TextNodePosition).offset, 0);
      expect((sel.extent.nodePosition as TextNodePosition).offset, 2);
    });

    test('unordered_list：句中触发，前缀加到整段，光标位置平移', () {
      final (doc, composer) = setup('abc/lb', 6);
      apply(doc, composer, 'abc/lb', 'unorderedList');
      final node = doc.getNodeAt(0) as ParagraphNode;
      expect(node.text.toPlainText(), '- abc');
      final pos = composer.selection!.extent.nodePosition as TextNodePosition;
      expect(pos.offset, 5);
    });

    test('token 不匹配抛错且写诊断日志（诊断同步覆盖）', () {
      final (doc, composer) = setup('/bt', 3);
      Diag.clear();
      expect(
        () => applySlashCommand(
          document: doc,
          composer: composer,
          command: cmd('heading'),
          token: const SlashToken(start: 0, end: 3, query: 'zz'),
        ),
        throwsStateError,
      );
      expect(
        Diag.events.any((e) => e.contains('[SLASH]') && e.contains('ERROR')),
        isTrue,
      );
    });
  });

  group('wrapTextRange 与工具栏路径', () {
    test('折叠光标插入成对标记', () {
      final (text, s, e) = wrapTextRange('ab', 1, 1, '**', '**');
      expect(text, 'a****b');
      expect(s, 3);
      expect(e, 3);
    });

    test('选区包裹且新选区覆盖原文', () {
      final (text, s, e) = wrapTextRange('hello world', 6, 11, '==', '==');
      expect(text, 'hello ==world==');
      expect(s, 8);
      expect(e, 13);
    });

    test('工具栏：选区高亮包裹（executeEditorCommand 带 sel 范围）', () {
      final node = ParagraphNode(id: 'n1', text: AttributedText('hello world'));
      final doc = MutableDocument(nodes: [node]);
      final composer = MutableDocumentComposer(
        initialSelection: DocumentSelection(
          base: DocumentPosition(
            nodeId: 'n1',
            nodePosition: const TextNodePosition(offset: 6),
          ),
          extent: DocumentPosition(
            nodeId: 'n1',
            nodePosition: const TextNodePosition(offset: 11),
          ),
        ),
      );
      executeEditorCommand(
        document: doc,
        composer: composer,
        command: cmd('highlight'),
        nodeId: 'n1',
        baseAttributed: AttributedText('hello world'),
        caretOffset: 11,
        selStart: 6,
        selEnd: 11,
      );
      final resultText = (doc.getNodeAt(0) as ParagraphNode).text;
      // 编辑器内为 attribution 渲染（无标记字符），序列化回存储格式才是标记
      expect(resultText.toPlainText(), 'hello world');
      expect(
        resultText.getAllAttributionsAt(7),
        contains(highlightAttribution),
      );
      expect(serializeInlineMarks(resultText), 'hello ==world==');
      final sel = composer.selection!;
      expect((sel.base.nodePosition as TextNodePosition).offset, 6);
      expect((sel.extent.nodePosition as TextNodePosition).offset, 11);
    });
  });

  group('applySlashInlineWrap（选区快照）', () {
    test('选中 world 打 / 后选加粗：快照文本包好插回原位', () {
      // 选区被 '/' 顶替后的状态：文本 'hello /'，光标在 7
      final node = ParagraphNode(id: 'n1', text: AttributedText('hello /'));
      final doc = MutableDocument(nodes: [node]);
      final composer = MutableDocumentComposer(
        initialSelection: DocumentSelection.collapsed(
          position: DocumentPosition(
            nodeId: 'n1',
            nodePosition: const TextNodePosition(offset: 7),
          ),
        ),
      );
      applySlashInlineWrap(
        document: doc,
        composer: composer,
        command: cmd('bold'),
        token: const SlashToken(start: 6, end: 7, query: ''),
        snapshotText: 'world',
      );
      final resultText = (doc.getNodeAt(0) as ParagraphNode).text;
      expect(resultText.toPlainText(), 'hello world');
      expect(resultText.getAllAttributionsAt(7), contains(boldAttribution));
      expect(serializeInlineMarks(resultText), 'hello **world**');
      final sel = composer.selection!;
      expect((sel.base.nodePosition as TextNodePosition).offset, 6);
      expect((sel.extent.nodePosition as TextNodePosition).offset, 11);
    });
  });
}
