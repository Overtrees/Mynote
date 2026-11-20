import 'dart:js_interop';

/// Web 端：经 index.html 注入的 window.mynoteDiagLoad/Save 读写
/// localStorage（键 mynote_diag_v1）。页面崩溃/重载后日志仍在，
/// 设置页可读，Tree 也可经设备浏览器直接读取定位异常。
@JS('mynoteDiagLoad')
external JSString? _load();

@JS('mynoteDiagSave')
external void _save(JSString value);

String? diagLoad() => _load()?.toDart;

void diagSave(String json) {
  _save(json.toJS);
}
