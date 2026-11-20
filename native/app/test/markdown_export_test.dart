import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/export/markdown_export.dart';

Map<String, dynamic> block(
  String type,
  String text, [
  Map<String, dynamic>? extra,
]) {
  return {
    'id': 'b-$type',
    'type': type,
    'children': [
      {'text': text},
    ],
    ...?extra,
  };
}

void main() {
  test('全块类型 Markdown 输出（对照 export.js 语义）', () {
    final doc = <dynamic>[
      block('heading', '二级标题', {
        'attrs': {'level': 2},
      }),
      block('paragraph', '正文一段'),
      block('quote', '引一\n引二'),
      block('todo', '已办', {
        'attrs': {'checked': true},
      }),
      block('todo', '待办', {
        'attrs': {'checked': false},
      }),
      block('divider', ''),
      block('image', '', {
        'attrs': {'fileId': 'f1'},
      }),
      block('attachment', '', {'fileId': 'f2'}),
      block('musicCard', '', {
        'url': 'https://open.spotify.com/track/x',
        'meta': {'title': '歌名'},
      }),
      block('link-card', '', {'url': 'https://example.com/a b'}),
      block('gallery', '', {
        'attrs': {
          'items': ['f1'],
        },
      }),
    ];
    final files = <String, Map<String, dynamic>>{
      'f1': {
        'name': '照片.png',
        'type': 'image/png',
        'url': 'data:image/png;base64,iVBORw0KGgo=',
      },
      'f2': {'name': '报告.pdf', 'type': 'application/pdf', 'url': ''},
    };
    final md = docToMarkdown(doc, '我的笔记', files);
    expect(md, contains('# 我的笔记'));
    expect(md, contains('## 二级标题'));
    expect(md, contains('> 引一\n> 引二'));
    expect(md, contains('- [x] 已办'));
    expect(md, contains('- [ ] 待办'));
    expect(md, contains('\n---\n'));
    expect(md, contains('![照片.png](data:image/png;base64,iVBORw0KGgo=)'));
    expect(md, contains('📎 报告.pdf'));
    expect(md, contains('[歌名](https://open.spotify.com/track/x)'));
    expect(md, contains('](https://example.com/a%20b)'));
    expect(md.endsWith('\n'), isTrue);
  });

  test('无 URL 图片退回占位、标题转义', () {
    final doc = <dynamic>[
      block('image', '', {
        'attrs': {'fileId': 'missing'},
      }),
    ];
    final md = docToMarkdown(doc, 'a*b', {});
    expect(md, contains('# a\\*b'));
    expect(md, contains('[图片：图片]'));
  });
}
