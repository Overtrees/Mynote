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
      } catch (e) { console.warn('[DraftStore] IDB save', e); }
      try {
        localStorage.setItem(this.KEY + memoId, JSON.stringify(data));
      } catch (e) { console.warn('[DraftStore] localStorage save', e); }
    },
    async load(memoId) {
      try {
        var raw = localStorage.getItem(this.KEY + memoId);
        if (raw) return JSON.parse(raw);
      } catch (e) { console.warn('[DraftStore] load', e); }
      return null;
    },
    async clear(memoId) {
      try {
        localStorage.removeItem(this.KEY + memoId);
      } catch (e) { console.warn('[DraftStore] clear', e); }
    }
  };

  w.CikeLocal = {
    DraftStore: DraftStore,
    // 将来可以扩展其他 localStorage 工具
  };
})(window);
