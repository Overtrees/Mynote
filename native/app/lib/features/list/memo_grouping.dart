// 列表分组与时间格式：原版 runtime.js getSectionLabel 与 utils/time.js
// timeAgo 的移植。分组依据 createdAt（与 Web 的 createdAt || updatedAt
// 一致，createdAt 恒有值）；行内时间为 updatedAt 的 timeAgo。
import 'dart:convert';

/// 今天/昨天/过去7天/过去30天/N月（同年）/N年（跨年）。
String sectionLabel(DateTime date, DateTime now) {
  final today = DateTime(now.year, now.month, now.day);
  final yesterday = today.subtract(const Duration(days: 1));
  final sevenDaysAgo = today.subtract(const Duration(days: 7));
  final thirtyDaysAgo = today.subtract(const Duration(days: 30));
  if (!date.isBefore(today)) return '今天';
  if (!date.isBefore(yesterday)) return '昨天';
  if (!date.isBefore(sevenDaysAgo)) return '过去7天';
  if (!date.isBefore(thirtyDaysAgo)) return '过去30天';
  if (date.year == now.year) return '${date.month}月';
  return '${date.year}年';
}

/// 今天 → 24 小时制 HH:mm 或上午/下午 h:mm（原版按系统 Intl 判定，
/// Flutter 侧用 MediaQuery.alwaysUse24HourFormat 传入）；
/// 昨天 → 昨天；今年 → M/d；跨年 → yyyy/M/d。
String listTimeAgo(DateTime date, DateTime now, {bool use24h = false}) {
  final today = DateTime(now.year, now.month, now.day);
  final yesterday = today.subtract(const Duration(days: 1));
  if (!date.isBefore(today)) {
    final mm = date.minute.toString().padLeft(2, '0');
    if (use24h) return '${date.hour.toString().padLeft(2, '0')}:$mm';
    final ampm = date.hour < 12 ? '上午' : '下午';
    final h12 = date.hour % 12 == 0 ? 12 : date.hour % 12;
    return '$ampm $h12:$mm';
  }
  if (!date.isBefore(yesterday)) return '昨天';
  if (date.year == now.year) return '${date.month}/${date.day}';
  return '${date.year}/${date.month}/${date.day}';
}

/// 列表预览：文档第一个段落的文字（原版口径：待办等不算预览，
/// 无段落时列表显示「无更多文本」）。
String memoPreview(String docJson) {
  try {
    final doc = jsonDecode(docJson);
    if (doc is List) {
      for (final node in doc) {
        if (node is Map && node['type'] == 'paragraph') {
          final children = node['children'];
          if (children is List &&
              children.isNotEmpty &&
              children.first is Map) {
            final text = (children.first as Map)['text']?.toString() ?? '';
            if (text.trim().isNotEmpty) return text.replaceAll('\n', ' ');
          }
        }
      }
    }
  } catch (_) {}
  return '';
}

/// 分组结果：置顶组在最前（label 置顶），其余按 sectionLabel 顺序出现。
List<(String, List<T>)> groupBySection<T>(
  List<T> items, {
  required bool Function(T) isPinned,
  required DateTime Function(T) groupDate,
  required DateTime now,
}) {
  final pinned = <T>[];
  final sections = <String, List<T>>{};
  final order = <String>[];
  for (final item in items) {
    if (isPinned(item)) {
      pinned.add(item);
      continue;
    }
    final label = sectionLabel(groupDate(item), now);
    if (!sections.containsKey(label)) {
      sections[label] = [];
      order.add(label);
    }
    sections[label]!.add(item);
  }
  return [
    if (pinned.isNotEmpty) ('置顶', pinned),
    for (final label in order) (label, sections[label]!),
  ];
}
