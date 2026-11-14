/* 全局设计令牌：颜色、圆角、字号、阴影与调色板统一入口。 */
(function (w) {
  'use strict';

  var T = {
    color: {
      accent: 'var(--color-accent)',
      accentStrong: 'var(--color-accent-strong)',
      danger: 'var(--color-danger)',
      dangerBright: 'var(--color-danger-bright)',
      dangerDark: 'var(--color-danger-dark)',
      dangerLight: 'var(--color-danger-light)',
      warning: 'var(--color-warning)',
      success: 'var(--color-success)',
      purple: 'var(--color-purple)',
      placeholder: 'var(--color-placeholder)',
      placeholderStrong: 'var(--color-placeholder-strong)',
      iconMuted: 'var(--color-icon-muted)',
      text: 'var(--text-main)',
      textSecondary: 'var(--text-secondary)',
      white: 'var(--color-white)',
      black: 'var(--color-black)'
    },
    fill: {
      hover: 'var(--fill-hover)',
      hoverStrong: 'var(--fill-hover-strong)',
      subtle: 'var(--fill-subtle)',
      subtle2: 'var(--fill-subtle-2)',
      accent08: 'var(--fill-accent-08)',
      accent10: 'var(--fill-accent-10)',
      accent16: 'var(--fill-accent-16)',
      accent18: 'var(--fill-accent-18)',
      accent20: 'var(--fill-accent-20)',
      accent22: 'var(--fill-accent-22)',
      accent25: 'var(--fill-accent-25)',
      accent35: 'var(--fill-accent-35)'
    },
    radius: {
      3: 'var(--radius-3)',
      4: 'var(--radius-4)',
      6: 'var(--radius-6)',
      8: 'var(--radius-8)',
      10: 'var(--radius-10)',
      12: 'var(--radius-12)',
      14: 'var(--radius-14)',
      16: 'var(--radius-16)',
      17: 'var(--radius-17)',
      18: 'var(--radius-18)',
      20: 'var(--radius-20)',
      22: 'var(--radius-22)',
      23: 'var(--radius-23)',
      28: 'var(--radius-28)',
      30: 'var(--radius-30)',
      32: 'var(--radius-32)',
      33: 'var(--radius-33)',
      999: 'var(--radius-999)',
      circle: 'var(--radius-circle)'
    },
    font: {
      9: 'var(--font-9)',
      10: 'var(--font-10)',
      11: 'var(--font-11)',
      12: 'var(--font-12)',
      13: 'var(--font-13)',
      14: 'var(--font-14)',
      15: 'var(--font-15)',
      16: 'var(--font-16)',
      18: 'var(--font-18)',
      19: 'var(--font-19)',
      20: 'var(--font-20)',
      24: 'var(--font-24)'
    },
    shadow: {
      card: 'var(--shadow-card)',
      cardSoft: 'var(--shadow-card-soft)',
      float: 'var(--shadow-float)',
      floatSoft: 'var(--shadow-float-soft)',
      modal: 'var(--shadow-modal)',
      sheet: 'var(--shadow-sheet)',
      sheetStrong: 'var(--shadow-sheet-strong)',
      popover: 'var(--shadow-popover)'
    },
    surface: {
      overlay: 'var(--surface-overlay)',
      editor: 'var(--color-editor-bg)'
    },
    glassFilter: 'var(--glass-filter)',
    glass: {
      background: 'var(--glass-bg)',
      border: '0.5px solid var(--glass-border)',
      backdropFilter: 'var(--glass-filter)',
      WebkitBackdropFilter: 'var(--glass-filter)'
    },
    palette: {
      backgroundColors: ['#eaeef2', '#e8e0d4', '#d4e8d0', '#d0e0e8', '#e8d0d4', '#fff3e0', '#e8e0f0', '#f0e8d0'],
      tagColors: { red: '#ff453a', blue: '#007aff', green: '#34c759', orange: '#ff9500', purple: '#af52de', gray: '#8e8e93' }
    },
    fontSizeMap: {
      small: '14px',
      medium: '16px',
      large: '19px'
    }
  };

  w.MynoteTokens = T;
})(window);
