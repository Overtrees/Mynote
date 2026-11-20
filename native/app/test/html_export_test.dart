import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/export/html_export.dart';

void main() {
  test('HTML 导出结构与类名对照 Web', () {
    final doc = <dynamic>[
      {
        'id': '1',
        'type': 'heading',
        'attrs': {'level': 2},
        'children': [
          {'text': '标题 **粗**'},
        ],
      },
      {
        'id': '2',
        'type': 'paragraph',
        'children': [
          {'text': '正文 ==高亮== 与 `代码`'},
        ],
      },
      {
        'id': '3',
        'type': 'todo',
        'attrs': {'checked': true},
        'children': [
          {'text': '做完的事'},
        ],
      },
      {
        'id': '4',
        'type': 'musicCard',
        'url': 'https://open.spotify.com/t',
        'meta': {'title': '歌', 'source': 'Spotify'},
      },
    ];
    final html = buildExportHtml(doc, '测试笔记', {}, subtitle: '刚刚 · 4字');
    expect(html, contains('mynote-export-shell'));
    expect(html, contains('mynote-export-title-pill'));
    expect(html, contains('<h2>标题 <strong>粗</strong></h2>'));
    expect(html, contains('<mark>高亮</mark>'));
    expect(html, contains('<code>代码</code>'));
    expect(html, contains('note-todo is-checked'));
    expect(html, contains('note-music-card'));
    expect(html, contains('lkc-title'));
    expect(html.contains('mynote-export-avatar-fallback'), isTrue);
  });

  test('renderInline 转义优先（防注入）', () {
    expect(
      renderInline('<script>alert(1)</script>'),
      contains('&lt;script&gt;'),
    );
    expect(renderInline('a **b** c'), 'a <strong>b</strong> c');
  });
}
