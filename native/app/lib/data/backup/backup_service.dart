import 'dart:convert';

import '../../core/diag.dart';

import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:flutter/foundation.dart' show compute;
import 'package:drift/drift.dart';

import '../convert/doc_converter.dart';
import '../db/database.dart';
import 'attachment_store.dart';
import 'backup_validate.dart';

/// ZIP 备份导出/导入，与 Web 格式完全互通：
/// - memos.json：{version: 2, exportedAt, memos: [...], avatars: {id: dataUrl}}
/// - manifest.json：{version: 1, attachments: {id: {name, type}}}
/// - attachments/<id>：附件原始字节（文件名只有 id）
/// 导入语义与 Web 一致：整库替换（先写附件文件，再单事务换 DB 行，最后清孤儿文件）。
/// 从 doc 中收集被引用的附件 id（fileId 键 + gallery 裸字符串项），
/// 供旧备份文件名反解使用（与 Web collectMemoFileIds 同口径子集）。
/// P12：ZIP 编码在独立 isolate 执行（Web 无 worker 时 compute 自动
/// 退化为主线程，语义不变），避免大备份打包冻结页面数秒。
List<int> _encodeZipBytes((Archive, int) args) =>
    ZipEncoder().encode(args.$1, level: args.$2);

void _collectDocFileIds(dynamic value, Set<String> out) {
  if (value is Map) {
    final fid = value['fileId'];
    if (fid is String && fid.isNotEmpty) out.add(fid);
    for (final v in value.values) {
      _collectDocFileIds(v, out);
    }
  } else if (value is List) {
    for (final v in value) {
      if (v is String && RegExp(r'^[A-Za-z0-9_-]{1,256}$').hasMatch(v)) {
        out.add(v);
      } else {
        _collectDocFileIds(v, out);
      }
    }
  }
}

/// 旧备份附件文件名反解（Web resolveAttachmentId 逐条移植）。
String resolveAttachmentId(
  String fileName,
  Map<String, dynamic> manifest,
  Set<String> expectedIds,
) {
  if (manifest.containsKey(fileName)) return fileName;
  String? best;
  for (final key in manifest.keys) {
    if (fileName.startsWith('${key}_') &&
        (best == null || key.length > best.length)) {
      best = key;
    }
  }
  if (best != null) return best;
  String? expected;
  for (final id in expectedIds) {
    if ((fileName == id || fileName.startsWith('${id}_')) &&
        (expected == null || id.length > expected.length)) {
      expected = id;
    }
  }
  if (expected != null) return expected;
  final us = fileName.indexOf('_');
  return us > 0 ? fileName.substring(0, us) : fileName;
}

/// 扩展名 → MIME（Web guessMimeFromName 的 24 项映射）。
String? guessMimeFromName(String fileName) {
  final ext = fileName.split('.').last.toLowerCase();
  const map = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'svg': 'image/svg+xml',
    'heic': 'image/heic',
    'heif': 'image/heif',
    'avif': 'image/avif',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'm4v': 'video/mp4',
    'webm': 'video/webm',
    'mp3': 'audio/mpeg',
    'm4a': 'audio/mp4',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'json': 'application/json',
    'zip': 'application/zip',
  };
  return map[ext];
}

