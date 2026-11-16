/* Google Drive 备份 API 封装：列表/解码/分片上传/候选选择/401-403 分类。BackupView 抽出。 */
(function (w) {
  'use strict';

  function classifyDriveResponse(status) {
    if (status === 401) return 'expired';
    if (status === 403) return 'forbidden';
    return null;
  }

  function selectMynoteBackup(files) {
    var candidates = (files || []).filter(function (f) { return f && f.id && (f.name === 'memories_backup.zip' || f.name === 'memories_backup.json'); });
    candidates.sort(function (a, b) {
      var az = a.name === 'memories_backup.zip' ? 1 : 0, bz = b.name === 'memories_backup.zip' ? 1 : 0;
      if (az !== bz) return bz - az;
      return String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || ''));
    });
    return candidates[0] || null;
  }

  async function listMynoteBackups(token, checkAuth) {
    var backupName = (w.MynoteConstants && w.MynoteConstants.BACKUP_FILE_NAME) || 'memories_backup.zip';
    var files = [], pageToken = null;
    do {
      var url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`(name='${backupName}' or name='memories_backup.json')`)}&trashed=false&spaces=appDataFolder&pageSize=1000&fields=files(id,name,mimeType,modifiedTime),nextPageToken` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      var response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (checkAuth(response)) return { interrupted: true, files: files };
      if (!response.ok) throw new Error('读取云端备份列表失败：HTTP ' + response.status);
      var data = await response.json();
      files = files.concat(data.files || []);
      pageToken = data.nextPageToken || null;
    } while (pageToken);
    return { files: files };
  }

  async function decodeCloudBackup(file, buffer) {
    if (file && /\.json$/i.test(file.name || '')) {
      var backup = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer))); w.MynoteIdb.validateBackupData(backup); return { backup: backup, files: {} };
    }
    var files = await w.MynoteZip.checkedZip(buffer);
    var memoBytes = files['memos.json'];
    if (!memoBytes) throw new Error('备份 ZIP 中缺少 memos.json');
    return { backup: JSON.parse(w.fflate.strFromU8(memoBytes)), files: files };
  }

  // Drive multipart 官方建议 ≤5MB；大备份改走 resumable，避免 50MiB 上限直接 4xx。
  async function uploadDriveZipResumable(token, fileId, blob, metadata) {
    var initUrl = fileId
      ? 'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=resumable'
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
    var initResp = await fetch(initUrl, {
      method: fileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/zip',
        'X-Upload-Content-Length': String(blob.size)
      },
      body: JSON.stringify(metadata)
    });
    if (!initResp.ok) {
      var errData = await initResp.json().catch(function () { return {}; });
      throw new Error(errData.error && errData.error.message || ('初始化分片上传失败：HTTP ' + initResp.status));
    }
    var uploadUrl = initResp.headers.get('location') || initResp.headers.get('Location') || initResp.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('Drive 未返回分片上传地址（Location 头不可用）');
    var uploadResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(blob.size) },
      body: blob
    });
    return uploadResp;
  }

  /** cursor 只取 name/type，不把 dataURL 拉进内存 */
  async function buildAttachmentManifest(db) {
    return new Promise(function (resolve, reject) {
      var manifest = { version: 1, attachments: {} };
      var tx;
      try { tx = db.transaction('attachments', 'readonly'); } catch (e) { resolve(manifest); return; }
      var req = tx.objectStore('attachments').openCursor();
      req.onsuccess = function (e) {
        var cur = e.target.result;
        if (!cur) { resolve(manifest); return; }
        var rec = cur.value;
        manifest.attachments[cur.key] = { name: (rec && rec.name) || '', type: (rec && rec.type) || 'application/octet-stream' };
        cur.continue();
      };
      req.onerror = function () { reject(tx.error); };
    });
  }

  function bestEffortMemoCache(memos) {
    try { w.localStorage.setItem('memos_app_v2', JSON.stringify(memos)); return true; }
    catch (e) { console.warn('[备份] IndexedDB 已提交；localStorage 缓存写入失败', e); return false; }
  }

  w.MynoteDrive = {
    classifyDriveResponse: classifyDriveResponse,
    selectMynoteBackup: selectMynoteBackup,
    listMynoteBackups: listMynoteBackups,
    decodeCloudBackup: decodeCloudBackup,
    uploadDriveZipResumable: uploadDriveZipResumable,
    buildAttachmentManifest: buildAttachmentManifest,
    bestEffortMemoCache: bestEffortMemoCache
  };
})(window);
