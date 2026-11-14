/* 斜杠命令与图标是纯静态数据，独立于 Editor 组件。 */
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
    id: 'decoDivider',
    icon: 'decoDivider',
    title: '装饰分割线',
    subtitle: '插入 ---🌟--- 装饰线',
    keywords: 'deco divider 装饰分割线',
    type: 'decorative_divider',
    group: 'basic',
    pinyin: 'zsfg',
    shortcut: '---emoji---'
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
    id: 'tip',
    icon: 'tip',
    title: '提示',
    subtitle: '插入 !!提示 标签',
    keywords: 'tip 提示',
    type: 'inline_tip',
    group: 'basic',
    pinyin: 'ts',
    shortcut: '!!'
  }, {
    id: 'question',
    icon: 'question',
    title: '问题',
    subtitle: '插入 ??问题 标签',
    keywords: 'q question 问题',
    type: 'inline_question',
    group: 'basic',
    pinyin: 'wt',
    shortcut: '??'
  }, {
    id: 'mention',
    icon: 'mention',
    title: '提及',
    subtitle: '插入 @@提及 标签',
    keywords: 'm mention 提及 @',
    type: 'inline_mention',
    group: 'basic',
    pinyin: 'tj',
    shortcut: '@@'
  }, {
    id: 'hashtag',
    icon: 'hashtag',
    title: '标签',
    subtitle: '插入 #标签',
    keywords: 'tag 标签 #',
    type: 'inline_hashtag',
    group: 'basic',
    pinyin: 'bq',
    shortcut: '#'
  }, {
    id: 'centered',
    icon: 'centered',
    title: '居中',
    subtitle: '包裹为 ->居中文字<-',
    keywords: 'center 居中',
    type: 'inline_centered',
    group: 'basic',
    pinyin: 'jz',
    shortcut: '-> <-'
  }, {
    id: 'tagLabel',
    icon: 'tagLabel',
    title: '彩色标签',
    subtitle: '包裹为 $标签$',
    keywords: 'tag label 彩色标签',
    type: 'inline_tag',
    group: 'basic',
    pinyin: 'csbq',
    shortcut: '$ $'
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

  window.MynoteSlashIcons = {
    heading: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="3" x2="5" y2="17"/><line x1="15" y1="3" x2="15" y2="17"/><line x1="5" y1="10" x2="15" y2="10"/><rect x="3" y="17" width="14" height="2" rx="1" fill="currentColor" stroke="none"/></svg>',
    heading2: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="4" x2="5" y2="16"/><line x1="15" y1="4" x2="15" y2="16"/><line x1="5" y1="10" x2="15" y2="10"/><line x1="4" y1="17" x2="16" y2="17" stroke-width="1.5" stroke-linecap="round"/></svg>',
    heading3: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="5" x2="6" y2="15"/><line x1="14" y1="5" x2="14" y2="15"/><line x1="6" y1="10" x2="14" y2="10"/></svg>',
    paragraph: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="10" y1="5" x2="16" y2="5"/><line x1="4" y1="9" x2="16" y2="9"/><line x1="4" y1="13" x2="16" y2="13"/><line x1="4" y1="17" x2="10" y2="17"/></svg>',
    quote: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13c0-2 1.5-4 4-5"/><path d="M14 13c0-2 1.5-4 4-5"/></svg>',
    todo: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="12" height="12" rx="2"/><path d="M7 12l2 2 4-5"/></svg>',
    divider: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="3" y1="10" x2="17" y2="10"/></svg>',
    bold: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h5a3 3 0 010 6H7m5 0a3 3 0 010 6H7V4"/></svg>',
    italic: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="9" y1="4" x2="15" y2="4"/><line x1="7" y1="16" x2="13" y2="16"/><line x1="13" y1="4" x2="9" y2="16"/></svg>',
    link: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11a4 4 0 116-6l1 1"/><path d="M11 9a4 4 0 11-6 6l-1-1"/></svg>',
    code: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 7, 3 10, 7 13"/><polyline points="13 7, 17 10, 13 13"/></svg>',
    strikethrough: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.5c0-1-1-2-3-2s-3 .8-3 2c0 .8.4 1.3 1.5 1.7"/><path d="M7 13.5c0 1 1 2 3 2s3-.8 3-2"/><line x1="5" y1="10" x2="15" y2="10"/></svg>',
    highlight: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13l3-3 6 6-3 3z"/><path d="M16 4a2 2 0 00-3 0l-4 4 3 3 4-4a2 2 0 000-3z"/></svg>',
    tip: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="14" r="1" fill="currentColor"/><path d="M10 3v8"/><circle cx="10" cy="10" r="7"/></svg>',
    question: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M7.5 8.5a2.5 2.5 0 115 0c0 1.5-2 2-2 3"/><circle cx="10" cy="14" r="0.8" fill="currentColor"/></svg>',
    mention: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3"/><path d="M5 17v-2a4 4 0 014-4h2a4 4 0 014 4v2"/><circle cx="10" cy="10" r="7"/></svg>',
    hashtag: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="8" y1="3" x2="6" y2="17"/><line x1="14" y1="3" x2="12" y2="17"/><line x1="3" y1="8" x2="17" y2="8"/><line x1="3" y1="13" x2="17" y2="13"/></svg>',
    centered: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="3" y1="10" x2="17" y2="10"/><line x1="6" y1="6" x2="14" y2="6"/><line x1="6" y1="14" x2="14" y2="14"/></svg>',
    tagLabel: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="14" height="8" rx="4"/><path d="M7 10h6"/></svg>',
    decoDivider: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="3" y1="10" x2="17" y2="10"/><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/></svg>',
    callout: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="12" rx="2"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="12" y2="12"/><rect x="4" y="6" width="2" height="8" rx="1" fill="currentColor" stroke="none"/></svg>',
    imgTextCard: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="14" height="14" rx="3"/><rect x="4" y="4" width="12" height="8" rx="2" fill="currentColor" opacity="0.15"/><line x1="5" y1="14" x2="15" y2="14"/></svg>',
    imageTextRow: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="12" rx="1.5"/><rect x="12" y="4" width="6" height="12" rx="1.5"/><circle cx="6.5" cy="7.5" r="1"/></svg>',
    codeBlock: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="14" height="14" rx="2"/><polyline points="7 8, 5 10, 7 12"/><polyline points="13 8, 15 10, 13 12"/></svg>',
    list: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="5" x2="16" y2="5"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="15" x2="16" y2="15"/><circle cx="4.5" cy="5" r="1"/><circle cx="4.5" cy="10" r="1"/><circle cx="4.5" cy="15" r="1"/></svg>',
    olist: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="5" x2="16" y2="5"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="15" x2="16" y2="15"/><text x="2.5" y="7.5" font-size="8" fill="currentColor" stroke="none" font-weight="700">1</text><text x="2.5" y="12.5" font-size="8" fill="currentColor" stroke="none" font-weight="700">2</text><text x="2.5" y="17" font-size="8" fill="currentColor" stroke="none" font-weight="700">3</text></svg>',
    music: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="14" r="2"/><circle cx="14" cy="13" r="2"/><path d="M9 14V5l7-1v8"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="12" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M3 15l4-5 3 3 3-4 4 6"/></svg>',
    gallery: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="14" height="12" rx="1.5"/><rect x="5" y="3" width="14" height="12" rx="1.5" opacity="0.3"/></svg>'
  };
})(window);
