import 'package:attributed_text/attributed_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/editor/block_components.dart';
import 'package:super_editor/super_editor.dart';

void main() {
  testWidgets('callout 段落点按文本应放置光标', (tester) async {
    final p = ParagraphNode(
      id: 'c1',
      text: AttributedText('[!note] 这是提示框内容文字'),
    );
    final doc = MutableDocument(
      nodes: [
        p,
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
            componentBuilders: const [MynoteParagraphComponentBuilder()],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    focusNode.requestFocus();
    await tester.pumpAndSettle();
    // 点 callout 文本中段
    await tester.tapAt(const Offset(300, 30));
    await tester.pumpAndSettle();
    // ignore: avoid_print
    print('CALLOUT TAP -> ${composer.selection}');
    expect(composer.selection?.extent.nodeId, 'c1');
  });
}
