/// 备份校验（纯 Dart 模块，无框架依赖——方案 §12 的二期抽取留口）。
///
/// 逐条对应 Web 的 src/services/backup-validate.js：
/// validateBackupData（memo/块/layout/avatars）与 validateZipPayload
/// （条目数/单文件/展开总量上限）+ ZIP 条目路径安全检查。
library;

import '../../core/diag.dart';

/// D8：校验拒绝统一打点后抛出（此前拒绝原因只到用户 toast，
/// 诊断日志里查不到是哪条校验拦的）。
Never _fail(String message) {
  Diag.error('BACKUP', 'validate reject: $message');
  throw BackupValidationError(message);
}

class BackupValidationError implements Exception {
  BackupValidationError(this.message);
  final String message;
  @override
  String toString() => message;
}

const int kMaxZipEntries = 3000;
const int kMaxZipFileBytes = 50 * 1024 * 1024;
const int kMaxZipExpandedBytes = 200 * 1024 * 1024;
const int kMaxDepth = 40; // 与 Web walk/validateNode 共用的深度上限一致

const Set<String> _currentBlockTypes = {
  'paragraph',
  'heading',
  'quote',
  'todo',
  'divider',
  'image',
  'gallery',
  'imgTextCard',
  'imageTextRow',
  'musicCard',
  'embedCard',
  'attachment',
  'link-card',
};

final RegExp _idPattern = RegExp(r'^[A-Za-z0-9_-]+$');
final RegExp _dataImagePattern = RegExp(
  r'^data:image/(png|jpeg|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$',
  caseSensitive: false,
);
final RegExp _httpPattern = RegExp(r'^https?://', caseSensitive: false);

bool _validId(dynamic value, int max, bool allowEmpty) {
  if (value is! String) return false;
  if (allowEmpty && value.isEmpty) return true;
  return value.length <= max && _idPattern.hasMatch(value);
}

void _requireString(dynamic value, String label) {
  if (value != null && value is! String) {
    _fail('$label格式无效');
  }
}

/// ZIP 条目路径安全（对应 validateZipInput 的名称检查部分）。
void validateZipEntryNames(Iterable<String> names) {
  for (final name in names) {
    if (name.isEmpty ||
        name.contains('\x00') ||
        name.startsWith('/') ||
        name.contains('\\') ||
        name
            .split('/')
            .any(
              (part) =>
                  part == '..' ||
                  part == '__proto__' ||
                  part == 'prototype' ||
                  part == 'constructor',
            )) {
      _fail('ZIP 包含不安全路径');
    }
  }
}

/// ZIP 载荷上限（对应 validateZipPayload）。
void validateZipPayload(Map<String, int> entrySizes) {
  if (entrySizes.length > kMaxZipEntries) {
    _fail('备份文件数量超过安全限制');
  }
  var total = 0;
  for (final size in entrySizes.values) {
    if (size > kMaxZipFileBytes) {
      _fail('单个备份文件超过安全限制');
    }
    total += size;
    if (total > kMaxZipExpandedBytes) {
      _fail('备份总大小超过安全限制');
    }
  }
}

