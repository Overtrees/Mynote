import 'package:flutter/material.dart';

import 'content_slide.dart';

/// 页面转场（原版 slideInFromRight / slideOutToRight 非对称）：
/// - 入场 280ms：opacity .94→1、右移 24→0，cubic-bezier(0.22,0.61,0.36,1)；
/// - 退场（独立动画，非入场反播）：opacity 1→.92、右移 0→16，
///   时长 [reverseMs]（普通页 280、编辑页 320——原版编辑器卸载延迟）；
/// - prefers-reduced-motion 时时长归 0。
/// 用于整页（含页眉）一起滑动的页面（编辑页）。
Route<T> mynotePageRoute<T>(
  BuildContext context,
  Widget page, {
  int reverseMs = 280,
}) {
  final noMotion = MediaQuery.of(context).disableAnimations;
  final duration = noMotion ? Duration.zero : const Duration(milliseconds: 280);
  return PageRouteBuilder<T>(
    transitionDuration: duration,
    reverseTransitionDuration: noMotion
        ? Duration.zero
        : Duration(milliseconds: reverseMs),
    pageBuilder: (context, animation, secondaryAnimation) => page,
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      return _AsymmetricSlide(animation: animation, child: child);
    },
  );
}

/// 静态页眉页面的路由：路由本身零时长、无变换——转场由页面内
/// ContentSlideMixin 驱动内容层（页眉静止），退场亦然。
Route<T> mynoteStaticHeaderRoute<T>(BuildContext context, Widget page) {
  return PageRouteBuilder<T>(
    transitionDuration: Duration.zero,
    reverseTransitionDuration: Duration.zero,
    pageBuilder: (context, animation, secondaryAnimation) => page,
    transitionsBuilder: (context, animation, secondaryAnimation, child) =>
        child,
  );
}

/// 入/退场非对称滑动：动画进入 reverse 后闩锁退场映射
/// （opacity 1→.92、右移 0→16），与原版 slideOutToRight 一致。
class _AsymmetricSlide extends StatefulWidget {
  const _AsymmetricSlide({required this.animation, required this.child});

  final Animation<double> animation;
  final Widget child;

  @override
  State<_AsymmetricSlide> createState() => _AsymmetricSlideState();
}

class _AsymmetricSlideState extends State<_AsymmetricSlide> {
  bool _reversing = false;

  @override
  void initState() {
    super.initState();
    widget.animation.addStatusListener(_onStatus);
  }

  @override
  void dispose() {
    widget.animation.removeStatusListener(_onStatus);
    super.dispose();
  }

  void _onStatus(AnimationStatus status) {
    if (status == AnimationStatus.reverse && !_reversing) {
      setState(() => _reversing = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.animation,
      builder: (context, child) {
        final v = widget.animation.value;
        if (_reversing) {
          final p = kMynoteSlideCurve.transform(1 - v);
          return Opacity(
            opacity: 1 - 0.08 * p,
            child: Transform.translate(offset: Offset(16 * p, 0), child: child),
          );
        }
        final t = kMynoteSlideCurve.transform(v);
        return Opacity(
          opacity: 0.94 + 0.06 * t,
          child: Transform.translate(
            offset: Offset(24 * (1 - t), 0),
            child: child,
          ),
        );
      },
      child: widget.child,
    );
  }
}
