import 'package:flutter/material.dart';

import 'tokens.dart';

/// 恐龙头像（原版导出页眉同款线描 SVG 的 CustomPainter 移植）：
/// viewBox 512，描边 #AEAEB2（列表/编辑页头部为蓝灰 #8E9BB5 近似原版
/// 截图色；导出兜底用 #AEAEB2）。路径仅含绝对 M/L/C 指令。
class DinoAvatar extends StatelessWidget {
  const DinoAvatar({
    super.key,
    this.size = 56,
    this.strokeColor,
    this.background,
    this.glass = false,
    this.glyph = 60,
  });

  final double size;
  final Color? strokeColor;
  final Color? background;

  /// 玻璃圆底（列表页头部，原版 glass-control 圆 + 恐龙下沉对齐）。
  final bool glass;

  /// 字形边长（以 72 号按钮为基准）：编辑页头像 60、列表页头像 64。
  final double glyph;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: glass
            ? MynoteTokens.glassControlBg
            : (background ?? MynoteTokens.glassControlBg),
        shape: BoxShape.circle,
        border: Border.all(
          color: glass
              ? MynoteTokens.glassControlBorder
              : const Color(0x14000000),
          width: glass ? 0.5 : 1,
        ),
      ),
      child: ClipOval(
        child: CustomPaint(
          painter: _DinoPainter(strokeColor ?? MynoteTokens.iconMuted, glyph),
          size: Size(size, size),
        ),
      ),
    );
  }
}

const _dinoPaths = <String>[
  'M 90,460 L 90,170 C 90,110 140,70 210,70 L 380,95 C 440,95 470,130 470,185 C 470,225 450,240 410,245 C 350,250 280,230 210,265 C 190,275 190,295 210,310 C 270,350 350,380 410,360 C 435,350 440,325 410,315',
  'M 160,330 C 180,380 230,440 280,460',
  'M 240,365 C 220,400 240,440 310,460',
  'M 90,460 L 310,460',
  'M 415,135 C 425,140 435,150 435,160',
  'M 230,115 C 260,95 310,120 355,140',
  'M 255,140 C 255,170 290,195 320,185 C 345,175 350,150 335,135',
  'M 290,145 C 290,165 315,165 315,150',
  'M 250,243 L 255,265 L 265,243 M 275,245 L 282,270 L 292,245 M 302,246 L 310,273 L 320,247 M 330,248 L 340,275 L 350,248 M 360,249 L 370,274 L 380,248 M 390,248 L 400,270 L 408,246 M 415,244 L 425,263 L 432,240 M 438,235 L 448,252 L 452,228',
  'M 250,323 L 255,305 L 263,326 M 273,329 L 280,308 L 288,333 M 298,336 L 306,313 L 314,340 M 324,343 L 333,318 L 341,346 M 351,348 L 361,323 L 369,351 M 379,352 L 389,328 L 396,353 M 404,351 L 413,330 L 418,348',
];

class _DinoPainter extends CustomPainter {
  _DinoPainter(this.color, this.glyph);
  final Color color;
  final double glyph;

  @override
  void paint(Canvas canvas, Size size) {
    // 原版几何：SVG 元素为按钮的 glyph/72，底部对齐并 translateY(10/72)，
    // 字形下缘被圆裁切（头像按钮内的 svg 摆位）。
    final glyphPx = size.width * glyph / 72;
    final scale = glyphPx / 512;
    canvas.save();
    canvas.translate(
      (size.width - glyphPx) / 2,
      size.height - glyphPx + size.height * 10 / 72,
    );
    canvas.scale(scale, scale);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 22
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    for (final d in _dinoPaths) {
      canvas.drawPath(_parsePath(d), paint);
    }
    canvas.restore();
  }

  /// 极简绝对路径解析（M/L/C，可含隐式多段与子路径）。
  Path _parsePath(String d) {
    final tokens = RegExp(r'[MLC]|-?\d+(?:\.\d+)?')
        .allMatches(d)
        .map((m) => m.group(0)!)
        .toList();
    final path = Path();
    var i = 0;
    String? cmd;
    double x = 0, y = 0;
    double num() => double.parse(tokens[i++]);
    while (i < tokens.length) {
      final tk = tokens[i];
      if (tk == 'M' || tk == 'L' || tk == 'C') {
        cmd = tk;
        i++;
        continue;
      }
      switch (cmd) {
        case 'M':
          x = num();
          y = num();
          path.moveTo(x, y);
          cmd = 'L';
        case 'L':
          x = num();
          y = num();
          path.lineTo(x, y);
        case 'C':
          final x1 = num(), y1 = num(), x2 = num(), y2 = num();
          x = num();
          y = num();
          path.cubicTo(x1, y1, x2, y2, x, y);
        default:
          i++;
      }
    }
    return path;
  }

  @override
  bool shouldRepaint(_DinoPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.glyph != glyph;
}
