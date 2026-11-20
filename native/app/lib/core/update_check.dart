import 'package:flutter/foundation.dart';

export 'update_check_stub.dart'
    if (dart.library.js_interop) 'update_check_web.dart';

/// D1 新版本检测：构建时在站点根写 version.json（构建号），运行时
/// 周期回查比对——Flutter Web 的 Service Worker 更新要等页面全关
/// 才生效，用户曾两次靠杀页面拿新版；检测到新构建时在列表页给
/// 「有新版本 · 点此刷新」浮标，一点即重载拿新版。
final updateAvailable = ValueNotifier<bool>(false);
