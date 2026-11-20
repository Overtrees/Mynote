import 'package:attributed_text/attributed_text.dart';
import 'package:super_editor/super_editor.dart';

import '../../core/diag.dart';
import 'doc_nodes.dart';
import 'inline_marks.dart';

/// Web doc 块 JSON <-> Super Editor Document 双向转换器。
///
/// 格式依据（Web 仓库源码，2026-11-18 核对）：
/// - 块：{id, type, attrs?, children?, ...}，文本块只有 children[0].text 一段纯文本，
///   行内格式（==高亮==、**粗体** 等）是文本内的行内语法，不是结构化 marks，
///   因此转换时文本逐字保真、不解析。
/// - 权威类型表见 src/services/backup-validate.js 的 currentBlockTypes（13 种）；
///   未知类型在 Web 渲染时降级为文本，这里降级为 ParagraphNode 并用
///   passthrough 记住原类型，导出时恢复。
/// - children 的子项可以带 children（嵌套块，如分栏）：v1 不进编辑模型，
///   整体存 passthrough；父块文本未改时原样导出，改了也保留嵌套数组。
class DocConverter {
  static const Set<String> _cardKinds = {'musicCard', 'link-card', 'embedCard'};
  static const Set<String> _mediaKinds = {
    'image',
    'gallery',
    'imgTextCard',
    'imageTextRow',
    'attachment',
  };

  static MutableDocument fromJson(List<dynamic> docJson) {
    final nodes = <DocumentNode>[];
    for (final raw in docJson) {
      if (raw is Map) {
        try {
          nodes.add(blockFromJson(Map<dynamic, dynamic>.from(raw)));
        } catch (e) {
          // 单块坏数据降级为段落（原版对异常块亦降级渲染），不击穿整篇
          Diag.warn('CONVERT', 'block degrade: $e');
          final children = raw['children'];
          var text = '';
          if (children is List) text = _childrenText(children);
          nodes.add(
            ParagraphNode(
              id: Editor.createNodeId(),
              text: AttributedText(text),
            ),
          );
        }
      }
    }
    renumberAllFootnotes(nodes);
    return MutableDocument(nodes: nodes);
  }

  /// 脚注编号后处理（原位修改节点列表）：按定义首次出现顺序，
  /// 把所有引用的显示文本换成编号；定义行本身保持原文。
  /// 编辑器内的重编号走同一函数（editor_page 复用）。
  static void renumberAllFootnotes(List<DocumentNode> nodes) {
    final texts = <String>[];
    for (final n in nodes) {
      if (n is TextNode) texts.add(n.text.toPlainText());
    }
    final order = footnoteOrderFromTexts(texts);
    if (order.isEmpty) return;
    for (var i = 0; i < nodes.length; i++) {
      final n = nodes[i];
      if (n is ParagraphNode) {
        final t = renumberFootnoteRefs(n.text, order);
        if (!identical(t, n.text)) nodes[i] = n.copyTextNodeWith(text: t);
      } else if (n is TaskNode) {
        final t = renumberFootnoteRefs(n.text, order);
        if (!identical(t, n.text)) nodes[i] = n.copyTextNodeWith(text: t);
      }
    }
  }

  static List<Map<String, dynamic>> toJson(Iterable<DocumentNode> nodes) {
    // BacklinksNode 是运行时注入的反链分节，不是存储内容，恒过滤
    return nodes.where((n) => n is! BacklinksNode).map(blockToJson).toList();
  }

  // ---------------------------------------------------------------- import

