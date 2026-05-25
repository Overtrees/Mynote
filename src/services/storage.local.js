(function (w) {
  'use strict';

  var DraftStore = {
    KEY: 'memo_draft_',
    async save(memoId, data) {
      try {
        var db = await (w.CikeIdb ? w.CikeIdb.getDB() : null);
        if (db) {
          var tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').put({ id: memoId, data: data, updatedAt: new Date().toISOString() });
        }
      } catch (e) {}
      try {
        localStorage.setItem(this.KEY + memoId, JSON.stringify(data));
      } catch (e) {}
    },
    async load(memoId) {
      try {
        var raw = localStorage.getItem(this.KEY + memoId);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return null;
    },
    async clear(memoId) {
      try {
        localStorage.removeItem(this.KEY + memoId);
      } catch (e) {}
    }
  };

  w.CikeLocal = {
    DraftStore: DraftStore,
    // 将来可以扩展其他 localStorage 工具
  };
})(window);
