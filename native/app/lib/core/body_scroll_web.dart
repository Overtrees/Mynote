import 'diag.dart';

/// Web（官方全页外壳）：与非 Web 平台一致，页面走内部滚动——
/// 不再桥接宿主 body 滚动与 env 安全区探针（旧元素嵌入模型已退役，
/// 2026-11-21 迁移）。bodyScrollY / hostInsets 保留恒零定义，
/// effectiveInsets 自然退化为引擎 MediaQuery 值（全页外壳下引擎
/// 读数即浏览器 env 真值）。
bool get bodyScrollSupported => false;

bool _inited = false;

void initBodyScroll() {
  if (_inited) return;
  _inited = true;
  // 滚动模型标记：实机 Diag 里据此核对线上跑的是内部滚动构建
  Diag.log('APP', 'scroll model: official (internal scroll, stock shell)');
}

/// 宿主桥已退役：内容高度不再需要上报（无宿主根高概念）。
void reportContentHeight(double height) {}

/// 宿主桥已退役：窗口滚动不存在，页面内滚动由各自控制器承担。
void scrollWindowTo(double y) {}
