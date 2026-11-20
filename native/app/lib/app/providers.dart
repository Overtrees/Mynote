import 'dart:convert';
import 'dart:typed_data';
import 'dart:io';

import 'package:drift/drift.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../core/prefs_store.dart';
import '../data/backup/attachment_store.dart';
import '../data/backup/attachment_store_platform.dart';
import '../data/backup/backup_service.dart';
import '../data/convert/doc_converter.dart';
import '../data/db/connection/connection.dart';
import '../data/db/database.dart';

final databaseProvider = Provider<MynoteDatabase>((ref) {
  final db = MynoteDatabase(createConnection());
  ref.onDispose(db.close);
  return db;
});

/// 附件存储：Web 先用内存实现（附件跨刷新不持久，Phase 2 上 OPFS）；
/// 原生用文档目录下的真实文件。
final attachmentStoreProvider = FutureProvider<AttachmentStore>((ref) async {
  if (kIsWeb) return createPlatformAttachmentStore();
  final dir = await getApplicationDocumentsDirectory();
  return FileAttachmentStore(Directory('${dir.path}/attachments'));
});

final backupServiceProvider = FutureProvider<BackupService>((ref) async {
  final store = await ref.watch(attachmentStoreProvider.future);
  return BackupService(ref.watch(databaseProvider), store);
});

/// 列表数据流：置顶在前，其余按更新时间倒序。
final memosProvider = StreamProvider<List<Memo>>((ref) {
  final db = ref.watch(databaseProvider);
  final query = db.select(db.memos)
    ..orderBy([
      (t) => OrderingTerm(expression: t.pinned, mode: OrderingMode.desc),
      (t) => OrderingTerm(expression: t.updatedAt, mode: OrderingMode.desc),
    ]);
  return query.watch();
});

