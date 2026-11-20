import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/convert/inline_marks.dart';
import 'package:mynote_app/data/convert/wiki_links.dart';

void main() {
  group('wiki 行内标记', () {
    test('[[目标]] 解析与回写', () {
      final t = parseInlineMarks('见 [[读书笔记]] 页');
      expect(t.toPlainText(), '见 读书笔记 页');
      final attrs = t.getAllAttributionsAt(2);
      expect(attrs.any((a) => a is WikiLinkAttribution), isTrue);
      expect(serializeInlineMarks(t), '见 [[读书笔记]] 页');
    });
    test('[[目标|显示名]] 解析与回写', () {
      final t = parseInlineMarks('[[目标页|点这里]]');
      expect(t.toPlainText(), '点这里');
      final a = t
          .getAllAttributionsAt(0)
          .whereType<WikiLinkAttribution>()
          .single;
      expect(a.target, '目标页');
      expect(serializeInlineMarks(t), '[[目标页|点这里]]');
    });
  });

  group('脚注引用', () {
    test('[^1] 解析为上标引用并无损回写；定义行不误伤', () {
      final t = parseInlineMarks('正文[^1]尾');
      expect(t.toPlainText(), '正文1尾');
      expect(serializeInlineMarks(t), '正文[^1]尾');
      final def = parseInlineMarks('[^1]: 定义');
      expect(
        def.getAllAttributionsAt(1).any((a) => a is FootnoteAttribution),
        isFalse,
      );
    });
  });

  group('memoWikiTargets', () {
    test('提取目标键：去 # 后缀、转小写、剔除代码', () {
      final doc = jsonEncode([
        {
          'type': 'paragraph',
          'children': [
            {'text': '链 [[Hello World#部分]] 与 [[b|名]]，代码 `[[ignored]]`'},
          ],
        },
      ]);
      final targets = memoWikiTargets(doc);
      expect(targets, containsAll(<String>['hello world', 'b']));
      expect(targets.contains('ignored'), isFalse);
    });
    test('wikiTitleKey', () {
      expect(wikiTitleKey('  Ab C#x '), 'ab c');
      expect(wikiTitleKey(''), '');
    });
  });
}
