(function (w) {
  'use strict';

  var _dbInstance = null;

  function openDB() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open('MemosDB', 8);
      request.onupgradeneeded = function (e) {
        var db = e.target.result;
        // 创建缺失的 store，不删除已有数据
        if (!db.objectStoreNames.contains('attachments')) {
          db.createObjectStore('attachments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('avatars')) {
          db.createObjectStore('avatars', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('renderCaches')) {
          db.createObjectStore('renderCaches', { keyPath: 'memoId' });
        }
        if (!db.objectStoreNames.contains('memos')) {
          db.createObjectStore('memos', { keyPath: 'id' });
        }
        // v8：恢复流程的暂存区。写入这里不碰线上数据，切换时用单事务一次性提权。
        if (!db.objectStoreNames.contains('attachments_staging')) {
          db.createObjectStore('attachments_staging', { keyPath: 'id' });
        }
      };
      request.onsuccess = function (e) {
        var db = e.target.result;
        // 其它标签页请求升级时主动让位，避免升级被旧连接阻塞
        db.onversionchange = function () { try { db.close(); } catch (_) {} _dbInstance = null; };
        resolve(db);
      };
      request.onerror = function (e) { reject(e.target.error); };
    });
  }

  // ===== Memos 主存储（IndexedDB，替代 localStorage） =====
  function saveMemosToDB(db, memos) {
    if (!db || !memos) return Promise.resolve();
    var tx = db.transaction('memos', 'readwrite');
    var store = tx.objectStore('memos');
    store.clear();
    for (var mi = 0; mi < memos.length; mi++) store.put(memos[mi]);
    return new Promise(function (resolve, reject) {
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function loadMemosFromDB(db) {
    if (!db) return Promise.resolve(null);
    var tx = db.transaction('memos', 'readonly');
    var req = tx.objectStore('memos').getAll();
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getDB() {
    if (_dbInstance) return Promise.resolve(_dbInstance);
    return openDB().then(function (db) {
      _dbInstance = db;
      return db;
    });
  }

  function guessMimeFromName(fileName) {
    var ext = (fileName || '').split('.').pop().toLowerCase();
    var map = {
      jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',
      webp:'image/webp',bmp:'image/bmp',svg:'image/svg+xml',
      heic:'image/heic',heif:'image/heif',avif:'image/avif',
      mp4:'video/mp4',mov:'video/quicktime',m4v:'video/mp4',
      webm:'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',
      wav:'audio/wav',ogg:'audio/ogg',pdf:'application/pdf',
      txt:'text/plain',json:'application/json',zip:'application/zip'
    };
    return map[ext] || 'application/octet-stream';
  }
  
  function guessMimeFromBytes(bytes) {
    if (!bytes || bytes.length < 4) return null;
    var b = bytes;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x52) return 'image/webp';
    if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
    return null;
  }

  function saveAttachmentToDB(db, obj) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('attachments', 'readwrite');
      tx.objectStore('attachments').put(obj);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  function loadAttachmentFromDB(db, id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('attachments', 'readonly');
      var req = tx.objectStore('attachments').get(id);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function deleteAttachmentFromDB(db, id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('attachments', 'readwrite');
      tx.objectStore('attachments').delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  function saveAvatarToDB(db, memoId, dataUrl) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('avatars', 'readwrite');
      tx.objectStore('avatars').put({ id: memoId, dataUrl: dataUrl });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  function loadAvatarFromDB(db, memoId) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('avatars', 'readonly');
      var req = tx.objectStore('avatars').get(memoId);
      req.onsuccess = function () { resolve(req.result ? req.result.dataUrl : null); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function saveRenderCacheToDB(db, memoId, cache) {
    if (!db || !memoId) return Promise.resolve();
    try {
      var tx = db.transaction('renderCaches', 'readwrite');
      tx.objectStore('renderCaches').put({ memoId: memoId, cache: cache, updatedAt: Date.now() });
      return new Promise(function (resolve, reject) {
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    } catch (e) { return Promise.resolve(); }
  }

  function loadRenderCacheFromDB(db, memoId) {
    if (!db || !memoId) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var tx = db.transaction('renderCaches', 'readonly');
      var req = tx.objectStore('renderCaches').get(memoId);
      req.onsuccess = function () { resolve(req.result ? req.result.cache : null); };
      req.onerror = function () { resolve(null); };
    });
  }

  function createThumbnail(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var size = 200;
          var canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          var side = Math.min(img.width, img.height);
          var sx = (img.width - side) / 2;
          var sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  function dataURLtoBlob(dataURL) {
    try {
      var arr = dataURL.split(',');
      if (arr.length < 2) return null;
      var mimeMatch = arr[0].match(/:(.*?);/);
      if (!mimeMatch) return null;
      var mime = mimeMatch[1];
      var bstr = atob(arr[1]);
      var n = bstr.length;
      var u8arr = new Uint8Array(n);
      for (var i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
      return new Blob([u8arr], { type: mime });
    } catch (e) { return null; }
  }

  async function packAttachmentsToZip(db, zipData, onProgress) {
    var allKeys = await new Promise(function (res, rej) {
      var tx = db.transaction('attachments', 'readonly');
      var req = tx.objectStore('attachments').getAllKeys();
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
    // 分批并发：串行读 base64 再解码在大备份上非常慢，4 路并发约快 2-3 倍
    var CONCURRENCY = 4;
    for (var i = 0; i < allKeys.length; i += CONCURRENCY) {
      if (onProgress) onProgress(Math.min(i + CONCURRENCY, allKeys.length), allKeys.length);
      var batch = allKeys.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async function (key) {
        try {
          var record = await loadAttachmentFromDB(db, key);
          if (!record || !record.url) return;
          var parts = record.url.split(',');
          if (parts.length < 2) return;
          var binStr = atob(parts[1]);
          var buf = new Uint8Array(binStr.length);
          for (var j = 0; j < binStr.length; j++) buf[j] = binStr.charCodeAt(j);
          // 文件名只用 id：真实文件名与 MIME 记在 manifest.json，避免中文名/下划线 id 破坏解析
          zipData['attachments/' + key] = buf;
        } catch (e) {
          if (typeof w.warn === 'function') w.warn('打包附件失败: ' + key, e);
        }
      }));
    }
  }

  async function restoreAttachmentsFromZip(unzipped, db) {
    var attPaths = Object.keys(unzipped).filter(function (k) { return k.startsWith('attachments/'); });
    var man = parseBackupManifest(unzipped);
    var success = 0, fail = 0;
    for (var ai = 0; ai < attPaths.length; ai++) {
      var attPath = attPaths[ai];
      var bytes = unzipped[attPath];
      if (!bytes) continue;
      try {
        var fileName = attPath.replace('attachments/', '');
        var manMap = man.attachments || {};
        var fileId = resolveAttachmentId(fileName, manMap);
        var displayName = fileId === fileName ? fileName : fileName.slice(fileId.length + 1);
        var manAtt = (man.attachments || {})[fileId];
        if (manAtt && manAtt.name) displayName = manAtt.name;
        var mime = (manAtt && manAtt.type) || guessMimeFromName(displayName);
        if (mime === 'application/octet-stream') { var bm = guessMimeFromBytes(bytes); if (bm) mime = bm; }
        var blob = new Blob([bytes], { type: mime });
        var dataUrl = await new Promise(function (res) {
          var reader = new FileReader();
          reader.onload = function () { res(reader.result); };
          reader.readAsDataURL(blob);
        });
        await deleteAttachmentFromDB(db, fileId).catch(function () {});
        var regenThumb = await createThumbnail(dataUrl).catch(function () { return null; });
        await saveAttachmentToDB(db, {
          id: fileId, name: displayName, type: mime, url: dataUrl, thumb: regenThumb
        });
        success++;
      } catch (attErr) {
        console.error('附件恢复失败:', attPath, attErr);
        fail++;
      }
    }
    return { success: success, fail: fail };
  }

  async function restoreAvatars(avatars, db) {
    if (!avatars) return;
    for (var memoId in avatars) {
      if (!avatars.hasOwnProperty(memoId)) continue;
      try {
        var tx = db.transaction('avatars', 'readwrite');
        tx.objectStore('avatars').put({ id: memoId, dataUrl: avatars[memoId] });
        await new Promise(function (res, rej) {
          tx.oncomplete = res;
          tx.onerror = rej;
        });
      } catch (_) {
        if (typeof w.warn === 'function') w.warn('头像恢复失败', _);
      }
    }
  }


  // ===== 恢复流程：暂存 → 单事务切换（v8） =====
  // 设计约束：IndexedDB 事务内不能 await 非 IDB 的 Promise（FileReader / Image onload），
  // 否则事务会因微任务队列耗尽而提前结束。所以所有解码/缩略图都在事务外算完，写进 staging，
  // 最后用一个跨 store 的事务原子地完成「清空 → 提权 → 写文档 → 写头像」。

  function strFromU8Safe(bytes) {
    try { return new TextDecoder('utf-8').decode(bytes); } catch (_) { return ''; }
  }

  // 从 zip 内文件名反解附件 id：新备份=完整 id；旧备份=id_name（id 自身可能含下划线）
  function resolveAttachmentId(fileName, manMap) {
    manMap = manMap || {};
    if (manMap[fileName]) return fileName;
    var best = null;
    var keys = Object.keys(manMap);
    for (var k = 0; k < keys.length; k++) {
      if (fileName.indexOf(keys[k] + '_') === 0 && (!best || keys[k].length > best.length)) best = keys[k];
    }
    if (best) return best;
    var us = fileName.indexOf('_');
    return us > 0 ? fileName.slice(0, us) : fileName;
  }

  function parseBackupManifest(unzipped) {
    var raw = unzipped && unzipped['manifest.json'];
    if (!raw) return { attachments: {} };
    try {
      var j = JSON.parse(strFromU8Safe(raw));
      return { attachments: (j && j.attachments) || {} };
    } catch (_) { return { attachments: {} }; }
  }

  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) {
      var reader = new FileReader();
      reader.onload = function () { res(reader.result); };
      reader.onerror = function () { rej(reader.error || new Error('读取附件失败')); };
      reader.readAsDataURL(blob);
    });
  }

  function clearStore(db, storeName) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('清空失败')); };
    });
  }

  function putOne(db, storeName, record) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('写入失败')); };
    });
  }

  // 由 zip 内路径 + manifest 生成一条附件记录（与 attachments store 结构一致）
  async function buildAttachmentRecord(relPath, bytes, manifestAtt, manifestAtts) {
    if (!bytes) throw new Error('附件内容为空');
    var fileName = relPath.replace('attachments/', '');
    // 新备份的文件名就是完整 id（id 本身可能含下划线）；旧备份是 id_name → 由 resolveAttachmentId 兼容
    var fileId = resolveAttachmentId(fileName, manifestAtts);
    var displayName = fileId === fileName ? fileName : fileName.slice(fileId.length + 1);
    // 旧备份把文件名塞在 id_name 里；新备份只写 id，真实名字在 manifest（优先）
    if (manifestAtt && manifestAtt.name) displayName = manifestAtt.name;
    var mime = (manifestAtt && manifestAtt.type) || guessMimeFromName(displayName);
    if (!mime || mime === 'application/octet-stream') {
      var bm = guessMimeFromBytes(bytes);
      if (bm) mime = bm;
    }
    var blob = new Blob([bytes], { type: mime });
    var dataUrl = await blobToDataUrl(blob);
    var thumb = await createThumbnail(dataUrl).catch(function () { return null; });
    return { id: fileId, name: displayName, type: mime, url: dataUrl, thumb: thumb };
  }

  async function stageRestoreFromZip(db, unzipped, onProgress) {
    await clearStore(db, 'attachments_staging');
    var manifest = parseBackupManifest(unzipped);
    var paths = Object.keys(unzipped || {}).filter(function (k) { return k.indexOf('attachments/') === 0; });
    var staged = 0, failed = 0, failures = [];
    for (var i = 0; i < paths.length; i++) {
      if (onProgress) onProgress(i, paths.length);
      var relPath = paths[i];
      try {
        var fileName = relPath.replace('attachments/', '');
        var us = fileName.indexOf('_');
        var fid = resolveAttachmentId(fileName, manifest.attachments || {});
        var rec = await buildAttachmentRecord(relPath, unzipped[relPath], (manifest.attachments || {})[fid], manifest.attachments || {});
        await putOne(db, 'attachments_staging', rec);
        staged++;
      } catch (e) {
        failed++;
        failures.push({ path: relPath, error: (e && e.message) || String(e) });
      }
    }
    return { staged: staged, failed: failed, failures: failures, total: paths.length };
  }

  function commitStagedRestore(db, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var names = ['attachments', 'attachments_staging', 'memos'];
      if (opts.avatars) names.push('avatars');
      var tx;
      try { tx = db.transaction(names, 'readwrite'); }
      catch (e) { reject(e); return; }
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('恢复事务被中止，已回滚')); };
      tx.oncomplete = function () { resolve({ memos: (opts.memos || []).length }); };

      try {
        var att = tx.objectStore('attachments');
        var staging = tx.objectStore('attachments_staging');
        att.clear();
        staging.openCursor().onsuccess = function (e) {
          var cur = e.target.result;
          if (!cur) return;
          att.put(cur.value);
          staging.delete(cur.primaryKey);
          cur.continue();
        };
        var ms = tx.objectStore('memos');
        ms.clear();
        for (var i = 0; i < (opts.memos || []).length; i++) ms.put(opts.memos[i]);
        if (opts.avatars) {
          var av = tx.objectStore('avatars');
          Object.keys(opts.avatars).forEach(function (k) { av.put({ id: k, dataUrl: opts.avatars[k] }); });
        }
      } catch (queueErr) {
        // 队列中途抛错（如脏数据缺 keyPath）时事务不会自动回滚，必须显式 abort
        try { tx.abort(); } catch (_) {}
        reject(queueErr);
      }
    });
  }

  async function restoreFromZipAtomic(db, unzipped, backup, opts) {
    opts = opts || {};
    backup = backup || {};
    // 配额预检：staging 期间附件会临时存两份
    var need = 0;
    Object.keys(unzipped || {}).forEach(function (k) {
      if (k.indexOf('attachments/') === 0) need += (unzipped[k] && unzipped[k].length) || 0;
    });
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var est = await navigator.storage.estimate();
        var free = (est.quota || 0) - (est.usage || 0);
        if (est.quota && free < need * 2.2) throw new Error('设备剩余空间不足，请清理后重试');
      }
    } catch (quotaErr) {
      if (quotaErr && /空间不足/.test(quotaErr.message)) throw quotaErr;
    }
    var st = await stageRestoreFromZip(db, unzipped, opts.onProgress);
    if (st.failed > 0 && !opts.allowPartial) {
      await clearStore(db, 'attachments_staging');
      throw new Error('有 ' + st.failed + ' 个附件无法解析，已取消恢复，本机数据未改动');
    }
    await commitStagedRestore(db, { memos: backup.memos || [], avatars: backup.avatars || null });
    return { staged: st.staged, failed: st.failed, failures: st.failures };
  }

  w.MynoteIdb = {
    getDB: getDB,
    openDB: openDB,
    guessMimeFromName: guessMimeFromName,
    guessMimeFromBytes: guessMimeFromBytes,
    saveAttachmentToDB: saveAttachmentToDB,
    loadAttachmentFromDB: loadAttachmentFromDB,
    deleteAttachmentFromDB: deleteAttachmentFromDB,
    saveAvatarToDB: saveAvatarToDB,
    loadAvatarFromDB: loadAvatarFromDB,
    saveRenderCacheToDB: saveRenderCacheToDB,
    loadRenderCacheFromDB: loadRenderCacheFromDB,
    createThumbnail: createThumbnail,
    dataURLtoBlob: dataURLtoBlob,
    packAttachmentsToZip: packAttachmentsToZip,
    restoreAttachmentsFromZip: restoreAttachmentsFromZip,
    restoreAvatars: restoreAvatars,
    saveMemosToDB: saveMemosToDB,
    loadMemosFromDB: loadMemosFromDB,
    clearStore: clearStore,
    stageRestoreFromZip: stageRestoreFromZip,
    commitStagedRestore: commitStagedRestore,
    restoreFromZipAtomic: restoreFromZipAtomic
  };
})(window);
