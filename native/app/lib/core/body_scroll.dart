import 'package:flutter/widgets.dart';

export 'body_scroll_stub.dart'
    if (dart.library.js_interop) 'body_scroll_web.dart';

/// v3 滚动模型（元素嵌入 + body 滚动，原版同款）：
/// Web 外壳结构对齐原版：单一流内根 #root 由内容撑高（= 原版
/// #memo-list-root），画布 sticky 停靠视口顶部；页面滚动归 body；
/// 各页面内容是自然高度的一列，按 window.scrollY 平移，不设内部
/// 滚动面；内容总高由页面实测上报宿主设置根高，body 行程与内容
/// 高度严格一致。
/// 安全区：嵌入模式下引擎 MediaQuery.padding 恒为 0（官方已知，
/// PR #194020），真实值由宿主页 CSS env() 探针桥接（与原版一致，
/// 只认 env）。
/// 非 Web 平台全部为空实现，页面走原内部滚动。
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
