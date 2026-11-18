/* 斜杠命令是纯静态数据；图标路径由 utils/svg.js 的全局注册表集中管理。 */
(window => {
  'use strict';
  window.MynoteSlashCommands = [{
    id: 'heading',
    icon: 'heading',
    title: '标题 1',
    subtitle: '一级标题',
    keywords: 'h1 heading 标题 一级',
    type: 'heading',
    level: 1,
    group: 'basic',
    pinyin: 'bt1',
    shortcut: '# '
  }, {
    id: 'heading2',
    icon: 'heading2',
    title: '标题 2',
    subtitle: '二级标题',
    keywords: 'h2 heading2 标题 二级',
    type: 'heading',
    level: 2,
    group: 'basic',
    pinyin: 'bt2',
    shortcut: '## '
  }, {
    id: 'heading3',
    icon: 'heading3',
    title: '标题 3',
    subtitle: '三级标题',
    keywords: 'h3 heading3 标题 三级',
    type: 'heading',
    level: 3,
    group: 'basic',
    pinyin: 'bt3',
    shortcut: '### '
  }, {
    id: 'paragraph',
    icon: 'paragraph',
    title: '文本',
    subtitle: '普通段落',
    keywords: 'p paragraph 文本',
    type: 'paragraph',
    group: 'basic',
    pinyin: 'wb',
    shortcut: ''
  }, {
    id: 'quote',
    icon: 'quote',
    title: '引用',
    subtitle: '引用块',
    keywords: 'q quote 引用',
    type: 'quote',
    group: 'basic',
    pinyin: 'yy',
    shortcut: '> '
  }, {
    id: 'todo',
    icon: 'todo',
    title: '待办',
    subtitle: '任务清单',
    keywords: 't todo 待办',
    type: 'todo',
    group: 'basic',
    pinyin: 'db',
    shortcut: '[ ] '
  }, {
    id: 'divider',
    icon: 'divider',
    title: '分割线',
    subtitle: '插入分隔符',
    keywords: 'd divider 分割线',
    type: 'divider',
    group: 'basic',
    pinyin: 'fgx',
    shortcut: '---'
  }, {
    id: 'bold',
    icon: 'bold',
    title: '加粗',
    subtitle: '包裹选中文字为 **粗体**',
    keywords: 'b bold 加粗 粗体',
    type: 'inline_bold',
    group: 'basic',
    pinyin: 'jc',
    shortcut: '** **'
  }, {
    id: 'italic',
    icon: 'italic',
    title: '斜体',
    subtitle: '包裹选中文字为 *斜体*',
    keywords: 'i italic 斜体 倾斜',
    type: 'inline_italic',
    group: 'basic',
    pinyin: 'xt',
    shortcut: '* *'
  }, {
    id: 'highlight',
    icon: 'highlight',
    title: '高亮',
    subtitle: '包裹选中文字为 ==高亮==',
    keywords: 'h highlight 高亮',
    type: 'inline_highlight',
    group: 'basic',
    pinyin: 'gl',
    shortcut: '== =='
  }, {
    id: 'codeBlock',
    icon: 'codeBlock',
    title: '代码块',
    subtitle: '插入代码块',
    keywords: 'code codeblock 代码块',
    type: 'code_block',
    group: 'basic',
    pinyin: 'dmk',
    shortcut: '```'
  }, {
    id: 'unorderedList',
    icon: 'list',
    title: '无序列表',
    subtitle: '转为 - 列表项',
    keywords: 'list ul 无序列表 列表',
    type: 'unordered_list',
    group: 'basic',
    pinyin: 'wxl',
    shortcut: '- '
  }, {
    id: 'orderedList',
    icon: 'olist',
    title: '有序列表',
    subtitle: '转为 1. 列表项',
    keywords: 'ol list 有序列表 列表',
    type: 'ordered_list',
    group: 'basic',
    pinyin: 'yxl',
    shortcut: '1. '
  }, {
    id: 'callout',
    icon: 'callout',
    title: 'Callout',
    subtitle: '插入 >[!NOTE] 提示卡片',
    keywords: 'callout note tip warning 提示 警告',
    type: 'callout',
    group: 'basic',
    pinyin: 'callout',
    shortcut: '> [!]'
  }, {
    id: 'imgTextCard',
    icon: 'imgTextCard',
    title: '图文卡片',
    subtitle: '圆角上图下文卡片',
    keywords: 'image text card 图文 卡片',
    type: 'imgTextCard',
    group: 'media',
    pinyin: 'twkp',
    shortcut: ''
  }, {
    id: 'imageTextRow',
    icon: 'imageTextRow',
    title: '图文混排',
    subtitle: '图片文字左右并排',
    keywords: 'image text row 图文 混排 左右',
    type: 'imageTextRow',
    group: 'media',
    pinyin: 'twhp',
    shortcut: ''
  }, {
    id: 'link',
    icon: 'link',
    title: '链接',
    subtitle: '选中文字转超链接',
    keywords: 'l link 链接 超链接',
    type: 'inline_link',
    group: 'basic',
    pinyin: 'lj',
    shortcut: '[](url)'
  }, {
    id: 'code',
    icon: 'code',
    title: '代码',
    subtitle: '内联代码包裹',
    keywords: 'c code 代码 内联',
    type: 'inline_code',
    group: 'basic',
    pinyin: 'dm',
    shortcut: '` `'
  }, {
    id: 'strikethrough',
    icon: 'strikethrough',
    title: '删除线',
    subtitle: '~~删除线~~',
    keywords: 's strike strikethrough 删除线',
    type: 'inline_strike',
    group: 'basic',
    pinyin: 'scx',
    shortcut: '~~ ~~'
  }, {
    id: 'musicCard',
    icon: 'music',
    title: '音乐卡片',
    subtitle: '插入音乐链接卡片',
    keywords: 'm music 音乐 卡片',
    type: 'musicCard',
    group: 'media',
    pinyin: 'yykp',
    shortcut: ''
  }, {
    id: 'image',
    icon: 'image',
    title: '图片',
    subtitle: '插入图片占位',
    keywords: 'i image 图片',
    type: 'image',
    group: 'media',
    pinyin: 'tp'
  }, {
    id: 'gallery',
    icon: 'gallery',
    title: '画廊',
    subtitle: '插入多图画廊',
    keywords: 'g gallery 画廊',
    type: 'gallery',
    group: 'media',
    pinyin: 'hl'
  }
  ];

  window.MynoteSlashIcons = window.SvgPaths || {};
})(window);
