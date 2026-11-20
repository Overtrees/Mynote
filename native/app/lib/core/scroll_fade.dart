import 'package:flutter/material.dart';

import 'tokens.dart';

/// 滚动区顶部渐隐：内容滚向页眉边界时先淡出、再消失，
/// 消除硬切（原版靠 body::before 的 veil 让内容在页眉下柔和淡出；
/// 设置/备份/诊断页是 Column 布局、列表顶边即裁切线，故在列表
/// 顶部覆一层页面底色渐变）。静止时首行内容在列表顶内距之下，
/// 不受渐变影响；仅滚动经过时淡出。
class ScrollFadeTop extends StatelessWidget {
  const ScrollFadeTop({super.key, required this.child, this.extent = 30});

  final Widget child;
  final double extent;

  @override
  Widget build(BuildContext context) {
    final bg = MynoteTokens.primaryBg;
    return Stack(
      children: [
        child,
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          height: extent,
          child: IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [bg, bg.withValues(alpha: 0)],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// 滚动区底部渐隐：内容到达屏幕底边时先淡出再消失，消除硬切。
/// 调用方须保证滚动内容底部内距 ≥ [extent]，滚到尽头时
/// 最后一行内容停在渐变区之上、不被冲淡。
class ScrollFadeBottom extends StatelessWidget {
  const ScrollFadeBottom({
    super.key,
    required this.child,
    required this.color,
    this.extent = 30,
  });

  final Widget child;
  final Color color;
  final double extent;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          height: extent,
          child: IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [color.withValues(alpha: 0), color],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// 底部渐隐层（直接作为 Stack 子级使用，自身恒为 Positioned）。
class ScrollFadeBottomLayer extends StatelessWidget {
  const ScrollFadeBottomLayer({
    super.key,
    required this.color,
    this.extent = 30,
  });

  final Color color;
  final double extent;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      height: extent,
      child: IgnorePointer(
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [color.withValues(alpha: 0), color],
            ),
          ),
        ),
      ),
    );
  }
}
