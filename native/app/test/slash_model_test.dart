import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/editor/slash/slash_commands.dart';

void main() {
  group('slash 命令集', () {
    test('共 22 条，与 Web commands.js 一致', () {
      expect(slashCommands.length, 22);
      expect(slashCommands.map((c) => c.id).toSet().length, 22);
    });
  });

  group('filterSlashCommands', () {
    test('空查询无最近：基础块在前、媒体块在后，带分组标签', () {
      final items = filterSlashCommands(slashCommands, '');
      expect(items.length, 22);
      expect(items.first.command.id, 'heading');
      expect(items.first.sectionLabel, '基础块');
      final media = items.where((i) => i.command.group == 'media').toList();
      expect(media.length, 5);
      expect(media.first.sectionLabel, '媒体块');
    });

    test('拼音首字母查询：yy 命中引用与音乐卡片，startsWith 优先', () {
      final items = filterSlashCommands(slashCommands, 'yy');
      final ids = items.map((i) => i.command.id).toList();
      expect(ids, containsAll(['quote', 'musicCard']));
      // 引用 pinyin 恰为 yy（startsWith 桶），应排在音乐卡片之前
      expect(ids.indexOf('quote'), lessThan(ids.indexOf('musicCard')));
    });

    test('中文查询：标题命中 3 条', () {
      final items = filterSlashCommands(slashCommands, '标题');
      expect(
        items.map((i) => i.command.id),
        containsAll(['heading', 'heading2', 'heading3']),
      );
      expect(items.length, 3);
    });

    test('英文查询：code 命中代码块与内联代码', () {
      final items = filterSlashCommands(slashCommands, 'code');
      expect(
        items.map((i) => i.command.id),
        containsAll(['codeBlock', 'code']),
      );
    });

    test('最近使用置顶且不重复出现', () {
      final items = filterSlashCommands(
        slashCommands,
        '',
        recentIds: ['musicCard', 'todo'],
      );
      expect(items[0].command.id, 'musicCard');
      expect(items[0].sectionLabel, '最近使用');
      expect(items[1].command.id, 'todo');
      expect(items.where((i) => i.command.id == 'musicCard').length, 1);
      expect(items.length, 22);
    });

    test('无匹配返回空', () {
      expect(filterSlashCommands(slashCommands, 'zzzz'), isEmpty);
    });
  });
}
