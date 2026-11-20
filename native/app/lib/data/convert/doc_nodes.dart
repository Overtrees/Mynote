import 'dart:convert';

import 'package:attributed_text/attributed_text.dart';
import 'package:super_editor/super_editor.dart';

/// Mynote 自定义文档节点（对应 Web doc 块 JSON 中无 Super Editor 内置落法的类型）。
///
/// 转换器约定（见 doc_converter.dart）：
/// - 已映射字段是权威数据源，导出时以节点字段为准；
/// - 未识别的顶层键 / attrs 键 / 原始 children 结构存放在 metadata['mynote']
///   的 passthrough 中，导出时原样合并回去，保证 round-trip 无损。

const String kMynoteMetadataKey = 'mynote';

Map<String, dynamic> deepCopyMap(Map<dynamic, dynamic> source) {
  return jsonDecode(jsonEncode(source)) as Map<String, dynamic>;
}

dynamic deepCopyValue(dynamic value) {
  if (value is Map || value is List) {
    return jsonDecode(jsonEncode(value));
  }
  return value;
}

/// 卡片类节点：musicCard / link-card / embedCard。
/// 数据在 Web 格式中位于块顶层：url、status、meta。
class CardNode extends BlockNode {
  CardNode({
    required this.id,
    required this.kind,
    this.url,
    this.status,
    this.meta,
    this.text,
    this.justCreated = false,
    super.metadata,
  }) {
    initAddToMetadata({'blockType': NamedAttribution(kind)});
  }

  @override
  final String id;

  /// Web 块类型：'musicCard' | 'link-card' | 'embedCard'
  final String kind;
  final String? url;
  final String? status;
  final Map<String, dynamic>? meta;

  /// 块 children 的纯文本（embedCard 的显示内容即此文本，
  /// 原版 editor.render.js 按段落渲染 children[0].text）。
  final String? text;

  /// 本会话内新建/刚提交 URL 的卡片（不序列化）：loading 态显示骨架；
  /// 从存储载入的 loading 卡按原版显示 error 形（见 block_components）。
  final bool justCreated;

  @override
  String? copyContent(dynamic selection) {
    if (selection is! UpstreamDownstreamNodeSelection) {
      throw Exception(
        'CardNode can only copy from UpstreamDownstreamNodeSelection.',
      );
    }
    return !selection.isCollapsed ? (url ?? '') : null;
  }

  @override
  bool hasEquivalentContent(DocumentNode other) {
    return other is CardNode &&
        other.kind == kind &&
        other.url == url &&
        other.status == status &&
        jsonEncode(other.meta) == jsonEncode(meta);
  }

  @override
  DocumentNode copyWithAddedMetadata(Map<String, dynamic> newProperties) {
    return CardNode(
      id: id,
      kind: kind,
      url: url,
      status: status,
      meta: meta,
      text: text,
      justCreated: justCreated,
      metadata: {...metadata, ...newProperties},
    );
  }

  @override
  DocumentNode copyAndReplaceMetadata(Map<String, dynamic> newMetadata) {
    return CardNode(
      id: id,
      kind: kind,
      url: url,
      status: status,
      meta: meta,
      text: text,
      justCreated: justCreated,
      metadata: newMetadata,
    );
  }

  CardNode copy() {
    return CardNode(
      id: id,
      kind: kind,
      url: url,
      status: status,
      meta: meta,
      text: text,
      justCreated: justCreated,
    );
  }

