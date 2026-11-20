/// 刷新页面（崩溃兜底页的「刷新页面」按钮；非 Web 平台为空操作）。
export 'reload_page_stub.dart'
    if (dart.library.js_interop) 'reload_page_web.dart';
