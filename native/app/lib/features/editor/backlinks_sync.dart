import 'package:super_editor/super_editor.dart';

import '../../data/convert/doc_nodes.dart';

/// 反链分节同步请求：把文档末尾的 BacklinksNode 同步为给定状态
/// （node 为 null 表示移除）。经非历史命令执行——事务会发变更
/// 通知让组件重绘，但不进撤销栈（它不是用户编辑）。
class SyncBacklinksRequest implements EditRequest {
  const SyncBacklinksRequest(this.node);

  final BacklinksNode? node;
}

EditCommand? syncBacklinksRequestHandler(Editor editor, EditRequest request) {
  if (request is SyncBacklinksRequest) {
    return SyncBacklinksCommand(request.node);
  }
  return null;
}

class SyncBacklinksCommand extends EditCommand {
  const SyncBacklinksCommand(this.node);

  final BacklinksNode? node;

  @override
  HistoryBehavior get historyBehavior => HistoryBehavior.nonHistorical;

  @override
  void execute(EditContext context, CommandExecutor executor) {
    final document = context.document;
    final existing = document.getNodeById(BacklinksNode.kBacklinksNodeId);
    if (node == null) {
      if (existing != null) {
        document.deleteNode(BacklinksNode.kBacklinksNodeId);
        executor.logChanges([
          DocumentEdit(
            NodeRemovedEvent(BacklinksNode.kBacklinksNodeId, existing),
          ),
        ]);
      }
      return;
    }
    if (existing == null) {
      document.add(node!);
      executor.logChanges([
        DocumentEdit(
          NodeInsertedEvent(
            BacklinksNode.kBacklinksNodeId,
            document.nodeCount - 1,
          ),
        ),
      ]);
    } else if (!existing.hasEquivalentContent(node!)) {
      document.replaceNodeById(BacklinksNode.kBacklinksNodeId, node!);
      executor.logChanges([
        DocumentEdit(NodeChangeEvent(BacklinksNode.kBacklinksNodeId)),
      ]);
    }
  }
}