  CardNode copyWith({
    String? url,
    String? status,
    Map<String, dynamic>? meta,
    bool? justCreated,
  }) {
    return CardNode(
      id: id,
      kind: kind,
      url: url ?? this.url,
      status: status ?? this.status,
      meta: meta ?? this.meta,
      text: text,
      justCreated: justCreated ?? this.justCreated,
      metadata: metadata,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CardNode &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          kind == other.kind &&
          url == other.url &&
          status == other.status &&
          jsonEncode(meta) == jsonEncode(other.meta);

  @override
  int get hashCode =>
      id.hashCode ^
      kind.hashCode ^
      url.hashCode ^
      status.hashCode ^
      jsonEncode(meta).hashCode;
}

/// 媒体类节点：image / gallery / imgTextCard / imageTextRow / attachment。
/// attrs 整表保存在节点上（Phase 2 组件按 kind 读取），保证格式演进不丢字段。
class MediaNode extends BlockNode {
  MediaNode({
    required this.id,
    required this.kind,
    Map<String, dynamic>? attrs,
    this.fileId,
    this.imageFlag,
    this.text = '',
    super.metadata,
  }) : attrs = attrs ?? <String, dynamic>{} {
    initAddToMetadata({'blockType': NamedAttribution(kind)});
  }

  @override
  final String id;

  /// Web 块类型：'image' | 'gallery' | 'imgTextCard' | 'imageTextRow' | 'attachment'
  final String kind;

  /// Web 的 attrs 整表（image: fileId/src/alt；gallery: items；imgText*: fileId）
  final Map<String, dynamic> attrs;

  /// attachment 的顶层 fileId（与 image 的 attrs.fileId 是两套历史写法，都要保真）
  final String? fileId;

  /// 运行时唯一口径（L3 修复）：fileId 字段优先、attrs 镜像兜底。
  /// 历史上粘贴/选图只写 attrs、渲染只读字段，导致粘贴图空占位、
  /// 换图回退旧图；所有读写一律走此 getter + 构造时双写。
  String? get effectiveFileId {
    if (fileId != null && fileId!.isNotEmpty) return fileId;
    final a = attrs['fileId'];
    return (a is String && a.isNotEmpty) ? a : fileId;
  }

  /// attachment 的顶层 image 标记
  final bool? imageFlag;

  /// imgTextCard / imageTextRow 的正文（children[0].text）
  final String text;

  AttributedText get attributedText => AttributedText(text);

  @override
  String? copyContent(dynamic selection) {
    if (selection is! UpstreamDownstreamNodeSelection) {
      throw Exception(
        'MediaNode can only copy from UpstreamDownstreamNodeSelection.',
      );
    }
    return !selection.isCollapsed ? text : null;
  }

  @override
  bool hasEquivalentContent(DocumentNode other) {
    return other is MediaNode &&
        other.kind == kind &&
        other.fileId == fileId &&
        other.imageFlag == imageFlag &&
        other.text == text &&
        jsonEncode(other.attrs) == jsonEncode(attrs);
  }

  @override
  DocumentNode copyWithAddedMetadata(Map<String, dynamic> newProperties) {
    return MediaNode(
      id: id,
      kind: kind,
      attrs: attrs,
      fileId: fileId,
      imageFlag: imageFlag,
      text: text,
      metadata: {...metadata, ...newProperties},
    );
  }

  @override
  DocumentNode copyAndReplaceMetadata(Map<String, dynamic> newMetadata) {
    return MediaNode(
      id: id,
      kind: kind,
      attrs: attrs,
      fileId: fileId,
      imageFlag: imageFlag,
      text: text,
      metadata: newMetadata,
    );
  }

  MediaNode copy() {
    return MediaNode(
      id: id,
      kind: kind,
      attrs: deepCopyMap(attrs),
      fileId: fileId,
      imageFlag: imageFlag,
      text: text,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MediaNode &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          kind == other.kind &&
          fileId == other.fileId &&
          imageFlag == other.imageFlag &&
          text == other.text &&
          jsonEncode(attrs) == jsonEncode(other.attrs);

  @override
  int get hashCode =>
      id.hashCode ^
      kind.hashCode ^
      fileId.hashCode ^
      imageFlag.hashCode ^
      text.hashCode ^
      jsonEncode(attrs).hashCode;
}

/// 反向链接来源（一篇引用了当前笔记的其他笔记）。
class BacklinkSource {
  const BacklinkSource({required this.memoId, required this.title});

  final String memoId;
  final String title;

  @override
  bool operator ==(Object other) =>
      other is BacklinkSource && other.memoId == memoId && other.title == title;

  @override
  int get hashCode => Object.hash(memoId, title);
}

/// 反向链接分节节点：编辑器运行时注入的文档流末尾节点，
/// 非存储内容——序列化（DocConverter.toJson）时被过滤，
/// 保存/草稿/导出都不会带它。由编辑页按来源列表同步维护。
class BacklinksNode extends BlockNode {
  BacklinksNode({required this.sources, super.metadata})
    : id = kBacklinksNodeId {
    initAddToMetadata({'blockType': const NamedAttribution('backlinks')});
  }

  static const String kBacklinksNodeId = 'mynote-backlinks';

  @override
  final String id;

  final List<BacklinkSource> sources;

  @override
  String? copyContent(dynamic selection) => null;

  @override
  bool hasEquivalentContent(DocumentNode other) {
    if (other is! BacklinksNode || other.sources.length != sources.length) {
      return false;
    }
    for (var i = 0; i < sources.length; i++) {
      if (other.sources[i] != sources[i]) return false;
    }
    return true;
  }

  @override
  DocumentNode copyWithAddedMetadata(Map<String, dynamic> newProperties) {
    return BacklinksNode(
      sources: sources,
      metadata: {...metadata, ...newProperties},
    );
  }

  @override
  DocumentNode copyAndReplaceMetadata(Map<String, dynamic> newMetadata) {
    return BacklinksNode(sources: sources, metadata: newMetadata);
  }
}
