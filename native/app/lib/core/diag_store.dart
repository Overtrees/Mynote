// Diag 持久化存储（条件导入分发）
export 'diag_store_stub.dart'
    if (dart.library.js_interop) 'diag_store_web.dart';
