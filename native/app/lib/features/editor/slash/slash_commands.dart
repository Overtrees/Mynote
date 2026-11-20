// 斜杠命令数据与过滤逻辑：Web 版 commands.js + slash-model.js 的 Dart 移植。
// 纯 Dart、无 Flutter 依赖，便于单测与两端对照。
// 与 Web 的已知差异：Web 排序用 localeCompare('zh-Hans-CN')（拼音序），
// Dart 核心库无 ICU  collation，这里用字符串 compareTo 近似（命令集固定，
// 影响仅限同桶内中文标题的相对顺序）。

class SlashCommand {
  const SlashCommand({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.keywords,
    required this.type,
    required this.group,
    this.level,
    this.pinyin = '',
    this.shortcut = '',
  });

  final String id;
  final String title;
  final String subtitle;
  final String keywords;
  final String type;
  final String group; // basic | media
  final int? level; // heading 专用
  final String pinyin; // 拼音首字母串
  final String shortcut;
}

const slashGroupLabels = {'basic': '基础块', 'media': '媒体块'};
const slashGroupOrder = ['basic', 'media'];

const slashCommands = <SlashCommand>[
  SlashCommand(
    id: 'heading',
    title: '标题 1',
    subtitle: '一级标题',
    keywords: 'h1 heading 标题 一级',
    type: 'heading',
    level: 1,
    group: 'basic',
    pinyin: 'bt1',
    shortcut: '# ',
  ),
  SlashCommand(
    id: 'heading2',
    title: '标题 2',
    subtitle: '二级标题',
    keywords: 'h2 heading2 标题 二级',
    type: 'heading',
    level: 2,
    group: 'basic',
    pinyin: 'bt2',
    shortcut: '## ',
  ),
  SlashCommand(
    id: 'heading3',
    title: '标题 3',
    subtitle: '三级标题',
    keywords: 'h3 heading3 标题 三级',
    type: 'heading',
    level: 3,
    group: 'basic',
    pinyin: 'bt3',
    shortcut: '### ',
  ),
  SlashCommand(
    id: 'paragraph',
    title: '文本',
    subtitle: '普通段落',
    keywords: 'p paragraph 文本',
    type: 'paragraph',
    group: 'basic',
    pinyin: 'wb',
  ),
  SlashCommand(
    id: 'quote',
    title: '引用',
    subtitle: '引用块',
    keywords: 'q quote 引用',
    type: 'quote',
    group: 'basic',
    pinyin: 'yy',
    shortcut: '> ',
  ),
  SlashCommand(
    id: 'todo',
    title: '待办',
    subtitle: '任务清单',
    keywords: 't todo 待办',
    type: 'todo',
    group: 'basic',
    pinyin: 'db',
    shortcut: '[ ] ',
  ),
  SlashCommand(
    id: 'divider',
    title: '分割线',
    subtitle: '插入分隔符',
    keywords: 'd divider 分割线',
    type: 'divider',
    group: 'basic',
    pinyin: 'fgx',
    shortcut: '---',
  ),
  SlashCommand(
    id: 'bold',
    title: '加粗',
    subtitle: '包裹选中文字为 **粗体**',
    keywords: 'b bold 加粗 粗体',
    type: 'inline_bold',
    group: 'basic',
    pinyin: 'jc',
    shortcut: '** **',
  ),
  SlashCommand(
    id: 'italic',
    title: '斜体',
    subtitle: '包裹选中文字为 *斜体*',
    keywords: 'i italic 斜体 倾斜',
    type: 'inline_italic',
    group: 'basic',
    pinyin: 'xt',
    shortcut: '* *',
  ),
  SlashCommand(
    id: 'highlight',
    title: '高亮',
    subtitle: '包裹选中文字为 ==高亮==',
    keywords: 'h highlight 高亮',
    type: 'inline_highlight',
    group: 'basic',
    pinyin: 'gl',
    shortcut: '== ==',
  ),
  SlashCommand(
    id: 'codeBlock',
    title: '代码块',
    subtitle: '插入代码块',
    keywords: 'code codeblock 代码块',
    type: 'code_block',
    group: 'basic',
    pinyin: 'dmk',
    shortcut: '```',
  ),
  SlashCommand(
    id: 'unorderedList',
    title: '无序列表',
    subtitle: '转为 - 列表项',
    keywords: 'list ul 无序列表 列表',
    type: 'unordered_list',
    group: 'basic',
    pinyin: 'wxl',
    shortcut: '- ',
  ),
  SlashCommand(
    id: 'orderedList',
    title: '有序列表',
    subtitle: '转为 1. 列表项',
    keywords: 'ol list 有序列表 列表',
    type: 'ordered_list',
    group: 'basic',
    pinyin: 'yxl',
    shortcut: '1. ',
  ),
  SlashCommand(
    id: 'callout',
    title: 'Callout',
    subtitle: '插入 >[!NOTE] 提示卡片',
    keywords: 'callout note tip warning 提示 警告',
    type: 'callout',
    group: 'basic',
    pinyin: 'callout',
    shortcut: '> [!]',
  ),
  SlashCommand(
    id: 'imgTextCard',
    title: '图文卡片',
    subtitle: '圆角上图下文卡片',
    keywords: 'image text card 图文 卡片',
    type: 'imgTextCard',
    group: 'media',
    pinyin: 'twkp',
  ),
  SlashCommand(
    id: 'imageTextRow',
    title: '图文混排',
    subtitle: '图片文字左右并排',
    keywords: 'image text row 图文 混排 左右',
    type: 'imageTextRow',
    group: 'media',
    pinyin: 'twhp',
  ),
  SlashCommand(
    id: 'link',
    title: '链接',
    subtitle: '选中文字转超链接',
    keywords: 'l link 链接 超链接',
    type: 'inline_link',
    group: 'basic',
    pinyin: 'lj',
    shortcut: '[](url)',
  ),
  SlashCommand(
    id: 'code',
    title: '代码',
    subtitle: '内联代码包裹',
    keywords: 'c code 代码 内联',
    type: 'inline_code',
    group: 'basic',
    pinyin: 'dm',
    shortcut: '` `',
  ),
  SlashCommand(
    id: 'strikethrough',
    title: '删除线',
    subtitle: '~~删除线~~',
    keywords: 's strike strikethrough 删除线',
    type: 'inline_strike',
    group: 'basic',
    pinyin: 'scx',
    shortcut: '~~ ~~',
  ),
  SlashCommand(
    id: 'musicCard',
    title: '音乐卡片',
    subtitle: '插入音乐链接卡片',
    keywords: 'm music 音乐 卡片',
    type: 'musicCard',
    group: 'media',
    pinyin: 'yykp',
  ),
  SlashCommand(
    id: 'image',
    title: '图片',
    subtitle: '插入图片占位',
    keywords: 'i image 图片',
    type: 'image',
    group: 'media',
    pinyin: 'tp',
  ),
  SlashCommand(
    id: 'gallery',
    title: '画廊',
    subtitle: '插入多图画廊',
    keywords: 'g gallery 画廊',
    type: 'gallery',
    group: 'media',
    pinyin: 'hl',
  ),
];

