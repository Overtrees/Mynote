// Web 粘贴桥（条件导入分发）
export 'paste_bridge_stub.dart'
    if (dart.library.js_interop) 'paste_bridge_web.dart';
