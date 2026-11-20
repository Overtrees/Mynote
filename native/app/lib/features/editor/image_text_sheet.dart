// 图文全文面板：原版 components/ImageTextSheet.js 复刻——
// 阅读模式显示全文（空时「暂无文本内容」），底部按钮在
// 「编辑文字 / 完成编辑」间切换，编辑即时回写节点。

import 'package:flutter/material.dart';

import '../../core/body_scroll.dart';
import '../../core/tokens.dart';
import '../../core/sheet_route.dart';
import 'paste/paste_bridge.dart';

Future<void> showImageTextSheet(
  BuildContext context, {
  required String initialText,
  required ValueChanged<String> onChange,
}) {
  return showMynoteSheet<void>(
    context: context,
    builder: (sheetContext) =>
        _ImageTextSheetBody(initialText: initialText, onChange: onChange),
  );
}

class _ImageTextSheetBody extends StatefulWidget {
  const _ImageTextSheetBody({
    required this.initialText,
    required this.onChange,
  });

  final String initialText;
  final ValueChanged<String> onChange;

  @override
  State<_ImageTextSheetBody> createState() => _ImageTextSheetBodyState();
}

class _ImageTextSheetBodyState extends State<_ImageTextSheetBody> {
  bool _editing = false;

  @override
  void initState() {
    super.initState();
    // sheet 打开期间粘贴归本 sheet 的输入框，编辑器粘贴桥放行
    pasteFormGuardActive = true;
  }

  late final TextEditingController _controller = TextEditingController(
    text: widget.initialText,
  );

  @override
  void dispose() {
    pasteFormGuardActive = false;
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    // 原版 editor-shell.css 口径：外层下距 = 安全区 + 14，面板内下距
    // 含安全区；安全区取生效值（引擎与宿主桥取大）——框架 SafeArea
    // 只读引擎值，嵌入 Web 恒 0（2026-11-20 审计修正）。
    final effBottom = effectiveInsets(
      MediaQuery.of(context).padding,
      hostInsets.value,
    ).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Center(
        child: Container(
          constraints: BoxConstraints(
            maxWidth: 600,
            maxHeight: MediaQuery.of(context).size.height * 0.78 > 680
                ? 680
                : MediaQuery.of(context).size.height * 0.78,
          ),
          margin: EdgeInsets.fromLTRB(14, 0, 14, 14 + effBottom),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(28),
            child: BackdropFilter(
              filter: MynoteTokens.overlayFilter,
              child: Container(
                decoration: BoxDecoration(
                  color: MynoteTokens.glassOverlayBg,
                  border: Border.all(
                    color: MynoteTokens.glassOverlayBorder,
                    width: 0.5,
                  ),
                  borderRadius: BorderRadius.circular(28),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: EdgeInsets.only(top: 18, bottom: 6),
                      child: Text(
                        '完整文本',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: MynoteTokens.textMain,
                        ),
                      ),
                    ),
                    Flexible(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
                        child: _editing
                            ? Container(
                                constraints: const BoxConstraints(
                                  minHeight: 160,
                                ),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: const Color(0x08000000),
                                  border: Border.all(
                                    color: MynoteTokens.border,
                                    width: 1,
                                  ),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: TextField(
                                  controller: _controller,
                                  autofocus: true,
                                  maxLines: null,
                                  minLines: 4,
                                  style: TextStyle(
                                    fontSize: 16,
                                    height: 1.75,
                                    color: MynoteTokens.textMain,
                                  ),
                                  decoration: const InputDecoration(
                                    hintText: '输入图片说明文字…',
                                    border: InputBorder.none,
                                    isDense: true,
                                    contentPadding: EdgeInsets.zero,
                                  ),
                                  onChanged: widget.onChange,
                                ),
                              )
                            : Align(
                                alignment: Alignment.topLeft,
                                child: Text(
                                  _controller.text.isEmpty
                                      ? '暂无文本内容'
                                      : _controller.text,
                                  style: TextStyle(
                                    fontSize: 16,
                                    height: 1.75,
                                    color: MynoteTokens.textMain,
                                  ),
                                ),
                              ),
                      ),
                    ),
                    // 底部操作区：右对齐 accent 浅底胶囊（原版规格）
                    Padding(
                      padding: EdgeInsets.fromLTRB(20, 10, 20, 16 + effBottom),
                      child: Align(
                        alignment: Alignment.centerRight,
                        child: Material(
                          color: const Color(0x1A007AFF),
                          borderRadius: BorderRadius.circular(999),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(999),
                            onTap: () => setState(() => _editing = !_editing),
                            child: Container(
                              constraints: const BoxConstraints(
                                minWidth: 104,
                                minHeight: 44,
                              ),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 18,
                              ),
                              alignment: Alignment.center,
                              child: Text(
                                _editing ? '完成编辑' : '编辑文字',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: MynoteTokens.accent,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
