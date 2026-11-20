// 回归防线：2026-11-18 九宫格拼音 IME 事故的四处 vendor 补丁防丢测试。
//
// 背景：iOS Safari + 九宫格拼音下，Super Editor 的增量 IME 同步会把
// 组合中的拼音片段逐段提交为正文（用户未选字就落字、越打堆越多）。
// 根治在 vendor/super_editor 的四处补丁（见该目录 PATCHES.md），原则
// 借鉴原 Web 版提交 e2fe28b：组合期间编辑器不干预，选字结束才同步。
//
// 这些补丁不在上游包里，升级/重拉 vendor 时最容易被静默丢掉——本测试
// 就是为此设的绊线：任何一处补丁消失，测试立刻红。
// 行为级回归另见仓库根目录 ime_t9_regression.mjs（CDP 模拟九宫格式
// 整段重写组合序列，断言提交文本精确无残片）。
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String readVendor(String rel) {
  final f = File('../vendor/super_editor/$rel');
  expect(f.existsSync(), isTrue, reason: 'vendor 文件缺失: $rel');
  return f.readAsStringSync();
}

void main() {
  group('vendor IME 补丁防丢', () {
    test('补丁1：IME 配置关闭增量模型', () {
      final src = readVendor(
        'lib/src/default_editor/document_ime/supereditor_ime_interactor.dart',
      );
      expect(src, contains('enableDeltaModel: false'));
      expect(src, isNot(contains('enableDeltaModel: true')));
    });

    test('补丁2：非增量全量值 diff 桥存在且被调用', () {
      final src = readVendor(
        'lib/src/default_editor/document_ime/document_ime_communication.dart',
      );
      expect(src, contains('_synthesizeDelta'));
      expect(src, contains('updateEditingValueWithDeltas([delta])'));
    });

    test('补丁3：组合期间禁止回推编辑状态（核心根治）', () {
      final src = readVendor(
        'lib/src/default_editor/document_ime/document_ime_communication.dart',
      );
      expect(src, contains('PUSH-SKIP while composing'));
      expect(
        src,
        contains('platformComposing.isValid && !platformComposing.isCollapsed'),
      );
    });

    test('补丁4：Web 关闭编辑器组合下划线（只留 iOS 系统蓝线）', () {
      // 截图像素采样定案：贴基线的蓝线是 iOS 系统标记文本下划线
      // (0,136,255)，应用层不可控；Web 上关掉编辑器自带线避免双线。
      final vendor = readVendor('lib/src/default_editor/super_editor.dart');
      expect(vendor, contains('!kIsWeb &&'));
      // 拼写/语法波浪线在 app 样式表设为透明（2026-11-18 样式表抽到
      // mynote_stylesheet.dart 后守卫跟随新落点）
      final sheet = File('lib/features/editor/mynote_stylesheet.dart')
          .readAsStringSync();
      expect(sheet, contains('Styles.grammarErrorUnderlineStyle'));
      expect(sheet, contains('Styles.spellingErrorUnderlineStyle'));
    });

    test('补丁5：历史栈上限 100 步', () {
      final src = readVendor('lib/src/core/editor.dart');
      expect(src, contains('MYNOTE PATCH 5'));
      expect(src, contains('while (_history.length > 100)'));
    });

    test('app 依赖 override 指向 vendor 版', () {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      expect(pubspec, contains('path: ../vendor/super_editor'));
    });
  });
}
