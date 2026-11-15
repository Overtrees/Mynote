/* 斜杠命令过滤 / 分组：纯函数，不改写共享 defs。 */
(function (w) {
  'use strict';

  var GROUP_LABELS = { basic: '基础块', media: '媒体块' };
  var GROUP_ORDER = ['basic', 'media'];

  function filter(defs, query, recentIds) {
    defs = defs || [];
    var q = String(query || '').trim().toLowerCase();
    var all = defs.slice();
    if (q) {
      var searchStr = function (cmd) {
        return (cmd.title + ' ' + cmd.subtitle + ' ' + cmd.keywords + ' ' + cmd.type + (cmd.pinyin || '')).toLowerCase();
      };
      return all.filter(function (cmd) { return searchStr(cmd).includes(q); }).sort(function (a, b) {
        var aStarts = (a.title + ' ' + (a.keywords || '')).toLowerCase().startsWith(q) || (a.pinyin || '').startsWith(q) ? 0 : 1;
        var bStarts = (b.title + ' ' + (b.keywords || '')).toLowerCase().startsWith(q) || (b.pinyin || '').startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.title.localeCompare(b.title, 'zh-Hans-CN');
      }).map(function (c) {
        return Object.assign({}, c, { sectionLabel: null, recent: false });
      });
    }
    var result = [];
    var recent = Array.isArray(recentIds) ? recentIds : [];
    if (recent.length > 0) {
      var order = new Map();
      recent.forEach(function (id, i) { order.set(id, i); });
      var recentCmds = all.filter(function (cmd) { return order.has(cmd.id); }).sort(function (a, b) {
        return order.get(a.id) - order.get(b.id);
      }).map(function (cmd) {
        return Object.assign({}, cmd, { recent: true, sectionLabel: '最近使用' });
      });
      var rest = all.filter(function (cmd) { return !order.has(cmd.id); });
      var seenRecent = recentCmds.length > 0;
      GROUP_ORDER.forEach(function (g) {
        var groupItems = rest.filter(function (cmd) { return cmd.group === g; }).map(function (c) {
          return Object.assign({}, c, { sectionLabel: GROUP_LABELS[g] });
        });
        var addRecent = seenRecent && result.length === 0 && recentCmds.length > 0;
        if (addRecent) result.push.apply(result, recentCmds);
        result.push.apply(result, groupItems);
      });
      if (result.length === 0) {
        // 兜底：全部命令（拷贝，不带分组头）
        result = all.map(function (c) { return Object.assign({}, c, { sectionLabel: GROUP_LABELS[c.group] || null }); });
      }
    } else {
      GROUP_ORDER.forEach(function (g) {
        var groupItems = all.filter(function (cmd) { return cmd.group === g; }).map(function (c) {
          return Object.assign({}, c, { sectionLabel: GROUP_LABELS[g] });
        });
        result.push.apply(result, groupItems);
      });
    }
    return result;
  }

  w.MynoteSlashModel = {
    filter: filter,
    GROUP_LABELS: GROUP_LABELS,
    GROUP_ORDER: GROUP_ORDER
  };
})(window);
