import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/list/memo_list_page.dart';

void main() {
  group('页眉收缩进度（2026-11-19 实机事故回归）', () {
    test('慢速滚动的小步进序列必须最终到达恰好 1.0（compact 成立）', () {
      // 复现事故：旧门槛「变化 >0.02 才更新」下，s 以小步逼近 1，
      // 最后一步差 0.01 被吞，_shrink 永远卡在 ~0.99，页眉三件套
      // （头像/搜索/紧凑胶囊）状态错位常驻压住内容。
      var shrink = 0.0;
      for (final offset in [
        2.0,
        5.0,
        9.0,
        14.0,
        20.0,
        24.0,
        27.0,
        28.5,
        29.4,
        29.9,
        30.0,
        45.0,
        120.0,
      ]) {
        final s = shrinkForOffset(offset);
        if (shouldUpdateShrink(shrink, s)) shrink = s;
      }
      expect(shrink, 1.0);
    });

    test('回滚到顶必须回到恰好 0', () {
      var shrink = 1.0;
      for (final offset in [25.0, 18.0, 11.0, 5.0, 1.5, 0.4, 0.0]) {
        final s = shrinkForOffset(offset);
        if (shouldUpdateShrink(shrink, s)) shrink = s;
      }
      expect(shrink, 0.0);
    });

    test('中途小步进仍被门槛合并（不逐帧 setState）', () {
      expect(shouldUpdateShrink(0.5, 0.51), isFalse);
      expect(shouldUpdateShrink(0.5, 0.53), isTrue);
      expect(shouldUpdateShrink(0.99, 1.0), isTrue);
      expect(shouldUpdateShrink(0.01, 0.0), isTrue);
      expect(shouldUpdateShrink(0.5, 0.5), isFalse);
    });
  });
}
