import 'package:attributed_text/attributed_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/editor/block_components.dart';
import 'package:super_editor/super_editor.dart';

void main() {
  // 回归：待办组件曾因按压底色（自命中绘制盒）导致点文本选不中光标。
  for (final y in [20.0, 35.0]) {
    testWidgets('待办文本点按 y=$y 应放置光标', (tester) async {
      final doc = MutableDocument(
        nodes: [
          TaskNode(
            id: 't1',
            text: AttributedText('厨房插座至少留六个台面要带开关'),
            isComplete: false,
          ),
          ParagraphNode(id: 'p1', text: AttributedText('普通段落文字')),
        ],
      );
      final composer = MutableDocumentComposer();
      final editor = Editor(
        editables: {Editor.documentKey: doc, Editor.composerKey: composer},
        requestHandlers: List.from(defaultRequestHandlers),
        reactionPipeline: List.from(defaultEditorReactions),
      );
      final focusNode = FocusNode();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SuperEditor(
              editor: editor,
              focusNode: focusNode,
              componentBuilders: [
                MynoteTaskComponentBuilder(editor),
                ...defaultComponentBuilders,
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      focusNode.requestFocus();
      await tester.pumpAndSettle();
      await tester.tapAt(Offset(200, y));
      await tester.pumpAndSettle();
      expect(composer.selection?.extent.nodeId, 't1');
    });
  }
}
