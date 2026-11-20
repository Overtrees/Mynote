import 'dart:convert';
import 'dart:typed_data';

import '../../core/diag.dart';
import '../../features/list/memo_grouping.dart';
import '../backup/attachment_store.dart';
import '../db/database.dart';
import 'markdown_export.dart';

/// 导出文件名（对应 Web toFilename）：非法字符替 _，去尾点/空格，≤80 字。
String toExportFilename(String title, String ext) {
  var base = title
      .trim()
      .replaceAll(RegExp(r'[\\/:*?"<>|\u0000-\u001f]'), '_')
      .replaceAll(RegExp(r'[. ]+$'), '');
  if (base.length > 80) base = base.substring(0, 80);
  if (base.isEmpty) base = '笔记';
  return '$base.${ext.replaceFirst(RegExp(r'^\.'), '')}';
}

/// 收集文档引用的附件，组装导出用 files 表：字节经存储读出转 data URL
/// （与 Web 的 file.url = data URL 语义一致）。
Future<ExportFiles> buildExportFiles(
  MynoteDatabase db,
  AttachmentStore store,
  List<dynamic> docJson,
) async {
  final ids = <String>{};
  void collect(dynamic node) {
    if (node is! Map) return;
    final attrs = node['attrs'];
    final fid = node['fileId'] ?? (attrs is Map ? attrs['fileId'] : null);
    if (fid != null) ids.add(fid.toString());
    if (attrs is Map && attrs['items'] is List) {
      for (final item in attrs['items'] as List) {
        if (item is String) ids.add(item);
        if (item is Map && item['fileId'] != null)
          ids.add(item['fileId'].toString());
      }
    }
    final children = node['children'];
    if (children is List) {
      for (final c in children) {
        if (c is Map && c.containsKey('type')) collect(c);
      }
    }
  }

  for (final node in docJson) {
    collect(node);
  }

  final files = <String, Map<String, dynamic>>{};
  for (final id in ids) {
    final row = await (db.select(
      db.attachments,
    )..where((t) => t.id.equals(id))).getSingleOrNull();
    final bytes = await store.read(id);
    final mime = row?.mime ?? 'application/octet-stream';
    files[id] = {
      'name': row?.name ?? '',
      'type': mime,
      'size': row?.size ?? bytes?.length ?? 0,
      'url': bytes != null ? 'data:$mime;base64,${base64Encode(bytes)}' : '',
    };
  }
  Diag.log('EXPORT', 'files prepared ${files.length}/${ids.length}');
  return files;
}

/// 段落字数（Web exportSubtitle 的口径：paragraph 文本去 \n 后长度之和）。
int exportCharCount(List<dynamic> docJson) {
  var count = 0;
  for (final node in docJson) {
    if (node is Map && node['type'] == 'paragraph') {
      final children = node['children'];
      if (children is List && children.isNotEmpty && children.first is Map) {
        count +=
            (children.first as Map)['text']
                ?.toString()
                .replaceAll('\n', '')
                .length ??
            0;
      }
    }
  }
  return count;
}

/// 相对时间（Web timeAgo 的常用桶位近似）。
/// 导出副标题时间：与原版 editor.js:1354 同一 timeAgo（日历式），
/// 此前自创相对桶位（刚刚/N分钟前）与原版全面不一致，已改为复用 listTimeAgo。
String exportTimeAgo(int updatedAtMs, {int? nowMs, bool use24h = false}) {
  final now = DateTime.fromMillisecondsSinceEpoch(
    nowMs ?? DateTime.now().millisecondsSinceEpoch,
  );
  return listTimeAgo(
    DateTime.fromMillisecondsSinceEpoch(updatedAtMs),
    now,
    use24h: use24h,
  );
}

Uint8List utf8Bytes(String s) => Uint8List.fromList(utf8.encode(s));
