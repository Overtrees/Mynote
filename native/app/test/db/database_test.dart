import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/db/database.dart';
import 'package:drift/drift.dart' show Value;

void main() {
  test('memo 存取 + FTS 中文/英文检索', () async {
    final db = MynoteDatabase(NativeDatabase.memory());
    addTearDown(db.close);

    final now = DateTime.now().millisecondsSinceEpoch;
    await db.upsertMemoWithFts(
      MemosCompanion.insert(
        id: 'memo_1',
        title: const Value('周末看展记录'),
        docJson: const Value(
          '[{"type":"paragraph","children":[{"text":"光线透过亚克力板"}]}]',
        ),
        createdAt: now,
        updatedAt: now,
      ),
      '光线透过亚克力板投射在墙上',
    );
    await db.upsertMemoWithFts(
      MemosCompanion.insert(
        id: 'memo_2',
        title: const Value('Shopping list'),
        docJson: const Value('[]'),
        createdAt: now,
        updatedAt: now,
      ),
      'milk and eggs',
    );

    final all = await db.select(db.memos).get();
    expect(all.length, 2);
    expect(all.firstWhere((m) => m.id == 'memo_1').title, '周末看展记录');

    expect(await db.searchMemoIds('亚克力'), ['memo_1']);
    expect(await db.searchMemoIds('看展'), ['memo_1']);
    expect(await db.searchMemoIds('milk'), ['memo_2']);
    expect(await db.searchMemoIds('不存在的词'), isEmpty);

    await db.deleteMemoWithFts('memo_1');
    expect(await db.searchMemoIds('亚克力'), isEmpty);
    expect((await db.select(db.memos).get()).length, 1);
  });

  test('companion 缺省 title 时 upsert 不崩（新建笔记路径）', () async {
    final db = MynoteDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final now = DateTime.now().millisecondsSinceEpoch;
    await db.upsertMemoWithFts(
      MemosCompanion.insert(
        id: 'memo_new',
        docJson: const Value(
          '[{"type":"paragraph","children":[{"text":"新笔记正文"}]}]',
        ),
        createdAt: now,
        updatedAt: now,
      ),
      '新笔记正文',
    );
    final row = await (db.select(
      db.memos,
    )..where((t) => t.id.equals('memo_new'))).getSingle();
    expect(row.title, '');
    expect(await db.searchMemoIds('新笔记'), ['memo_new']);
  });
}