void _validateNode(dynamic node, int nesting) {
  if (node is! Map) {
    _fail('正文块格式无效');
  }
  if (nesting > kMaxDepth) _fail('正文块嵌套过深');
  if (node['id'] != null && !_validId(node['id'], 128, false)) {
    _fail('正文块 ID 无效');
  }
  if (node['fileId'] != null && !_validId(node['fileId'], 256, false)) {
    _fail('附件 ID 无效');
  }
  final rawType = node['type'];
  if (rawType != null && rawType is! String) {
    _fail('正文块类型无效');
  }
  final type = (rawType as String?) ?? 'paragraph';
  if (type.length > 80) _fail('正文块类型无效');
  // 未知历史类型可导入（渲染降级），与 Web 一致
  if (!_currentBlockTypes.contains(type)) return;

  final attrsRaw = node['attrs'];
  if (attrsRaw != null && attrsRaw is! Map) {
    _fail('正文块属性格式无效');
  }
  final attrs = (attrsRaw as Map?) ?? const {};

  final children = node['children'];
  if (children != null) {
    if (children is! List || children.length > 5000) {
      _fail('正文块子项格式无效');
    }
    for (final child in children) {
      if (child is! Map) _fail('正文块文本子项无效');
      _requireString(child['text'], '正文块文本');
      final nested = child['children'];
      if (nested != null) {
        if (nested is! List || nested.length > 5000) {
          _fail('嵌套正文块子项格式无效');
        }
        for (final n in nested) {
          if (n is Map && n['type'] != null) _validateNode(n, nesting + 1);
        }
      }
    }
  }

  if (type == 'heading' && attrs['level'] != null) {
    final level = attrs['level'];
    if (level is! int || level < 1 || level > 6) {
      _fail('标题级别无效');
    }
  }
  if (type == 'todo' && attrs['checked'] != null && attrs['checked'] is! bool) {
    _fail('待办状态格式无效');
  }
  if (type == 'image' || type == 'imgTextCard' || type == 'imageTextRow') {
    if (attrs['fileId'] != null && !_validId(attrs['fileId'], 256, true)) {
      _fail('图片附件 ID 无效');
    }
    if (type == 'image') {
      _requireString(attrs['src'], '图片地址');
      _requireString(attrs['alt'], '图片替代文本');
    }
  }
  if (type == 'gallery' && attrs['items'] != null) {
    final items = attrs['items'];
    if (items is! List || items.length > 5000) {
      _fail('画廊项目格式无效');
    }
    for (final item in items) {
      if (item is String) {
        if (!_validId(item, 256, false) &&
            !_httpPattern.hasMatch(item) &&
            !_dataImagePattern.hasMatch(item)) {
          _fail('画廊图片项目无效');
        }
      } else if (item is Map) {
        if (item['fileId'] != null && !_validId(item['fileId'], 256, false)) {
          _fail('画廊附件 ID 无效');
        }
        _requireString(item['url'], '画廊图片地址');
        _requireString(item['alt'], '画廊替代文本');
      } else {
        _fail('画廊项目格式无效');
      }
    }
  }
  if (type == 'musicCard' || type == 'link-card' || type == 'embedCard') {
    _requireString(node['url'], '卡片链接');
    const statuses = {'empty', 'input', 'loading', 'ready', 'error', 'done'};
    if (node['status'] != null && !statuses.contains(node['status'])) {
      _fail('卡片状态无效');
    }
    final meta = node['meta'];
    if (meta != null && meta is! Map) {
      _fail('卡片元数据格式无效');
    }
    if (meta is Map) {
      for (final key in const [
        'title',
        'subtitle',
        'source',
        'description',
        'siteName',
        'favicon',
      ]) {
        _requireString(meta[key], '卡片元数据');
      }
    }
  }
  if (type == 'attachment' && node['image'] != null && node['image'] is! bool) {
    _fail('附件类型标记无效');
  }
}

/// 通用结构走查（对应 Web validateBackupData 的 walk）：
/// 节点数/深度/字符串/文本总量上限、禁用键、链接白名单。
void _walkBackup(dynamic value, _WalkState state, int depth, String key) {
  state.nodes++;
  // 深度按 JSON 层级计，上限 40 与原版 walk maxDepth 一致（原版实测：
  // 块嵌套 8 层通过、9 层在此被拒）；块嵌套语义深度另由 _validateNode 把关。
  if (state.nodes > 200000 || depth > 40) {
    _fail('备份结构过深或项目过多');
  }
  if (value is String) {
    state.textBytes += value.length * 2;
    if (value.length > 2 * 1024 * 1024 || state.textBytes > 30 * 1024 * 1024) {
      _fail('备份文本超过安全限制');
    }
    if (value.isNotEmpty &&
        RegExp(
          r'^(src|cover|image|url|href|musicUrl)$',
          caseSensitive: false,
        ).hasMatch(key)) {
      final trimmed = value.trim();
      if (!_httpPattern.hasMatch(trimmed) &&
          !_dataImagePattern.hasMatch(trimmed)) {
        _fail('备份包含不安全的链接地址');
      }
    }
    return;
  }
  if (value == null || value is bool || value is num) return;
  if (value is List) {
    if (value.length > 50000) _fail('备份数组过大');
    for (final v in value) {
      _walkBackup(v, state, depth + 1, '');
    }
    return;
  }
  if (value is Map) {
    if (value.length > 256) _fail('备份对象字段过多');
    for (final entry in value.entries) {
      final k = entry.key.toString();
      if (k == '__proto__' || k == 'prototype' || k == 'constructor') {
        _fail('备份包含不安全字段');
      }
      _walkBackup(entry.value, state, depth + 1, k);
    }
    return;
  }
  _fail('备份包含不支持的数据类型');
}

