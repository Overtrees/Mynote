// Google 授权（条件导入分发）：Web 走 GIS token client（与 Web 版同一
// client_id 与 scope），token 仅存内存；非 Web 端暂未接入。
export 'google_auth_stub.dart'
    if (dart.library.js_interop) 'google_auth_web.dart';
