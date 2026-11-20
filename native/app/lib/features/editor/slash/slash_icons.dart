// 斜杠面板图标：原版 src/utils/svg.js 的 SvgPaths 注册表移植。
// 描边风格（viewBox 24、strokeWidth 1.9、round 端点/拐角、无填充），
// 面板内以主题蓝渲染（slash-panel.js 的 SvgIcon 用法）。
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/tokens.dart';

/// 命令 id → 图标名（commands.js 的 icon 字段；多数同名）。
const slashIconNames = <String, String>{
  'heading': 'heading',
  'heading2': 'heading2',
  'heading3': 'heading3',
  'paragraph': 'paragraph',
  'quote': 'quote',
  'todo': 'todo',
  'divider': 'divider',
  'bold': 'bold',
  'italic': 'italic',
  'highlight': 'highlight',
  'codeBlock': 'codeBlock',
  'unorderedList': 'list',
  'orderedList': 'olist',
  'callout': 'callout',
  'imgTextCard': 'imgTextCard',
  'imageTextRow': 'imageTextRow',
  'link': 'link',
  'code': 'code',
  'strikethrough': 'strikethrough',
  'musicCard': 'music',
  'image': 'image',
  'gallery': 'gallery',
};

/// 图标名 → path 段（原版以 | 分隔多段）。
const slashIconPaths = <String, List<String>>{
  'heading': ['M5 5v14', 'M19 5v14', 'M5 12h14', 'M5 19h8'],
  'heading2': ['M5 5v14', 'M19 5v14', 'M5 12h14', 'M7 19h10'],
  'heading3': ['M6 6v12', 'M18 6v12', 'M6 12h12'],
  'paragraph': ['M10 6h10', 'M4 10h16', 'M4 14h16', 'M4 18h8'],
  'quote': [
    'M6 17h5v-6H7v-1a2 2 0 0 1 2-2V6a5 5 0 0 0-5 5v6zm8 0h5v-6h-4v-1a2 2 0 0 1 2-2V6a5 5 0 0 0-5 5v6z',
  ],
  'todo': ['M5 5h14v14H5z', 'm8 12 3 3 5-6'],
  'divider': ['M3 12h18'],
  'bold': ['M7 4h6a4 4 0 0 1 0 8H7z', 'M7 12h7a4 4 0 0 1 0 8H7z'],
  'italic': ['M15 4H9', 'M15 4l-6 16', 'M15 20H9'],
  'highlight': ['M4 16 14 6l4 4L8 20H4z', 'M12 8l4 4', 'M3 21h14'],
  'codeBlock': ['M4 4h16v16H4z', 'm9 9-3 3 3 3', 'm15 9 3 3-3 3'],
  'list': [
    'M9 6h12',
    'M9 12h12',
    'M9 18h12',
    'M4 6h.01',
    'M4 12h.01',
    'M4 18h.01',
  ],
  'olist': [
    'M3 7h2V4H3m0 5h2',
    'M3 12h2v3H3m0 0 1.5-1.5',
    'M3 20h2v-3H3m0 0 1.5 1.5',
    'M9 5h12',
    'M9 12h12',
    'M9 19h12',
  ],
  'callout': ['M4 4h16v16H4z', 'M8 9h8', 'M8 13h6', 'M6 7v10'],
  'imgTextCard': ['M4 4h16v16H4z', 'M6 6h12v7H6z', 'M7 16h10'],
  'imageTextRow': ['M3 5h8v14H3z', 'M14 5h7v14h-7z', 'M5 9h4'],
  'link': [
    'M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7',
    'M14 11a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7',
  ],
  'code': ['m8 8-4 4 4 4', 'm16 8 4 4-4 4'],
  'strikethrough': [
    'M14 7a3 3 0 0 0-3-2H9a3 3 0 0 0-1 5.8',
    'M5 12h14',
    'M8 16a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3',
  ],
  'music': [
    'M8 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M17 17a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M10.5 16V5l9-2v11',
  ],
  'image': [
    'M4 5h16v14H4z',
    'M8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    'm4 16 5-5 3 3 3-4 5 6',
  ],
  'gallery': ['M5 7h15v14H5z', 'M4 17H3V3h15v2'],
};

class SlashSvgIcon extends StatelessWidget {
  const SlashSvgIcon({super.key, required this.commandId, this.size = 20});

  final String commandId;
  final double size;

  @override
  Widget build(BuildContext context) {
    final name = slashIconNames[commandId];
    final segments = name == null ? null : slashIconPaths[name];
    if (segments == null) {
      return SizedBox(width: size, height: size);
    }
    final color =
        '#${MynoteTokens.accent.value.toRadixString(16).padLeft(8, '0').substring(2)}';
    final paths = segments.map((d) => '<path d="$d"/>').join();
    final svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
        'fill="none" stroke="$color" stroke-width="1.9" '
        'stroke-linecap="round" stroke-linejoin="round">$paths</svg>';
    return SvgPicture.string(svg, width: size, height: size);
  }
}
