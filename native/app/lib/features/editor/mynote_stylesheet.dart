// 编辑器样式表：按原版 editor.css / tokens.css 复刻排版（见 mynote-ui-spec.md）。
// 在 defaultStylesheet 之后追加规则：textStyle 整体替换、CascadingPadding
// 按边覆盖（applyOnTopOf 语义），故只写需要改的键。
import 'package:flutter/material.dart';
import 'package:super_editor/super_editor.dart';

import '../../core/tokens.dart';
import '../../data/convert/inline_marks.dart';

TextStyle _baseTextStyle(double scale) => TextStyle(
  color: MynoteTokens.textMain,
  fontSize: 16 * scale,
  height: 1.75,
  fontFamilyFallback: const ['NotoSansSC'],
);

TextStyle _headerStyle(double size, double height, double letterSpacing) {
  return TextStyle(
    color: MynoteTokens.textMain,
    fontSize: size,
    fontWeight: FontWeight.w700, // 原版 750，静态字重以 w700 近似
    height: height,
    letterSpacing: letterSpacing,
    fontFamilyFallback: const ['NotoSansSC'],
  );
}

/// 行内样式：在默认 styler 之上补原版规格——行内代码（#F4F4F5 底 +
/// 等宽）、链接色 #005BBB（默认 lightBlue 不符）。高亮由
/// BackgroundColorAttribution 走默认构建器（底色即高亮黄）。
TextStyle mynoteInlineTextStyler(
  Set<Attribution> attributions,
  TextStyle existingStyle,
) {
  var style = defaultInlineTextStyler(attributions, existingStyle);
  // 高亮：原版字重 600（底色由 BackgroundColorAttribution 默认构建）
  if (attributions.any((a) => a is BackgroundColorAttribution)) {
    style = style.copyWith(fontWeight: FontWeight.w600);
  }
  if (attributions.contains(codeAttribution)) {
    style = style.copyWith(
      backgroundColor: MynoteTokens.codeBg,
      fontFamily: 'monospace',
      fontFamilyFallback: const ['NotoSansSC'],
    );
  }
  if (attributions.any((a) => a is LinkAttribution)) {
    style = style.copyWith(color: MynoteTokens.link);
  }
  // Wiki 链接：链接色 + 虚线下划线（原版 .mynote-wiki-link）
  if (attributions.any((a) => a is WikiLinkAttribution)) {
    style = style.copyWith(
      color: MynoteTokens.link,
      decoration: TextDecoration.underline,
      decorationStyle: TextDecorationStyle.dashed,
      decorationColor: MynoteTokens.link,
    );
  }
  // 数学公式：KaTeX 式衬线观感（行内斜体衬线；显示式整段由
  // stylesheet 规则居中，字号在此放大）。真排版待占位符管线批次。
  for (final a in attributions) {
    if (a is MathAttribution) {
      style = style.copyWith(
        fontFamily: 'Georgia',
        fontFamilyFallback: const ['Times New Roman', 'NotoSansSC'],
        fontStyle: a.display ? FontStyle.normal : FontStyle.italic,
        fontSize: a.display
            ? (existingStyle.fontSize ?? 16) * 1.21
            : existingStyle.fontSize,
      );
    }
  }
  // 脚注引用：上标 + 链接色
  if (attributions.any((a) => a is FootnoteAttribution)) {
    style = style.copyWith(
      color: MynoteTokens.link,
      fontFeatures: const [FontFeature.superscripts()],
    );
  }
  return style;
}

