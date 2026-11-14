/* 启动页：兼容旧配置入口，并控制 6 秒后进入主应用。 */
window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};
(function () {
  'use strict';
  var seconds = 6;
  var el = document.getElementById('countdown');
  var timer = setInterval(function () {
    seconds--;
    if (seconds <= 0) {
      clearInterval(timer);
      window.location.replace('Moments.html');
    } else {
      el.textContent = seconds + ' 秒后自动进入';
    }
  }, 1000);
})();
