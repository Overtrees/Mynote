/// 块拖拽排序的目标下标计算（纯函数，可单测）。
///
/// [centers] 为文档内全部节点组件的纵向中心（全局坐标，与
/// [pointerY] 同系），[currentIndex] 为被拖块的当前下标。
/// 返回 MoveNodeRequest 需要的下标（移除后坐标系：先移除被拖块，
/// 再插入到该位置）。结果钳制在 [0, maxIndex] 内——maxIndex 由
/// 调用方按文档尾部约束给出（如反链节点之前）。
int computeDragTargetIndex({
  required List<double> centers,
  required int currentIndex,
  required double pointerY,
  required int maxIndex,
}) {
  var raw = 0;
  for (final c in centers) {
    if (c < pointerY) raw++;
  }
  var target = raw > currentIndex ? raw - 1 : raw;
  if (target < 0) target = 0;
  if (target > maxIndex) target = maxIndex;
  return target;
}
