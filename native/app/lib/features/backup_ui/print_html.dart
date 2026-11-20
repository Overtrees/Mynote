// 打印 HTML（条件导入分发）：PDF 导出走打印路径（与 Web 一致）。
export 'print_html_stub.dart'
    if (dart.library.js_interop) 'print_html_web.dart';
