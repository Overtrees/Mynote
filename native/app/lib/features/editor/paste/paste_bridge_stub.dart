/// 非 Web 端：粘贴走 Super Editor 原生管线（后续原生阶段再接策略）。
/// 表单守卫：焦点在标题/链接表单/图文 sheet 等普通输入框时置 true，
/// 编辑器粘贴处理必须放行（原版粘贴只作用于编辑器；此前桥全页捕获会把
/// 表单里粘贴的 URL 劫持成正文插卡，表单反而粘不进）。
bool pasteFormGuardActive = false;

class PastePayload {
  const PastePayload(this.text, this.imageCount, [this.imageTypes = const []]);
  final String text;
  final int imageCount;
  final List<String> imageTypes;
}

void listenForPaste(void Function(PastePayload) onPaste) {}

Future<List<int>?> readPasteFileBytes(int index) async => null;
