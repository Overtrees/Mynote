/// 在新标签页打开 URL（Web 实现用 window.open；非 Web 平台为空操作）。
library;

export 'open_url_stub.dart' if (dart.library.js_interop) 'open_url_web.dart';
