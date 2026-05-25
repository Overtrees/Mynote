(function (w) {
  'use strict';

  var _dbInstance = null;

  function openDB() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open('MemosDB', 7);
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
      };
      request.onsuccess = function (e) { resolve(e.target.result); };
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
    var tx = db.transaction('renderCaches', 'readwrite');
    tx.objectStore('renderCaches').put({ memoId: memoId, cache: cache, updatedAt: Date.now() });
    return new Promise(function (resolve, reject) {
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
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
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var size = 200;
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2;
        var sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.src = dataUrl;
    });
  }

  function dataURLtoBlob(dataURL) {
    var arr = dataURL.split(',');
    var mime = arr[0].match(/:(.*?);/)[1];
    var bstr = atob(arr[1]);
    var n = bstr.length;
    var u8arr = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
    return new Blob([u8arr], { type: mime });
  }

  async function packAttachmentsToZip(db, zipData, onProgress) {
    var allKeys = await new Promise(function (res, rej) {
      var tx = db.transaction('attachments', 'readonly');
      var req = tx.objectStore('attachments').getAllKeys();
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
    for (var i = 0; i < allKeys.length; i++) {
      if (onProgress) onProgress(i, allKeys.length);
      var record = await loadAttachmentFromDB(db, allKeys[i]);
      if (record && record.url) {
        var binStr = atob(record.url.split(',')[1]);
        var buf = new Uint8Array(binStr.length);
        for (var j = 0; j < binStr.length; j++) buf[j] = binStr.charCodeAt(j);
        var safeName = (record.name || allKeys[i]).replace(/[/\\:*?"<>|]/g, '_');
        zipData['attachments/' + allKeys[i] + '_' + safeName] = buf;
      }
    }
  }

  async function restoreAttachmentsFromZip(unzipped, db) {
    var attPaths = Object.keys(unzipped).filter(function (k) { return k.startsWith('attachments/'); });
    var success = 0, fail = 0;
    for (var ai = 0; ai < attPaths.length; ai++) {
      var attPath = attPaths[ai];
      var bytes = unzipped[attPath];
      if (!bytes) continue;
      try {
        var fileName = attPath.replace('attachments/', '');
        var firstUnderscore = fileName.indexOf('_');
        var fileId, displayName;
        if (firstUnderscore > 0) {
          fileId = fileName.slice(0, firstUnderscore);
          displayName = fileName.slice(firstUnderscore + 1);
        } else {
          fileId = fileName;
          displayName = fileName;
        }
        var mime = guessMimeFromName(displayName);
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

  w.CikeIdb = {
    getDB: getDB,
    openDB: openDB,
    guessMimeFromName: guessMimeFromName,
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
    loadMemosFromDB: loadMemosFromDB
  };
})(window);