class _WalkState {
  int nodes = 0;
  int textBytes = 0;
}

/// 校验解码后的备份对象（对应 validateBackupData 的核心部分）。
void validateBackupData(dynamic backup) {
  if (backup is! Map) _fail('备份数据格式无效');
  // 版本：缺失=旧版格式；存在须为 1–2 的整数（Web 同口径）
  final version = backup['version'];
  if (version != null && (version is! int || version < 1 || version > 2)) {
    _fail('不支持的备份版本');
  }
  final memos = backup['memos'];
  if (memos is! List) _fail('备份缺少笔记列表');
  if (memos.length > 20000) _fail('备份笔记数量超过安全限制');
  _walkBackup(backup, _WalkState(), 0, '');

  final memoIds = <String>{};
  for (final memo in memos) {
    if (memo is! Map) _fail('备份中有无效笔记');
    final id = memo['id'];
    if (id is! String || !_idPattern.hasMatch(id) || id.length > 128) {
      _fail('备份笔记缺少有效 ID');
    }
    if (!memoIds.add(id)) _fail('备份包含重复笔记 ID');
    if (memo['title'] != null && memo['title'] is! String) {
      _fail('笔记标题格式无效');
    }
    final doc = memo['doc'];
    if (doc != null && doc is! List) _fail('笔记正文格式无效');
    if (doc is List && doc.length > 20000) {
      _fail('单篇笔记内容过多');
    }
    final blockIds = <String>{};
    if (doc is List) {
      for (final block in doc) {
        _validateNode(block, 0);
        if (block is Map && block['id'] != null) {
          final bid = block['id'] as String;
          if (!blockIds.add(bid)) _fail('笔记包含重复正文块 ID');
        }
      }
    }
    final layout = memo['layout'];
    if (layout != null) {
      if (layout is! Map ||
          layout['version'] != 1 ||
          !const {'flow', 'independent'}.contains(layout['mode']) ||
          layout['left'] is! List ||
          layout['right'] is! List) {
        _fail('笔记列布局格式无效');
      }
      final left = layout['left'] as List;
      final right = layout['right'] as List;
      if (left.length > 20000 || right.length > 20000) {
        _fail('笔记列布局内容过多');
      }
      final ordered = <String>[];
      final seen = <String>{};
      for (final columnIds in [left, right]) {
        for (final cid in columnIds) {
          if (!_validId(cid, 128, false)) _fail('笔记列布局块 ID 无效');
          if (!seen.add(cid as String)) _fail('笔记列布局包含重复块 ID');
          if (!blockIds.contains(cid)) _fail('笔记列布局引用了不存在的正文块');
          ordered.add(cid);
        }
      }
      final docIds = (doc as List? ?? const [])
          .map((b) => (b is Map ? b['id'] : null) ?? '')
          .toList();
      if (docIds.any((d) => d.isEmpty) ||
          ordered.length != docIds.length ||
          List.generate(
            ordered.length,
            (i) => ordered[i] != docIds[i],
          ).any((m) => m)) {
        _fail('笔记列布局与正文块顺序不匹配');
      }
    }
  }

  final avatars = backup['avatars'];
  if (avatars != null) {
    if (avatars is! Map) _fail('头像备份格式无效');
    for (final entry in avatars.entries) {
      final key = entry.key;
      final value = entry.value;
      if (key is! String ||
          key.length > 128 ||
          !_idPattern.hasMatch(key) ||
          value is! String ||
          !_dataImagePattern.hasMatch(value)) {
        _fail('头像数据格式无效');
      }
    }
  }
}
