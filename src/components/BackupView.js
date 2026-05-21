(function (w) {
  'use strict';
  var R = w.React;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef, useCallback = R.useCallback, useMemo = R.useMemo, useLayoutEffect = R.useLayoutEffect;

const BackupView = ({
  onClose
}) => {
  const handleClose = useCallback(function () {
    onClose();
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
        backdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
        WebkitBackdropFilter: 'blur(40px) saturate(2.5) brightness(1.15)',
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
      border: '0.5px solid var(--glass-border)',
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
      fontSize: 15,
      fontWeight: 700,
      marginBottom: 5,
      color: 'var(--text-main)'
    }
  }, "\u8986\u76D6\u672C\u5730\u6062\u590D"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.45,
      color: 'var(--text-secondary)'
    }
  }, "\u6E05\u7A7A\u672C\u5730\u540E\u7528\u4E91\u7AEF\u5B8C\u6574\u66FF\u6362\uFF0C\u9002\u5408\u6362\u8BBE\u5907\u6216\u5F7B\u5E95\u56DE\u6863\u3002")), /*#__PURE__*/React.createElement("div", {
    onClick: () => {
      setShowRestoreSheet(false);
      handleCloudMerge();
    },
    style: {
      border: '0.5px solid var(--border-color)',
      borderRadius: 22,
      padding: 14,
      marginBottom: 12,
      background: 'rgba(127,127,127,0.06)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      marginBottom: 5,
      color: 'var(--text-main)'
    }
  }, "\u5408\u5E76\u4E91\u7AEF\u5230\u672C\u5730"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.45,
      color: 'var(--text-secondary)'
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
