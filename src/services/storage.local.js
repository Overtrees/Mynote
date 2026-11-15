(function (w) {
  'use strict';

  var DraftStore = {
    KEY: 'memo_draft_',
    async save(memoId, data) {
      try {
        var db = await (w.MynoteIdb ? w.MynoteIdb.getDB() : null);
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
      // localStorage 命中失败 / 被禁用时回退 IDB（save 双写，load 也应双读）
      try {
        var db = await (w.MynoteIdb ? w.MynoteIdb.getDB() : null);
        if (!db) return null;
        return await new Promise(function (resolve) {
          var tx;
          try { tx = db.transaction('drafts', 'readonly'); } catch (err) { resolve(null); return; }
          var req = tx.objectStore('drafts').get(memoId);
          req.onsuccess = function () { resolve(req.result ? req.result.data : null); };
          req.onerror = function () { resolve(null); };
        });
      } catch (e) { return null; }
    },
    async clear(memoId) {
      try {
        localStorage.removeItem(this.KEY + memoId);
      } catch (e) { console.warn('[DraftStore] localStorage clear', e); }
      try {
        var db = await (w.MynoteIdb ? w.MynoteIdb.getDB() : null);
        if (!db) return;
        var tx = db.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').delete(memoId);
      } catch (e) { console.warn('[DraftStore] IDB clear', e); }
    }
  };

  w.MynoteLocal = {
    DraftStore: DraftStore
  };
})(window);
