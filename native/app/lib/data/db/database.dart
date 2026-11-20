import 'package:drift/drift.dart';

import '../../core/diag.dart';

part 'database.g.dart';

/// memos：映射 Web IndexedDB v8 的 memos store。
/// doc_json 存 Web 现有块 JSON 原样整存（见 data/convert）。
class Memos extends Table {
  TextColumn get id => text()();
  TextColumn get title => text().withDefault(const Constant(''))();
  BoolColumn get pinned => boolean().withDefault(const Constant(false))();

  /// 背景色标记（Web 的 memo.bg）
  TextColumn get bg => text().nullable()();
  TextColumn get docJson => text().withDefault(const Constant('[]'))();

  /// 未映射的 memo 顶层字段（如 layout 双栏布局）原样 JSON 保存，导出时合并回去
  TextColumn get extraJson => text().withDefault(const Constant('{}'))();

  /// epoch 毫秒；与备份 JSON 的 ISO 字符串在 backup 层互转
  IntColumn get createdAt => integer()();
  IntColumn get updatedAt => integer()();

  @override
  Set<Column> get primaryKey => {id};
}

/// attachments：文件本体存应用文档目录 attachments/，DB 只存元数据。
class Attachments extends Table {
  TextColumn get id => text()();
  TextColumn get memoId => text().nullable()();
  TextColumn get name => text().withDefault(const Constant(''))();
  TextColumn get mime =>
      text().withDefault(const Constant('application/octet-stream'))();
  IntColumn get size => integer().withDefault(const Constant(0))();
  IntColumn get width => integer().nullable()();
  IntColumn get height => integer().nullable()();
  TextColumn get localPath => text()();
  IntColumn get createdAt => integer()();

  @override
  Set<Column> get primaryKey => {id};
}

class Avatars extends Table {
  TextColumn get id => text()();
  TextColumn get localPath => text()();

  /// dataUrl 的 MIME（导出时拼回 data:<mime>;base64,...）
  TextColumn get mime => text().withDefault(const Constant('image/png'))();

  @override
  Set<Column> get primaryKey => {id};
}

/// drafts：基线 diff 保存的草稿（对应 Web drafts store）。
class Drafts extends Table {
  TextColumn get id => text()();
  TextColumn get memoId => text()();
  TextColumn get docJson => text()();
  IntColumn get updatedAt => integer()();
  // v2：草稿同时保存标题与双栏 layout（原版 DraftStore 载荷含 doc+layout+title），
  // 崩溃恢复时一并还原；旧行这两列为空。
  TextColumn get title => text().nullable()();
  TextColumn get layoutJson => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

@DriftDatabase(tables: [Memos, Attachments, Avatars, Drafts])
class MynoteDatabase extends _$MynoteDatabase {
  MynoteDatabase(super.executor);

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    beforeOpen: (details) async {
      // D8：DB 打开/迁移留痕（此前打开失败在日志里完全无迹）
      Diag.log(
        'DB',
        'open schema v${details.versionNow}'
            '${details.wasCreated ? ' (created)' : ''}'
            '${details.hadUpgrade ? ' (upgraded)' : ''}',
      );
    },
    onUpgrade: (m, from, to) async {
      Diag.log('DB', 'migrate schema $from -> $to');
      if (from < 2) {
        await m.addColumn(drafts, drafts.title);
        await m.addColumn(drafts, drafts.layoutJson);
      }
    },
    onCreate: (m) async {
      await m.createAll();
      // 全文检索：独立 FTS5 表（非 external content），由 DAO 在保存
      // memo 时同事务维护（plain_text 由 doc 提取，触发器做不到）。
      await customStatement(
        'CREATE VIRTUAL TABLE memo_fts USING fts5(memo_id UNINDEXED, title, plain_text)',
      );
    },
  );

