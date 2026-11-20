import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/backup/attachment_store.dart';
import 'package:mynote_app/data/backup/backup_service.dart';
import 'package:mynote_app/data/backup/backup_validate.dart';
import 'package:mynote_app/data/db/database.dart';

String canonical(dynamic value) {
  dynamic normalize(dynamic v) {
    if (v is Map) {
      final keys = v.keys.map((k) => k.toString()).toList()..sort();
      return {for (final k in keys) k: normalize(v[k])};
    }
    if (v is List) return v.map(normalize).toList();
    return v;
  }

  return jsonEncode(normalize(value));
}

/// 构造一份与 Web 导出完全同构的备份 ZIP。
Uint8List buildWebStyleZip() {
  final backup = {
    'version': 2,
    'exportedAt': '2026-11-18T08:00:00.000Z',
    'memos': [
      {
        'id': 'memo_a',
        'title': '周末看展记录',
        'pinned': true,
        'createdAt': '2026-11-15T10:00:00.000Z',
        'updatedAt': '2026-11-16T11:30:00.000Z',
        'doc': [
          {
            'id': 'b1',
            'type': 'paragraph',
            'children': [
              {'text': '光线透过亚克力板投射在墙上'},
            ],
          },
          {
            'id': 'b2',
            'type': 'musicCard',
            'url': 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
            'status': 'ready',
            'meta': {
              'title': 'Never Gonna Give You Up',
              'subtitle': 'Rick Astley',
              'source': 'Spotify',
            },
          },
          {
            'id': 'b3',
            'type': 'image',
            'attrs': {'fileId': 'f_img1', 'src': '', 'alt': '展厅'},
          },
        ],
        'layout': {
          'version': 1,
          'mode': 'flow',
          'left': ['b1', 'b2'],
          'right': ['b3'],
        },
      },
      {
        'id': 'memo_b',
        'title': '装修清单',
        'pinned': false,
        'bg': 'sunset',
        'createdAt': '2026-11-17T09:00:00.000Z',
        'updatedAt': '2026-11-17T09:05:00.000Z',
        'doc': [
          {
            'id': 't1',
            'type': 'todo',
            'attrs': {'checked': false},
            'children': [
              {'text': '量厨房尺寸'},
            ],
          },
        ],
      },
    ],
    'avatars': {
      'av1': 'data:image/png;base64,${base64Encode([137, 80, 78, 71])}',
    },
  };
  final manifest = {
    'version': 1,
    'attachments': {
      'f_img1': {'name': '展厅照片.jpg', 'type': 'image/jpeg'},
    },
  };
  final archive = Archive()
    ..addFile(ArchiveFile.string('memos.json', jsonEncode(backup)))
    ..addFile(ArchiveFile.string('manifest.json', jsonEncode(manifest)))
    ..addFile(ArchiveFile.bytes('attachments/f_img1', [1, 2, 3, 4, 5]));
  return Uint8List.fromList(ZipEncoder().encode(archive));
}

