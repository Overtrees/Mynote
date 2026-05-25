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

  // 兼容旧的 SVG_ICONS 格式（HTML 字符串）
  // 新的 React 组件用法：w.SvgIcon('pin', { width: 17, height: 17, strokeWidth: 2.2 })

  w.SvgIcon = SvgIcon;
  w.SvgPaths = PATHS;
})(window);
