import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'diag_store.dart';

/// 全项目统一诊断日志（2026-11-18 用户立规矩：所有功能模块同步带诊断，
/// 方便后续快速定位、修复与运维）。
///
/// 用法：Diag.log('模块', '发生了什么') / Diag.error('模块', e)。
/// 模块标签约定：IME（vendor 内走 ImeDebug，面板合并展示）、SLASH、TOOLBAR、
/// EDITOR、LIST、DB、BACKUP、CONVERT、DRIVE、CARD、SEARCH、PASTE、EXPORT、SETTINGS。
/// 时间戳格式与 vendor 的 ImeDebug 对齐（mm:ss.cc），面板可合并排序。
/// 诊断构建（IME_DEBUG=true）下编辑器页有日志面板；正式构建静默收集、
/// 不展示、不外发。
class Diag {
  static final List<String> events = <String>[];
  static final ValueNotifier<int> tick = ValueNotifier<int>(0);
  static const int _cap = 150;

  static bool _initialized = false;

  /// 启动时调用：恢复上次会话的日志（崩溃/重载后仍可定位异常）。
  static void init() {
    if (_initialized) return;
    _initialized = true;
    try {
      final raw = diagLoad();
      if (raw != null && raw.isNotEmpty) {
        final list = jsonDecode(raw) as List<dynamic>;
        events.addAll(list.map((e) => e.toString()));
        if (events.length > _cap) {
          events.removeRange(0, events.length - _cap);
        }
      }
    } catch (_) {
      // 持久化损坏不阻断启动
    }
    log('DIAG', 'session start (restored ${events.length} entries)');
  }

  static Timer? _persistTimer;

  /// 持久化防抖 500ms 批量写：高频日志（如搜索/键入）不再每条都全表
  /// JSON 编码写 localStorage（此前逐条写既拖慢输入又冲刷缓冲）。
  static void _persist() {
    if (_persistTimer != null) return;
    _persistTimer = Timer(const Duration(milliseconds: 500), () {
      _persistTimer = null;
      try {
        diagSave(jsonEncode(events));
      } catch (_) {}
    });
  }

  static void log(String tag, String message) {
    final now = DateTime.now();
    final ts =
        '${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}.${(now.millisecond ~/ 10).toString().padLeft(2, '0')}';
    events.add('$ts [$tag] $message');
    if (events.length > _cap) {
      events.removeAt(0);
    }
    tick.value++;
    _persist();
  }

  static void error(String tag, Object error) {
    log(tag, 'ERROR $error');
  }

  /// 警告级（对应 Web error-boundary 的 WARN 通道）。
  static void warn(String tag, String message) {
    log(tag, 'WARN $message');
  }

  static int get errorCount => events
      .where((e) => e.contains('] ERROR ') || e.contains(' ERROR '))
      .length;
  static int get warnCount => events.where((e) => e.contains(' WARN ')).length;

  static void clear() {
    events.clear();
    tick.value++;
    _persist();
  }
}