  /// CJK 友好的索引分词：汉字串展开为 unigram + 相邻 bigram，
  /// 拉丁词保持整词。FTS5 默认 unicode61 把整段汉字当一个 token，
  /// 不做这层处理中文子串搜索永远命不中。
  static String ftsIndexText(String text) {
    final tokens = <String>[];
    final buffer = StringBuffer();
    void flushLatin() {
      if (buffer.isNotEmpty) {
        tokens.add(buffer.toString());
        buffer.clear();
      }
    }

    final runes = text.runes.toList();
    var i = 0;
    while (i < runes.length) {
      final r = runes[i];
      if (_isCjk(r)) {
        flushLatin();
        // 收集连续汉字串
        final run = <int>[];
        while (i < runes.length && _isCjk(runes[i])) {
          run.add(runes[i]);
          i++;
        }
        // 先整段 unigram、再整段 bigram：短语查询要求 bigram 彼此相邻，
        // 交错排放会让 "亚克 克力" 这类短语永远命不中。
        for (var j = 0; j < run.length; j++) {
          tokens.add(String.fromCharCode(run[j]));
        }
        for (var j = 0; j + 1 < run.length; j++) {
          tokens.add(String.fromCharCodes([run[j], run[j + 1]]));
        }
      } else if (_isWordChar(r)) {
        buffer.writeCharCode(r);
        i++;
      } else {
        flushLatin();
        i++;
      }
    }
    flushLatin();
    return tokens.join(' ');
  }

  static bool _isCjk(int r) =>
      (r >= 0x4E00 && r <= 0x9FFF) ||
      (r >= 0x3400 && r <= 0x4DBF) ||
      (r >= 0xF900 && r <= 0xFAFF);

  static bool _isWordChar(int r) =>
      (r >= 0x30 && r <= 0x39) ||
      (r >= 0x41 && r <= 0x5A) ||
      (r >= 0x61 && r <= 0x7A) ||
      r == 0x5F;

  /// 把用户原始查询转成 FTS5 MATCH 表达式（与 ftsIndexText 同一分词）。
  static String ftsMatchQuery(String raw) {
    final terms = raw.trim().split(RegExp(r'\s+')).where((s) => s.isNotEmpty);
    final parts = <String>[];
    for (final term in terms) {
      final runes = term.runes.toList();
      final hasCjk = runes.any(_isCjk);
      if (!hasCjk) {
        parts.add('"${term.replaceAll('"', '""')}"');
      } else if (runes.length == 1) {
        parts.add('"${term.replaceAll('"', '""')}"');
      } else if (runes.length == 2) {
        parts.add('"${term.replaceAll('"', '""')}"');
      } else {
        final bigrams = <String>[];
        for (var j = 0; j + 1 < runes.length; j++) {
          // 仅对相邻同为 CJK 的对生成 bigram；混排时退化为整词短语
          if (_isCjk(runes[j]) && _isCjk(runes[j + 1])) {
            bigrams.add(String.fromCharCodes([runes[j], runes[j + 1]]));
          }
        }
        if (bigrams.isEmpty) {
          parts.add('"${term.replaceAll('"', '""')}"');
        } else {
          parts.add('"${bigrams.join(' ')}"');
        }
      }
    }
    return parts.join(' AND ');
  }

  /// 保存 memo 并同步 FTS（同一事务）。plainText 传原文，内部做索引分词。
  Future<void> upsertMemoWithFts(MemosCompanion memo, String plainText) async {
    await transaction(() async {
      await into(memos).insertOnConflictUpdate(memo);
      await customStatement('DELETE FROM memo_fts WHERE memo_id = ?', [
        memo.id.value,
      ]);
      await customInsert(
        'INSERT INTO memo_fts (memo_id, title, plain_text) VALUES (?, ?, ?)',
        variables: [
          Variable.withString(memo.id.value),
          // title 在 companion 里可缺省（Value.absent），读 .value 会抛错
          Variable.withString(
            ftsIndexText(memo.title.present ? memo.title.value : ''),
          ),
          Variable.withString(ftsIndexText(plainText)),
        ],
      );
    });
  }

  Future<void> deleteMemoWithFts(String memoId) async {
    await transaction(() async {
      await (delete(memos)..where((t) => t.id.equals(memoId))).go();
      await customStatement('DELETE FROM memo_fts WHERE memo_id = ?', [memoId]);
    });
  }

  /// FTS5 搜索：入参是用户原始查询，返回命中的 memo id（按相关度排序）。
  Future<List<String>> searchMemoIds(String rawQuery) async {
    final match = ftsMatchQuery(rawQuery);
    if (match.isEmpty) return const [];
    final rows = await customSelect(
      'SELECT memo_id FROM memo_fts WHERE memo_fts MATCH ? ORDER BY rank',
      variables: [Variable.withString(match)],
    ).get();
    return rows.map((r) => r.read<String>('memo_id')).toList();
  }
}
