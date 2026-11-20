import 'package:drift/drift.dart';
import 'package:drift/wasm.dart';
import 'package:sqlite3/wasm.dart';

/// Web：sqlite3.wasm + IndexedDB 虚拟文件系统（主线程，无 worker）。
/// 数据落 IndexedDB，刷新不丢；iOS Safari 的存储回收风险靠 ZIP 导出兜底（方案既定）。
LazyDatabase createConnection() {
  return LazyDatabase(() async {
    final sqlite3 = await WasmSqlite3.loadFromUrl(Uri.parse('sqlite3.wasm'));
    final fs = await IndexedDbFileSystem.open(dbName: 'mynote-db');
    sqlite3.registerVirtualFileSystem(fs, makeDefault: true);
    return WasmDatabase(sqlite3: sqlite3, path: '/mynote.sqlite3');
  });
}
