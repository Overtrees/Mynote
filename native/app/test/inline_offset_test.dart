import 'package:attributed_text/attributed_text.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/convert/inline_marks.dart';
import 'package:super_editor/super_editor.dart';

void main() {
  test('偏移映射：粗体段内落在开标记之后', () {
    final text = parseInlineMarks('abc**粗体**xyz');
    expect(text.toPlainText(), 'abc粗体xyz');
    expect(serializeInlineMarks(text), 'abc**粗体**xyz');
    // 渲染偏移 3（粗体首字前）→ 源码 3+2=5；偏移 4 → 6；偏移 5（粗体末）→ 7
    expect(renderedOffsetToSourceOffset(text, 3), 5);
    expect(renderedOffsetToSourceOffset(text, 4), 6);
    expect(renderedOffsetToSourceOffset(text, 5), 7);
    // 普通段不变
    expect(renderedOffsetToSourceOffset(text, 0), 0);
    expect(renderedOffsetToSourceOffset(text, 2), 2);
    // 粗体之后的普通段：渲染 6 → 源码 6+4=10
    expect(renderedOffsetToSourceOffset(text, 6), 10);
  });

  test('偏移映射：链接段（后缀为 ](url)）', () {
    final text = parseInlineMarks('看[例子](https://a.b)吧');
    expect(text.toPlainText(), '看例子吧');
    // 渲染偏移 2（例与子之间）→ 源码同位置：看 + [ + 例 = 3
    expect(renderedOffsetToSourceOffset(text, 2), 3);
    // 渲染偏移 3（链接段末）→ 源码落在 ]( 之前 = 4
    expect(renderedOffsetToSourceOffset(text, 3), 4);
    expect(renderedOffsetToSourceOffset(text, 1), 2);
  });

  test('渲染/还原往返：解析→序列化→再解析稳定', () {
    const src = '前 **粗** 中 ==亮== 后 [链](https://x.y) 尾';
    final parsed = parseInlineMarks(src);
    final serialized = serializeInlineMarks(parsed);
    expect(serialized, src);
    final reparsed = parseInlineMarks(serialized);
    expect(serializeInlineMarks(reparsed), src);
    expect(reparsed.toPlainText(), parsed.toPlainText());
  });
}
