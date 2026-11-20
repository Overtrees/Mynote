import 'dart:async';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// Web：隐藏 iframe 载入导出 HTML 后调其 print（用户在打印框里存 PDF）。
/// 原版打印前逐图等待（单图超时 2.5s）再延 120ms，避免 PDF 缺图；
/// 此前固定 350ms，慢图直接丢。
void printHtml(String htmlContent) {
  final iframe = (web.document.createElement('iframe') as web.HTMLIFrameElement)
    ..style.position = 'fixed'
    ..style.right = '0'
    ..style.bottom = '0'
    ..style.width = '0'
    ..style.height = '0'
    ..style.border = 'none';
  web.document.body!.append(iframe);
  iframe.srcdoc = htmlContent.toJS;
  iframe.onload = (web.Event _) {
    unawaited(_waitImagesThenPrint(iframe));
  }.toJS;
}

Future<void> _waitImagesThenPrint(web.HTMLIFrameElement iframe) async {
  try {
    final doc = iframe.contentWindow?.document;
    if (doc != null) {
      final imgs = doc.querySelectorAll('img');
      final waits = <Future<void>>[];
      for (var i = 0; i < imgs.length; i++) {
        final img = imgs.item(i) as web.HTMLImageElement;
        if (img.complete) continue;
        final completer = Completer<void>();
        img.onload = (web.Event _) {
          if (!completer.isCompleted) completer.complete();
        }.toJS;
        img.onerror = (web.Event _) {
          if (!completer.isCompleted) completer.complete();
        }.toJS;
        waits.add(
          Future.any([
            completer.future,
            Future.delayed(const Duration(milliseconds: 2500)),
          ]),
        );
      }
      await Future.wait(waits);
    }
  } catch (_) {
    // 跨源/结构异常时不阻塞打印
  }
  await Future.delayed(const Duration(milliseconds: 120));
  iframe.contentWindow?.print();
  Future.delayed(const Duration(seconds: 60), () => iframe.remove());
}
