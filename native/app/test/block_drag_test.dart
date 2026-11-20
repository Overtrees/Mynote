import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/editor/block_drag.dart';

void main() {
  // 中心点：标题 50、段落 150、卡1 250、段落 350、卡2 450
  const centers = [50.0, 150.0, 250.0, 350.0, 450.0];

  test('拖到下方块中心之后 → 交换位置', () {
    // 拖卡1(下标2)到卡2中心之下(500)：raw=5 → 移除后 4
    expect(
      computeDragTargetIndex(
        centers: centers,
        currentIndex: 2,
        pointerY: 500,
        maxIndex: 4,
      ),
      4,
    );
  });

  test('拖回原位附近 → 下标不变', () {
    expect(
      computeDragTargetIndex(
        centers: centers,
        currentIndex: 2,
        pointerY: 260,
        maxIndex: 4,
      ),
      2,
    );
  });

  test('拖到顶部 → 下标 0', () {
    expect(
      computeDragTargetIndex(
        centers: centers,
        currentIndex: 2,
        pointerY: 10,
        maxIndex: 4,
      ),
      0,
    );
  });

  test('maxIndex 钳制（反链节点之前）', () {
    expect(
      computeDragTargetIndex(
        centers: centers,
        currentIndex: 0,
        pointerY: 9999,
        maxIndex: 3,
      ),
      3,
    );
  });
}
