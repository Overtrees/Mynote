import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:super_editor/super_editor.dart';

import '../../app/providers.dart';
import '../../core/tokens.dart';
import '../../data/convert/doc_nodes.dart';
import '../../data/convert/inline_marks.dart';
import '../../core/diag.dart';
import '../../services/link_meta_service.dart';

/// 图片加载失败诊断（同一 URL 只记一次，防刷屏）
final Set<String> _imageErrorLogged = <String>{};
void _logImageError(String what) {
  if (_imageErrorLogged.add(what)) {
    Diag.warn('EDITOR', 'image load failed: $what');
  }
}

/// 卡片封面代理（原版 proxyImg）：经 Worker /img 代理，
/// QQ 音乐封面先把 300×300 提升到 800×800。
String proxyCoverUrl(String cover) {
  var url = cover;
  if (url.contains('y.gtimg.cn/music/photo_new/T002R')) {
    url = url.replaceAll(RegExp(r'T002R\d+x\d+'), 'T002R800x800');
  }
  return '$linkMetaApiBase/img?url=${Uri.encodeComponent(url)}';
}

/// 类型图标（原版 getTypeIcon）。
String typeIcon(String? type) {
  if (type == 'music') return '🎵';
  if (type == 'video') return '🎬';
  return '🔗';
}

String _domainOf(String url) {
  try {
    return Uri.parse(url).host.replaceFirst('www.', '');
  } catch (_) {
    return '';
  }
}

/// CardNode / MediaNode 的编辑器组件（Phase 1 版：渲染与选择，
/// 卡片解析回写、媒体交互在 Phase 2）。结构按 super_editor 0.3.0-dev.52
/// 的 HorizontalRule 组件范式。

const String _fb = 'NotoSansSC';

// ---------------------------------------------------------------- CardNode

