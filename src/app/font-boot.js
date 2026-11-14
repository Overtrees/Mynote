/* 首屏字号引导：在任何渲染前应用用户字号，避免闪烁。 */
(function (w) {
  'use strict';
  var map = (w.MynoteTokens && w.MynoteTokens.fontSizeMap) || { small: '14px', medium: '16px', large: '19px' };
  var size = w.localStorage.getItem('sj_fontsize') || 'medium';
  w.document.documentElement.style.fontSize = map[size] || map.medium;
})(window);
