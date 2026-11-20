import 'package:flutter/painting.dart' show Color;
import 'package:super_editor/super_editor.dart';

/// 行内标记解析/序列化（与 Web 版行内语法对齐）。
///
/// 存储格式（doc JSON）始终是带标记的纯文本；编辑器内则解析为
/// AttributedText 的 attribution 区间直接渲染：
///   **粗体** / __粗体__ → boldAttribution
///   *斜体* / _斜体_ → italicsAttribution
///   ==高亮== → BackgroundColorAttribution(高亮黄)
///   ~~删除~~ → strikethroughAttribution
///   `代码` → codeAttribution
///   ^上标^ / ^(上标)^ → superscriptAttribution
///   ~下标~ / ~(下标)~ → subscriptAttribution（~~ 为删除线，优先）
///   [文本](url) → LinkAttribution
///
/// 解析为单层不嵌套（左到右首匹配）；无法配对的标记保持字面。
/// 序列化按字符归组、规范顺序包裹，Web 侧文档（单层）往返无损。

const highlightColor = Color(0x40FFCC00);

const highlightAttribution = BackgroundColorAttribution(highlightColor);

/// 脚注引用 [^label]：上标链接色渲染（原版脚注引用形态）；
/// 定义行 [^label]: 不在此列（其后带冒号，不匹配引用规则）。
class FootnoteAttribution implements Attribution {
  const FootnoteAttribution(this.label);

  final String label;

  @override
  String get id => 'footnote:$label';

  @override
  bool canMergeWith(Attribution other) => this == other;

  @override
  bool operator ==(Object other) =>
      other is FootnoteAttribution && other.label == label;

  @override
  int get hashCode => label.hashCode;
}

/// 数学公式 $...$ / $$...$$：渲染态显示 TeX 源码本体（衬线样式，
/// 显示式整段居中放大），序列化时按 display 标志补回定界符，
/// 与原版 stash 口径一致（原版 KaTeX 不可用时同样回退源码形态）。
/// 真排版渲染需占位符管线改造，单列后续批次。
class MathAttribution implements Attribution {
  const MathAttribution(this.display);

  final bool display;

  @override
  String get id => display ? 'math:display' : 'math:inline';

  @override
  bool canMergeWith(Attribution other) => this == other;

  @override
  bool operator ==(Object other) =>
      other is MathAttribution && other.display == display;

  @override
  int get hashCode => display.hashCode;
}

/// Wiki 链接 [[目标]] / [[目标|显示名]]：显示文本为显示名（缺省=目标），
/// attribution 携带目标标题，点击打开对应笔记（原版 mynote-wiki-link）。
class WikiLinkAttribution implements Attribution {
  const WikiLinkAttribution(this.target);

  final String target;

  @override
  String get id => 'wiki:$target';

  @override
  bool canMergeWith(Attribution other) => this == other;

  @override
  bool operator ==(Object other) =>
      other is WikiLinkAttribution && other.target == target;

  @override
  int get hashCode => target.hashCode;
}

AttributedText parseInlineMarks(String source) {
  final plain = StringBuffer();
  final spans =
      <(Attribution, int, int)>[]; // (attribution, start, endExclusive)
  var i = 0;
  while (i < source.length) {
    // 数学段：定界符消费掉、TeX 本体作纯文本 + MathAttribution
    // （内部 ^ ~ 不被误解析为上下标；原版 editor.md.js 先 stash
    // 数学段再解析扩展标记，同口径）。行内式不许跨行，显示式可。
    if (source[i] == r'$') {
      final isDisplay = source.startsWith(r'$$', i);
      final close = isDisplay
          ? source.indexOf(r'$$', i + 2)
          : source.indexOf(r'$', i + 1);
      if (close > i + (isDisplay ? 2 : 1)) {
        final inner = source.substring(i + (isDisplay ? 2 : 1), close);
        if ((isDisplay || !inner.contains('\n')) && _looksLikeMathExpr(inner)) {
          final start = plain.length;
          plain.write(inner);
          spans.add((MathAttribution(isDisplay), start, plain.length));
          i = close + (isDisplay ? 2 : 1);
          continue;
        }
      }
    }
    final match = _matchAt(source, i);
    if (match == null) {
      plain.write(source[i]);
      i++;
      continue;
    }
    final start = plain.length;
    plain.write(match.content);
    spans.add((match.attribution, start, plain.length));
    i = match.endIndex;
  }
  final result = AttributedText(plain.toString());
  for (final (attribution, start, endExclusive) in spans) {
    if (endExclusive > start) {
      result.addAttribution(attribution, SpanRange(start, endExclusive - 1));
    }
  }
  return result;
}

