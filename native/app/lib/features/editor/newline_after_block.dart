import 'package:attributed_text/attributed_text.dart';
import 'package:super_editor/super_editor.dart';

/// 原版 Enter 语义（src/app/editor.js「Enter 在非段落块中新建行」）：
/// 在标题/引用/待办块中按 Enter，不劈开原文，而是在块后插入一个
/// 空段落并把光标移过去。SE 默认行为是劈分（标题变两个标题、
/// 待办尾巴变新待办），与原版不一致且会误拆结构，故以请求处理
/// 器前置拦截 InsertNewlineAtCaretRequest（物理键盘与 IME 两条
/// 路径都汇到此请求），无需改 vendor。
class InsertParagraphAfterBlockCommand extends BaseInsertNewlineAtCaretCommand {
  const InsertParagraphAfterBlockCommand(this.newNodeId);

  final String newNodeId;

  @override
  void doInsertNewline(
    EditContext context,
    CommandExecutor executor,
    DocumentPosition caretPosition,
    NodePosition caretNodePosition,
  ) {
    final node = context.document.getNodeById(caretPosition.nodeId);
    if (node == null) return;
    executor
      ..executeCommand(
        InsertNodeAfterNodeCommand(
          existingNodeId: node.id,
          newNode: ParagraphNode(id: newNodeId, text: AttributedText('')),
        ),
      )
      ..executeCommand(
        ChangeSelectionCommand(
          DocumentSelection.collapsed(
            position: DocumentPosition(
              nodeId: newNodeId,
              nodePosition: const TextNodePosition(offset: 0),
            ),
          ),
          SelectionChangeType.collapseSelection,
          SelectionReason.userInteraction,
        ),
      );
  }
}

/// 前置请求处理器：光标折叠且位于待办/标题/引用块时认领
/// InsertNewlineAtCaretRequest；其余情况返回 null 走默认链。
EditCommand? paragraphAfterBlockNewlineHandler(
  Editor editor,
  EditRequest request,
) {
  if (request is! InsertNewlineAtCaretRequest) return null;
  final selection = editor.composer.selection;
  if (selection == null || !selection.isCollapsed) return null;
  final node = editor.document.getNodeById(selection.extent.nodeId);
  if (node is TaskNode) {
    return InsertParagraphAfterBlockCommand(request.newNodeId);
  }
  if (node is ParagraphNode) {
    final blockType = node.getMetadataValue('blockType');
    if (blockType is NamedAttribution &&
        (blockType.id.startsWith('header') || blockType.id == 'blockquote')) {
      return InsertParagraphAfterBlockCommand(request.newNodeId);
    }
  }
  return null;
}
