// 文档 → 独立 HTML 导出：原版 src/app/editor/export.js 的结构移植。
// 结构与类名与 Web 一致（mynote-export-shell / note-* / lkc-*），
// 样式为导出壳 CSS + 块级样式的静态汇编（Web 为实时快照全量 CSS）。
// 行内 Markdown 渲染为常用子集（粗/斜/高亮/删除线/代码/链接/图片），
// Web 端走 marked 全量引擎，复杂 MD 语法可能略有差异。
import '../../../core/diag.dart';
import 'markdown_export.dart';

String escapeHtml(dynamic value) {
  return (value?.toString() ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
}

/// 脚注：定义行 [^label]: 内容（可带缩进续行）从正文剥离，引用渲染为
/// 序号上标，文末生成脚注节与回链；未被引用的定义按原版以原文回补文末。
/// 编号 = 定义出现顺序（原版 order.indexOf + 1）。
class ExportFootnotes {
  final _defs = <String, ({String label, String body})>{};
  final _order = <String>[];
  final _refCounts = <String, int>{};
  final _refIds = <String, List<String>>{};

  static final _defLineStart = RegExp(r'^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$');
  static final _contLine = RegExp(r'^(?: {2,}|\t)(.*)$');

  static String footnoteId(String label) {
    var id = Uri.encodeComponent(label.trim()).replaceAll('%', '_');
    id = id.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return 'fn-$id';
  }

  /// 扫描一段文本：剥离定义行（含续行），返回剩余文本。
  String stripDefinitions(String text) {
    final lines = text.split('\n');
    final kept = <String>[];
    var i = 0;
    while (i < lines.length) {
      final m = _defLineStart.firstMatch(lines[i]);
      if (m == null) {
        kept.add(lines[i]);
        i++;
        continue;
      }
      final label = m.group(1)!;
      final body = <String>[m.group(2)!];
      i++;
      while (i < lines.length) {
        final c = _contLine.firstMatch(lines[i]);
        if (c == null) break;
        body.add(c.group(1)!);
        i++;
      }
      final key = label.toLowerCase();
      if (!_defs.containsKey(key)) {
        _defs[key] = (label: label, body: body.join('\n').trim());
        _order.add(key);
      }
    }
    return kept.join('\n');
  }

  /// 引用 → 上标 HTML；无定义返回 null（调用方保留原文）。
  String? refHtml(String label) {
    final key = label.toLowerCase();
    final def = _defs[key];
    if (def == null) return null;
    final number = _order.indexOf(key) + 1;
    final refIndex = (_refCounts[key] ?? 0) + 1;
    _refCounts[key] = refIndex;
    final target = footnoteId(def.label);
    final refId = '$target-ref-$refIndex';
    (_refIds[key] ??= []).add(refId);
    return '<sup class="footnote-ref"><a href="#$target" id="$refId" aria-label="脚注 $number">$number</a></sup>';
  }

  /// 文末脚注节（无被引用定义时为空串）。
  String sectionHtml() {
    final items = <String>[];
    for (final key in _order) {
      final refs = _refIds[key];
      if (refs == null || refs.isEmpty) continue;
      final def = _defs[key]!;
      final target = footnoteId(def.label);
      final backs = refs
          .map(
            (r) =>
                '<a class="footnote-backref" href="#$r" aria-label="返回脚注引用">↩</a>',
          )
          .join(' ');
      items.add(
        '<li id="$target">${renderMarkdownBlock(def.body)}<span class="footnote-backlinks"> $backs</span></li>',
      );
    }
    if (items.isEmpty) return '';
    return '<section class="footnotes" aria-label="脚注"><ol>${items.join()}</ol></section>';
  }

  /// 未被引用的定义原文（原版回补到正文末尾）。
  List<String> unusedDefinitionLines() {
    final out = <String>[];
    for (final key in _order) {
      if ((_refIds[key] ?? const []).isEmpty) {
        out.add('[^${_defs[key]!.label}]: ${_defs[key]!.body}');
      }
    }
    return out;
  }
}

String _nodeText(Map<String, dynamic> node) {
  final children = node['children'];
  if (children is List && children.isNotEmpty && children.first is Map) {
    return (children.first as Map)['text']?.toString() ?? '';
  }
  return '';
}

/// 行内渲染：先转义，再按标记替换。数学段先暂存保护（内部 ^ ~ 不解析，
/// 导出保持 $...$ 原文——原版走 KaTeX 渲染，静态导出不引入引擎）；
/// 另含原版扩展标记：脚注引用、wiki 链接、__粗__、上/下标、_斜_。
String renderInline(String text, {ExportFootnotes? footnotes}) {
  var s = escapeHtml(text);
  final mathStash = <String>[];
  s = s.replaceAllMapped(RegExp(r'\$\$[^$]+\$\$|\$[^$\n]+\$'), (m) {
    mathStash.add(m[0]!);
    return '\uE000${mathStash.length - 1}\uE001';
  });
  if (footnotes != null) {
    s = s.replaceAllMapped(RegExp(r'\[\^([^\]\s]+)\]'), (m) {
      return footnotes.refHtml(m[1]!) ?? m[0]!;
    });
  }
  s = s.replaceAllMapped(RegExp(r'\[\[([^\]\r\n|]+)(?:\|([^\]\r\n]+))?\]\]'), (
    m,
  ) {
    final target = m[1]!.trim();
    if (target.isEmpty) return m[0]!;
    final label = (m[2] ?? target).trim();
    return '<a class="mynote-wiki-link" href="#" data-note-title="${escapeHtml(target)}" title="打开笔记：${escapeHtml(target)}">${escapeHtml(label.isEmpty ? target : label)}</a>';
  });
  s = s.replaceAllMapped(RegExp(r'`([^`]+)`'), (m) => '<code>${m[1]}</code>');
  s = s.replaceAllMapped(
    RegExp(r'!\[([^\]]*)\]\(([^)]+)\)'),
    (m) => '<img src="${m[2]}" alt="${m[1]}">',
  );
  s = s.replaceAllMapped(
    RegExp(r'\[([^\]]+)\]\(([^)]+)\)'),
    (m) =>
        '<a href="${m[2]}" target="_blank" rel="noopener noreferrer">${m[1]}</a>',
  );
  s = s.replaceAllMapped(
    RegExp(r'\*\*([^*]+)\*\*'),
    (m) => '<strong>${m[1]}</strong>',
  );
  s = s.replaceAllMapped(
    RegExp(r'__([^_]+)__'),
    (m) => '<strong>${m[1]}</strong>',
  );
  s = s.replaceAllMapped(RegExp(r'==([^=]+)=='), (m) => '<mark>${m[1]}</mark>');
  s = s.replaceAllMapped(RegExp(r'~~([^~]+)~~'), (m) => '<del>${m[1]}</del>');
  s = s.replaceAllMapped(
    RegExp(r'\^\(([^()\n]+)\)\^'),
    (m) => '<sup>${m[1]}</sup>',
  );
  s = s.replaceAllMapped(
    RegExp(r'\^([A-Za-z0-9][A-Za-z0-9,+-]*)\^'),
    (m) => '<sup>${m[1]}</sup>',
  );
  s = s.replaceAllMapped(
    RegExp(r'~\(([^()\n]+)\)~'),
    (m) => '<sub>${m[1]}</sub>',
  );
  s = s.replaceAllMapped(
    RegExp(r'(^|[^~])~([A-Za-z0-9][A-Za-z0-9,+-]*)~(?!~)'),
    (m) => '${m[1]}<sub>${m[2]}</sub>',
  );
  s = s.replaceAllMapped(
    RegExp(r'(?<!\*)\*([^*\n]+)\*(?!\*)'),
    (m) => '<em>${m[1]}</em>',
  );
  s = s.replaceAllMapped(
    RegExp(r'(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])'),
    (m) => '<em>${m[1]}</em>',
  );
  s = s.replaceAllMapped(
    RegExp('\\uE000(\\d+)\\uE001'),
    (m) => mathStash[int.parse(m[1]!)],
  );
  return s.replaceAll('\n', '<br>');
}

/// 段落级 Markdown 渲染（子集）：代码围栏/标题/列表/引用按行识别，其余整段行内渲染。
const _calloutStyleMap = <String, String>{
  'note': 'note',
  'info': 'note',
  'todo': 'note',
  'abstract': 'note',
  'quote': 'note',
  'tip': 'tip',
  'success': 'tip',
  'example': 'tip',
  'question': 'warning',
  'warning': 'warning',
  'important': 'important',
  'failure': 'important',
  'bug': 'important',
  'caution': 'caution',
  'danger': 'caution',
};
const _calloutTitles = <String, String>{
  'note': '笔记',
  'info': '信息',
  'todo': '待办',
  'abstract': '摘要',
  'quote': '引用',
  'tip': '提示',
  'success': '成功',
  'example': '示例',
  'question': '问题',
  'warning': '注意',
  'important': '重要',
  'failure': '失败',
  'bug': '问题',
  'caution': '小心',
  'danger': '危险',
};
const _calloutIcons = <String, String>{
  'note': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-note-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  'warning': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-warning-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  'tip': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-tip-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  'important': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-important-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  'caution': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-callout-caution-icon)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
};

