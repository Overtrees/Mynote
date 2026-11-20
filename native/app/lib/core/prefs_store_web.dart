import 'dart:js_interop';
import 'dart:js_interop_unsafe';

/// Web 端：localStorage（键名与 Web 版一致，如 sj_fontsize，跨版本延续）。
String? prefsGet(String key) {
  try {
    final storage = globalContext.getProperty('localStorage'.toJS) as JSObject?;
    final v = storage?.callMethod('getItem'.toJS, key.toJS) as JSString?;
    return v?.toDart;
  } catch (_) {
    return null;
  }
}

void prefsSet(String key, String value) {
  try {
    final storage = globalContext.getProperty('localStorage'.toJS) as JSObject?;
    storage?.callMethod('setItem'.toJS, key.toJS, value.toJS);
  } catch (_) {}
}

void prefsRemove(String key) {
  try {
    final storage = globalContext.getProperty('localStorage'.toJS) as JSObject?;
    storage?.callMethod('removeItem'.toJS, key.toJS);
  } catch (_) {}
}
