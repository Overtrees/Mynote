/* Bounded streaming ZIP decoder. Runs away from the UI thread and caps actual inflated bytes. */
importScripts('../../vendor/fflate.min.js');

function compressZip(data) {
  try {
    var files = data.files || {}, names = Object.keys(files), total = 0;
    var maxExpanded = data.maxExpanded || 100 * 1024 * 1024;
    var maxFile = data.maxFile || 50 * 1024 * 1024;
    var maxCompressed = data.maxCompressed || 50 * 1024 * 1024;
    if (!names.length || names.length > (data.maxEntries || 3000)) throw new Error('备份文件数量超过安全限制');
    names.forEach(function (name) {
      if (!name || name.charAt(0) === '/' || name.indexOf('\\') >= 0 || name.indexOf('\0') >= 0 || name.split('/').some(function (p) { return p === '..' || p === '__proto__' || p === 'constructor' || p === 'prototype'; })) throw new Error('备份包含不安全路径');
      var value = files[name], size = value && value.byteLength != null ? value.byteLength : value && value.length || 0;
      if (size > maxFile) throw new Error('单个备份文件超过安全限制');
      total += size;
      if (total > maxExpanded) throw new Error('备份总大小超过安全限制');
    });
    var zipped = fflate.zipSync(files, { level: data.level == null ? 3 : data.level });
    if (zipped.byteLength > maxCompressed) throw new Error('压缩后的备份超过安全上限');
    self.postMessage({ zip: zipped }, [zipped.buffer]);
    self.close();
  } catch (error) {
    self.postMessage({ error: (error && error.message) || String(error) });
    self.close();
  }
}

self.onmessage = function (event) {
  if (event.data && event.data.mode === 'compress') return compressZip(event.data);
  var bytes = new Uint8Array(event.data.buffer);
  var maxExpanded = event.data.maxExpanded || 100 * 1024 * 1024;
  var maxFile = event.data.maxFile || 50 * 1024 * 1024;
  var maxEntries = event.data.maxEntries || 3000;
  var files = Object.create(null), chunksByName = Object.create(null);
  var total = 0, seen = 0, done = 0, inputFinished = false, sent = false;
  var unzip = new fflate.Unzip(function (file) {
    if (++seen > maxEntries) return fail('ZIP 文件数量超过安全限制');
    if (!file.name || file.name.indexOf('\\') >= 0 || file.name.indexOf('\0') >= 0 || file.name.charAt(0) === '/' || file.name.split('/').some(function (p, i, a) { return p === '..' || p === '__proto__' || p === 'prototype' || p === 'constructor' || (p === '' && i !== a.length - 1); })) return fail('ZIP 包含不安全路径');
    if (Object.prototype.hasOwnProperty.call(chunksByName, file.name)) return fail('ZIP 包含重复文件路径');
    var chunks = chunksByName[file.name] = [], size = 0;
    file.ondata = function (err, chunk, final) {
      if (sent) return;
      if (err) return fail('ZIP 解压失败：' + (err.message || err));
      if (chunk && chunk.length) {
        size += chunk.length; total += chunk.length;
        if (size > maxFile || total > maxExpanded) return fail(size > maxFile ? 'ZIP 单个文件超过实际解压限制' : 'ZIP 实际解压总量超过安全限制');
        chunks.push(chunk.slice());
      }
      if (final) {
        var out = new Uint8Array(size), offset = 0;
        chunks.forEach(function (part) { out.set(part, offset); offset += part.length; });
        files[file.name] = out;
        delete chunksByName[file.name];
        done++;
        finishIfReady();
      }
    };
    file.start();
  });
  unzip.register(fflate.UnzipPassThrough);
  // Inflate in a dedicated worker so the page stays responsive. Small input slices
  // let the streaming inflater yield often enough for actual-size caps to abort early.
  unzip.register(fflate.UnzipInflate);

  function fail(message) {
    if (sent) return;
    sent = true;
    try { unzip.terminate(); } catch (_) {}
    self.postMessage({ error: String(message) });
    self.close();
  }
  function finishIfReady() {
    if (sent || !inputFinished || done !== seen) return;
    sent = true;
    var transfers = Object.keys(files).map(function (name) { return files[name].buffer; });
    self.postMessage({ files: files }, transfers);
    self.close();
  }

  try {
    // Small input chunks keep streaming inflate bounded even for highly-compressible entries.
    var chunkSize = 4 * 1024;
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      unzip.push(bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)), offset + chunkSize >= bytes.length);
    }
    if (bytes.length === 0) unzip.push(bytes, true);
    inputFinished = true;
    finishIfReady();
  } catch (error) { fail('ZIP 解压失败：' + (error && error.message || error)); }
};
