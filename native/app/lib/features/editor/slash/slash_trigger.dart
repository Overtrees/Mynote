// 斜杠菜单触发检测：Web 版 use-slash.js 检测段的纯 Dart 移植。
// 输入当前文本块的全文与光标偏移，输出斜杠 token（起止与查询串）或 null。

class SlashToken {
  const SlashToken({
    required this.start,
    required this.end,
    required this.query,
  });
  final int start; // '/' 的偏移
  final int end; // 光标偏移（token 结束）
  final String query; // '/' 之后到光标的文本
}

final _urlPrefix = RegExp(r'^(?:https?:\/\/|www\.)\S*$', caseSensitive: false);
final _nonWsRun = RegExp(r'\S+$');
final _leadingQuotes = RegExp(r'''^[\([{<"'“‘]+''');
final _whitespace = RegExp(r'\s');

SlashToken? detectSlashToken(String text, int caretOffset) {
  if (caretOffset <= 0 || caretOffset > text.length) return null;
  final slashPos = text.lastIndexOf('/', caretOffset - 1);
  if (slashPos < 0 || slashPos >= caretOffset) return null;

  // URL 路径里的斜杠是文本，不触发（但句中普通斜杠仍可触发命令）
  final beforeSlash = text.substring(0, slashPos + 1);
  final runMatch = _nonWsRun.firstMatch(beforeSlash);
  var token = runMatch?.group(0) ?? '';
  token = token.replaceFirst(_leadingQuotes, '');
  if (_urlPrefix.hasMatch(token)) return null;

  final rawQuery = text.substring(slashPos + 1, caretOffset);
  if (rawQuery.length > 30 || _whitespace.hasMatch(rawQuery)) return null;
  return SlashToken(start: slashPos, end: caretOffset, query: rawQuery);
}
