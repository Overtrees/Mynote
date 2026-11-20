import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/list/memo_grouping.dart';

void main() {
  final now = DateTime(2026, 11, 18, 20, 40);

  test('sectionLabel 桶位', () {
    expect(sectionLabel(DateTime(2026, 11, 18, 9), now), '今天');
    expect(sectionLabel(DateTime(2026, 11, 17, 23), now), '昨天');
    expect(sectionLabel(DateTime(2026, 11, 13), now), '过去7天');
    expect(sectionLabel(DateTime(2026, 10, 25), now), '过去30天');
    expect(sectionLabel(DateTime(2026, 3, 5), now), '3月');
    expect(sectionLabel(DateTime(2024, 12, 31), now), '2024年');
  });

  test('listTimeAgo 格式', () {
    expect(listTimeAgo(DateTime(2026, 11, 18, 19, 39), now), '下午 7:39');
    expect(listTimeAgo(DateTime(2026, 11, 18, 8, 5), now), '上午 8:05');
    expect(listTimeAgo(DateTime(2026, 11, 18, 0, 30), now), '上午 12:30');
    expect(listTimeAgo(DateTime(2026, 11, 17, 15), now), '昨天');
    expect(listTimeAgo(DateTime(2026, 11, 15), now), '11/15');
    expect(listTimeAgo(DateTime(2025, 1, 2), now), '2025/1/2');
  });

  test('memoPreview 取首个文本块', () {
    const doc =
        '[{"id":"1","type":"musicCard","url":"x"},{"id":"2","type":"paragraph","children":[{"text":"第一段文字"}]}]';
    expect(memoPreview(doc), '第一段文字');
    expect(memoPreview('[]'), '');
    expect(memoPreview('bad'), '');
  });

  test('groupBySection 置顶在前', () {
    final items = [
      (pinned: false, at: DateTime(2026, 11, 18, 10)),
      (pinned: true, at: DateTime(2026, 11, 10)),
      (pinned: false, at: DateTime(2026, 11, 17, 10)),
    ];
    final groups = groupBySection(
      items,
      isPinned: (e) => e.pinned,
      groupDate: (e) => e.at,
      now: now,
    );
    expect(groups.map((g) => g.$1).toList(), ['置顶', '今天', '昨天']);
  });
}
