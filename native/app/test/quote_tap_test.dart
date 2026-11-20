import 'package:attributed_text/attributed_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/editor/block_components.dart';
import 'package:super_editor/super_editor.dart';

void main() {
  testWidgets('点引用块文本应放置光标', (tester) async {
    final quote = ParagraphNode(
      id: 'q1',
      text: AttributedText('这是引用块的文字内容'),
      metadata: const {'blockType': blockquoteAttribution},
    );
    final doc = MutableDocument(
      nodes: [
        quote,
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
              const MynoteBlockquoteComponentBuilder(),
              ...defaultComponentBuilders,
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    focusNode.requestFocus();
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(200, 25));
    await tester.pumpAndSettle();
    // ignore: avoid_print
    print('QUOTE TAP -> ${composer.selection}');
    expect(composer.selection?.extent.nodeId, 'q1');
  });
}
