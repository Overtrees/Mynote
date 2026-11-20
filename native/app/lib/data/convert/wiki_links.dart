import 'dart:convert';

/// Wiki 链接语义（原版 editor.js wikiTitleKey / memoWikiTargets）：
/// 语法 [[目标]] 或 [[目标|显示名]]，键 = # 前部分去空白转小写。
String wikiTitleKey(String value) =>
    value.split('#').first.trim().toLowerCase();

final _wikiLinkRe = RegExp(r'\[\[([^\]\r\n|]+)(?:\|[^\]\r\n]+)?\]\]');
final _codeSpanRe = RegExp(r'(`+)[\s\S]*?\1');

/// 从文档 JSON 的全部文本中提取 wiki 目标键集合（剔除代码跨度）。
Set<String> memoWikiTargets(String docJson) {
  final texts = <String>[];
  void collect(Object? value) {
    if (value is Map) {
      for (final e in value.entries) {
        if (e.key == 'text' && e.value is String) {
          texts.add(e.value as String);
        } else {
          collect(e.value);
        }
      }
    } else if (value is List) {
      for (final item in value) {
        collect(item);
      }
    }
  }

  try {
    collect(jsonDecode(docJson));
  } catch (_) {
    return const {};
  }
  var source = texts.join('\n');
  source = source.replaceAll(_codeSpanRe, '');
  source = source.replaceAll(RegExp(r'\\\[\[[^\]\r\n]*\]\]'), '');
  final targets = <String>{};
  for (final m in _wikiLinkRe.allMatches(source)) {
    final key = wikiTitleKey(m.group(1) ?? '');
    if (key.isNotEmpty) targets.add(key);
  }
  return targets;
}