class _MarkMatch {
  const _MarkMatch(this.attribution, this.content, this.endIndex);
  final Attribution attribution;
  final String content;
  final int endIndex; // 源串中标记结束后的下标
}

_MarkMatch? _matchAt(String s, int i) {
  if (s.startsWith('[^', i)) {
    final close = s.indexOf(']', i + 2);
    if (close > i + 2 && (close + 1 >= s.length || s[close + 1] != ':')) {
      final label = s.substring(i + 2, close);
      // 原版脚注 label 为 [^\]\s]+：不许空白（此前允许空格）
      if (!label.contains('[') && !label.contains(RegExp(r'\s'))) {
        return _MarkMatch(FootnoteAttribution(label), label, close + 1);
      }
    }
    return null;
  }
  if (s.startsWith('[[', i)) {
    final close = s.indexOf(']]', i + 2);
    if (close > i + 2) {
      final inner = s.substring(i + 2, close);
      if (!inner.contains('[') && !inner.contains('\n')) {
        final pipe = inner.indexOf('|');
        final target = (pipe >= 0 ? inner.substring(0, pipe) : inner).trim();
        final label = pipe >= 0 ? inner.substring(pipe + 1) : inner;
        if (target.isNotEmpty && label.isNotEmpty) {
          return _MarkMatch(WikiLinkAttribution(target), label, close + 2);
        }
      }
    }
    return null;
  }
  if (s[i] == '[') {
    final closeBracket = s.indexOf('](', i + 1);
    if (closeBracket > i + 1) {
      final closeParen = s.indexOf(')', closeBracket + 2);
      if (closeParen > closeBracket + 2) {
        final text = s.substring(i + 1, closeBracket);
        final url = s.substring(closeBracket + 2, closeParen);
        if (!text.contains('[')) {
          return _MarkMatch(LinkAttribution(url), text, closeParen + 1);
        }
      }
    }
    return null;
  }
  for (final (marker, attribution) in _markers) {
    if (s.startsWith(marker, i)) {
      if (marker == '*' && s.startsWith('**', i)) return null;
      final contentStart = i + marker.length;
      final close = s.indexOf(marker, contentStart);
      if (close < 0) return null;
      final content = s.substring(contentStart, close);
      if (content.isEmpty || content.startsWith(' ') || content.endsWith(' ')) {
        return null;
      }
      if (content.contains('\n')) return null;
      return _MarkMatch(attribution, content, close + marker.length);
    }
  }
  // _斜体_：两侧须为非单词字符，避免 snake_case 误判
  if (s[i] == '_' && (i == 0 || !_isWordChar(s[i - 1]))) {
    final close = s.indexOf('_', i + 1);
    if (close > i + 1 &&
        (close + 1 >= s.length || !_isWordChar(s[close + 1]))) {
      final content = s.substring(i + 1, close);
      if (!content.startsWith(' ') &&
          !content.endsWith(' ') &&
          !content.contains('\n')) {
        return _MarkMatch(italicsAttribution, content, close + 1);
      }
    }
    return null;
  }
  // ^上标^ / ~(下标)~ 等脚本标记（Web 正则同款字符类）
  if (s[i] == '^' || (s[i] == '~' && !s.startsWith('~~', i))) {
    final marker = s[i];
    final attribution = marker == '^'
        ? superscriptAttribution
        : subscriptAttribution;
    if (i + 1 < s.length && s[i + 1] == '(') {
      final close = s.indexOf(')$marker', i + 2);
      if (close > i + 2) {
        final content = s.substring(i + 2, close);
        if (!content.contains('\n')) {
          return _MarkMatch(attribution, content, close + 2);
        }
      }
      return null;
    }
    var j = i + 1;
    while (j < s.length && _isScriptChar(s[j])) {
      j++;
    }
    if (j > i + 1 && j < s.length && s[j] == marker && _isAlnum(s[i + 1])) {
      return _MarkMatch(attribution, s.substring(i + 1, j), j + 1);
    }
    return null;
  }
  return null;
}

/// 原版 looksLikeMathExpression（editor.md.js:230-235）同口径。
bool _looksLikeMathExpr(String expr) {
  final e = expr.trim();
  if (e.isEmpty) return false;
  if (RegExp(r'^[A-Za-z]$').hasMatch(e)) return true;
  return RegExp(
    r'(?:\\[A-Za-z]+|[0-9]|[=+\-*/^_{}<>]|[\u03b1-\u03c9\u0391-\u03a9])',
  ).hasMatch(e);
}

