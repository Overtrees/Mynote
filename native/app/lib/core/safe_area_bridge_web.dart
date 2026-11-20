import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/painting.dart';

import 'diag.dart';
import 'safe_area_bridge.dart' show safeAreaInsets;

JSObject? _probe;
Timer? _debounce;
bool _started = false;

/// Web：探针元素以 env(safe-area-inset-*) 为 padding，
/// getComputedStyle 读回的即浏览器当前真值（与原版 body CSS
/// 同源）；visualViewport/窗口 resize、转屏时防抖重读并推送。
void startSafeAreaBridge() {
  if (_started) return;
  _started = true;
  try {
    final document = globalContext.getProperty('document'.toJS) as JSObject;
    final body = document.getProperty('body'.toJS) as JSObject;
    final probe =
        document.callMethod('createElement'.toJS, 'div'.toJS) as JSObject;
    final style = probe.getProperty('style'.toJS) as JSObject;
    style.setProperty(
      'cssText'.toJS,
      ('position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;'
              'pointer-events:none;'
              'padding: env(safe-area-inset-top) env(safe-area-inset-right) '
              'env(safe-area-inset-bottom) env(safe-area-inset-left);')
          .toJS,
    );
    body.callMethod('appendChild'.toJS, probe);
    _probe = probe;

    final onEvent = (JSObject _) {
      _debounce?.cancel();
      _debounce = Timer(const Duration(milliseconds: 80), _read);
    }.toJS;
    final window = globalContext.getProperty('window'.toJS) as JSObject;
    window.callMethod('addEventListener'.toJS, 'resize'.toJS, onEvent);
    window.callMethod(
      'addEventListener'.toJS,
      'orientationchange'.toJS,
      onEvent,
    );
    final vv = window.getProperty('visualViewport'.toJS);
    if (vv is JSObject) {
      vv.callMethod('addEventListener'.toJS, 'resize'.toJS, onEvent);
    }
    _read();
    // 首屏布局/浏览器 chrome 常在加载后数百毫秒才稳定，补两次重读
    Timer(const Duration(milliseconds: 400), _read);
    Timer(const Duration(milliseconds: 1500), _read);
  } catch (e) {
    Diag.error('APP', 'safe bridge start failed: $e');
  }
}

void _read() {
  final probe = _probe;
  if (probe == null) return;
  try {
    final cs =
        globalContext.callMethod('getComputedStyle'.toJS, probe) as JSObject;
    double val(String name) {
      final raw = cs.callMethod('getPropertyValue'.toJS, name.toJS);
      final text = raw is JSString ? raw.toDart : '';
      return double.tryParse(text.replaceAll('px', '').trim()) ?? 0;
    }

    final next = EdgeInsets.only(
      top: val('padding-top'),
      right: val('padding-right'),
      bottom: val('padding-bottom'),
      left: val('padding-left'),
    );
    if (next != safeAreaInsets.value) {
      safeAreaInsets.value = next;
      Diag.log(
        'APP',
        'safe bridge t=${next.top} b=${next.bottom} l=${next.left} r=${next.right}',
      );
    }
  } catch (_) {}
}
