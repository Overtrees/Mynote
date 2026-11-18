(function (w) {
  'use strict';
  var R = w.React;

  // SVG path data 集中管理
  var PATHS = {
    pin: 'M12 17v5M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z',
    del: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    back: 'M15 18l-6-6 6-6',
    check: 'M5.5 12.3 10 16.7 18.8 7.8',
    palette: 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5c0-1.1-.9-2-2-2h-1.6a1.8 1.8 0 0 1-1.8-1.8V6.5A3 3 0 0 0 12 3.5Z',
    undo: 'M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10',
    redo: 'M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10',
    attach: 'M8.2 11.8l4.9-4.9a3 3 0 1 1 4.2 4.2l-6.5 6.5a5 5 0 1 1-7.1-7.1l7.1-7.1',
  };

  // 待办勾选框（data-URI img 版，供 contentEditable 内使用；CSS 版见 Moment.html 的 .task-list-item 规则）
  var TODO_ICONS = {
    checked: "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Ccircle cx='11' cy='11' r='11' fill='%23007AFF'/%3E%3Cpath d='M7 11l3 3 5-5' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
    unchecked: "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Ccircle cx='11' cy='11' r='9.5' fill='none' stroke='%23C7C7CC' stroke-width='1.8'/%3E%3C/svg%3E"
  };

  // 常用尺寸的 SVG viewBox
  var SIZE = '0 0 24 24';

  function SvgIcon(name, extra) {
    extra = extra || {};
    var d = PATHS[name];
    if (!d) return null;
    var paths = d.split('|');
    var children = paths.map(function(p, i) {
      return R.createElement('path', {
        key: i,
        d: p,
        stroke: extra.stroke || 'currentColor',
        strokeWidth: extra.strokeWidth || '2.5',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        fill: extra.fill || 'none'
      });
    });
    return R.createElement('svg', {
      viewBox: SIZE,
      width: extra.width || '20',
      height: extra.height || '20',
      fill: extra.fill || 'none',
      xmlns: 'http://www.w3.org/2000/svg'
    }, children);
  }

  // 多段 path 图标（用 | 分隔）
  PATHS.pinMulti = 'M12 17v5|M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z';
  PATHS.delMulti = 'M3 6h18|M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6|M10 11v6|M14 11v6|M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2';
  PATHS.warning = 'M12 2L2 20h20L12 2z|M12 10v4|M12 17h.01';
  PATHS.merge = 'M17 2l4 4-4 4M7 22l-4-4 4-4M21 6H10a6 6 0 0 0-6 6M3 18h11a6 6 0 0 0 6-6';
  PATHS.columns = 'M3 4h18v16H3z|M12 4v16';
  PATHS.heading = 'M5 5v14|M19 5v14|M5 12h14|M5 19h8';
  PATHS.heading2 = 'M5 5v14|M19 5v14|M5 12h14|M7 19h10';
  PATHS.heading3 = 'M6 6v12|M18 6v12|M6 12h12';
  PATHS.paragraph = 'M10 6h10|M4 10h16|M4 14h16|M4 18h8';
  PATHS.quote = 'M6 17h5v-6H7v-1a2 2 0 0 1 2-2V6a5 5 0 0 0-5 5v6zm8 0h5v-6h-4v-1a2 2 0 0 1 2-2V6a5 5 0 0 0-5 5v6z';
  PATHS.todo = 'M5 5h14v14H5z|m8 12 3 3 5-6';
  PATHS.divider = 'M3 12h18';
  PATHS.bold = 'M7 4h6a4 4 0 0 1 0 8H7z|M7 12h7a4 4 0 0 1 0 8H7z';
  PATHS.italic = 'M15 4H9|M15 4l-6 16|M15 20H9';
  PATHS.highlight = 'M4 16 14 6l4 4L8 20H4z|M12 8l4 4|M3 21h14';
  PATHS.codeBlock = 'M4 4h16v16H4z|m9 9-3 3 3 3|m15 9 3 3-3 3';
  PATHS.list = 'M9 6h12|M9 12h12|M9 18h12|M4 6h.01|M4 12h.01|M4 18h.01';
  PATHS.olist = 'M3 7h2V4H3m0 5h2|M3 12h2v3H3m0 0 1.5-1.5|M3 20h2v-3H3m0 0 1.5 1.5|M9 5h12|M9 12h12|M9 19h12';
  PATHS.callout = 'M4 4h16v16H4z|M8 9h8|M8 13h6|M6 7v10';
  PATHS.imgTextCard = 'M4 4h16v16H4z|M6 6h12v7H6z|M7 16h10';
  PATHS.imageTextRow = 'M3 5h8v14H3z|M14 5h7v14h-7z|M5 9h4';
  PATHS.link = 'M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7|M14 11a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7';
  PATHS.code = 'm8 8-4 4 4 4|m16 8 4 4-4 4';
  PATHS.strikethrough = 'M14 7a3 3 0 0 0-3-2H9a3 3 0 0 0-1 5.8|M5 12h14|M8 16a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3';
  PATHS.music = 'M8 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M17 17a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M10.5 16V5l9-2v11';
  PATHS.image = 'M4 5h16v14H4z|M8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|m4 16 5-5 3 3 3-4 5 6';
  PATHS.gallery = 'M5 7h15v14H5z|M4 17H3V3h15v2';

  // 兼容旧的 SVG_ICONS 格式（HTML 字符串）
  // 新的 React 组件用法：w.SvgIcon('pin', { width: 17, height: 17, strokeWidth: 2.2 })

  w.SvgIcon = SvgIcon;
  w.MynoteTodoIcons = TODO_ICONS;
  w.SvgPaths = PATHS;
})(window);
