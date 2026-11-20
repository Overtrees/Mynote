import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:drift/drift.dart' show Value;
import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart'
    show HardwareKeyboard, KeyEvent, KeyDownEvent, LogicalKeyboardKey;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:super_editor/super_editor.dart';

import '../../app/providers.dart';
import '../../core/body_scroll.dart';
import '../../core/diag.dart';
import '../../core/chrome_sync.dart';
import '../../core/scroll_fade.dart';
import '../../core/sheet_route.dart';
import '../../core/dino_avatar.dart';
import '../../core/page_route.dart';
import '../../core/prefs_store.dart';
import '../list/memo_grouping.dart';
import '../../data/convert/doc_converter.dart';
import '../../data/convert/inline_marks.dart';
import '../../data/convert/wiki_links.dart';
import 'column_layout.dart';
import '../../data/db/database.dart';
import '../../core/tokens.dart';
import '../../core/top_veil.dart';
import 'block_components.dart';
import 'mynote_stylesheet.dart';

import '../../../data/convert/doc_nodes.dart';
import '../../../data/export/export_service.dart';
import '../../../data/export/html_export.dart';
import '../../../data/export/markdown_export.dart';
import '../backup_ui/download_bytes.dart';
import '../backup_ui/open_url.dart';
import '../backup_ui/print_html.dart';
import 'bg_sheet.dart';
import 'backlinks_sync.dart';
import 'block_drag.dart';
import 'newline_after_block.dart';
import 'image_text_sheet.dart';
import '../../services/link_meta_service.dart';
import 'paste/paste_bridge.dart';
import 'paste/paste_insert.dart';
import 'paste/paste_policy.dart';
import 'slash/slash_apply.dart';
import 'slash/slash_commands.dart';
import 'slash/slash_icons.dart';
import 'slash/slash_trigger.dart';

class EditorPage extends ConsumerStatefulWidget {
  const EditorPage({super.key, required this.memoId, this.isNew = false});

  final String memoId;

  /// 刚新建的笔记：原版语义——关闭时若毫无改动则直接删除、不落库。
  final bool isNew;

  @override
  ConsumerState<EditorPage> createState() => _EditorPageState();
}

