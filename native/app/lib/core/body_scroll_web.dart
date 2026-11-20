import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/widgets.dart';

import 'body_scroll.dart';
import 'diag.dart';

/// Web（元素嵌入外壳）：桥接 web/index.html 的宿主脚本。
bool get bodyScrollSupported => true;

bool _inited = false;

void initBodyScroll() {
  if (_inited) return;
  _inited = true;
  try {
    final cb = (JSNumber y) {
      bodyScrollY.value = y.toDartDouble;
    }.toJS;
    globalContext.setProperty('__mynoteOnScroll'.toJS, cb);
    final icb = (JSNumber t, JSNumber r, JSNumber b, JSNumber l) {
      final next = EdgeInsets.fromLTRB(
        l.toDartDouble,
        t.toDartDouble,
        r.toDartDouble,
        b.toDartDouble,
      );
      if (next != hostInsets.value) {
        hostInsets.value = next;
        Diag.log(
          'APP',
          'host insets t=${next.top.toStringAsFixed(0)} '
              'b=${next.bottom.toStringAsFixed(0)}',
        );
      }
    }.toJS;
    globalContext.setProperty('__mynoteOnInsets'.toJS, icb);
    final sy = globalContext.getProperty('scrollY'.toJS);
    if (sy is JSNumber) bodyScrollY.value = sy.toDartDouble;
  } catch (_) {
    // 桥注册失败时页面退化为内部滚动，不应崩溃
  }
}

/// 把内容总高告诉宿主页，宿主页据此设置占位层高度（body 滚动范围）。
void reportContentHeight(double height) {
  try {
    final f = globalContext.getProperty('__mynoteSetHeight'.toJS);
    if (f is JSFunction) f.callAsFunction(null, height.toJS);
  } catch (_) {}
}

/// 让宿主页面（body）滚到指定偏移（光标跟随、回顶等）。
void scrollWindowTo(double y) {
  try {
    final f = globalContext.getProperty('scrollTo'.toJS);
    if (f is JSFunction) f.callAsFunction(null, 0.toJS, y.toJS);
  } catch (_) {}
}
