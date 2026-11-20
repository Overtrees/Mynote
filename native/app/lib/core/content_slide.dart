import 'package:flutter/material.dart';

/// 全局路由观察者（main.dart 注册）：供 ContentSlideMixin 在
/// 「从上层页面返回」时重播内容入场动画——原版是视图替换状态机，
/// 目标页每次被切回都重新挂载并重播 slideInFromRight。
final RouteObserver<PageRoute<dynamic>> mynoteRouteObserver =
    RouteObserver<PageRoute<dynamic>>();

/// 页面转场曲线（原版 --motion-page-transition）。
const Cubic kMynoteSlideCurve = Cubic(0.22, 0.61, 0.36, 1);

/// 整页转场（页眉与内容整体滑动——2026-11-19 用户裁决：
/// 页眉也要动，不再用原版的页眉静止结构）：
/// - 入场：整页 slideInFromRight（280ms、opacity .94→1、右移 24→0）；
/// - 退场：整页先 slideOutToRight（280ms、opacity 1→.92、右移 0→16）
///   再 pop（路由本身零时长，见 mynoteStaticHeaderRoute）；
/// - 从上层页返回（didPopNext）：重播入场。
/// 使用方 State 需同时混入 RouteAware 与 TickerProviderStateMixin，
/// 且 RouteAware 在前、本 mixin 在后。
mixin ContentSlideMixin<T extends StatefulWidget>
    on State<T>, TickerProviderStateMixin<T> {
  late final AnimationController slideController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 280),
  );

  bool _slideExiting = false;
  bool get slideExiting => _slideExiting;

  @override
  void initState() {
    super.initState();
    // prefers-reduced-motion：时长归 0（与原版媒体查询一致）
    if (WidgetsBinding
        .instance
        .platformDispatcher
        .accessibilityFeatures
        .disableAnimations) {
      slideController.value = 1;
    } else {
      slideController.forward();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route is PageRoute) {
      mynoteRouteObserver.subscribe(this as RouteAware, route);
    }
  }

  @override
  void dispose() {
    mynoteRouteObserver.unsubscribe(this as RouteAware);
    slideController.dispose();
    super.dispose();
  }

  // ---- RouteAware（由使用方的 RouteAware 提供签名，此处覆写行为） ----
  void didPopNext() {
    _slideExiting = false;
    if (mounted) slideController.forward(from: 0);
  }

  void didPushNext() {}

  /// 把整页（页眉 + 内容）包进转场变换。
  Widget slideContent(Widget child) {
    return AnimatedBuilder(
      animation: slideController,
      builder: (context, inner) {
        final v = slideController.value;
        if (_slideExiting) {
          final p = kMynoteSlideCurve.transform(1 - v);
          return Opacity(
            opacity: 1 - 0.08 * p,
            child: Transform.translate(offset: Offset(16 * p, 0), child: inner),
          );
        }
        final t = kMynoteSlideCurve.transform(v);
        return Opacity(
          opacity: 0.94 + 0.06 * t,
          child: Transform.translate(
            offset: Offset(24 * (1 - t), 0),
            child: inner,
          ),
        );
      },
      child: child,
    );
  }

  /// 返回：内容先播退场再 pop（原版返回 fab 按下即退场，
  /// PageHeader 已改为 onPointerDown 触发，体感同步）。
  Future<void> popWithSlide() async {
    if (_slideExiting) return;
    _slideExiting = true;
    await slideController.animateBack(
      0,
      duration: const Duration(milliseconds: 280),
      curve: Curves.linear,
    );
    if (mounted) Navigator.of(context).pop();
  }
}
