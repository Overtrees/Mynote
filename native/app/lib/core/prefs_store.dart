// 应用偏好（条件导入分发）：字号等设置项的持久化。
export 'prefs_store_stub.dart'
    if (dart.library.js_interop) 'prefs_store_web.dart';
