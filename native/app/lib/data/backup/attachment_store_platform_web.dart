import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:typed_data';

import '../../core/diag.dart';
import 'attachment_store.dart';

AttachmentStore createPlatformAttachmentStore() => OpfsAttachmentStore();

/// Web 端 OPFS（Origin Private File System）附件存储：
/// 目录 mynote-attachments/ 下一文件一 id，另存 _index.json 清单
/// （供 clear 枚举）。刷新/重开持久，与 drift 的 IndexedDB 存储同级。
class OpfsAttachmentStore implements AttachmentStore {
  static const _dirName = 'mynote-attachments';
  static const _indexName = '_index.json';

  Future<JSObject>? _dirFuture;

  Future<JSObject> _dir() {
    final future = _dirFuture ??= () async {
      final navigator = globalContext.getProperty('navigator'.toJS) as JSObject;
      final storage = navigator.getProperty('storage'.toJS) as JSObject;
      final root = await (storage.callMethod(
        'getDirectory'.toJS,
      ) as JSPromise<JSObject>).toDart;
      final opts = JSObject()..setProperty('create'.toJS, true.toJS);
      return (root.callMethod(
        'getDirectoryHandle'.toJS,
        _dirName.toJS,
        opts,
      ) as JSPromise<JSObject>).toDart;
    }();
    // 瞬时失败不永久缓存：失败时清缓存，下次调用重试（否则整个会话附件全灭）
    return future.then(
      (dir) => dir,
      onError: (Object e) {
        if (identical(_dirFuture, future)) _dirFuture = null;
        throw e;
      },
    );
  }

  Future<JSObject> _fileHandle(String name, {bool create = false}) async {
    final dir = await _dir();
    final opts = JSObject()..setProperty('create'.toJS, create.toJS);
    return (dir.callMethod(
      'getFileHandle'.toJS,
      name.toJS,
      opts,
    ) as JSPromise<JSObject>).toDart;
  }

  Future<void> _writeFile(String name, Uint8List bytes) async {
    final handle = await _fileHandle(name, create: true);
    final writable = await (handle.callMethod(
      'createWritable'.toJS,
    ) as JSPromise<JSObject>).toDart;
    await (writable.callMethod(
      'write'.toJS,
      bytes.toJS,
    ) as JSPromise<JSAny?>).toDart;
    await (writable.callMethod('close'.toJS) as JSPromise<JSAny?>).toDart;
  }

  Future<Uint8List?> _readFile(String name) async {
    try {
      final handle = await _fileHandle(name);
      final file = await (handle.callMethod(
        'getFile'.toJS,
      ) as JSPromise<JSObject>).toDart;
      final buffer = await (file.callMethod(
        'arrayBuffer'.toJS,
      ) as JSPromise<JSArrayBuffer>).toDart;
      return buffer.toDart.asUint8List();
    } catch (e) {
      // 区分「文件不存在」（正常返回 null）与真实读错误（记诊断，避免静默残缺）
      var errName = '';
      try {
        errName = ((e as JSObject).getProperty('name'.toJS) as JSString).toDart;
      } catch (_) {}
      if (errName != 'NotFoundError') {
        Diag.error('DB', 'opfs read failed $name: $errName');
      }
      return null;
    }
  }

  Future<Set<String>> _readIndex() async {
    final raw = await _readFile(_indexName);
    if (raw == null) return {};
    try {
      final list = jsonDecode(utf8.decode(raw)) as List<dynamic>;
      return list.map((e) => e.toString()).toSet();
    } catch (_) {
      return {};
    }
  }

  Future<void> _writeIndex(Set<String> ids) async {
    await _writeFile(
      _indexName,
      Uint8List.fromList(utf8.encode(jsonEncode(ids.toList()))),
    );
  }

  @override
  Future<void> write(String id, Uint8List bytes) async {
    // 原子写：先完整写临时名，再 move 覆盖正式名（配额/崩溃中断时旧副本不毁）。
    // move 不可用（旧浏览器）时退化为拷贝+删临时（窗口更小但仍存在）。
    final tmp = '$id.tmp';
    await _writeFile(tmp, bytes);
    var moved = false;
    try {
      final handle = await _fileHandle(tmp);
      if (handle.getProperty('move'.toJS) != null) {
        await (handle.callMethod(
          'move'.toJS,
          id.toJS,
        ) as JSPromise<JSAny?>).toDart;
        moved = true;
      }
    } catch (_) {}
    if (!moved) {
      final data = await _readFile(tmp);
      if (data == null) throw StateError('opfs temp readback failed: $id');
      await _writeFile(id, data);
      final dir = await _dir();
      try {
        await (dir.callMethod(
          'removeEntry'.toJS,
          tmp.toJS,
        ) as JSPromise<JSAny?>).toDart;
      } catch (_) {}
    }
    final ids = await _readIndex();
    if (ids.add(id)) await _writeIndex(ids);
    Diag.log('DB', 'opfs write $id (${bytes.length}B)');
  }

  @override
  Future<Uint8List?> read(String id) => _readFile(id);

  @override
  Future<void> delete(String id) async {
    final dir = await _dir();
    try {
      await (dir.callMethod(
        'removeEntry'.toJS,
        id.toJS,
      ) as JSPromise<JSAny?>).toDart;
    } catch (_) {}
    final ids = await _readIndex();
    if (ids.remove(id)) await _writeIndex(ids);
  }

  @override
  Future<void> clear() async {
    final dir = await _dir();
    final ids = await _readIndex();
    for (final id in ids) {
      try {
        await (dir.callMethod(
          'removeEntry'.toJS,
          id.toJS,
        ) as JSPromise<JSAny?>).toDart;
      } catch (_) {}
    }
    try {
      await (dir.callMethod(
        'removeEntry'.toJS,
        _indexName.toJS,
      ) as JSPromise<JSAny?>).toDart;
    } catch (_) {}
    Diag.log('DB', 'opfs cleared ${ids.length} files');
  }
}
