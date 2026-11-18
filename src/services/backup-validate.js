/* 备份安全校验：手写 ZIP 目录/本地头校验 + 备份结构递归白名单。从 storage.idb.js 抽出（纯函数，零 DOM 依赖）。 */
(function (w) {
  'use strict';

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
      var blockIds = Object.create(null);
      if (memo.doc) {
        memo.doc.forEach(function (block) {
          validateNode(block, 0);
          if (block.id && blockIds[block.id]) throw new Error('笔记包含重复正文块 ID');
          if (block.id) blockIds[block.id] = true;
        });
      }
      if (memo.layout != null) {
        var layout = memo.layout;
        if (!layout || typeof layout !== 'object' || Array.isArray(layout) || layout.version !== 1 || !['flow', 'independent'].includes(layout.mode) || !Array.isArray(layout.left) || !Array.isArray(layout.right)) throw new Error('笔记列布局格式无效');
        if (layout.left.length > 20000 || layout.right.length > 20000) throw new Error('笔记列布局内容过多');
        var layoutIds = Object.create(null);
        var orderedLayoutIds = [];
        [layout.left, layout.right].forEach(function (columnIds) {
          columnIds.forEach(function (id) {
            if (!validId(id, 128, false)) throw new Error('笔记列布局块 ID 无效');
            if (layoutIds[id]) throw new Error('笔记列布局包含重复块 ID');
            if (!blockIds[id]) throw new Error('笔记列布局引用了不存在的正文块');
            layoutIds[id] = true;
            orderedLayoutIds.push(id);
          });
        });
        var docIds = (memo.doc || []).map(function (block) { return block && block.id || ''; });
        if (docIds.some(function (id) { return !id; }) || orderedLayoutIds.length !== docIds.length || orderedLayoutIds.some(function (id, index) { return id !== docIds[index]; })) throw new Error('笔记列布局与正文块顺序不匹配');
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


  w.MynoteBackupValidate = {
    validateZipInput: validateZipInput,
    validateBackupData: validateBackupData,
    validateZipPayload: validateZipPayload
  };
})(window);