  static DocumentNode blockFromJson(Map<dynamic, dynamic> raw) {
    final block = deepCopyMap(raw);
    final type = block['type'] is String
        ? block['type'] as String
        : 'paragraph';
    final hasId = block['id'] is String && (block['id'] as String).isNotEmpty;
    final id = hasId ? block['id'] as String : Editor.createNodeId();

    final attrs = block['attrs'] is Map
        ? deepCopyMap(block['attrs'] as Map)
        : <String, dynamic>{};
    final children = block['children'] is List
        ? block['children'] as List
        : const [];
    final text = _childrenText(children);
    final hasNested = children.any((c) => c is Map && c['children'] is List);

    // passthrough：未映射的顶层键、attrs 键，以及需要保真的原始结构
    final passthrough = <String, dynamic>{};
    if (!hasId) passthrough['noId'] = true;
    if (hasNested || children.length > 1)
      passthrough['origChildren'] = deepCopyValue(children);
    final consumedTop = <String>{'id', 'type', 'attrs', 'children'};
    final consumedAttrs = <String>{};

    Map<String, dynamic> buildMetadata() {
      final extraTop = <String, dynamic>{};
      for (final entry in block.entries) {
        if (!consumedTop.contains(entry.key)) extraTop[entry.key] = entry.value;
      }
      final extraAttrs = <String, dynamic>{};
      for (final entry in attrs.entries) {
        if (!consumedAttrs.contains(entry.key))
          extraAttrs[entry.key] = entry.value;
      }
      if (extraTop.isNotEmpty) passthrough['extraTop'] = extraTop;
      if (extraAttrs.isNotEmpty) passthrough['extraAttrs'] = extraAttrs;
      if (passthrough.isEmpty) return <String, dynamic>{};
      return {kMynoteMetadataKey: passthrough};
    }

    switch (type) {
      case 'heading':
        consumedAttrs.add('level');
        if (!attrs.containsKey('level')) passthrough['levelAbsent'] = true;
        final level = attrs['level'] is num
            ? (attrs['level'] as num).toInt()
            : 2;
        return ParagraphNode(
          id: id,
          text: parseInlineMarks(text),
          metadata: {
            'blockType': _headerAttribution(level),
            ...buildMetadata(),
          },
        );
      case 'quote':
        return ParagraphNode(
          id: id,
          text: parseInlineMarks(text),
          metadata: {'blockType': blockquoteAttribution, ...buildMetadata()},
        );
      case 'todo':
        consumedAttrs.add('checked');
        if (!attrs.containsKey('checked')) passthrough['checkedAbsent'] = true;
        return TaskNode(
          id: id,
          text: parseInlineMarks(text),
          isComplete: attrs['checked'] == true,
          metadata: buildMetadata(),
        );
      case 'divider':
        return HorizontalRuleNode(id: id, metadata: buildMetadata());
      case 'paragraph':
        return ParagraphNode(
          id: id,
          text: parseInlineMarks(text),
          metadata: buildMetadata(),
        );
      default:
        if (_cardKinds.contains(type)) {
          consumedTop.addAll(['url', 'status', 'meta']);
          return CardNode(
            id: id,
            kind: type,
            url: block['url'] is String ? block['url'] as String : null,
            status: block['status'] is String
                ? block['status'] as String
                : null,
            meta: block['meta'] is Map
                ? deepCopyMap(block['meta'] as Map)
                : null,
            text: text.isEmpty ? null : text,
            metadata: buildMetadata(),
          );
        }
        if (_mediaKinds.contains(type)) {
          // media 的 attrs 整表进节点，不拆 consumedAttrs
          if (children.isNotEmpty) passthrough['hadChildren'] = true;
          consumedTop.addAll(['fileId', 'image']);
          consumedAttrs.addAll(attrs.keys);
          // fileId 两种历史位置：顶层（attachment）或 attrs（image 等）。
          // 来自 attrs 时记 passthrough，导出时不另加顶层键，保持往返无损。
          final mediaFileId = block['fileId'] is String
              ? block['fileId'] as String
              : (attrs['fileId'] is String ? attrs['fileId'] as String : null);
          if (block['fileId'] == null && attrs['fileId'] != null) {
            passthrough['fileIdInAttrs'] = true;
          }
          return MediaNode(
            id: id,
            kind: type,
            attrs: attrs,
            fileId: mediaFileId,
            imageFlag: block['image'] is bool ? block['image'] as bool : null,
            text: text,
            metadata: buildMetadata(),
          );
        }
        // 未知类型：降级为段落，原类型记入 passthrough
        passthrough['origType'] = type;
        return ParagraphNode(
          id: id,
          text: parseInlineMarks(text),
          metadata: buildMetadata(),
        );
    }
  }

  static String _childrenText(List<dynamic> children) {
    final buffer = StringBuffer();
    for (final child in children) {
      if (child is Map && child['text'] is String) {
        buffer.write(child['text'] as String);
      }
    }
    return buffer.toString();
  }

  static Attribution _headerAttribution(int level) {
    switch (level.clamp(1, 6)) {
      case 1:
        return header1Attribution;
      case 2:
        return header2Attribution;
      case 3:
        return header3Attribution;
      case 4:
        return header4Attribution;
      case 5:
        return header5Attribution;
      default:
        return header6Attribution;
    }
  }

  // ---------------------------------------------------------------- export

