/* ===== 此刻 · 运行时异常捕获模块 =====
 * 不打断用户正常使用，发生异常时在右下角显示小红点
 * 点击展开错误详情，方便快速定位修复
 */
(function (w) {
  'use strict';

  var R = w.React;
  var MAX_ERRORS = 20;
  var errors = [];

  // ===== 收集错误 =====
  function addError(type, message, source, lineno, colno, err) {
    var entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: type,
      message: message || '',
      source: source || '',
      line: lineno || 0,
      col: colno || 0,
      stack: err && err.stack ? err.stack.split('\n').slice(0, 8).join('\n') : '',
      time: new Date().toLocaleString()
    };
    errors.push(entry);
    if (errors.length > MAX_ERRORS) errors.shift();
    updateBadge();
    return entry;
  }

  // ===== 收集警告（warn() 投递至此，非异常，黄点显示） =====
  function addWarn(msg, err) {
    var entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'WARN',
      message: msg || '',
      source: '',
      line: 0,
      col: 0,
      stack: err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : '',
      time: new Date().toLocaleString()
    };
    errors.push(entry);
    if (errors.length > MAX_ERRORS) errors.shift();
    updateBadge();
    return entry;
  }

  // ===== 全局异常监听 =====
  w.addEventListener('error', function (e) {
    addError('RENDER', e.message || 'Script error', e.filename, e.lineno, e.colno, e.error);
  });
  w.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason || {};
    addError('PROMISE', reason.message || String(reason), '', 0, 0, reason);
  });

  // ===== React ErrorBoundary 组件 =====
  var ErrorBoundary = (function () {
    var Component = R.Component;
    function EB(props) {
      Component.call(this, props);
      this.state = { hasError: false, error: null, info: null };
    }
    EB.prototype = Object.create(Component.prototype);
    EB.prototype.constructor = EB;
    EB.getDerivedStateFromError = function (error) { return { hasError: true, error: error }; };
    EB.prototype.componentDidCatch = function (error, info) {
      this.setState({ hasError: true, error: error, info: info });
      addError('REACT', error && error.message || 'Component crash', '', 0, 0, error);
    };
    EB.prototype.render = function () {
      if (this.state.hasError) return R.createElement('div', { role: 'alert', className: 'error-boundary-fallback', style: { padding: '24px', margin: '16px', borderRadius: '16px', background: 'var(--surface-overlay)', color: 'var(--text-main)' } }, R.createElement('h2', null, '页面遇到问题'), R.createElement('p', null, '笔记数据仍保存在本机。可以刷新页面重新打开。'), R.createElement('button', { type: 'button', onClick: function () { w.location.reload(); } }, '刷新页面'));
      return this.props.children;
    };
    return EB;
  })();

  // ===== 浮动错误浮层 =====
  var badgeEl = null;

  function updateBadge() {
    if (!badgeEl) return;
    var count = errors.length;
    var hasError = errors.some(function(e){ return e.type !== 'WARN'; });
    var dot = badgeEl.querySelector('.eb-dot');
    if (dot) dot.style.display = count > 0 ? 'flex' : 'none';
    if (count > 0) {
      var text = badgeEl.querySelector('.eb-count');
      if (text) text.textContent = count > 99 ? '99+' : count;
      badgeEl.style.background = hasError ? 'var(--color-danger-bright)' : 'var(--color-warning)';
    }
  }

  function createOverlay() {
    var container = document.createElement('div');
    container.id = 'cike-error-boundary';
    container.innerHTML =
      '<div class="eb-badge" style="position:fixed;right:16px;bottom:calc(64px + env(safe-area-inset-bottom,0));z-index:99999;cursor:pointer;' +
        'width:36px;height:36px;border-radius:var(--radius-18);background:var(--color-danger-bright);' +
        'display:flex;align-items:center;justify-content:center;gap:2px;transition:opacity 0.2s;opacity:0;pointer-events:none;">' +
        '<span class="eb-dot" style="display:none;align-items:center;gap:2px;">' +
          '<span style="color:var(--color-white);font-size:var(--font-12);font-weight:700;font-family:var(--font-family-base);line-height:1;">!</span>' +
          '<span class="eb-count" style="color:var(--color-white);font-size:var(--font-10);font-weight:600;font-family:var(--font-family-base);line-height:1;"></span>' +
        '</span>' +
      '</div>' +
      '<div class="eb-panel" style="display:none;position:fixed;right:16px;bottom:calc(108px + env(safe-area-inset-bottom,0));z-index:99998;' +
        'width:320px;max-height:360px;overflow-y:auto;background:var(--surface-overlay);backdrop-filter:blur(20px);' +
        '-webkit-backdrop-filter:blur(20px);border:0.5px solid var(--color-white-12);border-radius:var(--radius-20);' +
        'padding:14px;font-family:var(--font-family-base);font-size:var(--font-12);color:var(--color-panel-muted);' +
        '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
          '<span class="eb-title" style="font-weight:700;font-size:var(--font-13);color:var(--color-danger-light);">\u26A0\uFE0F \u8FD0\u884C\u5F02\u5E38</span>' +
          '<span class="eb-clear" style="color:var(--text-secondary);font-size:var(--font-11);cursor:pointer;padding:2px 6px;border-radius:var(--radius-6);">\u6E05\u9664</span>' +
        '</div>' +
        '<div class="eb-list"></div>' +
      '</div>';

    document.body.appendChild(container);

    badgeEl = container.querySelector('.eb-badge');
    var panel = container.querySelector('.eb-panel');
    var listEl = panel.querySelector('.eb-list');
    var clearEl = panel.querySelector('.eb-clear');
    var isOpen = false;

    // 延迟出现：有错误后才显示 badge
    var showTimer = setInterval(function () {
      if (errors.length > 0) {
        badgeEl.style.opacity = '1';
        badgeEl.style.pointerEvents = 'auto';
        clearInterval(showTimer);
      }
    }, 500);

    badgeEl.addEventListener('click', function () {
      isOpen = !isOpen;
      panel.style.display = isOpen ? 'block' : 'none';
      if (isOpen) renderList();
    });

    clearEl.addEventListener('click', function () {
      errors.length = 0;
      updateBadge();
      badgeEl.style.opacity = '0';
      badgeEl.style.pointerEvents = 'none';
      isOpen = false;
      panel.style.display = 'none';
    });

    function renderList() {
      if (!listEl) return;
      if (errors.length === 0) {
        listEl.innerHTML = '<div style="color:var(--text-secondary);text-align:center;padding:16px 0;">\u6682\u65E0\u5F02\u5E38\u8BB0\u5F55</div>';
        return;
      }
      var hasError = errors.some(function(e){ return e.type !== 'WARN'; });
      var titleEl = container.querySelector('.eb-title');
      if (titleEl) {
        titleEl.textContent = hasError ? '\u26A0\uFE0F \u8FD0\u884C\u5F02\u5E38' : '\u26A0\uFE0F \u8B66\u544A\u4FE1\u606F';
        titleEl.style.color = hasError ? 'var(--color-danger-light)' : 'var(--color-warning)';
      }
      listEl.innerHTML = errors.slice().reverse().map(function (e) {
        var isWarn = e.type === 'WARN';
        var label = isWarn ? '\u26A0\uFE0F' : ({ REACT: '\uD83C\uDFEC', RENDER: '\uD83D\uDDA8\uFE0F', PROMISE: '\u23F3' }[e.type] || '\u26A0\uFE0F');
        var msg = (e.message || '').slice(0, 120);
        var loc = e.source ? e.source.split('/').pop() + ':' + e.line : '';
        var titleColor = isWarn ? 'var(--color-warning)' : 'var(--color-white)';
        return '<div style="padding:8px 0;border-bottom:0.5px solid var(--color-white-06);">' +
          '<div style="display:flex;gap:6px;align-items:flex-start;">' +
            '<span style="flex-shrink:0;">' + label + '</span>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-weight:600;font-size:var(--font-12);color:' + titleColor + ';word-break:break-word;">' + escHtml(msg) + '</div>' +
              '<div style="font-size:var(--font-10);color:var(--text-secondary);margin-top:3px;">' +
                (loc ? '<span style="margin-right:8px;">' + escHtml(loc) + '</span>' : '') +
                '<span>' + escHtml(e.time) + '</span>' +
              '</div>' +
              (e.stack ? '<pre style="font-size:var(--font-9);color:var(--color-stack-text);margin:4px 0 0;overflow-x:auto;white-space:pre-wrap;line-height:1.4;max-height:60px;">' + escHtml(e.stack) + '</pre>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===== 初始化：DOM 就绪后挂载浮层 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createOverlay);
  } else {
    createOverlay();
  }

  // ===== 暴露 =====
  w.MynoteErrors = {
    errors: errors,
    addError: addError,
    addWarn: addWarn,
    Badge: ErrorBoundary
  };

})(window);
