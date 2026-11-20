import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/features/editor/paste/paste_policy.dart';

void main() {
  group('classifyPaste（对照 Web handleEditorPaste）', () {
    test('纯 URL → 链接卡', () {
      final d = classifyPaste(
        text: 'https://open.spotify.com/track/abc',
        hasImageFiles: false,
      );
      expect(d.kind, PasteKind.pureUrlCard);
      expect(d.url, 'https://open.spotify.com/track/abc');
    });

    test('文本内嵌音乐链接 → 只取链接插卡', () {
      final d = classifyPaste(
        text: '分享一首歌 https://music.163.com/song?id=123 好听',
        hasImageFiles: false,
      );
      expect(d.kind, PasteKind.embeddedMediaCard);
      expect(d.url, 'https://music.163.com/song?id=123');
    });

    test('文本内嵌普通链接 → 插卡 + 剩余文本', () {
      final d = classifyPaste(
        text: '看这个 https://example.com/a 很有意思',
        hasImageFiles: false,
      );
      expect(d.kind, PasteKind.embeddedUrlWithRemainder);
      expect(d.url, 'https://example.com/a');
      expect(d.remainder, '看这个  很有意思');
    });

    test('Markdown 文本带链接 → 原样纯文本（不拆卡）', () {
      final d = classifyPaste(
        text: '# 标题\n[链接](https://example.com)',
        hasImageFiles: false,
      );
      expect(d.kind, PasteKind.plainText);
    });

    test('图片文件优先于纯文本', () {
      final d = classifyPaste(text: '截图说明', hasImageFiles: true);
      expect(d.kind, PasteKind.imageFiles);
    });

    test('粘进音乐卡输入 → 抽 URL 入卡', () {
      final d = classifyPaste(
        text: '链接: https://y.qq.com/n/ryqq/songDetail/xyz',
        hasImageFiles: false,
        intoMusicInput: true,
      );
      expect(d.kind, PasteKind.musicInputUrl);
      expect(d.url, 'https://y.qq.com/n/ryqq/songDetail/xyz');
    });

    test('普通多行文本 → 纯文本', () {
      final d = classifyPaste(text: '第一行\n第二行', hasImageFiles: false);
      expect(d.kind, PasteKind.plainText);
    });
  });

  group('辅助函数', () {
    test('isUrl', () {
      expect(isUrl('https://a.com/x?y=1'), isTrue);
      expect(isUrl('a.com/x'), isFalse);
      expect(isUrl('https://a'), isFalse);
    });

    test('looksLikeMarkdown', () {
      expect(looksLikeMarkdown('## 标题'), isTrue);
      expect(looksLikeMarkdown('普通一句话'), isFalse);
      expect(looksLikeMarkdown('价格是 \$x^2+1\$ 元'), isTrue);
    });
  });
}
