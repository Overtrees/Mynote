import 'dart:ui';

import 'package:flutter/material.dart';

/// 原版设计令牌（src/styles/tokens.css）的 Dart 落点。
/// 复刻基准见 ~/workspace/mynote-ui-spec.md；新 UI 先查令牌，不许凭感觉定值。
/// 深色值取自 tokens.css 的 prefers-color-scheme: dark 覆盖组；
/// 由根组件按平台亮度调用 [applyDark] 切换（字段非 const 以便运行时换值）。
abstract final class MynoteTokens {
  static bool dark = false;

  // 色板（浅色默认）
  static Color primaryBg = const Color(0xFFF2F2F7);
  static Color editorBg = const Color(0xFFFAFAFA);
  static Color cardBg = const Color(0xFFFFFFFF);
  static Color textMain = const Color(0xFF1A1A1A);
  static Color textSecondary = const Color(0xFF8E8E93);
  static Color textMuted = const Color(0xFF626267);
  static Color accent = const Color(0xFF007AFF);
  static Color accentStrong = const Color(0xFF0A84FF);
  static Color link = const Color(0xFF005BBB);
  static Color danger = const Color(0xFFE0433A);
  static Color warning = const Color(0xFFFF9500);
  static Color success = const Color(0xFF34C759);
  static Color placeholder = const Color(0xFFC7C7CC);
  static Color border = const Color(0x0D000000); // rgba(0,0,0,0.05)
  static Color codeBg = const Color(0xFFF4F4F5);
  static Color fillHover = const Color(0x0F7F7F7F); // rgba(127,127,127,0.06)
  static Color fillHoverStrong = const Color(0x1A7F7F7F); // 0.10
  static Color glassLabel = const Color(0xFF48494F);
  static Color quoteBg = const Color(0x06000000); // rgba(0,0,0,0.025)
  static Color quoteBorder = const Color(0x9E005BBB); // rgba(0,91,187,0.62)
  static Color checkboxChecked = const Color(0xFF0066CC);
  static Color checkboxBorder = const Color(0xFF73737A);
  static Color imagePlaceholder = const Color(0xFFE5E5EA);
  static Color iconMuted = const Color(0xFF8A9BB0);
  static Color skeleton = const Color(
    0x0D000000,
  ); // 与 border 同值（原版骨架用 --border-color）
  static Color btnBg = const Color(0xB2F0F0F2); // rgba(240,240,242,0.7)
  static Color fillSubtle = const Color(0x08000000); // rgba(0,0,0,0.03)
  static Color fillSubtle2 = const Color(0x05000000); // rgba(0,0,0,0.02)
  static Color placeholderStrong = const Color(0xFFC0C0C6);
  static Color dangerBright = const Color(0xFFFF3B30);
  static const Color fillAccent10 = Color(0x1A007AFF);
  static const Color fillAccent18 = Color(0x2E007AFF);
  static const Color fillAccent35 = Color(0x59007AFF);

  // 玻璃层（底色为支持模糊时的半透明值；不支持时端侧回退实色）
  static Color glassOverlayBg = const Color(
    0xD6FFFFFF,
  ); // rgba(255,255,255,0.84)
  static Color glassOverlayBorder = const Color(0x2E000000); // 0.18
  static Color glassContentBg = const Color(0xBDFFFFFF); // 0.74
  static Color glassContentBorder = const Color(0x29000000); // 0.16
  static Color glassControlBg = const Color(0xE6FFFFFF); // 0.9
  static Color glassControlBorder = const Color(0x33000000); // 0.2

  static const pagePaddingX = 20.0;

