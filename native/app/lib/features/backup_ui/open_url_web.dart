import 'dart:js_interop';

@JS('window.open')
external JSAny? _windowOpen(String url, String target, String features);

/// Web：新标签页打开（noopener，与原版链接卡行为一致）。
void openUrlInNewTab(String url) {
  _windowOpen(url, '_blank', 'noopener,noreferrer');
}