class CardComponentViewModel extends SingleColumnLayoutComponentViewModel
    with SelectionAwareViewModelMixin {
  CardComponentViewModel({
    required super.nodeId,
    super.createdAt,
    super.maxWidth,
    super.padding = EdgeInsets.zero,
    super.opacity = 1.0,
    DocumentNodeSelection? selection,
    Color selectionColor = Colors.transparent,
    this.kind = 'musicCard',
    this.url,
    this.status,
    this.meta,
    this.text,
    this.justCreated = false,
  }) {
    super.selection = selection;
    super.selectionColor = selectionColor;
  }

  final String kind;
  final String? url;
  final String? status;
  final Map<String, dynamic>? meta;
  final String? text;
  final bool justCreated;

  @override
  CardComponentViewModel copy() => CardComponentViewModel(
    nodeId: nodeId,
    createdAt: createdAt,
    maxWidth: maxWidth,
    padding: padding,
    opacity: opacity,
    kind: kind,
    url: url,
    status: status,
    meta: meta,
    text: text,
    justCreated: justCreated,
    selection: selection,
    selectionColor: selectionColor,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CardComponentViewModel &&
          runtimeType == other.runtimeType &&
          nodeId == other.nodeId &&
          kind == other.kind &&
          url == other.url &&
          status == other.status &&
          selection == other.selection &&
          // meta 变化（如解析回填）必须触发重建
          _metaEquals(meta, other.meta);

  @override
  int get hashCode =>
      nodeId.hashCode ^
      kind.hashCode ^
      url.hashCode ^
      status.hashCode ^
      selection.hashCode ^
      (meta == null ? 0 : meta.toString().hashCode);
}

bool _metaEquals(Map<String, dynamic>? a, Map<String, dynamic>? b) {
  if (identical(a, b)) return true;
  if (a == null || b == null || a.length != b.length) return false;
  for (final key in a.keys) {
    if (a[key]?.toString() != b[key]?.toString()) return false;
  }
  return true;
}

/// 组件内分区点按回调（由 EditorPage 注册）：卡片「重试」按钮、
/// 图文块的图片区/文本区、图库的单张图——SE 的选区点按只能到节点级，
/// 细分区经此通道回传。
/// 当前被按压的卡片节点 id（编辑页指针按下时按布局命中设置），
/// 对应原版 .link-card:active { opacity: .7 } 的按压反馈。
final pressedCardIdProvider = StateProvider<String?>((ref) => null);

class NodeZoneTap {
  static void Function(String nodeId)? onCardRetry;
  static void Function(String nodeId, String zone, int index)? onMediaZone;
}

class CardComponentBuilder implements ComponentBuilder {
  const CardComponentBuilder();

  @override
  SingleColumnLayoutComponentViewModel? createViewModel(
    Document document,
    DocumentNode node,
  ) {
    if (node is! CardNode) return null;
    return CardComponentViewModel(
      nodeId: node.id,
      createdAt: node.metadata[NodeMetadata.createdAt],
      kind: node.kind,
      url: node.url,
      status: node.status,
      meta: node.meta,
      text: node.text,
      justCreated: node.justCreated,
    );
  }

  @override
  Widget? createComponent(
    SingleColumnDocumentComponentContext componentContext,
    SingleColumnLayoutComponentViewModel componentViewModel,
  ) {
    if (componentViewModel is! CardComponentViewModel) return null;
    return CardComponent(
      componentKey: componentContext.componentKey,
      nodeId: componentViewModel.nodeId,
      kind: componentViewModel.kind,
      url: componentViewModel.url,
      status: componentViewModel.status,
      meta: componentViewModel.meta,
      text: componentViewModel.text,
      justCreated: componentViewModel.justCreated,
      selection:
          componentViewModel.selection?.nodeSelection
              as UpstreamDownstreamNodeSelection?,
      selectionColor: componentViewModel.selectionColor,
      opacity: componentViewModel.opacity,
    );
  }
}

class CardComponent extends ConsumerWidget {
  const CardComponent({
    super.key,
    required this.componentKey,
    required this.nodeId,
    required this.kind,
    this.url,
    this.status,
    this.meta,
    this.text,
    this.justCreated = false,
    this.selection,
    this.selectionColor = Colors.transparent,
    this.opacity = 1.0,
  });

  final GlobalKey componentKey;
  final String nodeId;
  final String kind;
  final String? url;
  final String? status;
  final Map<String, dynamic>? meta;
  final String? text;
  final bool justCreated;
  final UpstreamDownstreamNodeSelection? selection;
  final Color selectionColor;
  final double opacity;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pressed =
        kind != 'embedCard' && ref.watch(pressedCardIdProvider) == nodeId;
    final body = AnimatedOpacity(
      opacity: pressed ? 0.7 : 1.0,
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOut,
      child: IgnorePointer(
        child: SelectableBox(
          selection: selection,
          selectionColor: selectionColor,
          child: BoxComponent(
            key: componentKey,
            opacity: opacity,
            child: _cardBody(),
          ),
        ),
      ),
    );
    // 原版卡片块纵向外距 8（embedCard 按段落渲染，无此距）
    if (kind == 'embedCard') return body;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: body,
    );
  }

  Widget _cardBody() {
    final m = meta;
    final st = status ?? 'empty';
    final hasMeta = m != null && ((m['title'] as String?)?.isNotEmpty ?? false);
    // embedCard 在 Web 端载入时即转为纯文本段落（editor.doc.js），
    // 这里按同样的视觉呈现：URL 纯文本。
    if (kind == 'embedCard') {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Text(
          text ?? url ?? '',
          style: TextStyle(
            fontSize: 16,
            height: 1.75,
            color: MynoteTokens.textMain,
            fontFamilyFallback: [_fb],
          ),
        ),
      );
    }
    // 输入态：玻璃胶囊（原版 input 状态为可编辑胶囊，点按后弹输入框）
    if (st == 'input') {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        decoration: BoxDecoration(
          color: MynoteTokens.glassControlBg,
          border: Border.all(
            color: MynoteTokens.glassControlBorder,
            width: 0.5,
          ),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          '粘贴音乐链接到这里...',
          style: TextStyle(
            fontSize: 14,
            color: MynoteTokens.textMain,
            fontFamilyFallback: [_fb],
          ),
        ),
      );
    }
    // 存储载入的 loading 卡按原版显示无 meta 兜底形（非骨架）；
    // 仅本会话新建/刚提交的卡在解析中显示骨架
    if (st == 'loading' && !hasMeta && justCreated) return _skeleton();
    // 空态（无 URL）：玻璃胶囊提示（仅音乐卡；链接卡走无 meta 兜底形）
    if (kind == 'musicCard' && (st == 'empty' || (url == null && m == null))) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: MynoteTokens.glassContentBg,
          border: Border.all(
            color: MynoteTokens.glassContentBorder,
            width: 0.5,
          ),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          children: [
            Text('🎵', style: TextStyle(fontSize: 14)),
            SizedBox(width: 10),
            Text(
              '点击粘贴音乐链接',
              style: TextStyle(
                fontSize: 14,
                color: MynoteTokens.textMain,
                fontFamilyFallback: [_fb],
              ),
            ),
          ],
        ),
      );
    }
    // 音乐卡错误态（无可用 meta 时）：🎵 + URL + 重试（重试只走按钮，点卡身打开链接）
    if (st == 'error' && kind == 'musicCard' && !hasMeta) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: MynoteTokens.glassContentBg,
          border: Border.all(
            color: MynoteTokens.glassContentBorder,
            width: 0.5,
          ),
          borderRadius: BorderRadius.circular(32),
        ),
        child: Row(
          children: [
            const Text('🎵', style: TextStyle(fontSize: 16)),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                url ?? '',
                style: TextStyle(
                  fontSize: 16,
                  color: MynoteTokens.textMain,
                  fontFamilyFallback: [_fb],
                ),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: () => NodeZoneTap.onCardRetry?.call(nodeId),
              child: Container(
                constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: MynoteTokens.fillHoverStrong,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '重试',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: MynoteTokens.accent,
                    fontFamilyFallback: [_fb],
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }
    // 音乐卡有 URL 但无 meta 的兜底：胶囊 + URL（原版 fallback 分支）
    if (kind == 'musicCard' && m == null && st != 'error') {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: MynoteTokens.glassContentBg,
          border: Border.all(
            color: MynoteTokens.glassContentBorder,
            width: 0.5,
          ),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          children: [
            const Text('🎵', style: TextStyle(fontSize: 14)),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                url ?? '',
                style: TextStyle(
                  fontSize: 14,
                  color: MynoteTokens.textMain,
                  fontFamilyFallback: [_fb],
                ),
              ),
            ),
          ],
        ),
      );
    }
    // 链接卡无 meta：标题=域名，来源行=🔗 + 完整 URL（有 meta 时以 meta 为准，
    // 与 status 无关——Web renderAtomicHTML 只看 meta.title）
    if (!hasMeta) {
      final domain = _domainOf(url ?? '');
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
        decoration: BoxDecoration(
          color: MynoteTokens.glassContentBg,
          border: Border.all(
            color: MynoteTokens.glassContentBorder,
            width: 0.5,
          ),
          borderRadius: BorderRadius.circular(32),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              domain.isEmpty ? (url ?? '') : domain,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 14,
                height: 1.4,
                fontWeight: FontWeight.w600,
                color: MynoteTokens.textMain,
                fontFamilyFallback: [_fb],
              ),
            ),
            const SizedBox(height: 4),
            _sourceRow('🔗', url ?? ''),
          ],
        ),
      );
    }
    final title = m['title'] as String? ?? '音乐';
    final subtitle = m['subtitle'] as String?;
    final source = m['source'] as String? ?? '';
    final cover = m['cover'] as String?;
    final isBilibili =
        source == '哔哩哔哩' ||
        (m['type'] == 'video' &&
            ((url ?? '').contains('bilibili') ||
                (url ?? '').contains('b23.tv')));
    final icon = kind == 'musicCard' ? '🎵' : typeIcon(m['type'] as String?);
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: MynoteTokens.glassContentBg,
        border: Border.all(color: MynoteTokens.glassContentBorder, width: 0.5),
        borderRadius: BorderRadius.circular(32),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (cover != null && cover.isNotEmpty)
            ClipRRect(
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(32),
              ),
              child: AspectRatio(
                aspectRatio: 2.4,
                child: Image.network(
                  proxyCoverUrl(cover),
                  cacheWidth: 1200,
                  fit: BoxFit.cover,
                  errorBuilder: (_, e, ___) {
                    _logImageError('card cover: $e');
                    return Container(color: MynoteTokens.border);
                  },
                ),
              ),
            ),
          Padding(
            padding: EdgeInsets.fromLTRB(
              14,
              (cover != null && cover.isNotEmpty) ? 6 : 10,
              14,
              12,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.4,
                    fontWeight: FontWeight.w600,
                    color: MynoteTokens.textMain,
                    fontFamilyFallback: [_fb],
                  ),
                ),
                if ((kind == 'musicCard' || !isBilibili) &&
                    subtitle != null &&
                    subtitle.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        height: 1.3,
                        color: MynoteTokens.textSecondary,
                        fontFamilyFallback: [_fb],
                      ),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: _sourceRow(
                    icon,
                    source.isNotEmpty
                        ? source
                        : (kind == 'musicCard' ? '音乐' : _domainOf(url ?? '')),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// 来源行：类型图标 + 圆点 + 来源文字（原版 lkc-source）。
  Widget _sourceRow(String icon, String text) {
    return Row(
      children: [
        Text(icon, style: const TextStyle(fontSize: 11)),
        const SizedBox(width: 5),
        Container(
          width: 3,
          height: 3,
          decoration: BoxDecoration(
            color: MynoteTokens.textSecondary.withValues(alpha: 0.4),
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 5),
        Expanded(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 11,
              color: MynoteTokens.textSecondary,
              fontFamilyFallback: [_fb],
            ),
          ),
        ),
      ],
    );
  }

  Widget _skeleton() {
    Widget line(double w) => FractionallySizedBox(
      widthFactor: w,
      child: Container(
        height: 12,
        decoration: BoxDecoration(
          color: MynoteTokens.skeleton,
          borderRadius: BorderRadius.circular(6),
        ),
      ),
    );
    // 原版：链接卡骨架两行（75%/50%），音乐卡三行（75%/50%/35%）
    final rows = kind == 'musicCard' ? [0.75, 0.50, 0.35] : [0.75, 0.50];
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: MynoteTokens.glassContentBg,
        border: Border.all(color: MynoteTokens.glassContentBorder, width: 0.5),
        borderRadius: BorderRadius.circular(32),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
            child: AspectRatio(
              aspectRatio: 2.4,
              child: Container(
                color: MynoteTokens.skeleton,
                child: Center(
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: MynoteTokens.glassLabel,
                      backgroundColor: MynoteTokens.glassContentBorder,
                    ),
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < rows.length; i++) ...[
                  if (i > 0) const SizedBox(height: 8),
                  line(rows[i]),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- MediaNode

class MediaComponentViewModel extends SingleColumnLayoutComponentViewModel
    with SelectionAwareViewModelMixin {
  MediaComponentViewModel({
    required super.nodeId,
    super.createdAt,
    super.maxWidth,
    super.padding = EdgeInsets.zero,
    super.opacity = 1.0,
    DocumentNodeSelection? selection,
    Color selectionColor = Colors.transparent,
    required this.node,
  }) {
    super.selection = selection;
    super.selectionColor = selectionColor;
  }

  final MediaNode node;

  @override
  MediaComponentViewModel copy() => MediaComponentViewModel(
    nodeId: nodeId,
    createdAt: createdAt,
    maxWidth: maxWidth,
    padding: padding,
    opacity: opacity,
    node: node,
    selection: selection,
    selectionColor: selectionColor,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MediaComponentViewModel &&
          runtimeType == other.runtimeType &&
          nodeId == other.nodeId &&
          node == other.node &&
          selection == other.selection;

  @override
  int get hashCode => nodeId.hashCode ^ node.hashCode ^ selection.hashCode;
}

class MediaComponentBuilder implements ComponentBuilder {
  const MediaComponentBuilder();

  @override
  SingleColumnLayoutComponentViewModel? createViewModel(
    Document document,
    DocumentNode node,
  ) {
    if (node is! MediaNode) return null;
    return MediaComponentViewModel(
      nodeId: node.id,
      createdAt: node.metadata[NodeMetadata.createdAt],
      node: node,
    );
  }

  @override
  Widget? createComponent(
    SingleColumnDocumentComponentContext componentContext,
    SingleColumnLayoutComponentViewModel componentViewModel,
  ) {
    if (componentViewModel is! MediaComponentViewModel) return null;
    return MediaComponent(
      componentKey: componentContext.componentKey,
      node: componentViewModel.node,
      selection:
          componentViewModel.selection?.nodeSelection
              as UpstreamDownstreamNodeSelection?,
      selectionColor: componentViewModel.selectionColor,
      opacity: componentViewModel.opacity,
    );
  }
}

class MediaComponent extends ConsumerWidget {
  const MediaComponent({
    super.key,
    required this.componentKey,
    required this.node,
    this.selection,
    this.selectionColor = Colors.transparent,
    this.opacity = 1.0,
  });

  final GlobalKey componentKey;
  final MediaNode node;
  final UpstreamDownstreamNodeSelection? selection;
  final Color selectionColor;
  final double opacity;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 附件文件行按压态（原版 .attachment-file:active opacity .6 / 150ms）
    var pressed = false;
    if (node.kind == 'attachment') {
      final meta = node.effectiveFileId == null
          ? null
          : ref.watch(attachmentMetaProvider(node.effectiveFileId!));
      final isImage =
          node.imageFlag == true ||
          (meta?.valueOrNull?.mime.startsWith('image/') ?? false);
      pressed = !isImage && ref.watch(pressedCardIdProvider) == node.id;
    }
    return AnimatedOpacity(
      opacity: pressed ? 0.6 : 1.0,
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOut,
      child: IgnorePointer(
        child: SelectableBox(
          selection: selection,
          selectionColor: selectionColor,
          child: BoxComponent(
            key: componentKey,
            opacity: opacity,
            child: _body(ref),
          ),
        ),
      ),
    );
  }

  /// 单张图片：http src 直载；fileId 从附件存储读字节（OPFS/文件）。
  Widget _imageWidget(
    WidgetRef ref, {
    String? src,
    String? fileId,
    BorderRadius? radius,
    BoxFit fit = BoxFit.cover,
    double? maxHeight,
  }) {
    Widget wrap(Widget img) {
      Widget w = ClipRRect(
        borderRadius: radius ?? BorderRadius.circular(22),
        child: img,
      );
      if (maxHeight != null) {
        w = ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxHeight),
          child: Center(child: w),
        );
      }
      return w;
    }

    if (src != null && src.startsWith('http')) {
      // 原版编辑器图片无淡入（淡入仅列表 LazyImage）
      return wrap(
        Image.network(
          src,
          fit: fit,
          width: double.infinity,
          errorBuilder: (_, e, ___) {
            _logImageError('image block: $e');
            return _imageStatePlaceholder();
          },
        ),
      );
    }
    if (fileId == null || fileId.isEmpty) return _placeholder('图片不可用');
    final bytes = ref.watch(attachmentBytesProvider(fileId));
    return bytes.when(
      loading: () => wrap(_imageStatePlaceholder()),
      error: (_, __) => wrap(_imageStatePlaceholder()),
      data: (data) => data == null
          ? wrap(_imageStatePlaceholder())
          : wrap(Image.memory(data, fit: fit, width: double.infinity)),
    );
  }

  /// 图片块加载/失败占位（原版与空图占位同形）：高 566、卡片底、
  /// 0.5 边、圆角 22，仅 📷 图标无文字。
  Widget _imageStatePlaceholder() {
    return Container(
      width: double.infinity,
      height: 566,
      decoration: BoxDecoration(
        color: MynoteTokens.cardBg,
        border: Border.all(color: MynoteTokens.border, width: 0.5),
        borderRadius: BorderRadius.circular(22),
      ),
      child: const Center(
        child: Opacity(
          opacity: 0.5,
          child: Text('📷', style: TextStyle(fontSize: 18)),
        ),
      ),
    );
  }

  Widget _body(WidgetRef ref) {
    Widget inner = _bodyInner(ref);
    // 原版 editor-shell.css：image/gallery 原子块左右各 36px 边距
    if (node.kind == 'image' || node.kind == 'gallery') {
      inner = Padding(
        padding: const EdgeInsets.symmetric(horizontal: 36),
        child: inner,
      );
    }
    // 原版原子块纵向外距 8（图片成品另有 img 自身 margin 8，叠加与原版一致）
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: inner,
    );
  }

  Widget _bodyInner(WidgetRef ref) {
    switch (node.kind) {
      case 'image':
        final src = node.attrs['src'] as String?;
        final fid = node.effectiveFileId;
        if ((src == null || src.isEmpty) && (fid == null || fid.isEmpty)) {
          // 空图片占位（原版：高 566 的卡片框 + 📷 点击添加图片）
          return Container(
            width: double.infinity,
            height: 566,
            decoration: BoxDecoration(
              color: MynoteTokens.cardBg,
              border: Border.all(color: MynoteTokens.border, width: 0.5),
              borderRadius: BorderRadius.circular(22),
            ),
            child: Center(
              child: Text(
                '📷 点击添加图片',
                style: TextStyle(
                  fontSize: 13,
                  color: MynoteTokens.placeholder,
                  fontFamilyFallback: [_fb],
                ),
              ),
            ),
          );
        }
        // 原版：max-height 668、contain、居中
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: _imageWidget(
            ref,
            src: src,
            fileId: fid,
            fit: BoxFit.contain,
            maxHeight: 668,
          ),
        );
      case 'gallery':
        final items = (node.attrs['items'] as List?) ?? const [];
        if (items.isEmpty) {
          // 空图集占位：两格 366 高（原版）
          return Padding(
            padding: const EdgeInsets.fromLTRB(0, 6, 0, 14),
            child: Row(
              children: [
                Expanded(
                  child: _galleryPlaceholder(
                    '🖼',
                    '点击添加',
                    0.4,
                    MynoteTokens.fillSubtle,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: _galleryPlaceholder(
                    '🖼',
                    '多张图片',
                    0.3,
                    MynoteTokens.fillSubtle2,
                  ),
                ),
              ],
            ),
          );
        }
        // 原版：2 列网格、格高 366、圆角 22、间距 4
        final rows = <Widget>[];
        for (var i = 0; i < items.length; i += 2) {
          final pair = items.sublist(
            i,
            i + 2 > items.length ? items.length : i + 2,
          );
          rows.add(
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var j = 0; j < pair.length; j++) ...[
                  if (j > 0) const SizedBox(width: 4),
                  Expanded(
                    child: GestureDetector(
                      onTap: () => NodeZoneTap.onMediaZone?.call(
                        node.id,
                        'gallery',
                        i + j,
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(22),
                        child: SizedBox(
                          height: 366,
                          child: _galleryCell(ref, pair[j]),
                        ),
                      ),
                    ),
                  ),
                ],
                if (pair.length == 1) ...[
                  const SizedBox(width: 4),
                  const Expanded(child: SizedBox(height: 366)),
                ],
              ],
            ),
          );
          if (i + 2 < items.length) rows.add(const SizedBox(height: 4));
        }
        return Column(children: rows);
      case 'imgTextCard':
        final fid = node.effectiveFileId;
        final hasImg = fid != null && fid.isNotEmpty;
        return Container(
          width: double.infinity,
          decoration: BoxDecoration(
            color: MynoteTokens.glassContentBg,
            border: Border.all(
              color: MynoteTokens.glassContentBorder,
              width: 0.5,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              GestureDetector(
                onTap: () => NodeZoneTap.onMediaZone?.call(node.id, 'image', 0),
                child: hasImg
                    ? _imageWidget(
                        ref,
                        fileId: fid,
                        radius: const BorderRadius.vertical(
                          top: Radius.circular(22),
                        ),
                        fit: BoxFit.cover,
                        maxHeight: 468,
                      )
                    : Container(
                        width: double.infinity,
                        height: 160,
                        color: MynoteTokens.fillSubtle,
                        child: Center(
                          child: Text(
                            '📷 点击添加图片',
                            style: TextStyle(
                              fontSize: 13,
                              color: MynoteTokens.placeholder,
                              fontFamilyFallback: [_fb],
                            ),
                          ),
                        ),
                      ),
              ),
              GestureDetector(
                onTap: () => NodeZoneTap.onMediaZone?.call(node.id, 'text', 0),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  child: Text(
                    node.text.isEmpty ? '点击查看完整文本' : node.text,
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.7,
                      color: node.text.isEmpty
                          ? MynoteTokens.placeholder
                          : MynoteTokens.textMain,
                      fontFamilyFallback: const [_fb],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      case 'imageTextRow':
        return Container(
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: 181, maxHeight: 196),
          decoration: BoxDecoration(
            color: MynoteTokens.glassContentBg,
            border: Border.all(
              color: MynoteTokens.glassContentBorder,
              width: 0.5,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: GestureDetector(
                  onTap: () =>
                      NodeZoneTap.onMediaZone?.call(node.id, 'image', 0),
                  child: ClipRRect(
                    borderRadius: const BorderRadius.horizontal(
                      left: Radius.circular(22),
                    ),
                    child:
                        (node.effectiveFileId != null &&
                            node.effectiveFileId!.isNotEmpty)
                        ? _imageWidget(
                            ref,
                            fileId: node.effectiveFileId,
                            radius: BorderRadius.zero,
                          )
                        : Container(
                            color: MynoteTokens.fillSubtle,
                            child: const Center(
                              child: Opacity(
                                opacity: 0.3,
                                child: Text(
                                  '📷',
                                  style: TextStyle(fontSize: 24),
                                ),
                              ),
                            ),
                          ),
                  ),
                ),
              ),
              // 原版图文行图与文之间有 10px 间隔（两侧各让出 (W-10)/2）
              const SizedBox(width: 10),
              Expanded(
                child: GestureDetector(
                  onTap: () =>
                      NodeZoneTap.onMediaZone?.call(node.id, 'text', 0),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    child: Text(
                      node.text.isEmpty ? '点击查看完整文本' : node.text,
                      maxLines: 6,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.7,
                        color: node.text.isEmpty
                            ? MynoteTokens.placeholder
                            : MynoteTokens.textMain,
                        fontFamilyFallback: const [_fb],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      case 'attachment':
        final meta = node.effectiveFileId == null
            ? null
            : ref.watch(attachmentMetaProvider(node.effectiveFileId!));
        // 图片判定：image 标记优先，缺失时按文件 MIME 兜底（原版口径）
        final isImage =
            node.imageFlag == true ||
            (meta?.valueOrNull?.mime.startsWith('image/') ?? false);
        if (isImage) {
          // 图片附件按图片渲染（原版圆角 32）
          return _imageWidget(
            ref,
            fileId: node.effectiveFileId,
            radius: BorderRadius.circular(32),
          );
        }
        final name = meta?.valueOrNull?.name ?? '';
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          decoration: BoxDecoration(
            color: MynoteTokens.glassContentBg,
            border: Border.all(
              color: MynoteTokens.glassContentBorder,
              width: 0.5,
            ),
            borderRadius: BorderRadius.circular(32),
          ),
          child: Row(
            children: [
              const Text('📎', style: TextStyle(fontSize: 24)),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  name.isEmpty ? '附件' : name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: MynoteTokens.textMain,
                    fontFamilyFallback: [_fb],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: MynoteTokens.fillHoverStrong,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '点击打开',
                  style: TextStyle(
                    fontSize: 11,
                    color: MynoteTokens.textSecondary,
                    fontFamilyFallback: [_fb],
                  ),
                ),
              ),
            ],
          ),
        );
      default:
        return _placeholder(node.kind);
    }
  }

  Widget _galleryPlaceholder(
    String icon,
    String label,
    double opacity,
    Color bg,
  ) {
    return Container(
      height: 366,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Opacity(
            opacity: opacity,
            child: Text(icon, style: const TextStyle(fontSize: 18)),
          ),
          const SizedBox(height: 4),
          Opacity(
            opacity: opacity + 0.1,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 11,
                color: MynoteTokens.placeholder,
                fontFamilyFallback: [_fb],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _galleryCell(WidgetRef ref, dynamic item) {
    if (item is String) {
      if (item.startsWith('http')) {
        return Image.network(
          item,
          fit: BoxFit.cover,
          width: double.infinity,
          height: double.infinity,
          errorBuilder: (_, e, ___) {
            _logImageError('media image: $e');
            return Container(color: MynoteTokens.imagePlaceholder);
          },
        );
      }
      return _galleryFileImage(ref, item);
    }
    if (item is Map) {
      return _galleryFileImage(
        ref,
        item['fileId']?.toString(),
        url: item['url']?.toString(),
      );
    }
    return Container(color: MynoteTokens.imagePlaceholder);
  }

  Widget _galleryFileImage(WidgetRef ref, String? fileId, {String? url}) {
    if (url != null && url.startsWith('http')) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        cacheWidth: 900,
        errorBuilder: (_, e, ___) {
          _logImageError('gallery image: $e');
          return Container(color: MynoteTokens.imagePlaceholder);
        },
      );
    }
    if (fileId == null || fileId.isEmpty)
      return Container(color: MynoteTokens.imagePlaceholder);
    final bytes = ref.watch(attachmentBytesProvider(fileId));
    return bytes.when(
      loading: () => Container(color: MynoteTokens.imagePlaceholder),
      error: (_, __) => Container(color: MynoteTokens.imagePlaceholder),
      data: (data) => data == null
          ? Container(color: MynoteTokens.imagePlaceholder)
          : Image.memory(
              data,
              fit: BoxFit.cover,
              width: double.infinity,
              height: double.infinity,
            ),
    );
  }

  Widget _placeholder(String label) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 28),
      decoration: BoxDecoration(
        color: MynoteTokens.imagePlaceholder,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Center(
        child: Text(
          label,
          style: const TextStyle(
            fontSize: 13,
            color: Color(0xFF8E8E93),
            fontFamilyFallback: [_fb],
          ),
        ),
      ),
    );
  }
}

/// 分割线组件（原版规格）：高 1px、横向渐变（透明 → --border-color →
/// 透明）、上下外距各 16。SE 默认是实色灰 Divider，与原版差异明显。
class MynoteHorizontalRuleComponentBuilder implements ComponentBuilder {
  const MynoteHorizontalRuleComponentBuilder();

  static const _delegate = HorizontalRuleComponentBuilder();

  @override
  SingleColumnLayoutComponentViewModel? createViewModel(
    Document document,
    DocumentNode node,
  ) => _delegate.createViewModel(document, node);

  @override
  Widget? createComponent(
    SingleColumnDocumentComponentContext componentContext,
    SingleColumnLayoutComponentViewModel componentViewModel,
  ) {
    if (componentViewModel is! HorizontalRuleComponentViewModel) return null;
    final vm = componentViewModel;
    return IgnorePointer(
      child: SelectableBox(
        selection:
            vm.selection?.nodeSelection as UpstreamDownstreamNodeSelection?,
        selectionColor: vm.selectionColor,
        child: BoxComponent(
          key: componentContext.componentKey,
          opacity: vm.opacity,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Container(
              height: 1,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Colors.transparent,
                    MynoteTokens.border,
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 引用块组件（原版规格）：底色 rgba(0,0,0,0.025)、左 3px
/// rgba(0,91,187,0.62) + 其余三边 1px 边、圆角 10、内距 10/14。
/// ViewModel 复用 SE 默认构建器，仅替换渲染层补盒装饰。
class MynoteBlockquoteComponentBuilder implements ComponentBuilder {
  const MynoteBlockquoteComponentBuilder();

  static const _delegate = BlockquoteComponentBuilder();

  @override
  SingleColumnLayoutComponentViewModel? createViewModel(
    Document document,
    DocumentNode node,
  ) => _delegate.createViewModel(document, node);

  @override
  Widget? createComponent(
    SingleColumnDocumentComponentContext componentContext,
    SingleColumnLayoutComponentViewModel componentViewModel,
  ) {
    if (componentViewModel is! BlockquoteComponentViewModel) return null;
    final vm = componentViewModel;
    // 边框四边不同色与 borderRadius 不能同用一个 BoxDecoration
    // （Flutter 断言：borderRadius 只允许均匀色边框）——外框用均匀
    // 1px 边 + 圆角，左侧 3px 强调条单独叠一层。
    return IgnorePointer(
      child: Container(
        decoration: BoxDecoration(
          color: MynoteTokens.quoteBg,
          border: Border.all(color: MynoteTokens.border, width: 1),
          borderRadius: const BorderRadius.all(Radius.circular(10)),
        ),
        child: Stack(
          children: [
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              child: ColoredBox(color: MynoteTokens.quoteBorder),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: TextComponent(
                key: componentContext.componentKey,
                text: vm.text,
                textStyleBuilder: vm.textStyleBuilder,
                inlineWidgetBuilders: vm.inlineWidgetBuilders,
                textSelection: vm.selection,
                selectionColor: vm.selectionColor,
                highlightWhenEmpty: vm.highlightWhenEmpty,
                underlines: vm.createUnderlines(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 待办组件（原版规格）：44px 命中区内 22px 圆环复选框，未选为
/// 1.5px 半透明描边，选中填充 #0066CC + 白色对勾；完成文本置灰加
/// 删除线。ViewModel 复用 SE 的 TaskComponentBuilder，仅替换渲染。
class MynoteTaskComponentBuilder implements ComponentBuilder {
  MynoteTaskComponentBuilder(Editor editor)
    : _delegate = TaskComponentBuilder(editor);

  final TaskComponentBuilder _delegate;

  @override
  SingleColumnLayoutComponentViewModel? createViewModel(
    Document document,
    DocumentNode node,
  ) => _delegate.createViewModel(document, node);

  @override
  Widget? createComponent(
    SingleColumnDocumentComponentContext componentContext,
    SingleColumnLayoutComponentViewModel componentViewModel,
  ) {
    if (componentViewModel is! TaskComponentViewModel) return null;
    return _MynoteTaskComponent(
      key: componentContext.componentKey,
      viewModel: componentViewModel,
    );
  }
}

class _MynoteTaskComponent extends StatefulWidget {
  const _MynoteTaskComponent({super.key, required this.viewModel});

  final TaskComponentViewModel viewModel;

  @override
  State<_MynoteTaskComponent> createState() => _MynoteTaskComponentState();
}

class _MynoteTaskComponentState extends State<_MynoteTaskComponent>
    with ProxyDocumentComponent<_MynoteTaskComponent>, ProxyTextComposable {
  final _textKey = GlobalKey();
  bool _pressed = false;

  @override
  GlobalKey<State<StatefulWidget>> get childDocumentComponentKey => _textKey;

  @override
  TextComposable get childTextComposable =>
      childDocumentComponentKey.currentState as TextComposable;

  TextStyle _computeStyles(Set<Attribution> attributions) {
    final style = widget.viewModel.textStyleBuilder(attributions);
    if (!widget.viewModel.isComplete) return style;
    return style.copyWith(
      color: MynoteTokens.textMuted,
      decoration: style.decoration == null
          ? TextDecoration.lineThrough
          : TextDecoration.combine([
              TextDecoration.lineThrough,
              style.decoration!,
            ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final vm = widget.viewModel;
    // 原版行盒：padding 4px 8px、圆角 10、:active 底 fill-hover-strong（150ms）。
    // ⚠️ 底色必须用 hitTest=false 的 CustomPainter 画：实测任何会在命中
    // 测试中自命中（hitTestSelf=true）的绘制盒（DecoratedBox/ColoredBox/
    // 默认 CustomPaint）覆盖在文本区上方时，SE 的点按→光标映射会失效
    // （点待办文本选不中光标；二分定位结论，回归测试 task_tap_test）。
    return Listener(
      onPointerDown: (_) {
        if (!_pressed) setState(() => _pressed = true);
      },
      onPointerUp: (_) {
        if (_pressed) setState(() => _pressed = false);
      },
      onPointerCancel: (_) {
        if (_pressed) setState(() => _pressed = false);
      },
      child: TweenAnimationBuilder<double>(
        tween: Tween(end: _pressed ? 1 : 0),
        duration: const Duration(milliseconds: 150),
        builder: (context, t, child) => CustomPaint(
          painter: _TaskPressBgPainter(MynoteTokens.fillHoverStrong, t),
          child: child,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Directionality(
            textDirection: vm.textDirection,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: vm.indentCalculator(
                    vm.textStyleBuilder({}),
                    vm.indent,
                  ),
                ),
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => vm.setComplete?.call(!vm.isComplete),
                  child: SizedBox(
                    width: 44,
                    height: 44,
                    child: Center(
                      child: Container(
                        width: 22,
                        height: 22,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: vm.isComplete
                              ? MynoteTokens.checkboxChecked
                              : Colors.transparent,
                          border: vm.isComplete
                              ? null
                              : Border.all(
                                  color: MynoteTokens.checkboxBorder,
                                  width: 1.75,
                                ),
                        ),
                        child: vm.isComplete
                            ? const Icon(
                                Icons.check,
                                size: 14,
                                color: Colors.white,
                              )
                            : null,
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: TextComponent(
                      key: _textKey,
                      text: vm.text,
                      textDirection: vm.textDirection,
                      textAlign: vm.textAlignment,
                      maxLines: vm.maxLines,
                      overflow: vm.overflow,
                      textStyleBuilder: _computeStyles,
                      inlineWidgetBuilders: vm.inlineWidgetBuilders,
                      textSelection: vm.selection,
                      selectionColor: vm.selectionColor,
                      highlightWhenEmpty: vm.highlightWhenEmpty,
                      underlines: vm.createUnderlines(),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 待办行按压底色画笔：圆角 10 的 fillHoverStrong，透明度随按压补间；
/// hitTest 恒 false（见 _MynoteTaskComponentState 的注释，地雷勿踩）。
class _TaskPressBgPainter extends CustomPainter {
  const _TaskPressBgPainter(this.color, this.t);
  final Color color;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    if (t <= 0) return;
    final paint = Paint()..color = color.withValues(alpha: color.a * t);
    canvas.drawRRect(
      RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(10)),
      paint,
    );
  }

  @override
  bool? hitTest(Offset position) => false;

  @override
  bool shouldRepaint(_TaskPressBgPainter oldDelegate) =>
      oldDelegate.t != t || oldDelegate.color != color;
}

/// Callout 检测（原版 MD 语义标注块）：段首 `> [!TYPE]`。
/// Callout 类型识别（原版 editor.md.js:138-141）：任意 \w+ 类型词，
/// 经别名表映射到五种样式，未知类型落 note 样式。此前只认五种规范名，
/// [!INFO]/[!DANGER] 等别名不成盒。
const _calloutStyleAliases = <String, String>{
  'note': 'note',
  'info': 'note',
  'todo': 'note',
  'abstract': 'note',
  'quote': 'note',
  'tip': 'tip',
  'success': 'tip',
  'example': 'tip',
  'question': 'warning',
  'warning': 'warning',
  'important': 'important',
  'failure': 'important',
  'bug': 'important',
  'caution': 'caution',
  'danger': 'caution',
};

String? calloutTypeOf(String plainText) {
  final m = RegExp(
    r'^\s{0,3}>\s*\[!(\w+)\]',
    caseSensitive: false,
  ).firstMatch(plainText);
  if (m == null) return null;
  final raw = m.group(1)!.toLowerCase();
  return _calloutStyleAliases[raw] ?? 'note';
}

/// 代码围栏段检测：以 ``` 开头。
bool isCodeFenceText(String plainText) => plainText.startsWith('```');

/// Callout 底色（tokens.css --md-callout-*-bg，浅/深两组）。
Color calloutBg(String type) {
  if (MynoteTokens.dark) {
    return switch (type) {
      'warning' => const Color(0x29FF9F0A),
      'tip' => const Color(0x2930D158),
      'important' => const Color(0x2BBF5AF2),
      'caution' => const Color(0x29FF453A),
      _ => const Color(0x2E0A84FF),
    };
  }
  return switch (type) {
    'warning' => const Color(0x17FF9500),
    'tip' => const Color(0x1734C759),
    'important' => const Color(0x14AF52DE),
    'caution' => const Color(0x12E0433A),
    _ => const Color(0x12007AFF),
  };
}

/// 段落组件：Callout / 代码围栏段落加盒装饰（圆角 12、1px 边、类型底色）。
/// SE 文本按位置 1:1 映射，标记行无法隐藏——这是该路线下的最大还原；
/// 其余段落直用 SE 原生 ParagraphComponent。
class MynoteParagraphComponentBuilder implements ComponentBuilder {
  const MynoteParagraphComponentBuilder();

  static const _delegate = ParagraphComponentBuilder();

  /// H1 节点登记：createComponent 只拿到 ViewModel（不带 blockType），
  /// 故在 createViewModel 阶段按节点 id 记录，供渲染时补原版底边线。
  static final Set<String> _header1Ids = <String>{};

  /// 脚注定义段登记（首行是 [^label]: 定义行）；_footnoteDefStartIds
  /// 为脚注区首段（前一段不是定义段），渲染时补原版上分隔线。
  static final Set<String> _footnoteDefIds = <String>{};
  static final Set<String> _footnoteDefStartIds = <String>{};

  static bool _isFootnoteDef(DocumentNode node) {
    if (node is! ParagraphNode) return false;
    final plain = node.text.toPlainText();
    final firstLine = plain.split('\n').first;
    return footnoteDefLabelOfLine(firstLine) != null;
  }

  @override
  SingleColumnLayoutComponentViewModel? createViewModel(
    Document document,
    DocumentNode node,
  ) {
    final bt = node.getMetadataValue('blockType');
    if (bt is NamedAttribution && bt.id == 'header1') {
      _header1Ids.add(node.id);
    } else {
      _header1Ids.remove(node.id);
    }
    if (_isFootnoteDef(node)) {
      _footnoteDefIds.add(node.id);
      final prev = document.getNodeBefore(node);
      if (prev == null || !_isFootnoteDef(prev)) {
        _footnoteDefStartIds.add(node.id);
      } else {
        _footnoteDefStartIds.remove(node.id);
      }
    } else {
      _footnoteDefIds.remove(node.id);
      _footnoteDefStartIds.remove(node.id);
    }
    return _delegate.createViewModel(document, node);
  }

  @override
  Widget? createComponent(
    SingleColumnDocumentComponentContext componentContext,
    SingleColumnLayoutComponentViewModel componentViewModel,
  ) {
    if (componentViewModel is! ParagraphComponentViewModel) return null;
    final vm = componentViewModel;
    final plain = vm.text.toPlainText();
    final callout = calloutTypeOf(plain);
    final fence = callout == null && isCodeFenceText(plain);
    final inner = ParagraphComponent(
      key: componentContext.componentKey,
      viewModel: vm,
    );
    // H1：原版 padding-bottom 7px + 1px 底边线（整行分隔线）
    if (_header1Ids.contains(vm.nodeId)) {
      return Container(
        padding: const EdgeInsets.only(bottom: 7),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: MynoteTokens.border, width: 1),
          ),
        ),
        child: inner,
      );
    }
    // 脚注定义段：脚注区首段补 1px 上分隔线 + 间距（原版脚注分节形态；
    // 定义原文 [^label]: 保留可见以便编辑，与原版隐藏标记不同，已记录）
    if (_footnoteDefIds.contains(vm.nodeId)) {
      final isStart = _footnoteDefStartIds.contains(vm.nodeId);
      return Container(
        padding: EdgeInsets.only(top: isStart ? 12 : 2, bottom: 2),
        decoration: isStart
            ? BoxDecoration(
                border: Border(
                  top: BorderSide(color: MynoteTokens.border, width: 1),
                ),
              )
            : null,
        child: inner,
      );
    }
    if (callout == null && !fence) return inner;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: callout != null ? calloutBg(callout) : MynoteTokens.codeBg,
        border: Border.all(color: MynoteTokens.border, width: 1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: inner,
    );
  }
}

/// 反链分节的布局常量（编辑页点按几何与此保持一致）：
/// 顶距 18 + 标题行 20 + 标题下距 6 = 表头 44；每行高 44。
const double backlinksHeaderHeight = 44;
const double backlinksRowHeight = 44;

class BacklinksComponentViewModel extends SingleColumnLayoutComponentViewModel
    with SelectionAwareViewModelMixin {
  BacklinksComponentViewModel({
    required super.nodeId,
    super.createdAt,
    super.maxWidth,
    super.padding = EdgeInsets.zero,
    super.opacity = 1.0,
    DocumentNodeSelection? selection,
    Color selectionColor = Colors.transparent,
    this.sources = const [],
  }) {
    super.selection = selection;
    super.selectionColor = selectionColor;
  }

  final List<BacklinkSource> sources;

  @override
  BacklinksComponentViewModel copy() => BacklinksComponentViewModel(
    nodeId: nodeId,
    createdAt: createdAt,
    maxWidth: maxWidth,
    padding: padding,
    opacity: opacity,
    selection: selection,
    selectionColor: selectionColor,
    sources: sources,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is BacklinksComponentViewModel &&
          runtimeType == other.runtimeType &&
          nodeId == other.nodeId &&
          selection == other.selection &&
          _sourcesEqual(other.sources, sources);

  @override
  int get hashCode => Object.hash(nodeId, selection, Object.hashAll(sources));
}

bool _sourcesEqual(List<BacklinkSource> a, List<BacklinkSource> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

/// 反向链接分节组件（原版正文后原位分节：上 1px 分隔、标题
/// 12/w600 次级色、行高 44 链接色）。点按由编辑页按几何分发
/// （与卡片同机制），组件内 IgnorePointer。
class BacklinksComponentBuilder implements ComponentBuilder {
  const BacklinksComponentBuilder();

  @override
  SingleColumnLayoutComponentViewModel? createViewModel(
    Document document,
    DocumentNode node,
  ) {
    if (node is! BacklinksNode) return null;
    return BacklinksComponentViewModel(
      nodeId: node.id,
      createdAt: node.metadata[NodeMetadata.createdAt],
      sources: node.sources,
    );
  }

  @override
  Widget? createComponent(
    SingleColumnDocumentComponentContext componentContext,
    SingleColumnLayoutComponentViewModel componentViewModel,
  ) {
    if (componentViewModel is! BacklinksComponentViewModel) return null;
    final vm = componentViewModel;
    return IgnorePointer(
      child: SelectableBox(
        selection:
            vm.selection?.nodeSelection as UpstreamDownstreamNodeSelection?,
        selectionColor: vm.selectionColor,
        child: BoxComponent(
          key: componentContext.componentKey,
          opacity: vm.opacity,
          child: Container(
            padding: const EdgeInsets.only(top: 18),
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(color: MynoteTokens.border, width: 1),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 20,
                  child: Text(
                    '反向链接',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: MynoteTokens.textSecondary,
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                for (final source in vm.sources)
                  SizedBox(
                    height: backlinksRowHeight,
                    child: Row(
                      children: [
                        Text(
                          '↗',
                          style: TextStyle(
                            fontSize: 14,
                            color: MynoteTokens.textSecondary,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            source.title.isEmpty ? '无标题' : source.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 16,
                              color: MynoteTokens.link,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