class _EditorPageState extends ConsumerState<EditorPage>
    with WidgetsBindingObserver {
  Memo? _memo;
  MutableDocument? _document;
  MutableDocumentComposer? _composer;
  Editor? _editor;
  final FocusNode _editorFocusNode = FocusNode();
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _docLayoutKey = GlobalKey();
  final TextEditingController _titleController = TextEditingController();
  bool _dirty = false;

  /// 变更代次：每次编辑 +1。_save 以此判断保存期间是否有新编辑，
  /// 防止旧保存清掉新编辑的脏标记（保存竞态丢尾部编辑）。
  int _editGen = 0;
  bool _loadError = false;

  /// PopScope 放行标志：所有退出路径收口到 _goBack 后置 true 再 pop
  bool _allowPop = false;

  void _popSelf() {
    if (!mounted) return;
    setState(() => _allowPop = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop();
    });
  }

  static const _imeDebug = bool.fromEnvironment('IME_DEBUG');
  bool _showImeLog = false;
  Uint8List? _avatarBytes;
  String _subtitle = '';

  /// 副标题独立通知：字数/时间变化只重建标题胶囊，不再整页 setState
  final ValueNotifier<String> _subtitleNotifier = ValueNotifier<String>('');
  Timer? _subtitleTimer;
  bool _subtitlePending = false;

  /// 笔记背景色（Web memo.bgColor，十六进制字符串如 #eaeef2）
  String? _bgColor;
  String _initialTitle = '';
  Timer? _autosaveTimer;
  Timer? _draftTimer;
  bool _restoredDraft = false;

  /// 媒体/卡片点按动作的触发判定：选区变为节点选区且刚发生过指针按下
  DateTime? _lastPointerDown;
  String? _lastActedNodeId;

  /// 选区快照：非折叠选区时持续更新，供斜杠行内命令包裹原文（原版语义）
  ({String nodeId, int start, int end, String text})? _selectionSnapshot;
  SlashToken? _slashToken;
  List<SlashFilterItem> _slashItems = const [];
  final List<String> _recentSlashIds = [];

  /// 斜杠面板选中行（原版 selectedIndex：键盘 ↑↓/回车与悬停同步）
  int _slashSelected = 0;

  /// 斜杠面板入场动画种子：每次打开递增，驱动 140ms 入场
  int _slashAnimSeed = 0;

  /// 斜杠链接命令的面板内表单态（原版：面板内切换为链接表单）
  bool _slashLinkForm = false;
  SlashFilterItem? _slashLinkPending;
  final FocusNode _slashLinkFocusNode = FocusNode();
  final TextEditingController _slashLinkController = TextEditingController(
    text: 'https://',
  );
  String _slashLinkError = '';

  /// 标题输入焦点（原版：编辑态显示全文、失焦显示截断标题）
  final FocusNode _titleFocusNode = FocusNode();
  bool _titleFocused = false;
  double? _titleTapLocalX;

  /// 标题长/溢出模式的编辑态单向闩（原版 editingStyleSnapshot：
  /// 编辑期间只升不降，防跨阈值来回切换造成光标跳动；失焦复位）
  bool _titleLongLatch = false;
  bool _titleOverflowLatch = false;

  /// 编辑器内玻璃 toast（原版编辑器无 SnackBar；规格同备份页 toast）
  String? _editorToast;
  Timer? _editorToastTimer;

  /// 用户是否真正编辑过（原版 hasTyped 闩锁）：加载后的程序化变更
  /// （卡片补拉）不算；决定空新建笔记是否删除。
  bool _hasTyped = false;
  bool _suppressTyped = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scrollController.addListener(() {
      // 标题坞滚动形态（原版 editorScrolled：scrollY>30 变横排）；
      // 编辑标题期间不响应（原版同款防护：形态切换会重建标题
      // 输入框、打断焦点与 IME 会话）
      if (_titleFocusNode.hasFocus) return;
      final s = _scrollController.hasClients && _scrollController.offset > 30;
      if (s != _editorScrolled && mounted) setState(() => _editorScrolled = s);
    });
    _scrollController.addListener(_syncFlowScrollA);
    _scrollB.addListener(_syncFlowScrollB);
    // slash 面板打开期间滚动跟随（原版监听 scroll + rAF 重定位）：
    // 锚点在 build 时由 _slashAnchor 现算，滚动时触发重建即可
    void slashFollow() {
      if ((_slashToken != null || _cardEditId != null) && mounted) {
        setState(() {});
      }
    }

    _scrollController.addListener(slashFollow);
    _scrollB.addListener(slashFollow);
    // v3（Web 嵌入）：dock 形态、slash/卡内编辑跟随改由 body 滚动驱动
    bodyScrollY.addListener(_onBodyScroll);
    hostInsets.addListener(_onHostInsets);
    // 斜杠最近使用（原版 localStorage memos_slash_recent_v1，上限 6）
    try {
      final raw = prefsGet('memos_slash_recent_v1');
      if (raw != null && raw.isNotEmpty) {
        _recentSlashIds.addAll(
          (jsonDecode(raw) as List).map((e) => e.toString()),
        );
      }
    } catch (_) {}
    _editorFocusNode.addListener(() {
      if (_editorFocusNode.hasFocus) _activeB = false;
      if (mounted) setState(() {});
    });
    _titleFocusNode.addListener(() {
      final f = _titleFocusNode.hasFocus;
      if (!f) {
        _titleLongLatch = false;
        _titleOverflowLatch = false;
        // 失焦后按当前滚动位置重估 dock 形态（编辑期间被防护冻结）
        final scrolled =
            (bodyScrollSupported
                ? bodyScrollY.value
                : (_scrollController.hasClients
                      ? _scrollController.offset
                      : 0)) >
            30;
        if (scrolled != _editorScrolled && mounted) {
          setState(() => _editorScrolled = scrolled);
        }
        // 失焦提交（原版 commitTitleFromDOM）：trim 后回写，胶囊立即显示净值
        final trimmed = _titleController.text.trim();
        if (trimmed != _titleController.text) {
          _titleController.text = trimmed;
        }
      }
      if (f != _titleFocused && mounted) setState(() => _titleFocused = f);
    });
    _cardEditFocus.addListener(() {
      if (!_cardEditFocus.hasFocus && _cardEditId != null && !_disposing) {
        _commitCardUrlEdit();
      }
    });
    _focusB.addListener(() {
      if (_focusB.hasFocus) _activeB = true;
      if (mounted) setState(() {});
    });
    // 斜杠面板键盘导航走硬件键盘处理器（先于编辑器焦点链，
    // 对齐原版 window 级 keydown 捕获）
    HardwareKeyboard.instance.addHandler(_slashKeyHandler);
    HardwareKeyboard.instance.addHandler(_editorShortcutHandler);
    listenForPaste(_handleWebPaste);
    // 组件内分区点按（重试按钮/图文分区/图库单张）
    NodeZoneTap.onCardRetry = (nodeId) {
      final n = _document?.getNodeById(nodeId);
      if (n is CardNode) _retryCard(n);
    };
    NodeZoneTap.onMediaZone = _handleMediaZone;
    _load().catchError((Object e) {
      Diag.error('EDITOR', 'load failed memo=${widget.memoId}: $e');
      if (mounted) setState(() => _loadError = true);
    });
  }

  String? _zoneActedNodeId;
  DateTime? _zoneActedAt;
  bool _editorScrolled = false;

  /// v3：自然高编辑列的测高 key（单栏/双栏共用，一次只挂一个分支）
  final GlobalKey _editorColKey = GlobalKey();
  double _lastReportedEditorH = -1;

  void _onHostInsets() {
    if (mounted) setState(() {});
  }

  Duration? _lastPanelRelayoutStamp;

  void _onBodyScroll() {
    if ((_slashToken != null || _cardEditId != null) && mounted) {
      // 面板随滚动重定位：按帧合并——同一帧窗口内多次滚动回调
      // （scroll 事件 + rAF 泵补发）只整页重排一次，避免惯性滚动
      // 期间逐回调重建（2026-11-20 手感优化）。时间戳与平移变换
      // 同帧变化，不引入额外延迟。
      final stamp = SchedulerBinding.instance.currentFrameTimeStamp;
      if (stamp != _lastPanelRelayoutStamp) {
        _lastPanelRelayoutStamp = stamp;
        setState(() {});
      }
    }
    if (_titleFocusNode.hasFocus) return;
    final scrolled = bodyScrollY.value > 30;
    if (scrolled != _editorScrolled && mounted) {
      setState(() => _editorScrolled = scrolled);
    }
  }

  // 双栏 layout（extraJson.layout 归一化结果）与独立滚动开关
  Map<String, dynamic>? _layout;
  bool _independentColumns = false;
  int _layoutBoundary = 0;

  /// L1：左栏成员的块 id 集（加载时记录）。单栏编辑增删块后，
  /// 保存切分点按「最后一个左栏原成员的位置」重算，不再用加载
  /// 时的旧块数硬切（旧计数会把原右栏块静默划进左栏）。
  Set<String> _layoutLeftIds = {};

  // 双栏第二栏（_document/_composer/_editor 恒为第一栏/单栏）
  MutableDocument? _docB;
  MutableDocumentComposer? _composerB;
  Editor? _editorB;
  final FocusNode _focusB = FocusNode();
  final ScrollController _scrollB = ScrollController();
  final GlobalKey _docLayoutKeyB = GlobalKey();
  bool _twoPane = false;
  bool? _lastColumnsAllowed;
  bool _activeB = false;

  /// flow 双栏的滚动同步重入闩（两栏 jumpTo 互触发时防回弹）
  bool _syncingFlowScroll = false;

  MutableDocument? get _activeDocument =>
      _activeB && _docB != null ? _docB : _document;
  MutableDocumentComposer? get _activeComposer =>
      _activeB && _composerB != null ? _composerB : _composer;
  Editor? get _activeEditor =>
      _activeB && _editorB != null ? _editorB : _editor;

  MutableDocument? _docContaining(String nodeId) {
    if (_document?.getNodeById(nodeId) != null) return _document;
    if (_docB?.getNodeById(nodeId) != null) return _docB;
    return null;
  }

  /// 当前完整文档 JSON（双栏时左栏 ++ 右栏拼接）。
  List<dynamic> _mergedDocJson() {
    final a = _document != null
        ? DocConverter.toJson(_document!)
        : const <dynamic>[];
    if (!_twoPane || _docB == null) return a;
    return [...a, ...DocConverter.toJson(_docB!)];
  }

  // 三指手势撤销/重做（原版：三指左滑撤销、右滑重做）
  final Map<int, Offset> _activePointers = {};
  double? _threeFingerStartX;
  bool _threeFingerFired = false;

  Offset? _lastPointerGlobal;
  DateTime? _pressSetAt;
  Timer? _pressClearTimer;

  // —— 块拖拽排序（原子块长按 500ms 进入拖拽）——
  Timer? _dragArmTimer;
  int? _dragPointer;
  String? _dragNodeId;
  MutableDocument? _dragDoc;
  Offset? _dragStart;
  double? _dragY;
  bool _dragging = false;

  /// S3 拖拽落点反馈：被拖块的全局矩形（盖半透明底色模拟原版
  /// 被拖块 opacity .4）与落点线纵坐标（原版 3px accent 指示线）。
  Rect? _dragSourceRect;
  double? _dragTargetY;

  void _onPointerDown(PointerDownEvent e) {
    _lastPointerDown = DateTime.now();
    _lastPointerGlobal = e.position;
    _resolvePressedCard(e.position);
    _armBlockDrag(e);
    _activePointers[e.pointer] = e.position;
    if (_activePointers.length == 3) {
      _threeFingerStartX =
          _activePointers.values.map((p) => p.dx).reduce((a, b) => a + b) / 3;
      _threeFingerFired = false;
    }
  }

  void _onPointerMove(PointerMoveEvent e) {
    if (e.pointer == _dragPointer && _dragNodeId != null) {
      if (_dragging) {
        _dragY = e.position.dy;
        _updateDragIndicator();
        if (mounted) setState(() {});
      } else if (_dragStart != null &&
          (e.position - _dragStart!).distance > 14) {
        _disarmBlockDrag();
      }
    }
    if (!_activePointers.containsKey(e.pointer)) return;
    _activePointers[e.pointer] = e.position;
    final startX = _threeFingerStartX;
    if (startX == null || _threeFingerFired || _activePointers.length != 3)
      return;
    final avgX =
        _activePointers.values.map((p) => p.dx).reduce((a, b) => a + b) / 3;
    final dx = avgX - startX;
    if (dx < -48) {
      _threeFingerFired = true;
      _activeEditor?.undo();
      _markDirty();
      _scheduleAutosave();
      Diag.log('EDITOR', 'three-finger swipe undo');
    } else if (dx > 48) {
      _threeFingerFired = true;
      _activeEditor?.redo();
      _markDirty();
      _scheduleAutosave();
      Diag.log('EDITOR', 'three-finger swipe redo');
    }
  }

  // —— 卡内 URL 原地编辑（原版音乐卡/链接卡点空态 → 卡内变输入胶囊）——
  String? _cardEditId;
  final TextEditingController _cardEditController = TextEditingController();
  final FocusNode _cardEditFocus = FocusNode();

  /// 长按原子块（卡片/媒体/分割线）进入拖拽排序；文本块不参与
  /// （长按是文本选择）。反链分节恒在末尾，不可拖也不可越过。
  void _armBlockDrag(PointerDownEvent e) {
    if (_dragNodeId != null) return;
    for (final key in [_docLayoutKey, _docLayoutKeyB]) {
      final state = key.currentState;
      if (state == null) continue;
      try {
        final layout = state as DocumentLayout;
        final docOffset = layout.getDocumentOffsetFromAncestorOffset(
          e.position,
        );
        final pos = layout.getDocumentPositionAtOffset(docOffset);
        final nodeId = pos?.nodeId;
        if (nodeId == null) continue;
        final doc = _docContaining(nodeId);
        final node = doc?.getNodeById(nodeId);
        final draggable =
            (node is CardNode && node.kind != 'embedCard') ||
            node is MediaNode ||
            node is HorizontalRuleNode;
        if (!draggable || doc == null) return;
        _dragPointer = e.pointer;
        _dragNodeId = nodeId;
        _dragDoc = doc;
        _dragStart = e.position;
        _dragArmTimer?.cancel();
        _dragArmTimer = Timer(const Duration(milliseconds: 500), () {
          if (!mounted || _dragNodeId != nodeId) return;
          _dragging = true;
          _dragY = _dragStart?.dy;
          Diag.log('EDITOR', 'drag start $nodeId');
          _updateDragIndicator();
          if (mounted) setState(() {});
        });
        return;
      } catch (err) {
        Diag.log('EDITOR', 'drag arm error: $err');
        continue;
      }
    }
  }

  /// S3：按当前指针位置算被拖块矩形与落点线位置（与 _finishBlockDrag
  /// 同一目标下标口径，保证指示线就是松手后的落点）。
  void _updateDragIndicator() {
    final doc = _dragDoc;
    final nodeId = _dragNodeId;
    if (doc == null || nodeId == null || _dragY == null) return;
    final key = identical(doc, _docB) ? _docLayoutKeyB : _docLayoutKey;
    final state = key.currentState;
    if (state == null) return;
    try {
      final layout = state as DocumentLayout;
      final nodes = List<DocumentNode>.of(doc);
      final currentIndex = nodes.indexWhere((n) => n.id == nodeId);
      if (currentIndex < 0) return;
      final rects = <Rect?>[];
      for (final n in nodes) {
        final comp = layout.getComponentByNodeId(n.id);
        final box = comp?.context.findRenderObject() as RenderBox?;
        if (box == null || !box.hasSize) {
          rects.add(null);
        } else {
          rects.add(box.localToGlobal(Offset.zero) & box.size);
        }
      }
      _dragSourceRect = rects[currentIndex];
      final centers = [
        for (final r in rects) r == null ? double.infinity : r.center.dy,
      ];
      var maxIndex = nodes.length - 1;
      final backlinksIdx = nodes.indexWhere(
        (n) => n.id == BacklinksNode.kBacklinksNodeId,
      );
      if (backlinksIdx >= 0) {
        maxIndex = backlinksIdx > currentIndex
            ? backlinksIdx - 1
            : backlinksIdx;
      }
      final target = computeDragTargetIndex(
        centers: centers,
        currentIndex: currentIndex,
        pointerY: _dragY!,
        maxIndex: maxIndex,
      );
      final rest = <Rect>[
        for (var i = 0; i < rects.length; i++)
          if (i != currentIndex && rects[i] != null) rects[i]!,
      ];
      if (rest.isEmpty) {
        _dragTargetY = null;
        return;
      }
      final t = target.clamp(0, rest.length);
      _dragTargetY = t <= 0
          ? rest.first.top - 2
          : t >= rest.length
          ? rest.last.bottom + 2
          : (rest[t - 1].bottom + rest[t].top) / 2;
    } catch (_) {
      // 布局未就绪时无反馈即可，不影响拖拽本身
    }
  }

  void _disarmBlockDrag() {
    _dragArmTimer?.cancel();
    _dragArmTimer = null;
    _dragPointer = null;
    _dragNodeId = null;
    _dragDoc = null;
    _dragStart = null;
  }

  void _finishBlockDrag(double pointerY) {
    final doc = _dragDoc;
    final nodeId = _dragNodeId;
    if (doc == null || nodeId == null) return;
    final key = identical(doc, _docB) ? _docLayoutKeyB : _docLayoutKey;
    final state = key.currentState;
    if (state == null) return;
    final layout = state as DocumentLayout;
    final nodes = List<DocumentNode>.of(doc);
    final currentIndex = nodes.indexWhere((n) => n.id == nodeId);
    if (currentIndex < 0) return;
    final centers = <double>[];
    for (final n in nodes) {
      final comp = layout.getComponentByNodeId(n.id);
      final box = comp?.context.findRenderObject() as RenderBox?;
      if (box == null || !box.hasSize) {
        centers.add(double.infinity);
      } else {
        final top = box.localToGlobal(Offset.zero).dy;
        centers.add(top + box.size.height / 2);
      }
    }
    // 上限：文档末尾（移除后坐标）；有反链节点时不得越到其后
    var maxIndex = nodes.length - 1;
    final backlinksIdx = nodes.indexWhere(
      (n) => n.id == BacklinksNode.kBacklinksNodeId,
    );
    if (backlinksIdx >= 0) {
      maxIndex = backlinksIdx > currentIndex ? backlinksIdx - 1 : backlinksIdx;
    }
    final target = computeDragTargetIndex(
      centers: centers,
      currentIndex: currentIndex,
      pointerY: pointerY,
      maxIndex: maxIndex,
    );
    Diag.log('EDITOR', 'drag finish $nodeId $currentIndex->$target');
    if (target == currentIndex) return;
    final editor = identical(doc, _docB) ? _editorB : _editor;
    editor?.execute([MoveNodeRequest(nodeId: nodeId, newIndex: target)]);
    _markDirty();
    _scheduleAutosave();
  }

  /// 指针按下时按布局命中卡片/附件节点，驱动按压透明反馈
  /// （原版 .link-card:active opacity .7，150ms 过渡；附件行同理 .6）。
  /// 坐标转换走布局状态自身的 getDocumentOffsetFromAncestorOffset
  /// （其 boxContext 才是滚动内容的渲染盒；currentContext 的
  /// findRenderObject 会拿到外层盒、纵坐标不含滚动偏移）。
  /// 命中后再用节点矩形复核，避免双栏时另一栏的钳制误命中。
  void _resolvePressedCard(Offset global) {
    for (final key in [_docLayoutKey, _docLayoutKeyB]) {
      final state = key.currentState;
      if (state == null) continue;
      try {
        final layout = state as DocumentLayout;
        final docOffset = layout.getDocumentOffsetFromAncestorOffset(global);
        final pos = layout.getDocumentPositionAtOffset(docOffset);
        final nodeId = pos?.nodeId;
        if (nodeId == null) continue;
        final rect = layout.getRectForPosition(pos!);
        if (rect != null && !rect.inflate(2).contains(docOffset)) continue;
        final node = _docContaining(nodeId)?.getNodeById(nodeId);
        if ((node is CardNode && node.kind != 'embedCard') ||
            (node is MediaNode && node.kind == 'attachment')) {
          _pressClearTimer?.cancel();
          _pressSetAt = DateTime.now();
          ref.read(pressedCardIdProvider.notifier).state = nodeId;
          Diag.log('EDITOR', 'card press set $nodeId');
        }
      } catch (e) {
        Diag.log('EDITOR', 'press resolve failed: $e');
      }
      return;
    }
  }

  void _onPointerEnd(PointerEvent e) {
    if (e.pointer == _dragPointer) {
      if (_dragging) _finishBlockDrag(e.position.dy);
      _disarmBlockDrag();
      if (_dragging) {
        _dragging = false;
        _dragY = null;
        _dragSourceRect = null;
        _dragTargetY = null;
        if (mounted) setState(() {});
      }
    }
    if (ref.read(pressedCardIdProvider) != null) {
      // 最短展示 90ms：快速点按时按压态不至于一闪而过，抬手回弹更跟手
      final setAt = _pressSetAt;
      final elapsed = setAt == null
          ? const Duration(milliseconds: 999)
          : DateTime.now().difference(setAt);
      const minShow = Duration(milliseconds: 90);
      if (elapsed >= minShow) {
        ref.read(pressedCardIdProvider.notifier).state = null;
      } else {
        _pressClearTimer?.cancel();
        _pressClearTimer = Timer(minShow - elapsed, () {
          if (mounted) ref.read(pressedCardIdProvider.notifier).state = null;
        });
      }
    }
    _activePointers.remove(e.pointer);
    if (_activePointers.length < 3) _threeFingerStartX = null;
  }

  /// 图文/图库的分区点按（原版语义）：图片区→灯箱/选图，文本区→全文面板，
  /// 图库→被点的那一张。选区点按随后触发时按此记录跳过，避免双重动作。
  void _handleMediaZone(String nodeId, String zone, int index) {
    final document = _docContaining(nodeId) ?? _document;
    if (document == null || !mounted) return;
    final node = document.getNodeById(nodeId);
    if (node is! MediaNode) return;
    _zoneActedNodeId = nodeId;
    _zoneActedAt = DateTime.now();
    if (node.kind == 'imgTextCard' || node.kind == 'imageTextRow') {
      final fid = node.effectiveFileId;
      if (zone == 'text') {
        _openImageTextSheetFor(node);
      } else if (fid == null || fid.isEmpty) {
        _pickImageForNode(node);
      } else {
        _openLightbox(fileId: fid, src: '');
      }
      return;
    }
    if (node.kind == 'gallery' && zone == 'gallery') {
      final items = (node.attrs['items'] as List?) ?? const [];
      if (index < 0 || index >= items.length) return;
      final item = items[index];
      final fid = item is Map
          ? item['fileId']?.toString()
          : (item is String && !item.startsWith('http') ? item : null);
      final url = item is Map
          ? item['url']?.toString()
          : (item is String && item.startsWith('http') ? item : null);
      _openLightbox(fileId: fid, src: url ?? '');
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // 切后台/页面隐藏时立即落盘（原版 pagehide flush）
    if ((state == AppLifecycleState.paused ||
            state == AppLifecycleState.hidden ||
            state == AppLifecycleState.detached) &&
        _dirty) {
      _save();
    }
  }

  /// 字数直接遍历 SE 文档节点（口径与 exportCharCount 一致：仅无
  /// blockType 的段落节点、去 \n），避免每键一次全文档 JSON 序列化。
  int _paragraphCharCount() {
    var count = 0;
    void scan(MutableDocument? doc) {
      if (doc == null) return;
      for (final node in doc) {
        if (node is ParagraphNode &&
            node.getMetadataValue('blockType') == null) {
          count += node.text.text.replaceAll('\n', '').length;
        }
      }
    }

    scan(_document);
    if (_twoPane) scan(_docB);
    return count;
  }

  String _computeSubtitle() {
    final memo = _memo;
    if (_document == null || memo == null) return '';
    final count = _paragraphCharCount();
    final when = listTimeAgo(
      DateTime.fromMillisecondsSinceEpoch(memo.updatedAt),
      DateTime.now(),
    );
    return '$when · $count字';
  }

  /// 副标题刷新节流 250ms：键入时最多每 250ms 重算一次，且只通知胶囊。
  void _refreshSubtitle() {
    if (_subtitleTimer != null) {
      _subtitlePending = true;
      return;
    }
    _applySubtitle();
    _subtitleTimer = Timer(const Duration(milliseconds: 250), () {
      _subtitleTimer = null;
      if (_subtitlePending && mounted) {
        _subtitlePending = false;
        _applySubtitle();
      }
    });
  }

  void _applySubtitle() {
    final next = _computeSubtitle();
    _subtitle = next;
    _subtitleNotifier.value = next;
  }

  Future<void> _changeAvatar() async {
    const typeGroup = XTypeGroup(
      label: '图片',
      extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
    );
    final file = await openFile(acceptedTypeGroups: [typeGroup]);
    if (file == null) return;
    try {
      final bytes = await file.readAsBytes();
      final store = await ref.read(attachmentStoreProvider.future);
      await store.write('avatar_${widget.memoId}', bytes);
      final db = ref.read(databaseProvider);
      final ext = file.name.split('.').last.toLowerCase();
      final mime = ext == 'jpg' || ext == 'jpeg'
          ? 'image/jpeg'
          : ext == 'webp'
          ? 'image/webp'
          : ext == 'gif'
          ? 'image/gif'
          : 'image/png';
      await db
          .into(db.avatars)
          .insertOnConflictUpdate(
            AvatarsCompanion.insert(
              id: widget.memoId,
              localPath: 'avatar_${widget.memoId}',
              mime: Value(mime),
            ),
          );
      if (mounted) setState(() => _avatarBytes = bytes);
      Diag.log('EDITOR', 'avatar updated (${bytes.length}B)');
    } catch (e) {
      Diag.error('EDITOR', e);
    }
  }

  Widget _glassFab(IconData icon, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: ClipOval(
        child: BackdropFilter(
          filter: MynoteTokens.controlFilter,
          child: Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: MynoteTokens.glassControlBg,
              shape: BoxShape.circle,
              border: Border.all(
                color: MynoteTokens.glassControlBorder,
                width: 0.5,
              ),
            ),
            child: Icon(icon, size: 22, color: MynoteTokens.textMain),
          ),
        ),
      ),
    );
  }

  /// 标题胶囊宽度（原版 width:auto + minWidth 66）：内容实测 +
  /// 横向内距（短标题 20×2、长标题 18×2），上限为两 fab 之间宽度。
  /// 显示标题与原版一致：非编辑态超 10 字截断加省略号。
  double _capsuleWidth() {
    final raw = _titleController.text;
    final maxW0 = MediaQuery.of(context).size.width - 124;
    // 编辑态超 11 字：原版固定宽 184（左对齐、单行滚动跟随）
    if (_titleFocused && _titleOverflowLatch) return 184.0.clamp(66, maxW0);
    final display = _titleFocused
        ? raw
        : (raw.length > 10 ? '${raw.substring(0, 10)}…' : raw);
    final isLong = display.length > 5 || (_titleFocused && _titleLongLatch);
    final titleStyle = TextStyle(
      fontSize: isLong ? 11 : 14,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.2,
    );
    double measure(String text, TextStyle style) {
      final tp = TextPainter(
        text: TextSpan(text: text, style: style),
        textDirection: TextDirection.ltr,
        maxLines: 1,
      )..layout();
      // 逐字估算下限：宽字（CJK/全角）1em、窄字 0.56em——字体回退时
      // TextPainter 会低估 CJK 宽度，取大者防胶囊裁字。
      var est = 0.0;
      final fs = style.fontSize ?? 14;
      for (final ch in text.runes) {
        final wide = ch >= 0x2E80 || (ch >= 0xFF00 && ch <= 0xFF60);
        est += wide ? fs : fs * 0.56;
      }
      if (style.letterSpacing != null)
        est += style.letterSpacing! * text.length;
      return tp.width > est ? tp.width : est;
    }

    final titleW = measure(display, titleStyle);
    final metaW = measure(_subtitle, const TextStyle(fontSize: 10));
    // +2 余量：防实测宽与渲染宽临界相等时的意外折行
    final w = (titleW > metaW ? titleW : metaW) + (isLong ? 36 : 40) + 2;
    final maxW = MediaQuery.of(context).size.width - 124;
    return w.clamp(66, maxW);
  }

  /// 标题胶囊：两态恒高 66、圆角 33、宽度贴合内容（原版规格）；
  /// 滚动态仅隐藏副标题行（坞改横排由外层处理）。
  /// 失焦显示截断标题文本、聚焦切换为全文输入框（原版 display 交换）；
  /// 宽度变化走 200ms 过渡（原版 transition width .2s）。
  Widget _titleCapsule({required bool scrolled}) {
    // 副标题变化只重建胶囊本体，不牵动整页 build
    return ValueListenableBuilder<String>(
      valueListenable: _subtitleNotifier,
      builder: (context, _, _) => _titleCapsuleInner(scrolled: scrolled),
    );
  }

  Widget _titleCapsuleInner({required bool scrolled}) {
    final raw = _titleController.text;
    final isLong = raw.length > 5 || (_titleFocused && _titleLongLatch);
    final overflowEdit = _titleFocused && _titleOverflowLatch;
    final display = raw.length > 10 ? '${raw.substring(0, 10)}…' : raw;
    final titleStyle = TextStyle(
      fontSize: isLong ? 11 : 14,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.2,
      height: 1.3,
      color: MynoteTokens.textMain,
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(33),
      child: BackdropFilter(
        filter: MynoteTokens.controlFilter,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.ease,
          height: 66,
          width: _capsuleWidth(),
          padding: EdgeInsets.symmetric(horizontal: isLong ? 18 : 20),
          decoration: BoxDecoration(
            color: MynoteTokens.glassControlBg,
            border: Border.all(
              color: MynoteTokens.glassControlBorder,
              width: 0.5,
            ),
            borderRadius: BorderRadius.circular(33),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (_titleFocused)
                TextField(
                  controller: _titleController,
                  focusNode: _titleFocusNode,
                  textAlign: overflowEdit ? TextAlign.left : TextAlign.center,
                  decoration: InputDecoration(
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                    hintText: _imeDebug ? '无标题 · 诊断版' : '无标题',
                  ),
                  style: titleStyle,
                  onSubmitted: (_) => _titleFocusNode.unfocus(),
                  onChanged: (v) {
                    if (v.length > 5) _titleLongLatch = true;
                    if (v.length > 11) _titleOverflowLatch = true;
                    _markDirty();
                    setState(() {});
                    _scheduleAutosave();
                  },
                )
              else
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTapDown: (details) {
                    // 点按横坐标（相对标题文本盒）：未截断时光标落点按此换算
                    _titleTapLocalX = details.localPosition.dx;
                  },
                  onTap: () {
                    setState(() => _titleFocused = true);
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (!mounted) return;
                      _titleFocusNode.requestFocus();
                      final text = _titleController.text;
                      // 原版：仅当此前显示的是截断版（>10 字）才把光标
                      // 移到末尾；未截断时光标落在点按位置
                      if (text.length > 10) {
                        _titleController.selection = TextSelection.collapsed(
                          offset: text.length,
                        );
                      } else if (_titleTapLocalX != null && text.isNotEmpty) {
                        final painter = TextPainter(
                          text: TextSpan(text: text, style: titleStyle),
                          textDirection: TextDirection.ltr,
                          maxLines: 1,
                        )..layout();
                        final pos = painter.getPositionForOffset(
                          Offset(_titleTapLocalX!, 0),
                        );
                        _titleController.selection = TextSelection.collapsed(
                          offset: pos.offset.clamp(0, text.length),
                        );
                      }
                    });
                  },
                  child: Text(
                    raw.isEmpty ? '无标题' : display,
                    maxLines: isLong ? 2 : 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: raw.isEmpty
                        ? titleStyle.copyWith(color: MynoteTokens.placeholder)
                        : titleStyle,
                  ),
                ),
              AnimatedSize(
                duration: const Duration(milliseconds: 250),
                curve: Curves.ease,
                child: scrolled
                    ? const SizedBox.shrink()
                    : Column(
                        children: [
                          const SizedBox(height: 3),
                          Text(
                            _subtitle,
                            maxLines: 1,
                            softWrap: false,
                            style: TextStyle(
                              fontSize: 10,
                              color: MynoteTokens.textSecondary,
                            ),
                          ),
                        ],
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// 原版 FAB 下拉面板：全屏透明 backdrop（点按关闭）+ 右上锚定玻璃面板
  /// （right 16、top = 安全区 + 7 + 46 + 6、宽 246、radius 22、内距 7、
  /// 开合 180/220ms spring 缩放）。••• 菜单与导出面板共用。
  Future<void> _showAnchoredPanel(
    Widget Function(BuildContext) builder, {
    double closeScale = 0.92,
  }) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierColor: Colors.transparent,
      barrierLabel: '关闭面板',
      transitionDuration: const Duration(milliseconds: 220),
      transitionBuilder: (context, animation, secondaryAnimation, child) {
        final curved = CurvedAnimation(
          parent: animation,
          curve: Curves.easeOutBack,
        );
        // 原版：opacity 180ms / transform 220ms cubic-bezier(.34,1.56,.64,1)，
        // 另带 translateY −10→0，变换原点约 (85%, 面板顶上方)
        final fade = CurvedAnimation(
          parent: animation,
          curve: const Interval(0, 0.82, curve: Curves.ease),
        );
        return Opacity(
          opacity: fade.value.clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(0, -10 * (1 - curved.value)),
            child: Transform.scale(
              scale: closeScale + (1 - closeScale) * curved.value,
              alignment: const Alignment(0.7, -1.0),
              child: child,
            ),
          ),
        );
      },
      pageBuilder: (dialogContext, animation, secondaryAnimation) {
        final top =
            effectiveInsets(
              MediaQuery.of(dialogContext).padding,
              hostInsets.value,
            ).top +
            59;
        return Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => Navigator.pop(dialogContext),
              ),
            ),
            Positioned(
              top: top,
              right: 16,
              width: 246,
              child: Material(
                color: Colors.transparent,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(22),
                  child: BackdropFilter(
                    filter: MynoteTokens.overlayFilter,
                    child: Container(
                      decoration: BoxDecoration(
                        color: MynoteTokens.glassOverlayBg,
                        border: Border.all(
                          color: MynoteTokens.glassOverlayBorder,
                          width: 0.5,
                        ),
                        borderRadius: BorderRadius.circular(22),
                      ),
                      padding: const EdgeInsets.all(7),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          maxHeight:
                              MediaQuery.of(dialogContext).size.height -
                              MediaQuery.of(dialogContext).padding.top -
                              64,
                        ),
                        child: SingleChildScrollView(
                          child: builder(dialogContext),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  void _showMoreSheet() {
    final editor = _activeEditor;
    final canUndo = editor != null && editor.history.isNotEmpty;
    final canRedo = editor != null && editor.future.isNotEmpty;
    _showAnchoredPanel(
      (sheetContext) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // 双栏独立滚动开关（原版菜单首行；切换不关菜单；
          // 仅双栏可用时出现，原版默认 display:none）
          if (columnsAllowed(
            MediaQuery.of(sheetContext).size.width,
            MediaQuery.of(sheetContext).size.height,
          ))
            StatefulBuilder(
              builder: (rowContext, setRowState) => _menuRow(
                svgPath: 'M3 4h18v16H3z|M12 4v16',
                svgStrokeWidth: 1.8,
                title: '双栏独立滚动',
                subtitle: '平板与 PC 可分别滚动两栏',
                minHeight: 56,
                titleFontSize: 14,
                trailing: _MynoteSwitch(
                  value: _independentColumns,
                  onChanged: (v) {
                    _toggleIndependentColumns(v);
                    setRowState(() {});
                  },
                ),
                onTap: () {
                  _toggleIndependentColumns(!_independentColumns);
                  setRowState(() {});
                },
              ),
            ),
          const SizedBox(height: 4),
          _menuRow(
            svgPath: 'M1 4v6h6|M3.51 15a9 9 0 1 0 2.13-9.36L1 10',
            svgStrokeWidth: 2.5,
            title: '撤销',
            subtitle: '快捷键→ Cmd+Z / 三指左滑',
            enabled: canUndo,
            onTap: () {
              Navigator.pop(sheetContext);
              _activeEditor?.undo();
              _markDirty();
              _scheduleAutosave();
            },
          ),
          const SizedBox(height: 4),
          _menuRow(
            svgPath: 'M23 4v6h-6|M20.49 15a9 9 0 1 1-2.12-9.36L23 10',
            svgStrokeWidth: 2.5,
            title: '重做',
            subtitle: '快捷键→ Cmd+Shift+Z / 三指右滑',
            enabled: canRedo,
            onTap: () {
              Navigator.pop(sheetContext);
              _activeEditor?.redo();
              _markDirty();
              _scheduleAutosave();
            },
          ),
          const SizedBox(height: 4),
          _menuRow(
            svgPath: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
            svgStrokeWidth: 2.5,
            title: '添加附件',
            subtitle: '图片、PDF 或文本文件',
            chevron: true,
            onTap: () {
              Navigator.pop(sheetContext);
              _addAttachments();
            },
          ),
          Container(
            margin: const EdgeInsets.only(top: 3),
            padding: const EdgeInsets.only(top: 10, bottom: 7),
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(
                  color: MynoteTokens.glassOverlayBorder,
                  width: 0.5,
                ),
              ),
            ),
            child: _menuRow(
              svgPath: 'M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3',
              title: '导出笔记',
              subtitle: 'Markdown · HTML · PDF',
              chevron: true,
              minHeight: 54,
              onTap: () async {
                Navigator.pop(sheetContext);
                await Future<void>.delayed(const Duration(milliseconds: 220));
                if (mounted) _showExportSheet();
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: _menuRow(
              svgPath: '',
              // 原版为紫色调色板图标（#AF52DE + 三个实心点）
              iconOverride: SvgPicture.string(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">'
                '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5c0-1.1-.9-2-2-2h-1.6a1.8 1.8 0 0 1-1.8-1.8V6.5A3 3 0 0 0 12 3.5Z" stroke="#AF52DE" stroke-width="2.5" stroke-linejoin="round"/>'
                '<circle cx="8" cy="10" r="1.1" fill="#AF52DE"/>'
                '<circle cx="11" cy="7.7" r="1.1" fill="#AF52DE"/>'
                '<circle cx="15.2" cy="9" r="1.1" fill="#AF52DE"/></svg>',
                width: 20,
                height: 20,
              ),
              title: '更换背景色',
              subtitle: '为当前笔记设置专属底色',
              chevron: true,
              onTap: () async {
                Navigator.pop(sheetContext);
                await Future<void>.delayed(const Duration(milliseconds: 220));
                if (!mounted) return;
                final result = await showBgSheet(
                  context,
                  currentColor: _bgColor,
                );
                if (result == null || !mounted) return;
                setState(() {
                  _bgColor = result.$1 == 'select' ? result.$2 : null;
                });
                _syncChromeToBg();
                _markDirty();
                await _save();
                Diag.log('EDITOR', 'bg -> ${_bgColor ?? 'default'}');
              },
            ),
          ),
          if (_imeDebug)
            _menuRow(
              svgPath: 'M22 12h-4l-3 9L9 3l-3 9H2',
              title: '诊断面板',
              subtitle: 'IME / 应用诊断日志',
              onTap: () {
                Navigator.pop(sheetContext);
                setState(() => _showImeLog = !_showImeLog);
              },
            ),
        ],
      ),
    );
  }

  /// 更多菜单行（原版规格）：accent 图标 20、标题 15 w650、
  /// 副题 11 secondary、圆角 17 点按区；禁用时整行 30% 透明。
  Widget _menuRow({
    required String svgPath,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    bool enabled = true,
    bool chevron = false,
    Widget? iconOverride,
    Widget? trailing,
    double svgStrokeWidth = 2.2,
    double minHeight = 50,
    double titleFontSize = 15,
  }) {
    return Opacity(
      opacity: enabled ? 1 : 0.3,
      child: InkWell(
        // 同心圆角：锚定面板半径 22 − 面板内距 7 = 15
        borderRadius: BorderRadius.circular(15),
        splashColor: Colors.transparent,
        hoverColor: MynoteTokens.fillHover,
        highlightColor: MynoteTokens.fillHoverStrong,
        onTap: enabled ? onTap : null,
        child: Container(
          constraints: BoxConstraints(minHeight: minHeight),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Row(
            children: [
              SizedBox(
                width: 24,
                height: 24,
                child: Center(
                  child:
                      iconOverride ??
                      SvgPicture.string(
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="$svgStrokeWidth" stroke-linecap="round" stroke-linejoin="round">${svgPath.split('|').map((p) => '<path d="$p"/>').join()}</svg>',
                        width: 20,
                        height: 20,
                      ),
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: titleFontSize,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.1,
                        color: MynoteTokens.textMain,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 11,
                        color: MynoteTokens.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              if (trailing != null)
                trailing
              else if (chevron)
                Text(
                  '›',
                  style: TextStyle(
                    fontSize: 19,
                    color: MynoteTokens.placeholderStrong,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Editor _makeEditor(
    MutableDocument document,
    MutableDocumentComposer composer,
  ) {
    // 历史合并窗对齐原版 600ms（SE 默认快速输入合并窗仅 100ms）。
    // 请求处理器链 = 原版 Enter 语义前置拦截（标题/引用/待办块后插
    // 空段，见 newline_after_block.dart）+ 默认链，其余与
    // createDefaultDocumentEditor 等价。
    return Editor(
      editables: {Editor.documentKey: document, Editor.composerKey: composer},
      requestHandlers: [
        paragraphAfterBlockNewlineHandler,
        syncBacklinksRequestHandler,
        ...defaultRequestHandlers,
      ],
      historyGroupingPolicy: const HistoryGroupingPolicyList([
        mergeRepeatSelectionChangesPolicy,
        MergeRapidTextInputPolicy(Duration(milliseconds: 600)),
      ]),
      reactionPipeline: List.from(defaultEditorReactions),
      isHistoryEnabled: true,
    );
  }

  /// 光标滚动跟随（原版靠浏览器原生跟随 + 程序化移光标后必补
  /// scrollIntoView({block:'nearest'})）：文档变更/程序化落点后，
  /// 若光标在可视带之外（顶部 dock 区之下、键盘之上），把编辑区
  /// 滚到光标恰好入带；带内则不动，不与用户手动滚动相争。
  void _ensureCaretVisible() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      try {
        final composer = _activeComposer;
        final sel = composer?.selection;
        if (sel == null) return;
        final key = _activeB ? _docLayoutKeyB : _docLayoutKey;
        final state = key.currentState;
        if (state == null) return;
        final layout = state as DocumentLayout;
        final rect = layout.getRectForPosition(sel.extent);
        if (rect == null) return;
        final g = layout.getGlobalOffsetFromDocumentOffset(rect.topLeft);
        final mq = MediaQuery.of(context);
        final bandTop = effectiveInsets(mq.padding, hostInsets.value).top + 96;
        final bandBottom = mq.size.height - mq.viewInsets.bottom - 12;
        final caretTop = g.dy;
        final caretBottom = g.dy + rect.height;
        var delta = 0.0;
        if (caretBottom > bandBottom) {
          delta = caretBottom - bandBottom + 24;
        } else if (caretTop < bandTop) {
          delta = caretTop - bandTop - 8;
        }
        if (delta == 0) return;
        if (bodyScrollSupported) {
          // v3：滚动归 body，光标跟随 = 窗口滚过同一 delta
          scrollWindowTo(bodyScrollY.value + delta);
          return;
        }
        final sc = _activeB ? _scrollB : _scrollController;
        if (!sc.hasClients) return;
        final target = (sc.offset + delta)
            .clamp(0.0, sc.position.maxScrollExtent)
            .toDouble();
        if ((target - sc.offset).abs() > 1) {
          sc.animateTo(
            target,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        }
      } catch (_) {
        // 布局未就绪等情形静默跳过（跟随是增强，不是正确性依赖）
      }
    });
  }

  void _attachDocListener(MutableDocument doc) {
    doc.addListener((_) {
      if (!_syncingBacklinks) {
        if (!_suppressTyped) _hasTyped = true;
        _markDirty();
      }
      _refreshSubtitle();
      _updateSlashState();
      _scheduleAutosave();
      _ensureCaretVisible();
      Future.microtask(_checkSmartPrefix);
    });
  }

  void _attachComposerListeners(MutableDocumentComposer composer) {
    composer.selectionNotifier.addListener(_updateSlashState);
    composer.selectionNotifier.addListener(_handleSelectionTap);
    composer.selectionNotifier.addListener(() => _onMdCycleSelection(composer));
  }

  // —— MD 渲染/编辑循环（原版失焦渲染 + 点按还原源码）——
  // 每个 composer 上次选区所在节点；选区离开某文本节点时把该节点
  // 新敲的标记渲染成归因（失焦渲染），点按进入已渲染节点时由
  // _handleSelectionTap 分支还原源码并按偏移映射回光标。
  final Map<MutableDocumentComposer, String?> _mdLastNode = {};
  bool _mdCycling = false;

  void _onMdCycleSelection(MutableDocumentComposer composer) {
    if (_mdCycling || !mounted) return;
    final sel = composer.selection;
    final newNodeId = sel?.extent.nodeId;
    final lastNodeId = _mdLastNode[composer];
    _mdLastNode[composer] = newNodeId;
    if (lastNodeId == null || lastNodeId == newNodeId) return;
    if (composer.composingRegion.value != null) return;
    final document = identical(composer, _composerB) ? _docB : _document;
    if (document == null) return;
    // 延到微任务：不要在选区通知派发中途改文档（组件会漏刷一帧）
    Future.microtask(() => _renderNodeMarks(document, lastNodeId));
  }

  /// 失焦渲染：把节点文本 serialize 回源码再 parse；与现状等价
  /// （往返稳定）则不动。组合输入中/无标记时跳过。
  /// ⚠️ 必须走 Editor 事务（ReplaceNodeRequest）：直接
  /// document.replaceNodeById 不发任何通知，组件不会重绘
  /// （实测踩过：文档已变、画布纹丝不动）。
  void _renderNodeMarks(MutableDocument document, String nodeId) {
    final node = document.getNodeById(nodeId);
    if (node is! TextNode) return;
    if (node is! ParagraphNode && node is! TaskNode) return;
    final plain = node.text.toPlainText();
    final source = serializeInlineMarks(node.text);
    // 含脚注标记的节点离开时都要触发全篇重编号——定义段自身
    // 无归因、渲染是空操作，但它的增删改恰恰决定编号
    if (source.contains('[^')) {
      final docSnapshot = document;
      Future.microtask(() {
        final ed = identical(docSnapshot, _docB) ? _editorB : _editor;
        if (ed != null) _renumberFootnotesInDoc(docSnapshot, ed);
      });
    }
    final parsed = parseInlineMarks(source);
    // 与现状等价（纯文本相同且序列化规范形相同）才跳过；
    // 敲入的标记被 parse 消费（纯文本变短/归因变化）正是要渲染的情形
    if (parsed.toPlainText() == plain &&
        serializeInlineMarks(parsed) == source) {
      return;
    }
    final editor = identical(document, _docB) ? _editorB : _editor;
    if (editor == null) return;
    _mdCycling = true;
    try {
      editor.execute([
        ReplaceNodeRequest(
          existingNodeId: nodeId,
          newNode: node is ParagraphNode
              ? node.copyTextNodeWith(text: parsed)
              : (node as TaskNode).copyTextNodeWith(text: parsed),
        ),
      ]);
      Diag.log('EDITOR', 'md render $nodeId');
    } catch (e) {
      Diag.error('EDITOR', e);
    } finally {
      _mdCycling = false;
    }
  }

  /// 点按还原：已渲染节点被点中时把文本还原为带标记源码，
  /// 光标按 renderedOffsetToSourceOffset 换算。
  void _restoreNodeSource(
    MutableDocument document,
    MutableDocumentComposer composer,
    TextNode node,
    int caretOffset,
  ) {
    if (node is! ParagraphNode && node is! TaskNode) return;
    final plain = node.text.toPlainText();
    final source = serializeInlineMarks(node.text);
    if (source == plain) return; // 无标记，无需还原
    if (composer.composingRegion.value != null) return;
    final newOffset = renderedOffsetToSourceOffset(node.text, caretOffset);
    final editor = identical(document, _docB) ? _editorB : _editor;
    if (editor == null) return;
    _mdCycling = true;
    // 延到微任务（不要在选区通知派发中途开事务）+ 走 Editor 事务
    // （直接 replaceNodeById 不通知、组件不重绘，见 _renderNodeMarks）
    Future.microtask(() {
      try {
        if (!mounted) return;
        editor.execute([
          ReplaceNodeRequest(
            existingNodeId: node.id,
            newNode: node is ParagraphNode
                ? node.copyTextNodeWith(text: AttributedText(source))
                : (node as TaskNode).copyTextNodeWith(
                    text: AttributedText(source),
                  ),
          ),
          ChangeSelectionRequest(
            DocumentSelection.collapsed(
              position: DocumentPosition(
                nodeId: node.id,
                nodePosition: TextNodePosition(offset: newOffset),
              ),
            ),
            SelectionChangeType.placeCaret,
            'md restore',
          ),
        ]);
        Diag.log('EDITOR', 'md restore ${node.id} @$newOffset');
      } catch (e) {
        Diag.error('EDITOR', e);
      } finally {
        _mdCycling = false;
      }
    });
  }

  /// flow 双栏滚动同步（原版 multicol 为单一滚动：两栏同速同向）。
  /// 近似实现：任一栏滚动时把另一栏 jumpTo 到相同偏移（钳制到其最大值）；
  /// 独立滚动模式不做同步。媒体块跨栏（column-span）在 SE 双文档
  /// 结构下无法实现，为已记录的近似差异。
  void _syncFlowScrollA() {
    if (_syncingFlowScroll || !_twoPane || _independentColumns) return;
    if (!_scrollController.hasClients || !_scrollB.hasClients) return;
    final target = _scrollController.offset.clamp(
      0.0,
      _scrollB.position.maxScrollExtent,
    );
    if ((target - _scrollB.offset).abs() < 0.5) return;
    _syncingFlowScroll = true;
    _scrollB.jumpTo(target);
    _syncingFlowScroll = false;
  }

  void _syncFlowScrollB() {
    if (_syncingFlowScroll || !_twoPane || _independentColumns) return;
    if (!_scrollController.hasClients || !_scrollB.hasClients) return;
    final target = _scrollB.offset.clamp(
      0.0,
      _scrollController.position.maxScrollExtent,
    );
    if ((target - _scrollController.offset).abs() < 0.5) return;
    _syncingFlowScroll = true;
    _scrollController.jumpTo(target);
    _syncingFlowScroll = false;
  }

  /// 按当前开关与 layout 边界（重）建编辑器：宽屏下拆成两栏
  /// （independent = 各自独立滚动；flow = 均衡切分 + 滚动同步，
  /// 近似原版 CSS multicol）；窄屏合并回单栏。
  void _buildEditors(List<dynamic> mergedJson) {
    if (mergedJson.isEmpty) {
      mergedJson = [
        {
          'id': Editor.createNodeId(),
          'type': 'paragraph',
          'children': [
            {'text': ''},
          ],
        },
      ];
    }
    // 双栏仅在原版媒体查询允许时成立（宽≥768 且高≥600，或宽≥1100）；
    // 窄屏即使笔记带 independent 布局也退化为单栏（原版 display:contents）。
    final size = MediaQuery.of(context).size;
    // 原版宽屏默认即双栏：independent 用保存的边界独立滚动，
    // flow 用均衡切分 + 滚动同步（multicol 近似）。
    final wantTwo =
        columnsAllowed(size.width, size.height) && mergedJson.length >= 2;
    final boundary = (_independentColumns && _layout != null)
        ? _layoutBoundary.clamp(1, mergedJson.length - 1)
        : balancedBoundary(
            mergedJson.map((e) => (e as Map).cast<String, dynamic>()).toList(),
          );
    if (wantTwo && boundary > 0 && boundary < mergedJson.length) {
      _twoPane = true;
      _layoutBoundary = boundary;
      _layoutLeftIds = {
        for (final e in mergedJson.sublist(0, boundary))
          if (e is Map && e['id'] is String) e['id'] as String,
      };
      final docA = DocConverter.fromJson(mergedJson.sublist(0, boundary));
      final docB = DocConverter.fromJson(mergedJson.sublist(boundary));
      final composerA = MutableDocumentComposer();
      final composerB = MutableDocumentComposer();
      _document = docA;
      _composer = composerA;
      _editor = _makeEditor(docA, composerA);
      _docB = docB;
      _composerB = composerB;
      _editorB = _makeEditor(docB, composerB);
      _attachDocListener(docA);
      _attachDocListener(docB);
      _attachComposerListeners(composerA);
      _attachComposerListeners(composerB);
      _hydratePendingCards(docA);
      _hydratePendingCards(docB);
    } else {
      _twoPane = false;
      _docB = null;
      _composerB = null;
      _editorB = null;
      _activeB = false;
      final doc = DocConverter.fromJson(mergedJson);
      if (doc.isEmpty) {
        doc.add(
          ParagraphNode(id: Editor.createNodeId(), text: AttributedText('')),
        );
      }
      final composer = MutableDocumentComposer();
      _document = doc;
      _composer = composer;
      _editor = _makeEditor(doc, composer);
      _attachDocListener(doc);
      _attachComposerListeners(composer);
      _hydratePendingCards(doc);
    }
    if (mounted) setState(() {});
  }

  /// 双栏独立滚动开关（原版 toggleIndependentColumns）：写持久化偏好，
  /// 首次启用即建立 layout，拆分/合并编辑器，触发保存回写 layout。
  void _toggleIndependentColumns(bool v) {
    if (v == _independentColumns && _layout != null) return;
    setState(() => _independentColumns = v);
    prefsSet('sj_editor_independent_scroll', v ? '1' : '0');
    _layout ??= <String, dynamic>{
      'version': 1,
      'mode': v ? 'independent' : 'flow',
      'left': <String>[],
      'right': <String>[],
    };
    if (_document != null) {
      if (v && !_twoPane && _layoutBoundary <= 0) {
        // 首次启用且无既有切分：按块高均衡切分（原版 setIndependentScroll）
        _layoutBoundary = balancedBoundary(
          _mergedDocJson()
              .map((e) => (e as Map).cast<String, dynamic>())
              .toList(),
        );
      }
      if (!v && _twoPane) {
        _layoutBoundary = _document!.nodeCount;
      }
      _buildEditors(_mergedDocJson());
    }
    _markDirty();
    _scheduleAutosave();
    Diag.log('EDITOR', 'columns independent=$v');
  }

  Future<void> _load() async {
    Diag.log('EDITOR', 'load memo=${widget.memoId}');
    final db = ref.read(databaseProvider);
    final memo = await (db.select(
      db.memos,
    )..where((t) => t.id.equals(widget.memoId))).getSingleOrNull();
    if (memo == null) {
      if (mounted) setState(() => _loadError = true);
      return;
    }
    if (!mounted) return;
    // 草稿恢复（原版 DraftStore.load）：草稿比笔记更新时以草稿为准，
    // doc + title + layout 一并还原（原版 editor.js:142-172）
    var effectiveDocJson = memo.docJson;
    String? draftTitle;
    Object? draftLayout;
    try {
      final draft = await (db.select(
        db.drafts,
      )..where((t) => t.memoId.equals(widget.memoId))).getSingleOrNull();
      if (draft != null &&
          draft.updatedAt > memo.updatedAt &&
          draft.docJson != memo.docJson) {
        effectiveDocJson = draft.docJson;
        _restoredDraft = true;
        draftTitle = draft.title;
        if (draft.layoutJson != null) {
          try {
            draftLayout = jsonDecode(draft.layoutJson!);
          } catch (_) {}
        }
        Diag.log('EDITOR', 'draft restored ${widget.memoId}');
      }
    } catch (e) {
      Diag.warn('EDITOR', 'draft read failed: $e');
    }
    final docJson = jsonDecode(effectiveDocJson) as List<dynamic>;
    final document = DocConverter.fromJson(docJson);
    if (document.isEmpty) {
      document.add(
        ParagraphNode(id: Editor.createNodeId(), text: AttributedText('')),
      );
    }
    final composer = MutableDocumentComposer();
    final editor = _makeEditor(document, composer);
    _memo = memo;
    _bgColor = memo.bg;
    _syncChromeToBg();
    _initialTitle = memo.title == '无标题' ? '' : memo.title;
    // 双栏 layout 初始化（原版 normalizeLayout + localStorage 回退）
    Object? rawLayout;
    try {
      final extra = jsonDecode(memo.extraJson);
      if (extra is Map) rawLayout = extra['layout'];
    } catch (_) {}
    _layout = normalizeColumnLayout(
      document.map((n) => n.id).toList(),
      draftLayout ?? rawLayout,
    );
    if (_layout != null) {
      _layoutBoundary = (_layout!['left'] as List).length;
      _layoutLeftIds = {for (final e in _layout!['left'] as List) e.toString()};
      _independentColumns = _layout!['mode'] == 'independent';
    } else {
      _independentColumns = prefsGet('sj_editor_independent_scroll') == '1';
    }
    _refreshSubtitle();
    try {
      final store = await ref.read(attachmentStoreProvider.future);
      _avatarBytes = await store.read('avatar_${widget.memoId}');
    } catch (_) {}
    _document = document;
    _composer = composer;
    _editor = editor;
    _attachDocListener(document);
    _attachComposerListeners(composer);
    setState(() {
      _titleController.text = draftTitle ?? _initialTitle;
      _subtitle = _computeSubtitle();
      _subtitleNotifier.value = _subtitle;
    });
    _suppressTyped = false;
    if (_restoredDraft) {
      // 草稿内容尚未落盘：标记脏并安排保存，使恢复结果持久化
      _markDirty();
      _scheduleAutosave();
    }
    _hydratePendingCards(document);
    if (_independentColumns) {
      // 初始即双栏：拆分重建（_buildEditors 内会再补拉两栏卡片）
      _buildEditors(_mergedDocJson());
    }
    final singleEmpty =
        document.length == 1 &&
        document.first is TextNode &&
        (document.first as TextNode).text.toPlainText().isEmpty;
    if (widget.isNew || singleEmpty) {
      // 自动聚焦首块：新建 200ms；已有的单空段落笔记 300ms
      // （原版两条独立路径的时延）
      Future<void>.delayed(
        Duration(milliseconds: widget.isNew ? 200 : 300),
        () {
          if (!mounted) return;
          final firstText = document.whereType<TextNode>().firstOrNull;
          if (firstText != null) {
            composer.setSelectionWithReason(
              DocumentSelection.collapsed(
                position: DocumentPosition(
                  nodeId: firstText.id,
                  nodePosition: const TextNodePosition(offset: 0),
                ),
              ),
            );
          }
          _editorFocusNode.requestFocus();
        },
      );
    }
  }

  bool _convertingPrefix = false;

  /// 智能前缀（原版行首自动转块）：段落行首输入 `# `/`## `/`### `/`> `/
  /// `[ ] `/`[] `/`--- ` 后自动转为对应块，前缀被消费、正文保留。
  void _checkSmartPrefix() {
    if (_convertingPrefix || _suppressTyped || !mounted) return;
    if (!_editorFocusNode.hasFocus && !_focusB.hasFocus) return;
    final document = _activeDocument;
    final composer = _activeComposer;
    if (document == null || composer == null) return;
    final sel = composer.selection;
    if (sel == null || !sel.isCollapsed) return;
    final node = document.getNodeById(sel.extent.nodeId);
    if (node is! ParagraphNode) return;
    final bt = node.metadata['blockType'];
    if (bt != null && bt != paragraphAttribution) return;
    final text = node.text.toPlainText();
    final caret = (sel.extent.nodePosition as TextNodePosition).offset;
    // 原版模式表（editor.js:1915-1953）：所有前缀都要求后面已有内容才转，
    // 且整篇扫描——此处等价地只查光标所在段。引用带 callout 负向断言
    // （> [!...] 永不转引用，否则 callout 根本写不出来）；分割线为整段恰为 ---。
    String? type;
    int? level;
    var prefixLen = 0;
    final headingMatch = RegExp(r'^(#{1,3}) (.+)$').firstMatch(text);
    if (headingMatch != null) {
      type = 'heading';
      level = headingMatch.group(1)!.length;
      prefixLen = level + 1;
    } else if (text.startsWith('> ') &&
        text.length > 2 &&
        !RegExp(r'^>\s*\[!\S').hasMatch(text)) {
      type = 'quote';
      prefixLen = 2;
    } else if (text.startsWith('[ ] ') && text.length > 4) {
      type = 'todo';
      prefixLen = 4;
    } else if (text.startsWith('[] ') && text.length > 3) {
      type = 'todo';
      prefixLen = 3;
    } else if (text == '---') {
      type = 'divider';
      prefixLen = 3;
    }
    if (type == null) return;
    final command = slashCommands.firstWhere(
      (c) => c.type == type && (type != 'heading' || c.level == level),
      orElse: () => slashCommands.first,
    );
    _convertingPrefix = true;
    try {
      executeEditorCommand(
        document: document,
        composer: composer,
        command: command,
        nodeId: node.id,
        baseAttributed: removeTextRange(node.text, 0, prefixLen),
        caretOffset: (caret - prefixLen).clamp(0, text.length - prefixLen),
        editor: _activeEditor,
      );
      Diag.log('EDITOR', 'smart prefix $type${level ?? ''}');
    } catch (e) {
      Diag.error('EDITOR', e);
    } finally {
      _convertingPrefix = false;
    }
  }

  /// 全篇脚注重编号：按定义序把引用显示文本换成编号（走事务，
  /// 跳过当前选区所在节点以免光标被文本长度变化顶偏）。
  void _renumberFootnotesInDoc(MutableDocument document, Editor editor) {
    if (_mdCycling || !mounted) return;
    final nodes = List<DocumentNode>.of(document);
    final before = List<DocumentNode>.of(nodes);
    DocConverter.renumberAllFootnotes(nodes);
    final selectedId = (identical(document, _docB) ? _composerB : _composer)
        ?.selection
        ?.extent
        .nodeId;
    final requests = <EditRequest>[];
    for (var i = 0; i < nodes.length; i++) {
      if (!identical(nodes[i], before[i]) && nodes[i].id != selectedId) {
        requests.add(
          ReplaceNodeRequest(existingNodeId: nodes[i].id, newNode: nodes[i]),
        );
      }
    }
    if (requests.isEmpty) return;
    _mdCycling = true;
    try {
      editor.execute(requests);
      Diag.log('EDITOR', 'footnote renumber x${requests.length}');
    } catch (e) {
      Diag.error('EDITOR', e);
    } finally {
      _mdCycling = false;
    }
  }

  /// 点脚注引用 → 跳到定义行（原版引用点击行为）。
  bool _maybeJumpFootnote(TextNode node, DocumentSelection sel) {
    final pos = sel.extent.nodePosition;
    if (pos is! TextNodePosition) return false;
    FootnoteAttribution? found;
    for (final off in [pos.offset, pos.offset - 1]) {
      if (off < 0 || off >= node.text.length) continue;
      for (final a in node.text.getAllAttributionsAt(off)) {
        if (a is FootnoteAttribution) {
          found = a;
          break;
        }
      }
      if (found != null) break;
    }
    if (found == null) return false;
    final document = _docContaining(node.id);
    if (document == null) return false;
    for (final n in document) {
      if (n is! TextNode) continue;
      final plain = n.text.toPlainText();
      var lineStart = 0;
      for (final line in plain.split('\n')) {
        final label = footnoteDefLabelOfLine(line);
        if (label != null && label.toLowerCase() == found.label.toLowerCase()) {
          final editor = identical(document, _docB) ? _editorB : _editor;
          editor?.execute([
            ChangeSelectionRequest(
              DocumentSelection.collapsed(
                position: DocumentPosition(
                  nodeId: n.id,
                  nodePosition: TextNodePosition(offset: lineStart),
                ),
              ),
              SelectionChangeType.placeCaret,
              'footnote jump',
            ),
          ]);
          Diag.log('EDITOR', 'footnote jump ${found.label}');
          _ensureCaretVisible();
          return true;
        }
        lineStart += line.length + 1;
      }
    }
    return false;
  }

  /// 打开时补拉未解析完成的卡片（原版 hydrate）：只有真正卡在
  /// loading 态的卡才补拉（L17：已 ready 但无 meta 的卡不再碰——
  /// 只读浏览不改文档、不 bump updatedAt）；3 张一波并发而非逐卡
  /// 串行；全部补拉后状态无变化则不落盘。
  Future<void> _hydratePendingCards(MutableDocument document) async {
    final pending = <CardNode>[];
    for (final node in document) {
      if (node is CardNode &&
          (node.url?.isNotEmpty ?? false) &&
          node.status == 'loading') {
        pending.add(node);
      }
    }
    if (pending.isEmpty) return;
    Diag.log('EDITOR', 'hydrate ${pending.length} pending cards');
    _suppressTyped = true;
    var changed = false;
    for (var i = 0; i < pending.length; i += 3) {
      final wave = pending.skip(i).take(3);
      await Future.wait([
        for (final card in wave)
          resolvePasteCard(
            document: document,
            cardId: card.id,
            url: card.url!,
            fetchMeta: fetchLinkMeta,
          ).then((_) {
            final after = document.getNodeById(card.id);
            if (after is CardNode &&
                (after.status != card.status || after.meta != card.meta)) {
              changed = true;
            }
          }),
      ]);
    }
    _suppressTyped = false;
    if (mounted) {
      setState(() {});
      if (changed) {
        _markDirty();
        _scheduleAutosave();
      }
    }
  }

  void _markDirty() {
    _dirty = true;
    _editGen++;
  }

  /// 自动保存（原版 triggerAutoSave 的等价物）：变更后 600ms 防抖落盘，
  /// 不再只依赖返回时保存，页面被杀/崩溃也不丢编辑。
  /// 草稿双写（原版 DraftStore）：变更后 300ms 先写草稿行，崩溃/被杀后
  /// 重开时若草稿更新则恢复（见 _load）。
  void _scheduleAutosave() {
    _autosaveTimer?.cancel();
    _autosaveTimer = Timer(const Duration(milliseconds: 600), () {
      if (_dirty && mounted) _save();
    });
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 300), _writeDraft);
  }

  /// L1：单栏保存时的切分点——最后一个左栏原成员之后。
  /// 左栏集为空（无 layout 历史）时回退旧计数口径。
  int _singlePaneBoundary(List<String> ids) {
    if (_layoutLeftIds.isEmpty) return _layoutBoundary.clamp(0, ids.length);
    var b = 0;
    for (var i = 0; i < ids.length; i++) {
      if (_layoutLeftIds.contains(ids[i])) b = i + 1;
    }
    return b;
  }

  /// 当前双栏 layout 的可存储形态（与 _save 的 capture 口径一致）
  Object? _currentLayoutJson(List<dynamic> docJson) {
    if (_layout == null) return null;
    final ids = <String>[
      for (final block in docJson)
        if (block is Map && block['id'] is String) block['id'] as String,
    ];
    final boundary = _twoPane ? _document!.nodeCount : _singlePaneBoundary(ids);
    return captureColumnLayout(
      ids,
      boundary.clamp(0, ids.length),
      _independentColumns,
    );
  }

  Future<void> _writeDraft() async {
    final document = _document;
    if (document == null || !_dirty) return;
    try {
      final db = _resolveDb();
      if (db == null) return;
      final merged = _mergedDocJson();
      final layout = _currentLayoutJson(merged);
      await db
          .into(db.drafts)
          .insertOnConflictUpdate(
            DraftsCompanion.insert(
              id: widget.memoId,
              memoId: widget.memoId,
              docJson: jsonEncode(merged),
              updatedAt: DateTime.now().millisecondsSinceEpoch,
              title: Value(_titleController.text),
              layoutJson: Value(layout == null ? null : jsonEncode(layout)),
            ),
          );
      Diag.log('EDITOR', 'draft saved ${widget.memoId}');
    } catch (e) {
      Diag.warn('EDITOR', 'draft save failed: $e');
    }
  }

  /// 返回：新建且从未编辑过的笔记直接删除（原版 hasTyped 闩锁语义），
  /// 否则保存后退出。
  Future<void> _goBack() async {
    if (widget.isNew && _document != null) {
      final untouched =
          !_hasTyped &&
          _bgColor == null &&
          _avatarBytes == null &&
          _titleController.text == _initialTitle;
      if (untouched) {
        // 先退场，空笔记与草稿的清理在退出后异步完成
        _popSelf();
        final db = _resolveDb();
        if (db != null) {
          try {
            await db.deleteMemoWithFts(widget.memoId);
            // 原版：删除空笔记时同步清草稿
            await (db.delete(
              db.drafts,
            )..where((t) => t.memoId.equals(widget.memoId))).go();
            Diag.log('EDITOR', 'discard empty new memo ${widget.memoId}');
          } catch (e) {
            Diag.error('EDITOR', 'discard empty memo failed: $e');
          }
        }
        return;
      }
    }
    // 立即退场（原版返回 fab 按下即开始退场，不等保存）；
    // 保存由 600ms 自动保存 + dispose 兜底完成（db 引用已缓存，
    // 页面销毁后仍可落库），此处再补发一次不阻塞退场。
    _popSelf();
    unawaited(_save());
  }

  Future<bool> _save() async {
    final document = _document;
    final memo = _memo;
    if (document == null || memo == null) return true;
    final db = _resolveDb();
    if (db == null) return true; // 已销毁且无缓存引用：放弃兜底保存
    final gen = _editGen;
    Diag.log('EDITOR', 'save memo=${memo.id}');
    try {
      final docJson = _mergedDocJson();
      final docJsonText = jsonEncode(docJson);
      final nowMs = DateTime.now().millisecondsSinceEpoch;
      // 标题归一化（原版口径）：trim 后为空回退「无标题」
      final titleText = _titleController.text.trim();
      // 双栏 layout 回写（原版每次 doSave 都 capture 回写 mode 与成员）
      var extraOut = memo.extraJson;
      Object? savedLayout;
      if (_layout != null) {
        Map<String, dynamic> extraMap;
        try {
          final decoded = jsonDecode(memo.extraJson);
          extraMap = decoded is Map
              ? decoded.map((k, v) => MapEntry(k.toString(), v))
              : <String, dynamic>{};
        } catch (_) {
          extraMap = <String, dynamic>{};
        }
        final ids = <String>[
          for (final block in docJson)
            if (block is Map && block['id'] is String) block['id'] as String,
        ];
        final boundary = _twoPane
            ? _document!.nodeCount
            : _singlePaneBoundary(ids);
        savedLayout = captureColumnLayout(
          ids,
          boundary.clamp(0, ids.length),
          _independentColumns,
        );
        extraMap['layout'] = savedLayout;
        extraOut = jsonEncode(extraMap);
      }
      await db.upsertMemoWithFts(
        MemosCompanion.insert(
          id: memo.id,
          title: Value(titleText.isEmpty ? '无标题' : titleText),
          pinned: Value(memo.pinned),
          bg: Value(_bgColor),
          docJson: Value(docJsonText),
          extraJson: Value(extraOut),
          createdAt: memo.createdAt,
          updatedAt: nowMs,
        ),
        docPlainText(docJson),
      );
      // 回写内存中的 updatedAt，胶囊时间不再冻结在打开时刻
      _memo = memo.copyWith(updatedAt: nowMs);
      // 草稿与笔记同步（同时间戳 → 恢复判定不触发，草稿仅作崩溃兜底）
      try {
        await db
            .into(db.drafts)
            .insertOnConflictUpdate(
              DraftsCompanion.insert(
                id: memo.id,
                memoId: memo.id,
                docJson: docJsonText,
                updatedAt: nowMs,
                title: Value(titleText.isEmpty ? '无标题' : titleText),
                layoutJson: Value(
                  savedLayout == null ? null : jsonEncode(savedLayout),
                ),
              ),
            );
      } catch (_) {}
      // 保存期间无新编辑才清脏标记；有新编辑则保持脏并再排一次保存
      if (_editGen == gen) {
        _dirty = false;
      } else {
        _scheduleAutosave();
      }
      if (!_disposing) _refreshSubtitle();
      return true;
    } catch (e) {
      Diag.error('EDITOR', 'save failed memo=${memo.id}: $e');
      if (!_disposing) _showEditorToast('❌ 保存失败，请检查存储空间');
      return false;
    }
  }

  /// 添加附件（原版 handleFilesSelected 的通用路径）：多选文件，
  /// 图片存为 attachment(image=true)，其余为普通 attachment，
  /// 依次插入到当前节点之后。
  Future<void> _addAttachments() async {
    final document = _activeDocument;
    final composer = _activeComposer;
    if (document == null || composer == null) return;
    final files = await openFiles(
      acceptedTypeGroups: [
        const XTypeGroup(
          label: '图片',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
        ),
        const XTypeGroup(
          label: '文档',
          extensions: ['pdf', 'txt', 'doc', 'docx', 'md'],
        ),
      ],
    );
    if (files.isEmpty) return;
    try {
      final store = await ref.read(attachmentStoreProvider.future);
      final db = ref.read(databaseProvider);
      var afterId =
          composer.selection?.extent.nodeId ??
          (document.isEmpty ? null : document.last.id);
      var addedCount = 0;
      var failedCount = 0;
      for (final file in files) {
        final fileId = Editor.createNodeId();
        var stored = false;
        try {
          final bytes = await file.readAsBytes();
          final mime = file.mimeType ?? _guessMime(file.name);
          await store.write(fileId, bytes);
          stored = true;
          await db
              .into(db.attachments)
              .insertOnConflictUpdate(
                AttachmentsCompanion.insert(
                  id: fileId,
                  memoId: Value(widget.memoId),
                  name: Value(file.name),
                  mime: Value(mime),
                  size: Value(bytes.length),
                  localPath: 'attachments/$fileId',
                  createdAt: DateTime.now().millisecondsSinceEpoch,
                ),
              );
          final node = MediaNode(
            id: Editor.createNodeId(),
            kind: 'attachment',
            fileId: fileId,
            imageFlag: mime.startsWith('image/'),
          );
          if (afterId == null) {
            document.insertNodeBefore(
              existingNodeId: document.first.id,
              newNode: node,
            );
          } else {
            document.insertNodeAfter(existingNodeId: afterId, newNode: node);
          }
          afterId = node.id;
          addedCount++;
          Diag.log(
            'EDITOR',
            'attachment added ${file.name} ($mime, ${bytes.length}B)',
          );
        } catch (e) {
          // 单个失败不中断整批；DB 写失败时补偿删刚写的存储文件防孤儿
          failedCount++;
          if (stored) {
            try {
              await store.delete(fileId);
            } catch (_) {}
          }
          Diag.error('EDITOR', 'attachment add failed ${file.name}: $e');
        }
      }
      if (addedCount > 0) {
        _markDirty();
        _scheduleAutosave();
        if (mounted) setState(() {});
      }
      if (failedCount > 0 && mounted) {
        _showEditorToast('❌ 部分附件添加失败（成功 $addedCount 个，失败 $failedCount 个）');
      }
    } catch (e) {
      Diag.error('EDITOR', e);
      if (mounted) {
        _showEditorToast('❌ 附件保存失败，请重试。');
      }
    }
  }

  String _guessMime(String name) {
    final ext = name.split('.').last.toLowerCase();
    return switch (ext) {
      'png' => 'image/png',
      'jpg' || 'jpeg' => 'image/jpeg',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      'pdf' => 'application/pdf',
      'txt' || 'md' => 'text/plain',
      'doc' => 'application/msword',
      'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      _ => 'application/octet-stream',
    };
  }

  /// 选区变为媒体/卡片节点选区时的点按动作（原版 handleEditorClick）：
  /// 仅当刚刚发生过指针按下（点按而非键盘移动选区）时触发一次。
  /// 最近一次点按在指定节点矩形内的相对几何（relX/relY 为 0..1 比例，
  /// dxFromRight 为距右缘像素）。组件内按钮被 SE 的 IgnorePointer 拦截，
  /// 原版的卡片分区点击（右侧插段、附件边缘区、重试按钮、图库单张）
  /// 在编辑页按几何复原；取不到几何返回 null，调用方退回节点级行为。
  ({double relX, double relY, double width, double dxFromRight})? _tapGeometry(
    String nodeId,
  ) {
    final global = _lastPointerGlobal;
    if (global == null) {
      Diag.log('EDITOR', 'tap geo: no pointer');
      return null;
    }
    for (final key in [_docLayoutKey, _docLayoutKeyB]) {
      final state = key.currentState;
      if (state == null) continue;
      try {
        final layout = state as DocumentLayout;
        // 先用布局命中确认点按确实落在本节点上
        final docOffset = layout.getDocumentOffsetFromAncestorOffset(global);
        final pos = layout.getDocumentPositionAtOffset(docOffset);
        if (pos?.nodeId != nodeId) continue;
        // 节点矩形走组件渲染盒（getRectForPosition 对原子块返回 null，
        // 实测结论）：全局坐标系下取组件左上与尺寸，与点按全局坐标直比
        final comp = layout.getComponentByNodeId(nodeId);
        final box = comp?.context.findRenderObject() as RenderBox?;
        if (box == null || !box.hasSize || box.size.width <= 0) continue;
        final topLeft = box.localToGlobal(Offset.zero);
        final size = box.size;
        return (
          relX: (global.dx - topLeft.dx) / size.width,
          relY: size.height > 0 ? (global.dy - topLeft.dy) / size.height : 0,
          width: size.width,
          dxFromRight: topLeft.dx + size.width - global.dx,
        );
      } catch (e) {
        Diag.log('EDITOR', 'tap geo error: $e');
        continue;
      }
    }
    return null;
  }

  /// 在原子块前/后插入空段并聚焦（原版卡片右侧区/附件边缘区的逃逸光标）。
  void _insertEmptyParagraphNear(DocumentNode node, {required bool after}) {
    final document = _docContaining(node.id) ?? _document;
    if (document == null) return;
    final p = ParagraphNode(
      id: Editor.createNodeId(),
      text: AttributedText(''),
    );
    if (after) {
      document.insertNodeAfter(existingNodeId: node.id, newNode: p);
    } else {
      document.insertNodeBefore(existingNodeId: node.id, newNode: p);
    }
    final inB = identical(document, _docB);
    (inB ? _composerB : _composer)?.setSelectionWithReason(
      DocumentSelection.collapsed(
        position: DocumentPosition(
          nodeId: p.id,
          nodePosition: const TextNodePosition(offset: 0),
        ),
      ),
    );
    (inB ? _focusB : _editorFocusNode).requestFocus();
    _markDirty();
    _scheduleAutosave();
    if (mounted) setState(() {});
  }

  void _handleSelectionTap() {
    final document = _activeDocument;
    final composer = _activeComposer;
    if (document == null || composer == null || !mounted) return;
    final sel = composer.selection;
    if (sel == null) return;
    final node = document.getNodeById(sel.extent.nodeId);
    // 分区点按已处理过的节点，选区回调跳过（避免灯箱+面板双开）
    if (_zoneActedNodeId == sel.extent.nodeId &&
        _zoneActedAt != null &&
        DateTime.now().difference(_zoneActedAt!) <
            const Duration(milliseconds: 500)) {
      return;
    }
    if (node is MediaNode) {
      if (_isFreshTap(node.id)) _handleMediaTap(node);
    } else if (node is BacklinksNode) {
      if (_isFreshTap(node.id)) _handleBacklinkTap(node);
    } else if (node is CardNode) {
      if (_isFreshTap(node.id)) _handleCardTap(node);
    } else if (node is TextNode) {
      // Wiki 链接点按打开（原版 mynote-wiki-link 点击行为）；
      // 未命中链接时走 MD 点按还原（已渲染块点回源码编辑态）
      if (sel.isCollapsed &&
          _isFreshTap('${node.id}@${sel.extent.nodePosition}')) {
        final jumped = _maybeJumpFootnote(node, sel);
        final opened = jumped ? true : _maybeOpenWikiLink(node, sel);
        if (!opened) {
          final pos = sel.extent.nodePosition;
          if (pos is TextNodePosition) {
            _restoreNodeSource(document, composer, node, pos.offset);
          }
        }
      }
    } else {
      _lastActedNodeId = null;
    }
  }

  bool _maybeOpenWikiLink(TextNode node, DocumentSelection sel) {
    final pos = sel.extent.nodePosition;
    if (pos is! TextNodePosition) return false;
    final text = node.text;
    WikiLinkAttribution? found;
    for (final off in [pos.offset, pos.offset - 1]) {
      if (off < 0 || off >= text.length) continue;
      for (final a in text.getAllAttributionsAt(off)) {
        if (a is WikiLinkAttribution) {
          found = a;
          break;
        }
      }
      if (found != null) break;
    }
    if (found != null) {
      Diag.log('EDITOR', 'wiki open ${found.target}');
      _openWikiTarget(found.target);
      return true;
    }
    return false;
  }

  /// 反向链接（原版 .wiki-backlinks）：引用了当前标题的其他笔记。
  List<Memo> _backlinks() {
    final title = _titleController.text.trim().isNotEmpty
        ? _titleController.text
        : (_memo?.title ?? '');
    final key = wikiTitleKey(title);
    if (key.isEmpty) return const [];
    final memos = ref.watch(memosProvider).valueOrNull ?? const <Memo>[];
    return memos
        .where(
          (m) =>
              m.id != widget.memoId && memoWikiTargets(m.docJson).contains(key),
        )
        .toList();
  }

  // —— 反向链接（原版正文后原位分节）：运行时 BacklinksNode 注入
  // 文档流末尾（尾栏文档），序列化恒过滤；同步走非历史事务，
  // 不标脏、不入撤销栈。来源变化（标题改名/他篇增删链接）时重同步。
  bool _syncingBacklinks = false;
  String _backlinkSyncKey = '';

  /// 数据库引用缓存：dispose 兜底保存时 ref 已失效，必须用
  /// 提前捕获的引用（见 dispose 中的 _save 调用）。
  MynoteDatabase? _db;
  bool _disposing = false;

  MynoteDatabase? _resolveDb() {
    if (_db != null) return _db;
    if (!mounted || _disposing) return null;
    return _db = ref.read(databaseProvider);
  }

  void _syncBacklinksNode(List<Memo> sources) {
    if (!mounted) return;
    final tailDoc = (_twoPane && _docB != null) ? _docB : _document;
    final tailEditor = (_twoPane && _editorB != null) ? _editorB : _editor;
    final otherDoc = identical(tailDoc, _docB) ? _document : _docB;
    final otherEditor = identical(tailDoc, _docB) ? _editor : _editorB;
    if (otherDoc != null &&
        otherEditor != null &&
        !identical(otherDoc, tailDoc) &&
        otherDoc.getNodeById(BacklinksNode.kBacklinksNodeId) != null) {
      _syncingBacklinks = true;
      try {
        otherEditor.execute([const SyncBacklinksRequest(null)]);
      } catch (e) {
        Diag.error('EDITOR', e);
      } finally {
        _syncingBacklinks = false;
      }
    }
    if (tailDoc == null || tailEditor == null) return;
    final want = sources.isEmpty
        ? null
        : BacklinksNode(
            sources: [
              for (final m in sources)
                BacklinkSource(memoId: m.id, title: m.title),
            ],
          );
    final existing = tailDoc.getNodeById(BacklinksNode.kBacklinksNodeId);
    if (want == null && existing == null) return;
    if (want != null &&
        existing != null &&
        existing.hasEquivalentContent(want)) {
      return;
    }
    _syncingBacklinks = true;
    try {
      tailEditor.execute([SyncBacklinksRequest(want)]);
      Diag.log('EDITOR', 'backlinks sync x${sources.length}');
    } catch (e) {
      Diag.error('EDITOR', e);
    } finally {
      _syncingBacklinks = false;
    }
  }

  /// 反链行点按（几何分发，与卡片分区点按同机制）。
  void _handleBacklinkTap(BacklinksNode node) {
    final geo = _tapGeometry(node.id);
    if (geo == null) return;
    final totalH =
        backlinksHeaderHeight + backlinksRowHeight * node.sources.length;
    final yPx = geo.relY * totalH;
    if (yPx < backlinksHeaderHeight) return;
    final index = ((yPx - backlinksHeaderHeight) / backlinksRowHeight).floor();
    if (index < 0 || index >= node.sources.length) return;
    _openWikiTarget(node.sources[index].title);
  }

  /// 打开 wiki 目标（原版 openWikiTarget）：按标题（去 # 后缀、去空白、
  /// 不分大小写）找笔记，找不到则以该标题新建。
  Future<void> _openWikiTarget(String target) async {
    final requested = target.split('#').first.trim();
    if (requested.isEmpty) return;
    final key = requested.toLowerCase();
    final memos = ref.read(memosProvider).valueOrNull ?? const <Memo>[];
    Memo? match;
    for (final m in memos) {
      if (m.title.trim().toLowerCase() == key) {
        match = m;
        break;
      }
    }
    await _save();
    if (!mounted) return;
    if (match != null) {
      Navigator.of(context).push(
        mynotePageRoute(context, EditorPage(memoId: match!.id), reverseMs: 320),
      );
      return;
    }
    final db = ref.read(databaseProvider);
    final id = 'memo_${DateTime.now().millisecondsSinceEpoch}';
    final now = DateTime.now().millisecondsSinceEpoch;
    final doc = [
      {
        'id': Editor.createNodeId(),
        'type': 'paragraph',
        'children': [
          {'text': ''},
        ],
      },
    ];
    await db.upsertMemoWithFts(
      MemosCompanion.insert(
        id: id,
        title: Value(requested),
        docJson: Value(jsonEncode(doc)),
        createdAt: now,
        updatedAt: now,
      ),
      '',
    );
    Diag.log('EDITOR', 'wiki new memo "$requested"');
    if (!mounted) return;
    Navigator.of(context).push(
      mynotePageRoute(
        context,
        EditorPage(memoId: id, isNew: true),
        reverseMs: 320,
      ),
    );
  }

  /// 点按判定：刚发生过指针按下且该节点尚未被触发过。
  bool _isFreshTap(String nodeId) {
    final down = _lastPointerDown;
    if (down == null ||
        DateTime.now().difference(down) > const Duration(milliseconds: 400)) {
      return false;
    }
    if (_lastActedNodeId == nodeId) return false;
    _lastActedNodeId = nodeId;
    Diag.log('EDITOR', 'node tap $nodeId');
    return true;
  }

  Future<void> _handleMediaTap(MediaNode node) async {
    final geo = _tapGeometry(node.id);
    switch (node.kind) {
      case 'image':
        // 右侧区：在图后插入空段（原版分区点击）
        if (geo != null && geo.relX > 0.85) {
          _insertEmptyParagraphNear(node, after: true);
          return;
        }
        final src = node.attrs['src']?.toString() ?? '';
        if (node.fileId == null &&
            (node.attrs['fileId'] == null) &&
            src.isEmpty) {
          await _pickImageForNode(node);
        } else {
          await _openLightbox(fileId: node.effectiveFileId, src: src);
        }
      case 'gallery':
        final items = (node.attrs['items'] as List?) ?? const [];
        if (items.isEmpty) {
          await _pickImageForNode(node, multiple: true);
        } else {
          // 按点按几何定位被点的单张（2 列、格高 366、间距 4）；
          // 取不到几何时退回第一张（旧行为）
          var index = 0;
          if (geo != null) {
            final col = geo.relX >= 0.5 ? 1 : 0;
            final row = (geo.relY * (366.0 * ((items.length + 1) ~/ 2)) / 370)
                .floor();
            index = (row * 2 + col).clamp(0, items.length - 1);
          }
          final item = items[index];
          final fid = item is Map
              ? item['fileId']?.toString()
              : (item is String && !item.startsWith('http') ? item : null);
          final url = item is Map
              ? item['url']?.toString()
              : (item is String && item.startsWith('http') ? item : null);
          await _openLightbox(fileId: fid, src: url ?? '');
        }
      case 'imgTextCard':
      case 'imageTextRow':
        final fid = node.effectiveFileId;
        final hasImg = fid != null && fid.isNotEmpty;
        // 分区：图文行左半=图片区、右半=文本区；图文卡上部=图片区、
        // 下部=文本区（图片高占比近似 0.8，无图占位 0.66）
        final bool imageZone;
        if (geo == null) {
          imageZone = !hasImg;
        } else if (node.kind == 'imageTextRow') {
          imageZone = geo.relX < 0.5;
        } else {
          imageZone = geo.relY < (hasImg ? 0.8 : 0.66);
        }
        if (!imageZone) {
          _openImageTextSheetFor(node);
        } else if (!hasImg) {
          await _pickImageForNode(node);
        } else {
          await _openLightbox(fileId: fid, src: '');
        }
      case 'attachment':
        // 原版：仅右端「点击打开」胶囊区打开文件（分享优先）；
        // 左右 28px 边缘区插入空段逃逸光标；中部点按无行为，
        // 图片附件同样不开灯箱。取不到几何时退回整行打开（旧行为）。
        if (geo == null) {
          if (node.fileId != null) await _openAttachmentFile(node.fileId!);
          return;
        }
        final xPx = geo.relX * geo.width;
        if (xPx < 28) {
          _insertEmptyParagraphNear(node, after: false);
        } else if (geo.dxFromRight < 28) {
          _insertEmptyParagraphNear(node, after: true);
        } else if (geo.dxFromRight < 120) {
          if (node.fileId != null) await _openAttachmentFile(node.fileId!);
        }
    }
  }

  /// 图文块全文面板：编辑即时回写节点正文并保存。
  void _openImageTextSheetFor(MediaNode node) {
    final document = _docContaining(node.id) ?? _document;
    if (document == null) return;
    showImageTextSheet(
      context,
      initialText: node.text,
      onChange: (value) {
        final current = document.getNodeById(node.id);
        if (current is MediaNode) {
          document.replaceNodeById(
            node.id,
            MediaNode(
              id: current.id,
              kind: current.kind,
              attrs: current.attrs,
              fileId: current.fileId,
              imageFlag: current.imageFlag,
              text: value,
              metadata: current.metadata,
            ),
          );
          _markDirty();
          _scheduleAutosave();
          if (mounted) setState(() {});
        }
      },
    );
  }

  /// 占位图片点击 → 选图填入该块（原版 pendingImageBlock 流程）：
  /// gallery 追加 items，其余双写 fileId 字段 + attrs.fileId 镜像。
  Future<void> _pickImageForNode(
    MediaNode node, {
    bool multiple = false,
  }) async {
    final document = _docContaining(node.id) ?? _document;
    if (document == null) return;
    List<XFile> files;
    const group = XTypeGroup(
      label: '图片',
      extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
    );
    if (multiple) {
      files = await openFiles(acceptedTypeGroups: [group]);
    } else {
      final f = await openFile(acceptedTypeGroups: [group]);
      files = f == null ? [] : [f];
    }
    if (files.isEmpty) return;
    try {
      final store = await ref.read(attachmentStoreProvider.future);
      final db = ref.read(databaseProvider);
      final newIds = <String>[];
      for (final file in files) {
        final bytes = await file.readAsBytes();
        final mime = file.mimeType ?? _guessMime(file.name);
        if (!mime.startsWith('image/')) continue;
        final fileId = Editor.createNodeId();
        await store.write(fileId, bytes);
        await db
            .into(db.attachments)
            .insertOnConflictUpdate(
              AttachmentsCompanion.insert(
                id: fileId,
                memoId: Value(widget.memoId),
                name: Value(file.name),
                mime: Value(mime),
                size: Value(bytes.length),
                localPath: 'attachments/$fileId',
                createdAt: DateTime.now().millisecondsSinceEpoch,
              ),
            );
        newIds.add(fileId);
      }
      if (newIds.isEmpty) {
        if (mounted) {
          _showEditorToast('❌ 此处只接受图片文件，请重新选择。');
        }
        return;
      }
      final current = document.getNodeById(node.id);
      if (current is! MediaNode) return;
      final attrs = Map<String, dynamic>.from(current.attrs);
      if (node.kind == 'gallery') {
        final items = List<dynamic>.from((attrs['items'] as List?) ?? const []);
        items.addAll(newIds.map((id) => {'fileId': id}));
        attrs['items'] = items;
      } else {
        attrs['fileId'] = newIds.first;
      }
      document.replaceNodeById(
        node.id,
        MediaNode(
          id: current.id,
          kind: current.kind,
          attrs: attrs,
          // L3：选图填入必须同步 fileId 字段（运行时口径），只写
          // attrs 会被旧字段覆盖、保存重开后静默回退旧图
          fileId: node.kind == 'gallery' ? current.fileId : newIds.first,
          imageFlag: current.imageFlag,
          text: current.text,
          metadata: current.metadata,
        ),
      );
      _markDirty();
      _scheduleAutosave();
      if (mounted) setState(() {});
      Diag.log('EDITOR', 'image filled for ${node.kind} ${node.id}');
    } catch (e) {
      Diag.error('EDITOR', e);
      if (mounted) {
        _showEditorToast('❌ 卡片图片保存失败，未添加图片，请重试。');
      }
    }
  }

  /// 图片灯箱（原版：黑底 88%、contain、圆角 12、点按关闭）。
  Future<void> _openLightbox({String? fileId, required String src}) async {
    Widget? image;
    if (src.startsWith('http')) {
      image = Image.network(
        src,
        fit: BoxFit.contain,
        errorBuilder: (ctx, e, _) {
          // 原版：图片失败不开空灯箱
          Diag.log('EDITOR', 'lightbox image failed: $e');
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (Navigator.of(ctx).canPop()) Navigator.of(ctx).pop();
          });
          return const SizedBox.shrink();
        },
      );
    } else if (fileId != null && fileId.isNotEmpty) {
      try {
        final store = await ref.read(attachmentStoreProvider.future);
        final bytes = await store.read(fileId);
        if (bytes != null) image = Image.memory(bytes, fit: BoxFit.contain);
      } catch (_) {}
    }
    if (image == null || !mounted) return;
    // 原版灯箱无开场动画
    await showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: '关闭灯箱',
      barrierColor: const Color(0xE0000000),
      transitionDuration: Duration.zero,
      pageBuilder: (dialogContext, _, __) => GestureDetector(
        onTap: () => Navigator.pop(dialogContext),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: image,
          ),
        ),
      ),
    );
  }

  /// 附件文件打开：Web 平台以新标签/下载交付字节（原版为点击打开文件）。
  Future<void> _openAttachmentFile(String fileId) async {
    try {
      final db = ref.read(databaseProvider);
      final store = await ref.read(attachmentStoreProvider.future);
      final row = await (db.select(
        db.attachments,
      )..where((t) => t.id.equals(fileId))).getSingleOrNull();
      final bytes = await store.read(fileId);
      if (bytes == null) return;
      await shareOrDownloadBytes(
        bytes,
        row?.name ?? 'attachment',
        mime: row?.mime,
      );
      Diag.log('EDITOR', 'attachment opened $fileId');
    } catch (e) {
      Diag.error('EDITOR', e);
    }
  }

  /// 卡片点按（原版）：有 url 打开链接（error 音乐卡点卡身同理，
  /// 重试只走卡片上的「重试」按钮）；input/empty 态弹出输入框。
  void _handleCardTap(CardNode node) {
    // embedCard 在原版按纯文本段落呈现，无任何点按行为
    if (node.kind == 'embedCard') return;
    final status = node.status ?? 'empty';
    if (status == 'input' &&
        (node.kind == 'musicCard' || node.kind == 'link-card')) {
      _beginCardUrlEdit(node);
      return;
    }
    final geo = _tapGeometry(node.id);
    // 音乐卡 error 态：右侧「重试」按钮区（约右 76px 内）走重试，
    // 其余区域与原版一致打开链接
    if (node.kind == 'musicCard' &&
        status == 'error' &&
        geo != null &&
        geo.dxFromRight < 76) {
      _retryCard(node);
      return;
    }
    // 卡片右侧区（>85% 宽）：在卡后插入空段并聚焦（原版分区点击）
    if (geo != null && geo.relX > 0.85 && status != 'empty') {
      _insertEmptyParagraphNear(node, after: true);
      return;
    }
    final url = node.url ?? '';
    if (url.startsWith('http')) {
      openUrlInNewTab(url);
      Diag.log('EDITOR', 'card open $url');
    } else if (status == 'empty') {
      // 音乐卡/链接卡：原版为卡内原地输入（不用弹窗）；其余卡片走 sheet
      if (node.kind == 'musicCard' || node.kind == 'link-card') {
        _beginCardUrlEdit(node);
      } else {
        _promptCardUrl(node);
      }
    }
  }

  /// 组件全局矩形（Stack 与屏幕同原点，可直接作 Positioned 坐标）。
  Rect? _componentGlobalRect(String nodeId) {
    for (final key in [_docLayoutKey, _docLayoutKeyB]) {
      final state = key.currentState;
      if (state == null) continue;
      try {
        final layout = state as DocumentLayout;
        final comp = layout.getComponentByNodeId(nodeId);
        final box = comp?.context.findRenderObject() as RenderBox?;
        if (box == null || !box.hasSize) continue;
        return box.localToGlobal(Offset.zero) & box.size;
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  /// 空文档占位符锚点：首段落 offset 0 的光标矩形左上（全局）与
  /// 正文右界。占位文本按正文度量渲染并锚定于此，与手打文字的
  /// 第一行逐像素重合（旧实现是手调常量位置，与段落行盒错位，
  /// 光标看着悬空不协调；原版 ::before 也是锚在正文首行区）。
  ({double left, double top, double right})? _placeholderAnchor() {
    final doc = _document;
    if (doc == null || doc.length != 1) return null;
    final first = doc.first;
    if (first is! ParagraphNode) return null;
    for (final key in [_docLayoutKey, _docLayoutKeyB]) {
      final state = key.currentState;
      if (state == null) continue;
      try {
        final layout = state as DocumentLayout;
        final rect = layout.getRectForPosition(
          DocumentPosition(
            nodeId: first.id,
            nodePosition: const TextNodePosition(offset: 0),
          ),
        );
        if (rect == null) continue;
        final g = layout.getGlobalOffsetFromDocumentOffset(rect.topLeft);
        final comp = layout.getComponentByNodeId(first.id);
        final box = comp?.context.findRenderObject() as RenderBox?;
        if (box == null || !box.hasSize) continue;
        final right = box.localToGlobal(Offset(box.size.width, 0)).dx - 16;
        return (left: g.dx, top: g.dy, right: right);
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  /// 进入卡内 URL 编辑：doc 状态置 input（走事务，组件重绘为
  /// 输入态占位），覆盖层胶囊在卡片原位接管输入（原版 replaceWith 语义）。
  void _beginCardUrlEdit(CardNode node) {
    final document = _docContaining(node.id) ?? _document;
    if (document == null) return;
    final editor = identical(document, _docB) ? _editorB : _editor;
    try {
      editor?.execute([
        ReplaceNodeRequest(
          existingNodeId: node.id,
          newNode: node.copyWith(status: 'input'),
        ),
      ]);
    } catch (e) {
      Diag.error('EDITOR', 'card input state failed: $e');
    }
    pasteFormGuardActive = true;
    _cardEditController.clear();
    setState(() => _cardEditId = node.id);
    Diag.log('EDITOR', 'card url edit begin ${node.id}');
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _cardEditId == node.id) {
        _cardEditFocus.requestFocus();
      }
    });
    // D5：卡片滚入可见带——卡在屏幕下部时键盘升起会盖住输入胶囊；
    // 聚焦后立即一遍、键盘到位（约 400ms）后再补一遍
    _ensureCardEditVisible(node.id);
    Future.delayed(const Duration(milliseconds: 400), () {
      if (mounted && _cardEditId == node.id) _ensureCardEditVisible(node.id);
    });
  }

  /// D5：把正在编辑 URL 的卡片滚进 [坞下, 键盘上] 的可见带
  /// （与 _ensureCaretVisible 同口径，作用于卡片组件矩形）。
  void _ensureCardEditVisible(String nodeId) {
    try {
      final rect = _componentGlobalRect(nodeId);
      if (rect == null) return;
      final mq = MediaQuery.of(context);
      final bandTop = effectiveInsets(mq.padding, hostInsets.value).top + 96;
      final bandBottom = mq.size.height - mq.viewInsets.bottom - 12;
      var delta = 0.0;
      if (rect.bottom > bandBottom) {
        delta = rect.bottom - bandBottom + 16;
      } else if (rect.top < bandTop) {
        delta = rect.top - bandTop - 8;
      }
      if (delta == 0) return;
      if (bodyScrollSupported) {
        scrollWindowTo(bodyScrollY.value + delta);
        return;
      }
      final doc = _docContaining(nodeId);
      final sc = identical(doc, _docB) ? _scrollB : _scrollController;
      if (!sc.hasClients) return;
      final target = (sc.offset + delta)
          .clamp(0.0, sc.position.maxScrollExtent)
          .toDouble();
      if ((target - sc.offset).abs() > 1) {
        sc.animateTo(
          target,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    } catch (_) {
      // 布局未就绪静默跳过（增强项，非正确性依赖）
    }
  }

  /// 提交卡内编辑（回车/失焦/点外）：有 URL 走解析；空则回退
  /// empty 态（原版 blur 时强制清除 pending 输入状态的口径）。
  void _commitCardUrlEdit() {
    final id = _cardEditId;
    if (id == null) return;
    _cardEditId = null;
    pasteFormGuardActive = false;
    final raw = _cardEditController.text.trim();
    _cardEditController.clear();
    final document = _docContaining(id);
    final node = document?.getNodeById(id);
    if (mounted) setState(() {});
    if (document == null || node is! CardNode) return;
    if (raw.isEmpty) {
      final editor = identical(document, _docB) ? _editorB : _editor;
      try {
        editor?.execute([
          ReplaceNodeRequest(
            existingNodeId: id,
            newNode: node.copyWith(status: 'empty'),
          ),
        ]);
      } catch (e) {
        Diag.error('EDITOR', 'card input revert failed: $e');
      }
      _markDirty();
      _scheduleAutosave();
      return;
    }
    _applyCardUrl(document, node, raw);
  }

  /// URL 落卡 + 解析（sheet 路径与卡内路径共用）：抽取链接、
  /// 置 loading 后异步补元数据。
  void _applyCardUrl(MutableDocument document, CardNode node, String url) {
    var resolved = RegExp(r'https?://[^\s]+').firstMatch(url)?.group(0) ?? url;
    if (!resolved.startsWith('http') &&
        RegExp(r'^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(/[^\s]*)?$')
            .hasMatch(resolved)) {
      resolved = 'https://$resolved';
    }
    document.replaceNodeById(
      node.id,
      node.copyWith(url: resolved, status: 'loading', justCreated: true),
    );
    if (mounted) setState(() {});
    resolvePasteCard(document: document, cardId: node.id, url: resolved).then((
      _,
    ) {
      _markDirty();
      _scheduleAutosave();
      if (mounted) setState(() {});
    });
  }

  void _retryCard(CardNode node) {
    final document = _docContaining(node.id) ?? _document;
    final url = node.url;
    if (document == null || url == null || url.isEmpty) return;
    if (node.status == 'loading') return; // 解析中防重入（原版守卫）
    document.replaceNodeById(
      node.id,
      node.copyWith(status: 'loading', justCreated: true),
    );
    if (mounted) setState(() {});
    resolvePasteCard(document: document, cardId: node.id, url: url).then((_) {
      _markDirty();
      _scheduleAutosave();
      if (mounted) setState(() {});
    });
    Diag.log('EDITOR', 'music retry $url');
  }

  /// 编辑器玻璃 toast（原版编辑器无 SnackBar；规格与备份页 toast 一致：
  /// 底部安全区 +16、glass overlay、圆角 28、内距 14/16、14px w500；
  /// ❌ 前缀为错误（6 秒），其余 3 秒）。
  void _showEditorToast(String message) {
    _editorToastTimer?.cancel();
    if (mounted) setState(() => _editorToast = message);
    _editorToastTimer = Timer(
      Duration(seconds: message.startsWith('❌') ? 6 : 3),
      () {
        if (mounted) setState(() => _editorToast = null);
      },
    );
  }

  Widget _editorToastWidget() {
    final msg = _editorToast!;
    final isError = msg.startsWith('❌');
    final text = msg.replaceFirst(RegExp(r'^[✅❌]\s*'), '');
    final safeBottom = effectiveInsets(
      MediaQuery.of(context).padding,
      hostInsets.value,
    ).bottom;
    return Positioned(
      left: 16,
      right: 16,
      bottom: 16 + safeBottom,
      child: TweenAnimationBuilder<double>(
        key: ValueKey(msg),
        tween: Tween(begin: 0, end: 1),
        duration: const Duration(milliseconds: 220),
        curve: const Cubic(0.34, 1.56, 0.64, 1),
        builder: (context, t, child) => Opacity(
          opacity: t.clamp(0, 1),
          child: Transform.translate(
            offset: Offset(0, 24 * (1 - t)),
            child: Transform.scale(scale: 0.94 + 0.06 * t, child: child),
          ),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: BackdropFilter(
            filter: MynoteTokens.overlayFilter,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: MynoteTokens.glassOverlayBg,
                border: Border.all(
                  color: MynoteTokens.glassOverlayBorder,
                  width: 0.5,
                ),
                borderRadius: BorderRadius.circular(28),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (isError) const Text('❌', style: TextStyle(fontSize: 16)),
                  if (isError) const SizedBox(width: 10),
                  Flexible(
                    child: Text(
                      text,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        height: 1.35,
                        color: MynoteTokens.textMain,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// URL 输入玻璃 sheet（原版为卡内联输入；应用内最接近的形态是
  /// 与其他面板一致的底部玻璃 sheet，输入规格同斜杠链接表单）。
  Future<String?> _promptUrlSheet({
    required String label,
    required String submitLabel,
  }) async {
    final controller = TextEditingController();
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide(color: MynoteTokens.border, width: 1),
    );
    // sheet 打开期间粘贴归输入框，编辑器粘贴桥放行
    pasteFormGuardActive = true;
    try {
      return await showMynoteSheet<String>(
        context: context,
        // 安全区：外层下距 = 安全区 + 14（原版弹层统一口径），安全区取
        // 生效值（引擎与宿主桥取大）——框架 SafeArea 只读引擎值，
        // 嵌入 Web 恒 0（2026-11-20 审计修正）。
        builder: (sheetContext) {
          final effBottom = effectiveInsets(
            MediaQuery.of(sheetContext).padding,
            hostInsets.value,
          ).bottom;
          return Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.of(sheetContext).viewInsets.bottom,
            ),
            child: Center(
              child: Container(
                constraints: const BoxConstraints(maxWidth: 600),
                margin: EdgeInsets.fromLTRB(14, 0, 14, 14 + effBottom),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(28),
                  child: BackdropFilter(
                    filter: MynoteTokens.overlayFilter,
                    child: Container(
                      decoration: BoxDecoration(
                        color: MynoteTokens.glassOverlayBg,
                        border: Border.all(
                          color: MynoteTokens.glassOverlayBorder,
                          width: 0.5,
                        ),
                        borderRadius: BorderRadius.circular(28),
                      ),
                      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            label,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: MynoteTokens.textMain,
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: controller,
                            autofocus: true,
                            keyboardType: TextInputType.url,
                            style: TextStyle(
                              fontSize: 16,
                              color: MynoteTokens.textMain,
                            ),
                            decoration: InputDecoration(
                              hintText: 'https://…',
                              filled: true,
                              fillColor: MynoteTokens.fillSubtle,
                              isDense: true,
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 11,
                                vertical: 9,
                              ),
                              constraints: const BoxConstraints(minHeight: 44),
                              border: border,
                              enabledBorder: border,
                              focusedBorder: border,
                            ),
                            onSubmitted: (v) =>
                                Navigator.pop(sheetContext, v.trim()),
                          ),
                          const SizedBox(height: 12),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              _slashFormButton(
                                '取消',
                                primary: false,
                                onTap: () => Navigator.pop(sheetContext),
                              ),
                              const SizedBox(width: 8),
                              _slashFormButton(
                                submitLabel,
                                primary: true,
                                onTap: () => Navigator.pop(
                                  sheetContext,
                                  controller.text.trim(),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      );
    } finally {
      pasteFormGuardActive = false;
    }
  }

  Future<void> _promptCardUrl(CardNode node) async {
    final url = await _promptUrlSheet(
      label: node.kind == 'musicCard' ? '粘贴音乐链接' : '输入链接',
      submitLabel: '解析',
    );
    final document = _docContaining(node.id) ?? _document;
    if (url == null || url.isEmpty || document == null || !mounted) return;
    _applyCardUrl(document, node, url);
  }

  /// 选区/文档变化时重算斜杠 token 与菜单项（诊断：SLASH open/close 打点）
  /// 导出面板（原版：与 ••• 菜单同位置同宽的锚定面板，头部带返回钮）。
  void _showExportSheet() {
    _showAnchoredPanel(
      closeScale: 0.94,
      (sheetContext) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.only(bottom: 5),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: MynoteTokens.glassOverlayBorder,
                  width: 0.5,
                ),
              ),
            ),
            child: SizedBox(
              height: 46,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: GestureDetector(
                      onTap: () async {
                        Navigator.pop(sheetContext);
                        await Future<void>.delayed(
                          const Duration(milliseconds: 220),
                        );
                        if (mounted) _showMoreSheet();
                      },
                      child: Container(
                        width: 46,
                        height: 46,
                        decoration: BoxDecoration(
                          color: MynoteTokens.glassControlBg,
                          border: Border.all(
                            color: MynoteTokens.glassControlBorder,
                            width: 0.5,
                          ),
                          shape: BoxShape.circle,
                        ),
                        child: Center(
                          child: SvgPicture.string(
                            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
                            width: 22,
                            height: 22,
                            colorFilter: ColorFilter.mode(
                              MynoteTokens.textMain,
                              BlendMode.srcIn,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  Text(
                    '导出笔记',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: MynoteTokens.textMain,
                    ),
                  ),
                ],
              ),
            ),
          ),
          for (final option in [
            ('markdown', 'Markdown', '保存为 .md 文件', 'MD'),
            ('html', 'HTML', '保存为独立网页', '<>'),
            ('pdf', 'PDF', '打印或存储为 PDF', 'PDF'),
          ])
            _exportRow(
              badge: option.$4,
              title: option.$2,
              subtitle: option.$3,
              onTap: () {
                Navigator.pop(sheetContext);
                _exportAs(option.$1);
              },
            ),
          Container(
            margin: const EdgeInsets.fromLTRB(4, 5, 4, 2),
            padding: const EdgeInsets.fromLTRB(5, 9, 5, 2),
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(
                  color: MynoteTokens.glassOverlayBorder,
                  width: 0.5,
                ),
              ),
            ),
            child: Text(
              'PDF 会打开浏览器打印窗口，可在其中存储为 PDF。',
              style: TextStyle(
                fontSize: 10,
                height: 1.45,
                color: MynoteTokens.textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// 导出选项行（原版专用规格）：minHeight 54、内距 9/6、圆角 14、
  /// 徽标盒 34×34（>2 字时字号 9）、标题 14、副题 11、尾 › 占位强色。
  Widget _exportRow({
    required String badge,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    // 按压反馈（原版导出行 :active）：scale(0.975) + bg strong、150ms
    return _SlashRow(
      onTap: onTap,
      pressedScale: 0.975,
      scaleMs: 150,
      radius: 15,
      child: Container(
        constraints: const BoxConstraints(minHeight: 54),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 9),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: MynoteTokens.fillAccent10,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                badge,
                style: TextStyle(
                  fontSize: badge.length > 2 ? 9 : 11,
                  fontWeight: FontWeight.w700,
                  color: MynoteTokens.accent,
                ),
              ),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: MynoteTokens.textMain,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 11,
                      color: MynoteTokens.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              '›',
              style: TextStyle(
                fontSize: 19,
                color: MynoteTokens.placeholderStrong,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _exportAs(String format) async {
    final document = _document;
    if (document == null) return;
    try {
      final docJson = _mergedDocJson();
      final db = ref.read(databaseProvider);
      final store = await ref.read(attachmentStoreProvider.future);
      final files = await buildExportFiles(db, store, docJson);
      final title = _titleController.text.trim().isEmpty
          ? '无标题'
          : _titleController.text.trim();
      final avatarUrl = _avatarBytes != null
          ? 'data:image/png;base64,${base64Encode(_avatarBytes!)}'
          : null;
      switch (format) {
        case 'markdown':
          final md = docToMarkdown(docJson, title, files);
          downloadBytes(
            utf8Bytes(md),
            toExportFilename(title, 'md'),
            mime: 'text/markdown',
          );
        case 'html':
          final subtitle =
              '${exportTimeAgo(_memo?.updatedAt ?? 0, use24h: MediaQuery.of(context).alwaysUse24HourFormat)} · ${exportCharCount(docJson)}字';
          final html = buildExportHtml(
            docJson,
            title,
            files,
            subtitle: subtitle,
            bgColor: _bgColor,
            avatarUrl: avatarUrl,
            dark: Theme.of(context).brightness == Brightness.dark,
          );
          downloadBytes(
            utf8Bytes(html),
            toExportFilename(title, 'html'),
            mime: 'text/html',
          );
        case 'pdf':
          final subtitle =
              '${exportTimeAgo(_memo?.updatedAt ?? 0, use24h: MediaQuery.of(context).alwaysUse24HourFormat)} · ${exportCharCount(docJson)}字';
          printHtml(
            buildExportHtml(
              docJson,
              title,
              files,
              subtitle: subtitle,
              bgColor: _bgColor,
              avatarUrl: avatarUrl,
              dark: Theme.of(context).brightness == Brightness.dark,
            ),
          );
      }
      Diag.log('EXPORT', 'exported $format title=$title');
    } catch (e) {
      Diag.error('EXPORT', e);
      if (mounted) {
        _showEditorToast('❌ 导出失败，请重试。');
      }
    }
  }

  /// Web 粘贴桥回调：JS 已拦下含链接/图片的粘贴，这里按原版策略执行。
  void _handleWebPaste(PastePayload payload) {
    // 表单守卫：焦点在标题/链接表单/图文 sheet 时放行原生粘贴，
    // 不把 URL 劫持成正文插卡（原版粘贴只作用于编辑器）
    if (pasteFormGuardActive ||
        _titleFocusNode.hasFocus ||
        _slashLinkFocusNode.hasFocus) {
      return;
    }
    final document = _activeDocument;
    final composer = _activeComposer;
    if (!mounted || document == null || composer == null) return;
    final decision = classifyPaste(
      text: payload.text,
      hasImageFiles: payload.imageCount > 0,
    );
    try {
      switch (decision.kind) {
        case PasteKind.pureUrlCard:
        case PasteKind.embeddedMediaCard:
          _pasteLinkCard(document, composer, decision.url!, null);
        case PasteKind.embeddedUrlWithRemainder:
          _pasteLinkCard(document, composer, decision.url!, decision.remainder);
        case PasteKind.plainText:
          _insertTextAtSelection(document, composer, payload.text);
          _markDirty();
          _save();
          if (mounted) setState(() {});
        case PasteKind.imageFiles:
          _insertPastedImages(document, composer, payload);
        case PasteKind.musicInputUrl:
          break; // 音乐卡输入框自行处理
      }
    } catch (e) {
      Diag.error('PASTE', e);
    }
  }

  /// 图片粘贴：字节 → 附件存储（Web 为 OPFS）+ DB 元数据 + 图片块。
  Future<void> _insertPastedImages(
    MutableDocument document,
    MutableDocumentComposer composer,
    PastePayload payload,
  ) async {
    try {
      final selection = composer.selection;
      if (selection == null) return;
      final store = await ref.read(attachmentStoreProvider.future);
      final db = ref.read(databaseProvider);
      var afterId = selection.extent.nodeId;
      for (var i = 0; i < payload.imageCount; i++) {
        final bytes = await readPasteFileBytes(i);
        if (bytes == null) {
          Diag.error('PASTE', 'image $i bytes unavailable');
          continue;
        }
        final mime =
            i < payload.imageTypes.length && payload.imageTypes[i].isNotEmpty
            ? payload.imageTypes[i]
            : 'image/png';
        final ext = mime.split('/').last.replaceAll('jpeg', 'jpg');
        final fileId = Editor.createNodeId();
        await store.write(fileId, Uint8List.fromList(bytes));
        await db
            .into(db.attachments)
            .insertOnConflictUpdate(
              AttachmentsCompanion.insert(
                id: fileId,
                memoId: Value(widget.memoId),
                name: Value('pasted-image.$ext'),
                mime: Value(mime),
                size: Value(bytes.length),
                localPath: 'attachments/$fileId',
                createdAt: DateTime.now().millisecondsSinceEpoch,
              ),
            );
        final node = MediaNode(
          id: Editor.createNodeId(),
          kind: 'image',
          // L3：字段与 attrs 镜像双写，渲染当场可读（只写 attrs 时
          // 当前会话显示空占位、重开才出现）
          fileId: fileId,
          attrs: {'fileId': fileId},
        );
        document.insertNodeAfter(existingNodeId: afterId, newNode: node);
        afterId = node.id;
        Diag.log(
          'PASTE',
          'image inserted file=$fileId (${bytes.length}B, $mime)',
        );
      }
      _markDirty();
      _save();
      if (mounted) setState(() {});
    } catch (e) {
      Diag.error('PASTE', e);
    }
  }

  void _pasteLinkCard(
    MutableDocument document,
    MutableDocumentComposer composer,
    String url,
    String? remainder,
  ) {
    final cardId = insertPasteLinkCard(
      document: document,
      composer: composer,
      url: url,
      remainder: remainder,
    );
    _markDirty();
    _save();
    // JS 回调里改文档不会自动触发编辑器布局重建，需显式 setState 唤醒
    if (mounted) setState(() {});
    resolvePasteCard(document: document, cardId: cardId, url: url).then((_) {
      if (mounted) {
        _markDirty();
        _save();
        setState(() {});
      }
    });
  }

  /// 被 JS 拦下但分类为纯文本时，手动把文本插回选区（替换选区范围）。
  void _insertTextAtSelection(
    MutableDocument document,
    MutableDocumentComposer composer,
    String text,
  ) {
    final selection = composer.selection;
    if (selection == null) return;
    final node = document.getNodeById(selection.extent.nodeId);
    if (node is! TextNode) return;
    final start = selection.base.nodePosition as TextNodePosition;
    final end = selection.extent.nodePosition as TextNodePosition;
    final from = start.offset < end.offset ? start.offset : end.offset;
    final to = start.offset < end.offset ? end.offset : start.offset;
    final old = node.text.text;
    final replaced = old.replaceRange(from, to, text);
    document.replaceNodeById(
      node.id,
      ParagraphNode(
        id: node.id,
        text: AttributedText(replaced),
        metadata: node.metadata,
      ),
    );
    composer.setSelectionWithReason(
      DocumentSelection.collapsed(
        position: DocumentPosition(
          nodeId: node.id,
          nodePosition: TextNodePosition(offset: from + text.length),
        ),
      ),
    );
    Diag.log('PASTE', 'plain reinsert ${text.length} chars');
  }

  void _updateSlashState() {
    final document = _activeDocument;
    final composer = _activeComposer;
    if (document == null || composer == null || !mounted) return;
    SlashToken? token;
    final sel = composer.selection;
    if (sel != null && !sel.isCollapsed) {
      final n = document.getNodeById(sel.extent.nodeId);
      final bp = sel.base.nodePosition;
      final ep = sel.extent.nodePosition;
      if (n is TextNode && bp is TextNodePosition && ep is TextNodePosition) {
        final s = bp.offset < ep.offset ? bp.offset : ep.offset;
        final e = bp.offset < ep.offset ? ep.offset : bp.offset;
        final plain = n.text.toPlainText();
        if (e <= plain.length) {
          _selectionSnapshot = (
            nodeId: n.id,
            start: s,
            end: e,
            text: plain.substring(s, e),
          );
        }
      }
    }
    if (sel != null && sel.isCollapsed) {
      final node = document.getNodeById(sel.extent.nodeId);
      final pos = sel.extent.nodePosition;
      if (node is TextNode && pos is TextNodePosition) {
        token = detectSlashToken(node.text.toPlainText(), pos.offset);
      }
    }
    final wasOpen = _slashToken != null;
    if (token == null && !wasOpen) return;
    if (token != null &&
        wasOpen &&
        token.query == _slashToken!.query &&
        token.start == _slashToken!.start &&
        token.end == _slashToken!.end) {
      return;
    }
    if (token != null && !wasOpen) Diag.log('SLASH', 'open');
    if (token == null && wasOpen) Diag.log('SLASH', 'close');
    setState(() {
      _slashToken = token;
      _slashItems = token == null
          ? const []
          : filterSlashCommands(
              slashCommands,
              token.query,
              recentIds: _recentSlashIds,
            );
      _slashSelected = 0;
      if (token != null && !wasOpen) _slashAnimSeed++;
      if (token == null) {
        _slashLinkForm = false;
        _slashLinkPending = null;
        _slashLinkError = '';
      }
    });
  }

  /// 斜杠面板键盘导航（原版 slash-keydown.js）：↑↓ 循环、Home/End、
  /// 回车应用选中项、Esc 关闭；面板未开或链接表单态时不拦截。
  /// 编辑器级快捷键（原版有而 SE 缺）：Ctrl+Y 重做（SE 只有 Ctrl+Shift+Z）；
  /// 双栏模式下光标在栏界时 ArrowLeft/Right 跨栏（原版双栏连续编辑）。
  bool _editorShortcutHandler(KeyEvent event) {
    if (!mounted || event is! KeyDownEvent) return false;
    final kb = HardwareKeyboard.instance;
    if (event.logicalKey == LogicalKeyboardKey.keyY &&
        kb.isControlPressed &&
        !kb.isShiftPressed &&
        !kb.isMetaPressed &&
        (_editorFocusNode.hasFocus || _focusB.hasFocus)) {
      _activeEditor?.redo();
      return true;
    }
    if (_editorB == null || _docB == null) return false;
    final key = event.logicalKey;
    if (key != LogicalKeyboardKey.arrowLeft &&
        key != LogicalKeyboardKey.arrowRight) {
      return false;
    }
    if (kb.isControlPressed ||
        kb.isMetaPressed ||
        kb.isAltPressed ||
        kb.isShiftPressed) {
      return false;
    }
    final composer = _activeComposer;
    final document = _activeDocument;
    if (composer == null || document == null) return false;
    final sel = composer.selection;
    if (sel == null || !sel.isCollapsed) return false;
    final pos = sel.extent;
    final node = document.getNodeById(pos.nodeId);
    if (node is! TextNode || pos.nodePosition is! TextNodePosition)
      return false;
    final offset = (pos.nodePosition as TextNodePosition).offset;
    if (_activeB && key == LogicalKeyboardKey.arrowLeft && offset == 0) {
      // B 栏首文本块行首 → 回 A 栏末文本块末尾
      final firstText = document.whereType<TextNode>().firstOrNull;
      if (firstText == null ||
          document.getNodeIndexById(pos.nodeId) !=
              document.getNodeIndexById(firstText.id)) {
        return false;
      }
      final docA = _document!;
      final lastA = docA.whereType<TextNode>().lastOrNull;
      if (lastA == null) return false;
      _focusB.unfocus();
      _editorFocusNode.requestFocus();
      _activeB = false;
      _composer!.setSelectionWithReason(
        DocumentSelection.collapsed(
          position: DocumentPosition(
            nodeId: lastA.id,
            nodePosition: TextNodePosition(offset: lastA.text.length),
          ),
        ),
      );
      return true;
    }
    if (!_activeB && key == LogicalKeyboardKey.arrowRight) {
      final textLen = node.text.length;
      if (offset != textLen) return false;
      final lastText = document.whereType<TextNode>().lastOrNull;
      if (lastText == null ||
          document.getNodeIndexById(pos.nodeId) !=
              document.getNodeIndexById(lastText.id)) {
        return false;
      }
      final firstB = _docB!.whereType<TextNode>().firstOrNull;
      if (firstB == null) return false;
      _editorFocusNode.unfocus();
      _focusB.requestFocus();
      _activeB = true;
      _composerB!.setSelectionWithReason(
        DocumentSelection.collapsed(
          position: DocumentPosition(
            nodeId: firstB.id,
            nodePosition: const TextNodePosition(offset: 0),
          ),
        ),
      );
      return true;
    }
    return false;
  }

  bool _slashKeyHandler(KeyEvent event) {
    if (!mounted || _slashToken == null || _slashLinkForm) return false;
    if (event is! KeyDownEvent) return false;
    final items = _slashItems;
    if (items.isEmpty) return false;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown) {
      setState(() => _slashSelected = (_slashSelected + 1) % items.length);
      return true;
    }
    if (key == LogicalKeyboardKey.arrowUp) {
      setState(
        () =>
            _slashSelected = (_slashSelected - 1 + items.length) % items.length,
      );
      return true;
    }
    if (key == LogicalKeyboardKey.home) {
      setState(() => _slashSelected = 0);
      return true;
    }
    if (key == LogicalKeyboardKey.end) {
      setState(() => _slashSelected = items.length - 1);
      return true;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      _applySlashItem(items[_slashSelected.clamp(0, items.length - 1)]);
      return true;
    }
    if (key == LogicalKeyboardKey.escape) {
      setState(() {
        _slashToken = null;
        _slashItems = const [];
      });
      return true;
    }
    return false;
  }

  /// 斜杠命令应用：链接命令先在面板内切到 URL 表单（原版行为），
  /// 其余命令直接执行。
  Future<void> _applySlashItem(SlashFilterItem item) async {
    if (item.command.type == 'inline_link') {
      _slashLinkPending = item;
      _slashLinkController.text = 'https://';
      _slashLinkController.selection = TextSelection.collapsed(
        offset: _slashLinkController.text.length,
      );
      setState(() {
        _slashLinkForm = true;
        _slashLinkError = '';
      });
      return;
    }
    await _applySlashItemWithUrl(item, null);
  }

  Future<void> _applySlashItemWithUrl(
    SlashFilterItem item,
    String? linkUrl,
  ) async {
    final document = _activeDocument;
    final composer = _activeComposer;
    final token = _slashToken;
    if (document == null || composer == null || token == null) return;
    try {
      final snap = _selectionSnapshot;
      final tokenNodeId = composer.selection?.extent.nodeId;
      if (item.command.type.startsWith('inline') &&
          snap != null &&
          snap.nodeId == tokenNodeId &&
          snap.start == token.start) {
        applySlashInlineWrap(
          document: document,
          composer: composer,
          command: item.command,
          token: token,
          snapshotText: snap.text,
          linkUrl: linkUrl,
          editor: _activeEditor,
        );
      } else {
        applySlashCommand(
          document: document,
          composer: composer,
          command: item.command,
          token: token,
          linkUrl: linkUrl,
          editor: _activeEditor,
        );
      }
      _recentSlashIds.remove(item.command.id);
      _recentSlashIds.insert(0, item.command.id);
      if (_recentSlashIds.length > 6) _recentSlashIds.removeLast();
      prefsSet('memos_slash_recent_v1', jsonEncode(_recentSlashIds));
    } catch (_) {
      // 具体错误已由 applySlashCommand 写 Diag；这里只提示
      if (mounted) {
        _showEditorToast('❌ 命令执行失败，详情见诊断日志');
      }
    }
    if (mounted) {
      setState(() {
        _slashToken = null;
        _slashItems = const [];
      });
    }
    // 音乐卡命令：卡片以 input 态插入，原版立即在卡内进入输入
    // （不等点按）——覆盖层胶囊直接接管
    if (item.command.type == 'musicCard') {
      for (final n in document) {
        if (n is CardNode &&
            n.kind == 'musicCard' &&
            (n.status ?? '') == 'input') {
          _beginCardUrlEdit(n);
          return;
        }
      }
    }
    (_activeB ? _focusB : _editorFocusNode).requestFocus();
  }

  static Widget _slashIcon(SlashCommand cmd) {
    return SlashSvgIcon(commandId: cmd.id);
  }

  /// 斜杠面板锚点（原版 slashAnchor：光标处弹出）：由当前选区
  /// 光标矩形换算全局坐标；下方空间不足时改到光标上方。
  /// 布局不可用时返回 null，面板回退为底部停靠。
  ({double left, double? top, double? bottom, double maxH})? _slashAnchor(
    double panelWidth,
  ) {
    try {
      final sel = _activeComposer?.selection;
      if (sel == null) return null;
      final key = _activeB ? _docLayoutKeyB : _docLayoutKey;
      final state = key.currentState;
      if (state == null) return null;
      final layout = state as DocumentLayout;
      final rect = layout.getRectForPosition(sel.extent);
      if (rect == null) return null;
      final globalTopLeft = layout.getGlobalOffsetFromDocumentOffset(
        rect.topLeft,
      );
      final size = MediaQuery.of(context).size;
      final eff = effectiveInsets(
        MediaQuery.of(context).padding,
        hostInsets.value,
      );
      final safeTop = eff.top;
      final safeBottom = eff.bottom;
      final left = globalTopLeft.dx
          .clamp(8.0, (size.width - panelWidth - 8).clamp(8.0, size.width))
          .toDouble();
      final belowTop = globalTopLeft.dy + rect.height + 6;
      final viewportBottom = size.height - safeBottom;
      // 原版翻转口径：按面板高 260 估算——belowTop+260 超过视口
      // 底-8 才翻到上方；上方时面板顶不低于视口顶+76
      if (belowTop + 260 <= viewportBottom - 8) {
        return (
          left: left,
          top: belowTop,
          bottom: null,
          maxH: (viewportBottom - 8 - belowTop).clamp(120.0, 320.0).toDouble(),
        );
      }
      final availAbove = globalTopLeft.dy - 6 - safeTop - 76;
      return (
        left: left,
        top: null,
        bottom: size.height - globalTopLeft.dy + 6,
        maxH: availAbove.clamp(80.0, 320.0).toDouble(),
      );
    } catch (_) {
      return null;
    }
  }

  /// slash 面板宽度（原版内容自适应）：min(360, max(220, 最长行
  /// 内容宽+12, vw-24))。行宽 = 面板内距 16 + 行内距 18 + 图标 24
  /// + 间隔 10 + 标题实测 + 最近标记 40 + 快捷键片（间隔 8 + 实测 + 内距 12）。
  double _slashPanelWidth() {
    final vw = MediaQuery.of(context).size.width;
    var content = 0.0;
    final scaler = MediaQuery.of(context).textScaler;
    for (final item in _slashItems) {
      var w = 16.0 + 18 + 24 + 10;
      final titlePainter = TextPainter(
        text: TextSpan(
          text: item.command.title,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
        textDirection: TextDirection.ltr,
        textScaler: scaler,
      )..layout();
      w += titlePainter.width;
      if (item.recent) w += 40;
      if (item.command.shortcut.isNotEmpty) {
        final scPainter = TextPainter(
          text: TextSpan(
            text: item.command.shortcut,
            style: const TextStyle(fontSize: 11, fontFamily: 'monospace'),
          ),
          textDirection: TextDirection.ltr,
          textScaler: scaler,
        )..layout();
        w += 8 + scPainter.width + 12;
      }
      if (w > content) content = w;
    }
    final byContent = (content + 12).clamp(220.0, 360.0);
    return byContent.clamp(0.0, (vw - 24).clamp(0.0, vw)).toDouble();
  }

  /// 匹配高亮（原版 hl()）：标题/副题中与查询字面相同的片段
  /// 以 accent 18% 底 + 600 字重标出（圆角/内距 CSS 可表达、富文本不表达）。
  TextSpan _hlSpan(String text, String query, TextStyle base) {
    if (query.isEmpty) return TextSpan(text: text, style: base);
    final idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return TextSpan(text: text, style: base);
    return TextSpan(
      children: [
        TextSpan(text: text.substring(0, idx), style: base),
        TextSpan(
          text: text.substring(idx, idx + query.length),
          style: base.copyWith(
            backgroundColor: MynoteTokens.fillAccent18,
            fontWeight: FontWeight.w600,
          ),
        ),
        TextSpan(text: text.substring(idx + query.length), style: base),
      ],
    );
  }

  void _submitSlashLink() {
    final raw = _slashLinkController.text.trim();
    final uri = Uri.tryParse(raw);
    if (uri == null ||
        !(uri.scheme == 'http' || uri.scheme == 'https') ||
        uri.host.isEmpty) {
      setState(() => _slashLinkError = '链接地址无效');
      return;
    }
    final url = raw.replaceAll('(', '%28').replaceAll(')', '%29');
    final pending = _slashLinkPending;
    setState(() {
      _slashLinkForm = false;
      _slashLinkError = '';
      _slashLinkPending = null;
    });
    if (pending != null) _applySlashItemWithUrl(pending, url);
  }

  Widget _slashFormButton(
    String label, {
    required bool primary,
    required VoidCallback onTap,
  }) {
    return Material(
      color: primary ? MynoteTokens.accent : MynoteTokens.fillHover,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        splashColor: Colors.transparent,
        highlightColor: MynoteTokens.fillHoverStrong,
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minWidth: 76, minHeight: 44),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: primary ? MynoteTokens.primaryBg : MynoteTokens.textMain,
            ),
          ),
        ),
      ),
    );
  }

  /// 斜杠链接表单（原版面板内表单）：标题「链接地址」、输入框
  /// min-height 44 / 内距 9·11 / 1px 边 / 圆角 10 / fillSubtle 底、
  /// 错误 12px danger、按钮行右对齐（min 76×44、圆角 999）。
  Widget _slashLinkFormBody() {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide(color: MynoteTokens.border, width: 1),
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 4, 4, 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '链接地址',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: MynoteTokens.textMain,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _slashLinkController,
            focusNode: _slashLinkFocusNode,
            autofocus: true,
            keyboardType: TextInputType.url,
            style: TextStyle(fontSize: 16, color: MynoteTokens.textMain),
            decoration: InputDecoration(
              filled: true,
              fillColor: MynoteTokens.fillSubtle,
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 11,
                vertical: 9,
              ),
              constraints: const BoxConstraints(minHeight: 44),
              border: border,
              enabledBorder: border,
              focusedBorder: border,
              errorText: _slashLinkError.isEmpty ? null : _slashLinkError,
              errorStyle: TextStyle(fontSize: 12, color: MynoteTokens.danger),
            ),
            onSubmitted: (_) => _submitSlashLink(),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              _slashFormButton(
                '取消',
                primary: false,
                onTap: () {
                  setState(() {
                    _slashLinkForm = false;
                    _slashLinkError = '';
                    _slashLinkPending = null;
                  });
                  (_activeB ? _focusB : _editorFocusNode).requestFocus();
                },
              ),
              const SizedBox(width: 8),
              _slashFormButton('插入', primary: true, onTap: _submitSlashLink),
            ],
          ),
        ],
      ),
    );
  }

  /// 卡内 URL 编辑覆盖层：全屏点外提交层 + 卡片原位的玻璃输入胶囊
  /// （padding 12/18、radius 999、glass-control，原版行内样式）。
  Widget _buildCardEditOverlay() {
    final nodeId = _cardEditId!;
    final document = _docContaining(nodeId);
    final node = document?.getNodeById(nodeId);
    final rect = _componentGlobalRect(nodeId);
    if (node is! CardNode || rect == null) {
      // 布局未就绪：下一帧重试（组件首帧可能尚未挂载）
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _cardEditId == nodeId) setState(() {});
      });
      return const Positioned.fill(child: SizedBox.shrink());
    }
    final isMusic = node.kind == 'musicCard';
    return Positioned.fill(
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: _commitCardUrlEdit,
            ),
          ),
          Positioned(
            left: rect.left,
            top: rect.top,
            width: rect.width,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: BackdropFilter(
                filter: MynoteTokens.controlFilter,
                child: Container(
                  decoration: BoxDecoration(
                    color: MynoteTokens.glassControlBg,
                    border: Border.all(
                      color: MynoteTokens.glassControlBorder,
                      width: 0.5,
                    ),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 2,
                  ),
                  child: Focus(
                    onKeyEvent: (focusNode, event) {
                      if (event is KeyDownEvent &&
                          event.logicalKey == LogicalKeyboardKey.escape) {
                        _commitCardUrlEdit();
                        return KeyEventResult.handled;
                      }
                      return KeyEventResult.ignored;
                    },
                    child: TextField(
                      controller: _cardEditController,
                      focusNode: _cardEditFocus,
                      style: TextStyle(
                        fontSize: 16,
                        color: MynoteTokens.textMain,
                      ),
                      decoration: InputDecoration(
                        border: InputBorder.none,
                        hintText: isMusic ? '粘贴音乐链接到这里...' : '粘贴链接到这里...',
                        hintStyle: TextStyle(
                          fontSize: 16,
                          color: MynoteTokens.placeholder,
                        ),
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(
                          vertical: 10,
                        ),
                      ),
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.go,
                      onSubmitted: (_) => _commitCardUrlEdit(),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSlashPanel() {
    final query = _slashToken?.query ?? '';
    final rows = <Widget>[];
    if (_slashItems.isEmpty && !_slashLinkForm) {
      rows.add(
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 24, 12, 20),
          child: Column(
            children: [
              Opacity(
                opacity: 0.45,
                child: Icon(
                  Icons.search,
                  size: 28,
                  color: MynoteTokens.textSecondary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '未找到匹配命令',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  height: 1.5,
                  color: MynoteTokens.textSecondary,
                ),
              ),
              const SizedBox(height: 6),
              Text.rich(
                TextSpan(
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.5,
                    color: MynoteTokens.textSecondary.withValues(alpha: 0.8),
                  ),
                  children: [
                    const TextSpan(text: '试试拼音首字母：'),
                    TextSpan(
                      text: 'bt',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        backgroundColor: MynoteTokens.fillHover,
                      ),
                    ),
                    const TextSpan(text: ' 标题 · '),
                    TextSpan(
                      text: 'tp',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        backgroundColor: MynoteTokens.fillHover,
                      ),
                    ),
                    const TextSpan(text: ' 图片 · '),
                    TextSpan(
                      text: 'yykp',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        backgroundColor: MynoteTokens.fillHover,
                      ),
                    ),
                    const TextSpan(text: ' 音乐'),
                  ],
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }
    String? lastSection;
    var firstSection = true;
    var rowIndex = -1;
    for (final item in _slashItems) {
      if (item.sectionLabel != null && item.sectionLabel != lastSection) {
        lastSection = item.sectionLabel;
        rows.add(
          Container(
            margin: EdgeInsets.only(top: firstSection ? 0 : 7),
            decoration: firstSection
                ? null
                : BoxDecoration(
                    border: Border(
                      top: BorderSide(color: MynoteTokens.border, width: 0.5),
                    ),
                  ),
            padding: const EdgeInsets.fromLTRB(8, 6, 8, 4),
            child: Text(
              item.sectionLabel!,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.385,
                color: MynoteTokens.textSecondary.withValues(alpha: 0.8),
              ),
            ),
          ),
        );
        firstSection = false;
      }
      rowIndex++;
      final idx = rowIndex;
      final selected = idx == _slashSelected;
      rows.add(
        _SlashRow(
          onTap: () => _applySlashItem(item),
          onHover: (hovering) {
            if (hovering && _slashSelected != idx) {
              setState(() => _slashSelected = idx);
            }
          },
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            margin: const EdgeInsets.symmetric(vertical: 1),
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
            decoration: BoxDecoration(
              color: selected ? MynoteTokens.fillHover : null,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                SizedBox(
                  width: 24,
                  height: 24,
                  child: Center(child: _slashIcon(item.command)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text.rich(
                              _hlSpan(
                                item.command.title,
                                query,
                                TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                  height: 1.25,
                                  color: MynoteTokens.textMain,
                                ),
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (item.recent) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 1,
                              ),
                              decoration: BoxDecoration(
                                color: MynoteTokens.glassControlBg,
                                border: Border.all(
                                  color: MynoteTokens.glassControlBorder,
                                  width: 0.5,
                                ),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                '最近',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: MynoteTokens.textSecondary,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text.rich(
                        _hlSpan(
                          item.command.subtitle,
                          query,
                          TextStyle(
                            fontSize: 12,
                            height: 1.35,
                            color: MynoteTokens.textSecondary,
                          ),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                if (item.command.shortcut.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Opacity(
                    opacity: 0.78,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: MynoteTokens.fillHover,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        item.command.shortcut,
                        style: TextStyle(
                          fontSize: 11,
                          height: 1.2,
                          fontFamily: 'monospace',
                          color: MynoteTokens.textSecondary,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }
    final panelWidth = _slashPanelWidth();
    final anchor = _slashAnchor(panelWidth);
    final panel = ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: BackdropFilter(
        filter: MynoteTokens.overlayFilter,
        child: Container(
          decoration: BoxDecoration(
            color: MynoteTokens.glassOverlayBg,
            border: Border.all(
              color: MynoteTokens.glassOverlayBorder,
              width: 0.5,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          padding: const EdgeInsets.all(8),
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: anchor?.maxH ?? 320),
            child: _slashLinkForm
                ? SingleChildScrollView(child: _slashLinkFormBody())
                : ListView(shrinkWrap: true, children: rows),
          ),
        ),
      ),
    );
    // 入场动画（原版 140ms ease：opacity + translateY −4→0）
    final animated = TweenAnimationBuilder<double>(
      key: ValueKey('slash-$_slashAnimSeed'),
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 140),
      curve: Curves.easeOut,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: Offset(0, -4 * (1 - t)),
          child: child,
        ),
      ),
      child: panel,
    );
    if (anchor != null) {
      return Positioned(
        left: anchor.left,
        top: anchor.top,
        bottom: anchor.bottom,
        width: panelWidth,
        child: animated,
      );
    }
    return Positioned(
      left: 8,
      right: 8,
      bottom:
          8 +
          effectiveInsets(
            MediaQuery.of(context).padding,
            hostInsets.value,
          ).bottom,
      child: animated,
    );
  }

  /// 宿主底色跟随本页底色（Web：html/body/theme-color 同步，
  /// 与原版 body 底色统一漆满安全区的模型一致；原生为空操作）。
  void _syncChromeToBg() {
    final dark =
        WidgetsBinding.instance.platformDispatcher.platformBrightness ==
        Brightness.dark;
    syncChromeColor(effectiveBgColor(_bgColor, dark) ?? MynoteTokens.editorBg);
  }

  @override
  void dispose() {
    // 离开编辑页：宿主底色恢复列表底色
    syncChromeColor(MynoteTokens.primaryBg);
    // 卡内 URL 编辑中途离开：未提交文本不落盘，状态回退 empty
    // （原版 blur 强制清除 pending 输入状态的口径）
    if (_cardEditId != null) {
      final doc = _docContaining(_cardEditId!);
      final n = doc?.getNodeById(_cardEditId!);
      if (doc != null && n is CardNode && (n.status ?? '') == 'input') {
        doc.replaceNodeById(n.id, n.copyWith(status: 'empty'));
        _dirty = true;
      }
      _cardEditId = null;
      pasteFormGuardActive = false;
    }
    _disposing = true;
    HardwareKeyboard.instance.removeHandler(_slashKeyHandler);
    HardwareKeyboard.instance.removeHandler(_editorShortcutHandler);
    WidgetsBinding.instance.removeObserver(this);
    NodeZoneTap.onCardRetry = null;
    NodeZoneTap.onMediaZone = null;
    _autosaveTimer?.cancel();
    _draftTimer?.cancel();
    _subtitleTimer?.cancel();
    _pressClearTimer?.cancel();
    _subtitleNotifier.dispose();
    _cardEditController.dispose();
    _cardEditFocus.dispose();
    if (_dirty) {
      // 退出时兜底保存（不 await：页面已销毁，用已捕获的引用尽力而为）
      _save();
    }
    _composer?.selectionNotifier.removeListener(_updateSlashState);
    _composer?.selectionNotifier.removeListener(_handleSelectionTap);
    // 文档 listener 为匿名闭包，随文档一同释放，不单独移除
    _titleController.dispose();
    _titleFocusNode.dispose();
    _slashLinkController.dispose();
    _slashLinkFocusNode.dispose();
    _editorToastTimer?.cancel();
    _editorFocusNode.dispose();
    _focusB.dispose();
    bodyScrollY.removeListener(_onBodyScroll);
    hostInsets.removeListener(_onHostInsets);
    _scrollController.dispose();
    _scrollB.dispose();
    super.dispose();
  }

  static List<String> _mergedDiagEvents() {
    final all = <String>[...Diag.events, ...ImeDebug.events]..sort();
    return all;
  }

  /// v3 单栏：编辑器以自然高列（shrinkWrap）挂在视口画布里，列整体
  /// 随 body 滚动平移；列高在 build 的 post-frame 里上报宿主决定行程。
  Widget _buildBodySyncedEditor(
    Editor editor,
    double safeTop,
    double safeBottom,
  ) {
    return ClipRect(
      child: OverflowBox(
        alignment: Alignment.topCenter,
        maxHeight: double.infinity,
        child: ValueListenableBuilder<double>(
          valueListenable: bodyScrollY,
          builder: (context, y, child) =>
              Transform.translate(offset: Offset(0, -y), child: child),
          child: Column(
            key: _editorColKey,
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Listener(
                onPointerDown: _onPointerDown,
                onPointerMove: _onPointerMove,
                onPointerUp: _onPointerEnd,
                onPointerCancel: _onPointerEnd,
                child: _buildSuperEditor(
                  editor: editor,
                  focusNode: _editorFocusNode,
                  scrollController: _scrollController,
                  layoutKey: _docLayoutKey,
                  topInset: safeTop + 155,
                  bottomInset: 32 + safeBottom,
                  shrinkWrap: true,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// v3 双栏：两栏同属一个自然高列（顶部让位 + Row + 底部停稳），
  /// 整体随 body 平移；列高即 Row 自然高（两栏较高者），上报宿主。
  /// 与原版双栏各自内滚的差异：v3 两栏同步平移（flow 本是一篇文档；
  /// independent 模式的双栏独立滚动在 body 模型下不保留）。
  Widget _buildBodySyncedTwoPane(
    Editor editor,
    double safeTop,
    double safeBottom,
  ) {
    final columnGap = (MediaQuery.of(context).size.width * 0.032)
        .clamp(28.0, 52.0)
        .toDouble();
    return ClipRect(
      child: OverflowBox(
        alignment: Alignment.topCenter,
        maxHeight: double.infinity,
        child: ValueListenableBuilder<double>(
          valueListenable: bodyScrollY,
          builder: (context, y, child) =>
              Transform.translate(offset: Offset(0, -y), child: child),
          child: Column(
            key: _editorColKey,
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(height: safeTop + 170),
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1440),
                  child: Listener(
                    onPointerDown: _onPointerDown,
                    onPointerMove: _onPointerMove,
                    onPointerUp: _onPointerEnd,
                    onPointerCancel: _onPointerEnd,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Container(
                            decoration: BoxDecoration(
                              border: Border(
                                right: BorderSide(
                                  color: MynoteTokens.border,
                                  width: 1,
                                ),
                              ),
                            ),
                            padding: const EdgeInsets.only(right: 16),
                            child: _buildSuperEditor(
                              editor: editor,
                              focusNode: _editorFocusNode,
                              scrollController: _scrollController,
                              layoutKey: _docLayoutKey,
                              topInset: 4,
                              bottomInset: 24,
                              shrinkWrap: true,
                            ),
                          ),
                        ),
                        SizedBox(width: columnGap),
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(left: 16),
                            child: _buildSuperEditor(
                              editor: _editorB!,
                              focusNode: _focusB,
                              scrollController: _scrollB,
                              layoutKey: _docLayoutKeyB,
                              topInset: 4,
                              bottomInset: 24,
                              shrinkWrap: true,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              SizedBox(height: 32 + safeBottom),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSuperEditor({
    required Editor editor,
    required FocusNode focusNode,
    required ScrollController scrollController,
    required GlobalKey layoutKey,
    required double topInset,
    required double bottomInset,
    bool shrinkWrap = false,
  }) {
    return SuperEditor(
      editor: editor,
      focusNode: focusNode,
      scrollController: scrollController,
      shrinkWrap: shrinkWrap,
      documentLayoutKey: layoutKey,
      // 光标色对齐原版 caretColor: var(--text-main)（默认黑色需覆盖 overlay 构建器）
      documentOverlayBuilders: [
        const SuperEditorIosToolbarFocalPointDocumentLayerBuilder(),
        const SuperEditorIosHandlesDocumentLayerBuilder(),
        const SuperEditorAndroidToolbarFocalPointDocumentLayerBuilder(),
        const SuperEditorAndroidHandlesDocumentLayerBuilder(),
        DefaultCaretOverlayBuilder(
          caretStyle: CaretStyle(width: 2, color: MynoteTokens.textMain),
        ),
      ],
      stylesheet: mynoteStylesheet(
        scale: fontScaleOf(ref.watch(fontSizeProvider)),
        topInset: topInset,
        bottomInset: bottomInset,
        // S1：视口 ≥900 时文本内容宽 72ch（≈630px×scale）居中，
        // 双栏按单栏宽计算（栏窄时自动退回 16）
        textPadH: () {
          final vw = MediaQuery.of(context).size.width;
          if (vw < 900) return 16.0;
          final scale = fontScaleOf(ref.watch(fontSizeProvider));
          final colW = _twoPane ? vw / 2 : vw;
          final pad = (colW - 630 * scale) / 2;
          return pad > 16 ? pad : 16.0;
        }(),
      ),
      componentBuilders: [
        const BacklinksComponentBuilder(),
        const CardComponentBuilder(),
        const MediaComponentBuilder(),
        const MynoteBlockquoteComponentBuilder(),
        const MynoteHorizontalRuleComponentBuilder(),
        const MynoteParagraphComponentBuilder(),
        MynoteTaskComponentBuilder(editor),
        ...defaultComponentBuilders,
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    // 尺寸跨过双栏可用边界时重建编辑器（窄↔宽切换时单/双栏跟随原版规则）
    final size = MediaQuery.of(context).size;
    final allowedNow = columnsAllowed(size.width, size.height);
    if (_lastColumnsAllowed != null &&
        _lastColumnsAllowed != allowedNow &&
        _document != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _buildEditors(_mergedDocJson());
      });
    }
    _lastColumnsAllowed = allowedNow;
    // 反链来源变化（标题/他篇链接增删）→ 帧后同步文档流分节
    final backlinkSources = _backlinks();
    final backlinkKey = backlinkSources
        .map((m) => '${m.id}:${m.title}')
        .join('|');
    if (backlinkKey != _backlinkSyncKey && _document != null) {
      _backlinkSyncKey = backlinkKey;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _syncBacklinksNode(backlinkSources);
      });
    }
    final document = _document;
    final editor = _editor;
    final composer = _composer;
    final eff = effectiveInsets(
      MediaQuery.of(context).padding,
      hostInsets.value,
    );
    final safeTop = eff.top;
    final safeBottom = eff.bottom;
    if (bodyScrollSupported) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final h = _editorColKey.currentContext?.size?.height ?? 0;
        if (h > 0 && (h - _lastReportedEditorH).abs() > 0.5) {
          _lastReportedEditorH = h;
          reportContentHeight(h);
        }
      });
    }
    final isEmptyDoc =
        document != null &&
        document.length == 1 &&
        document.first is ParagraphNode &&
        (document.first as ParagraphNode).text.toPlainText().isEmpty;
    final editorScale = fontScaleOf(ref.watch(fontSizeProvider));
    final placeholderAnchor = isEmptyDoc ? _placeholderAnchor() : null;
    // 双栏栏间距（原版 grid gap: clamp(28px, 3.2vw, 52px)）
    final columnGap = (size.width * 0.032).clamp(28.0, 52.0).toDouble();
    return PopScope(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _goBack();
      },
      child: Scaffold(
        backgroundColor:
            effectiveBgColor(
              _bgColor,
              Theme.of(context).brightness == Brightness.dark,
            ) ??
            MynoteTokens.editorBg,
        body: Stack(
          children: [
            // 正文：单栏全屏（首块内边距让出坞高，滚动时内容滑到坞下，
            // 不做 168px 整屏硬裁剪）；双栏为独立滚动区，高度按原版
            // 100dvh − 187 − 安全区上 − 安全区下。
            if (_loadError)
              Positioned.fill(
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '笔记加载失败',
                        style: TextStyle(
                          fontSize: 15,
                          color: MynoteTokens.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: const Text('返回列表'),
                      ),
                    ],
                  ),
                ),
              )
            else if (document == null || editor == null || composer == null)
              const Positioned.fill(
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_twoPane && _editorB != null && bodyScrollSupported)
              Positioned.fill(
                child: _buildBodySyncedTwoPane(editor, safeTop, safeBottom),
              )
            else if (_twoPane && _editorB != null)
              Positioned(
                top: safeTop + 170,
                bottom: safeBottom + 17,
                left: 0,
                right: 0,
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 1440),
                    child: Listener(
                      onPointerDown: _onPointerDown,
                      onPointerMove: _onPointerMove,
                      onPointerUp: _onPointerEnd,
                      onPointerCancel: _onPointerEnd,
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(
                            child: Container(
                              decoration: BoxDecoration(
                                border: Border(
                                  right: BorderSide(
                                    color: MynoteTokens.border,
                                    width: 1,
                                  ),
                                ),
                              ),
                              padding: const EdgeInsets.only(right: 16),
                              child: _buildSuperEditor(
                                editor: editor,
                                focusNode: _editorFocusNode,
                                scrollController: _scrollController,
                                layoutKey: _docLayoutKey,
                                topInset: 4,
                                bottomInset: 24,
                              ),
                            ),
                          ),
                          SizedBox(width: columnGap),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(left: 16),
                              child: _buildSuperEditor(
                                editor: _editorB!,
                                focusNode: _focusB,
                                scrollController: _scrollB,
                                layoutKey: _docLayoutKeyB,
                                topInset: 4,
                                bottomInset: 24,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              )
            else if (bodyScrollSupported)
              Positioned.fill(
                child: _buildBodySyncedEditor(editor, safeTop, safeBottom),
              )
            else
              Positioned.fill(
                child: Listener(
                  onPointerDown: _onPointerDown,
                  onPointerMove: _onPointerMove,
                  onPointerUp: _onPointerEnd,
                  onPointerCancel: _onPointerEnd,
                  child: _buildSuperEditor(
                    editor: editor,
                    focusNode: _editorFocusNode,
                    scrollController: _scrollController,
                    layoutKey: _docLayoutKey,
                    topInset: safeTop + 155,
                    bottomInset: 32 + safeBottom,
                  ),
                ),
              ),
            if (isEmptyDoc && !_hasTyped)
              Positioned(
                // 锚定首段落光标矩形（布局未就绪的首帧回退旧常量）；
                // 字号/行高与正文同度量（16×scale / 1.75），两行折行
                // 位置也与手打文字一致
                top: placeholderAnchor?.top ?? safeTop + 167,
                left: placeholderAnchor?.left ?? 16,
                right: placeholderAnchor != null
                    ? size.width - placeholderAnchor.right
                    : 16,
                child: IgnorePointer(
                  child: Text(
                    '点击此处开始输入文字，或输入/使用快捷功能命令面板',
                    style: TextStyle(
                      fontSize: 16 * editorScale,
                      height: 1.75,
                      color: MynoteTokens.textSecondary.withValues(alpha: 0.45),
                    ),
                  ),
                ),
              ),
            // 页眉坞（对照原版 editor-title-dock）：返回/••• 毛玻璃圆钮 +
            // 居中头像（72 圆，可更换）与标题胶囊（高 66、圆角 33）。
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: Padding(
                // 安全区统一模型：不用 SafeArea，显式 safeTop 偏移
                // （与各页同一口径；坞内元素 top 7 = 原版 env+7px）
                padding: EdgeInsets.only(top: safeTop),
                child: SizedBox(
                  height: 152,
                  child: Stack(
                    children: [
                      Positioned(
                        left: 16,
                        top: 7,
                        child: Listener(
                          behavior: HitTestBehavior.opaque,
                          onPointerDown: (_) => _goBack(),
                          child: _glassFab(Icons.chevron_left, () {}),
                        ),
                      ),
                      Positioned(
                        right: 16,
                        top: 7,
                        child: _glassFab(Icons.more_horiz, _showMoreSheet),
                      ),
                      Positioned(
                        left: 62,
                        right: 62,
                        top: 7,
                        child: _editorScrolled
                            ? Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  GestureDetector(
                                    onTap: _changeAvatar,
                                    child: _avatarBytes != null
                                        ? Container(
                                            width: 72,
                                            height: 72,
                                            decoration: BoxDecoration(
                                              shape: BoxShape.circle,
                                              image: DecorationImage(
                                                image: MemoryImage(
                                                  _avatarBytes!,
                                                ),
                                                fit: BoxFit.cover,
                                              ),
                                            ),
                                          )
                                        : DinoAvatar(
                                            size: 72,
                                            background:
                                                MynoteTokens.glassControlBg,
                                          ),
                                  ),
                                  const SizedBox(width: 8),
                                  Flexible(
                                    child: _titleCapsule(scrolled: true),
                                  ),
                                ],
                              )
                            : Column(
                                children: [
                                  GestureDetector(
                                    onTap: _changeAvatar,
                                    child: _avatarBytes != null
                                        ? Container(
                                            width: 72,
                                            height: 72,
                                            decoration: BoxDecoration(
                                              shape: BoxShape.circle,
                                              image: DecorationImage(
                                                image: MemoryImage(
                                                  _avatarBytes!,
                                                ),
                                                fit: BoxFit.cover,
                                              ),
                                            ),
                                          )
                                        : DinoAvatar(
                                            size: 72,
                                            background:
                                                MynoteTokens.glassControlBg,
                                          ),
                                  ),
                                  const SizedBox(height: 6),
                                  _titleCapsule(scrolled: false),
                                ],
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            // 反链已入文档流（见 _syncBacklinksNode），此处无浮层
            // S3 拖拽反馈（原版：被拖块 opacity .4 + 3px accent 落点线；
            // 旧版的悬浮横幅是自创元素，已撤）：被拖块盖编辑底色
            // 半透明层模拟变淡，落点线按同一目标下标口径实时算
            if (_dragging && _dragSourceRect != null)
              Positioned.fromRect(
                rect: _dragSourceRect!,
                child: IgnorePointer(
                  child: Container(
                    color:
                        (effectiveBgColor(
                                  _bgColor,
                                  Theme.of(context).brightness ==
                                      Brightness.dark,
                                ) ??
                                MynoteTokens.editorBg)
                            .withValues(alpha: 0.6),
                  ),
                ),
              ),
            if (_dragging && _dragTargetY != null)
              Positioned(
                top: _dragTargetY! - 1.5,
                left: 16,
                right: 16,
                child: IgnorePointer(
                  child: Container(
                    height: 3,
                    decoration: BoxDecoration(
                      color: MynoteTokens.accent,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),
            if (_slashToken != null) _buildSlashPanel(),
            if (_cardEditId != null) _buildCardEditOverlay(),
            if (_editorToast != null) _editorToastWidget(),
            if (_showImeLog)
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                height: 320,
                child: Material(
                  color: MynoteTokens.glassOverlayBg,
                  elevation: 8,
                  child: ListenableBuilder(
                    listenable: Listenable.merge([ImeDebug.tick, Diag.tick]),
                    builder: (context, _) => Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            const Padding(
                              padding: EdgeInsets.all(6),
                              child: Text(
                                'IME 日志',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            TextButton(
                              onPressed: () {
                                ImeDebug.clear();
                                Diag.clear();
                              },
                              child: const Text(
                                '清空',
                                style: TextStyle(fontSize: 12),
                              ),
                            ),
                          ],
                        ),
                        Expanded(
                          child: ListView.builder(
                            reverse: true,
                            itemCount: _mergedDiagEvents().length,
                            itemBuilder: (context, i) => Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 1,
                              ),
                              child: Text(
                                _mergedDiagEvents()[_mergedDiagEvents().length -
                                    1 -
                                    i],
                                style: const TextStyle(
                                  fontSize: 10,
                                  fontFamily: 'monospace',
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            // 底部渐隐：正文滚到屏幕底边先淡出再消失（去硬切）；
            // 编辑区底部内距 32+安全区 > 30，滚到尽头末行不被冲淡；
            // 颜色与 Scaffold 底色同源（随笔记自定义背景）
            ScrollFadeBottomLayer(
              color:
                  effectiveBgColor(
                    _bgColor,
                    Theme.of(context).brightness == Brightness.dark,
                  ) ??
                  MynoteTokens.editorBg,
            ),
            const TopVeil(),
          ],
        ),
      ),
    );
  }
}

/// 双栏开关（原版规格）：轨道 42×26、内距 3、钮 20、行程 16、
/// 关 #D1D1D6（深色 #48484A）、开固定 #007AFF、160ms 过渡。
class _MynoteSwitch extends StatelessWidget {
  const _MynoteSwitch({required this.value, required this.onChanged});
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onChanged(!value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        width: 42,
        height: 26,
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: value
              ? const Color(0xFF007AFF)
              : (MynoteTokens.dark
                    ? const Color(0xFF48484A)
                    : const Color(0xFFD1D1D6)),
          borderRadius: BorderRadius.circular(999),
        ),
        child: AnimatedAlign(
          duration: const Duration(milliseconds: 160),
          alignment: value ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            width: 20,
            height: 20,
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Color(0x26000000),
                  blurRadius: 3,
                  offset: Offset(0, 1),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 斜杠面板行：按压时 scale .99 + 填充加深（原版 .slash-row:active）。
class _SlashRow extends StatefulWidget {
  const _SlashRow({
    required this.onTap,
    required this.child,
    this.onHover,
    this.pressedScale = 0.99,
    this.scaleMs = 120,
    this.radius = 14,
  });
  final VoidCallback onTap;
  final Widget child;
  final ValueChanged<bool>? onHover;
  final double pressedScale;
  final int scaleMs;

  /// 高亮圆角：与所在面板同心（slash 面板 22−8=14；
  /// 锚定面板 22−7=15，导出行传入 15）。
  final double radius;

  @override
  State<_SlashRow> createState() => _SlashRowState();
}

class _SlashRowState extends State<_SlashRow> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return AnimatedScale(
      scale: _pressed ? widget.pressedScale : 1.0,
      duration: Duration(milliseconds: widget.scaleMs),
      child: InkWell(
        borderRadius: BorderRadius.circular(widget.radius),
        splashColor: Colors.transparent,
        highlightColor: MynoteTokens.fillHoverStrong,
        onHover: widget.onHover,
        onHighlightChanged: (v) {
          if (v != _pressed) setState(() => _pressed = v);
        },
        onTap: widget.onTap,
        child: widget.child,
      ),
    );
  }
}
