import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/list/memo_search.dart';

const doc = '''
[
  {"id":"1","type":"paragraph","children":[{"text":"今天去看了莫奈展"}]},
  {"id":"2","type":"musicCard","url":"https://x","meta":{"title":"Never Gonna Give You Up","subtitle":"Rick Astley","source":"Spotify"}},
  {"id":"3","type":"attachment","fileId":"f1","children":[{"text":""}]}
]
''';

void main() {
  test('正文子串命中（中文）', () {
    expect(matchesMemoSearch(title: '周末看展', docJson: doc, query: '莫奈'), isTrue);
  });

  test('卡片 meta 字段命中（副标题/来源，大小写不敏感）', () {
    expect(
      matchesMemoSearch(title: 'x', docJson: doc, query: 'rick astley'),
      isTrue,
    );
    expect(
      matchesMemoSearch(title: 'x', docJson: doc, query: 'SPOTIFY'),
      isTrue,
    );
    expect(
      matchesMemoSearch(title: 'x', docJson: doc, query: 'never gonna'),
      isTrue,
    );
  });

  test('标题命中与未命中', () {
    expect(
      matchesMemoSearch(title: '装修清单', docJson: '[]', query: '装修'),
      isTrue,
    );
    expect(
      matchesMemoSearch(title: '装修清单', docJson: doc, query: '不存在词'),
      isFalse,
    );
  });

  test('空查询恒真', () {
    expect(matchesMemoSearch(title: 'a', docJson: '[]', query: ''), isTrue);
  });

  test('查询不 trim：空格参与子串匹配（原版口径）', () {
    // 文本 'a' 不含空格 → 空格查询不命中；含空格的文本才命中
    expect(matchesMemoSearch(title: 'a', docJson: '[]', query: ' '), isFalse);
    expect(matchesMemoSearch(title: 'a b', docJson: '[]', query: ' '), isTrue);
  });

  test('卡片 url 可搜（非 data: 例外）；fileId 与 data: url 不可搜', () {
    final cardDoc = jsonEncode([
      {
        'id': 'c1',
        'type': 'link-card',
        'url': 'https://example.com/some-article',
        'status': 'ready',
        'meta': {'title': '标题'},
      },
      {'id': 'a1', 'type': 'attachment', 'fileId': 'secretfileid9'},
      {
        'id': 'i1',
        'type': 'image',
        'attrs': {'src': 'data:image/png;base64,ZZZSECRET'},
      },
    ]);
    expect(
      matchesMemoSearch(title: 'x', docJson: cardDoc, query: 'some-article'),
      isTrue,
    );
    expect(
      matchesMemoSearch(title: 'x', docJson: cardDoc, query: 'secretfileid9'),
      isFalse,
    );
    expect(
      matchesMemoSearch(title: 'x', docJson: cardDoc, query: 'zzzsecret'),
      isFalse,
    );
  });
}