bool _isWordChar(String c) => RegExp(r'[A-Za-z0-9_]').hasMatch(c);
bool _isAlnum(String c) => RegExp(r'[A-Za-z0-9]').hasMatch(c);
bool _isScriptChar(String c) => RegExp(r'[A-Za-z0-9,+\-]').hasMatch(c);

const _markers = <(String, Attribution)>[
  ('**', boldAttribution),
  ('__', boldAttribution),
  ('==', highlightAttribution),
  ('~~', strikethroughAttribution),
  ('`', codeAttribution),
  ('*', italicsAttribution),
];

/// 把 AttributedText 序列化回带标记的存储文本。
/// 逐字归组（相邻同 attribution 集合合并），每组按规范顺序包裹
/// （链接 > 粗体 > 斜体 > 高亮 > 删除 > 代码，由外到内）。
String serializeInlineMarks(AttributedText text) {
  final plain = text.toPlainText();
  if (plain.isEmpty) return '';
  final out = StringBuffer();
  var runStart = 0;
  var runAttrs = text.getAllAttributionsAt(0);
  for (var i = 1; i <= plain.length; i++) {
    final attrs = i < plain.length
        ? text.getAllAttributionsAt(i)
        : const <Attribution>{};
    if (i == plain.length || !_sameAttributions(attrs, runAttrs)) {
      out.write(_wrapSegment(plain.substring(runStart, i), runAttrs));
      runStart = i;
      runAttrs = attrs;
    }
  }
  return out.toString();
}

/// 把渲染态（已解析归因的 AttributedText）中的字符偏移映射到
/// 源码（带标记文本）中的偏移：点按进入已渲染块编辑时，用它把
/// 光标落点换算回源码坐标。与 serializeInlineMarks 同一分段
/// 口径（逐字归组、逐组包裹）；组内偏移落在开标记之后。
int renderedOffsetToSourceOffset(AttributedText text, int renderedOffset) {
  final plain = text.toPlainText();
  if (renderedOffset <= 0 || plain.isEmpty) return 0;
  var target = renderedOffset;
  if (target > plain.length) target = plain.length;
  // 先按 serialize 口径切出所有组
  final runs =
      <
        ({
          int start,
          int end,
          String wrapped,
          int openLen,
          String? footnoteLabel,
        })
      >[];
  var runStart = 0;
  var runAttrs = text.getAllAttributionsAt(0);
  var sourceCursor = 0;
  for (var i = 1; i <= plain.length; i++) {
    final attrs = i < plain.length
        ? text.getAllAttributionsAt(i)
        : const <Attribution>{};
    if (i == plain.length || !_sameAttributions(attrs, runAttrs)) {
      final runText = plain.substring(runStart, i);
      final wrapped = _wrapSegment(runText, runAttrs);
      final openLen = wrapped.indexOf(runText);
      String? footnoteLabel;
      for (final a in runAttrs) {
        if (a is FootnoteAttribution) {
          footnoteLabel = a.label;
          break;
        }
      }
      runs.add((
        start: runStart,
        end: i,
        wrapped: wrapped,
        openLen: openLen < 0 ? 0 : openLen,
        footnoteLabel: footnoteLabel,
      ));
      sourceCursor += wrapped.length;
      runStart = i;
      runAttrs = attrs;
    }
  }
  // runs 中每组的源码起点需重算（sourceCursor 已走完）——按 wrapped 长度前缀和
  final starts = <int>[];
  var acc = 0;
  for (final r in runs) {
    starts.add(acc);
    acc += r.wrapped.length;
  }
  for (var k = 0; k < runs.length; k++) {
    final r = runs[k];
    if (target > r.start && target < r.end) {
      if (r.footnoteLabel != null) {
        // 脚注引用是原子：点编号任意处都落到源码 ] 之前
        return starts[k] + 2 + r.footnoteLabel!.length;
      }
      return starts[k] + r.openLen + (target - r.start);
    }
    if (target == r.end) {
      if (r.footnoteLabel != null) {
        return starts[k] + 2 + r.footnoteLabel!.length;
      }
      final marked = r.wrapped.length != (r.end - r.start);
      if (target == plain.length) {
        // 文末：落在末组闭标记之前（标记组）或源码末尾
        return marked ? starts[k] + r.openLen + (r.end - r.start) : acc;
      }
      final next = runs[k + 1];
      if (next.footnoteLabel != null) {
        return starts[k + 1] + 2 + next.footnoteLabel!.length;
      }
      final nextMarked = next.wrapped.length != (next.end - next.start);
      if (nextMarked) return starts[k + 1] + next.openLen;
      if (marked) return starts[k] + r.openLen + (r.end - r.start);
      return starts[k] + (r.end - r.start);
    }
    if (target == r.start && k == 0) return 0;
  }
  return acc;
}

