# Mynote vendor patches on super_editor 0.3.0-dev.52

Base: pub.dev super_editor 0.3.0-dev.52, vendored 2026-11-18 (lib/ only).
Re-apply these two changes when upgrading the package:

1. `lib/src/default_editor/document_ime/supereditor_ime_interactor.dart`
   — `SuperEditorImeConfiguration.toTextInputConfiguration`:
   `enableDeltaModel: true` → `false`.
2. `lib/src/default_editor/document_ime/document_ime_communication.dart`
   — `DocumentImeInputClient.updateEditingValue` (was a log-only stub):
   diff the incoming full TextEditingValue against `_platformTextEditingValue`
   (longest common prefix/suffix) into a single TextEditingDelta and feed it
   to the existing `updateEditingValueWithDeltas` pipeline.

Why: iOS Safari + T9 nine-grid pinyin rewrites the whole composing string per
key; platform-synthesized deltas drift from Super Editor's serialized IME
value and garble committed text (fragments of successive composing states get
inserted). Full-value updates are self-correcting. QWERTY pinyin was fine in
delta mode; this path handles both.

3. `lib/src/default_editor/document_ime/document_ime_communication.dart`
   — `DocumentImeInputClient._sendDocumentToIme`: skip entirely while the
   platform value has an active (valid, non-collapsed) composing range.
   Pushing setEditingState mid-composition makes iOS Safari restart the
   composition and commit the current fragment as plain text, so T9 pinyin
   fragments accumulate in the document before the user picks a candidate.
   Mirrors the original web editor's fix (Mynote commit e2fe28b: skip the
   input handler during IME composition, sync once on composition end).
   Plus IME event logging to `ime_debug.dart` (ImeDebug) for on-device
   diagnosis; harmless in production.

4. `lib/src/default_editor/super_editor.dart` — Web 上禁用编辑器自带
   组合下划线（`!kIsWeb &&` 平台判断）。定案依据：真机截图像素采样，
   贴基线的蓝线颜色为 (0,136,255)，是 iOS 系统标记文本下划线（系统蓝），
   由 WebKit 在引擎输入层绘制，位置/颜色应用层不可控；编辑器能控制的
   只有自己这条。故 Web 只留系统蓝线（与原生 App 一致），原生构建保留
   编辑器下划线。另：app 样式表把拼写/语法波浪线设为透明，避免英文
   内容被波浪线干扰（原 Web 版亦无此装饰）。

5. `lib/src/core/editor.dart` — `Editor.endTransaction`: after a transaction
   is recorded, trim `_history` to at most 100 entries (drop oldest).
   Why: the original web editor caps its undo stack at 100 steps; Super
   Editor's history is unbounded, which grows memory and replay cost on
   long sessions (undo replays all transactions). Marked in code with
   "MYNOTE PATCH 5".