Stylesheet mynoteStylesheet({
  double scale = 1,
  double topInset = 0,
  double bottomInset = 0,
  double textPadH = 16,
}) {
  return defaultStylesheet.copyWith(
    inlineTextStyler: mynoteInlineTextStyler,
    addRulesAfter: [
      StyleRule(
        BlockSelector.all,
        (doc, node) => {
          Styles.padding: const CascadingPadding.symmetric(horizontal: 16),
          Styles.textStyle: _baseTextStyle(scale),
        },
      ),
      // 标题：字重 750→w700、行高 H1 1.2 其余 1.28、字距 -0.02em、上距 1.25em
      StyleRule(
        const BlockSelector('header1'),
        (doc, node) => {
          Styles.padding: const CascadingPadding.only(top: 35),
          Styles.textStyle: _headerStyle(28 * scale, 1.2, -0.56 * scale),
        },
      ),
      StyleRule(
        const BlockSelector('header2'),
        (doc, node) => {
          Styles.padding: const CascadingPadding.only(top: 29),
          Styles.textStyle: _headerStyle(23 * scale, 1.28, -0.46 * scale),
        },
      ),
      StyleRule(
        const BlockSelector('header3'),
        (doc, node) => {
          Styles.padding: const CascadingPadding.only(top: 25),
          Styles.textStyle: _headerStyle(20 * scale, 1.28, -0.4 * scale),
        },
      ),
      StyleRule(
        const BlockSelector('header4'),
        (doc, node) => {
          Styles.padding: const CascadingPadding.only(top: 21),
          Styles.textStyle: _headerStyle(17 * scale, 1.28, -0.34 * scale),
        },
      ),
      StyleRule(
        const BlockSelector('header5'),
        (doc, node) => {
          Styles.padding: const CascadingPadding.only(top: 22),
          Styles.textStyle: _headerStyle(13 * scale, 1.28, 0),
        },
      ),
      StyleRule(
        const BlockSelector('header6'),
        (doc, node) => {
          Styles.padding: const CascadingPadding.only(top: 25),
          Styles.textStyle: _headerStyle(11 * scale, 1.28, 0),
        },
      ),
      // 段落间距收紧到接近 Web 的连续排版（SE 默认 top 24 过空）；
      // 代码围栏段（``` 开头）用等宽字体（原版代码块渲染的编辑器内等价）
      StyleRule(
        const BlockSelector('paragraph'),
        (doc, node) => {
          Styles.padding: const CascadingPadding.only(top: 10),
          if (node is ParagraphNode &&
              node.text.toPlainText().startsWith('```'))
            Styles.textStyle: TextStyle(
              fontFamily: 'monospace',
              fontSize: 13 * scale,
              height: 1.6,
              color: MynoteTokens.textMain,
            ),
        },
      ),
      // 引用：原版 14px / 行高 1.6 / --md-text-muted（底色/边框由
      // MynoteBlockquoteComponentBuilder 的组件装饰实现）
      StyleRule(
        const BlockSelector('blockquote'),
        (doc, node) => {
          Styles.padding: const CascadingPadding.only(top: 12),
          Styles.textStyle: TextStyle(
            color: MynoteTokens.textMuted,
            fontSize: 14 * scale,
            height: 1.6,
            fontFamilyFallback: const ['NotoSansSC'],
          ),
        },
      ),
      // 拼写/语法波浪线关闭（原 Web 版无此装饰）
      StyleRule(
        BlockSelector.all,
        (doc, node) => {
          Styles.spellingErrorUnderlineStyle: const SquiggleUnderlineStyle(
            color: Color(0x00000000),
          ),
          Styles.grammarErrorUnderlineStyle: const SquiggleUnderlineStyle(
            color: Color(0x00000000),
          ),
        },
      ),
      // 待办：原版行 min-height 44、无块间上距；SE 默认 taskStyles
      // 给每行 top 24 会把列表拉长约 55%，这里覆盖回 0。
      StyleRule(
        const BlockSelector('task'),
        (doc, node) => {Styles.padding: const CascadingPadding.only(top: 0)},
      ),
      // S1：宽屏文本块 72ch 居中限宽（原版 editor-shell.css ≥900px
      // 媒体查询：p/h/quote/todo/pre/table max-width:72ch margin auto；
      // SE 无 max-width 样式，用对称横向内边距等价实现，卡片/媒体
      // 不受影响）。textPadH 由调用方按栏宽算好（<900 时恒 16）。
      for (final t in const [
        'paragraph',
        'header1',
        'header2',
        'header3',
        'header4',
        'header5',
        'header6',
        'blockquote',
        'task',
      ])
        StyleRule(
          BlockSelector(t),
          (doc, node) => {
            Styles.padding: CascadingPadding.symmetric(horizontal: textPadH),
          },
        ),
      // S2：整段显示式公式居中（原版 .math-block 块级居中）
      StyleRule(const BlockSelector('paragraph'), (doc, node) {
        if (node is ParagraphNode) {
          final plain = node.text.toPlainText();
          if (plain.isNotEmpty) {
            final attrs = node.text.getAllAttributionsAt(0);
            final lastAttrs = node.text.getAllAttributionsAt(plain.length - 1);
            bool isMath(Set<Attribution> s) =>
                s.any((a) => a is MathAttribution && a.display);
            if (isMath(attrs) && isMath(lastAttrs)) {
              return {Styles.textAlign: TextAlign.center};
            }
          }
        }
        return const <String, dynamic>{};
      }),
      // 首/尾块内边距：单栏时正文从悬浮坞下方开始、滚动时滑到坞下
      // （不做整屏硬裁剪）；双栏时栏内仅留原版的 4/24。
      if (topInset > 0)
        StyleRule(
          BlockSelector.all,
          (doc, node) => node.id == doc.first.id
              ? {Styles.padding: CascadingPadding.only(top: topInset)}
              : const <String, dynamic>{},
        ),
      if (bottomInset > 0)
        StyleRule(
          BlockSelector.all,
          (doc, node) => node.id == doc.last.id
              ? {Styles.padding: CascadingPadding.only(bottom: bottomInset)}
              : const <String, dynamic>{},
        ),
    ],
  );
}
