// 粘贴分类策略：原版 handleEditorPaste（src/app/editor.js）的纯 Dart 移植。
// 判定顺序与 Web 完全一致：音乐卡输入 > 纯 URL > 内嵌媒体链接 >
// 内嵌普通链接+剩余文本 > 图片文件 > 纯文本（含 Markdown 原样）。
// 辅助函数 isUrl / extractUrlFromText / looksLikeMarkdown 分别对应
// constants.js 与 editor.md.js 的同名实现。
import '../../../core/diag.dart';

final _urlRegex = RegExp(
  r'^https?:\/\/(www\.)?[-一-龥a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-一-龥a-zA-Z0-9()@:%_+.~#?&\/=]*)$',
  caseSensitive: false,
);
final _urlInlineRegex = RegExp(
  r'https?:\/\/[-一-龥a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-一-龥a-zA-Z0-9()@:%_+.~#?&\/=]*',
  caseSensitive: false,
);
final _musicOrMediaRe = RegExp(
  r'music\.163\.com|163cn\.tv|y\.qq\.com|i\.y\.qq\.com|open\.spotify\.com|music\.apple\.com|b23\.tv|xiaohongshu\.com|xhslink\.com',
  caseSensitive: false,
);
final _markdownRe = RegExp(
  r'(^|\n)#{1,6}\s|(^|\n)[-*+]\s|(^|\n)\d+\.\s|(^|\n)>\s|`{1,3}|\*\*[^*]+\*\*|(^|[^*])\*[^*\n]+\*($|[^*])|__[^_]+__|~~[^~]+~~|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|(^|\n)---+(\n|$)|==[^=]+==|\[\[[^\]]+\]\]|\[\^[^\]]+\]|\^\([^\n]+\)\^|\^[A-Za-z0-9][A-Za-z0-9,+\\-]*\^|~\([^\n]+\)~|(^|[^~])~[A-Za-z0-9][A-Za-z0-9,+\\-]*~(?!~)',
  multiLine: true,
);

bool isUrl(String str) => _urlRegex.hasMatch(str.trim());

String? extractUrlFromText(String str) =>
    _urlInlineRegex.firstMatch(str)?.group(0);

/// 原版 looksLikeMathExpression（editor.md.js:230-235）逐字移植：
/// 单字母即真；或含 \命令/数字/运算符/希腊字母任一。此前误写成
/// 「数字与运算符同时具备」，$x$、$a+b$ 会被误判。
bool _looksLikeMathExpression(String expr) {
  final e = expr.trim();
  if (e.isEmpty) return false;
  if (RegExp(r'^[A-Za-z]$').hasMatch(e)) return true;
  return RegExp(
    r'(?:\\[A-Za-z]+|[0-9]|[=+\-*/^_{}<>]|[\u03b1-\u03c9\u0391-\u03a9])',
  ).hasMatch(e);
}

bool _hasMathSyntax(String text) {
  if (RegExp(r'\$\$[\s\S]+?\$\$').hasMatch(text)) return true;
  final pattern = RegExp(r'\$([^$\r\n]+)\$');
  for (final m in pattern.allMatches(text)) {
    if (_looksLikeMathExpression(m.group(1)!)) return true;
  }
  return false;
}

bool looksLikeMarkdown(String text) {
  final s = text.trim();
  if (s.isEmpty) return false;
  return _markdownRe.hasMatch(s) || _hasMathSyntax(s);
}

enum PasteKind {
  /// 粘进待输入的音乐卡：抽 URL 解析入卡
  musicInputUrl,

  /// 整段就是一个 URL：插入链接卡
  pureUrlCard,

  /// 文本内嵌音乐/媒体链接：只取链接插卡
  embeddedMediaCard,

  /// 文本内嵌普通链接：链接插卡，剩余文本留在卡后段落
  embeddedUrlWithRemainder,

  /// 剪贴板带图片文件：逐张作附件插入
  imageFiles,

  /// 其余（含 Markdown）：原样插入文本
  plainText,
}

class PasteDecision {
  const PasteDecision(this.kind, {this.url, this.remainder});
  final PasteKind kind;
  final String? url;
  final String? remainder;
}

PasteDecision classifyPaste({
  required String text,
  required bool hasImageFiles,
  bool intoMusicInput = false,
}) {
  final trimmed = text.trim();
  PasteDecision decide(PasteDecision d) {
    Diag.log(
      'PASTE',
      'classify ${d.kind.name}${d.url != null ? ' url=${d.url}' : ''}',
    );
    return d;
  }

  if (intoMusicInput && trimmed.isNotEmpty) {
    return decide(
      PasteDecision(
        PasteKind.musicInputUrl,
        url: extractUrlFromText(trimmed) ?? trimmed,
      ),
    );
  }
  if (trimmed.isNotEmpty && isUrl(trimmed)) {
    return decide(PasteDecision(PasteKind.pureUrlCard, url: trimmed));
  }
  final embedded = trimmed.isEmpty ? null : extractUrlFromText(trimmed);
  if (embedded != null && _musicOrMediaRe.hasMatch(embedded)) {
    return decide(PasteDecision(PasteKind.embeddedMediaCard, url: embedded));
  }
  if (embedded != null && !looksLikeMarkdown(trimmed)) {
    final remain = trimmed.replaceFirst(embedded, '').trim();
    return decide(
      PasteDecision(
        PasteKind.embeddedUrlWithRemainder,
        url: embedded,
        remainder: remain,
      ),
    );
  }
  if (hasImageFiles) {
    return decide(const PasteDecision(PasteKind.imageFiles));
  }
  return decide(const PasteDecision(PasteKind.plainText));
}
