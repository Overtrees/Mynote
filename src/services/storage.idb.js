(function (w) {
  'use strict';

  var _dbInstance = null;
  var _memoWriteQueue = Promise.resolve();
  // A per-tab baseline lets saves apply only this tab's changes, preserving unrelated commits from other tabs.
  var _memoBaseline = null;

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
  function memoSnapshotMap(memos) {
    var map = Object.create(null);
    (memos || []).forEach(function (memo) {
      if (memo && typeof memo.id === 'string') map[memo.id] = JSON.stringify(memo);
    });
    return map;
  }

  function saveMemosToDB(db, memos) {
    if (!db || !Array.isArray(memos)) return Promise.resolve();
    var snapshot = memos.map(function (m) { return m; });
    var incomingMap = memoSnapshotMap(snapshot);
    var write = _memoWriteQueue.catch(function () {}).then(function () {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction('memos', 'readwrite'); }
        catch (error) { reject(error); return; }
        var store = tx.objectStore('memos');
        var req = store.getAll();
        req.onerror = function () { try { tx.abort(); } catch (_) {} };
        req.onsuccess = function () {
          try {
            var current = req.result || [];
            var firstWrite = !_memoBaseline;
            if (firstWrite) {
              // 首次写入：只 put incoming，不 delete 既有行。
              // 否则 load 失败后一次 saveMemo 会把库里其它笔记清掉。
              snapshot.forEach(function (memo) {
                if (!memo || typeof memo.id !== 'string') throw new Error('笔记缺少有效 ID');
                store.put(memo);
              });
            } else {
              Object.keys(_memoBaseline).forEach(function (id) {
                if (!Object.prototype.hasOwnProperty.call(incomingMap, id)) store.delete(id);
              });
              snapshot.forEach(function (memo) {
                if (!memo || typeof memo.id !== 'string') throw new Error('笔记缺少有效 ID');
                var serialized = incomingMap[memo.id];
                if (!Object.prototype.hasOwnProperty.call(_memoBaseline, memo.id) || _memoBaseline[memo.id] !== serialized) store.put(memo);
              });
            }
            tx.__firstWrite = firstWrite;
            tx.__currentSnapshot = current;
          } catch (error) { try { tx.abort(); } catch (_) {} reject(error); }
        };
        tx.oncomplete = function () {
          if (tx.__firstWrite) {
            var merged = memoSnapshotMap(tx.__currentSnapshot);
            Object.assign(merged, incomingMap);
            _memoBaseline = merged;
          } else {
            _memoBaseline = incomingMap;
          }
          resolve();
        };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('笔记保存事务中止')); };
      });
    });
    _memoWriteQueue = write;
    return write;
  }

  function loadMemosFromDB(db) {
    if (!db) return Promise.resolve(null);
    return _memoWriteQueue.catch(function () {}).then(function () {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction('memos', 'readonly'); }
        catch (error) { reject(error); return; }
        var req = tx.objectStore('memos').getAll();
        req.onsuccess = function () {
          _memoBaseline = memoSnapshotMap(req.result || []);
          resolve(req.result);
        };
        req.onerror = function () { reject(req.error); };
      });
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

  /**
   * 逐个产出附件字节，不在主线程堆整个 zipData。
   * onFile(name, uint8) 返回 Promise；并发 2，峰值内存 ≈ 2 个附件。
   */
  async function forEachAttachmentBytes(db, onFile, onProgress) {
    var allKeys = await new Promise(function (res, rej) {
      var tx = db.transaction('attachments', 'readonly');
      var req = tx.objectStore('attachments').getAllKeys();
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
    var CONCURRENCY = 2;
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
          await onFile('attachments/' + key, buf);
        } catch (e) {
          if (typeof w.warn === 'function') w.warn('读取附件失败: ' + key, e);
        }
      }));
    }
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
  function resolveAttachmentId(fileName, manMap, expectedIds) {
    manMap = manMap || {};
    if (manMap[fileName]) return fileName;
    var best = null;
    var keys = Object.keys(manMap);
    for (var k = 0; k < keys.length; k++) {
      if (fileName.indexOf(keys[k] + '_') === 0 && (!best || keys[k].length > best.length)) best = keys[k];
    }
    if (best) return best;
    var expected = null;
    (expectedIds || []).forEach(function (id) {
      if ((fileName === id || fileName.indexOf(id + '_') === 0) && (!expected || id.length > expected.length)) expected = id;
    });
    if (expected) return expected;
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
  async function buildAttachmentRecord(relPath, bytes, manifestAtt, manifestAtts, expectedIds) {
    if (!bytes) throw new Error('附件内容为空');
    var fileName = relPath.replace('attachments/', '');
    // 新备份的文件名就是完整 id（id 本身可能含下划线）；旧备份是 id_name → 由 resolveAttachmentId 兼容
    var fileId = resolveAttachmentId(fileName, manifestAtts, expectedIds);
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

  async function stageRestoreFromZip(db, unzipped, onProgress, expectedIds) {
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
        var fid = resolveAttachmentId(fileName, manifest.attachments || {}, expectedIds);
        var rec = await buildAttachmentRecord(relPath, unzipped[relPath], (manifest.attachments || {})[fid], manifest.attachments || {}, expectedIds);
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
    var write = _memoWriteQueue.catch(function () {}).then(function () {
      return new Promise(function (resolve, reject) {
      var names = ['attachments', 'attachments_staging', 'memos'];
      if (opts.avatars) names.push('avatars');
      var tx;
      try { tx = db.transaction(names, 'readwrite'); }
      catch (e) { reject(e); return; }
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('恢复事务被中止，已回滚')); };
      tx.oncomplete = function () {
        // 恢复提交后立即采纳新快照为 baseline，防止旧 baseline 把恢复前状态写回。
        _memoBaseline = memoSnapshotMap(opts.memos || []);
        resolve({ memos: (opts.memos || []).length });
      };

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
    });
    _memoWriteQueue = write;
    return write;
  }


  // Validate ZIP directory and local headers before bounded streaming decompression.
  function validateZipInput(bytes, limits) {
    limits = limits || {};
    var maxCompressed = limits.maxCompressed || 50 * 1024 * 1024;
    var maxExpanded = limits.maxExpanded || 200 * 1024 * 1024;
    var maxFile = limits.maxFile || 50 * 1024 * 1024;
    var maxEntries = limits.maxEntries || 3000;
    if (!bytes || bytes.length < 22 || bytes.length > maxCompressed) throw new Error('ZIP 大小超出安全限制');
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var start = Math.max(0, bytes.length - 65557), eocd = -1;
    for (var i = bytes.length - 22; i >= start; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('ZIP 目录损坏或格式不受支持');
    var count = view.getUint16(eocd + 10, true), cdSize = view.getUint32(eocd + 12, true), cdOffset = view.getUint32(eocd + 16, true);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('暂不支持 ZIP64 备份');
    if (count > maxEntries || cdOffset + cdSize > eocd || cdOffset + cdSize > bytes.length) throw new Error('ZIP 文件数量或目录异常');
    if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0 ||
        view.getUint16(eocd + 8, true) !== count || view.getUint16(eocd + 20, true) !== bytes.length - eocd - 22) throw new Error('ZIP 多磁盘或 EOCD 长度异常');
    if (eocd + 22 + view.getUint16(eocd + 20, true) !== bytes.length) throw new Error('ZIP 尾部数据不受支持');
    var cursor = cdOffset, total = 0, decoder = new TextDecoder('utf-8'), names = Object.create(null), ranges = [];
    for (var n = 0; n < count; n++) {
      if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('ZIP 目录项损坏');
      var flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
      var crc = view.getUint32(cursor + 16, true), packed = view.getUint32(cursor + 20, true), expanded = view.getUint32(cursor + 24, true);
      var nameLen = view.getUint16(cursor + 28, true), extraLen = view.getUint16(cursor + 30, true), commentLen = view.getUint16(cursor + 32, true), localOffset = view.getUint32(cursor + 42, true);
      var nameEnd = cursor + 46 + nameLen;
      if (nameEnd + extraLen + commentLen > bytes.length || packed === 0xffffffff || expanded === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64 或目录长度异常');
      if ((flags & 1) || (method !== 0 && method !== 8)) throw new Error('ZIP 加密或压缩格式不受支持');
      var name = decoder.decode(bytes.subarray(cursor + 46, nameEnd));
      if (!name || name.indexOf('\0') >= 0 || name.charAt(0) === '/' || name.indexOf('\\') >= 0 || name.split('/').some(function (part) { return part === '..' || part === '__proto__' || part === 'prototype' || part === 'constructor'; })) throw new Error('ZIP 包含不安全路径');
      if (names[name]) throw new Error('ZIP 包含重复文件路径');
      names[name] = true;
      if (expanded > maxFile) throw new Error('ZIP 单个文件超过安全限制');
      total += expanded;
      if (total > maxExpanded) throw new Error('ZIP 解压后总大小超过安全限制');
      if (localOffset + 30 > cdOffset || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('ZIP 本地文件头损坏');
      var localFlags = view.getUint16(localOffset + 6, true), localMethod = view.getUint16(localOffset + 8, true);
      var localCrc = view.getUint32(localOffset + 14, true), localPacked = view.getUint32(localOffset + 18, true), localExpanded = view.getUint32(localOffset + 22, true);
      var localNameLen = view.getUint16(localOffset + 26, true), localExtraLen = view.getUint16(localOffset + 28, true);
      var dataStart = localOffset + 30 + localNameLen + localExtraLen;
      var localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLen));
      if (localName !== name || localFlags !== flags || localMethod !== method || dataStart + packed > cdOffset) throw new Error('ZIP 本地头与目录不一致');
      // Bit 3 permits zero sizes in the local header; if populated, they must match the central directory.
      if (!(flags & 8) && (localCrc !== crc || localPacked !== packed || localExpanded !== expanded)) throw new Error('ZIP 本地长度与目录不一致');
      if ((flags & 8) && ((localPacked && localPacked !== packed) || (localExpanded && localExpanded !== expanded) || (localCrc && localCrc !== crc))) throw new Error('ZIP 数据描述符长度不一致');
      ranges.push([localOffset, dataStart + packed]);
      cursor = nameEnd + extraLen + commentLen;
    }
    if (cursor !== cdOffset + cdSize) throw new Error('ZIP 目录长度不匹配');
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    for (var ri = 1; ri < ranges.length; ri++) if (ranges[ri][0] < ranges[ri - 1][1]) throw new Error('ZIP 文件数据区域重叠');
    return { entries: count, expandedBytes: total };
  }

  function validateBackupData(backup, limits) {
    limits = limits || {};
    var maxMemos = limits.maxMemos || 20000, maxNodes = limits.maxNodes || 200000, maxDepth = limits.maxDepth || 40;
    var maxString = limits.maxString || 2 * 1024 * 1024, maxTotalText = limits.maxTotalText || 30 * 1024 * 1024;
    if (!backup || typeof backup !== 'object' || Array.isArray(backup) || !Array.isArray(backup.memos)) throw new Error('无效的备份结构');
    // v1/v2 are supported; missing version is the pre-versioned legacy format.
    if (backup.version != null && (!Number.isInteger(backup.version) || backup.version < 1 || backup.version > 2)) throw new Error('不支持的备份版本');
    if (backup.memos.length > maxMemos) throw new Error('备份笔记数量超过安全限制');
    var nodes = 0, textBytes = 0;
    function safeUrl(value, key) {
      if (typeof value !== 'string' || !value) return;
      var trimmed = value.trim();
      if (/^(src|cover|image|url|href|musicUrl)$/i.test(key)) {
        if (/^https?:\/\//i.test(trimmed)) return;
        if (/^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i.test(trimmed)) return;
        throw new Error('备份包含不安全的链接地址');
      }
    }
    function walk(value, depth, key) {
      if (++nodes > maxNodes || depth > maxDepth) throw new Error('备份结构过深或项目过多');
      if (typeof value === 'string') {
        textBytes += value.length * 2;
        if (value.length > maxString || textBytes > maxTotalText) throw new Error('备份文本超过安全限制');
        safeUrl(value, key || '');
        return;
      }
      if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
      if (typeof value !== 'object') throw new Error('备份包含不支持的数据类型');
      if (Array.isArray(value)) {
        if (value.length > 50000) throw new Error('备份数组过大');
        value.forEach(function (v) { walk(v, depth + 1, ''); });
        return;
      }
      var keys = Object.keys(value);
      if (keys.length > 256) throw new Error('备份对象字段过多');
      keys.forEach(function (k) {
        if (k === '__proto__' || k === 'prototype' || k === 'constructor') throw new Error('备份包含不安全字段');
        walk(value[k], depth + 1, k);
      });
    }
    var currentBlockTypes = { paragraph: true, heading: true, quote: true, todo: true, divider: true, image: true, gallery: true, imgTextCard: true, imageTextRow: true, musicCard: true, embedCard: true, attachment: true, 'link-card': true };
    function validId(value, max, allowEmpty) { return typeof value === 'string' && (allowEmpty && value === '' || new RegExp('^[A-Za-z0-9_-]{1,' + max + '}$').test(value)); }
    function requireString(value, label) { if (value != null && typeof value !== 'string') throw new Error(label + '格式无效'); }
    function validateNode(node, nesting) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('正文块格式无效');
      if (nesting > maxDepth) throw new Error('正文块嵌套过深');
      if (node.id != null && !validId(node.id, 128, false)) throw new Error('正文块 ID 无效');
      if (node.fileId != null && !validId(node.fileId, 256, false)) throw new Error('附件 ID 无效');
      if (node.type != null && (typeof node.type !== 'string' || node.type.length > 80)) throw new Error('正文块类型无效');
      var type = node.type || 'paragraph';
      // Unknown historical block types remain importable: renderer safely degrades them to text.
      if (!currentBlockTypes[type]) return;
      if (node.attrs != null && (!node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs))) throw new Error('正文块属性格式无效');
      var attrs = node.attrs || {};
      if (node.children != null) {
        if (!Array.isArray(node.children) || node.children.length > 5000) throw new Error('正文块子项格式无效');
        node.children.forEach(function (child) {
          if (!child || typeof child !== 'object' || Array.isArray(child)) throw new Error('正文块文本子项无效');
          requireString(child.text, '正文块文本');
          if (child.children != null) {
            if (!Array.isArray(child.children) || child.children.length > 5000) throw new Error('嵌套正文块子项格式无效');
            child.children.forEach(function (nested) { if (nested && typeof nested === 'object' && nested.type) validateNode(nested, nesting + 1); });
          }
        });
      }
      if (type === 'heading' && attrs.level != null && (!Number.isInteger(attrs.level) || attrs.level < 1 || attrs.level > 6)) throw new Error('标题级别无效');
      if (type === 'todo' && attrs.checked != null && typeof attrs.checked !== 'boolean') throw new Error('待办状态格式无效');
      if (type === 'image' || type === 'imgTextCard' || type === 'imageTextRow') {
        if (attrs.fileId != null && !validId(attrs.fileId, 256, true)) throw new Error('图片附件 ID 无效');
        if (type === 'image') requireString(attrs.src, '图片地址');
        if (type === 'image') requireString(attrs.alt, '图片替代文本');
      }
      if (type === 'gallery' && attrs.items != null) {
        if (!Array.isArray(attrs.items) || attrs.items.length > 5000) throw new Error('画廊项目格式无效');
        attrs.items.forEach(function (item) {
          if (typeof item === 'string') {
            if (!validId(item, 256, false) && !/^https?:\/\//i.test(item) && !/^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i.test(item)) throw new Error('画廊图片项目无效');
          } else if (item && typeof item === 'object' && !Array.isArray(item)) {
            if (item.fileId != null && !validId(item.fileId, 256, false)) throw new Error('画廊附件 ID 无效');
            requireString(item.url, '画廊图片地址'); requireString(item.alt, '画廊替代文本');
          } else throw new Error('画廊项目格式无效');
        });
      }
      if (type === 'musicCard' || type === 'link-card' || type === 'embedCard') {
        requireString(node.url, '卡片链接');
        if (node.status != null && !['empty', 'input', 'loading', 'ready', 'error', 'done'].includes(node.status)) throw new Error('卡片状态无效');
        if (node.meta != null && (!node.meta || typeof node.meta !== 'object' || Array.isArray(node.meta))) throw new Error('卡片元数据格式无效');
        if (node.meta) ['title', 'subtitle', 'source', 'description', 'siteName', 'favicon'].forEach(function (key) { requireString(node.meta[key], '卡片元数据'); });
      }
      if (type === 'attachment' && node.image != null && typeof node.image !== 'boolean') throw new Error('附件类型标记无效');
    }
    var memoIds = Object.create(null);
    backup.memos.forEach(function (memo) {
      if (!memo || typeof memo !== 'object' || Array.isArray(memo)) throw new Error('备份中有无效笔记');
      if (typeof memo.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(memo.id)) throw new Error('备份笔记缺少有效 ID');
      if (memoIds[memo.id]) throw new Error('备份包含重复笔记 ID');
      memoIds[memo.id] = true;
      if (memo.title != null && typeof memo.title !== 'string') throw new Error('笔记标题格式无效');
      if (memo.doc != null && !Array.isArray(memo.doc)) throw new Error('笔记正文格式无效');
      if (memo.doc && memo.doc.length > 20000) throw new Error('单篇笔记内容过多');
      if (memo.doc) {
        var blockIds = Object.create(null);
        memo.doc.forEach(function (block) {
          validateNode(block, 0);
          if (block.id && blockIds[block.id]) throw new Error('笔记包含重复正文块 ID');
          if (block.id) blockIds[block.id] = true;
        });
      }
    });
    if (backup.avatars != null) {
      if (!backup.avatars || typeof backup.avatars !== 'object' || Array.isArray(backup.avatars)) throw new Error('头像备份格式无效');
      Object.keys(backup.avatars).forEach(function (id) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || typeof backup.avatars[id] !== 'string' || !/^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i.test(backup.avatars[id])) throw new Error('头像数据格式无效');
      });
    }
    walk(backup, 0, '');
    return true;
  }

  function validateZipPayload(zipData, limits) {
    limits = limits || {};
    var maxExpanded = limits.maxExpanded || 200 * 1024 * 1024;
    var maxEntries = limits.maxEntries || 3000;
    var maxFile = limits.maxFile || 50 * 1024 * 1024;
    var keys = Object.keys(zipData || {}), total = 0;
    if (keys.length > maxEntries) throw new Error('备份文件数量超过安全限制');
    for (var i = 0; i < keys.length; i++) {
      var value = zipData[keys[i]];
      var size = value && value.byteLength != null ? value.byteLength : value && value.length || 0;
      if (size > maxFile) throw new Error('单个备份文件超过安全限制');
      total += size;
      if (total > maxExpanded) throw new Error('备份总大小超过安全限制');
    }
    return { entries: keys.length, expandedBytes: total };
  }

  function deleteUnreferencedAttachments(db, candidateIds) {
    var ids = Array.from(new Set(candidateIds || []));
    var write = _memoWriteQueue.catch(function () {}).then(function () {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(['memos', 'attachments'], 'readwrite'); }
        catch (e) { reject(e); return; }
        var deleted = [];
        tx.oncomplete = function () { resolve(deleted); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('附件清理事务中止')); };
        var req = tx.objectStore('memos').getAll();
        req.onerror = function () { try { tx.abort(); } catch (_) {} };
        req.onsuccess = function () {
          try {
            var referenced = Object.create(null);
            function visit(value) {
              if (!value || typeof value !== 'object') return;
              if (Array.isArray(value)) { value.forEach(visit); return; }
              if (typeof value.fileId === 'string') referenced[value.fileId] = true;
              if (value.type === 'gallery' && value.attrs && Array.isArray(value.attrs.items)) {
                value.attrs.items.forEach(function (item) {
                  if (typeof item === 'string' && isLegacyGalleryFileId(item)) referenced[item] = true;
                });
              }
              Object.keys(value).forEach(function (key) { if (key !== 'fileId') visit(value[key]); });
            }
            (req.result || []).forEach(visit);
            var store = tx.objectStore('attachments');
            ids.forEach(function (id) { if (!referenced[id]) { store.delete(id); deleted.push(id); } });
          } catch (error) { try { tx.abort(); } catch (_) {} reject(error); }
        };
      });
    });
    _memoWriteQueue = write;
    return write;
  }

  function commitMergedData(db, cloudMemos, attachments, avatars) {
    // Derive the merge inside one readwrite transaction so the source snapshot and commit are atomic.
    var write = _memoWriteQueue.catch(function () {}).then(function () {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(['memos', 'attachments', 'avatars'], 'readwrite'); }
        catch (e) { reject(e); return; }
        var merged = null;
        tx.oncomplete = function () {
          if (merged) _memoBaseline = memoSnapshotMap(merged);
          resolve(merged);
        };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('合并事务中止，数据未更改')); };
        try {
          var memoStore = tx.objectStore('memos');
          var request = memoStore.getAll();
          request.onerror = function () { try { tx.abort(); } catch (_) {} };
          request.onsuccess = function () {
            try {
              var localMemos = request.result || [];
              var cloudIds = Object.create(null);
              (cloudMemos || []).forEach(function (m) { cloudIds[m.id] = true; });
              var localById = Object.create(null);
              localMemos.forEach(function (m) { localById[m.id] = m; });
              var preferred = (cloudMemos || []).map(function (cloud) {
                var local = localById[cloud.id];
                if (!local || !Array.isArray(local.doc) || !Array.isArray(cloud.doc)) return cloud;
                var doc = cloud.doc.map(function (node, i) {
                  if (node && node.type === 'attachment' && !node.image && local.doc[i] && local.doc[i].image) return Object.assign({}, node, { image: local.doc[i].image });
                  return node;
                });
                return Object.assign({}, cloud, { doc: doc });
              });
              merged = preferred.concat(localMemos.filter(function (m) { return !cloudIds[m.id]; }));
              memoStore.clear();
              merged.forEach(function (memo) { memoStore.put(memo); });
              (attachments || []).forEach(function (record) {
                var store = tx.objectStore('attachments');
                var get = store.get(record.id);
                get.onsuccess = function () { if (!get.result) store.put(record); };
              });
              Object.keys(avatars || {}).forEach(function (id) { tx.objectStore('avatars').put({ id: id, dataUrl: avatars[id] }); });
            } catch (err) { try { tx.abort(); } catch (_) {} reject(err); }
          };
        } catch (error) { try { tx.abort(); } catch (_) {} reject(error); }
      });
    });
    _memoWriteQueue = write;
    return write;
  }

  function isLegacyGalleryFileId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
  }

  function collectAttachmentIds(value) {
    var ids = Object.create(null);
    function visit(item) {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item)) { item.forEach(visit); return; }
      if (typeof item.fileId === 'string' && item.fileId) ids[item.fileId] = true;
      if (item.type === 'gallery' && item.attrs && Array.isArray(item.attrs.items)) {
        item.attrs.items.forEach(function (entry) {
          if (typeof entry === 'string' && isLegacyGalleryFileId(entry)) ids[entry] = true;
        });
      }
      Object.keys(item).forEach(function (key) { if (key !== 'fileId') visit(item[key]); });
    }
    visit(value);
    return Object.keys(ids);
  }

  async function restoreFromZipAtomic(db, unzipped, backup, opts) {
    opts = opts || {};
    backup = backup || {};
    validateBackupData(backup);
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
    var st = await stageRestoreFromZip(db, unzipped, opts.onProgress, collectAttachmentIds(backup.memos || []));
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
    forEachAttachmentBytes: forEachAttachmentBytes,
    validateZipInput: validateZipInput,
    validateZipPayload: validateZipPayload,
    validateBackupData: validateBackupData,
    parseBackupManifest: parseBackupManifest,
    resolveAttachmentId: resolveAttachmentId,
    collectAttachmentIds: collectAttachmentIds,
    buildAttachmentRecord: buildAttachmentRecord,
    commitMergedData: commitMergedData,
    deleteUnreferencedAttachments: deleteUnreferencedAttachments,
    restoreAvatars: restoreAvatars,
    saveMemosToDB: saveMemosToDB,
    loadMemosFromDB: loadMemosFromDB,
    clearStore: clearStore,
    stageRestoreFromZip: stageRestoreFromZip,
    commitStagedRestore: commitStagedRestore,
    restoreFromZipAtomic: restoreFromZipAtomic
  };
})(window);
