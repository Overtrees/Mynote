/* ZIP 打包/解压服务：Worker 有界解压 + 主线程降级 + 流式压缩。BackupView 抽出。 */
(function (w) {
  'use strict';

  function unzipOnMainThread(bytes) {
    // file:// 或 Worker 不可用时降级到主线程 fflate；限流仍由 validateZipInput / validateZipPayload 把关。
    var files = w.fflate.unzipSync(bytes);
    w.MynoteIdb.validateZipPayload(files);
    return files;
  }

  function unzipZipBounded(buffer, limits) {
    limits = limits || {};
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    w.MynoteIdb.validateZipInput(bytes);
    if (typeof Worker === 'undefined') {
      return Promise.resolve(unzipOnMainThread(bytes));
    }
    var worker;
    try { worker = new Worker(new URL('./zip.worker.js', w.location.href)); }
    catch (e) {
      console.warn('[备份] Worker 启动失败，降级主线程解压', e);
      return Promise.resolve(unzipOnMainThread(bytes));
    }
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(error, files) {
        if (settled) return; settled = true;
        try { worker.terminate(); } catch (_) {}
        if (error) reject(error); else resolve(files);
      }
      worker.onerror = function (e) { finish(new Error('安全解压进程失败：' + (e.message || '未知错误'))); };
      worker.onmessage = function (e) {
        if (e.data && e.data.error) return finish(new Error(e.data.error));
        try { w.MynoteIdb.validateZipPayload(e.data.files); finish(null, e.data.files); }
        catch (err) { finish(err); }
      };
      var transferable = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      worker.postMessage({ buffer: transferable, maxExpanded: limits.maxExpanded || 100 * 1024 * 1024, maxFile: limits.maxFile || 50 * 1024 * 1024, maxEntries: limits.maxEntries || 3000 }, [transferable]);
    });
  }

  async function checkedZip(bytes, limits) { return unzipZipBounded(bytes, limits); }

  async function compressZipBounded(files, level) {
    function compressOnMain() {
      w.MynoteIdb.validateZipPayload(files, { maxExpanded: 100 * 1024 * 1024, maxFile: 50 * 1024 * 1024 });
      var zipped = w.fflate.zipSync(files, { level: level == null ? 3 : level });
      if (zipped.byteLength > 50 * 1024 * 1024) throw new Error('压缩后的备份超过 50 MiB 安全上限');
      return zipped;
    }
    if (typeof Worker === 'undefined') return compressOnMain();
    var worker;
    try { worker = new Worker(new URL('./zip.worker.js', w.location.href)); }
    catch (e) {
      console.warn('[备份] Worker 启动失败，降级主线程打包', e);
      return compressOnMain();
    }
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(error, zip) {
        if (settled) return; settled = true;
        try { worker.terminate(); } catch (_) {}
        if (error) reject(error); else resolve(zip);
      }
      worker.onerror = function (e) { finish(new Error('后台打包失败：' + (e.message || '未知错误'))); };
      worker.onmessage = function (e) {
        if (e.data && e.data.error) return finish(new Error(e.data.error));
        finish(null, e.data.zip);
      };
      var transfers = [];
      Object.keys(files || {}).forEach(function (key) {
        var value = files[key];
        if (value instanceof Uint8Array && value.byteLength) transfers.push(value.buffer);
      });
      worker.postMessage({ mode: 'compress', files: files, level: level, maxExpanded: 100 * 1024 * 1024, maxFile: 50 * 1024 * 1024, maxCompressed: 50 * 1024 * 1024, maxEntries: 3000 }, transfers);
    });
  }

  /**
   * 流式打包：基础文件 + IDB 附件逐个喂 Worker fflate.Zip。
   * Worker 不可用时退回“攒全量 + zipSync”（file:// / 旧浏览器）。
   */
  function compressZipStream(db, baseFiles, level, onProgress) {
    function fallbackSync() {
      var files = Object.assign({}, baseFiles || {});
      return w.MynoteIdb.forEachAttachmentBytes(db, function (name, buf) {
        files[name] = buf;
      }, onProgress).then(function () {
        return compressZipBounded(files, level);
      });
    }
    if (typeof Worker === 'undefined') return fallbackSync();
    var worker;
    try { worker = new Worker(new URL('./zip.worker.js', w.location.href)); }
    catch (e) {
      console.warn('[备份] Worker 启动失败，降级主线程流式打包', e);
      return fallbackSync();
    }
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(error, zip) {
        if (settled) return; settled = true;
        try { worker.terminate(); } catch (_) {}
        if (error) reject(error); else resolve(zip);
      }
      worker.onerror = function (e) { finish(new Error('后台打包失败：' + (e.message || '未知错误'))); };
      worker.onmessage = function (e) {
        if (e.data && e.data.error) return finish(new Error(e.data.error));
        if (e.data && e.data.zip) return finish(null, e.data.zip);
      };
      var names = Object.keys(baseFiles || {});
      var i = 0;
      function sendNext() {
        if (i >= names.length) {
          w.MynoteIdb.forEachAttachmentBytes(db, function (name, buf) {
            if (settled) return;
            worker.postMessage({ mode: 'zip-file', name: name, data: buf, level: level }, [buf.buffer]);
          }, onProgress).then(function () {
            if (!settled) worker.postMessage({ mode: 'zip-end' });
          }).catch(function (err) { finish(err); });
          return;
        }
        var name = names[i++];
        var val = baseFiles[name];
        worker.postMessage({ mode: 'zip-file', name: name, data: val, level: level }, [val.buffer]);
      }
      worker.postMessage({ mode: 'zip-start', level: level, maxCompressed: 50 * 1024 * 1024 });
      sendNext();
    });
  }

  w.MynoteZip = {
    unzipOnMainThread: unzipOnMainThread,
    unzipZipBounded: unzipZipBounded,
    checkedZip: checkedZip,
    compressZipBounded: compressZipBounded,
    compressZipStream: compressZipStream
  };
})(window);
