/* Editor 撤销/重做：全量快照 + 600ms 输入合并 + 拖拽 patch 双轨。从 Editor 主组件抽出。 */
(function (w) {
  'use strict';
  var R = w.React;

  function useEditorHistory(opts) {
    var docRef = opts.docRef;
    var filesRef = opts.filesRef;
    var editorBodyRef = opts.editorBodyRef;
    var setRenderKey = opts.setRenderKey;
    var triggerAutoSave = opts.triggerAutoSave;
    var setEditorDocRef = opts.setEditorDocRef;

    var history = R.useRef({ past: [], future: [] });
    var txOps = R.useRef([]);
    var txTimer = R.useRef(null);
    var lastSnapshotRef = R.useRef(null);
    var lastPushAtRef = R.useRef(0);

    var recordOp = R.useCallback(function (patch) {
      txOps.current.push(patch);
      clearTimeout(txTimer.current);
      txTimer.current = setTimeout(function () {
        var combined = txOps.current;
        txOps.current = [];
        if (combined.length === 0) return;
        var inverse = combined.map(function (p) {
          if (p.op === 'update') return { op: 'update', index: p.index, prev: p.next, next: p.prev };
          if (p.op === 'insert') return { op: 'remove', index: p.index, node: p.node };
          if (p.op === 'remove') return { op: 'insert', index: p.index, node: p.node };
          return p;
        }).reverse();
        history.current.past.push({ patch: combined, inverse: inverse });
        if (history.current.past.length > 100) history.current.past.shift();
        history.current.future = [];
      }, 200);
    }, []);

    var applyPatch = R.useCallback(function (patch) {
      if (!Array.isArray(patch) || patch.length === 0) return;
      var cur = docRef.current;
      patch.forEach(function (p) {
        if (p.op === 'update') {
          var idxU = (p.next && p.next.id) ? cur.findIndex(function (n) { return n.id === p.next.id; }) : p.index;
          if (idxU !== -1) cur[idxU] = p.next || p.prev;
        } else if (p.op === 'insert') {
          var idxI = p.index != null ? p.index : cur.length;
          cur.splice(idxI, 0, p.node);
        } else if (p.op === 'remove') {
          var idxR = (p.node && p.node.id) ? cur.findIndex(function (n) { return n.id === p.node.id; }) : p.index;
          if (idxR !== -1) cur.splice(idxR, 1);
        }
      });
      setRenderKey(function (prev) { return prev + 1; });
    }, [docRef, setRenderKey]);

    // 统一历史入口：所有撤销点都由此写入，条目形如 { snapshot: 撤销后应恢复的内容 }
    var recordUndoPoint = R.useCallback(function () {
      var snapshot = JSON.parse(JSON.stringify(docRef.current));
      var prev = lastSnapshotRef.current;
      if (!prev) { lastSnapshotRef.current = snapshot; return; }
      if (JSON.stringify(prev) === JSON.stringify(snapshot)) return;
      var h = history.current;
      var now = Date.now();
      var top = h.past[h.past.length - 1];
      // 连续输入（600ms 内）合并成一步：保留更早的 before，撤销一次回到输入前
      if (top && top.snapshot && now - lastPushAtRef.current < 600) {
        top.snapshot = prev;
      } else {
        h.past.push({ snapshot: prev });
        if (h.past.length > 100) h.past.shift();
      }
      lastPushAtRef.current = now;
      lastSnapshotRef.current = snapshot;
      h.future = [];
    }, [docRef]);

    var undo = R.useCallback(function () {
      var h = history.current, last = h.past[h.past.length - 1];
      if (!last) return;
      h.past.pop();
      var current = JSON.parse(JSON.stringify(docRef.current));
      if (last.snapshot) {
        var restoreTo = JSON.parse(JSON.stringify(last.snapshot));
        docRef.current = restoreTo;
        setEditorDocRef(restoreTo);
        lastSnapshotRef.current = JSON.parse(JSON.stringify(restoreTo));
        var el = editorBodyRef.current;
        if (el) el.innerHTML = w.MynoteEditor.renderDocToEditorHTML(restoreTo, filesRef.current);
        setRenderKey(function (p) { return p + 1; });
        h.future.push({ snapshot: current });
        lastPushAtRef.current = 0;
        triggerAutoSave();
        return;
      }
      applyPatch(last.inverse);
      lastSnapshotRef.current = JSON.parse(JSON.stringify(docRef.current));
      h.future.push({ patch: last.patch, inverse: last.inverse });
      lastPushAtRef.current = 0;
      triggerAutoSave();
    }, [applyPatch, triggerAutoSave, docRef, editorBodyRef, filesRef, setEditorDocRef, setRenderKey, triggerAutoSave]);

    var redo = R.useCallback(function () {
      var h = history.current, nxt = h.future[h.future.length - 1];
      if (!nxt) return;
      h.future.pop();
      var current = JSON.parse(JSON.stringify(docRef.current));
      if (nxt.snapshot) {
        var restoreTo = JSON.parse(JSON.stringify(nxt.snapshot));
        docRef.current = restoreTo;
        setEditorDocRef(restoreTo);
        lastSnapshotRef.current = JSON.parse(JSON.stringify(restoreTo));
        var el = editorBodyRef.current;
        if (el) el.innerHTML = w.MynoteEditor.renderDocToEditorHTML(restoreTo, filesRef.current);
        setRenderKey(function (p) { return p + 1; });
        h.past.push({ snapshot: current });
        lastPushAtRef.current = 0;
        triggerAutoSave();
        return;
      }
      applyPatch(nxt.patch);
      lastSnapshotRef.current = JSON.parse(JSON.stringify(docRef.current));
      h.past.push({ patch: nxt.patch, inverse: nxt.inverse });
      lastPushAtRef.current = 0;
      triggerAutoSave();
    }, [applyPatch, triggerAutoSave, docRef, editorBodyRef, filesRef, setEditorDocRef, setRenderKey, triggerAutoSave]);

    // Cmd+Z / Cmd+Shift+Z / Ctrl+Y
    R.useEffect(function () {
      var handler = function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo(); else undo();
        } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
          e.preventDefault();
          redo();
        }
      };
      w.addEventListener('keydown', handler);
      return function () { w.removeEventListener('keydown', handler); };
    }, [undo, redo]);

    // iOS 三指手势
    R.useEffect(function () {
      var handler = function (e) {
        if (e.inputType === 'historyUndo') { e.preventDefault(); setTimeout(undo, 0); }
        else if (e.inputType === 'historyRedo') { e.preventDefault(); setTimeout(redo, 0); }
      };
      var el = editorBodyRef.current;
      if (!el) return;
      el.addEventListener('beforeinput', handler);
      return function () { el.removeEventListener('beforeinput', handler); };
    }, [undo, redo, editorBodyRef]);

    return {
      history: history,
      txOps: txOps,
      txTimer: txTimer,
      lastSnapshotRef: lastSnapshotRef,
      lastPushAtRef: lastPushAtRef,
      recordOp: recordOp,
      applyPatch: applyPatch,
      recordUndoPoint: recordUndoPoint,
      undo: undo,
      redo: redo
    };
  }

  w.MynoteEditorHooks = w.MynoteEditorHooks || {};
  w.MynoteEditorHooks.useEditorHistory = useEditorHistory;
})(window);
