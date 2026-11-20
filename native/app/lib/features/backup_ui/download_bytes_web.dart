import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

void downloadBytes(Uint8List bytes, String filename, {String? mime}) {
  final blob = web.Blob(
    [bytes.toJS].toJS,
    web.BlobPropertyBag(type: mime ?? 'application/octet-stream'),
  );
  final url = web.URL.createObjectURL(blob);
  (web.document.createElement('a') as web.HTMLAnchorElement)
    ..href = url
    ..download = filename
    ..click();
  web.URL.revokeObjectURL(url);
}

/// 原版 openAttachmentFile 语义：能分享先走系统分享面板
/// （navigator.canShare({files})），不支持/失败才退化为带真实
/// MIME 的下载。此前一律下载且 Blob 类型写死 application/zip。
Future<void> shareOrDownloadBytes(
  Uint8List bytes,
  String filename, {
  String? mime,
}) async {
  try {
    final fn =
        globalContext.getProperty('__mynoteShareFile'.toJS) as JSFunction?;
    if (fn != null) {
      final promise = fn.callAsFunction(
        null,
        filename.toJS,
        (mime ?? 'application/octet-stream').toJS,
        bytes.toJS,
      ) as JSPromise<JSString>;
      final result = (await promise.toDart).toDart;
      if (result == 'shared' || result == 'aborted') return;
    }
  } catch (_) {
    // 分享通道异常 → 落到下载
  }
  downloadBytes(bytes, filename, mime: mime);
}
