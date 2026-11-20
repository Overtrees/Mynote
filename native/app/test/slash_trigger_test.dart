import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/editor/slash/slash_trigger.dart';

void main() {
  group('detectSlashToken', () {
    test('行首斜杠触发，查询为斜杠后文本', () {
      final t = detectSlashToken('/yy', 3);
      expect(t, isNotNull);
      expect(t!.start, 0);
      expect(t.end, 3);
      expect(t.query, 'yy');
    });

    test('句中斜杠（空格后）触发', () {
      final t = detectSlashToken('你好 /bt', 6);
      expect(t, isNotNull);
      expect(t!.start, 3);
      expect(t.query, 'bt');
    });

    test('句中无空格斜杠也可触发（Web 语义）', () {
      final t = detectSlashToken('a/b', 3);
      expect(t, isNotNull);
      expect(t!.query, 'b');
    });

    test('URL 里的斜杠不触发', () {
      expect(detectSlashToken('https://a.com/x', 15), isNull);
      expect(detectSlashToken('看 www.example.com/a', 17), isNull);
    });

    test('查询含空格关闭', () {
      expect(detectSlashToken('/y y', 4), isNull);
    });

    test('查询超 30 字关闭', () {
      expect(detectSlashToken('/${'a' * 31}', 32), isNull);
    });

    test('空查询（刚打斜杠）打开', () {
      final t = detectSlashToken('正文/', 3);
      expect(t, isNotNull);
      expect(t!.query, '');
    });

    test('无斜杠或光标在斜杠前不触发', () {
      expect(detectSlashToken('hello', 5), isNull);
      expect(detectSlashToken('/yy', 0), isNull);
    });
  });
}
