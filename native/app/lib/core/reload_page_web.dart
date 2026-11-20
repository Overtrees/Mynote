import 'dart:js_interop';

@JS('location.reload')
external void _reload();

void reloadPage() {
  try {
    _reload();
  } catch (_) {}
}