bool _sameAttributions(Set<Attribution> a, Set<Attribution> b) {
  if (a.length != b.length) return false;
  for (final item in a) {
    if (!b.contains(item)) return false;
  }
  return true;
}

String _wrapSegment(String segment, Set<Attribution> attrs) {
  var s = segment;
  // 由内到外包裹
  if (attrs.contains(codeAttribution)) s = '`$s`';
  if (attrs.contains(superscriptAttribution)) s = '^$s^';
  if (attrs.contains(subscriptAttribution)) s = '~$s~';
  if (attrs.contains(strikethroughAttribution)) s = '~~$s~~';
  if (attrs.any(
    (a) => a is BackgroundColorAttribution && a.color == highlightColor,
  )) {
    s = '==$s==';
  }
  if (attrs.contains(italicsAttribution)) s = '*$s*';
  if (attrs.contains(boldAttribution)) s = '**$s**';
  for (final a in attrs) {
    if (a is LinkAttribution) {
      s = '[$s](${a.plainTextUri})';
      break;
    }
  }
  for (final a in attrs) {
    if (a is WikiLinkAttribution) {
      s = a.target == s ? '[[$s]]' : '[[${a.target}|$s]]';
      break;
    }
  }
  for (final a in attrs) {
    if (a is FootnoteAttribution) {
      // 显示文本是定义序编号，落盘必须写回 label 本身
      s = '[^${a.label}]';
      break;
    }
  }
  for (final a in attrs) {
    if (a is MathAttribution) {
      // 显示文本是 TeX 本体，落盘补回定界符
      s = a.display ? '\$\$' + s + '\$\$' : '\$' + s + '\$';
      break;
    }
  }
  return s;
}

/// 脚注定义行（与导出端口径一致）：行首可有至多 3 个空格，
/// 形如 [^label]: 内容。返回 label（原样大小写），非定义行返回 null。
final RegExp footnoteDefLinePattern = RegExp(r'^ {0,3}\[\^([^\]\s]+)\]:');

String? footnoteDefLabelOfLine(String line) =>
    footnoteDefLinePattern.firstMatch(line)?.group(1);

/// 扫描全文（按文档顺序的纯文本列表），按定义首次出现顺序编号。
/// 键为 label 小写（与导出端一致），值为 1 起的编号。
Map<String, int> footnoteOrderFromTexts(Iterable<String> plainTexts) {
  final order = <String, int>{};
  for (final text in plainTexts) {
    for (final line in text.split('\n')) {
      final label = footnoteDefLabelOfLine(line);
      if (label != null) {
        final key = label.toLowerCase();
        order.putIfAbsent(key, () => order.length + 1);
      }
    }
  }
  return order;
}

/// 把脚注引用的显示文本换成定义序编号（FootnoteAttribution 不变，
/// label 仍由序列化写回）。无定义对应的引用保留 label 显示。
AttributedText renumberFootnoteRefs(
  AttributedText text,
  Map<String, int> order,
) {
  if (order.isEmpty) return text;
  final plain = text.toPlainText();
  if (plain.isEmpty) return text;
  final out = StringBuffer();
  final pending = <(Attribution, int, int)>[]; // (归因, 新起点, 新终点exclusive)
  var changed = false;
  var runStart = 0;
  var runAttrs = text.getAllAttributionsAt(0);
  void flush(int end) {
    var segment = plain.substring(runStart, end);
    for (final a in runAttrs) {
      if (a is FootnoteAttribution) {
        final n = order[a.label.toLowerCase()];
        if (n != null && segment != '$n') {
          segment = '$n';
          changed = true;
        }
      }
    }
    final start = out.length;
    out.write(segment);
    for (final a in runAttrs) {
      pending.add((a, start, out.length));
    }
  }

  for (var i = 1; i <= plain.length; i++) {
    final attrs = i < plain.length
        ? text.getAllAttributionsAt(i)
        : const <Attribution>{};
    if (i == plain.length || !_sameAttributions(attrs, runAttrs)) {
      flush(i);
      runStart = i;
      runAttrs = attrs;
    }
  }
  if (!changed) return text;
  final result = AttributedText(out.toString());
  for (final (attr, start, end) in pending) {
    if (end > start) {
      result.addAttribution(attr, SpanRange(start, end - 1));
    }
  }
  return result;
}
