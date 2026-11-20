import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/convert/doc_converter.dart';
import 'package:mynote_app/data/convert/inline_marks.dart';
import 'package:super_editor/super_editor.dart';

void main() {
  test('脚注：引用显示定义序编号，落盘写回 label', () {
    final docJson = [
      {
        'id': 'b1',
        'type': 'paragraph',
        'children': [
          {'text': '正文引用乙[^beta]和甲[^alpha]。'},
        ],
      },
      {
        'id': 'b2',
        'type': 'paragraph',
        'children': [
          {'text': '[^alpha]: 甲的定义'},
        ],
      },
      {
        'id': 'b3',
        'type': 'paragraph',
        'children': [
          {'text': '[^beta]: 乙的定义'},
        ],
      },
    ];
    final doc = DocConverter.fromJson(docJson);
    final body = (doc.getNodeById('b1')! as ParagraphNode).text;
    // 定义序：alpha 先定义 → 1，beta → 2（与正文出现顺序无关）
    expect(body.toPlainText(), '正文引用乙2和甲1。');
    // 序列化写回 label，存储格式不变
    expect(serializeInlineMarks(body), '正文引用乙[^beta]和甲[^alpha]。');
    // 整篇往返
    final out = DocConverter.toJson(doc);
    expect(
      (out[0]['children'] as List).first['text'],
      '正文引用乙[^beta]和甲[^alpha]。',
    );
    expect((out[1]['children'] as List).first['text'], '[^alpha]: 甲的定义');
  });

  test('脚注：无定义的引用保留 label 显示', () {
    final text = renumberFootnoteRefs(parseInlineMarks('孤儿引用[^ghost]在此'), {
      'other': 1,
    });
    expect(text.toPlainText(), '孤儿引用ghost在此');
    expect(serializeInlineMarks(text), '孤儿引用[^ghost]在此');
  });

  test('脚注偏移映射：点编号落到源码 ] 之前', () {
    final parsed = parseInlineMarks('见[^note]文');
    final numbered = renumberFootnoteRefs(parsed, {'note': 1});
    expect(numbered.toPlainText(), '见1文');
    // 源码 '见[^note]文'：] 在下标 7；点编号（渲染偏移 1..2）→ 7
    expect(renderedOffsetToSourceOffset(numbered, 2), 7);
  });
}
