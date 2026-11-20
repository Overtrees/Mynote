import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

export 'safe_area_bridge_stub.dart'
    if (dart.library.js_interop) 'safe_area_bridge_web.dart';

/// C 路线·实时安全区桥（已降级为仅诊断）：原设想用探针元素实时读
/// 浏览器 env() 真值覆盖 MediaQuery.padding。2026-11-19 用户实机
/// 日志证伪：应用内浏览器（WKWebView）里探针读数恒为 t=0 b=0
/// （该容器不向页面暴露 env 安全区），覆盖只会把引擎的正确值
/// 清零，故 [SafeAreaBridgeScope] 改为纯透传，安全区一律以引擎
/// MediaQuery 为准；探针保留只打日志，供后续诊断对照。
final safeAreaInsets = ValueNotifier<EdgeInsets?>(null);

/// 历史接口保留（main.dart 仍包裹本组件）：不再覆盖 MediaQuery，
/// 直接透传 child——见上方降级说明。
class SafeAreaBridgeScope extends StatelessWidget {
  const SafeAreaBridgeScope({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => child;
}