String renderMarkdownBlock(String text, {ExportFootnotes? footnotes}) {
  String ri(String t) => renderInline(t, footnotes: footnotes);
  final source = text;
  if (source.trim().isEmpty) return '';
  final lines = source.split('\n');
  final out = StringBuffer();
  var i = 0;
  while (i < lines.length) {
    final line = lines[i];
    if (line.startsWith('```')) {
      final buf = <String>[];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.add(lines[i]);
        i++;
      }
      i++;
      out.write('<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>');
      continue;
    }
    final heading = RegExp(r'^(#{1,6})\s+(.*)$').firstMatch(line);
    if (heading != null) {
      final level = heading.group(1)!.length;
      out.write('<h$level>${ri(heading.group(2)!)}</h$level>');
      i++;
      continue;
    }
    if (line.startsWith('> ') || line == '>') {
      // Callout（原版 preprocessCallouts）：> [!TYPE](+/-)? 自定义标题?
      final calloutMatch = RegExp(r'^> \[!(\w+)\]([+-]?)(?:[ \t]+(.*))?$')
          .firstMatch(line);
      final buf = <String>[];
      while (i < lines.length &&
          (lines[i].startsWith('> ') || lines[i] == '>')) {
        buf.add(lines[i].startsWith('> ') ? lines[i].substring(2) : '');
        i++;
      }
      if (calloutMatch != null) {
        final rawType = calloutMatch.group(1)!.toLowerCase();
        final style = _calloutStyleMap[rawType] ?? 'note';
        final folding = calloutMatch.group(2) ?? '';
        final customTitle = calloutMatch.group(3)?.trim() ?? '';
        final title = customTitle.isNotEmpty
            ? customTitle
            : (_calloutTitles[rawType] ?? calloutMatch.group(1)!);
        final header =
            '<span class="callout-icon" aria-hidden="true">${_calloutIcons[style]}</span><span class="callout-title">${escapeHtml(title)}</span>';
        final bodyHtml = buf.skip(1).map(ri).join('<br>');
        if (folding == '+' || folding == '-') {
          out.write(
            '<details class="callout callout-$style callout-collapsible"${folding == '+' ? ' open' : ''}><summary class="callout-header">$header</summary><div class="callout-body">$bodyHtml</div></details>',
          );
        } else {
          out.write(
            '<aside class="callout callout-$style"><div class="callout-header">$header</div><div class="callout-body">$bodyHtml</div></aside>',
          );
        }
      } else {
        out.write('<blockquote>${buf.map(ri).join('<br>')}</blockquote>');
      }
      continue;
    }
    if (RegExp(r'^\s*[-*+]\s+').hasMatch(line)) {
      final buf = <String>[];
      while (i < lines.length && RegExp(r'^\s*[-*+]\s+').hasMatch(lines[i])) {
        buf.add(lines[i].replaceFirst(RegExp(r'^\s*[-*+]\s+'), ''));
        i++;
      }
      out.write('<ul>${buf.map((e) => '<li>${ri(e)}</li>').join()}</ul>');
      continue;
    }
    if (RegExp(r'^\s*\d+[.)]\s+').hasMatch(line)) {
      final buf = <String>[];
      while (i < lines.length && RegExp(r'^\s*\d+[.)]\s+').hasMatch(lines[i])) {
        buf.add(lines[i].replaceFirst(RegExp(r'^\s*\d+[.)]\s+'), ''));
        i++;
      }
      out.write('<ol>${buf.map((e) => '<li>${ri(e)}</li>').join()}</ol>');
      continue;
    }
    if (RegExp(r'^\s*(-{3,}|\*{3,}|_{3,})\s*$').hasMatch(line)) {
      out.write('<hr>');
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      final rows = <List<String>>[];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        final cells = lines[i]
            .trim()
            .replaceAll(RegExp(r'^\||\|$'), '')
            .split('|')
            .map((c) => c.trim())
            .toList();
        if (!cells.every((c) => RegExp(r'^:?-+:?$').hasMatch(c))) {
          rows.add(cells);
        }
        i++;
      }
      if (rows.isNotEmpty) {
        final head = rows.first.map((c) => '<th>${ri(c)}</th>').join();
        final body = rows
            .skip(1)
            .map((r) => '<tr>${r.map((c) => '<td>${ri(c)}</td>').join()}</tr>')
            .join();
        out.write(
          '<table><thead><tr>$head</tr></thead><tbody>$body</tbody></table>',
        );
      }
      continue;
    }
    if (line.trim().isEmpty) {
      i++;
      continue;
    }
    final buf = <String>[];
    while (i < lines.length && lines[i].trim().isNotEmpty) {
      buf.add(lines[i]);
      i++;
    }
    out.write('<p>${ri(buf.join('\n'))}</p>');
  }
  return out.toString();
}

