import 'package:flutter/widgets.dart';

import 'body_scroll.dart';

/// 页面内容列：全平台统一走内部滚动（懒构建 + 大预建区混合方案，fallbackController
/// 即页面自己的滚动控制器）。下方按 bodyScrollY 平移的分支是旧
/// body 滚动模型的遗留实现，现无任何平台启用（bodyScrollSupported
/// 恒 false），保留仅作历史参照。
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

  /// 内部滚动的控制器（页面可据此读内部偏移）。
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
        // 混合滚动（原型手感 + 大批量根治）：物理与官方原型
        // 一致（回弹 + 内容不足一屏也可拖动）；懒构建打底，
        // 内存不随条目总数涨；预建区 2000 让卡片在进入屏幕
        // 前就建好，滚动只剩平移合成（子项由 ListView 默认
        // 逐个包 RepaintBoundary 独立成层）。
        physics: const BouncingScrollPhysics(
          parent: AlwaysScrollableScrollPhysics(),
        ),
        cacheExtent: 2000,
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
