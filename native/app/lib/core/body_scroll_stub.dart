/// 非 Web 平台：无 body 可滚，页面走原内部滚动。
bool get bodyScrollSupported => false;

void initBodyScroll() {}

void reportContentHeight(double height) {}

void scrollWindowTo(double y) {}
