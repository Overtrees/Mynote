import 'dart:typed_data';

/// 非 Web 平台：导出下载在 Phase 4（分享/文件保存）接入。
void downloadBytes(Uint8List bytes, String filename, {String? mime}) {}

/// 非 Web 平台：分享优先打开附件（Phase 4 接入），当前退化为下载（空实现）。
Future<void> shareOrDownloadBytes(
  Uint8List bytes,
  String filename, {
  String? mime,
}) async {}
