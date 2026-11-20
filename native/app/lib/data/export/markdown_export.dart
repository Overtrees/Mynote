// 文档 → Markdown 导出引擎：原版 src/app/editor/export.js 的纯 Dart 移植
// （无依赖，可独立测试；附件以 data URL 嵌入，与 Web 的 file.url 语义一致）。
import '../../../core/diag.dart';

typedef ExportFiles = Map<String, Map<String, dynamic>>;

String _nodeText(Map<String, dynamic> node) {
  final children = node['children'];
  if (children is List && children.isNotEmpty && children.first is Map) {
    return (children.first as Map)['text']?.toString() ?? '';
  }
  return '';
}

String safeHttpUrl(dynamic value) {
  final url = value?.toString().trim() ?? '';
  return RegExp(r'^https?://', caseSensitive: false).hasMatch(url) ? url : '';
}

String safeImageUrl(dynamic value) {
  final url = value?.toString().trim() ?? '';
  if (RegExp(r'^https?://', caseSensitive: false).hasMatch(url)) return url;
  if (RegExp(
    r'^data:image/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$',
    caseSensitive: false,
  ).hasMatch(url)) {
    return url;
  }
  return '';
}

/// 附件下载地址：http(s) 或安全类型的 data URL（导出文件以 data URL 承载
/// 附件字节，与 Web 的 file.url 语义一致；safeHttpUrl 会把 data: 全部拒掉）。
String safeDownloadUrl(dynamic value) {
  final url = value?.toString().trim() ?? '';
  if (RegExp(r'^https?://', caseSensitive: false).hasMatch(url)) return url;
  // 白名单与原版 safeAttachmentUrl 逐项一致（pdf/msword/OOXML/纯文本/音视频；
  // 此前误含 image/* 且缺 OOXML，Word 附件会丢下载链接）
  if (RegExp(
    r'^data:(?:application/(?:pdf|msword|vnd\.openxmlformats-officedocument\.[a-z0-9.+-]+)|text/plain|audio/[a-z0-9.+-]+|video/[a-z0-9.+-]+);base64,[a-z0-9+/=]+$',
    caseSensitive: false,
  ).hasMatch(url)) {
    return url;
  }
  return '';
}

const _linkMetaApiBase = 'https://mynote.overtrees.workers.dev';

/// 封面代理（与编辑器组件的 proxyCoverUrl 同规则：QQ 封面升 800 + Worker /img）。
String proxyCoverUrl(dynamic cover) {
  var url = cover?.toString() ?? '';
  if (url.isEmpty) return '';
  if (url.contains('y.gtimg.cn/music/photo_new/T002R')) {
    url = url.replaceAll(RegExp(r'T002R\d+x\d+'), 'T002R800x800');
  }
  return '$_linkMetaApiBase/img?url=${Uri.encodeComponent(url)}';
}

/// 链接类型图标（原版 getTypeIcon）。
String linkTypeIcon(dynamic type, {bool isMusic = false}) {
  switch (type?.toString()) {
    case 'video':
      return '🎬';
    case 'music':
      return '🎵';
    case 'article':
      return '📰';
    default:
      return isMusic ? '🎵' : '🔗';
  }
}

String urlDomain(dynamic value) {
  final url = value?.toString() ?? '';
  try {
    return Uri.parse(url).host.replaceFirst('www.', '');
  } catch (_) {
    return '';
  }
}

String markdownAlt(dynamic value) {
  return (value?.toString() ?? '')
      .replaceAll(RegExp(r'[\r\n]+'), ' ')
      .replaceAllMapped(RegExp(r'[\\\[\]]'), (m) => '\\${m[0]}')
      .trim();
}

String markdownUrl(dynamic value) {
  return (value?.toString() ?? '')
      .replaceAll(RegExp(r'\s'), '%20')
      .replaceAllMapped(RegExp(r'[()<>]'), (m) => Uri.encodeComponent(m[0]!));
}

Map<String, dynamic>? _getFile(Map<String, dynamic> node, ExportFiles files) {
  final attrs = node['attrs'];
  final id = node['fileId'] ?? (attrs is Map ? attrs['fileId'] : null);
  return id != null ? files[id.toString()] : null;
}

