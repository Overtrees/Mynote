// 列表预览摘要：原版 utils/preview.js summarizeMemoDoc 与
// editor.md.js stripMarkdownForPreview 的逐项移植（行=80 字，图卡=60 字）。
import 'dart:convert';

final _tagRe = RegExp(r'#[\u4e00-\u9fa5\w-]+');

/// 预览摘要：段落文字拼接 → 去 Markdown → 去标签 token → 截断；
/// 附带 #标签（去重、最多 3 个）与附件计数。
({String preview, List<String> tags, int attachCount}) summarizeMemoDoc(
  String docJson,
  int maxLen,
) {
  var preview = '无更多文本';
  var tags = <String>[];
  var attachCount = 0;
  try {
    final doc = jsonDecode(docJson);
    if (doc is! List) return (preview: preview, tags: tags, attachCount: 0);
    final paras = <String>[];
    for (final node in doc) {
      if (node is! Map) continue;
      if (node['type'] == 'paragraph') {
        final children = node['children'];
        if (children is List && children.isNotEmpty && children.first is Map) {
          final text = ((children.first as Map)['text']?.toString() ?? '')
              .trim();
          if (text.isNotEmpty) {
            paras.add(text);
            for (final m in _tagRe.allMatches(text)) {
              final tag = m.group(0)!;
              if (!tags.contains(tag)) tags.add(tag);
            }
          }
        }
      }
      if (node['type'] == 'attachment') attachCount++;
    }
    if (paras.isEmpty) {
      return (preview: preview, tags: tags, attachCount: attachCount);
    }
    tags = tags.take(3).toList();
    var stripped = stripMarkdownForPreview(paras.join(' '));
    stripped = stripped.replaceAll(_tagRe, '').trim();
    if (stripped.length > maxLen) stripped = stripped.substring(0, maxLen);
    preview = stripped.isNotEmpty
        ? stripped
        : (tags.isNotEmpty ? tags.first.replaceFirst('#', '') : '无更多文本');
    return (preview: preview, tags: tags, attachCount: attachCount);
  } catch (_) {
    return (preview: preview, tags: tags, attachCount: attachCount);
  }
}

/// 原版 stripMarkdownForPreview 的正则链移植（$..$ 数学式规则从简：
/// 内容含数字/运算符时才剥 $，与 looksLikeMathExpression 的常见情形一致）。
String stripMarkdownForPreview(String text) {
  var s = text;
  s = s.replaceAll(
    RegExp(r'^\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*$', multiLine: true),
    '',
  );
  s = s.replaceAllMapped(
    RegExp(r'\[\[([^\]|]+)\|([^\]]+)\]\]'),
    (m) => m.group(2)!,
  );
  s = s.replaceAllMapped(RegExp(r'\[\[([^\]]+)\]\]'), (m) => m.group(1)!);
  s = s.replaceAll(RegExp(r'\[\^([^\]]+)\]'), '');
  s = s.replaceAllMapped(RegExp(r'\$\$([\s\S]*?)\$\$'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'\^\(([^()\n]+)\)\^'), (m) => m.group(1)!);
  s = s.replaceAllMapped(
    RegExp(r'\^([A-Za-z0-9][A-Za-z0-9,+-]*)\^'),
    (m) => m.group(1)!,
  );
  s = s.replaceAllMapped(RegExp(r'~\(([^()\n]+)\)~'), (m) => m.group(1)!);
  s = s.replaceAllMapped(
    RegExp(r'(^|[^~])~([A-Za-z0-9][A-Za-z0-9,+-]*)~(?!~)'),
    (m) => '${m.group(1)}${m.group(2)}',
  );
  s = s.replaceAllMapped(RegExp(r'==([^=]+)=='), (m) => m.group(1)!);
  s = s.replaceAll(RegExp(r'```[\s\S]*?```'), ' 代码块 ');
  s = s.replaceAllMapped(RegExp(r'`([^`]+)`'), (m) => m.group(1)!);
  s = s.replaceAllMapped(
    RegExp(r'!\[([^\]]*)\]\(([^\)]+)\)'),
    (m) => m.group(1)!,
  );
  s = s.replaceAllMapped(
    RegExp(r'\[([^\]]+)\]\(([^\)]+)\)'),
    (m) => m.group(1)!,
  );
  s = s.replaceAllMapped(RegExp(r'(^|\n)#{1,6}\s+'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'(^|\n)>\s?'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'(^|\n)[-*+]\s+'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'(^|\n)\d+\.\s+'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'\*\*([^*]+)\*\*'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'__([^_]+)__'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'\*([^*]+)\*'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'_([^_]+)_'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'~~([^~]+)~~'), (m) => m.group(1)!);
  s = s.replaceAllMapped(RegExp(r'\$([^$\n]+)\$'), (m) {
    final v = m.group(1)!;
    return RegExp(r'[\d+\-*/=<>^]').hasMatch(v) ? v : m.group(0)!;
  });
  s = s.replaceAll(RegExp(r'\n+'), ' ');
  s = s.replaceAll(RegExp(r'\s+'), ' ');
  return s.trim();
}

/// 是否图片型笔记（分组用）：含 image/gallery/imgTextCard/imageTextRow
/// 块，或 image 标记为 true 的 attachment 块。
bool memoHasImage(String docJson) {
  try {
    final doc = jsonDecode(docJson);
    if (doc is! List) return false;
    for (final node in doc) {
      if (node is! Map) continue;
      final type = node['type'];
      if (type == 'image' ||
          type == 'gallery' ||
          type == 'imgTextCard' ||
          type == 'imageTextRow') {
        return true;
      }
      if (type == 'attachment' && node['image'] == true) return true;
    }
  } catch (_) {}
  return false;
}

/// ImageCard 封面来源：原版只取第一个 attachment 块的 fileId。
String? memoCoverFileId(String docJson) {
  try {
    final doc = jsonDecode(docJson);
    if (doc is! List) return null;
    for (final node in doc) {
      if (node is Map && node['type'] == 'attachment') {
        final fid = node['fileId']?.toString() ?? '';
        return fid.isEmpty ? null : fid;
      }
    }
  } catch (_) {}
  return null;
}

/// 收集一条笔记引用到的全部附件 fileId（删除清理用，移植
/// memo-list.js collectMemoFileIds）。
List<String> collectMemoFileIds(String docJson) {
  final ids = <String>[];
  void push(String? fid) {
    if (fid != null && fid.isNotEmpty && !ids.contains(fid)) ids.add(fid);
  }

  try {
    final doc = jsonDecode(docJson);
    if (doc is! List) return ids;
    for (final node in doc) {
      if (node is! Map) continue;
      if (node['type'] == 'attachment') {
        push(node['fileId']?.toString());
        continue;
      }
      final attrs = node['attrs'];
      if (attrs is Map) {
        push(attrs['fileId']?.toString());
        final items = attrs['items'];
        if (items is List) {
          for (final it in items) {
            if (it is Map) {
              push(it['fileId']?.toString());
            } else if (it is String &&
                RegExp(r'^[A-Za-z0-9_-]{1,256}$').hasMatch(it)) {
              push(it);
            }
          }
        }
      }
    }
  } catch (_) {}
  return ids;
}