/// 首次启动种子：空库时写入与 Web demo-memos.js 完全一致的 5 篇演示笔记
///（内容/结构/时间锚点逐条对齐：now、−1d、−3d、−7d、−14d）。
final appInitProvider = FutureProvider<void>((ref) async {
  final db = ref.watch(databaseProvider);
  final count = await (db.select(db.memos).get()).then((rows) => rows.length);
  if (count > 0) return;
  const day = 86400000;
  final now = DateTime.now().millisecondsSinceEpoch;
  final demos = <(String, String, bool, int, List<dynamic>)>[
    (
      'demo_exhibit',
      '周末看展记录',
      false,
      0,
      [
        {
          'id': 'd1p1',
          'type': 'paragraph',
          'children': [
            {'text': '今天去了 UCCA 的「非物质再现」展。光线透过亚克力板投射在墙上的影子会随着人的移动变化，站久了会忘记时间。'},
          ],
        },
        {
          'id': 'd1p2',
          'type': 'paragraph',
          'children': [
            {'text': '想起上周看的书里那句话：==所谓的边界，只是我们还没习惯的过渡带=='},
          ],
        },
        {
          'id': 'd1h',
          'type': 'heading',
          'attrs': {'level': 2},
          'children': [
            {'text': '实用信息'},
          ],
        },
        {
          'id': 'd1p3',
          'type': 'paragraph',
          'children': [
            {'text': '地址：798 艺术区 UCCA。票价 100 元。'},
          ],
        },
      ],
    ),
    (
      'demo_home',
      '装修踩坑清单',
      true,
      1,
      [
        {
          'id': 'd2t1',
          'type': 'todo',
          'attrs': {'checked': true},
          'children': [
            {'text': '厨房插座至少留 6 个，台面要带开关'},
          ],
        },
        {
          'id': 'd2t2',
          'type': 'todo',
          'attrs': {'checked': true},
          'children': [
            {'text': '卫生间防水刷到 1.8m，闭水试验做满 48h'},
          ],
        },
        {
          'id': 'd2t3',
          'type': 'todo',
          'attrs': {'checked': false},
          'children': [
            {'text': '地板和瓷砖之间用极窄收边条，不要过门石'},
          ],
        },
        {
          'id': 'd2t4',
          'type': 'todo',
          'attrs': {'checked': false},
          'children': [
            {'text': '衣柜做到顶，不要成品柜，顶部积灰严重'},
          ],
        },
      ],
    ),
    (
      'demo_tools',
      '好用的工具网站',
      false,
      3,
      [
        {
          'id': 'd3p1',
          'type': 'paragraph',
          'children': [
            {'text': '几个日常高频用到的小工具，免费无广告。'},
          ],
        },
        {
          'id': 'd3p2',
          'type': 'paragraph',
          'children': [
            {'text': 'Excalidraw — 画架构图和流程图最顺手的白板。'},
          ],
        },
        {
          'id': 'd3p3',
          'type': 'paragraph',
          'children': [
            {'text': 'Carbon — 把代码生成漂亮的分享图，支持 20+ 主题。'},
          ],
        },
      ],
    ),
    (
      'demo_book',
      '读书笔记｜设计的觉醒',
      false,
      7,
      [
        {
          'id': 'd4p1',
          'type': 'paragraph',
          'children': [
            {'text': '田中一光的随笔集，断断续续读了一个月。'},
          ],
        },
        {
          'id': 'd4p2',
          'type': 'paragraph',
          'children': [
            {'text': '「设计不是一种技能，而是捕捉事物本质的感觉和洞察力。」'},
          ],
        },
        {
          'id': 'd4p3',
          'type': 'paragraph',
          'children': [
            {'text': '「整理、排布、思考——设计的本质就是这三件事的循环。」'},
          ],
        },
      ],
    ),
    (
      'demo_music',
      '最近在听的歌',
      false,
      14,
      [
        {
          'id': 'd5h',
          'type': 'heading',
          'attrs': {'level': 2},
          'children': [
            {'text': '上周循环最多的几首'},
          ],
        },
        {
          'id': 'd5p1',
          'type': 'paragraph',
          'children': [
            {
              'text':
                  'She Her Her Hers — Arrows — 吉他前奏一响整个人都松下来了。适合下雨天窝在沙发上单曲循环。',
            },
          ],
        },
        {
          'id': 'd5m1',
          'type': 'musicCard',
          'url': 'https://c6.y.qq.com/base/fcgi-bin/u?__=1RE7gOYaMZgO',
          'meta': null,
          'status': 'loading',
        },
        {
          'id': 'd5p2',
          'type': 'paragraph',
          'children': [
            {
              'text': '陶喆 — 月亮代表谁的心 — 晚上十一点半的地铁上听到这首歌，老歌新唱居然听出了不一样的味道。原来有些旋律不管过多少年都不会过期。',
            },
          ],
        },
        {
          'id': 'd5m2',
          'type': 'musicCard',
          'url': 'https://music.apple.com/cn/album/%E6%9C%88%E4%BA%AE%E4%BB%A3%E8%A1%A8%E8%B0%81%E7%9A%84%E5%BF%83/914664926?i=914664941',
          'meta': null,
          'status': 'loading',
        },
        {
          'id': 'd5p3',
          'type': 'paragraph',
          'children': [
            {
              'text': '黑裙子 — Our Own Summer — 前奏的鼓点一出来就感觉回到了某个无所事事的夏天傍晚，风吹在脸上是热的，但心里是凉的。',
            },
          ],
        },
        {
          'id': 'd5m3',
          'type': 'musicCard',
          'url': 'https://163cn.tv/7ceoWN8',
          'meta': null,
          'status': 'loading',
        },
        {
          'id': 'd5p4',
          'type': 'paragraph',
          'children': [
            {'text': '落日飞车 — My Jinji — 适合晚上开车听，吉他音色软软的，像夏天的风从车窗缝里吹进来。'},
          ],
        },
        {
          'id': 'd5m4',
          'type': 'musicCard',
          'url': 'https://open.spotify.com/track/7npPPrZEDmeHMk6mxvIeFa?si=zp0-QuSsTBWvhaGVKVUfjg',
          'meta': null,
          'status': 'loading',
        },
      ],
    ),
  ];
  for (final (id, title, pinned, daysAgo, doc) in demos) {
    final ts = now - daysAgo * day;
    await db.upsertMemoWithFts(
      MemosCompanion.insert(
        id: id,
        title: Value(title),
        pinned: Value(pinned),
        docJson: Value(jsonEncode(doc)),
        createdAt: ts,
        updatedAt: ts,
      ),
      docPlainText(doc),
    );
  }
});

/// 文字大小（对照 Web 的 sj_fontsize：small/medium/large → 根字号 14/16/19）。
final fontSizeProvider = StateProvider<String>((ref) {
  return prefsGet('sj_fontsize') ?? 'medium';
});

double fontScaleOf(String size) => switch (size) {
  'small' => 14 / 16,
  'large' => 19 / 16,
  _ => 1.0,
};

/// 附件字节（按 fileId，供编辑器媒体组件渲染）。
/// P13：autoDispose——附件原始字节不再按 id 永久驻留（此前与解码
/// 图片缓存双份持有，大图笔记易触 WKWebView 内存上限被重载）；
/// 离屏组件释放后字节随之回收，需要时从 OPFS 重读。
final attachmentBytesProvider = FutureProvider.autoDispose
    .family<Uint8List?, String>((ref, fileId) async {
      final store = await ref.watch(attachmentStoreProvider.future);
      return store.read(fileId);
    });

/// 附件元数据行（文件名/大小，供附件块渲染）。
final attachmentMetaProvider = FutureProvider.family<Attachment?, String>((
  ref,
  fileId,
) async {
  final db = ref.watch(databaseProvider);
  return (db.select(
    db.attachments,
  )..where((t) => t.id.equals(fileId))).getSingleOrNull();
});
