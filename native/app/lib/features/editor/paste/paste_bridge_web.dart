import 'dart:js_interop';
import 'dart:js_interop_unsafe';

/// Web 端粘贴桥：index.html 在捕获阶段拦截 paste 事件——剪贴板含
/// http 文本或图片文件时 preventDefault 并暂存内容、派发
/// 'mynote-paste' 事件，由 Dart 侧按 paste_policy 分类处理（避免与
/// Flutter 自身的粘贴管线竞态）；普通文本不拦截，走原生管线。
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

/// 读取 JS 暂存的第 index 个粘贴图片文件的字节。
Future<List<int>?> readPasteFileBytes(int index) async {
  try {
    final files = globalContext.getProperty(
      '__mynotePasteFiles'.toJS,
    ) as JSArray<JSObject>;
    if (index < 0 || index >= files.length) return null;
    final file = files.toDart[index];
    final buffer = await (file.callMethod(
      'arrayBuffer'.toJS,
    ) as JSPromise<JSArrayBuffer>).toDart;
    return buffer.toDart.asUint8List();
  } catch (_) {
    return null;
  }
}

@JS('addEventListener')
external void _addEventListener(JSString type, JSFunction listener);

// ignore: unused_element
JSFunction? _keptAlive;

void listenForPaste(void Function(PastePayload) onPaste) {
  final handler = (JSObject _) {
    final g = globalContext;
    final text = g.getProperty('__mynotePasteText'.toJS) as JSString?;
    final count = g.getProperty('__mynotePasteImageCount'.toJS) as JSNumber?;
    final typesRaw = globalContext.getProperty(
      '__mynotePasteTypes'.toJS,
    ) as JSArray<JSString>?;
    onPaste(
      PastePayload(
        text?.toDart ?? '',
        count?.toDartInt ?? 0,
        typesRaw?.toDart.map((e) => e.toDart).toList() ?? const [],
      ),
    );
  }.toJS;
  _keptAlive = handler;
  _addEventListener('mynote-paste'.toJS, handler);
}
