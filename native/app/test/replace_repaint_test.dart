import 'package:attributed_text/attributed_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/convert/inline_marks.dart';
import 'package:mynote_app/features/editor/block_components.dart';
import 'package:super_editor/super_editor.dart';

void main() {
  testWidgets('replaceNodeById 换文本后组件应重绘新文本', (tester) async {
    final task = TaskNode(
      id: 't1',
      text: AttributedText('任务 前**加粗**后'),
      isComplete: false,
    );
    final doc = MutableDocument(nodes: [task]);
    final composer = MutableDocumentComposer();
    final editor = Editor(
      editables: {Editor.documentKey: doc, Editor.composerKey: composer},
      requestHandlers: List.from(defaultRequestHandlers),
      reactionPipeline: List.from(defaultEditorReactions),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SuperEditor(
            editor: editor,
            focusNode: FocusNode(),
            componentBuilders: [
              MynoteTaskComponentBuilder(editor),
              ...defaultComponentBuilders,
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    String widgetText() => tester
        .widgetList<TextComponent>(find.byType(TextComponent))
        .map((w) => w.text.toPlainText())
        .join('|');
    // ignore: avoid_print
    print('BEFORE: widgetText=${widgetText()}');
    expect(widgetText(), contains('**加粗**'));
    final parsed = parseInlineMarks('任务 前**加粗**后');
    editor.execute([
      ReplaceNodeRequest(
        existingNodeId: 't1',
        newNode: task.copyTextNodeWith(text: parsed),
      ),
    ]);
    await tester.pumpAndSettle();
    // ignore: avoid_print
    print('AFTER REPLACE: widgetText=${widgetText()}');
    expect(widgetText(), isNot(contains('**')));
    expect(widgetText(), contains('前加粗后'));
  });
}
