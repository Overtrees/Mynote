import 'package:flutter/material.dart';

import 'body_scroll.dart';
import 'tokens.dart';

/// 顶部安全区渐变 veil（原版 base.css body::before）：
/// 固定在屏幕最上方，高度 = 安全区上距 × 1.2，
/// 白（深色下黑）0.82 → 0.6 → 0 渐变，让滚动内容在状态栏区柔和淡出，
/// 而不是被硬裁。安全距为 0（桌面）时高度为 0 不可见，与原版
/// @supports 行为一致。
///
/// 安全距取生效值（引擎与宿主桥逐边取大）：嵌入 Web 下引擎恒 0，
/// 只读 MediaQuery 会让 veil 在真机上永不出现（2026-11-20 审计修正）。
///
/// 注意：本组件用在 Stack 里时必须恒返回 Positioned——若返回普通
/// SizedBox，Stack 会以它（0×0）定尺寸，整屏塌缩为空白。
class TopVeil extends StatelessWidget {
  const TopVeil({super.key});

  @override
  Widget build(BuildContext context) {
    final engine = MediaQuery.of(context).padding;
    final base = MynoteTokens.dark ? Colors.black : Colors.white;
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: ValueListenableBuilder<EdgeInsets>(
        valueListenable: hostInsets,
        builder: (context, host, _) {
          final safeTop = effectiveInsets(engine, host).top;
          return IgnorePointer(
            child: Container(
              height: safeTop * 1.2,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    base.withValues(alpha: 0.82),
                    base.withValues(alpha: 0.6),
                    base.withValues(alpha: 0),
                  ],
                  stops: const [0, 0.5, 1],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
