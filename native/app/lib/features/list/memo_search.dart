// 列表搜索匹配：原版 memo-list.js 的 matchesMemoSearch / memoSearchText
// 移植——标题 + 文档递归抽取的文本类字段（text/title/subtitle/source/
// name/label/alt/description/content）拼接后做小写子串匹配。
import 'dart:convert';

import '../../../core/diag.dart';

final _searchKeyRe = RegExp(
  r'^(text|title|subtitle|source|name|label|alt|description|content)$',
  caseSensitive: false,
);

final _excludedKeyRe = RegExp(
  r'^(id|fileId|dataUrl|url|blob|thumb|imageData)$',
  caseSensitive: false,
);

void _collectSearchText(dynamic value, List<String> out) {
  // 与 Web memoSearchText 逐条一致：数组内字符串直接入列；对象内仅
  // 白名单键的字符串入列；排除键不递归，唯 url 的非 data: 值入列。
  if (value is String) {
    out.add(value);
    return;
  }
  if (value is List) {
    for (final item in value) {
      _collectSearchText(item, out);
    }
    return;
  }
  if (value is Map) {
    for (final entry in value.entries) {
      final key = entry.key.toString();
      final v = entry.value;
      if (_excludedKeyRe.hasMatch(key)) {
        if (key.toLowerCase() == 'url' &&
            v is String &&
            !v.toLowerCase().startsWith('data:')) {
          out.add(v);
        }
        continue;
      }
      if (v is String && _searchKeyRe.hasMatch(key)) {
        out.add(v);
      } else if (v is Map || v is List) {
        _collectSearchText(v, out);
      }
    }
  }
}

/// memo 的可搜索文本（标题 + 文档字段），供测试与匹配共用。
String memoSearchText(String title, String docJson) {
  final fields = <String>[title];
  try {
    _collectSearchText(jsonDecode(docJson), fields);
  } catch (_) {
    // 文档损坏时仅按标题匹配
  }
  return fields.where((s) => s.isNotEmpty).join(' ');
}

int _lastSearchLogMs = 0;

/// D8：搜索执行打点（节流 1s；只记词长与命中数，不记原文）。
void logSearchExec(String query, int hits) {
  final now = DateTime.now().millisecondsSinceEpoch;
  if (now - _lastSearchLogMs < 1000) return;
  _lastSearchLogMs = now;
  Diag.log('SEARCH', 'query len=${query.length} hits=$hits');
}

bool matchesMemoSearch({
  required String title,
  required String docJson,
  required String query,
}) {
  // 原版口径：不 trim（空格参与子串匹配），仅小写化
  final q = query.toLowerCase();
  if (q.isEmpty) return true;
  return memoSearchText(title, docJson).toLowerCase().contains(q);
}
