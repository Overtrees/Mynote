import 'package:flutter/widgets.dart';

export 'body_scroll_stub.dart'
    if (dart.library.js_interop) 'body_scroll_web.dart';

/// 滚动模型（2026-11-21 起全平台统一）：官方全页外壳 + 页面内部
/// 滚动。旧的元素嵌入 + body 滚动模型（宿主页 #root 撑高文档、
/// window.scrollY 泵送平移、env 探针桥接安全区）已退役——实测
/// WebKit 把画布图层裁在布局视口内，该模型在真机上始终留有实心
/// 色带；内部滚动是框架的标准形态。
/// 本文件保留 bodyScrollY / hostInsets 两个恒零的兼容定义与
/// effectiveInsets，各页面调用点无需改动：安全区一律取引擎
/// MediaQuery（全页外壳 + viewport-fit=cover 下即浏览器 env 真值），
/// host 侧恒零不再参与。各平台 bodyScrollSupported 均为 false，
/// BodyScrollColumn 走内部 ListView 路径（见 body_scroll_column.dart）。
final bodyScrollY = ValueNotifier<double>(0);

/// 宿主页桥接的安全区（env 实测），初始为零。
final hostInsets = ValueNotifier<EdgeInsets>(EdgeInsets.zero);

/// 生效安全区取值：引擎值与宿主桥逐边取大（任一为 0 时另一方生效）。
EdgeInsets effectiveInsets(EdgeInsets engine, EdgeInsets host) {
  return EdgeInsets.fromLTRB(
    engine.left > host.left ? engine.left : host.left,
    engine.top > host.top ? engine.top : host.top,
    engine.right > host.right ? engine.right : host.right,
    engine.bottom > host.bottom ? engine.bottom : host.bottom,
  );
}

/// 页面内容列 BodyScrollColumn 在 body_scroll_column.dart（编辑器页
/// 的正文列是同结构的专用实现，见 editor_page._buildBodySyncedEditor）。
