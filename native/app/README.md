# Mynote（Flutter 版）

与 Web 版（仓库根目录）数据格式完全互通的 Flutter 重写：备份 ZIP、文档
block JSON 均为同一格式，可双向导入导出。Web 版保持运行，本目录独立演进。

## 锁定版本

- Flutter 3.50.0 / Dart（随 SDK）
- super_editor 0.3.0-dev.52（vendored 于 `../vendor/super_editor`，
  pubspec 以 dependency_overrides 指向之；含 IME 四补丁，见该目录
  PATCHES.md 与 `test/vendor_ime_patches_test.dart` 绊线测试）

## 常用命令

```bash
flutter pub get
flutter test                 # 全量单测（含转换器/备份/粘贴/导出/IME 绊线）
flutter build web --release --no-web-resources-cdn   # 自托管 CanvasKit
bash scripts/build_deploy.sh --deploy                # 流水线+部署 Pages
```

Web 存储：drift + sqlite3.wasm（web/ 目录）+ IndexedDB 文件系统；
附件存 OPFS；诊断日志持久化于 localStorage `mynote_diag_v1`。

## 约定

- 每个功能模块必须同步加诊断（`lib/core/diag.dart`，tag 见 plan 文档）。
- UI/UX 一比一复刻 Web 版（规格：`~/workspace/mynote-ui-spec.md`）：
  无底部工具栏，格式功能集成于 `/` 面板；诊断入口在设置页。
- 文档模型：存储/交换用 Web 的 block JSON，编辑器节点树仅在
  `lib/data/convert/` 转换层出现。
