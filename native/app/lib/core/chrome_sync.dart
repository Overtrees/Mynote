/// Web 宿主底色同步（原版 base.css 模型）：原版 html/body 底色即页面
/// 底色，灵动岛/小白条/回弹区都由这一处底色漆满；新版 Web 的宿主
/// 底色在 index.html 是静态 CSS，只能跟随系统明暗，与应用内实际
/// 底色（编辑页自定义背景等）脱节时安全区就会露异色。本模块在 Web
/// 上把应用当前底色动态写回 html/body 与 theme-color，使宿主底色
/// 只有一个源头（应用令牌）；原生平台为空操作。
export 'chrome_sync_stub.dart'
    if (dart.library.js_interop) 'chrome_sync_web.dart';
