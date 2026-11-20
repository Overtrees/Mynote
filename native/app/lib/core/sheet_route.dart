import 'package:flutter/material.dart';

/// 底部浮动弹层（原版 BgSheet/ImageTextSheet/backup modal 的动效模型）：
/// - 入场：**无动画**——首帧即终态（原版 transition 只作用于关闭态）；
/// - 退场：opacity 200ms ease 淡出 + 下沉 20px（250ms
///   cubic-bezier(0.34,1.56,0.64,1) 回弹曲线），220ms 卸载——即退场在
///   下沉进行到 88% 时结束；
/// - 遮罩透明、点遮罩关闭；**不支持拖拽关闭**（原版只有点遮罩关）。
/// 与框架 showModalBottomSheet 的全程滑入/滑出范式相反，故自写路由。
Future<T?> showMynoteSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
}) {
  return showGeneralDialog<T>(
    context: context,
    barrierDismissible: true,
    barrierLabel: '关闭',
    barrierColor: Colors.transparent,
    transitionDuration: const Duration(milliseconds: 220),
    pageBuilder: (context, animation, secondaryAnimation) =>
        Align(alignment: Alignment.bottomCenter, child: builder(context)),
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      return _SheetExitTransition(animation: animation, child: child);
    },
  );
}

/// 退场变换：动画进入 reverse 后闩锁，按原版关闭参数映射；
/// 正向（入场）恒等变换——首帧即终态。
class _SheetExitTransition extends StatefulWidget {
  const _SheetExitTransition({required this.animation, required this.child});

  final Animation<double> animation;
  final Widget child;

  @override
  State<_SheetExitTransition> createState() => _SheetExitTransitionState();
}

class _SheetExitTransitionState extends State<_SheetExitTransition> {
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
    if (!_reversing) return widget.child;
    return AnimatedBuilder(
      animation: widget.animation,
      builder: (context, child) {
        // 退场进度 p：0→1（动画值 1→0，窗口 220ms）
        final p = 1 - widget.animation.value;
        // opacity：200ms ease（占窗口 200/220）
        final opacityP = Curves.ease.transform((p * 220 / 200).clamp(0.0, 1.0));
        // 下沉：250ms 回弹曲线，卸载时进行到 220/250
        final sinkP = const Cubic(0.34, 1.56, 0.64, 1).transform(p * 220 / 250);
        return Opacity(
          opacity: 1 - opacityP,
          child: Transform.translate(
            offset: Offset(0, 20 * sinkP),
            child: child,
          ),
        );
      },
      child: widget.child,
    );
  }
}