  static Map<String, dynamic> blockToJson(DocumentNode node) {
    final passthrough = node.metadata[kMynoteMetadataKey] is Map
        ? deepCopyMap(node.metadata[kMynoteMetadataKey] as Map)
        : <String, dynamic>{};
    final extraTop = passthrough['extraTop'] is Map
        ? deepCopyMap(passthrough['extraTop'] as Map)
        : <String, dynamic>{};
    final extraAttrs = passthrough['extraAttrs'] is Map
        ? deepCopyMap(passthrough['extraAttrs'] as Map)
        : <String, dynamic>{};
    final origChildren = passthrough['origChildren'] as List?;

    final out = <String, dynamic>{};
    if (passthrough['noId'] != true) out['id'] = node.id;

    List<dynamic> childrenFor(String text) {
      if (origChildren != null) {
        final origText = _childrenText(origChildren);
        if (origText == text)
          return deepCopyValue(origChildren) as List<dynamic>;
        // 文本改了：新文本 + 保留原首子项的嵌套 children（分栏数据不丢）
        final first = origChildren.isNotEmpty && origChildren.first is Map
            ? Map<dynamic, dynamic>.from(origChildren.first as Map)
            : <String, dynamic>{};
        final child = <String, dynamic>{'text': text};
        if (first['children'] is List)
          child['children'] = deepCopyValue(first['children']);
        return [child];
      }
      // Web 自身回写时恒为单子项（见 editor.render.js 的 doc.push），空文本亦然
      return [
        {'text': text},
      ];
    }

    void finish(
      String type, {
      Map<String, dynamic>? attrs,
      List<dynamic>? children,
    }) {
      out['type'] = type;
      final mergedAttrs = {...extraAttrs, ...?attrs};
      if (mergedAttrs.isNotEmpty) out['attrs'] = mergedAttrs;
      if (children != null && children.isNotEmpty) out['children'] = children;
      // extraTop 最后并入，但不覆盖已映射字段
      for (final entry in extraTop.entries) {
        out.putIfAbsent(entry.key, () => entry.value);
      }
    }

    if (node is CardNode) {
      out['type'] = node.kind;
      if (node.url != null) out['url'] = node.url;
      if (node.status != null) out['status'] = node.status;
      if (node.meta != null) out['meta'] = deepCopyMap(node.meta!);
      // embedCard 的文本即块内容，须写回 children（其余卡片沿用旧行为）
      if ((node.text?.isNotEmpty ?? false)) {
        out['children'] = childrenFor(node.text!);
      }
      final mergedAttrs = {...extraAttrs};
      if (mergedAttrs.isNotEmpty) out['attrs'] = mergedAttrs;
      for (final entry in extraTop.entries) {
        out.putIfAbsent(entry.key, () => entry.value);
      }
      return out;
    }

    if (node is MediaNode) {
      out['type'] = node.kind;
      final mergedAttrs = {...extraAttrs, ...deepCopyMap(node.attrs)};
      // L3：fileId 以运行时口径（effectiveFileId）为准同步落盘——
      // 原 attrs 位置的块只更新 attrs 镜像、顶层位置的块写顶层且
      // 同步可能残留的旧 attrs 镜像，杜绝旧 id 残留导致重开回退
      final fid = node.effectiveFileId;
      if (fid != null) {
        if (passthrough['fileIdInAttrs'] == true) {
          mergedAttrs['fileId'] = fid;
        } else {
          out['fileId'] = fid;
          if (mergedAttrs.containsKey('fileId')) mergedAttrs['fileId'] = fid;
        }
      }
      if (mergedAttrs.isNotEmpty) out['attrs'] = mergedAttrs;
      if (node.imageFlag != null) out['image'] = node.imageFlag;
      if (node.text.isNotEmpty || passthrough['hadChildren'] == true) {
        out['children'] = childrenFor(node.text);
      }
      for (final entry in extraTop.entries) {
        out.putIfAbsent(entry.key, () => entry.value);
      }
      return out;
    }

    if (node is TaskNode) {
      finish(
        'todo',
        attrs: passthrough['checkedAbsent'] == true
            ? null
            : {'checked': node.isComplete},
        children: childrenFor(serializeInlineMarks(node.text)),
      );
      return out;
    }

    if (node is HorizontalRuleNode) {
      finish('divider');
      return out;
    }

    if (node is ParagraphNode) {
      final blockType = node.getMetadataValue('blockType');
      final typeName = blockType is NamedAttribution ? blockType.id : null;
      final text = serializeInlineMarks(node.text);
      if (passthrough['origType'] is String) {
        finish(passthrough['origType'] as String, children: childrenFor(text));
        return out;
      }
      if (typeName != null && typeName.startsWith('header')) {
        final level = int.tryParse(typeName.substring(6)) ?? 2;
        finish(
          'heading',
          attrs: passthrough['levelAbsent'] == true ? null : {'level': level},
          children: childrenFor(text),
        );
        return out;
      }
      if (typeName == 'blockquote') {
        finish('quote', children: childrenFor(text));
        return out;
      }
      finish('paragraph', children: childrenFor(text));
      return out;
    }

    // 兜底：不认识的节点（不应发生）——尽力保 id 与空段落形态
    finish('paragraph', children: childrenFor(''));
    return out;
  }
}

/// 从 doc 块 JSON 提取纯文本（FTS 索引与列表摘要共用）：
/// 各块 children 文本 + 卡片标题/副标题，按块以空格连接。
String docPlainText(List<dynamic> docJson) {
  final parts = <String>[];
  for (final raw in docJson) {
    if (raw is! Map) continue;
    final children = raw['children'];
    if (children is List) {
      for (final child in children) {
        if (child is Map && child['text'] is String) {
          parts.add(child['text'] as String);
        }
      }
    }
    final meta = raw['meta'];
    if (meta is Map) {
      for (final key in const ['title', 'subtitle']) {
        if (meta[key] is String) parts.add(meta[key] as String);
      }
    }
  }
  return parts.join(' ');
}
