import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/list/memo_preview.dart';

String docOf(List<Map<String, dynamic>> blocks) => jsonEncode(blocks);

Map<String, dynamic> para(String text) => {
  'id': 'p',
  'type': 'paragraph',
  'children': [
    {'text': text},
  ],
};

void main() {
  group('summarizeMemoDoc', () {
    test('段落拼接 + 去 Markdown + 截断 80', () {
      final doc = docOf([
        para('**粗体** 开头的内容'),
        para('第二段 [链接](https://example.com) 文字'),
      ]);
      final r = summarizeMemoDoc(doc, 80);
      expect(r.preview, '粗体 开头的内容 第二段 链接 文字');
      expect(r.attachCount, 0);
    });

    test('#标签提取（去重、最多 3）且预览去掉标签 token', () {
      final doc = docOf([
        para('今天去了 #看展 和 #旅行 笔记 #看展'),
        para('还有 #美食 #摄影 #日常'),
      ]);
      final r = summarizeMemoDoc(doc, 80);
      expect(r.tags, ['#看展', '#旅行', '#美食']);
      expect(r.preview.contains('#'), isFalse);
      // 与 Web 数据一致：标签移除后保留双空格（渲染时浏览器折叠）
      expect(r.preview, '今天去了  和  笔记  还有');
    });

    test('无段落时预览回退与附件计数', () {
      final doc = docOf([
        {'id': 'a1', 'type': 'attachment', 'fileId': 'f1', 'image': false},
        {
          'id': 't1',
          'type': 'todo',
          'attrs': {'checked': false},
          'children': [
            {'text': '待办'},
          ],
        },
      ]);
      final r = summarizeMemoDoc(doc, 80);
      expect(r.preview, '无更多文本');
      expect(r.attachCount, 1);
    });

    test('只有标签的段落：预览回退为首个标签名', () {
      final r = summarizeMemoDoc(docOf([para('#灵感')]), 80);
      expect(r.preview, '灵感');
    });

    test('截断到 maxLen', () {
      final r = summarizeMemoDoc(docOf([para('一' * 100)]), 60);
      expect(r.preview.length, 60);
    });
  });

  group('stripMarkdownForPreview', () {
    test('标题/引用/列表/代码围栏', () {
      expect(stripMarkdownForPreview('# 标题\n> 引用\n- 项一\n1. 项二'), '标题 引用 项一 项二');
      expect(stripMarkdownForPreview('前 ```code``` 后'), '前 代码块 后');
      expect(stripMarkdownForPreview('==高亮== 与 ~~删除~~ 与 `代码`'), '高亮 与 删除 与 代码');
    });

    test('维基链接取标题', () {
      expect(stripMarkdownForPreview('见 [[另一篇|别名]] 与 [[笔记]]'), '见 别名 与 笔记');
    });
  });

  group('memoHasImage / memoCoverFileId / collectMemoFileIds', () {
    test('image 块与 image 附件都算图片笔记', () {
      expect(
        memoHasImage(
          docOf([
            {
              'id': 'i',
              'type': 'image',
              'attrs': {'fileId': 'x'},
            },
          ]),
        ),
        isTrue,
      );
      expect(
        memoHasImage(
          docOf([
            {'id': 'a', 'type': 'attachment', 'fileId': 'x', 'image': true},
          ]),
        ),
        isTrue,
      );
      expect(
        memoHasImage(
          docOf([
            {'id': 'a', 'type': 'attachment', 'fileId': 'x', 'image': false},
          ]),
        ),
        isFalse,
      );
    });

    test('封面只取第一个 attachment 的 fileId', () {
      final doc = docOf([
        {
          'id': 'i',
          'type': 'image',
          'attrs': {'fileId': 'img1'},
        },
        {'id': 'a', 'type': 'attachment', 'fileId': 'att1'},
      ]);
      expect(memoCoverFileId(doc), 'att1');
    });

    test('collect 覆盖 attachment/attrs/gallery items', () {
      final doc = docOf([
        {'id': 'a', 'type': 'attachment', 'fileId': 'f1'},
        {
          'id': 'g',
          'type': 'gallery',
          'attrs': {
            'items': [
              {'fileId': 'f2'},
              'plain-id',
            ],
          },
        },
        {
          'id': 'c',
          'type': 'imgTextCard',
          'attrs': {'fileId': 'f3'},
        },
      ]);
      expect(collectMemoFileIds(doc), ['f1', 'f2', 'plain-id', 'f3']);
    });
  });
}
