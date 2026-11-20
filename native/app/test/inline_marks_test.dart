import 'package:flutter_test/flutter_test.dart';
import 'package:super_editor/super_editor.dart';

import 'package:mynote_app/data/convert/inline_marks.dart';

void main() {
  group('inline marks round-trip', () {
    final cases = <String>[
      '普通文本没有标记',
      '想起上周看的书里那句话：==所谓的边界，只是我们还没习惯的过渡带==',
      '这是**粗体**和*斜体*混排',
      '删除线 ~~不要了~~ 保留',
      '行内代码 `code` 片段',
      '看这个 [示例链接](https://example.com) 不错',
      '未配对的 ** 标记保持字面',
      '星号 * 不是标记',
      '== 高亮内容首尾空格不算 ==',
      '多处 **一** 隔开 **二** 标记',
      '**粗体**紧贴==高亮==相邻',
      '半角标点 **bold** 后跟文字',
      r'质能方程 $E=mc^2$ 很出名',
      r'$$\int_0^1 x^2 dx$$',
      r'价格 $5 和 $10 不算公式',
      r'公式里的下标 $a_b$ 不误伤',
    ];
    for (final source in cases) {
      test('round-trip: $source', () {
        final parsed = parseInlineMarks(source);
        expect(serializeInlineMarks(parsed), source);
      });
    }
  });

  group('parse attributions', () {
    test('highlight strips markers and adds background attribution', () {
      final parsed = parseInlineMarks('前 ==高亮== 后');
      expect(parsed.toPlainText(), '前 高亮 后');
      expect(parsed.getAllAttributionsAt(2), contains(highlightAttribution));
      expect(
        parsed.getAllAttributionsAt(0),
        isNot(contains(highlightAttribution)),
      );
    });

    test('bold and link attributions', () {
      final parsed = parseInlineMarks('**粗** [链](https://a.b)');
      expect(parsed.toPlainText(), '粗 链');
      expect(parsed.getAllAttributionsAt(0), contains(boldAttribution));
      final linkAttrs = parsed.getAllAttributionsAt(2);
      expect(
        linkAttrs.whereType<LinkAttribution>().single.plainTextUri,
        'https://a.b',
      );
    });

    test('unpaired markers stay literal', () {
      final parsed = parseInlineMarks('a ** b');
      expect(parsed.toPlainText(), 'a ** b');
      expect(parsed.getAllAttributionsAt(2), isNot(contains(boldAttribution)));
    });
  });

  group('上下标与下划线标记', () {
    test('^2^ 解析为上标并回写', () {
      final t = parseInlineMarks('x^2^ + y');
      expect(t.toPlainText(), 'x2 + y');
      expect(
        t.getAllAttributionsAt(1).contains(superscriptAttribution),
        isTrue,
      );
      expect(serializeInlineMarks(t), 'x^2^ + y');
    });
    test('~(n)~ 解析为下标', () {
      final t = parseInlineMarks('a~(n)~b');
      expect(t.toPlainText(), 'anb');
      expect(t.getAllAttributionsAt(1).contains(subscriptAttribution), isTrue);
      expect(serializeInlineMarks(t), 'a~n~b');
    });
    test('__粗__ 与 _斜_ 解析，snake_case 不误判', () {
      final t = parseInlineMarks('__粗__ _斜_ a_b_c');
      expect(t.toPlainText(), '粗 斜 a_b_c');
      expect(t.getAllAttributionsAt(0).contains(boldAttribution), isTrue);
      expect(t.getAllAttributionsAt(2).contains(italicsAttribution), isTrue);
      expect(t.getAllAttributionsAt(5).contains(italicsAttribution), isFalse);
    });
    test('~~ 仍为删除线而非下标', () {
      final t = parseInlineMarks('~~删~~');
      expect(
        t.getAllAttributionsAt(0).contains(strikethroughAttribution),
        isTrue,
      );
      expect(t.getAllAttributionsAt(0).contains(subscriptAttribution), isFalse);
    });
  });
}
