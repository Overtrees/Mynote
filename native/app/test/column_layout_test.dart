import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/editor/column_layout.dart';

void main() {
  group('columnsAllowed（原版媒体查询）', () {
    test('手机竖屏/横屏不可用，平板与桌面可用', () {
      expect(columnsAllowed(390, 844), isFalse); // iPhone 竖屏
      expect(columnsAllowed(844, 390), isFalse); // iPhone 横屏（高<600 且宽<1100）
      expect(columnsAllowed(768, 1024), isTrue); // iPad 竖屏
      expect(columnsAllowed(1024, 768), isTrue); // iPad 横屏
      expect(columnsAllowed(1280, 800), isTrue); // 桌面
      expect(columnsAllowed(1100, 500), isTrue); // 宽≥1100 单独成立
      expect(columnsAllowed(800, 500), isFalse); // 宽够但高<600 且宽<1100
    });
  });

  group('balancedBoundary（按块高均衡）', () {
    test('高块在前时切点靠前而非数量中点', () {
      final blocks = <Map<String, dynamic>>[
        {'type': 'image'},
        {
          'type': 'paragraph',
          'children': [
            {'text': '短'},
          ],
        },
        {
          'type': 'paragraph',
          'children': [
            {'text': '短'},
          ],
        },
        {
          'type': 'paragraph',
          'children': [
            {'text': '短'},
          ],
        },
      ];
      // 权重 280/53/53/53：均衡切点=1（280 vs 159），数量中点是 2
      expect(balancedBoundary(blocks), 1);
    });
    test('等高块切中点；不足两块返回块数', () {
      final p = {
        'type': 'paragraph',
        'children': [
          {'text': 'x' * 44},
        ],
      };
      expect(balancedBoundary([p, p, p, p]), 2);
      expect(balancedBoundary([p]), 1);
    });
  });

  group('normalizeColumnLayout', () {
    test('连续切分：边界取首个 right 块', () {
      final layout = normalizeColumnLayout(
        ['a', 'b', 'c', 'd'],
        {
          'left': ['a', 'b'],
          'right': ['c', 'd'],
          'mode': 'independent',
        },
      );
      expect(layout?['left'], ['a', 'b']);
      expect(layout?['right'], ['c', 'd']);
      expect(layout?['mode'], 'independent');
    });
    test('交错成员被拉直为切分', () {
      final layout = normalizeColumnLayout(
        ['a', 'b', 'c'],
        {
          'left': ['a', 'c'],
          'right': ['b'],
        },
      );
      // 首个 right 是 b(下标1) → left=[a], right=[b,c]
      expect(layout?['left'], ['a']);
      expect(layout?['right'], ['b', 'c']);
    });
    test('非法 layout 返回 null；mode 缺省归一 independent', () {
      expect(normalizeColumnLayout(['a'], {'left': 'x'}), isNull);
      expect(normalizeColumnLayout(['a'], null), isNull);
      final l = normalizeColumnLayout(
        ['a'],
        {
          'left': ['a'],
          'right': [],
        },
      );
      expect(l?['mode'], 'independent');
      final f = normalizeColumnLayout(
        ['a'],
        {
          'left': ['a'],
          'right': [],
          'mode': 'flow',
        },
      );
      expect(f?['mode'], 'flow');
    });
  });
  test('captureColumnLayout 按边界重建', () {
    final l = captureColumnLayout(['a', 'b', 'c'], 2, false);
    expect(l['left'], ['a', 'b']);
    expect(l['right'], ['c']);
    expect(l['mode'], 'flow');
  });
}