void main() {
  test('Web 格式 ZIP 导入 → DB/FTS/附件/头像齐全 → 再导出与原备份等价', () async {
    final db = MynoteDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final store = MemoryAttachmentStore();
    final service = BackupService(db, store);

    final report = await service.importZip(buildWebStyleZip());
    expect(report.memos, 2);
    expect(report.attachments, 1);
    expect(report.avatars, 1);

    final memos = await db.select(db.memos).get();
    expect(memos.length, 2);
    final a = memos.firstWhere((m) => m.id == 'memo_a');
    expect(a.pinned, isTrue);
    expect(a.title, '周末看展记录');
    // layout 进了 extraJson 透传
    expect((jsonDecode(a.extraJson) as Map)['layout']['mode'], 'flow');
    final b = memos.firstWhere((m) => m.id == 'memo_b');
    expect(b.bg, 'sunset');

    // FTS：正文词与卡片标题都能搜
    expect(await db.searchMemoIds('亚克力'), ['memo_a']);
    expect(await db.searchMemoIds('Never'), ['memo_a']);
    expect(await db.searchMemoIds('厨房'), ['memo_b']);

    // 附件字节与 manifest 元数据
    expect(await store.read('f_img1'), [1, 2, 3, 4, 5]);
    final atts = await db.select(db.attachments).get();
    expect(atts.single.name, '展厅照片.jpg');
    expect(atts.single.mime, 'image/jpeg');
    expect(atts.single.size, 5);

    // 导出 → 解开 → memos/manifest 与原始等价（exportedAt 除外）
    final exported = await service.exportZip();
    final archive = ZipDecoder().decodeBytes(exported);
    final byName = {for (final f in archive.files) f.name: f};
    final exportedBackup = jsonDecode(
      utf8.decode(byName['memos.json']!.content as List<int>),
    ) as Map<String, dynamic>;
    exportedBackup.remove('exportedAt');
    final originalBackup = jsonDecode(
      utf8.decode(
        ZipDecoder()
                .decodeBytes(buildWebStyleZip())
                .files
                .firstWhere((f) => f.name == 'memos.json')
                .content
            as List<int>,
      ),
    ) as Map<String, dynamic>;
    originalBackup.remove('exportedAt');
    expect(canonical(exportedBackup), canonical(originalBackup));

    final exportedManifest = jsonDecode(
      utf8.decode(byName['manifest.json']!.content as List<int>),
    );
    expect(
      canonical(exportedManifest),
      canonical({
        'version': 1,
        'attachments': {
          'f_img1': {'name': '展厅照片.jpg', 'type': 'image/jpeg'},
        },
      }),
    );
    expect(byName['attachments/f_img1']!.content as List<int>, [1, 2, 3, 4, 5]);
  });

  test('导入是整库替换：旧数据与孤儿附件被清', () async {
    final db = MynoteDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final store = MemoryAttachmentStore();
    final service = BackupService(db, store);

    await service.importZip(buildWebStyleZip());
    final empty = Archive()
      ..addFile(
        ArchiveFile.string(
          'memos.json',
          jsonEncode({'version': 2, 'memos': [], 'avatars': {}}),
        ),
      );
    await service.importZip(Uint8List.fromList(ZipEncoder().encode(empty)));

    expect((await db.select(db.memos).get()), isEmpty);
    expect((await db.select(db.attachments).get()), isEmpty);
    expect(await store.read('f_img1'), isNull);
    expect(await db.searchMemoIds('亚克力'), isEmpty);
  });

  test('非法备份被拒', () async {
    final db = MynoteDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final service = BackupService(db, MemoryAttachmentStore());

    Uint8List zipOf(dynamic memosJson) {
      final archive = Archive()
        ..addFile(ArchiveFile.string('memos.json', jsonEncode(memosJson)));
      return Uint8List.fromList(ZipEncoder().encode(archive));
    }

    // 缺 memos.json
    final noMemos = Archive()..addFile(ArchiveFile.string('x.txt', 'hi'));
    await expectLater(
      service.importZip(Uint8List.fromList(ZipEncoder().encode(noMemos))),
      throwsA(isA<BackupValidationError>()),
    );
    // 重复 memo id
    await expectLater(
      service.importZip(
        zipOf({
          'memos': [
            {'id': 'x'},
            {'id': 'x'},
          ],
        }),
      ),
      throwsA(isA<BackupValidationError>()),
    );
    // 非法标题级别
    await expectLater(
      service.importZip(
        zipOf({
          'memos': [
            {
              'id': 'ok1',
              'doc': [
                {
                  'id': 'h',
                  'type': 'heading',
                  'attrs': {'level': 9},
                },
              ],
            },
          ],
        }),
      ),
      throwsA(isA<BackupValidationError>()),
    );
    // layout 引用不存在的块
    await expectLater(
      service.importZip(
        zipOf({
          'memos': [
            {
              'id': 'ok2',
              'doc': [
                {
                  'id': 'p',
                  'type': 'paragraph',
                  'children': [
                    {'text': 'x'},
                  ],
                },
              ],
              'layout': {
                'version': 1,
                'mode': 'flow',
                'left': ['p', 'ghost'],
                'right': [],
              },
            },
          ],
        }),
      ),
      throwsA(isA<BackupValidationError>()),
    );
    // 路径穿越条目
    final evil = Archive()..addFile(ArchiveFile.string('../evil.txt', 'x'));
    await expectLater(
      service.importZip(Uint8List.fromList(ZipEncoder().encode(evil))),
      throwsA(isA<BackupValidationError>()),
    );
  });

  test('L12 转正失败：整库回滚到恢复前状态、旧文件字节还原、无 stg 残留', () async {
    final db = MynoteDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final inner = MemoryAttachmentStore();
    final store = _FailFinalWriteStore(inner);
    final service = BackupService(db, store);

    await service.importZip(buildWebStyleZip());
    expect(await inner.read('f_img1'), [1, 2, 3, 4, 5]);

    // 第二份备份：新笔记 + 同 id 附件改了字节；转正写正式键时注入失败
    final backup2 = {
      'version': 2,
      'exportedAt': '2026-11-19T08:00:00.000Z',
      'memos': [
        {
          'id': 'memo_c',
          'title': '新备份',
          'pinned': false,
          'createdAt': '2026-11-19T08:00:00.000Z',
          'updatedAt': '2026-11-19T08:00:00.000Z',
          'doc': [
            {
              'id': 'b3',
              'type': 'image',
              'attrs': {'fileId': 'f_img1'},
            },
          ],
        },
      ],
      'avatars': <String, String>{},
    };
    final manifest2 = {
      'version': 1,
      'attachments': {
        'f_img1': {'name': '新图.jpg', 'type': 'image/jpeg'},
      },
    };
    final archive2 = Archive()
      ..addFile(ArchiveFile.string('memos.json', jsonEncode(backup2)))
      ..addFile(ArchiveFile.string('manifest.json', jsonEncode(manifest2)))
      ..addFile(ArchiveFile.bytes('attachments/f_img1', [9, 9, 9]));
    store.failFinalKeys = {'f_img1'};
    await expectLater(
      service.importZip(Uint8List.fromList(ZipEncoder().encode(archive2))),
      throwsA(
        isA<BackupValidationError>().having(
          (e) => e.message,
          'message',
          contains('回滚'),
        ),
      ),
    );
    // DB 回到第一份备份；同 id 旧文件字节被还原；临时键无残留
    final memos = await db.select(db.memos).get();
    expect(memos.map((m) => m.id).toSet(), {'memo_a', 'memo_b'});
    expect(await inner.read('f_img1'), [1, 2, 3, 4, 5]);
    expect(inner.files.keys.any((k) => k.startsWith('stg_')), isFalse);
  });

  test('合并导入：云端同 id 覆盖、本地独有保留、附件仅补缺', () async {
    final db = MynoteDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final store = MemoryAttachmentStore();
    final service = BackupService(db, store);

    // 本地先有一份数据：memo_a（旧标题）+ memo_local（本地独有）+ 附件 f_img1
    await service.importZip(buildWebStyleZip());
    final localOnly = {
      'version': 2,
      'exportedAt': '2026-11-18T09:00:00.000Z',
      'memos': [
        {
          'id': 'memo_local',
          'title': '本地独有',
          'pinned': false,
          'createdAt': '2026-11-18T09:00:00.000Z',
          'updatedAt': '2026-11-18T09:00:00.000Z',
          'doc': [
            {
              'id': 'p1',
              'type': 'paragraph',
              'children': [
                {'text': '只在本地的内容'},
              ],
            },
          ],
        },
      ],
      'avatars': <String, String>{},
    };
    final localArchive = Archive()
      ..addFile(ArchiveFile.string('memos.json', jsonEncode(localOnly)));
    // 用合并把本地独有笔记并入（模拟本地既有状态的构成）
    await service.importZipMerge(
      Uint8List.fromList(ZipEncoder().encode(localArchive)),
    );
    var memos = await db.select(db.memos).get();
    expect(memos.map((m) => m.id).toSet(), {'memo_a', 'memo_b', 'memo_local'});

    // 云端新备份：memo_a 改了标题、新增 memo_c 与附件 f_new；f_img1 字节不同
    final cloud = {
      'version': 2,
      'exportedAt': '2026-11-18T10:00:00.000Z',
      'memos': [
        {
          'id': 'memo_a',
          'title': '云端新标题',
          'pinned': true,
          'createdAt': '2026-11-15T10:00:00.000Z',
          'updatedAt': '2026-11-18T10:00:00.000Z',
          'doc': [
            {
              'id': 'b1',
              'type': 'paragraph',
              'children': [
                {'text': '云端正文'},
              ],
            },
          ],
        },
        {
          'id': 'memo_c',
          'title': '云端新增',
          'pinned': false,
          'createdAt': '2026-11-18T10:00:00.000Z',
          'updatedAt': '2026-11-18T10:00:00.000Z',
          'doc': [
            {
              'id': 'p9',
              'type': 'paragraph',
              'children': [
                {'text': '新增内容'},
              ],
            },
          ],
        },
      ],
      'avatars': <String, String>{},
    };
    final cloudManifest = {
      'version': 1,
      'attachments': {
        'f_img1': {'name': '展厅照片.jpg', 'type': 'image/jpeg'},
        'f_new': {'name': '新图.png', 'type': 'image/png'},
      },
    };
    final cloudArchive = Archive()
      ..addFile(ArchiveFile.string('memos.json', jsonEncode(cloud)))
      ..addFile(ArchiveFile.string('manifest.json', jsonEncode(cloudManifest)))
      ..addFile(ArchiveFile.bytes('attachments/f_img1', [9, 9, 9]))
      ..addFile(ArchiveFile.bytes('attachments/f_new', [7, 7]));
    final report = await service.importZipMerge(
      Uint8List.fromList(ZipEncoder().encode(cloudArchive)),
    );
    expect(report.memos, 2);
    expect(report.attachments, 1); // 只有 f_new 是新增

    memos = await db.select(db.memos).get();
    expect(memos.map((m) => m.id).toSet(), {
      'memo_a',
      'memo_b',
      'memo_local',
      'memo_c',
    });
    expect(memos.firstWhere((m) => m.id == 'memo_a').title, '云端新标题');
    // 已有附件字节不被覆盖
    expect(await store.read('f_img1'), [1, 2, 3, 4, 5]);
    expect(await store.read('f_new'), [7, 7]);
    // FTS 同步：新标题可搜、本地独有仍可搜
    expect(await db.searchMemoIds('云端新标题'), ['memo_a']);
    expect(await db.searchMemoIds('只在本地'), ['memo_local']);
  });

  test('旧备份 attachments/<id>_<name> 文件名反解 + MIME 推断', () async {
    final db = MynoteDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final store = MemoryAttachmentStore();
    final service = BackupService(db, store);
    final backup = {
      'version': 2,
      'memos': [
        {
          'id': 'old1',
          'title': '旧备份',
          'createdAt': '2025-01-01T00:00:00.000Z',
          'updatedAt': '2025-01-01T00:00:00.000Z',
          'doc': [
            {
              'id': 'a1',
              'type': 'attachment',
              'fileId': 'att_old',
              'image': true,
            },
          ],
        },
      ],
      'avatars': <String, String>{},
    };
    // 无 manifest，文件名带 _<name> 后缀，字节为 PNG 魔数
    final archive = Archive()
      ..addFile(ArchiveFile.string('memos.json', jsonEncode(backup)))
      ..addFile(
        ArchiveFile.bytes('attachments/att_old_照片.png', [
          0x89,
          0x50,
          0x4E,
          0x47,
          1,
          2,
        ]),
      );
    final report = await service.importZip(
      Uint8List.fromList(ZipEncoder().encode(archive)),
    );
    expect(report.attachments, 1);
    expect(await store.read('att_old'), [0x89, 0x50, 0x4E, 0x47, 1, 2]);
    final atts = await db.select(db.attachments).get();
    expect(atts.single.id, 'att_old');
    expect(atts.single.name, '照片.png');
    expect(atts.single.mime, 'image/png');
  });

  test('校验：不安全链接与超版本被拒；深层嵌套（>8）合法', () async {
    final db = MynoteDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final service = BackupService(db, MemoryAttachmentStore());
    Uint8List zipOf(Map<String, dynamic> b) {
      final a = Archive()
        ..addFile(ArchiveFile.string('memos.json', jsonEncode(b)));
      return Uint8List.fromList(ZipEncoder().encode(a));
    }

    await expectLater(
      service.importZip(zipOf({'version': 3, 'memos': <dynamic>[]})),
      throwsA(isA<BackupValidationError>()),
    );
    await expectLater(
      service.importZip(
        zipOf({
          'version': 2,
          'memos': [
            {
              'id': 'x1',
              'doc': [
                {
                  'id': 'c',
                  'type': 'link-card',
                  'url': 'javascript:alert(1)',
                  'status': 'ready',
                },
              ],
            },
          ],
        }),
      ),
      throwsA(isA<BackupValidationError>()),
    );
    // 8 层嵌套应通过、9 层被拒（原版 walk maxDepth=40 JSON 层，2026-11-19 实测原版校验器边界）
    Map<String, dynamic> nest(int n) => n == 0
        ? {
            'id': 'leaf',
            'type': 'paragraph',
            'children': [
              {'text': '深'},
            ],
          }
        : {
            'id': 'n$n',
            'type': 'paragraph',
            'children': [
              {
                'text': '',
                'children': [nest(n - 1)],
              },
            ],
          };
    final ok = await service.importZip(
      zipOf({
        'version': 2,
        'memos': [
          {
            'id': 'deep1',
            'doc': [nest(8)],
          },
        ],
      }),
    );
    expect(ok.memos, 1);
  });
}

/// L12 测试用存储：正式键写入可注入失败（stg_ 临时键放行）。
class _FailFinalWriteStore implements AttachmentStore {
  _FailFinalWriteStore(this.inner);
  final MemoryAttachmentStore inner;
  Set<String> failFinalKeys = {};

  @override
  Future<void> write(String id, Uint8List bytes) async {
    if (failFinalKeys.contains(id)) throw StateError('injected write failure');
    await inner.write(id, bytes);
  }

  @override
  Future<Uint8List?> read(String id) => inner.read(id);

  @override
  Future<void> delete(String id) => inner.delete(id);

  @override
  Future<void> clear() => inner.clear();
}
