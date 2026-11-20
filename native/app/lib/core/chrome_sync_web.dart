import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/painting.dart';

import 'diag.dart';

/// Web：把应用当前底色写回 html/body background 与全部
/// theme-color meta —— iOS Safari/WKWebView 正是用这三处决定
/// 灵动岛周边、底部小白条区与回弹区的漆色（原版靠 body 底色
/// 统一承担，新版在此对齐同一模型）。
void syncChromeColor(Color color) {
  try {
    final hex =
        '#${(color.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
    final document = globalContext.getProperty('document'.toJS) as JSObject;
    final docEl = document.getProperty('documentElement'.toJS) as JSObject;
    final body = document.getProperty('body'.toJS) as JSObject;
    for (final el in [docEl, body]) {
      final style = el.getProperty('style'.toJS) as JSObject;
      style.setProperty('backgroundColor'.toJS, hex.toJS);
    }
    final metas = document.callMethod(
      'querySelectorAll'.toJS,
      'meta[name="theme-color"]'.toJS,
    ) as JSObject;
    final len = (metas.getProperty('length'.toJS) as JSNumber).toDartInt;
    for (var i = 0; i < len; i++) {
      final m = metas.callMethod('item'.toJS, i.toJS) as JSObject;
      m.setProperty('content'.toJS, hex.toJS);
    }
    Diag.log('APP', 'chrome sync $hex');
  } catch (_) {}
}
