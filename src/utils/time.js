(function (w) {
  function is24hFormat() {
    try {
      return !new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
        .formatToParts(new Date(2024, 0, 1, 13))
        .some(function (p) { return p.type === 'dayPeriod'; });
    } catch (_) {
      return false;
    }
  }

  function timeAgo(iso) {
    if (!iso) return '现在';
    var d = new Date(iso);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var yesterday = new Date(today.getTime() - 86400000);

    if (d >= today) {
      var h = d.getHours();
      var m = String(d.getMinutes()).padStart(2, '0');
      if (is24hFormat()) {
        return String(h).padStart(2, '0') + ':' + m;
      }
      var ampm = h < 12 ? '上午' : '下午';
      var h12 = h % 12 || 12;
      return ampm + ' ' + h12 + ':' + m;
    }

    if (d >= yesterday) return '昨天';
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '/' + d.getDate();
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  w.CikeTime = {
    is24hFormat: is24hFormat,
    timeAgo: timeAgo
  };
})(window);
