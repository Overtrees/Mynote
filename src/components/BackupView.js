(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef, useCallback = R.useCallback, useMemo = R.useMemo, useLayoutEffect = R.useLayoutEffect;

const BackupView = ({
  onClose
}) => {
  const [closing, setClosing] = useState(false);
  const handleClose = useCallback(function () {
    setClosing(true);
    setTimeout(() => onClose(), 350);
  }, [onClose]);
  const [googleToken, setGoogleToken] = useState(localStorage.getItem('google_token') || null);
  const [showRestoreSheet, setShowRestoreSheet] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const isLoading = backupLoading || restoreLoading;
  const HISTORY_KEY = 'memos_backup_history';
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const addHistoryEntry = useCallback((type, status2, msg, detail) => {
    setHistory(prev => {
      var entry = {
        type: type,
        status: status2,
        message: msg,
        detail: detail || '',
        timestamp: new Date().toISOString()
      };
      var next = [entry, ...prev].slice(0, 20);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  }, []);
  const [attachCount, setAttachCount] = useState(null);
  useEffect(function () {
    w.CikeIdb.getDB().then(function (db) {
      var tx = db.transaction('attachments', 'readonly');
      var req = tx.objectStore('attachments').count();
      req.onsuccess = function () {
        setAttachCount(req.result);
      };
    }).catch(function(e) { if(e) console.warn('[\u6B64\u523B]', e); });
  }, []);
  var lastBackupTime = useMemo(function () {
    var uploads = history.filter(function (e) {
      return e.type === 'upload' && e.status === 'success';
    });
    if (uploads.length === 0) return '暂无';
    var ts = uploads[0].timestamp;
    if (!ts) return '未知';
    var d = new Date(ts);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var yesterday = new Date(today.getTime() - 86400000);
    var h = d.getHours();
    var m = String(d.getMinutes()).padStart(2, '0');
    var timeStr = function () {
      try {
        return !new Intl.DateTimeFormat(undefined, {
          hour: 'numeric'
        }).formatToParts(new Date(2024, 0, 1, 13)).some(function (p) {
          return p.type === 'dayPeriod';
        }) ? String(h).padStart(2, '0') + ':' + m : (h < 12 ? '上午' : '下午') + ' ' + (h % 12 || 12) + ':' + m;
      } catch (_) {
        return h + ':' + m;
      }
    }();
    if (d >= today) return '今天 ' + timeStr;
    if (d >= yesterday) return '昨天 ' + timeStr;
    return d.getMonth() + 1 + '/' + d.getDate() + ' ' + timeStr;
  }, [history]);
  const showStatus = useCallback(msg => {
    if (msg) {
      var type = msg.startsWith('✅') ? 'success' : msg.startsWith('❌') ? 'error' : 'info';
      setStatusMsg(msg);
      setStatusType(type);
      if (type === 'success' || type === 'error') {
        clearTimeout(window._statusTimer);
        window._statusTimer = setTimeout(function () {
          setStatusMsg('');
          setStatusType('idle');
        }, type === 'success' ? 3000 : 6000);
      }
    }
  }, []);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusType, setStatusType] = useState('idle');
  useEffect(function() {
    var t = localStorage.getItem('google_token');
    if (!t) return;
    try {
      var payload = JSON.parse(atob(t.split('.')[1]) || '{}');
      var exp = payload.exp * 1000 || 0;
      if (exp - Date.now() < 5 * 60 * 1000) {
        localStorage.removeItem('google_token');
        localStorage.removeItem('google_avatar');
        setGoogleToken(null);
      }
    } catch(_) {}
  }, []);
  const buildBackupPayload = useCallback(async () => {
    var memos = JSON.parse(localStorage.getItem('memos_app_v2') || '[]');
    // 优先从 IDB 读取（主存储）
    try {
      var _db5 = await (window.CikeIdb ? window.CikeIdb.getDB() : null);
      if (_db5) {
        var _idb = await (window.CikeIdb ? window.CikeIdb.loadMemosFromDB(_db5) : null);
        if (_idb && _idb.length > 0) memos = _idb;
      }
    } catch (_) {}
    const cleanMemos = memos.map(m => ({
      ...m,
      doc: m.doc ? m.doc.map(n => n) : m.doc
    }));
    const db = await w.CikeIdb.getDB();
    const tx = db.transaction('avatars', 'readonly');
    const allAvatars = await new Promise(res => {
      const req = tx.objectStore('avatars').getAll();
      req.onsuccess = () => res(req.result);
    });
    const avatars = {};
    for (const a of allAvatars) avatars[a.id] = a.dataUrl;
    return {
      version: 2,
      // v2: memo doc 中 attachment 节点新增 image 字段（标记是否为图片附件）
      exportedAt: new Date().toISOString(),
      memos: cleanMemos,
      avatars
    };
  }, []);
  const handleExportLocal = useCallback(async () => {
    if (backupLoading) return;
    setBackupLoading(true);
    try {
      const backup = await buildBackupPayload();
      const zipData = {};
      zipData['memos.json'] = fflate.strToU8(JSON.stringify(backup, null, 2));
      const db = await w.CikeIdb.getDB();
      await w.CikeIdb.packAttachmentsToZip(db, zipData, (i, total) => showStatus(`正在打包附件 ${i + 1}/${total}...`));
      const zipped = fflate.zipSync(zipData, {
        level: 6
      });
      const fileName = `此刻备份_${new Date().toISOString().slice(0, 10)}.zip`;
      const blob = new Blob([zipped], {
        type: 'application/zip'
      });
      /* ---- 优先使用系统 Share Sheet (iOS 原生分享) ---- */
      if (navigator.share && navigator.canShare) {
        try {
          const file = new File([zipped], fileName, {
            type: 'application/zip'
          });
          if (navigator.canShare({
            files: [file]
          })) {
            await navigator.share({
              files: [file],
              title: '此刻备份'
            });
            showStatus('✅ 备份已分享');
            addHistoryEntry('export', 'success', '文件已分享', fileName);
            setBackupLoading(false);
            return;
          }
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') {
            setBackupLoading(false);
            return;
          }
          // fallback to download
        }
      }
      /* ---- 回退：浏览器下载 ---- */
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      showStatus('✅ 本地备份已下载 (.zip)');
      addHistoryEntry('export', 'success', '备份已下载', fileName);
    } catch (e) {
      showStatus('❌ 导出失败: ' + e.message);
      addHistoryEntry('export', 'fail', '导出失败', e.message);
    } finally {
      setBackupLoading(false);
    }
  }, [backupLoading, showStatus, buildBackupPayload, addHistoryEntry]);
  const handleConfirmImportRestore = useCallback(async () => {
    if (!pendingImportFile) return;
    const file = pendingImportFile;
    setShowImportConfirm(false);
    setPendingImportFile(null);
    showStatus('正在读取备份文件...');
    setRestoreLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const unzipped = fflate.unzipSync(new Uint8Array(buf));
      const jsonBytes = unzipped['memos.json'];
      if (!jsonBytes) throw new Error('ZIP 中未找到备份数据');
      const backup = JSON.parse(fflate.strFromU8(jsonBytes));
      if (!backup.memos || !Array.isArray(backup.memos)) throw new Error('无效的备份文件，未找到备忘录数据');
      const db = await w.CikeIdb.getDB();
      const newMemosStr = JSON.stringify(backup.memos);
      const oldMemos = JSON.parse(localStorage.getItem('memos_app_v2') || '[]');
      for (const m of oldMemos) if (m.doc) for (const n of m.doc) if (n.type === 'attachment') await deleteAttachmentFromDB(db, n.fileId).catch(e => console.warn('[恢复] 删除旧附件失败', e));
      const {
        success,
        fail
      } = await restoreAttachmentsFromZip(unzipped, db);
      if (fail > 0) showStatus(`附件恢复完成：成功 ${success}，跳过 ${fail}`);
      await restoreAvatars(backup.avatars, db);
      localStorage.setItem('memos_app_v2', newMemosStr);
      await (window.CikeIdb ? window.CikeIdb.saveMemosToDB(db, backup.memos) : null);
      showStatus('✅ 恢复成功！正在刷新页面...');
      addHistoryEntry('restore', 'success', '从本地文件恢复', file.name);
      setTimeout(() => window.location.href = location.href, 800);
    } catch (e) {
      showStatus('❌ 导入失败: ' + e.message);
      addHistoryEntry('restore', 'fail', '导入失败', e.message);
    } finally {
      setRestoreLoading(false);
    }
  }, [pendingImportFile, restoreLoading, showStatus, addHistoryEntry]);
  const handleImportLocal = useCallback(async () => {
    if (restoreLoading) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async e => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        setPendingImportFile(file);
        setShowImportConfirm(true);
      } finally {
        try {
          document.body.removeChild(input);
        } catch (_) {}
      }
    };
    input.oncancel = () => {
      try {
        document.body.removeChild(input);
      } catch (_) {}
    };
    input.click();
  }, [restoreLoading]);
  const tokenFailRef = useRef(0);
  const checkTokenExpiry = useCallback(resp => {
    if (resp.status === 401 || resp.status === 403) {
      tokenFailRef.current += 1;
      if (tokenFailRef.current < 3) {
        showStatus('⚠️ Google 授权可能失效，请重试当前操作');
        return true;
      }
      tokenFailRef.current = 0;
      setGoogleToken(null);
      localStorage.removeItem('google_token');
      localStorage.removeItem('google_avatar');
      showStatus('❌ Google 账号已断开，请重新连接');
      return true;
    }
    tokenFailRef.current = 0;
    return false;
  }, [showStatus]);
  const handleGoogleAuth = useCallback(() => {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
      showStatus('❌ Google API 未加载，请刷新页面后重试');
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile',
      callback: tokenResponse => {
        if (tokenResponse && tokenResponse.access_token) {
          setGoogleToken(tokenResponse.access_token);
          localStorage.setItem('google_token', tokenResponse.access_token);
          showStatus('✅ Google 账号已连接');
          addHistoryEntry('connect', 'success', 'Google 账号已连接', '');
          /* 获取 Google 头像 */          fetch('https://www.googleapis.com/oauth2/v2/userinfo', {            headers: { Authorization: 'Bearer ' + tokenResponse.access_token }          }).then(function(r){ return r.json(); }).then(function(data){            if (data && data.picture) localStorage.setItem('google_avatar', data.picture);          }).catch(function(e){ console.warn('[备份] 获取 Google 头像失败', e); });
        } else {
          showStatus('❌ 授权失败，请重试');
          addHistoryEntry('connect', 'fail', 'Google 授权失败', '');
        }
      },
      error_callback: () => {
        showStatus('❌ 授权被取消或失败');
        addHistoryEntry('connect', 'fail', 'Google 授权被取消', '');
      }
    });
    client.requestAccessToken({
      prompt: 'consent'
    });
  }, [showStatus, addHistoryEntry]);
  const handleGoogleLogout = useCallback(() => {
    if (googleToken && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(googleToken, () => {});
    setGoogleToken(null);
    localStorage.removeItem('google_token');
    localStorage.removeItem('google_avatar');
    showStatus('已断开 Google 账号');
  }, [googleToken, showStatus]);
  const handleCloudBackup = useCallback(async () => {
    if (!googleToken) return showStatus('❌ 请先连接 Google 账号');
    if (backupLoading) return;
    setBackupLoading(true);
    try {
      const backup = await buildBackupPayload();
      showStatus('正在打包附件...');
      const zipData = {};
      zipData['memos.json'] = fflate.strToU8(JSON.stringify(backup, null, 2));
      const db = await w.CikeIdb.getDB();
      await w.CikeIdb.packAttachmentsToZip(db, zipData, (i, total) => showStatus(`正在打包附件 ${i + 1}/${total}...`));
      const tx = db.transaction('avatars', 'readonly');
      const allAvatars = await new Promise(res => {
        const req = tx.objectStore('avatars').getAll();
        req.onsuccess = () => res(req.result);
      });
      if (allAvatars.length > 0) {
        const avatarsObj = {};
        for (const a of allAvatars) avatarsObj[a.id] = a.dataUrl;
        zipData['avatars.json'] = fflate.strToU8(JSON.stringify(avatarsObj));
      }
      const zipped = fflate.zipSync(zipData, {
        level: 3
      });
      const blob = new Blob([zipped], {
        type: 'application/zip'
      });
      const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${BACKUP_FILE_NAME}' and trashed=false&spaces=appDataFolder&fields=files(id)`, {
        headers: {
          Authorization: `Bearer ${googleToken}`
        }
      });
      if (checkTokenExpiry(listResp)) return;
      const listData = await listResp.json();
      let fileId = null;
      if (listData.files && listData.files.length > 0) fileId = listData.files[0].id;
      const metadata = fileId ? {
        name: BACKUP_FILE_NAME,
        mimeType: 'application/zip'
      } : {
        name: BACKUP_FILE_NAME,
        mimeType: 'application/zip',
        parents: ['appDataFolder']
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], {
        type: 'application/json'
      }));
      form.append('file', blob);
      const url = fileId ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart` : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
      const method = fileId ? 'PATCH' : 'POST';
      const uploadResp = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${googleToken}`
        },
        body: form
      });
      if (checkTokenExpiry(uploadResp)) return;
      if (!uploadResp.ok) {
        const errData = await uploadResp.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${uploadResp.status}`);
      }
      showStatus('✅ 云端备份完成');
      addHistoryEntry('upload', 'success', '云端备份成功', (backup.memos || []).length + ' 条笔记');
    } catch (e) {
      showStatus('❌ 云端备份失败: ' + e.message);
      addHistoryEntry('upload', 'fail', '云端备份失败', e.message);
    } finally {
      setBackupLoading(false);
    }
  }, [googleToken, checkTokenExpiry, backupLoading, showStatus, buildBackupPayload, addHistoryEntry]);
  const handleCloudMerge = useCallback(async () => {
    if (!googleToken) return showStatus('❌ 请先连接 Google 账号');
    if (restoreLoading) return;
    if (!window.confirm('从云端合并到本地？云端数据将与本地合并，重复项以云端为准，本地数据不会被覆盖。')) return;
    setRestoreLoading(true);
    showStatus('正在下载云端备份...');
    try {
      const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${BACKUP_FILE_NAME}' and trashed=false&spaces=appDataFolder&fields=files(id)`, {
        headers: {
          Authorization: `Bearer ${googleToken}`
        }
      });
      if (checkTokenExpiry(listResp)) return;
      const listData = await listResp.json();
      if (!listData.files || listData.files.length === 0) return showStatus('❌ 云端无备份文件');
      const fileId = listData.files[0].id;
      const dlResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${googleToken}`
        }
      });
      if (checkTokenExpiry(dlResp)) return;
      const buf = await dlResp.arrayBuffer();
      const unzipped = fflate.unzipSync(new Uint8Array(buf));
      const cloudBackup = JSON.parse(fflate.strFromU8(unzipped['memos.json']));
      if (!cloudBackup.memos) throw new Error('无效的备份文件');
      const localMemos = JSON.parse(localStorage.getItem('memos_app_v2') || '[]');
      const cloudIds = new Set(cloudBackup.memos.map(m => m.id));
      const merged = [...cloudBackup.memos.map(function(cb) {
        var local = localMemos.find(function(m) { return m.id === cb.id; });
        if (local && local.doc && cb.doc) {
          cb.doc = cb.doc.map(function(n, i) {
            if (n.type === 'attachment' && !n.image && local.doc[i] && local.doc[i].image) {
              return Object.assign({}, n, { image: local.doc[i].image });
            }
            return n;
          });
        }
        return cb;
      }), ...localMemos.filter(function(m) { return !cloudIds.has(m.id); })];
      const db = await w.CikeIdb.getDB();
      for (const attPath of Object.keys(unzipped).filter(k => k.startsWith('attachments/'))) {
        const bytes = unzipped[attPath];
        if (!bytes) continue;
        const fileName = attPath.replace('attachments/', '');
        const firstUnderscore = fileName.indexOf('_');
        const fileId = firstUnderscore > 0 ? fileName.slice(0, firstUnderscore) : fileName;
        const displayName = firstUnderscore > 0 ? fileName.slice(firstUnderscore + 1) : fileName;
        const local = await loadAttachmentFromDB(db, fileId).catch(() => null);
        if (!local) {
          const mime = guessMimeFromName(displayName);
          const blob = new Blob([bytes], {
            type: mime
          });
          const dataUrl = await new Promise(res => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.readAsDataURL(blob);
          });
          const regenThumb = await createThumbnail(dataUrl).catch(() => null);
          await saveAttachmentToDB(db, {
            id: fileId,
            name: displayName,
            type: mime,
            url: dataUrl,
            thumb: regenThumb
          });
        }
      }
      const cloudAvatars = unzipped['avatars.json'] ? JSON.parse(fflate.strFromU8(unzipped['avatars.json'])) : null;
      await restoreAvatars(cloudAvatars || cloudBackup.avatars, db);
      localStorage.setItem('memos_app_v2', JSON.stringify(merged));
      if (window.CikeIdb) { try { var _db3 = await window.CikeIdb.getDB(); await window.CikeIdb.saveMemosToDB(_db3, merged); } catch(_){} }
      showStatus('✅ 合并成功！正在刷新...');
      setTimeout(() => window.location.href = location.href, 800);
    } catch (e) {
      showStatus('❌ 合并失败: ' + e.message);
      console.error('[备份] 合并失败', e);
      addHistoryEntry('restore', 'fail', '合并失败', e.message);
    } finally {
      setRestoreLoading(false);
    }
  }, [googleToken, checkTokenExpiry, restoreLoading, showStatus]);
  const handleCloudRestore = useCallback(async () => {
    if (!googleToken) return showStatus('❌ 请先连接 Google 账号');
    if (restoreLoading) return;
    if (!window.confirm('确认从云端恢复？当前所有数据将被覆盖，此操作不可撤销。')) return;
    // 恢复前预写入历史，确保刷新中断也有记录
    addHistoryEntry('restore', 'info', '从云端恢复', '进行中...');
    setRestoreLoading(true);
    showStatus('正在从云端下载...');
    try {
      const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${BACKUP_FILE_NAME}' and trashed=false&spaces=appDataFolder&fields=files(id)`, {
        headers: {
          Authorization: `Bearer ${googleToken}`
        }
      });
      if (checkTokenExpiry(listResp)) return;
      const listData = await listResp.json();
      if (!listData.files || listData.files.length === 0) return showStatus('❌ 云端无备份文件');
      const fileId = listData.files[0].id;
      const dlResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${googleToken}`
        }
      });
      if (checkTokenExpiry(dlResp)) return;
      const buf = await dlResp.arrayBuffer();
      const unzipped = fflate.unzipSync(new Uint8Array(buf));
      const backup = JSON.parse(fflate.strFromU8(unzipped['memos.json']));
      if (!backup.memos) throw new Error('无效的备份文件');
      const db = await w.CikeIdb.getDB();
      const newMemosStr = JSON.stringify(backup.memos);
      const oldMemos = JSON.parse(localStorage.getItem('memos_app_v2') || '[]');
      for (const m of oldMemos) if (m.doc) for (const n of m.doc) if (n.type === 'attachment') await deleteAttachmentFromDB(db, n.fileId).catch(e => console.warn('[恢复] 删除旧附件失败', e));
      const {
        success,
        fail
      } = await restoreAttachmentsFromZip(unzipped, db);
      if (fail > 0) showStatus(`附件恢复完成：成功 ${success}，跳过 ${fail}`);
      const backupAvatars = unzipped['avatars.json'] ? JSON.parse(fflate.strFromU8(unzipped['avatars.json'])) : null;
      await restoreAvatars(backupAvatars || backup.avatars, db);
      localStorage.setItem('memos_app_v2', newMemosStr);
      if (window.CikeIdb) { try { var _db4 = await window.CikeIdb.getDB(); await window.CikeIdb.saveMemosToDB(_db4, backup.memos); } catch(_){} }
      showStatus('✅ 云端恢复成功！正在刷新页面...');
      addHistoryEntry('restore', 'success', '从云端恢复', (backup.memos || []).length + ' 条笔记');
      setTimeout(() => window.location.href = location.href, 2000);
    } catch (e) {
      showStatus('❌ 云端恢复失败: ' + e.message);
      addHistoryEntry('restore', 'fail', '云端恢复失败', e.message);
    } finally {
      setRestoreLoading(false);
    }
  }, [googleToken, checkTokenExpiry, restoreLoading, showStatus, addHistoryEntry]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--primary-bg)",
      minHeight: "100vh"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "editor-fab left",
    onPointerDown: function (e) {
      e.stopPropagation();
      onClose();
    }
  }, /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    width: "24",
    height: "24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.5,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "15 18 9 12 15 6"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "page-title compact",
    style: {
      visibility: "visible",
      opacity: 1,
      pointerEvents: "none"
    }
  }, "\u5907\u4EFD\u4E0E\u6062\u590D"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "126px 20px 0",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 40px)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      animation: closing ? 'slideOutToRight 0.35s cubic-bezier(0.32,0.94,0.6,1) forwards' : 'slideInFromRight 0.35s cubic-bezier(0.32,0.94,0.6,1) both'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "backup-hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "backup-hero-top",
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "backup-hero-title"
  }, "\u5907\u4EFD\u72B6\u6001\u603B\u89C8")), /*#__PURE__*/React.createElement("div", {
    className: googleToken ? "backup-hero-badge connected" : "backup-hero-badge disconnected"
  }, googleToken ? '已连接' : '未连接')), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)',
      lineHeight: 1.5,
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u2601\uFE0F Google Drive ", googleToken ? '正常' : '未连接'), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: 0.3
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, "\u4E0A\u6B21\u5907\u4EFD ", lastBackupTime), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: 0.3
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, JSON.parse(localStorage.getItem('memos_app_v2') || '[]').length, " \u6761\u7B14\u8BB0", attachCount !== null ? ` · ${attachCount} 个附件` : ''))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 12
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "backup-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "backup-row",
    onClick: () => setShowExportConfirm(true)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "28",
    height: "28",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#007aff",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: { filter: "drop-shadow(0 0 6px rgba(0,122,255,0.35))" }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "17 8 12 3 7 8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "3",
    x2: "12",
    y2: "15"
  })) , /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "backup-row-title"
  }, "\u5BFC\u51FA\u5907\u4EFD"), /*#__PURE__*/React.createElement("div", {
    className: "backup-row-desc"
  }, "\u5206\u4EAB zip \u5230\u7CFB\u7EDF\u6587\u4EF6 App"))), /*#__PURE__*/React.createElement("div", {
    className: "backup-row-right"
  }, /*#__PURE__*/React.createElement("span", {
    className: "backup-row-arrow"
  }, "\u203A"))), /*#__PURE__*/React.createElement("div", {
    className: "backup-row no-border",
    onClick: handleImportLocal
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "28",
    height: "28",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#007aff",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: { filter: "drop-shadow(0 0 6px rgba(0,122,255,0.35))" }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "17 10 12 15 7 10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "3",
    x2: "12",
    y2: "15"
  })) , /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "backup-row-title"
  }, "\u5BFC\u5165\u5907\u4EFD"), /*#__PURE__*/React.createElement("div", {
    className: "backup-row-desc"
  }, "\u4ECE\u6587\u4EF6 App \u9009\u62E9 zip \u6062\u590D"))), /*#__PURE__*/React.createElement("div", {
    className: "backup-row-right"
  }, /*#__PURE__*/React.createElement("span", {
    className: "backup-row-arrow"
  }, "\u203A")))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 12
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "backup-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "backup-row",
    style: {
      cursor: 'default'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "backup-row-left"
  }, /*#__PURE__*/React.createElement("div", {
    className: "backup-row-title"
  }, "Google Drive \u4E91\u5907\u4EFD"), /*#__PURE__*/React.createElement("div", {
    className: "backup-row-desc"
  }, "\u5F00\u542F\u540E\uFF0C\u7B14\u8BB0\u4E0E\u9644\u4EF6\u5C06\u81EA\u52A8\u5907\u4EFD\u5230\u4E91\u7AEF\u3002")), /*#__PURE__*/React.createElement("div", {
    className: googleToken ? "backup-state connected" : "backup-state disconnected"
  }, googleToken ? '已连接' : '未连接')), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 14px 14px',
      borderTop: '0.5px solid var(--border-color)'
    }
  }, !googleToken ? /*#__PURE__*/React.createElement("button", {
    className: "backup-btn primary",
    onClick: handleGoogleAuth,
    disabled: isLoading,
    style: {
      width: '100%',
      marginRight: 0,
      height: 44
    }
  }, "\u8FDE\u63A5 Google \u8D26\u53F7") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "backup-btn primary",
    onClick: handleCloudBackup,
    disabled: backupLoading || restoreLoading,
    style: {
      width: '100%',
      marginRight: 0,
      height: 44,
      marginBottom: 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M10 3v12M7 12l3 3 3-3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 16v1a1 1 0 001 1h10a1 1 0 001-1v-1"
  })), backupLoading ? '备份中...' : '上传到云端'), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "backup-btn secondary",
    onClick: handleGoogleLogout,
    disabled: isLoading,
    style: {
      flex: 1
    }
  }, "\u65AD\u5F00\u8D26\u53F7"), /*#__PURE__*/React.createElement("button", {
    className: "backup-btn secondary",
    onClick: () => setShowRestoreSheet(true),
    disabled: backupLoading || restoreLoading,
    style: {
      flex: 1
    }
  }, "\u4ECE\u4E91\u7AEF\u6062\u590D"))))), history.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "backup-section-title",
    style: {
      marginTop: 16
    }
  }, "\u6700\u8FD1\u64CD\u4F5C"), /*#__PURE__*/React.createElement("div", {
    className: "backup-card",
    style: {
      padding: '2px 0'
    }
  }, history.slice(0, 6).map(function (entry, i) {
    var dotColor = entry.status === 'success' ? '#34c759' : entry.status === 'fail' ? '#ff3b30' : '#007aff';
    var typeLabel = entry.type === 'upload' ? '云端' : entry.type === 'export' ? '导出' : entry.type === 'restore' ? '恢复' : '连接';
    var ts = entry.timestamp ? (function(iso){
      var d = new Date(iso);
      var pad = function(n){return String(n).padStart(2,'0');};
      return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    })(entry.timestamp) : '';
    return React.createElement('div', {
      key: i,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderBottom: i < history.length - 1 && i < 5 ? '0.5px solid var(--border-color)' : 'none'
      }
    }, React.createElement('div', {
      style: {
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: dotColor,
        flexShrink: 0
      }
    }), React.createElement('div', {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, React.createElement('div', {
      style: {
        fontSize: 14,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }
    }, React.createElement('span', null, entry.message), React.createElement('span', {
      style: {
        fontSize: 9,
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 999,
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
        background: 'var(--glass-bg)',
        border: '0.5px solid var(--glass-border)',
        color: 'var(--text-secondary)'
      }
    }, typeLabel)), React.createElement('div', {
      style: {
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginTop: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }
    }, React.createElement('span', null, ts), entry.detail && React.createElement(React.Fragment, null, React.createElement('span', {
      style: {
        opacity: 0.3
      }
    }, '·'), React.createElement('span', null, entry.detail)))));
  })))), showExportConfirm && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onClick: () => setShowExportConfirm(false),
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 4000,
      background: 'transparent'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 'calc(env(safe-area-inset-bottom) + 14px)',
      zIndex: 4001,
      display: 'flex',
      justifyContent: 'center',
      padding: '0 14px',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: '100%',
      maxWidth: 600,
      background: 'var(--glass-bg)',
      backdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      WebkitBackdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      border: '0.5px solid var(--glass-border)',
      borderRadius: 28,
      padding: '14px 14px calc(14px + env(safe-area-inset-bottom))',
      boxShadow: '0 -8px 24px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.25)',
      pointerEvents: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      fontSize: 18,
      fontWeight: 700,
      marginBottom: 12,
      color: 'var(--text-main)'
    }
  }, "\u786E\u8BA4\u5BFC\u51FA\u5907\u4EFD"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.45,
      color: 'var(--text-secondary)',
      textAlign: 'center',
      marginBottom: 12
    }
  }, "\u6253\u5305\u5168\u90E8\u7B14\u8BB0\u3001\u9644\u4EF6\u4E0E\u5934\u50CF\u4E3A zip\uFF0C\u5C06\u901A\u8FC7\u7CFB\u7EDF\u5206\u4EAB\u9762\u677F\u4FDD\u5B58\u6216\u53D1\u9001\u3002"), /*#__PURE__*/React.createElement("button", {
    className: "backup-btn primary",
    onClick: () => {
      setShowExportConfirm(false);
      handleExportLocal();
    },
    style: {
      width: '100%',
      marginRight: 0,
      height: 44,
      marginBottom: 10
    },
    disabled: backupLoading
  }, backupLoading ? '导出中...' : '确认导出'), /*#__PURE__*/React.createElement("button", {
    className: "backup-btn secondary",
    onClick: () => setShowExportConfirm(false),
    style: {
      width: '100%',
      marginRight: 0,
      height: 44
    }
  }, "\u53D6\u6D88")))), showImportConfirm && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onClick: () => {
      setShowImportConfirm(false);
      setPendingImportFile(null);
    },
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 4000,
      background: 'transparent'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 'calc(env(safe-area-inset-bottom) + 14px)',
      zIndex: 4001,
      display: 'flex',
      justifyContent: 'center',
      padding: '0 14px',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: '100%',
      maxWidth: 600,
      background: 'var(--glass-bg)',
      backdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      WebkitBackdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      border: '0.5px solid var(--glass-border)',
      borderRadius: 28,
      padding: '14px 14px calc(14px + env(safe-area-inset-bottom))',
      boxShadow: '0 -8px 24px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.25)',
      pointerEvents: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      fontSize: 18,
      fontWeight: 700,
      marginBottom: 12,
      color: 'var(--text-main)'
    }
  }, "\u786E\u8BA4\u6062\u590D\u5907\u4EFD"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.45,
      color: 'var(--text-secondary)',
      textAlign: 'center',
      marginBottom: 12
    }
  }, "\u5F53\u524D\u6240\u6709\u6570\u636E\u5C06\u88AB\u8986\u76D6\uFF0C\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002"), /*#__PURE__*/React.createElement("button", {
    className: "backup-btn primary",
    onClick: handleConfirmImportRestore,
    style: {
      width: '100%',
      marginRight: 0,
      height: 44,
      marginBottom: 10
    },
    disabled: restoreLoading
  }, restoreLoading ? '恢复中...' : '确认恢复'), /*#__PURE__*/React.createElement("button", {
    className: "backup-btn secondary",
    onClick: () => {
      setShowImportConfirm(false);
      setPendingImportFile(null);
    },
    style: {
      width: '100%',
      marginRight: 0,
      height: 44
    }
  }, "\u53D6\u6D88")))), showRestoreSheet && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onClick: () => setShowRestoreSheet(false),
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 4000,
      background: 'transparent'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 'calc(env(safe-area-inset-bottom) + 14px)',
      zIndex: 4001,
      display: 'flex',
      justifyContent: 'center',
      padding: '0 14px',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: '100%',
      maxWidth: 600,
      background: 'var(--glass-bg)',
      backdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      WebkitBackdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      border: '0.5px solid var(--glass-border)',
      borderRadius: 28,
      padding: '14px 14px calc(14px + env(safe-area-inset-bottom))',
      boxShadow: '0 -8px 24px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.25)',
      pointerEvents: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      fontSize: 18,
      fontWeight: 700,
      marginBottom: 12,
      color: 'var(--text-main)'
    }
  }, "\u4ECE\u4E91\u7AEF\u6062\u590D"), /*#__PURE__*/React.createElement("div", {
    onClick: () => {
      setShowRestoreSheet(false);
      handleCloudRestore();
    },
    style: {
      border: '0.5px solid rgba(255,69,58,0.2)',
      borderRadius: 22,
      padding: 14,
      marginBottom: 10,
      background: 'var(--glass-bg)',
      backdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      WebkitBackdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center'
    }
  }, w.SvgIcon('warning', { width:18, height:18, stroke:'#ff3b30', strokeWidth:2.2 })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: '#ff3b30'
    }
  }, "\u8986\u76D6\u672C\u5730\u6062\u590D")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.45,
      color: 'var(--text-secondary)',
      paddingLeft: 24
    }
  }, "\u6E05\u7A7A\u672C\u5730\u540E\u7528\u4E91\u7AEF\u5B8C\u6574\u66FF\u6362\uFF0C\u9002\u5408\u6362\u8BBE\u5907\u6216\u5F7B\u5E95\u56DE\u6863\u3002")), /*#__PURE__*/React.createElement("div", {
    onClick: () => {
      setShowRestoreSheet(false);
      handleCloudMerge();
    },
    style: {
      border: '0.5px solid rgba(0,122,255,0.25)',
      borderRadius: 22,
      padding: 14,
      marginBottom: 12,
      background: 'var(--glass-bg)',
      backdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      WebkitBackdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center'
    }
  }, w.SvgIcon('merge', { width:18, height:18, stroke:'#007aff', strokeWidth:2.2 })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: '#007aff'
    }
  }, "\u5408\u5E76\u4E91\u7AEF\u5230\u672C\u5730")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.45,
      color: 'var(--text-secondary)',
      paddingLeft: 24
    }
  }, "\u4FDD\u7559\u672C\u5730\u73B0\u6709\u6570\u636E\uFF0C\u53EA\u8865\u5165\u4E91\u7AEF\u65B0\u589E\u5185\u5BB9\u3002")), /*#__PURE__*/React.createElement("button", {
    className: "backup-btn secondary backup-modal-cancel",
    onClick: () => setShowRestoreSheet(false),
    style: {
      width: '100%',
      marginRight: 0,
      height: 44
    }
  }, "\u53D6\u6D88"))))), statusMsg && function () {
    var t = statusType || 'info';
    var txt = statusMsg.replace(/^[✅❌]\s*/, '');
    var borderColor = t === 'success' ? 'rgba(52,199,89,0.24)' : t === 'error' ? 'rgba(224,67,58,0.24)' : 'rgba(0,122,255,0.22)';
    var icon = t === 'success' ? '✅' : t === 'error' ? '❌' : '↑';
    return React.createElement('div', {
      style: {
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 'calc(env(safe-area-inset-bottom) + 16px)',
        zIndex: 5000,
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
        WebkitBackdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
        border: '0.5px solid var(--glass-border)',
        borderRadius: 28,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.25)',
        overflow: 'hidden',
        opacity: 1,
        transform: 'translateY(0) scale(1)',
        transition: 'opacity 180ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1)',
        willChange: 'opacity, transform'
      }
    }, React.createElement('span', {
      style: {
        flexShrink: 0,
        fontSize: 16
      }
    }, t === 'info' ? React.createElement('span', {
      style: {
        width: 16,
        height: 16,
        border: '2px solid rgba(0,122,255,0.2)',
        borderTopColor: '#007aff',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'toastSpin 0.7s linear infinite',
        verticalAlign: 'middle'
      }
    }) : icon), React.createElement('span', {
      style: {
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--text-main)',
        lineHeight: 1.35
      }
    }, txt));
  }());
};

  w.BackupView = BackupView;
})(window);
