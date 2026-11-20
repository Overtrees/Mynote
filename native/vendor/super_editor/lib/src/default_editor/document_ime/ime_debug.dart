import 'package:flutter/foundation.dart';

/// Mynote diagnostic: ring buffer of IME events for on-screen debugging
/// on real devices (no console access on iOS Safari). Not used in
/// production builds unless the app displays it.
class ImeDebug {
  static final List<String> events = <String>[];
  static final ValueNotifier<int> tick = ValueNotifier<int>(0);

  static void log(String event) {
    final now = DateTime.now();
    final ts =
        '${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}.${(now.millisecond ~/ 10).toString().padLeft(2, '0')}';
    events.add('$ts $event');
    if (events.length > 80) {
      events.removeAt(0);
    }
    tick.value++;
  }

  static void clear() {
    events.clear();
    tick.value++;
  }
}