String _formatBytes(dynamic value) {
  final bytes = (value as num?)?.toDouble() ?? -1;
  if (bytes < 0) return '';
  if (bytes < 1024) return '${bytes.toInt()} B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

String _imageElement(dynamic url, String alt, String className) {
  final safe = safeImageUrl(url);
  if (safe.isEmpty) return '<div class="media-placeholder">图片未能导出</div>';
  return '<img class="$className" src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}">';
}

Map<String, dynamic>? _getFile(Map<String, dynamic> node, ExportFiles files) {
  final attrs = node['attrs'];
  final id = node['fileId'] ?? (attrs is Map ? attrs['fileId'] : null);
  return id != null ? files[id.toString()] : null;
}

/// 导出链接卡（原版 export.js renderLinkCard 逐项口径）：
/// 标题 = meta.title ‖ meta.name ‖ url ‖ 类型兜底；副标题不做 B 站抑制；
/// 来源行仅 meta.source 非空时出点+文；图标恒 🎵/🔗；封面用 meta.cover
/// 原地址（不走编辑器封面代理）。
String _renderLinkCard(Map<String, dynamic> node, bool isMusic) {
  final url = safeHttpUrl(node['url']?.toString() ?? '');
  final meta = node['meta'] is Map
      ? Map<String, dynamic>.from(node['meta'] as Map)
      : const <String, dynamic>{};
  final title = (meta['title']?.toString() ?? '').isNotEmpty
      ? meta['title'].toString()
      : (meta['name']?.toString() ?? '').isNotEmpty
      ? meta['name'].toString()
      : url.isNotEmpty
      ? url
      : (isMusic ? '音乐链接' : '网页链接');
  final subtitle = meta['subtitle']?.toString() ?? '';
  final source = meta['source']?.toString() ?? '';
  final cover = safeImageUrl(meta['cover']);
  final label = isMusic ? '🎵' : '🔗';
  final card = StringBuffer('<span class="lkc-card">');
  if (cover.isNotEmpty) {
    card.write(
      '<span class="lkc-cover">${_imageElement(cover, '', 'lkc-cover-image')}</span>',
    );
  }
  card.write(
    '<span class="lkc-body${cover.isNotEmpty ? ' has-cover' : ''}"><span class="lkc-title">${escapeHtml(title)}</span>',
  );
  if (subtitle.isNotEmpty)
    card.write('<span class="lkc-subtitle">${escapeHtml(subtitle)}</span>');
  card.write(
    '<span class="lkc-source"><span class="lkc-source-icon">$label</span>',
  );
  if (source.isNotEmpty) {
    card.write(
      '<span class="lkc-source-dot"></span><span class="lkc-source-text">${escapeHtml(source)}</span>',
    );
  }
  card.write('</span></span></span>');
  final inner = url.isNotEmpty
      ? '<a class="lkc-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">$card</a>'
      : card.toString();
  return '<div class="note-media note-link-card${isMusic ? ' note-music-card' : ''}">$inner</div>';
}

String renderBlock(
  Map<String, dynamic> node,
  ExportFiles files, {
  ExportFootnotes? footnotes,
}) {
  final text = _nodeText(node);
  final type = node['type']?.toString() ?? 'paragraph';
  final attrs = node['attrs'] is Map
      ? Map<String, dynamic>.from(node['attrs'] as Map)
      : const <String, dynamic>{};
  switch (type) {
    case 'paragraph':
      return '<div class="note-text note-paragraph">${renderMarkdownBlock(text, footnotes: footnotes)}</div>';
    case 'heading':
      final level = ((attrs['level'] as num?)?.toInt() ?? 2).clamp(1, 6);
      return '<div class="note-text note-heading"><h$level>${renderInline(text, footnotes: footnotes)}</h$level></div>';
    case 'quote':
      return '<div class="note-text"><blockquote>${escapeHtml(text).replaceAll('\n', '<br>')}</blockquote></div>';
    case 'todo':
      final checked = attrs['checked'] == true;
      return '<div class="note-text note-todo${checked ? ' is-checked' : ''}"><span class="todo-checkbox${checked ? ' is-checked' : ''}" aria-hidden="true">${checked ? '✓' : ''}</span><span class="todo-text">${escapeHtml(text).replaceAll('\n', '<br>')}</span></div>';
    case 'divider':
      return '<div class="note-text"><hr></div>';
    case 'decorative_divider':
      final label =
          attrs['text']?.toString() ??
          text.replaceAll(RegExp(r'^---|---$'), '').trim();
      return '<div class="note-text note-decorative-divider"><hr><span>${escapeHtml(label)}</span></div>';
    case 'imgTextCard':
      final file = _getFile(node, files);
      return '<figure class="note-media img-text-card">${_imageElement(file?['url'], file?['name']?.toString() ?? '图片', 'itc-image')}<figcaption class="itc-text">${text.isNotEmpty ? escapeHtml(text) : '<span class="muted">点击查看完整文本</span>'}</figcaption></figure>';
    case 'imageTextRow':
      final file = _getFile(node, files);
      return '<figure class="note-media img-text-row"><div class="itr-img">${_imageElement(file?['url'], file?['name']?.toString() ?? '图片', 'itr-image')}</div><figcaption class="itr-text">${text.isNotEmpty ? escapeHtml(text) : '<span class="muted">点击查看完整文本</span>'}</figcaption></figure>';
    case 'gallery':
      final items = _galleryItemsForHtml(node, files);
      final inner = items.isEmpty
          ? '<div class="media-placeholder">空画廊</div>'
          : items
                .asMap()
                .entries
                .map(
                  (e) => _imageElement(
                    e.value['url'],
                    e.value['name']?.toString() ?? '画廊图片 ${e.key + 1}',
                    'gallery-image',
                  ),
                )
                .join();
      return '<div class="note-media gallery-grid" aria-label="图片画廊">$inner</div>';
    case 'image':
      final file = _getFile(node, files);
      return '<figure class="note-media note-image">${_imageElement(file?['url'], file?['name']?.toString() ?? '图片', 'standalone-image')}</figure>';
    case 'attachment':
      final file = _getFile(node, files);
      final mime = file?['type']?.toString() ?? '';
      if (file != null && mime.startsWith('image/')) {
        return '<figure class="note-media note-attachment-image">${_imageElement(file['url'], file['name']?.toString() ?? '图片', 'standalone-image')}</figure>';
      }
      final filename = file?['name']?.toString() ?? '附件';
      final href = safeDownloadUrl(file?['url']);
      final sizeNum = (file?['size'] as num?) ?? 0;
      final meta = file != null && mime.isNotEmpty
          ? '<span class="attachment-meta">${escapeHtml(mime)}${sizeNum > 0 ? ' · ${_formatBytes(sizeNum)}' : ''}</span>'
          : '';
      final card =
          '<span class="attachment-icon">📎</span><span class="attachment-info"><span class="attachment-name">${escapeHtml(filename)}</span>$meta</span><span class="attachment-hint">下载附件</span>';
      final wrapped = href.isNotEmpty
          ? '<a href="${escapeHtml(href)}" download="${escapeHtml(filename)}">$card</a>'
          : '<span class="attachment-card-inner">$card</span>';
      return '<div class="note-media attachment-card">$wrapped</div>';
    case 'link-card':
      return _renderLinkCard(node, false);
    case 'musicCard':
      return _renderLinkCard(node, true);
    case 'code_block':
    case 'unordered_list':
    case 'ordered_list':
    case 'callout':
      return '<div class="note-text note-markdown">${renderMarkdownBlock(text, footnotes: footnotes)}</div>';
    default:
      return '<div class="note-text note-paragraph">${renderMarkdownBlock(text, footnotes: footnotes)}</div>';
  }
}

List<Map<String, dynamic>> _galleryItemsForHtml(
  Map<String, dynamic> node,
  ExportFiles files,
) {
  final attrs = node['attrs'];
  final items = attrs is Map && attrs['items'] is List
      ? attrs['items'] as List
      : const [];
  final out = <Map<String, dynamic>>[];
  for (final item in items) {
    if (item is String) {
      out.add(files[item] ?? {'url': item});
    } else if (item is Map) {
      final fid = item['fileId'];
      if (fid != null && files[fid.toString()] != null) {
        out.add(files[fid.toString()]!);
      } else {
        out.add(Map<String, dynamic>.from(item));
      }
    }
  }
  return out;
}

/// Web 导出的恐龙头像兜底（exportHeaderMarkup 的 dinosaurAvatarMarkup）。
String _dinosaurAvatarMarkup() {
  const paths = <String>[
    'M 90,460 L 90,170 C 90,110 140,70 210,70 L 380,95 C 440,95 470,130 470,185 C 470,225 450,240 410,245 C 350,250 280,230 210,265 C 190,275 190,295 210,310 C 270,350 350,380 410,360 C 435,350 440,325 410,315',
    'M 160,330 C 180,380 230,440 280,460',
    'M 240,365 C 220,400 240,440 310,460',
    'M 90,460 L 310,460',
    'M 415,135 C 425,140 435,150 435,160',
    'M 230,115 C 260,95 310,120 355,140',
    'M 255,140 C 255,170 290,195 320,185 C 345,175 350,150 335,135',
    'M 290,145 C 290,165 315,165 315,150',
    'M 250,243 L 255,265 L 265,243 M 275,245 L 282,270 L 292,245 M 302,246 L 310,273 L 320,247 M 330,248 L 340,275 L 350,248 M 360,249 L 370,274 L 380,248 M 390,248 L 400,270 L 408,246 M 415,244 L 425,263 L 432,240 M 438,235 L 448,252 L 452,228',
    'M 250,323 L 255,305 L 263,326 M 273,329 L 280,308 L 288,333 M 298,336 L 306,313 L 314,340 M 324,343 L 333,318 L 341,346 M 351,348 L 361,323 L 369,351 M 379,352 L 389,328 L 396,353 M 404,351 L 413,330 L 418,348',
  ];
  final svg = paths.map((d) => '<path d="$d"></path>').join();
  return '<span class="mynote-export-avatar-fallback" aria-hidden="true"><svg viewBox="0 0 512 512" width="60" height="60" fill="none" stroke="#AEAEB2" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" style="transform:translateY(10px)">$svg</svg></span>';
}

const _exportCss = '''
:root{color-scheme:light;--md-callout-note-bg:rgba(0,122,255,.07);--md-callout-warning-bg:rgba(255,149,0,.09);--md-callout-tip-bg:rgba(52,199,89,.09);--md-callout-important-bg:rgba(175,82,222,.08);--md-callout-caution-bg:rgba(224,67,58,.07);--md-callout-note-icon:#005bbb;--md-callout-warning-icon:#ad5f00;--md-callout-tip-icon:#1c7a34;--md-callout-important-icon:#8436aa;--md-callout-caution-icon:#b3261e}
@page{margin:16mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;color:#1A1A1A}
.mynote-export-shell{width:min(100%,1120px);margin:0 auto;padding:24px 16px 40px}
.mynote-export-header{position:relative;height:185px;margin:0 0 28px}
.mynote-export-control{position:absolute;top:7px;display:grid;place-items:center;width:46px;height:46px;border:.5px solid rgba(0,0,0,.14);border-radius:50%;background:rgba(255,255,255,.9);color:#8E8E93}
.mynote-export-back{left:16px}.mynote-export-more{right:16px}
.mynote-export-dock{position:absolute;top:7px;left:62px;right:62px;display:flex;flex-direction:column;align-items:center;gap:6px}
.mynote-export-avatar{width:72px;height:72px;overflow:hidden;border:.5px solid rgba(0,0,0,.14);border-radius:50%;background:rgba(255,255,255,.9);display:flex;align-items:flex-end;justify-content:center}
.mynote-export-avatar img{display:block;width:100%;height:100%;object-fit:cover}
.mynote-export-title-pill{display:flex;align-items:center;justify-content:center;min-width:66px;max-width:100%;height:66px;padding:0 20px;border:.5px solid rgba(0,0,0,.14);border-radius:33px;background:rgba(255,255,255,.9)}
.mynote-export-title-pill .note-title{margin:0;font:600 14px/1.3 -apple-system,sans-serif;letter-spacing:-.2px;text-align:center}
.mynote-export-meta{width:100%;color:#8E8E93;font-size:10px;text-align:center;white-space:nowrap}
.editor-body{font-size:16px;line-height:1.75;overflow-wrap:anywhere}
.note-text{margin:0 0 4px}
.note-heading h1{font-size:28px;line-height:1.2;letter-spacing:-.02em;border-bottom:1px solid rgba(0,0,0,.05);padding-bottom:.25em}
.note-heading h2{font-size:23px}.note-heading h3{font-size:20px}.note-heading h4{font-size:17px}
.note-heading h1,.note-heading h2,.note-heading h3,.note-heading h4,.note-heading h5,.note-heading h6{line-height:1.28;letter-spacing:-.02em;margin:.6em 0 .4em}
blockquote{margin:8px 0;padding:8px 12px;background:rgba(0,0,0,.025);border-left:3px solid rgba(0,91,187,.62);border-radius:8px}
.note-todo{display:flex;gap:10px;align-items:flex-start;min-height:44px}
.todo-checkbox{flex:none;width:20px;height:20px;margin-top:4px;border:1.5px solid rgba(0,0,0,.25);border-radius:6px;display:grid;place-items:center;font-size:13px;color:#fff}
.todo-checkbox.is-checked{background:#007AFF;border-color:#007AFF}
.note-todo.is-checked .todo-text{color:#8E8E93;text-decoration:line-through}
hr{border:none;border-top:1px solid rgba(0,0,0,.08);margin:14px 0}
table{border-collapse:collapse;margin:10px 0;font-size:14px}
th,td{border:1px solid rgba(0,0,0,.12);padding:6px 10px;text-align:left}
th{background:rgba(0,0,0,.04)}
mark{background:rgba(255,204,0,.25);padding:0 2px;border-radius:3px}
code{background:#F4F4F5;border-radius:6px;padding:1px 5px;font-size:.9em}
pre{background:#F4F4F5;border-radius:12px;padding:12px 14px;overflow:auto}
pre code{background:none;padding:0}
a{color:#005BBB}
.note-media{margin:10px 0}
.note-image img,.standalone-image{max-width:100%;border-radius:22px;display:block}
.gallery-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.gallery-grid img{width:100%;height:100%;object-fit:cover;border-radius:16px}
.img-text-card{background:rgba(255,255,255,.74);border:.5px solid rgba(0,0,0,.16);border-radius:22px;overflow:hidden;margin:10px 0}
.itc-image{width:100%;display:block}
.itc-text{padding:12px 14px;font-size:14px;line-height:1.7}
.img-text-row{display:flex;gap:10px;background:rgba(255,255,255,.74);border:.5px solid rgba(0,0,0,.16);border-radius:22px;overflow:hidden;margin:10px 0;min-height:181px}
.itr-img{flex:1}.itr-img img{width:100%;height:100%;object-fit:cover;display:block}
.itr-text{flex:1;padding:12px 14px;font-size:14px;line-height:1.7}
.lkc-card{display:flex;background:#fff;border:.5px solid rgba(0,0,0,.08);border-radius:32px;overflow:hidden;text-decoration:none;color:inherit}
.lkc-link{text-decoration:none;color:inherit}
.lkc-cover{flex:none;width:38%}.lkc-cover img{width:100%;height:100%;object-fit:cover;display:block}
.lkc-body{flex:1;padding:10px 14px 12px;display:flex;flex-direction:column}
.lkc-title{font-size:14px;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lkc-subtitle{font-size:12px;color:#8E8E93;line-height:1.3;margin-top:3px}
.lkc-source{font-size:11px;color:#8E8E93;margin-top:4px;display:flex;align-items:center;gap:4px}
.attachment-card{background:rgba(255,255,255,.74);border:.5px solid rgba(0,0,0,.16);border-radius:32px;padding:16px 20px}
.attachment-card a,.attachment-card-inner{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit}
.attachment-info{flex:1;display:flex;flex-direction:column}
.attachment-meta{font-size:12px;color:#8E8E93}
.attachment-hint{font-size:12px;color:#007AFF}
.media-placeholder{background:#F2F2F7;border-radius:16px;padding:20px;text-align:center;color:#8E8E93}
.muted{color:#8E8E93}
@media print{body{padding:0}.mynote-export-shell{width:100%;max-width:none;margin:0;padding:0}.mynote-export-header{break-inside:avoid}.note-title{break-after:avoid}}
.callout{border-radius:12px;padding:10px 14px;margin:8px 0}
.callout-note{background:var(--md-callout-note-bg)}.callout-warning{background:var(--md-callout-warning-bg)}.callout-tip{background:var(--md-callout-tip-bg)}.callout-important{background:var(--md-callout-important-bg)}.callout-caution{background:var(--md-callout-caution-bg)}
.callout-header{display:flex;align-items:center;gap:6px;font-weight:600}
.callout-icon{display:inline-flex}.callout-body{margin-top:4px}
summary.callout-header{cursor:pointer}
.footnotes{border-top:1px solid rgba(0,0,0,.08);margin-top:20px;padding-top:8px;font-size:13px}
.footnotes ol{margin:0;padding-left:20px}
.footnote-ref a{text-decoration:none}.footnote-backref{text-decoration:none;margin-left:4px}
.mynote-wiki-link{color:#005BBB;text-decoration:none;border-bottom:1px dashed rgba(0,91,187,.4)}
''';

/// 暗色导出覆盖（原版快照带当前主题）：底色/文字/玻璃面/代码块转暗。
const _exportCssDark = '''
:root{color-scheme:dark;--md-callout-note-bg:rgba(10,132,255,.18);--md-callout-warning-bg:rgba(255,159,10,.16);--md-callout-tip-bg:rgba(48,209,88,.16);--md-callout-important-bg:rgba(191,90,242,.16);--md-callout-caution-bg:rgba(255,69,58,.16);--md-callout-note-icon:#66aaff;--md-callout-warning-icon:#ffb340;--md-callout-tip-icon:#4cd97b;--md-callout-important-icon:#da8fff;--md-callout-caution-icon:#ff8a80}
body{background:#000;color:#F2F2F7}
.mynote-export-control,.mynote-export-avatar,.mynote-export-title-pill{background:rgba(28,28,30,.9);border-color:rgba(255,255,255,.14)}
.mynote-export-meta{color:#98989F}
blockquote{background:rgba(255,255,255,.05)}
code,pre{background:#1C1C1E}
th{background:rgba(255,255,255,.06)}th,td{border-color:rgba(255,255,255,.14)}
.lkc-card{background:#1C1C1E;border-color:rgba(255,255,255,.1)}
.lkc-subtitle,.lkc-source{color:#98989F}
.img-text-card,.img-text-row,.attachment-card{background:rgba(28,28,30,.74);border-color:rgba(255,255,255,.16)}
.attachment-meta{color:#98989F}
.media-placeholder{background:#1C1C1E;color:#98989F}
.muted{color:#98989F}
.footnotes{border-top-color:rgba(255,255,255,.12)}
a{color:#66A6FF}.mynote-wiki-link{color:#66A6FF;border-bottom-color:rgba(102,166,255,.4)}
''';

/// 暗色下笔记底色 RGB ×0.35（与编辑页 effectiveBgColor 同口径）。
String _dimHexForDark(String hex) {
  final h = hex.replaceFirst('#', '');
  if (h.length != 6) return hex;
  final v = int.tryParse(h, radix: 16);
  if (v == null) return hex;
  String ch(int c) => (c * 0.35).round().toRadixString(16).padLeft(2, '0');
  return '#${ch((v >> 16) & 0xFF)}${ch((v >> 8) & 0xFF)}${ch(v & 0xFF)}';
}

/// 组装独立 HTML 文档（对应 Web 的快照组装：页眉 + editor-body）。
String buildExportHtml(
  List<dynamic> doc,
  String title,
  ExportFiles files, {
  String subtitle = '',
  String? avatarUrl,
  String? bgColor,
  bool dark = false,
}) {
  // 脚注：先从各块正文剥离定义，再渲染（引用在渲染时编号），
  // 文末依次追加脚注节与未引用定义原文（原版顺序）
  final footnotes = ExportFootnotes();
  final cleaned = <Map<String, dynamic>>[];
  for (final node in doc) {
    if (node is! Map) continue;
    final n = Map<String, dynamic>.from(node);
    final children = n['children'];
    if (children is List && children.isNotEmpty && children.first is Map) {
      final first = Map<String, dynamic>.from(children.first as Map);
      final raw = first['text']?.toString() ?? '';
      final stripped = footnotes.stripDefinitions(raw);
      if (stripped != raw) {
        first['text'] = stripped;
        n['children'] = [first, ...children.skip(1)];
      }
    }
    cleaned.add(n);
  }
  final blocks = StringBuffer();
  for (final node in cleaned) {
    blocks.write(renderBlock(node, files, footnotes: footnotes));
  }
  final fnSection = footnotes.sectionHtml();
  if (fnSection.isNotEmpty) {
    blocks.write('<div class="note-text">$fnSection</div>');
  }
  for (final line in footnotes.unusedDefinitionLines()) {
    blocks.write(
      '<div class="note-text note-paragraph"><p>${escapeHtml(line)}</p></div>',
    );
  }
  final avatar = avatarUrl != null && safeImageUrl(avatarUrl).isNotEmpty
      ? '<img src="${escapeHtml(avatarUrl)}" alt="avatar">'
      : _dinosaurAvatarMarkup();
  final titleSize = title.length > 5 ? '11px' : '14px';
  var css = _exportCss;
  if (bgColor != null && bgColor.startsWith('#')) {
    css = css.replaceFirst(
      'body{margin:0;background:#F2F2F7;',
      'body{margin:0;background:${dark ? _dimHexForDark(bgColor) : bgColor};',
    );
  }
  if (dark) css = '$css\n$_exportCssDark';
  final html = StringBuffer()
    ..write(
      '<!DOCTYPE html>\n<html lang="zh-CN" data-export-theme="${dark ? 'dark' : 'light'}" style="color-scheme:${dark ? 'dark' : 'light'}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>$css</style>\n</head>\n<body>\n<div class="mynote-export-shell">\n',
    )
    ..write(
      '<header class="mynote-export-header" aria-label="笔记页眉" style="height:185px">'
      '<span class="mynote-export-control mynote-export-back" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></span>'
      '<div class="mynote-export-dock"><div class="mynote-export-avatar">$avatar</div>'
      '<div class="mynote-export-title-pill"><h1 class="note-title" style="font-size:$titleSize">${escapeHtml(title)}</h1></div>'
      '<div class="mynote-export-meta">${escapeHtml(subtitle)}</div></div>'
      '<span class="mynote-export-control mynote-export-more" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg></span>'
      '</header>\n',
    )
    ..write('<div class="editor-body">$blocks</div>\n</div>\n</body>\n</html>');
  final out = html.toString();
  Diag.log('EXPORT', 'html ${out.length} chars from ${doc.length} blocks');
  return out;
}
