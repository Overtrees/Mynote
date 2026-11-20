// 背景色面板：原版 components/BgSheet.js 逐项复刻——
// 玻璃 overlay 底部弹层、标题/副题、8 色 4 列网格（44 圆，选中 accent
// 2px 边 + 对勾）、已设色时出现「移除背景（恢复默认背景）」。

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../core/body_scroll.dart';
import '../../core/tokens.dart';
import '../../core/sheet_route.dart';

const bgPalette = <String>[
  '#eaeef2',
  '#e8e0d4',
  '#d4e8d0',
  '#d0e0e8',
  '#e8d0d4',
  '#fff3e0',
  '#e8e0f0',
  '#f0e8d0',
];

const bgColorNames = <String>['冷雾', '暖沙', '浅绿', '浅蓝', '浅粉', '米橙', '淡紫', '浅杏'];

/// 生效背景色：暗色模式下原版把所选底色 RGB ×0.35 压暗
/// （编辑页/反链区/HTML 导出共用此口径）。
Color? effectiveBgColor(String? hex, bool dark) {
  final c = parseHexColor(hex);
  if (c == null || !dark) return c;
  return Color.fromARGB(
    255,
    (c.r * 255 * 0.35).round(),
    (c.g * 255 * 0.35).round(),
    (c.b * 255 * 0.35).round(),
  );
}

Color? parseHexColor(String? hex) {
  if (hex == null) return null;
  final h = hex.replaceFirst('#', '');
  if (h.length != 6) return null;
  final v = int.tryParse(h, radix: 16);
  return v == null ? null : Color(0xFF000000 | v);
}

/// 弹出背景色面板；返回 ('select', hex) / ('remove', null) / null（关闭）。
Future<(String, String?)?> showBgSheet(
  BuildContext context, {
  required String? currentColor,
}) {
  return showMynoteSheet<(String, String?)>(
    context: context,
    // 原版 BgSheet.js 口径：外层下距 = 安全区 + 14，面板内下距 =
    // 20 + 安全区；安全区取生效值（引擎与宿主桥取大）——框架 SafeArea
    // 只读引擎值，嵌入 Web 恒 0，真机上不生效（2026-11-20 审计修正）。
    builder: (sheetContext) {
      final effBottom = effectiveInsets(
        MediaQuery.of(sheetContext).padding,
        hostInsets.value,
      ).bottom;
      return Padding(
        padding: EdgeInsets.fromLTRB(14, 0, 14, 14 + effBottom),
        child: Center(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(28),
            child: BackdropFilter(
              filter: MynoteTokens.overlayFilter,
              child: Container(
                constraints: const BoxConstraints(maxWidth: 600),
                decoration: BoxDecoration(
                  color: MynoteTokens.glassOverlayBg,
                  border: Border.all(
                    color: MynoteTokens.glassOverlayBorder,
                    width: 0.5,
                  ),
                  borderRadius: BorderRadius.circular(28),
                ),
                padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + effBottom),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '背景色',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.3,
                        color: MynoteTokens.textMain,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '为当前笔记设置底色',
                      style: TextStyle(
                        fontSize: 13,
                        color: MynoteTokens.textMain.withValues(
                          alpha: 0.7,
                        ), // 原版 text-main + opacity 0.7
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 16),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        // 原版两行总高 100：格高恒 44（此前方形格把面板撑到 ~274）
                        final cellW = (constraints.maxWidth - 36) / 4;
                        return GridView.count(
                          crossAxisCount: 4,
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          mainAxisSpacing: 12,
                          crossAxisSpacing: 12,
                          childAspectRatio: cellW / 44,
                          children: [
                            for (var i = 0; i < bgPalette.length; i++)
                              Center(
                                child: Semantics(
                                  label: bgColorNames[i],
                                  button: true,
                                  child: GestureDetector(
                                    onTap: () => Navigator.pop(sheetContext, (
                                      'select',
                                      bgPalette[i],
                                    )),
                                    child: Container(
                                      width: 44,
                                      height: 44,
                                      decoration: BoxDecoration(
                                        color: parseHexColor(bgPalette[i]),
                                        borderRadius: BorderRadius.circular(22),
                                        border: Border.all(
                                          color: currentColor == bgPalette[i]
                                              ? MynoteTokens.accent
                                              : const Color(0x1F000000),
                                          width: currentColor == bgPalette[i]
                                              ? 2
                                              : 0.5,
                                        ),
                                      ),
                                      child: currentColor == bgPalette[i]
                                          ? Center(
                                              child: SvgPicture.string(
                                                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.3 10 16.7 18.8 7.8"/></svg>',
                                                width: 20,
                                                height: 20,
                                              ),
                                            )
                                          : null,
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        );
                      },
                    ),
                    if (currentColor != null) ...[
                      const SizedBox(height: 4),
                      const Divider(height: 21, thickness: 0.5),
                      GestureDetector(
                        onTap: () =>
                            Navigator.pop(sheetContext, ('remove', null)),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Column(
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  SvgPicture.string(
                                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7.5h15M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M8.5 7.5l.4 10a1.5 1.5 0 0 0 1.5 1.4h3.2a1.5 1.5 0 0 0 1.5-1.4l.4-10M10.2 11v4.5M13.8 11v4.5"/></svg>',
                                    width: 20,
                                    height: 20,
                                  ),
                                  const SizedBox(width: 6),
                                  const Text(
                                    '移除背景',
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w700,
                                      letterSpacing: -0.1,
                                      color: Color(0xFFFF3B30),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '（恢复默认背景）',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: MynoteTokens.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}
