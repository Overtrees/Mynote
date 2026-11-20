import 'package:flutter/widgets.dart';

import 'body_scroll.dart';

/// 结构对齐原版的页面内容列：内容是自然高度的一列（与原版文档流
/// 同构），不设内部滚动面。Web（body 滚动）时本列按 bodyScrollY
/// 平移，并把实测总高上报宿主撑起根高；非 Web 时退化为普通
/// ListView 内部滚动（原生/测试环境）。
class BodyScrollColumn extends StatefulWidget {
  const BodyScrollColumn({
    super.key,
    required this.children,
    this.padding,
    this.crossAxisAlignment = CrossAxisAlignment.stretch,
    this.fallbackController,
  });

  final List<Widget> children;
  final EdgeInsetsGeometry? padding;
  final CrossAxisAlignment crossAxisAlignment;

  /// 非 Web 回退 ListView 的控制器（页面可据此读内部偏移）。
  final ScrollController? fallbackController;

  static _BodyScrollColumnState? _active;

  /// 路由重新露出（didPopNext）时调用：当前页的列重报一次总高
  /// （此刻根高还是上一页的）。
  static void reportActiveHeight() => _active?._report();

  @override
  State<BodyScrollColumn> createState() => _BodyScrollColumnState();
}

class _BodyScrollColumnState extends State<BodyScrollColumn> {
  final GlobalKey _colKey = GlobalKey();
  double _reported = -1;

  void _report() {
    if (!bodyScrollSupported) return;
    final h = _colKey.currentContext?.size?.height ?? 0;
    if (h > 0 && (h - _reported).abs() > 0.5) {
      _reported = h;
      reportContentHeight(h);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!bodyScrollSupported) {
      return ListView(
        controller: widget.fallbackController,
        padding: widget.padding,
        children: widget.children,
      );
    }
    BodyScrollColumn._active = this;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _report();
    });
    Widget col = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: widget.crossAxisAlignment,
      children: widget.children,
    );
    if (widget.padding != null) {
      col = Padding(padding: widget.padding!, child: col);
    }
    return ClipRect(
      child: OverflowBox(
        alignment: Alignment.topCenter,
        maxHeight: double.infinity,
        child: ValueListenableBuilder<double>(
          valueListenable: bodyScrollY,
          builder: (context, y, child) =>
              Transform.translate(offset: Offset(0, -y), child: child),
          child: SizedBox(key: _colKey, child: col),
        ),
      ),
    );
  }
}
