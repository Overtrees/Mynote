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
    var layoutRef = opts.layoutRef;
    var layoutModeRef = opts.layoutModeRef;
    var setIndependentColumns = opts.setIndependentColumns;
    var captureLayout = opts.captureLayout;

    var history = R.useRef({ past: [], future: [] });
    var txOps = R.useRef([]);
    var txTimer = R.useRef(null);
    var lastSnapshotRef = R.useRef(null);
    var lastLayoutSnapshotRef = R.useRef(layoutRef && layoutRef.current ? JSON.parse(JSON.stringify(layoutRef.current)) : null);
    var lastPushAtRef = R.useRef(0);
    var txBeforeLayoutRef = R.useRef(null);
    var txAfterLayoutRef = R.useRef(null);

    function cloneLayout(layout) { return layout ? JSON.parse(JSON.stringify(layout)) : null; }
    function currentLayout(doc) {
      var value = typeof captureLayout === 'function' ? captureLayout(doc || docRef.current || []) : layoutRef && layoutRef.current;
      return cloneLayout(value);
    }
    function restoreLayout(layout, doc) {
      var el = editorBodyRef.current;
      if (!layout) {
        if (layoutModeRef && layoutModeRef.current === 'independent' && el && w.MynoteEditorColumns) {
          w.MynoteEditorColumns.setIndependentScroll(el, true, null);
        }
        return;
      }
      var normalized = w.MynoteEditorColumns && w.MynoteEditorColumns.normalizeLayout
        ? w.MynoteEditorColumns.normalizeLayout(doc || docRef.current || [], layout) || layout
        : layout;
      if (layoutRef) layoutRef.current = cloneLayout(normalized);
      if (layoutModeRef) layoutModeRef.current = normalized.mode === 'flow' ? 'flow' : 'independent';
      if (typeof setIndependentColumns === 'function') setIndependentColumns(normalized.mode !== 'flow');
      if (el && w.MynoteEditorColumns) w.MynoteEditorColumns.setIndependentScroll(el, normalized.mode !== 'flow', normalized);
    }

    function restoreEditorSelection(descriptor) {
      var el = editorBodyRef.current;
      if (!el || !descriptor) return;
      var blocks = Array.prototype.slice.call(el.querySelectorAll('[data-blockid]'));
      var target = descriptor.blockId ? blocks.find(function (node) { return node.dataset.blockid === descriptor.blockId; }) : null;
      if (!target || target.contentEditable === 'false') {
        var column = descriptor.column && el.querySelector('.editor-column[data-editor-column="' + descriptor.column + '"]');
        var candidates = column ? Array.prototype.slice.call(column.querySelectorAll('[data-blockid]')) : blocks;
        target = candidates.slice().reverse().find(function (node) {
          return node.contentEditable !== 'false' && node.tagName !== 'HR' && node.dataset.musicUrl !== 'pending';
        }) || candidates.find(function (node) { return node.contentEditable !== 'false' && node.tagName !== 'HR'; });
      }
      if (!target) return;
      try {
        if (w.MynoteEditorColumns && typeof w.MynoteEditorColumns.focusEditingHost === 'function') {
          w.MynoteEditorColumns.focusEditingHost(el, target);
        } else if (typeof target.focus === 'function') target.focus({ preventScroll: true });
        if (w.MynoteDom && typeof w.MynoteDom.focusEditableWithCaret === 'function') {
          w.MynoteDom.focusEditableWithCaret(target, descriptor.offset || 0);
        }
      } catch (_) {}
    }

    var recordUndoTransaction = R.useCallback(function (before, after, beforeSelection, afterSelection, beforeLayout, afterLayout) {
      var beforeDoc = JSON.parse(JSON.stringify(before || []));
      var afterDoc = JSON.parse(JSON.stringify(after || docRef.current || []));
      if (JSON.stringify(beforeDoc) === JSON.stringify(afterDoc)) return false;
      var previousLayout = cloneLayout(beforeLayout || lastLayoutSnapshotRef.current || (layoutRef && layoutRef.current));
      var nextLayout = cloneLayout(afterLayout || currentLayout(afterDoc));
      var h = history.current;
      h.past.push({
        snapshot: beforeDoc,
        layout: previousLayout,
        redoLayout: nextLayout,
        restoreSelection: beforeSelection ? JSON.parse(JSON.stringify(beforeSelection)) : null,
        redoSelection: afterSelection ? JSON.parse(JSON.stringify(afterSelection)) : null
      });
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      lastSnapshotRef.current = afterDoc;
      lastLayoutSnapshotRef.current = nextLayout;
      if (layoutRef && nextLayout) layoutRef.current = cloneLayout(nextLayout);
      lastPushAtRef.current = 0;
      return true;
    }, [docRef]);

    var recordOp = R.useCallback(function (patch, beforeLayout, afterLayout) {
      if (txOps.current.length === 0) txBeforeLayoutRef.current = cloneLayout(beforeLayout || (layoutRef && layoutRef.current));
      txOps.current.push(patch);
      txAfterLayoutRef.current = cloneLayout(afterLayout || (layoutRef && layoutRef.current));
      clearTimeout(txTimer.current);
      txTimer.current = setTimeout(function () {
        var combined = txOps.current;
        var previousLayout = txBeforeLayoutRef.current;
        var nextLayout = txAfterLayoutRef.current;
        txOps.current = [];
        txBeforeLayoutRef.current = null;
        txAfterLayoutRef.current = null;
        if (combined.length === 0) return;
        var inverse = combined.map(function (p) {
          if (p.op === 'update') return { op: 'update', index: p.index, prev: p.next, next: p.prev };
          if (p.op === 'insert') return { op: 'remove', index: p.index, node: p.node };
          if (p.op === 'remove') return { op: 'insert', index: p.index, node: p.node };
          return p;
        }).reverse();
        history.current.past.push({ patch: combined, inverse: inverse, layout: previousLayout, redoLayout: nextLayout });
        if (history.current.past.length > 100) history.current.past.shift();
        history.current.future = [];
        if (nextLayout) {
          lastLayoutSnapshotRef.current = cloneLayout(nextLayout);
          if (layoutRef) layoutRef.current = cloneLayout(nextLayout);
        }
      }, 200);
    }, [layoutRef]);

    function syncEditorDOMToDocument(layout) {
      var el = editorBodyRef.current;
      if (!el || !w.MynoteEditor || !w.MynoteEditor.renderDocToEditorHTML) return;
      var blocks = w.MynoteEditorColumns && w.MynoteEditorColumns.getBlocks
        ? w.MynoteEditorColumns.getBlocks(el)
        : Array.prototype.slice.call(el.children || []);
      var byId = Object.create(null);
      blocks.forEach(function (block) { if (block.dataset && block.dataset.blockid) byId[block.dataset.blockid] = block; });
      var ordered = [];
      (docRef.current || []).forEach(function (node) {
        var block = node && node.id && byId[node.id];
        if (!block) {
          var template = w.document.createElement('template');
          template.innerHTML = w.MynoteEditor.renderDocToEditorHTML([node], filesRef.current);
          block = template.content.firstElementChild;
        }
        if (block) ordered.push(block);
      });
      if (w.MynoteEditorColumns && w.MynoteEditorColumns.flatten) w.MynoteEditorColumns.flatten(el);
      el.replaceChildren();
      var fragment = w.document.createDocumentFragment();
      ordered.forEach(function (block) { fragment.appendChild(block); });
      el.appendChild(fragment);
      if (layout) restoreLayout(layout, docRef.current);
    }

    var applyPatch = R.useCallback(function (patch, layout) {
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
      syncEditorDOMToDocument(layout || (layoutRef && layoutRef.current));
      setRenderKey(function (prev) { return prev + 1; });
    }, [docRef, setRenderKey, layoutRef]);

    // 统一历史入口：所有撤销点都由此写入，条目形如 { snapshot: 撤销后应恢复的内容 }
    var recordUndoPoint = R.useCallback(function () {
      var snapshot = JSON.parse(JSON.stringify(docRef.current));
      var prev = lastSnapshotRef.current;
      var snapshotLayout = currentLayout(snapshot);
      var prevLayout = cloneLayout(lastLayoutSnapshotRef.current);
      if (!prev) { lastSnapshotRef.current = snapshot; lastLayoutSnapshotRef.current = snapshotLayout; return; }
      if (JSON.stringify(prev) === JSON.stringify(snapshot) && JSON.stringify(prevLayout) === JSON.stringify(snapshotLayout)) return;
      var h = history.current;
      var now = Date.now();
      var top = h.past[h.past.length - 1];
      // 连续输入（600ms 内）合并成一步：保留更早的 before，撤销一次回到输入前
      if (top && top.snapshot && now - lastPushAtRef.current < 600) {
        top.snapshot = prev;
        top.layout = prevLayout;
      } else {
        h.past.push({ snapshot: prev, layout: prevLayout });
        if (h.past.length > 100) h.past.shift();
      }
      lastPushAtRef.current = now;
      lastSnapshotRef.current = snapshot;
      lastLayoutSnapshotRef.current = snapshotLayout;
      h.future = [];
    }, [docRef]);

    var undo = R.useCallback(function () {
      var h = history.current, last = h.past[h.past.length - 1];
      if (!last) return;
      h.past.pop();
      var current = JSON.parse(JSON.stringify(docRef.current));
      var currentLayoutSnapshot = currentLayout(current);
      if (last.snapshot) {
        var restoreTo = JSON.parse(JSON.stringify(last.snapshot));
        docRef.current = restoreTo;
        setEditorDocRef(restoreTo);
        lastSnapshotRef.current = JSON.parse(JSON.stringify(restoreTo));
        lastLayoutSnapshotRef.current = cloneLayout(last.layout);
        var el = editorBodyRef.current;
        if (el) {
          el.innerHTML = w.MynoteEditor.renderDocToEditorHTML(restoreTo, filesRef.current);
          restoreLayout(last.layout, restoreTo);
        }
        setRenderKey(function (p) { return p + 1; });
        if (last.restoreSelection) w.requestAnimationFrame(function () { restoreEditorSelection(last.restoreSelection); });
        h.future.push({ snapshot: current, layout: currentLayoutSnapshot, restoreSelection: last.redoSelection || null, undoSelection: last.restoreSelection || null });
        lastPushAtRef.current = 0;
        triggerAutoSave();
        return;
      }
      var restorePatchLayout = cloneLayout(last.layout || currentLayoutSnapshot);
      applyPatch(last.inverse, restorePatchLayout);
      lastSnapshotRef.current = JSON.parse(JSON.stringify(docRef.current));
      lastLayoutSnapshotRef.current = cloneLayout(restorePatchLayout);
      h.future.push({ patch: last.patch, inverse: last.inverse, layout: currentLayoutSnapshot, redoLayout: cloneLayout(last.redoLayout || currentLayoutSnapshot) });
      lastPushAtRef.current = 0;
      triggerAutoSave();
    }, [applyPatch, triggerAutoSave, docRef, editorBodyRef, filesRef, setEditorDocRef, setRenderKey, triggerAutoSave]);

    var redo = R.useCallback(function () {
      var h = history.current, nxt = h.future[h.future.length - 1];
      if (!nxt) return;
      h.future.pop();
      var current = JSON.parse(JSON.stringify(docRef.current));
      var currentLayoutSnapshot = currentLayout(current);
      if (nxt.snapshot) {
        var restoreTo = JSON.parse(JSON.stringify(nxt.snapshot));
        docRef.current = restoreTo;
        setEditorDocRef(restoreTo);
        lastSnapshotRef.current = JSON.parse(JSON.stringify(restoreTo));
        lastLayoutSnapshotRef.current = cloneLayout(nxt.layout);
        var el = editorBodyRef.current;
        if (el) {
          el.innerHTML = w.MynoteEditor.renderDocToEditorHTML(restoreTo, filesRef.current);
          restoreLayout(nxt.layout, restoreTo);
        }
        setRenderKey(function (p) { return p + 1; });
        if (nxt.restoreSelection) w.requestAnimationFrame(function () { restoreEditorSelection(nxt.restoreSelection); });
        h.past.push({ snapshot: current, layout: currentLayoutSnapshot, restoreSelection: nxt.undoSelection || null, redoSelection: nxt.restoreSelection || null });
        lastPushAtRef.current = 0;
        triggerAutoSave();
        return;
      }
      var redoPatchLayout = cloneLayout(nxt.redoLayout || nxt.layout || currentLayoutSnapshot);
      applyPatch(nxt.patch, redoPatchLayout);
      lastSnapshotRef.current = JSON.parse(JSON.stringify(docRef.current));
      lastLayoutSnapshotRef.current = cloneLayout(redoPatchLayout);
      h.past.push({ patch: nxt.patch, inverse: nxt.inverse, layout: currentLayoutSnapshot, redoLayout: redoPatchLayout });
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
      lastLayoutSnapshotRef: lastLayoutSnapshotRef,
      lastPushAtRef: lastPushAtRef,
      recordOp: recordOp,
      applyPatch: applyPatch,
      recordUndoPoint: recordUndoPoint,
      recordUndoTransaction: recordUndoTransaction,
      undo: undo,
      redo: redo
    };
  }

  w.MynoteEditorHooks = w.MynoteEditorHooks || {};
  w.MynoteEditorHooks.useEditorHistory = useEditorHistory;
})(window);
