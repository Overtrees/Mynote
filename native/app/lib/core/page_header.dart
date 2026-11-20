import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'tokens.dart';

/// 子页页眉（对照原版 editor-fab + page-title compact）：左返回毛玻璃圆钮
/// （46×46）+ 居中标题胶囊（glass-overlay、圆角 20、17px w600、padding 6/16）。
class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.title, this.onBack});

  final String title;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 7, 16, 4),
      child: Stack(
        alignment: Alignment.center,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Listener(
              behavior: HitTestBehavior.opaque,
              onPointerDown: (_) =>
                  (onBack ?? () => Navigator.of(context).pop())(),
              child: ClipOval(
                child: BackdropFilter(
                  filter: MynoteTokens.controlFilter,
                  child: Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: MynoteTokens.glassControlBg,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: MynoteTokens.glassControlBorder,
                        width: 0.5,
                      ),
                    ),
                    // 原版返回图标：SVG 折线 M15 18l-6-6 6-6、stroke 2.5
                    child: Center(
                      child: SvgPicture.string(
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
                        width: 22,
                        height: 22,
                        colorFilter: ColorFilter.mode(
                          MynoteTokens.textMain,
                          BlendMode.srcIn,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: BackdropFilter(
              filter: MynoteTokens.overlayFilter,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: MynoteTokens.glassOverlayBg,
                  border: Border.all(
                    color: MynoteTokens.glassOverlayBorder,
                    width: 0.5,
                  ),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.3,
                    color: MynoteTokens.textMain,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