class SlashFilterItem {
  const SlashFilterItem(this.command, {this.sectionLabel, this.recent = false});
  final SlashCommand command;
  final String? sectionLabel;
  final bool recent;
}

/// slash-model.js filter() 的等价移植。
List<SlashFilterItem> filterSlashCommands(
  List<SlashCommand> defs,
  String query, {
  List<String> recentIds = const [],
}) {
  final q = query.trim().toLowerCase();
  if (q.isNotEmpty) {
    String searchStr(SlashCommand c) =>
        '${c.title} ${c.subtitle} ${c.keywords} ${c.type}${c.pinyin}'
            .toLowerCase();
    final matched = defs.where((c) => searchStr(c).contains(q)).toList();
    int startsBucket(SlashCommand c) =>
        ('${c.title} ${c.keywords}'.toLowerCase().startsWith(q) ||
            c.pinyin.startsWith(q))
        ? 0
        : 1;
    matched.sort((a, b) {
      final d = startsBucket(a) - startsBucket(b);
      return d != 0 ? d : a.title.compareTo(b.title);
    });
    return matched.map((c) => SlashFilterItem(c)).toList();
  }

  final result = <SlashFilterItem>[];
  if (recentIds.isNotEmpty) {
    final order = <String, int>{
      for (var i = 0; i < recentIds.length; i++) recentIds[i]: i,
    };
    final recentCmds = defs.where((c) => order.containsKey(c.id)).toList()
      ..sort((a, b) => order[a.id]! - order[b.id]!);
    final rest = defs.where((c) => !order.containsKey(c.id)).toList();
    var addedRecent = false;
    for (final g in slashGroupOrder) {
      if (!addedRecent && recentCmds.isNotEmpty) {
        result.addAll(
          recentCmds.map(
            (c) => SlashFilterItem(c, sectionLabel: '最近使用', recent: true),
          ),
        );
        addedRecent = true;
      }
      result.addAll(
        rest
            .where((c) => c.group == g)
            .map((c) => SlashFilterItem(c, sectionLabel: slashGroupLabels[g])),
      );
    }
    if (result.isEmpty) {
      return defs
          .map(
            (c) => SlashFilterItem(c, sectionLabel: slashGroupLabels[c.group]),
          )
          .toList();
    }
    return result;
  }

  for (final g in slashGroupOrder) {
    result.addAll(
      defs
          .where((c) => c.group == g)
          .map((c) => SlashFilterItem(c, sectionLabel: slashGroupLabels[g])),
    );
  }
  return result;
}
