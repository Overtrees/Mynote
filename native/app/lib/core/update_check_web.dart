import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'diag.dart';
import 'update_check.dart' show updateAvailable;

String? _baseline;
bool _started = false;

/// Web：首查定基线（当前运行构建），其后每 20 分钟与页面回到
/// 可见时回查 version.json；构建号变化 → updateAvailable 置真。
void startUpdateChecker() {
  if (_started) return;
  _started = true;
  _check();
  Timer.periodic(const Duration(minutes: 20), (_) => _check());
  try {
    final document = globalContext.getProperty('document'.toJS) as JSObject;
    final cb = (JSObject _) {
      final hidden = document.getProperty('hidden'.toJS) as JSBoolean;
      if (!hidden.toDart) _check();
    }.toJS;
    document.callMethod('addEventListener'.toJS, 'visibilitychange'.toJS, cb);
  } catch (_) {}
}

Future<void> _check() async {
  try {
    final ts = DateTime.now().millisecondsSinceEpoch;
    final resp = await (globalContext.callMethod(
      'fetch'.toJS,
      'build_version.json?t=$ts'.toJS,
    ) as JSPromise).toDart;
    final respObj = resp as JSObject;
    final ok = (respObj.getProperty('ok'.toJS) as JSBoolean).toDart;
    if (!ok) return;
    final text = await (respObj.callMethod('text'.toJS) as JSPromise).toDart;
    final map = jsonDecode((text as JSString).toDart) as Map;
    final build = map['build']?.toString();
    if (build == null || build.isEmpty) return;
    if (_baseline == null) {
      _baseline = build;
      Diag.log('APP', 'version baseline $build');
    } else if (_baseline != build && !updateAvailable.value) {
      updateAvailable.value = true;
      Diag.log('APP', 'update available $_baseline -> $build');
    }
  } catch (_) {}
}