  /// 切换深/浅色令牌（值表对照 tokens.css 深色覆盖组）。
  static void applyDark(bool isDark) {
    dark = isDark;
    if (!isDark) {
      primaryBg = const Color(0xFFF2F2F7);
      editorBg = const Color(0xFFFAFAFA);
      cardBg = const Color(0xFFFFFFFF);
      textMain = const Color(0xFF1A1A1A);
      textSecondary = const Color(0xFF8E8E93);
      textMuted = const Color(0xFF626267);
      accent = const Color(0xFF007AFF);
      accentStrong = const Color(0xFF0A84FF);
      link = const Color(0xFF005BBB);
      danger = const Color(0xFFE0433A);
      warning = const Color(0xFFFF9500);
      success = const Color(0xFF34C759);
      placeholder = const Color(0xFFC7C7CC);
      border = const Color(0x0D000000);
      codeBg = const Color(0xFFF4F4F5);
      fillHover = const Color(0x0F7F7F7F);
      fillHoverStrong = const Color(0x1A7F7F7F);
      glassLabel = const Color(0xFF48494F);
      quoteBg = const Color(0x06000000);
      quoteBorder = const Color(0x9E005BBB);
      checkboxChecked = const Color(0xFF0066CC);
      checkboxBorder = const Color(0xFF73737A);
      imagePlaceholder = const Color(0xFFE5E5EA);
      iconMuted = const Color(0xFF8A9BB0);
      skeleton = const Color(0x0D000000);
      btnBg = const Color(0xB2F0F0F2);
      fillSubtle = const Color(0x08000000);
      fillSubtle2 = const Color(0x05000000);
      glassOverlayBg = const Color(0xD6FFFFFF);
      glassOverlayBorder = const Color(0x2E000000);
      glassContentBg = const Color(0xBDFFFFFF);
      glassContentBorder = const Color(0x29000000);
      glassControlBg = const Color(0xE6FFFFFF);
      glassControlBorder = const Color(0x33000000);
    } else {
      primaryBg = const Color(0xFF000000);
      editorBg = const Color(0xFF000000);
      cardBg = const Color(0xFF1C1C1E);
      textMain = const Color(0xFFFFFFFF);
      textSecondary = const Color(0xFF98989D);
      textMuted = const Color(0xFFB4B4B9);
      accent = const Color(0xFF007AFF); // 深色组未覆盖 --color-accent，两态同值
      accentStrong = const Color(0xFF0A84FF);
      link = const Color(0xFF72B7FF);
      danger = const Color(0xFFE0433A); // 同上，未覆盖
      warning = const Color(0xFFFF9500); // 同上
      success = const Color(0xFF34C759); // 同上
      placeholder = const Color(0xFFC7C7CC); // 同上
      border = const Color(0x1AFFFFFF); // rgba(255,255,255,0.1)
      codeBg = const Color(0xFF2C2C2E);
      fillHover = const Color(0x0F7F7F7F); // --fill-hover 深色未覆盖
      fillHoverStrong = const Color(0x1A7F7F7F);
      glassLabel = const Color(0xFFD1D1D6);
      quoteBg = const Color(0x0BFFFFFF); // rgba(255,255,255,0.045)
      quoteBorder = const Color(0xB872B7FF); // rgba(114,183,255,0.72)
      checkboxChecked = const Color(0xFF0A84FF);
      checkboxBorder = const Color(0xFFB5B5BB);
      imagePlaceholder = const Color(0xFF2C2C2E);
      iconMuted = const Color(0xFFE5E7EB);
      skeleton = const Color(0x1AFFFFFF);
      btnBg = const Color(0xB22C2C2E); // rgba(44,44,46,0.7)
      fillSubtle = const Color(0x0AFFFFFF); // rgba(255,255,255,0.04)
      fillSubtle2 = const Color(0x08FFFFFF); // rgba(255,255,255,0.03)
      glassOverlayBg = const Color(0xF01C1C1E); // rgba(28,28,30,0.94)
      glassOverlayBorder = const Color(0x33FFFFFF); // 0.2
      glassContentBg = const Color(0xDB202024); // rgba(32,32,36,0.86)
      glassContentBorder = const Color(0x29FFFFFF); // 0.16
      glassControlBg = const Color(0xF538383C); // rgba(56,56,60,0.96)
      glassControlBorder = const Color(0x3DFFFFFF); // 0.24
    }
  }

  /// saturate(s) 颜色矩阵（与 CSS filter: saturate 相同的亮度权重公式）
  static ColorFilter saturate(double s) {
    const r = 0.213, g = 0.715, b = 0.072;
    return ColorFilter.matrix(<double>[
      r + (1 - r) * s,
      g - g * s,
      b - b * s,
      0,
      0,
      r - r * s,
      g + (1 - g) * s,
      b - b * s,
      0,
      0,
      r - r * s,
      g - g * s,
      b + (1 - b) * s,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
    ]);
  }

  /// 三层玻璃滤镜（深色饱和度按 tokens.css 降档：1.35/1.35/1.25）
  static ImageFilter get overlayFilter => glassFilter(28, dark ? 1.35 : 1.8);
  static ImageFilter get contentFilter => glassFilter(24, dark ? 1.35 : 1.7);
  static ImageFilter get controlFilter => glassFilter(12, dark ? 1.25 : 1.5);

  /// 玻璃模糊 + 饱和（overlay 28/1.8、content 24/1.7、control 12/1.5）
  static ImageFilter glassFilter(double blur, double sat) {
    return ImageFilter.compose(
      outer: saturate(sat),
      inner: ImageFilter.blur(sigmaX: blur / 2, sigmaY: blur / 2),
    );
  }
}