String _imageMarkdown(Map<String, dynamic>? file, String? alt) {
  final url = safeImageUrl(file?['url']);
  if (url.isEmpty) return alt != null && alt.isNotEmpty ? '[图片：$alt]' : '[图片]';
  return '![${markdownAlt(alt ?? file?['name'] ?? '图片')}](${markdownUrl(url)})';
}

List<Map<String, dynamic>> _galleryItems(
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

String _markdownImageWithCaption(Map<String, dynamic>? file, String caption) {
  final image = _imageMarkdown(file, file?['name']?.toString() ?? '图片');
  final text = caption.trim();
  return text.isNotEmpty ? '$image\n\n说明：$text' : image;
}

String blockToMarkdown(Map<String, dynamic> node, ExportFiles files) {
  final text = _nodeText(node);
  final type = node['type']?.toString() ?? 'paragraph';
  final attrs = node['attrs'] is Map
      ? Map<String, dynamic>.from(node['attrs'] as Map)
      : const <String, dynamic>{};
  switch (type) {
    case 'paragraph':
    case 'code_block':
    case 'unordered_list':
    case 'ordered_list':
    case 'callout':
      return text;
    case 'heading':
      final level = (attrs['level'] as num?)?.toInt() ?? 2;
      final clamped = level < 1 ? 1 : (level > 6 ? 6 : level);
      return '${'#' * clamped} $text';
    case 'quote':
      return text.split('\n').map((line) => '> $line').join('\n');
    case 'todo':
      return '- [${attrs['checked'] == true ? 'x' : ' '}] $text';
    case 'divider':
      return '---';
    case 'decorative_divider':
      final t = attrs['text']?.toString();
      return t != null && t.isNotEmpty
          ? '---$t---'
          : (text.isNotEmpty ? text : '---');
    case 'image':
      final file = _getFile(node, files);
      return _imageMarkdown(file, file?['name']?.toString() ?? '图片');
    case 'imgTextCard':
    case 'imageTextRow':
      return _markdownImageWithCaption(_getFile(node, files), text);
    case 'gallery':
      return _galleryItems(
        node,
        files,
      ).map((f) => _imageMarkdown(f, f['name']?.toString() ?? '图片')).join('\n');
    case 'attachment':
      final file = _getFile(node, files);
      final mime = file?['type']?.toString() ?? '';
      if (file != null && mime.startsWith('image/')) {
        return _imageMarkdown(file, file['name']?.toString() ?? '图片');
      }
      return '📎 ${file?['name'] ?? '附件'}';
    case 'link-card':
    case 'musicCard':
      final link = safeHttpUrl(node['url']);
      if (link.isEmpty) return text;
      final meta = node['meta'];
      final label =
          (meta is Map ? (meta['title'] ?? meta['name']) : null)?.toString() ??
          link;
      final escaped = label.replaceAllMapped(
        RegExp(r'[\\\[\]]'),
        (m) => '\\${m[0]}',
      );
      return '[$escaped](${markdownUrl(link)})';
    default:
      return text;
  }
}

/// 对应 Web 的 toSemanticMarkdown：标题（转义后作一级标题）+ 块间空行。
String docToMarkdown(List<dynamic> doc, String title, ExportFiles files) {
  final blocks = <String>[];
  for (final node in doc) {
    if (node is Map) {
      final part = blockToMarkdown(Map<String, dynamic>.from(node), files);
      if (part.isNotEmpty) blocks.add(part);
    }
  }
  final heading = title.trim();
  if (heading.isNotEmpty) {
    final cleaned = heading.replaceAll(RegExp(r'[\r\n]+'), ' ');
    final escaped = cleaned.replaceAllMapped(
      RegExp(r'[\\`*_{}\[\]()#+.!|>~-]'),
      (m) => '\\${m[0]}',
    );
    blocks.insert(0, '# $escaped');
  }
  final out = '${blocks.join('\n\n').replaceAll(RegExp(r'\s+$'), '')}\n';
  Diag.log('EXPORT', 'markdown ${out.length} chars from ${doc.length} blocks');
  return out;
}
