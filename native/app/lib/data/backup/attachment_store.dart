import 'dart:io';
import 'dart:typed_data';

/// 附件字节存储抽象：备份层只认 id -> bytes，落盘细节与平台解耦。
/// 本地路径仅是 DB 里的逻辑标记（attachments/<id>），真实位置由实现决定。
abstract class AttachmentStore {
  Future<void> write(String id, Uint8List bytes);
  Future<Uint8List?> read(String id);
  Future<void> delete(String id);
  Future<void> clear();
}

/// 测试用内存实现。
class MemoryAttachmentStore implements AttachmentStore {
  final Map<String, Uint8List> files = {};

  @override
  Future<void> write(String id, Uint8List bytes) async => files[id] = bytes;

  @override
  Future<Uint8List?> read(String id) async => files[id];

  @override
  Future<void> delete(String id) async => files.remove(id);

  @override
  Future<void> clear() async => files.clear();
}

/// 原生端文件实现：根目录由调用方给出（path_provider 的文档目录）。
class FileAttachmentStore implements AttachmentStore {
  FileAttachmentStore(this.rootDir);
  final Directory rootDir;

  File _file(String id) => File('${rootDir.path}/$id');

  @override
  Future<void> write(String id, Uint8List bytes) async {
    await rootDir.create(recursive: true);
    await _file(id).writeAsBytes(bytes, flush: true);
  }

  @override
  Future<Uint8List?> read(String id) async {
    final f = _file(id);
    if (!await f.exists()) return null;
    return f.readAsBytes();
  }

  @override
  Future<void> delete(String id) async {
    final f = _file(id);
    if (await f.exists()) await f.delete();
  }

  @override
  Future<void> clear() async {
    if (await rootDir.exists()) {
      await rootDir.delete(recursive: true);
    }
  }
}