/// 魔数嗅探（Web guessMimeFromBytes）。
String? guessMimeFromBytes(Uint8List bytes) {
  if (bytes.length < 4) return null;
  if (bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
    return 'image/jpeg';
  if (bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4E &&
      bytes[3] == 0x47) {
    return 'image/png';
  }
  if (bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46)
    return 'image/gif';
  if (bytes.length >= 12 &&
      bytes[0] == 0x52 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46 &&
      bytes[3] == 0x46 &&
      bytes[8] == 0x57 &&
      bytes[9] == 0x45 &&
      bytes[10] == 0x42 &&
      bytes[11] == 0x50) {
    return 'image/webp';
  }
  if (bytes[0] == 0x42 && bytes[1] == 0x4D) return 'image/bmp';
  return null;
}

class BackupService {
  BackupService(this.db, this.store);

  final MynoteDatabase db;
  final AttachmentStore store;

  static const int maxZipBytes = 50 * 1024 * 1024;
  static const Set<String> _memoKnownKeys = {
    'id',
    'title',
    'pinned',
    'bg',
    'createdAt',
    'updatedAt',
    'doc',
  };

  static String _isoFromMs(int ms) =>
      DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true).toIso8601String();

  static int _msFromIso(dynamic value) {
    if (value is String) {
      final parsed = DateTime.tryParse(value);
      if (parsed != null) return parsed.millisecondsSinceEpoch;
    }
    if (value is num) return value.toInt();
    return DateTime.now().millisecondsSinceEpoch;
  }

  // -------------------------------------------------------------- export

  /// [level] 压缩等级：本地导出 6、云端上传 3（原版口径）。
  /// [includeAvatarsJson] 云端包额外带 avatars.json（原版云端清单）。
  Future<Uint8List> exportZip({
    int level = 3,
    bool includeAvatarsJson = false,
    void Function(int done, int total)? onProgress,
  }) async {
    Diag.log('BACKUP', 'export start');
    final memoRows = await db.select(db.memos).get();
    final attachmentRows = await db.select(db.attachments).get();
    final avatarRows = await db.select(db.avatars).get();

    final memosJson = <Map<String, dynamic>>[];
    for (final row in memoRows) {
      final memo = <String, dynamic>{
        'id': row.id,
        'title': row.title,
        'pinned': row.pinned,
        if (row.bg != null) 'bg': row.bg,
        'createdAt': _isoFromMs(row.createdAt),
        'updatedAt': _isoFromMs(row.updatedAt),
        'doc': jsonDecode(row.docJson),
      };
      final extra = jsonDecode(row.extraJson);
      if (extra is Map) {
        for (final entry in extra.entries) {
          memo.putIfAbsent(entry.key.toString(), () => entry.value);
        }
      }
      memosJson.add(memo);
    }

    final avatarsJson = <String, String>{};
    for (final row in avatarRows) {
      final bytes = await store.read('avatar_${row.id}');
      if (bytes == null) continue;
      avatarsJson[row.id] = 'data:${row.mime};base64,${base64Encode(bytes)}';
    }

    final backup = <String, dynamic>{
      'version': 2,
      'exportedAt': DateTime.now().toUtc().toIso8601String(),
      'memos': memosJson,
      'avatars': avatarsJson,
    };

    final manifest = <String, dynamic>{
      'version': 1,
      'attachments': {
        for (final row in attachmentRows)
          row.id: {'name': row.name, 'type': row.mime},
      },
    };

    final archive = Archive();
    archive.addFile(
      ArchiveFile.string(
        'memos.json',
        const JsonEncoder.withIndent('  ').convert(backup),
      ),
    );
    archive.addFile(
      ArchiveFile.string(
        'manifest.json',
        const JsonEncoder.withIndent('  ').convert(manifest),
      ),
    );
    var expandedBytes = 0;
    var missingAttachments = 0;
    var exportDone = 0;
    for (final row in attachmentRows) {
      exportDone++;
      onProgress?.call(exportDone, attachmentRows.length);
      final bytes = await store.read(row.id);
      if (bytes == null) {
        missingAttachments++;
        continue;
      }
      expandedBytes += bytes.length;
      archive.addFile(ArchiveFile.bytes('attachments/${row.id}', bytes));
    }
    if (missingAttachments > 0) {
      Diag.warn(
        'BACKUP',
        'export: $missingAttachments attachments missing from store, skipped',
      );
    }
    // 打包前展开量校验（原版 validateZipPayload 口径：展开 100MiB/单文件 50MiB）
    if (expandedBytes > 100 * 1024 * 1024) {
      throw BackupValidationError('备份展开总量超过 100 MiB 安全上限');
    }
    if (includeAvatarsJson && avatarsJson.isNotEmpty) {
      archive.addFile(
        ArchiveFile.string(
          'avatars.json',
          const JsonEncoder.withIndent('  ').convert(avatarsJson),
        ),
      );
    }
    final encoded = await compute(_encodeZipBytes, (archive, level));
    if (encoded.length > maxZipBytes) {
      throw BackupValidationError('压缩后的备份超过 50 MiB 安全上限');
    }
    Diag.log('BACKUP', 'export done bytes=${encoded.length}');
    return Uint8List.fromList(encoded);
  }

  // -------------------------------------------------------------- import

  /// 解包 + 校验（替换/合并两种导入共用；校验口径与 Web 一致）。
  /// P12：解包/校验是纯函数，放到独立 isolate 执行避免导入冻结。
  Future<_ParsedBackup> _parseZip(Uint8List zipBytes) =>
      compute(_parseZipBytes, zipBytes);

  static _ParsedBackup _parseZipBytes(Uint8List zipBytes) {
    if (zipBytes.length > maxZipBytes) {
      throw BackupValidationError('备份文件超过 50 MiB 安全上限');
    }
    final Archive archive;
    try {
      archive = ZipDecoder().decodeBytes(zipBytes, verify: true);
    } catch (_) {
      throw BackupValidationError('ZIP 文件损坏或格式无效');
    }
    // 条目数上限按原始条目计（去重后计数可被同名条目绕过）
    if (archive.files.length > 3000) {
      throw BackupValidationError('备份条目数超过 3000 安全上限');
    }
    final files = <String, ArchiveFile>{};
    for (final file in archive.files) {
      // 重复条目名：原版 validateZipInput 直接拒绝（Flutter 此前静默覆盖）
      if (files.containsKey(file.name)) {
        throw BackupValidationError('备份 ZIP 含重复条目: ${file.name}');
      }
      files[file.name] = file;
    }
    validateZipEntryNames(files.keys);
    validateZipPayload({for (final e in files.entries) e.key: e.value.size});

    final memosFile = files['memos.json'];
    if (memosFile == null) {
      throw BackupValidationError('备份 ZIP 中缺少 memos.json');
    }
    final dynamic backup;
    try {
      backup = jsonDecode(utf8.decode(memosFile.content as List<int>));
    } catch (_) {
      throw BackupValidationError('memos.json 解析失败');
    }
    validateBackupData(backup);

    // manifest 可选：缺失时附件名/类型用兜底
    var manifestAttachments = <String, dynamic>{};
    final manifestFile = files['manifest.json'];
    if (manifestFile != null) {
      try {
        final manifest = jsonDecode(
          utf8.decode(manifestFile.content as List<int>),
        );
        if (manifest is Map && manifest['attachments'] is Map) {
          manifestAttachments = Map<String, dynamic>.from(
            manifest['attachments'] as Map,
          );
        }
      } catch (_) {
        // manifest 损坏不阻塞恢复（Web 同样以 memos.json 为准）
      }
    }

    // avatars.json（云端包）优先于 memos.json 内嵌 avatars（原版口径）
    final avatarsFile = files['avatars.json'];
    if (avatarsFile != null && backup is Map) {
      try {
        final aj = jsonDecode(utf8.decode(avatarsFile.content as List<int>));
        if (aj is Map && aj.isNotEmpty) {
          backup['avatars'] = aj;
        }
      } catch (_) {}
    }

    // 附件条目：旧备份文件名为 attachments/<id>_<name>，须反解为真实 id
    //（Web resolveAttachmentId：manifest 精确命中 → manifest 最长前缀 →
    //  doc 引用 id 最长匹配 → 首个 _ 前切分），并推断展示名与 MIME。
    final expectedIds = <String>{};
    final memosList = backup['memos'];
    if (memosList is List) {
      for (final m in memosList) {
        if (m is Map && m['doc'] is List) {
          _collectDocFileIds(m['doc'], expectedIds);
        }
      }
    }
    final attachmentBytes = <String, Uint8List>{};
    final attachmentMeta = <String, ({String name, String mime})>{};
    var parseSkipped = 0;
    for (final entry in files.entries) {
      if (!entry.key.startsWith('attachments/')) continue;
      final fileName = entry.key.substring('attachments/'.length);
      if (fileName.isEmpty || fileName.contains('/')) continue;
      final id = resolveAttachmentId(
        fileName,
        manifestAttachments,
        expectedIds,
      );
      if (attachmentBytes.containsKey(id)) {
        // 两个条目反解到同一 id：保留首个，后者计入跳过（原版拒绝重复路径）
        parseSkipped++;
        Diag.warn(
          'BACKUP',
          'duplicate attachment id $id from ${entry.key}, skipped',
        );
        continue;
      }
      final bytes = Uint8List.fromList(entry.value.content as List<int>);
      attachmentBytes[id] = bytes;
      final man = manifestAttachments[id];
      var name = man is Map ? (man['name'] as String? ?? '') : '';
      if (name.isEmpty && fileName != id && fileName.startsWith('${id}_')) {
        name = fileName.substring(id.length + 1);
      }
      var mime = man is Map ? (man['type'] as String? ?? '') : '';
      if (mime.isEmpty) {
        mime =
            guessMimeFromName(name.isNotEmpty ? name : fileName) ??
            guessMimeFromBytes(bytes) ??
            'application/octet-stream';
      }
      attachmentMeta[id] = (name: name, mime: mime);
    }
    return _ParsedBackup(
      backupMap: backup as Map<String, dynamic>,
      attachmentBytes: attachmentBytes,
      manifestAttachments: manifestAttachments,
      attachmentMeta: attachmentMeta,
      skippedAttachments: parseSkipped,
    );
  }

  AttachmentsCompanion _attachmentCompanion(
    String id,
    int size,
    _ParsedBackup parsed,
    int now,
  ) {
    final meta = parsed.attachmentMeta[id];
    return AttachmentsCompanion.insert(
      id: id,
      name: Value(meta?.name ?? ''),
      mime: Value(meta?.mime ?? 'application/octet-stream'),
      size: Value(size),
      localPath: 'attachments/$id',
      createdAt: now,
    );
  }

  MemosCompanion _memoCompanion(Map memo, List doc) {
    final extra = <String, dynamic>{};
    for (final entry in memo.entries) {
      if (!_memoKnownKeys.contains(entry.key)) {
        extra[entry.key.toString()] = entry.value;
      }
    }
    return MemosCompanion.insert(
      id: memo['id'] as String,
      title: Value((memo['title'] as String?) ?? ''),
      pinned: Value(memo['pinned'] == true),
      bg: Value(memo['bg'] as String?),
      docJson: Value(jsonEncode(doc)),
      extraJson: Value(jsonEncode(extra)),
      createdAt: _msFromIso(memo['createdAt']),
      updatedAt: _msFromIso(memo['updatedAt']),
    );
  }

  Future<void> _indexFts(String memoId, String title, List doc) async {
    await db.customInsert(
      'INSERT INTO memo_fts (memo_id, title, plain_text) VALUES (?, ?, ?)',
      variables: [
        Variable.withString(memoId),
        Variable.withString(MynoteDatabase.ftsIndexText(title)),
        Variable.withString(MynoteDatabase.ftsIndexText(docPlainText(doc))),
      ],
    );
  }

  /// 旧版云端 JSON 备份（memories_backup.json）：内容即备份对象本身，无附件文件。
  Future<ImportReport> importCloudJson(
    Uint8List bytes, {
    bool merge = false,
  }) async {
    if (bytes.length > maxZipBytes) {
      throw BackupValidationError('云端备份超过 50 MiB 安全上限');
    }
    final dynamic backup;
    try {
      backup = jsonDecode(utf8.decode(bytes));
    } catch (_) {
      throw BackupValidationError('云端备份解析失败');
    }
    validateBackupData(backup);
    final parsed = _ParsedBackup(
      backupMap: backup as Map<String, dynamic>,
      attachmentBytes: const {},
      manifestAttachments: const {},
      attachmentMeta: const {},
    );
    return merge ? _mergeParsed(parsed) : _replaceParsed(parsed);
  }

  Future<ImportReport> importZip(
    Uint8List zipBytes, {
    void Function(int done, int total)? onProgress,
  }) async {
    Diag.log('BACKUP', 'import start bytes=${zipBytes.length}');
    return _replaceParsed(await _parseZip(zipBytes), onProgress: onProgress);
  }

  Future<ImportReport> _replaceParsed(
    _ParsedBackup parsed, {
    void Function(int done, int total)? onProgress,
  }) async {
    final backupMap = parsed.backupMap;

    // ---- staging 原子恢复（原版两阶段语义）：附件/头像先写 stg_ 临时键，
    // 任一写入失败即整单取消；DB 单事务切换成功后才把临时键转正。
    // 失败时正式数据（DB + 旧附件字节）原样不动。
    final now = DateTime.now().millisecondsSinceEpoch;
    final stagedKeys = <String>[];
    final attachmentCompanions = <AttachmentsCompanion>[];
    final avatarCompanions = <AvatarsCompanion>[];
    var stageFailed = 0;
    try {
      var stageDone = 0;
      for (final entry in parsed.attachmentBytes.entries) {
        stageDone++;
        onProgress?.call(stageDone, parsed.attachmentBytes.length);
        try {
          await store.write('stg_${entry.key}', entry.value);
          stagedKeys.add('stg_${entry.key}');
          attachmentCompanions.add(
            _attachmentCompanion(entry.key, entry.value.length, parsed, now),
          );
        } catch (e) {
          stageFailed++;
          Diag.error('BACKUP', 'stage attachment ${entry.key} failed: $e');
        }
      }
      final avatars = backupMap['avatars'];
      if (avatars is Map) {
        for (final entry in avatars.entries) {
          try {
            final dataUrl = entry.value as String;
            final comma = dataUrl.indexOf(',');
            final mime = dataUrl.substring(5, dataUrl.indexOf(';'));
            final bytes = base64Decode(dataUrl.substring(comma + 1));
            await store.write('stg_avatar_${entry.key}', bytes);
            stagedKeys.add('stg_avatar_${entry.key}');
            avatarCompanions.add(
              AvatarsCompanion.insert(
                id: entry.key as String,
                localPath: 'avatars/${entry.key}',
                mime: Value(mime),
              ),
            );
          } catch (e) {
            stageFailed++;
            Diag.error('BACKUP', 'stage avatar ${entry.key} failed: $e');
          }
        }
      }
    } catch (_) {
      stageFailed++;
    }
    if (stageFailed > 0) {
      for (final key in stagedKeys) {
        await store.delete(key);
      }
      throw BackupValidationError('$stageFailed 个附件写入失败，已取消恢复（原数据未动）');
    }

    // ---- 单事务整库替换 ----
    // L12：切换前先快照旧库四表——转正阶段失败时整库回滚到恢复前
    // 状态，不再留下「DB 已换新、附件缺一半」的半成品状态。
    final oldMemoRows = await db.select(db.memos).get();
    final oldAttachmentRows = await db.select(db.attachments).get();
    final oldAvatarRows = await db.select(db.avatars).get();
    final oldDraftRows = await db.select(db.drafts).get();
    final oldAttachmentIds = oldAttachmentRows.map((r) => r.id).toSet();
    final memos = backupMap['memos'] as List;
    try {
      await db.transaction(() async {
        await db.delete(db.memos).go();
        await db.delete(db.attachments).go();
        await db.delete(db.avatars).go();
        await db.delete(db.drafts).go();
        await db.customStatement('DELETE FROM memo_fts');

        for (final rawMemo in memos) {
          final memo = rawMemo as Map;
          final doc = (memo['doc'] as List?) ?? const [];
          await db.into(db.memos).insert(_memoCompanion(memo, doc));
          await _indexFts(
            memo['id'] as String,
            (memo['title'] as String?) ?? '',
            doc,
          );
        }
        for (final companion in attachmentCompanions) {
          await db.into(db.attachments).insert(companion);
        }
        for (final companion in avatarCompanions) {
          await db.into(db.avatars).insert(companion);
        }
      });
    } catch (e) {
      for (final key in stagedKeys) {
        await store.delete(key);
      }
      Diag.error(
        'BACKUP',
        'import transaction failed, staged files cleaned: $e',
      );
      rethrow;
    }

    // ---- 事务成功：临时键转正（读临时 → 写正式 → 删临时） ----
    // L12：逐个捕获失败（读回 null 也算失败，不再静默跳过）；
    // 任一失败 → 回滚 DB 到快照 + 删除已转正的新文件（旧文件在
    // 回滚完成前不动），最终以「已回滚」如实报错。
    final newAttachmentIds = <String>{};
    final promotedKeys = <String>[];
    final promoteFailures = <String>[];
    // 同 id 旧文件字节快照：转正会覆盖同 id 旧文件，回滚须连字节
    // 一起还原（DB 快照只含元数据）；规模与已在内存的 staging 同级
    final oldFileBytes = <String, Uint8List>{};
    for (final key in parsed.attachmentBytes.keys) {
      if (oldAttachmentIds.contains(key)) {
        final b = await store.read(key);
        if (b != null) oldFileBytes[key] = b;
      }
    }
    final avatarsPre = backupMap['avatars'];
    if (avatarsPre is Map) {
      for (final entry in avatarsPre.entries) {
        final b = await store.read('avatar_${entry.key}');
        if (b != null) oldFileBytes['avatar_${entry.key}'] = b;
      }
    }
    Future<void> promote(String stgKey, String finalKey, String label) async {
      try {
        final bytes = await store.read(stgKey);
        if (bytes == null) throw StateError('staged readback null');
        await store.write(finalKey, bytes);
        promotedKeys.add(finalKey);
        if (label == 'att') newAttachmentIds.add(finalKey);
      } catch (e) {
        promoteFailures.add(label == 'att' ? finalKey : label);
        Diag.error('BACKUP', 'promote $stgKey failed: $e');
      } finally {
        try {
          await store.delete(stgKey);
        } catch (_) {}
      }
    }

    for (final entry in parsed.attachmentBytes.entries) {
      await promote('stg_${entry.key}', entry.key, 'att');
    }
    final avatars = backupMap['avatars'];
    if (avatars is Map) {
      for (final entry in avatars.entries) {
        await promote(
          'stg_avatar_${entry.key}',
          'avatar_${entry.key}',
          'avatar:${entry.key}',
        );
      }
    }

    if (promoteFailures.isNotEmpty) {
      // 回滚：DB 整库还原快照（含 FTS 重建），已转正的新文件删除
      // （旧附件文件自始未动，孤儿清理尚未执行，文件侧天然完整）
      try {
        await db.transaction(() async {
          await db.delete(db.memos).go();
          await db.delete(db.attachments).go();
          await db.delete(db.avatars).go();
          await db.delete(db.drafts).go();
          await db.customStatement('DELETE FROM memo_fts');
          for (final row in oldMemoRows) {
            await db.into(db.memos).insert(row.toCompanion(true));
            final doc = (jsonDecode(row.docJson) as List?) ?? const [];
            await _indexFts(row.id, row.title, doc);
          }
          for (final row in oldAttachmentRows) {
            await db.into(db.attachments).insert(row.toCompanion(true));
          }
          for (final row in oldAvatarRows) {
            await db.into(db.avatars).insert(row.toCompanion(true));
          }
          for (final row in oldDraftRows) {
            await db.into(db.drafts).insert(row.toCompanion(true));
          }
        });
      } catch (e) {
        Diag.error('BACKUP', 'promote rollback failed: $e');
        throw BackupValidationError(
          '${promoteFailures.length} 个附件写入失败且自动回滚失败，请勿继续编辑并重新恢复一次',
        );
      }
      for (final key in promotedKeys) {
        try {
          final oldBytes = oldFileBytes[key];
          if (oldBytes != null) {
            await store.write(key, oldBytes);
          } else if (!oldAttachmentIds.contains(key)) {
            await store.delete(key);
          }
        } catch (_) {}
      }
      Diag.error(
        'BACKUP',
        'promote failed $promoteFailures, rolled back to snapshot',
      );
      throw BackupValidationError(
        '${promoteFailures.length} 个附件写入失败，恢复已取消并回滚（原数据未动）',
      );
    }

    // ---- 清理孤儿附件文件（旧库有、新库没有） ----
    for (final oldId in oldAttachmentIds.difference(newAttachmentIds)) {
      await store.delete(oldId);
    }

    return ImportReport(
      memos: memos.length,
      attachments: attachmentCompanions.length,
      avatars: avatarCompanions.length,
      skippedAttachments: parsed.skippedAttachments,
    );
  }

  /// 合并导入（原版 commitMergedData 语义）：云端同 id 笔记覆盖本地，
  /// 本地独有笔记保留；附件仅补本地缺失的、头像云端无条件覆盖；attachment
  /// 块的 image 标记在云端缺失时保留本地同位节点的标记。
  Future<ImportReport> importZipMerge(
    Uint8List zipBytes, {
    void Function(int done, int total)? onProgress,
  }) async {
    Diag.log('BACKUP', 'merge import start bytes=${zipBytes.length}');
    return _mergeParsed(await _parseZip(zipBytes), onProgress: onProgress);
  }

  Future<ImportReport> _mergeParsed(
    _ParsedBackup parsed, {
    void Function(int done, int total)? onProgress,
  }) async {
    final backupMap = parsed.backupMap;
    final now = DateTime.now().millisecondsSinceEpoch;

    final existingAttIds = (await db.select(db.attachments).get())
        .map((r) => r.id)
        .toSet();
    final attachmentCompanions = <AttachmentsCompanion>[];
    final writtenKeys = <String>[];
    var skipped = parsed.skippedAttachments;
    var mergeDone = 0;
    for (final entry in parsed.attachmentBytes.entries) {
      mergeDone++;
      onProgress?.call(mergeDone, parsed.attachmentBytes.length);
      if (existingAttIds.contains(entry.key)) continue;
      try {
        await store.write(entry.key, entry.value);
        writtenKeys.add(entry.key);
        attachmentCompanions.add(
          _attachmentCompanion(entry.key, entry.value.length, parsed, now),
        );
      } catch (e) {
        // 单个坏附件跳过计数、不中断合并（原版口径）
        skipped++;
        Diag.error(
          'BACKUP',
          'merge attachment ${entry.key} failed, skipped: $e',
        );
      }
    }

    // 头像：云端无条件覆盖本地（Web commitMergedData 语义）
    final avatarCompanions = <AvatarsCompanion>[];
    final avatars = backupMap['avatars'];
    if (avatars is Map) {
      for (final entry in avatars.entries) {
        try {
          final dataUrl = entry.value as String;
          final comma = dataUrl.indexOf(',');
          final mime = dataUrl.substring(5, dataUrl.indexOf(';'));
          final bytes = base64Decode(dataUrl.substring(comma + 1));
          await store.write('avatar_${entry.key}', bytes);
          avatarCompanions.add(
            AvatarsCompanion.insert(
              id: entry.key as String,
              localPath: 'avatars/${entry.key}',
              mime: Value(mime),
            ),
          );
        } catch (e) {
          skipped++;
          Diag.error('BACKUP', 'merge avatar ${entry.key} failed, skipped: $e');
        }
      }
    }

    final memos = backupMap['memos'] as List;
    try {
      await db.transaction(() async {
        for (final rawMemo in memos) {
          final memo = rawMemo as Map;
          final id = memo['id'] as String;
          // 被合并覆盖的笔记必须失效本地草稿：否则下次打开会被更新的旧草稿
          // 「恢复」盖掉合并结果（替换导入删全部草稿，合并此前漏了）
          await (db.delete(db.drafts)..where((t) => t.memoId.equals(id))).go();
          var doc = (memo['doc'] as List?) ?? const [];
          final local = await (db.select(
            db.memos,
          )..where((t) => t.id.equals(id))).getSingleOrNull();
          if (local != null) {
            try {
              final localDoc = jsonDecode(local.docJson);
              if (localDoc is List) {
                final adjusted = <dynamic>[];
                for (var i = 0; i < doc.length; i++) {
                  var node = doc[i];
                  if (node is Map &&
                      node['type'] == 'attachment' &&
                      node['image'] == null &&
                      i < localDoc.length) {
                    final ln = localDoc[i];
                    if (ln is Map &&
                        ln['type'] == 'attachment' &&
                        ln['image'] != null) {
                      node = Map<String, dynamic>.from(node)
                        ..['image'] = ln['image'];
                    }
                  }
                  adjusted.add(node);
                }
                doc = adjusted;
              }
            } catch (_) {}
          }
          await db
              .into(db.memos)
              .insertOnConflictUpdate(_memoCompanion(memo, doc));
          await db.customStatement('DELETE FROM memo_fts WHERE memo_id = ?', [
            id,
          ]);
          await _indexFts(id, (memo['title'] as String?) ?? '', doc);
        }
        for (final companion in attachmentCompanions) {
          await db.into(db.attachments).insert(companion);
        }
        for (final companion in avatarCompanions) {
          await db.into(db.avatars).insertOnConflictUpdate(companion);
        }
      });
    } catch (e) {
      // 事务失败：清掉刚补写的附件文件，避免存储与 DB 不一致
      for (final key in writtenKeys) {
        await store.delete(key);
      }
      Diag.error('BACKUP', 'merge transaction failed, new files cleaned: $e');
      rethrow;
    }

    Diag.log(
      'BACKUP',
      'merge done memos=${memos.length} attachments+=${attachmentCompanions.length}',
    );
    return ImportReport(
      memos: memos.length,
      attachments: attachmentCompanions.length,
      avatars: avatarCompanions.length,
      skippedAttachments: skipped,
    );
  }
}

class _ParsedBackup {
  const _ParsedBackup({
    required this.backupMap,
    required this.attachmentBytes,
    required this.manifestAttachments,
    required this.attachmentMeta,
    this.skippedAttachments = 0,
  });

  final Map<String, dynamic> backupMap;
  final Map<String, Uint8List> attachmentBytes;
  final int skippedAttachments;
  final Map<String, dynamic> manifestAttachments;
  final Map<String, ({String name, String mime})> attachmentMeta;
}

class ImportReport {
  const ImportReport({
    required this.memos,
    required this.attachments,
    required this.avatars,
    required this.skippedAttachments,
  });

  final int memos;
  final int attachments;
  final int avatars;
  final int skippedAttachments;

  @override
  String toString() =>
      'ImportReport(memos: $memos, attachments: $attachments, avatars: $avatars, skipped: $skippedAttachments)';
}
