/* 复用型内联样式：仅承载跨组件重复的静态结构，动态尺寸仍由调用方覆盖。 */
(function (w) {
  'use strict';

  w.MynoteInlineStyles = {
    fixedOverlay: {
      position: 'fixed',
      inset: 0,
      zIndex: 4000,
      background: 'transparent'
    },
    sheetTitle: {
      textAlign: 'center',
      fontSize: 'var(--font-18)',
      fontWeight: 700,
      marginBottom: 12,
      color: 'var(--text-main)'
    },
    centerRow6: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  };
})(window);
