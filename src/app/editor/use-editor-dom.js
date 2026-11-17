/* 编辑器 DOM 事件管线：click 分发 / todo / blur 渲染 / focus。从 Editor 主组件抽出。 */
(function (w) {
  'use strict';
  var R = w.React;
  var useCallback = R.useCallback;

  function useEditorDom(opts) {
    var editorBodyRef = opts.editorBodyRef;
    var docRef = opts.docRef;
    var filesRef = opts.filesRef;
    var files = opts.files;
    var setFiles = opts.setFiles;
    var memo = opts.memo;
    var triggerAutoSave = opts.triggerAutoSave;
    var flushAutoSave = opts.flushAutoSave;
    var recordUndoPoint = opts.recordUndoPoint;
    var setRenderKey = opts.setRenderKey;
    var setEditorScrolled = opts.setEditorScrolled;
    var setEditingTitle = opts.setEditingTitle;
    var isEditingTitleRef = opts.isEditingTitleRef;
    var editingStyleSnapshot = opts.editingStyleSnapshot;
    var editorFocusedRef = opts.editorFocusedRef;
    var closedRef = opts.closedRef;
    var mdCheckTimerRef = opts.mdCheckTimerRef;
    var blurApplyingRef = opts.blurApplyingRef;
    var showMenu = opts.showMenu;
    var closeEditorMenu = opts.closeEditorMenu;
    var showSlash = opts.showSlash;
    var slashApplyingRef = opts.slashApplyingRef;
    var slashHideTimerRef = opts.slashHideTimerRef;
    var slashTargetBlockRef = opts.slashTargetBlockRef;
    var setSlashQuery = opts.setSlashQuery;
    var setSlashTargetBlockId = opts.setSlashTargetBlockId;
    var setLightboxSrc = opts.setLightboxSrc;
    var openImageTextSheet = opts.openImageTextSheet;
    var pendingImageBlockRef = opts.pendingImageBlockRef;
    var fileInputRef = opts.fileInputRef;
    var heightMap = opts.heightMap;
    var ensureTrailingParagraphBlock = opts.ensureTrailingParagraphBlock;
    var setHasTyped = opts.setHasTyped;
    var inputTimerRef = opts.inputTimerRef;
    var parseEditorDOM = opts.parseEditorDOM;
    var renderDocToEditorHTML = opts.renderDocToEditorHTML;
    var renderAtomicHTML = opts.renderAtomicHTML;
    var renderMarkdownHtml = opts.renderMarkdownHtml;
    var escapeHTML = opts.escapeHTML;
    var onOpenWikiLink = opts.onOpenWikiLink;

  var handleEditorClick = useCallback(function (e) {
    var host = editorBodyRef.current;
    if (host) {
      var clickedBlock = e.target && e.target.closest && e.target.closest('[data-blockid]');
      if (clickedBlock && clickedBlock.dataset.musicUrl === 'pending') {
        host.dataset.activeMusicInputId = clickedBlock.dataset.blockid || '';
      } else if (clickedBlock || e.target === host) {
        delete host.dataset.activeMusicInputId;
      }
    }
    if (showMenu) closeEditorMenu();
    /* ---- 点击图文说明区 → 阅读完整文字 ---- */
    var textClickTarget = e.target;
    if (textClickTarget === editorBodyRef.current && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      textClickTarget = document.elementFromPoint(e.clientX, e.clientY) || textClickTarget;
    }
    var textArea = textClickTarget && textClickTarget.closest && textClickTarget.closest('.itc-text, .itr-text');
    if (textArea && openImageTextSheet) {
      e.preventDefault();
      openImageTextSheet(textArea);
      return;
    }
    /* ---- 双链优先导航；保存当前编辑内容后按笔记名打开或新建目标笔记 ---- */
    var wikiLink = e.target && e.target.closest && e.target.closest('a.mynote-wiki-link[data-note-title]');
    if (wikiLink && typeof onOpenWikiLink === 'function') {
      e.preventDefault();
      var targetTitle = wikiLink.dataset.noteTitle || '';
      if (typeof flushAutoSave === 'function') {
        Promise.resolve(flushAutoSave()).then(function () {
          onOpenWikiLink(targetTitle);
        }).catch(function (error) {
          console.warn('[此刻] wiki navigation save', error);
          onOpenWikiLink(targetTitle);
        });
      } else {
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
        onOpenWikiLink(targetTitle);
      }
      return;
    }
    /* ---- 点击已渲染块（表格/代码块/Callout）→ 回到编辑态 ---- */
    var mdBlock = e.target.closest('.md-preview.block[data-mdtext]');
    if (mdBlock && !e.target.closest('a, button, input, summary, [contenteditable="true"]')) {
      var mdtext = mdBlock.dataset.mdtext || '';
      var bid = mdBlock.dataset.blockid || '';
      var p = document.createElement('p');
      p.dataset.blockid = bid;
      p.textContent = mdtext;
      mdBlock.replaceWith(p);
      // 聚焦到新段落
      var r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(false);
      var s = window.getSelection();
      if (s) { s.removeAllRanges(); s.addRange(r); }
      if (editorBodyRef.current) editorBodyRef.current.focus();
      clearTimeout(mdCheckTimerRef.current);
      return;
    }
    /* ---- 点击卡片图片区 → 打开图库 ---- */
    var cardImg = e.target.closest('[data-blockid]');
    if (cardImg && cardImg.dataset && cardImg.dataset.type) {
      var cType = cardImg.dataset.type;
      var cTarget = e.target;
      /* ---- 点击卡片右侧区域 → 新增一行（优先于图库/图片区） ---- */
      var cardTypes = ['imgTextCard', 'imageTextRow', 'image', 'gallery', 'musicCard', 'divider'];
      if (cardTypes.includes(cType)) {
        var rect = cardImg.getBoundingClientRect();
        if (e.clientX - rect.left > rect.width * 0.85) {
          e.preventDefault();
          var newP = document.createElement('p');
          newP.dataset.blockid = window.MynoteId.genId();
          newP.innerHTML = '<br>';
          cardImg.parentNode.insertBefore(newP, cardImg.nextSibling);
          var r2 = document.createRange();
          r2.setStart(newP, 0);
          r2.collapse(true);
          var sel2 = window.getSelection();
          if (sel2) {
            sel2.removeAllRanges();
            sel2.addRange(r2);
          }
          setEditorDocRef(docRef.current);
          docRef.current = parseEditorDOM(editorBodyRef.current);
          triggerAutoSave();
          return;
        }
      }
      var isImgArea = cType === 'image' || cType === 'gallery' || cType === 'imgTextCard' && cTarget.closest('.itc-img-wrap') || cType === 'imageTextRow' && cTarget.closest('.itr-img');
      if (isImgArea) {
        e.preventDefault();
        e.stopPropagation();
        // 已有图 → lightbox 预览；占位图 → 打开图库
        var existingImg = cTarget.closest('img') || cardImg.querySelector('img');
        if (existingImg && existingImg.src && !existingImg.src.startsWith('data:image/svg')) {
          setLightboxSrc(existingImg.src);
          return;
        }
        pendingImageBlockRef.current = cardImg.dataset.blockid;
        /* 关闭键盘 */
        if (document.activeElement) document.activeElement.blur();
        if (fileInputRef.current) fileInputRef.current.click();
        return;
      }
    }
    // MD render → 点击还原为可编辑文本
    var renderedEl = e.target.closest('[data-mdtext]');
    if (renderedEl && e.target.closest('summary')) return;
    if (renderedEl) {
      var id = renderedEl.dataset.blockid;
      var text = renderedEl.dataset.mdtext || '';
      var targetP;
      if (renderedEl.tagName === 'P') {
        renderedEl.removeAttribute('data-mdtext');
        renderedEl.removeAttribute('contenteditable');
        renderedEl.removeAttribute('tabindex');
        renderedEl.removeAttribute('role');
        renderedEl.removeAttribute('aria-label');
        renderedEl.classList.remove('md-preview-inline');
        renderedEl.textContent = text;
        targetP = renderedEl;
      } else {
        /* 块级渲染 → 替换回可编辑段落 */
        /* 表格逐行恢复为独立段落，其他（callout 等）保持单段落 */
        var lines = text.split('\n').filter(function (l) {
          return l.trim();
        });
        if (lines.length > 1 && lines[0].startsWith('|')) {
          var firstP = document.createElement('p');
          firstP.dataset.blockid = id;
          firstP.textContent = lines[0];
          renderedEl.replaceWith(firstP);
          var lastP = firstP;
          for (var li = 1; li < lines.length; li++) {
            var nextP = document.createElement('p');
            nextP.dataset.blockid = window.MynoteId.genId();
            nextP.textContent = lines[li];
            lastP.after(nextP);
            lastP = nextP;
          }
          targetP = lastP;
        } else {
          var p = document.createElement('p');
          p.dataset.blockid = id;
          p.textContent = text;
          renderedEl.replaceWith(p);
          targetP = p;
        }
      }
      /* 光标放到最后一个可编辑段落末尾 */
      var range = document.createRange();
      range.selectNodeContents(targetP);
      range.collapse(false);
      var sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      targetP.focus();
      setEditorDocRef(docRef.current);
      docRef.current = parseEditorDOM(editorBodyRef.current);
      triggerAutoSave();
      return;
    }

    // 点击图片/附件左右边缘 → 插入新段落
    // 点击音乐卡片 → 输入链接
    var musicCard = e.target && e.target.closest && e.target.closest('[data-type="musicCard"]');
    /* Some browsers retarget clicks from non-editable atoms inside contentEditable to the editor.
       Resolve the visually hit card so a rendered music link remains clickable. */
    if (!musicCard && e.target === editorBodyRef.current && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      var hitTarget = document.elementFromPoint(e.clientX, e.clientY);
      musicCard = hitTarget && hitTarget.closest && hitTarget.closest('[data-type="musicCard"]');
    }
    if (musicCard) {
      var blockId2 = musicCard.dataset.blockid;
      var url2 = musicCard.dataset.url || '';
      if (!url2) {
        e.preventDefault();
        /* 无链接 → 原地替换为可编辑输入行 */
        var inputDiv = document.createElement('div');
        inputDiv.contentEditable = 'true';
        inputDiv.dataset.blockid = blockId2;
        inputDiv.dataset.musicUrl = 'pending';
        inputDiv.style.cssText = 'padding:12px 18px;border-radius:var(--radius-999);background:var(--glass-control-bg);backdrop-filter:var(--glass-control-filter);-webkit-backdrop-filter:var(--glass-control-filter);border:0.5px solid var(--glass-control-border);font-size:var(--font-14);color:var(--text-main);outline:none;';
        inputDiv.textContent = '粘贴音乐链接到这里...';
        musicCard.replaceWith(inputDiv);
        /* 更新 doc 状态为 input */
        var docMc = docRef.current;
        var mcIdx = docMc.findIndex(function (n) {
          return n.id === blockId2;
        });
        if (mcIdx !== -1) {
          docMc[mcIdx].status = 'input';
        }
        var r3 = document.createRange();
        r3.selectNodeContents(inputDiv);
        r3.collapse(false);
        var s3 = window.getSelection();
        if (s3) {
          s3.removeAllRanges();
          s3.addRange(r3);
        }
        inputDiv.focus();
      }
      if (url2) {
        // Chromium can retarget clicks inside contenteditable to the editing host; open the link explicitly.
        e.preventDefault();
        window.open(url2, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    var atomic = e.target.closest('.atomic.attachment, .atomic.link-card-block, .atomic.link-card-err');
    if (atomic) {
      var rect = atomic.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var el = editorBodyRef.current;
      if (!el) return;
      if (x < 28) {
        // 左侧点击 → 在附件前插入段落
        var newP = document.createElement('p');
        newP.dataset.blockid = window.MynoteId.genId();
        newP.innerHTML = '<br>';
        atomic.before(newP);
        var range = document.createRange();
        range.selectNodeContents(newP);
        range.collapse(true);
        var sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        el.focus();
        setEditorDocRef(docRef.current);
        docRef.current = parseEditorDOM(el);
        triggerAutoSave();
        return;
      } else if (x > rect.width - 28) {
        // 右侧点击 → 在附件后插入/聚焦段落
        var next = atomic.nextElementSibling;
        if (!next || next.contentEditable === 'false' || next.tagName === 'HR') {
          var newP = document.createElement('p');
          newP.dataset.blockid = window.MynoteId.genId();
          newP.innerHTML = '<br>';
          atomic.after(newP);
          next = newP;
        } else if (!next.textContent) {
          // 空段落加零宽空格确保光标可见
          next.innerHTML = '<br>';
        }
        var range = document.createRange();
        range.selectNodeContents(next);
        range.collapse(true);
        var sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        el.focus(); // 聚焦编辑器容器而非段落
      } else if (e.target.closest('.att-hint')) {
        e.preventDefault();
        e.stopPropagation();
        // 清除选区 + blur 编辑器，阻止 iOS contenteditable 弹出自动填充菜单
        var sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
        var atomic = e.target.closest('.atomic.attachment');
        var fid = atomic ? atomic.dataset.fileid : null;
        if (fid && files[fid] && files[fid].url) {
          var fi = files[fid];
          if (!(fi.type && fi.type.indexOf('image/') === 0)) {
            var blob = window.MynoteIdb.dataURLtoBlob(fi.url);
            if (blob) {
              var sf = new File([blob], fi.name || '文件', { type: fi.type || 'application/octet-stream' });
              if (navigator.share && navigator.canShare && navigator.canShare({ files: [sf] })) {
                navigator.share({ files: [sf], title: fi.name || '文件' }).catch(function(er){ if (er.name !== 'AbortError') warn('附件分享失败', er); });
              } else {
                var dl = document.createElement('a');
                dl.href = URL.createObjectURL(blob);
                dl.download = fi.name || '文件';
                dl.click();
                URL.revokeObjectURL(dl.href);
              }
            }
          }
        }
        setEditorDocRef(docRef.current);
        docRef.current = parseEditorDOM(el);
        triggerAutoSave();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setEditorDocRef(docRef.current);
      docRef.current = parseEditorDOM(el);
      triggerAutoSave();
      return;
    }
    if (e.target.closest('[data-type="todo"] .todo-checkbox')) return;
    // Link card click to open URL
    var lc = e.target.closest('.atomic[data-url]');
    if (lc && lc.dataset.url) {
      window.open(lc.dataset.url, '_blank');
    }
  }, [triggerAutoSave, flushAutoSave, showMenu, files, onOpenWikiLink]);

  /* ---- 原生待办复选框：同步保存状态，键盘操作保留焦点 ---- */
  var handleTodoClick = useCallback(function (e) {
    var checkbox = e.target.closest('[data-type="todo"] .todo-checkbox');
    if (!checkbox) return;
    var todoBlock = checkbox.closest('[data-type="todo"]');
    if (!todoBlock) return;
    var todoText = todoBlock.textContent || '';
    if (!todoText.trim()) return;
    var newChecked = checkbox.checked;
    checkbox.dataset.checked = newChecked ? 'true' : 'false';
    checkbox.setAttribute('aria-checked', newChecked ? 'true' : 'false');
    todoBlock.classList.toggle('is-checked', newChecked);
    var block = todoBlock.closest('[data-blockid]');
    if (block) {
      var id = block.dataset.blockid;
      var idx = docRef.current.findIndex(function (n) { return n.id === id; });
      if (idx !== -1) {
        docRef.current[idx].attrs = Object.assign({}, docRef.current[idx].attrs || {}, { checked: newChecked });
        setEditorDocRef(docRef.current);
        triggerAutoSave();
        // 光标定位到文字末尾
        var textEl = todoBlock.querySelector('span:last-of-type');
        if (e.detail !== 0 && textEl && textEl !== checkbox && editorBodyRef.current) {
          editorBodyRef.current.focus();
          var r = document.createRange();
          r.selectNodeContents(textEl);
          r.collapse(false);
          var sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(r); }
        }
      }
    }
  }, [triggerAutoSave]);

  /* ===== Markdown 自动渲染（blur 时触发，延迟防抖） ===== */

  var handleEditorBlur = useCallback(function () {
    editorFocusedRef.current = false;
    // 等待焦点转移完成；若正文只是把焦点交给标题，键盘并未收起，不重置顶栏。
    requestAnimationFrame(function () {
      var active = document.activeElement;
      var titleHasFocus = isEditingTitleRef.current || active && active.closest && active.closest('.editor-title-dock');
      if (titleHasFocus) return;
      if (window.visualViewport) window.scrollTo(0, 0);
      // iOS 可能异步恢复滚动位置，重复校正期间若标题重新获得焦点则停止。
      var retries = 0;
      function forceVertical() {
        var current = document.activeElement;
        if (isEditingTitleRef.current || current && current.closest && current.closest('.editor-title-dock')) return;
        setEditorScrolled(false);
        retries++;
        if (retries < 6) setTimeout(forceVertical, 80);
      }
      forceVertical();
    });
    clearTimeout(mdCheckTimerRef.current);
    if (blurApplyingRef.current) return;
    mdCheckTimerRef.current = setTimeout(function () {
      if (blurApplyingRef.current || closedRef.current || slashApplyingRef.current) return;
      blurApplyingRef.current = true;
      var el = editorBodyRef.current;
      if (!el) {
        blurApplyingRef.current = false;
        return;
      }
      var changed = false;
      var ps = el.querySelectorAll('p');
      if (!ps.length) {
        blurApplyingRef.current = false;
        return;
      }
      /* 段落过多时跳过块级渲染（表格/列表/代码块），仍做轻量内联渲染 */
      var skipHeavy = ps.length > 200;

      /* ---- 第一遍：识别代码块/列表行组，合并渲染 ---- */
      var ti = 0;
      if (!skipHeavy) {
        // 代码块：以 ``` 开头和结尾的行组（收集规则见 MynoteMdBlocks）
        var codeGroups = [];
        ti = 0;
        while (ti < ps.length) {
          var txt = (ps[ti].textContent || '').trim();
          if (MynoteMdBlocks.isFenceLine(txt)) {
            var fg = MynoteMdBlocks.collectFenceGroup(ps, ti);
            codeGroups.push({
              indices: MynoteMdBlocks.range(fg.start, fg.end),
              texts: fg.texts
            });
            ti = fg.end;
          } else {
            ti++;
          }
        }

        // 列表：连续以 -、*、数字. 开头的行组（收集规则见 MynoteMdBlocks）
        var listGroups = [];
        ti = 0;
        while (ti < ps.length) {
          var txt = (ps[ti].textContent || '').trim();
          if (MynoteMdBlocks.isListLine(txt)) {
            var lg = MynoteMdBlocks.collectListGroup(ps, ti);
            listGroups.push({
              indices: MynoteMdBlocks.range(lg.start, lg.end),
              texts: lg.texts
            });
            ti = lg.end;
          } else {
            ti++;
          }
        }

        /* ---- 处理代码块组 ---- */
        for (var gi2 = 0; gi2 < codeGroups.length; gi2++) {
          var grp2 = codeGroups[gi2];
          // 跳过已不在 DOM 中的组（被表格组处理牵连删除的）
          if (!ps[grp2.indices[0]] || !ps[grp2.indices[0]].parentNode) continue;
          var merged2 = grp2.texts.join('\n');
          var html2 = renderMarkdownHtml(merged2);
          var tmp2 = document.createElement('div');
          tmp2.innerHTML = html2;
          if (tmp2.firstElementChild && tmp2.firstElementChild.tagName === 'PRE') {
            MynoteMdBlocks.replaceGroupWithPreview(grp2.indices.map(function (k) {
              return ps[k];
            }), merged2, html2);
          }
        }

        /* ---- 处理列表组 ---- */
        for (var gi3 = 0; gi3 < listGroups.length; gi3++) {
          var grp3 = listGroups[gi3];
          if (!ps[grp3.indices[0]] || !ps[grp3.indices[0]].parentNode) continue;
          var merged3 = grp3.texts.join('\n');
          var html3 = renderMarkdownHtml(merged3);
          var tmp3 = document.createElement('div');
          tmp3.innerHTML = html3;
          if (tmp3.firstElementChild && (tmp3.firstElementChild.tagName === 'UL' || tmp3.firstElementChild.tagName === 'OL')) {
            MynoteMdBlocks.replaceGroupWithPreview(grp3.indices.map(function (k) {
              return ps[k];
            }), merged3, html3);
          }
        }
      } /* end if (!skipHeavy) */

      /* ---- 统一为所有块级渲染的组补空段落，并刷新 ps ---- */
      var blockDivs = el.querySelectorAll('.md-preview.block');
      for (var bdi = 0; bdi < blockDivs.length; bdi++) {
        if (ensureTrailingParagraphBlock(blockDivs[bdi])) changed = true;
      }
      ps = el.querySelectorAll('p');

      /* ---- 处理待输入的音乐链接 ---- */
      var muPs = el.querySelectorAll('[data-music-url="pending"]');
      var hydrateMusicCard = function (muP, finalUrl) {
        if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl;
        var muId = muP.dataset.blockid;
        var muUrl3 = finalUrl;
        muP.removeAttribute('data-music-url');
        /* 立即将 doc 中的 status 改为 loading，防止后续重渲染出输入框 */
        var docMu3 = docRef.current;
        var muIdx3 = docMu3.findIndex(function (n) {
          return n.id === muId;
        });
        if (muIdx3 !== -1) {
          docMu3[muIdx3].url = muUrl3;
          docMu3[muIdx3].status = 'loading';
          docMu3[muIdx3].type = 'musicCard';
          delete docMu3[muIdx3].children;
        }
          setEditorDocRef(docRef.current);
          /* 显示加载骨架 */
          var loadDiv = document.createElement('div');
          loadDiv.contentEditable = 'false';
          loadDiv.dataset.blockid = muId;
          loadDiv.dataset.type = 'musicCard';
          loadDiv.dataset.url = muUrl3;
          loadDiv.innerHTML = '<div class="link-card-skeleton-cover"></div><div class="link-card-skeleton-body"><div class="link-card-skeleton-line" style="width:75%;"></div><div class="link-card-skeleton-line" style="width:50%;"></div></div>';
          loadDiv.className = 'link-card-skeleton';
          loadDiv.style.cssText = '';
          muP.replaceWith(loadDiv);
          /*
           * 异步获取元数据
           * 注意：doc 中的 status 已在上面改为 loading
           */
          fetchLinkMeta(muUrl3).then(function (meta) {
            var d2 = docRef.current;
            var i2 = d2.findIndex(function (n) {
              return n.id === muId;
            });
            if (i2 !== -1) {
              d2[i2].meta = meta;
              d2[i2].status = meta && meta.title ? 'ready' : 'error';
            }
            var ce2 = editorBodyRef.current;
            if (ce2) {
              var el2 = ce2.querySelector('[data-blockid="' + muId + '"]');
              if (el2) {
                var cv = meta && meta.cover ? proxyImg(meta.cover) : '';
                var tl = meta && meta.title || muUrl3;
                var sr = meta && meta.source || '音乐';
                var finalDiv = document.createElement('a');
                finalDiv.contentEditable = 'false';
                finalDiv.className = 'link-card-block music-card-link';
                finalDiv.href = muUrl3;
                finalDiv.target = '_blank';
                finalDiv.rel = 'noopener noreferrer';
                finalDiv.setAttribute('aria-label', '打开音乐链接');
                finalDiv.dataset.blockid = muId;
                finalDiv.dataset.type = 'musicCard';
                finalDiv.dataset.url = muUrl3;
                var finalHtml = '';
                if (cv) finalHtml += '<div class="lkc-cover"><img src="' + escapeHTML(cv) + '" alt=""></div>';
                finalHtml += '<div class="lkc-body' + (cv ? ' has-cover' : '') + '">';
                finalHtml += '<div class="lkc-title">' + escapeHTML(tl) + '</div>';
                if (meta && meta.subtitle) finalHtml += '<div class="lkc-subtitle">' + escapeHTML(meta.subtitle) + '</div>';
                finalHtml += '<div class="lkc-source"><span class="lkc-source-icon">🎵</span><span class="lkc-source-dot"></span><span class="lkc-source-text">' + escapeHTML(sr) + '</span></div>';
                finalHtml += '</div>';
                finalDiv.innerHTML = finalHtml;
                el2.replaceWith(finalDiv);
                triggerAutoSave();
              }
            }
          }).catch(function () {
            var failedDoc = docRef.current;
            var failedIdx = failedDoc.findIndex(function (n) { return n.id === muId; });
            if (failedIdx !== -1) {
              failedDoc[failedIdx].status = 'error';
              failedDoc[failedIdx].meta = null;
              setEditorDocRef(failedDoc);
            }
            var ce2 = editorBodyRef.current;
            if (ce2) {
              var el2 = ce2.querySelector('[data-blockid="' + muId + '"]');
              if (el2) {
                el2.outerHTML = renderAtomicHTML({ id: muId, type: 'musicCard', url: muUrl3, meta: null, status: 'error' }, files);
              }
            }
            triggerAutoSave();
          });
        changed = true;
      };
      for (var mui = 0; mui < muPs.length; mui++) {
        var muP = muPs[mui];
        var muText = (muP.textContent || '').trim();
        var extractedUrl = muText && muText !== '粘贴音乐链接到这里...' ? extractUrlFromText(muText) || null : null;
        var finalUrl = extractedUrl;
        if (!finalUrl) {
          if (/^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(muText)) {
            finalUrl = 'https://' + muText;
          }
        }
        if (finalUrl) hydrateMusicCard(muP, finalUrl);
      }
      /* ---- 第二遍：处理单段落（内联语法/其他块级语法） ---- */
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (p.contentEditable === 'false') continue;
        var text = (p.textContent || '').trim();
        if (!text || !looksLikeCiaoMarkdown(text)) continue;
        var id = p.dataset.blockid;
        if (!id) continue;
        var res = MynoteMdBlocks.renderSingleParagraph(p, text, { guards: true, ensureTrailing: ensureTrailingParagraphBlock });
        if (res === 'skip') continue;
        if (res === 'inline') {
          // 内联渲染后把光标放回末尾，避免失焦后选区丢失
          var range = document.createRange();
          range.selectNodeContents(p);
          range.collapse(false);
          var sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        changed = true;
      }
      if (changed) {
        setEditorDocRef(docRef.current);
        docRef.current = parseEditorDOM(el);
        /* 强制清除所有 pending 的音乐卡片输入状态（无链接的输入框 → 回退到空态） */
        var forceDoc = docRef.current;
        for (var fi = 0; fi < forceDoc.length; fi++) {
          if (forceDoc[fi].type === 'musicCard' && forceDoc[fi].status === 'input' && !forceDoc[fi].url) {
            forceDoc[fi].status = 'empty';
            // 同步替换 DOM 中的输入框为空态 pill
            var mcEl = el.querySelector('[data-blockid="' + forceDoc[fi].id + '"]');
            if (mcEl && mcEl.dataset.musicUrl === 'pending') {
              var pillDiv = document.createElement('div');
              pillDiv.contentEditable = 'false';
              pillDiv.dataset.blockid = forceDoc[fi].id;
              pillDiv.dataset.type = 'musicCard';
              pillDiv.style.cssText = 'padding:12px 16px;border-radius:var(--radius-999);background:var(--glass-content-bg);backdrop-filter:var(--glass-content-filter);-webkit-backdrop-filter:var(--glass-content-filter);border:0.5px solid var(--glass-content-border);font-size:var(--font-14);color:var(--text-main);display:flex;align-items:center;gap:10px;';
              pillDiv.innerHTML = '<span>🎵</span><span>点击粘贴音乐链接</span>';
              mcEl.replaceWith(pillDiv);
            }
          }
        }
        /* 清除 DOM 和 doc 中已删除的 musicCard 输入框残留（doc 已不再包含的） */
        var seenMusicIds = {};
        el.querySelectorAll('[data-type="musicCard"]').forEach(function (mcEl) {
          var mid = mcEl.dataset.blockid;
          if (mid) {
            seenMusicIds[mid] = true;
          }
        });
        el.querySelectorAll('[data-music-url="pending"]').forEach(function (remEl) {
          var dupId = remEl.dataset.blockid;
          // 只删除 doc 中已不存在的残留（有 url 的已在上面处理，无 url 的已替换为空态）
          if (dupId) {
            var docIdx = docRef.current.findIndex(function (n) { return n.id === dupId; });
            if (docIdx === -1) {
              remEl.remove();
            }
          }
        });
        triggerAutoSave();
      }
      blurApplyingRef.current = false;
    }, 400);
  }, [triggerAutoSave]);

  var handleEditorFocus = R.useCallback(function (e) {
    editorFocusedRef.current = true;
    if (showMenu) closeEditorMenu();
    clearTimeout(mdCheckTimerRef.current);
    // 检查是否有 MD 预览块需要还原（点击进入编辑时）
    var el = editorBodyRef.current;
    if (!el) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var node = sel.focusNode;
    var preview = node && (node.closest ? node.closest('[data-mdtext]') : null);
    if (!preview) preview = e && e.target && e.target.closest ? e.target.closest('[data-mdtext]') : null;
  }, [showMenu]);

    return {
      handleEditorClick: handleEditorClick,
      handleTodoClick: handleTodoClick,
      handleEditorBlur: handleEditorBlur,
      handleEditorFocus: handleEditorFocus
    };
  }

  w.MynoteEditorHooks = w.MynoteEditorHooks || {};
  w.MynoteEditorHooks.useEditorDom = useEditorDom;
})(window);
