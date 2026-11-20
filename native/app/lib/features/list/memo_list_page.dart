import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart' show Value;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:super_editor/super_editor.dart' show Editor;

import '../../app/providers.dart';
import '../../core/diag.dart';
import '../../core/dino_avatar.dart';
import '../../core/body_scroll.dart';
import '../../core/body_scroll_column.dart';
import '../../core/content_slide.dart';
import '../../core/reload_page.dart';
import '../../core/update_check.dart';
import '../../core/page_route.dart';
import '../../core/prefs_store.dart';
import '../../core/tokens.dart';
import '../../core/top_veil.dart';
import '../../data/convert/doc_converter.dart';
import '../../data/db/database.dart';
import '../editor/editor_page.dart';
import '../settings/settings_page.dart';
import 'memo_derived.dart';
import 'memo_search.dart';
import 'memo_grouping.dart';
import 'memo_preview.dart';

/// 列表页（原版 memo-list.js + SwipeRow/ImageCard + base.css 逐项对齐）：
/// 72px 头像（Google 头像或恐龙玻璃圆）+ 66 高搜索胶囊、滚动收缩与
/// 紧凑「此刻」胶囊、新建卡、图片/文本分组（>2 折叠）、玻璃行、
/// #标签 chips、左滑置顶/删除。
/// 页眉收缩进度：滚动 30pt 内线性到 1（原版 TITLE_THRESHOLD 口径）。
double shrinkForOffset(double offset) => (offset / 30).clamp(0.0, 1.0);

/// 收缩进度更新门槛：小步进跳过以免频繁 setState，但端点 0/1 必须
/// 放行——否则慢速滚动最后一步差 ≤0.02 永远跨不过，compact 永不
/// 成立（2026-11-19 实机事故根因，见 initState 滚动监听注释）。
bool shouldUpdateShrink(double current, double next) =>
    next != current &&
    ((next - current).abs() > 0.02 || next == 0 || next == 1);

class MemoListPage extends ConsumerStatefulWidget {
  const MemoListPage({super.key});

  @override
  ConsumerState<MemoListPage> createState() => _MemoListPageState();
}

class _MemoListPageState extends ConsumerState<MemoListPage>
    with RouteAware, TickerProviderStateMixin, ContentSlideMixin {
  bool _searchOpen = false;
  String _query = '';

  /// 防抖后实际用于过滤的查询（150ms）：键入不再每击全量重算
  String _appliedQuery = '';
  Timer? _searchDebounce;
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocus = FocusNode();
  /// 仅非 Web（内部滚动回退）时用：驱动页眉收缩。
  final ScrollController _scroll = ScrollController();
  final Set<String> _expandedGroups = {};
  double _shrink = 0;
  bool _loggedMq = false;
  String? _googleAvatar;

  @override
  void initState() {
    super.initState();
    _googleAvatar = prefsGet('google_avatar');
    hostInsets.addListener(_onHostInsets);
    // 页眉收缩的偏移来源：Web 是 body 的 window.scrollY（结构对齐
    // 原版：滚动归 body）；非 Web 是回退 ListView 的内部偏移。
    if (bodyScrollSupported) {
      bodyScrollY.addListener(_onScrollDriven);
    } else {
      _scroll.addListener(_onScrollDriven);
    }
    _searchFocus.addListener(() {
      if (!_searchFocus.hasFocus && _searchOpen) {
        setState(() => _searchOpen = false);
      }
    });
  }

  void _onScrollDriven() {
    final offset = bodyScrollSupported ? bodyScrollY.value : _scroll.offset;
    final s = shrinkForOffset(offset);
    // 旧版门槛是变化 >0.02 才更新：慢速滚动时 s 以小步逼近 1，
    // 最后一步差 0.01 永远跨不过去，_shrink 卡在 ~0.97——页眉
    // 位置已收缩到位，但 compact 永不成立：头像停在 0.7 透明、
    // 搜索胶囊不消失、紧凑标题胶囊不出现，三者常驻压住内容
    // （用户实机截图实证 2026-11-19）。端点值必须放行。
    if (shouldUpdateShrink(_shrink, s)) {
      final wasCompact = _shrink >= 1;
      setState(() => _shrink = s);
      if ((s >= 1) != wasCompact) {
        Diag.log(
          'LIST',
          'compact ${s >= 1 ? 'on' : 'off'} '
              'offset=${offset.toStringAsFixed(0)}',
        );
      }
    }
  }

  void _onHostInsets() {
    if (mounted) setState(() {});
  }

  @override
  void didPopNext() {
    super.didPopNext();
    // 从上层页返回：根高此刻是上一页的，当前页内容列重报一次
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) BodyScrollColumn.reportActiveHeight();
    });
    // 原版 closeEditor：双 rAF 后恢复打开编辑器前保存的滚动位
    if (_savedListScrollY > 0) {
      final y = _savedListScrollY;
      _savedListScrollY = 0;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) scrollWindowTo(y);
        });
      });
    }
  }

  @override
  void dispose() {
    if (bodyScrollSupported) {
      bodyScrollY.removeListener(_onScrollDriven);
    } else {
      _scroll.removeListener(_onScrollDriven);
    }
    hostInsets.removeListener(_onHostInsets);
    _searchDebounce?.cancel();
    _searchController.dispose();
    _searchFocus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _openSettings() {
    Navigator.of(context)
        .push(mynoteStaticHeaderRoute(context, const SettingsPage()));
  }

  /// 原版 openEditor/closeEditor 的滚动保存/恢复：打开编辑器前记下
  /// 列表滚动位并把 body 滚到顶（编辑器从顶开始），返回列表后恢复。
  /// 此前不保存：编辑页高度与列表不同，浏览器会钳掉 scrollY，返回
  /// 时列表位置丢失。仅编辑器路径设置，设置页返回不触发。
  double _savedListScrollY = 0;

  void _saveScrollAndTop() {
    if (!bodyScrollSupported) return;
    _savedListScrollY = bodyScrollY.value;
    scrollWindowTo(0);
  }

  Future<void> _create() async {
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
        title: const Value('无标题'),
        docJson: Value(jsonEncode(doc)),
        createdAt: now,
        updatedAt: now,
      ),
      '',
    );
    Diag.log('LIST', 'create memo $id');
    if (mounted) {
      _saveScrollAndTop();
      Navigator.of(context).push(
        mynotePageRoute(
          context,
          EditorPage(memoId: id, isNew: true),
          reverseMs: 320,
        ),
      );
    }
  }

  void _openEditor(Memo memo) {
    _saveScrollAndTop();
    Navigator.of(context).push(
      mynotePageRoute(context, EditorPage(memoId: memo.id), reverseMs: 320),
    );
  }

  Future<void> _togglePin(Memo memo) async {
    final db = ref.read(databaseProvider);
    final doc = jsonDecode(memo.docJson) as List<dynamic>;
    await db.upsertMemoWithFts(
      MemosCompanion.insert(
        id: memo.id,
        title: Value(memo.title),
        pinned: Value(!memo.pinned),
        bg: Value(memo.bg),
        docJson: Value(memo.docJson),
        extraJson: Value(memo.extraJson),
        createdAt: memo.createdAt,
        updatedAt: DateTime.now().millisecondsSinceEpoch,
      ),
      docPlainText(doc),
    );
    Diag.log('LIST', 'pin ${memo.id} -> ${!memo.pinned}');
  }

  Future<void> _deleteMemo(Memo memo) async {
    final db = ref.read(databaseProvider);
    final store = await ref.read(attachmentStoreProvider.future);
    final targetIds = collectMemoFileIds(memo.docJson);
    await db.deleteMemoWithFts(memo.id);
    if (targetIds.isNotEmpty) {
      // 与 Web 一致：仅删除不再被任何笔记引用的附件
      final remaining = await db.select(db.memos).get();
      final stillUsed = <String>{};
      for (final m in remaining) {
        stillUsed.addAll(collectMemoFileIds(m.docJson));
      }
      for (final fid in targetIds) {
        if (stillUsed.contains(fid)) continue;
        await (db.delete(db.attachments)..where((t) => t.id.equals(fid))).go();
        await store.delete(fid);
        Diag.log('LIST', 'cleanup attachment $fid');
      }
    }
    Diag.log('LIST', 'delete memo ${memo.id}');
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(appInitProvider);
    final memosAsync = ref.watch(memosProvider);
    final compact = _shrink >= 1;
    // v3：生效安全区 = 引擎值与宿主桥（env 实测+滚动余量）逐边取大；
    // 嵌入模式引擎恒 0，靠桥；原生桥为空、靠引擎。
    final eff = effectiveInsets(
      MediaQuery.of(context).padding,
      hostInsets.value,
    );
    final safeTop = eff.top;
    final safeBottom = eff.bottom;
    if (!_loggedMq) {
      _loggedMq = true;
      final mq = MediaQuery.of(context);
      Diag.log(
        'LIST',
        'mq padding t=${mq.padding.top} b=${mq.padding.bottom} '
            'viewPadding t=${mq.viewPadding.top} b=${mq.viewPadding.bottom}',
      );
    }
    return Scaffold(
      backgroundColor: MynoteTokens.primaryBg,
      body: slideContent(
        Stack(
          children: [
            // 列表全屏滚动：内容从悬浮页眉下穿过（原版 header sticky +
            // transparent），不再被页眉底边硬裁。
            Positioned.fill(
              // L24：DB 打开失败必须与空库可区分——明确报错 + 重试，
              // 不再静默呈空列表让用户误判数据丢失
              child: memosAsync.hasError
                  ? _dbErrorView(memosAsync.error)
                  : _buildList(
                      memosAsync.valueOrNull ?? const [],
                      safeTop + 176,
                      safeBottom,
                    ),
            ),
            Positioned(
              top: safeTop + 48 - _shrink * 30,
              left: 20,
              child: _headerAvatar(),
            ),
            Positioned(
              top: safeTop + 51 - _shrink * 30,
              right: 20,
              child: IgnorePointer(
                ignoring: compact,
                child: AnimatedOpacity(
                  opacity: compact ? 0 : 1,
                  duration: const Duration(milliseconds: 280),
                  child: _searchOpen ? _searchPanel() : _searchTrigger(),
                ),
              ),
            ),
            // 滚动后的紧凑标题胶囊（点按进设置）
            Positioned(
              top: safeTop + 7,
              left: 0,
              right: 0,
              child: Center(
                child: IgnorePointer(
                  ignoring: !compact,
                  child: Opacity(
                    opacity: compact ? 1 : 0,
                    child: GestureDetector(
                      onTap: _openSettings,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(20),
                        child: BackdropFilter(
                          filter: MynoteTokens.overlayFilter,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: MynoteTokens.glassOverlayBg,
                              border: Border.all(
                                color: MynoteTokens.glassOverlayBorder,
                                width: 0.5,
                              ),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              '此刻',
                              style: TextStyle(
                                height: 1.2,
                                fontSize: 17,
                                fontWeight: FontWeight.w600,
                                letterSpacing: -0.3,
                                color: MynoteTokens.textMain,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const TopVeil(),
            // 首页底部渐隐已按用户指示去除（2026-11-19）
            // D1：检测到新构建时的刷新浮标（底部居中胶囊）
            Positioned(
              left: 0,
              right: 0,
              bottom: safeBottom + 18,
              child: ValueListenableBuilder<bool>(
                valueListenable: updateAvailable,
                builder: (context, available, _) {
                  if (!available) return const SizedBox.shrink();
                  return Center(
                    child: GestureDetector(
                      onTap: reloadPage,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 9,
                        ),
                        decoration: BoxDecoration(
                          color: MynoteTokens.textMain,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          '有新版本 · 点此刷新',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: MynoteTokens.primaryBg,
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Object? _lastDbErrorLogged;

  /// L24：数据库打开失败的错误态（与真实空库严格区分）。
  Widget _dbErrorView(Object? error) {
    if (!identical(error, _lastDbErrorLogged)) {
      _lastDbErrorLogged = error;
      Diag.error('LIST', 'memos load failed: $error');
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '数据库打开失败',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: MynoteTokens.textMain,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '本地数据没有被删除，只是这次没能读出来。\n$error',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                height: 1.6,
                color: MynoteTokens.glassLabel,
              ),
            ),
            const SizedBox(height: 18),
            GestureDetector(
              onTap: () {
                ref.invalidate(appInitProvider);
                ref.invalidate(memosProvider);
              },
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 22,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: MynoteTokens.textMain,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '重试',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: MynoteTokens.primaryBg,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _headerAvatar() {
    final scale = 1 - _shrink * 0.45;
    return Opacity(
      // Web page-title（头像容器）：opacity = 1 − 0.3p；p≥1 时隐藏
      opacity: _shrink >= 1 ? 0 : (1 - _shrink * 0.3).clamp(0.0, 1.0),
      child: Transform.translate(
        offset: Offset(0, -4 * _shrink),
        child: Transform.scale(
          scale: scale,
          alignment: Alignment.centerLeft,
          child: GestureDetector(
            onTap: _openSettings,
            child: _googleAvatar != null && _googleAvatar!.isNotEmpty
                ? ClipOval(
                    child: Image.network(
                      _googleAvatar!,
                      width: 72,
                      height: 72,
                      fit: BoxFit.cover,
                    ),
                  )
                : const DinoAvatar(size: 72, glass: true, glyph: 64),
          ),
        ),
      ),
    );
  }

  Widget _searchTrigger() {
    return GestureDetector(
      onTap: () => setState(() {
        _searchOpen = true;
        _searchController.text = _query;
      }),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(999),
        child: BackdropFilter(
          filter: MynoteTokens.controlFilter,
          child: Container(
            height: 66,
            padding: const EdgeInsets.symmetric(horizontal: 18),
            decoration: BoxDecoration(
              color: MynoteTokens.glassControlBg,
              border: Border.all(
                color: MynoteTokens.glassControlBorder,
                width: 0.5,
              ),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.search, size: 20, color: MynoteTokens.textSecondary),
                SizedBox(width: 6),
                Text(
                  '搜索',
                  style: TextStyle(
                    fontSize: 14,
                    letterSpacing: -0.1,
                    color: MynoteTokens.glassLabel,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _searchPanel() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: BackdropFilter(
        filter: MynoteTokens.overlayFilter,
        child: Container(
          height: 66,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: MynoteTokens.glassOverlayBg,
            border: Border.all(
              color: MynoteTokens.glassOverlayBorder,
              width: 0.5,
            ),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Focus(
            onKeyEvent: (node, event) {
              if (event is KeyDownEvent &&
                  event.logicalKey == LogicalKeyboardKey.escape) {
                setState(() => _searchOpen = false);
                return KeyEventResult.handled;
              }
              return KeyEventResult.ignored;
            },
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.search, size: 18, color: MynoteTokens.textSecondary),
                const SizedBox(width: 8),
                SizedBox(
                  width: 140,
                  height: 40,
                  child: TextField(
                    controller: _searchController,
                    focusNode: _searchFocus,
                    autofocus: true,
                    style: TextStyle(
                      // 原版 .glass-search-input 字号 var(--font-15)
                      fontSize: 15,
                      color: MynoteTokens.textMain,
                    ),
                    decoration: const InputDecoration(
                      hintText: '搜索笔记...',
                      border: InputBorder.none,
                      isDense: true,
                    ),
                    onChanged: (v) {
                      setState(() => _query = v);
                      _searchDebounce?.cancel();
                      _searchDebounce = Timer(
                        const Duration(milliseconds: 150),
                        () {
                          if (mounted) setState(() => _appliedQuery = v);
                        },
                      );
                    },
                    onSubmitted: (_) => setState(() => _searchOpen = false),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildList(List<Memo> memos, double topInset, double bottomInset) {
    final visible = _appliedQuery.isEmpty
        ? memos
        : memos
              .where(
                (m) =>
                    derivedForMemo(m).searchTextLower
                        .contains(_appliedQuery.toLowerCase()),
              )
              .toList();
    if (_appliedQuery.isNotEmpty) {
      logSearchExec(_appliedQuery, visible.length);
    }
    final now = DateTime.now();
    final use24h = MediaQuery.of(context).alwaysUse24HourFormat;
    // 宽屏（原版 base.css 媒体查询）：≥768，或横屏且高 ≤560
    final size = MediaQuery.of(context).size;
    if (size.width >= 768 || (size.width > size.height && size.height <= 560)) {
      return _buildWideList(
        visible,
        now,
        use24h,
        topInset,
        bottomInset,
        allEmpty: visible.isEmpty,
      );
    }
    // 分组：置顶组 + 时间组（按遭遇顺序分段，同 label 可重复出现，
    // 与 Web groupedItems 一致），组内图片/文本分开
    final groups = <(String, List<Memo>, List<Memo>)>[];
    final pinnedImg = <Memo>[], pinnedTxt = <Memo>[];
    String? currentLabel;
    (List<Memo>, List<Memo>)? currentPair;
    for (final m in visible) {
      final isImg = derivedForMemo(m).hasImage;
      if (m.pinned) {
        (isImg ? pinnedImg : pinnedTxt).add(m);
        continue;
      }
      final label = sectionLabel(
        DateTime.fromMillisecondsSinceEpoch(m.createdAt),
        now,
      );
      if (label != currentLabel) {
        currentLabel = label;
        currentPair = (<Memo>[], <Memo>[]);
        groups.add((label, currentPair.$1, currentPair.$2));
      }
      (isImg ? currentPair!.$1 : currentPair!.$2).add(m);
    }
    if (pinnedImg.isNotEmpty || pinnedTxt.isNotEmpty) {
      groups.insert(0, ('置顶', pinnedImg, pinnedTxt));
    }

    final children = <Widget>[
      Padding(
        // 下 6：与原版一致——卡面到首个分组标题文字 = 6（卡 margin）
        // + 24（组 margin）+ 4（标题 padding-top）= 34；本页标题
        // padding-top 已按 28（24+4）计，故卡下留 6 补齐
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 6),
        child: _SwipeShell(
          isNewCard: true,
          onTap: _create,
          child: _newCardForeground(),
        ),
      ),
      // D4：空态按过滤后条数判定（原版 sorted.length===0 同一文案），
      // 搜索过滤到 0 条时也显示，不再只剩新建卡和空白
      if (visible.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 40),
          child: Center(
            child: Text(
              '暂无笔记，点击上方新建',
              style: TextStyle(fontSize: 15, color: MynoteTokens.textSecondary),
            ),
          ),
        ),
      for (var gi = 0; gi < groups.length; gi++) ...[
        Padding(
          padding: EdgeInsets.fromLTRB(20, 28, 24, 6),
          child: Text(
            groups[gi].$1,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.3,
              color: MynoteTokens.textSecondary,
            ),
          ),
        ),
        if (groups[gi].$2.isNotEmpty)
          ..._subgroup(
            groups[gi].$2,
            '${groups[gi].$1}-img',
            now,
            use24h,
            isImage: true,
          ),
        if (groups[gi].$2.isNotEmpty && groups[gi].$3.isNotEmpty)
          // 原版：图片卡末张 margin 0 + 组 margin 24 + .gap-16 16 = 40；
          // 本页卡片统一带下 padding 6，故补 34 凑齐 40
          const SizedBox(height: 34),
        if (groups[gi].$3.isNotEmpty)
          ..._subgroup(
            groups[gi].$3,
            '${groups[gi].$1}-txt',
            now,
            use24h,
            isImage: false,
          ),
      ],
    ];
    // 结构对齐原版：内容是自然高度的一列（文档流同构），滚动归
    // body——此前用内部滚动面 + 同步跳转，行程靠 SliverList 估算，
    // 60+ 卡时估算偏短且冻结，尾部卡片够不到（2026-11-20 修复）。
    return BodyScrollColumn(
      fallbackController: _scroll,
      padding: EdgeInsets.only(top: topInset, bottom: 20 + bottomInset),
      children: children,
    );
  }

  /// 宽屏网格（原版 @media ≥768）：容器 max-width 1240、左右 24、
  /// 3 列、gap 14；分组标题整行；卡片 1:1 方形、圆角 26。
  /// 组内不再分图片/文本子组，按笔记顺序混排（Web .list-group 为
  /// display:contents，卡片直接入网格）。
  Widget _buildWideList(
    List<Memo> visible,
    DateTime now,
    bool use24h,
    double topInset,
    double bottomInset, {
    bool allEmpty = false,
  }) {
    final sections = <(String, List<Memo>)>[];
    final pinned = visible.where((m) => m.pinned).toList();
    if (pinned.isNotEmpty) sections.add(('置顶', pinned));
    String? label;
    for (final m in visible) {
      if (m.pinned) continue;
      final l = sectionLabel(
        DateTime.fromMillisecondsSinceEpoch(m.createdAt),
        now,
      );
      if (l != label) {
        label = l;
        sections.add((l, <Memo>[]));
      }
      sections.last.$2.add(m);
    }
    // 组内图片子组在前、文本子组在后（原版两个 .list-group 按 DOM 序入格；
    // Dart sort 不稳定，用分区重排保序）
    for (var i = 0; i < sections.length; i++) {
      final items = sections[i].$2;
      sections[i] = (
        sections[i].$1,
        [
          ...items.where((m) => derivedForMemo(m).hasImage),
          ...items.where((m) => !derivedForMemo(m).hasImage),
        ],
      );
    }
    final wideCols = MediaQuery.of(context).size.width >= 1280 ? 4 : 3;
    // 结构对齐原版：自然高度一列（网格 shrinkWrap 全量布局），滚动归 body
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1240),
        child: BodyScrollColumn(
          fallbackController: _scroll,
          padding: EdgeInsets.fromLTRB(24, topInset, 24, 20 + bottomInset),
          children: [
            // 新建卡是独立网格项，排在第一个分组标题之前（原版 DOM 顺序）
            GridView.count(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisCount: wideCols,
              mainAxisSpacing: 14,
              crossAxisSpacing: 14,
              children: [_WideNewCard(onTap: _create)],
            ),
            for (var si = 0; si < sections.length; si++) ...[
              Padding(
                // 原版宽屏组头：13px、padding 8/2/0、margin-bottom -6
                // （与网格 gap 14 合成头到卡 8、卡到头 22 的间距）
                padding: EdgeInsets.fromLTRB(2, si == 0 ? 8 : 22, 2, 8),
                child: Text(
                  sections[si].$1,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.3,
                    color: MynoteTokens.glassLabel,
                  ),
                ),
              ),
              GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: wideCols,
                mainAxisSpacing: 14,
                crossAxisSpacing: 14,
                children: _wideSectionChildren(
                  sections[si].$2,
                  sections[si].$1,
                  now,
                  use24h,
                ),
              ),
            ],
            // 空态口径与原版一致：全部笔记为 0 才显示（不是过滤后为空）
            if (allEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 40),
                child: Center(
                  child: Text(
                    '暂无笔记，点击上方新建',
                    style: TextStyle(
                      fontSize: 15,
                      color: MynoteTokens.textSecondary,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// 宽屏分组子项：图片子组、文本子组各自按 >2 折叠（原版宽屏同样
  /// 折叠为带两层错位底卡的堆叠卡），展开后末卡带「▲ 收起」。
  List<Widget> _wideSectionChildren(
    List<Memo> items,
    String label,
    DateTime now,
    bool use24h,
  ) {
    final img = items.where((m) => derivedForMemo(m).hasImage).toList();
    final txt = items.where((m) => !derivedForMemo(m).hasImage).toList();
    return [
      ..._wideSubgroup(img, '$label-img', now, use24h),
      if (img.isNotEmpty && txt.isNotEmpty) const SizedBox(height: 40),
      ..._wideSubgroup(txt, '$label-txt', now, use24h),
    ];
  }

  List<Widget> _wideSubgroup(
    List<Memo> items,
    String key,
    DateTime now,
    bool use24h,
  ) {
    if (items.isEmpty) return const [];
    final expanded = _expandedGroups.contains(key);
    if (items.length > 2 && !expanded) {
      return [
        _StackedWideCard(
          child: _SwipeShell(
            radius: 26,
            onTap: () => setState(() => _expandedGroups.add(key)),
            onPin: () => _togglePin(items.first),
            onDelete: () => _deleteMemo(items.first),
            pinned: items.first.pinned,
            child: _WideCard(
              memo: items.first,
              now: now,
              use24h: use24h,
              bare: true,
              onTap: () {},
            ),
          ),
        ),
      ];
    }
    return [
      for (var i = 0; i < items.length; i++)
        _SwipeShell(
          radius: 26,
          onTap: () => _openEditor(items[i]),
          onPin: () => _togglePin(items[i]),
          onDelete: () => _deleteMemo(items[i]),
          pinned: items[i].pinned,
          child: _WideCard(
            memo: items[i],
            now: now,
            use24h: use24h,
            bare: true,
            onTap: () {},
            expandChip: (items.length > 2 && expanded && i == items.length - 1)
                ? _expandChip(
                    '▲ 收起',
                    () => setState(() => _expandedGroups.remove(key)),
                  )
                : null,
          ),
        ),
    ];
  }

  List<Widget> _subgroup(
    List<Memo> items,
    String key,
    DateTime now,
    bool use24h, {
    required bool isImage,
  }) {
    final expanded = _expandedGroups.contains(key);
    final collapsible = items.length > 2;
    final shown = (collapsible && !expanded) ? items.take(1).toList() : items;
    return [
      for (var i = 0; i < shown.length; i++)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
          child: _SwipeShell(
            onTap: (collapsible && !expanded)
                ? () => setState(() => _expandedGroups.add(key))
                : () => _openEditor(shown[i]),
            onPin: () => _togglePin(shown[i]),
            onDelete: () => _deleteMemo(shown[i]),
            pinned: shown[i].pinned,
            child: isImage
                ? _ImageCardForeground(
                    memo: shown[i],
                    now: now,
                    use24h: use24h,
                    expandText: _expandTextFor(
                      collapsible,
                      expanded,
                      i,
                      shown.length,
                      items.length,
                    ),
                    onExpand: () => setState(
                      () => expanded
                          ? _expandedGroups.remove(key)
                          : _expandedGroups.add(key),
                    ),
                  )
                : _TextRowForeground(
                    memo: shown[i],
                    now: now,
                    use24h: use24h,
                    expandText: _expandTextFor(
                      collapsible,
                      expanded,
                      i,
                      shown.length,
                      items.length,
                    ),
                    onExpand: () => setState(
                      () => expanded
                          ? _expandedGroups.remove(key)
                          : _expandedGroups.add(key),
                    ),
                  ),
          ),
        ),
    ];
  }

  String? _expandTextFor(
    bool collapsible,
    bool expanded,
    int i,
    int shownCount,
    int total,
  ) {
    if (!collapsible) return null;
    if (!expanded) return '▼ 展开 $total 条';
    if (i == shownCount - 1) return '▲ 收起';
    return null;
  }

  Widget _newCardForeground() {
    return _glassBlur(
      radius: 32,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: _glassCardDecoration(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '新建笔记',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: MynoteTokens.textSecondary,
              ),
            ),
            SizedBox(height: 4),
            Text(
              '现在  点击记录你的瞬间',
              style: TextStyle(fontSize: 12, color: MynoteTokens.glassLabel),
            ),
          ],
        ),
      ),
    );
  }
}

/// 玻璃卡模糊层：ClipRRect + BackdropFilter(contentFilter)。
Widget _glassBlur({required double radius, required Widget child}) {
  return ClipRRect(
    borderRadius: BorderRadius.circular(radius),
    child: BackdropFilter(filter: MynoteTokens.contentFilter, child: child),
  );
}

BoxDecoration _glassCardDecoration() {
  return BoxDecoration(
    color: MynoteTokens.glassContentBg,
    border: Border.all(color: MynoteTokens.glassContentBorder, width: 0.5),
    borderRadius: BorderRadius.circular(32),
  );
}

/// 宽屏网格的新建方卡。
class _WideNewCard extends StatelessWidget {
  const _WideNewCard({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FocusableActionDetector(
      actions: <Type, Action<Intent>>{
        ActivateIntent: CallbackAction<ActivateIntent>(
          onInvoke: (_) {
            onTap();
            return null;
          },
        ),
      },
      child: GestureDetector(
        onTapDown: (_) => onTap(),
        child: _glassBlur(
          radius: 26,
          child: Container(
            decoration: BoxDecoration(
              color: MynoteTokens.glassContentBg,
              border: Border.all(
                color: MynoteTokens.glassContentBorder,
                width: 0.5,
              ),
              borderRadius: BorderRadius.circular(26),
            ),
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '新建笔记',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: MynoteTokens.textSecondary,
                  ),
                ),
                const Spacer(),
                Text(
                  '现在  点击记录你的瞬间',
                  style: TextStyle(
                    fontSize: 12,
                    color: MynoteTokens.glassLabel,
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

/// 宽屏网格方卡（1:1、圆角 26）：图片笔记封面铺满 + 底部渐变标题；
/// 文本笔记为标题 + 预览 + 时间的纵向卡。
class _WideCard extends ConsumerWidget {
  const _WideCard({
    required this.memo,
    required this.now,
    required this.use24h,
    required this.onTap,
    this.expandChip,
    this.bare = false,
  });

  final Memo memo;
  final DateTime now;
  final bool use24h;
  final VoidCallback onTap;
  final Widget? expandChip;

  /// true 时不自带手势层，点按/长按/滑动全由外层 _SwipeShell 处理。
  final bool bare;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final updated = DateTime.fromMillisecondsSinceEpoch(memo.updatedAt);
    final timeText = listTimeAgo(updated, now, use24h: use24h);
    final derived = derivedForMemo(memo);
    final isImage = derived.hasImage;
    final coverId = isImage ? derived.coverFileId : null;
    Widget? cover;
    if (coverId != null) {
      final meta = ref.watch(attachmentMetaProvider(coverId));
      if (meta.valueOrNull?.mime.startsWith('image/') ?? false) {
        final data = ref.watch(attachmentBytesProvider(coverId)).valueOrNull;
        if (data != null) {
          final cellW = (MediaQuery.of(context).size.width >= 1280 ? 290 : 380);
          cover = Image.memory(
            data,
            fit: BoxFit.cover,
            width: double.infinity,
            height: double.infinity,
            cacheWidth: (cellW * MediaQuery.of(context).devicePixelRatio)
                .ceil(),
          );
        }
      }
    }
    final title = memo.title.isEmpty ? '无标题' : memo.title;
    final summary = (
      preview: derived.preview(80),
      tags: derived.tags,
      attachCount: derived.attachCount,
    );
    final preview = summary.preview.isEmpty ? '无更多文本' : summary.preview;
    final content = ClipRRect(
      borderRadius: BorderRadius.circular(26),
      child: BackdropFilter(
        filter: MynoteTokens.contentFilter,
        child: cover != null
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: cover),
                  Container(
                    height: 78,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    color: MynoteTokens.glassContentBg,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 13,
                                  height: 1.25,
                                  fontWeight: FontWeight.w700,
                                  color: MynoteTokens.textMain,
                                ),
                              ),
                            ),
                            if (summary.tags.isNotEmpty) ...[
                              const SizedBox(width: 6),
                              _tagChips(context, summary.tags),
                            ],
                          ],
                        ),
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '$timeText · ${derivedForMemo(memo).preview(60)}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: MynoteTokens.glassLabel,
                                ),
                              ),
                            ),
                            if (expandChip != null) ...[
                              const SizedBox(width: 8),
                              expandChip!,
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              )
            : Container(
                decoration: BoxDecoration(
                  color: MynoteTokens.glassContentBg,
                  border: Border.all(
                    color: MynoteTokens.glassContentBorder,
                    width: 0.5,
                  ),
                  borderRadius: BorderRadius.circular(26),
                ),
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (memo.pinned)
                          Container(
                            width: 7,
                            height: 7,
                            margin: const EdgeInsets.only(top: 7, right: 6),
                            decoration: const BoxDecoration(
                              color: Color(0xFFFF9500),
                              shape: BoxShape.circle,
                            ),
                          ),
                        Expanded(
                          child: Text(
                            title,
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 16,
                              height: 1.35,
                              fontWeight: FontWeight.w700,
                              color: MynoteTokens.textMain,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (summary.tags.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      _tagChips(context, summary.tags),
                    ],
                    const Spacer(),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: Text(
                            '$timeText  $preview',
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12,
                              height: 1.45,
                              color: MynoteTokens.glassLabel,
                            ),
                          ),
                        ),
                        if (expandChip != null) ...[
                          const SizedBox(width: 8),
                          expandChip!,
                        ],
                      ],
                    ),
                  ],
                ),
              ),
      ),
    );
    // bare：手势由外层 _SwipeShell 统一处理（宽屏滑动壳）
    if (bare) return content;
    return GestureDetector(onTap: onTap, child: content);
  }
}

/// 宽屏折叠堆叠卡：主卡下两层错位底卡（原版 ::before translateY(7)
/// scale(.94) opacity .68；::after translateY(4) scale(.97) opacity .86）。
class _StackedWideCard extends StatelessWidget {
  const _StackedWideCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    Widget layer(double dy, double scale, double opacity) => Positioned.fill(
      child: Transform.translate(
        offset: Offset(0, dy),
        child: Transform.scale(
          scale: scale,
          child: Opacity(
            opacity: opacity,
            child: Container(
              decoration: BoxDecoration(
                color: MynoteTokens.glassContentBg,
                border: Border.all(
                  color: MynoteTokens.glassContentBorder,
                  width: 0.5,
                ),
                borderRadius: BorderRadius.circular(26),
              ),
            ),
          ),
        ),
      ),
    );
    return Stack(children: [layer(7, 0.94, 0.68), layer(4, 0.97, 0.86), child]);
  }
}

/// 标签 chips（标题右侧）：文字色 #005BBB、边框 1px。窄屏渲染全部
/// 标签；宽屏只显 2 个 + 「+N」，且 chip 规格放大（11px / 高 20 / 横距 7）。
Widget _tagChips(BuildContext context, List<String> tags) {
  if (tags.isEmpty) return const SizedBox.shrink();
  final wide = MediaQuery.of(context).size.width >= 768;
  final shown = wide ? tags.take(2).toList() : tags;
  Widget chip(String text) => Container(
    height: wide ? 20 : 18,
    padding: EdgeInsets.symmetric(horizontal: wide ? 7 : 5),
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: MynoteTokens.glassControlBg,
      border: Border.all(color: MynoteTokens.glassControlBorder, width: 1),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      text,
      style: TextStyle(
        fontSize: wide ? 11 : 10,
        color: MynoteTokens.link,
        height: 1,
      ),
    ),
  );
  return Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      for (final t in shown) ...[chip(t), const SizedBox(width: 4)],
      if (tags.length > 2 && wide) chip('+${tags.length - 2}'),
    ],
  );
}

Widget _expandChip(String text, VoidCallback onTap) {
  return GestureDetector(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: MynoteTokens.glassControlBg,
        border: Border.all(color: MynoteTokens.glassControlBorder, width: 1),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 11, color: MynoteTokens.glassLabel),
      ),
    ),
  );
}

/// 文本行（原版 SwipeRow）：玻璃卡、标题 16 w650 + 标签、元信息行。
class _TextRowForeground extends StatelessWidget {
  const _TextRowForeground({
    required this.memo,
    required this.now,
    required this.use24h,
    this.expandText,
    this.onExpand,
  });

  final Memo memo;
  final DateTime now;
  final bool use24h;
  final String? expandText;
  final VoidCallback? onExpand;

  @override
  Widget build(BuildContext context) {
    final derived = derivedForMemo(memo);
    final summary = (
      preview: derived.preview(80),
      tags: derived.tags,
      attachCount: derived.attachCount,
    );
    final updated = DateTime.fromMillisecondsSinceEpoch(memo.updatedAt);
    return _glassBlur(
      radius: 32,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: _glassCardDecoration(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (memo.pinned) ...[
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: MynoteTokens.warning,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 6),
                ],
                // 标题恒最多占行宽 60%（Web .item-title-text max-width 60%）
                Flexible(
                  flex: 6,
                  child: Text(
                    memo.title.isEmpty ? '无标题' : memo.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: MynoteTokens.textMain,
                    ),
                  ),
                ),
                Flexible(
                  flex: 4,
                  child: summary.tags.isNotEmpty
                      ? Align(
                          alignment: Alignment.centerRight,
                          child: _tagChips(context, summary.tags),
                        )
                      : const SizedBox.shrink(),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${listTimeAgo(updated, now, use24h: use24h)}  ${summary.preview}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      color: MynoteTokens.glassLabel,
                    ),
                  ),
                ),
                if (expandText != null && onExpand != null) ...[
                  const SizedBox(width: 8),
                  _expandChip(expandText!, onExpand!),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// 图片卡（原版 ImageCard）：封面 16/9（取首个 attachment 图片）+
/// 正文区标题 15 w650 + timeAgo · 预览(60)。
class _ImageCardForeground extends ConsumerWidget {
  const _ImageCardForeground({
    required this.memo,
    required this.now,
    required this.use24h,
    this.expandText,
    this.onExpand,
  });

  final Memo memo;
  final DateTime now;
  final bool use24h;
  final String? expandText;
  final VoidCallback? onExpand;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final derived = derivedForMemo(memo);
    final summary = (
      preview: derived.preview(60),
      tags: derived.tags,
      attachCount: derived.attachCount,
    );
    final updated = DateTime.fromMillisecondsSinceEpoch(memo.updatedAt);
    final coverId = derived.coverFileId;
    Widget cover = Container(color: MynoteTokens.border);
    if (coverId != null) {
      final meta = ref.watch(attachmentMetaProvider(coverId));
      final isImage = meta.valueOrNull?.mime.startsWith('image/') ?? false;
      if (isImage) {
        final bytes = ref.watch(attachmentBytesProvider(coverId));
        final data = bytes.valueOrNull;
        if (data != null) {
          cover = Image.memory(
            data,
            fit: BoxFit.cover,
            cacheWidth:
                (MediaQuery.of(context).size.width *
                        MediaQuery.of(context).devicePixelRatio)
                    .ceil(),
          );
        }
      }
    }
    return _glassBlur(
      radius: 32,
      child: Container(
        width: double.infinity,
        decoration: _glassCardDecoration(),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AspectRatio(aspectRatio: 16 / 9, child: cover),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            memo.title.isEmpty ? '无标题' : memo.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: MynoteTokens.textMain,
                            ),
                          ),
                        ),
                        if (summary.tags.isNotEmpty) ...[
                          const SizedBox(width: 6),
                          _tagChips(context, summary.tags),
                        ],
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        Text(
                          listTimeAgo(updated, now, use24h: use24h),
                          style: TextStyle(
                            fontSize: 12,
                            color: MynoteTokens.glassLabel,
                          ),
                        ),
                        Expanded(
                          child: Text(
                            ' · ${summary.preview}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12,
                              color: MynoteTokens.glassLabel,
                            ),
                          ),
                        ),
                        if (expandText != null && onExpand != null) ...[
                          const SizedBox(width: 8),
                          _expandChip(expandText!, onExpand!),
                        ],
                      ],
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
}

/// 左滑操作外壳（原版 useSwipeGesture + .swipe-actions）：
/// 行左滑露出置顶（橙）/删除（红）圆角按钮，按钮随进度淡入滑入，
/// 55px 阈值吸附，动画 220ms cubic-bezier(0.25,0.46,0.45,0.94)。
class _SwipeShell extends StatefulWidget {
  const _SwipeShell({
    required this.child,
    required this.onTap,
    this.onPin,
    this.onDelete,
    this.pinned = false,
    this.isNewCard = false,
    this.radius = 32,
  });

  final Widget child;
  final VoidCallback onTap;
  final VoidCallback? onPin;
  final VoidCallback? onDelete;
  final bool pinned;
  final bool isNewCard;
  final double radius;

  @override
  State<_SwipeShell> createState() => _SwipeShellState();
}

class _SwipeShellState extends State<_SwipeShell>
    with SingleTickerProviderStateMixin {
  static const double _actionW = 168;
  static const double _threshold = 55;
  double _dx = 0;
  bool _opened = false;
  late final AnimationController _anim = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 220),
  );
  double _animFrom = 0;
  double _animTo = 0;

  @override
  void initState() {
    super.initState();
    _anim.addListener(() {
      final t = const Cubic(0.25, 0.46, 0.45, 0.94).transform(_anim.value);
      setState(() => _dx = _animFrom + (_animTo - _animFrom) * t);
    });
    _anim.addStatusListener((s) {
      if (s == AnimationStatus.completed) _opened = _animTo == -_actionW;
    });
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  void _snapTo(double target) {
    _animFrom = _dx;
    _animTo = target;
    _anim.forward(from: 0);
    _opened = target == -_actionW;
  }

  void _close() => _snapTo(0);

  Widget _actionButton({
    required double progress,
    required double hiddenShift,
    required Color bg,
    required String svgPath,
    required String label,
    required VoidCallback onTap,
  }) {
    return Opacity(
      opacity: progress.clamp(0, 1),
      child: Transform.translate(
        offset: Offset((1 - progress) * hiddenShift, 0),
        child: GestureDetector(
          onTap: progress > 0.3
              ? () {
                  _close();
                  onTap();
                }
              : null,
          child: Container(
            width: 68,
            height: 44,
            decoration: BoxDecoration(
              color: bg,
              border: Border.all(color: const Color(0x38FFFFFF), width: 0.5),
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SvgPicture.string(
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${svgPath.split('|').map((p) => '<path d="$p"/>').join()}</svg>',
                  width: 17,
                  height: 17,
                ),
                const SizedBox(height: 3),
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                    height: 1,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = (_dx.abs() / _actionW).clamp(0.0, 1.0);
    final pinP = ((p - 0.35) / 0.65).clamp(0.0, 1.0);
    final delP = (p / 0.55).clamp(0.0, 1.0);
    // P6：每张卡（含 BackdropFilter 玻璃层）独立 RepaintBoundary，
    // 滚动/横滑时单卡重绘不牵连整列，backdrop 采样范围也被隔离
    return RepaintBoundary(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(widget.radius),
        child: Stack(
          children: [
            if (!widget.isNewCard)
              Positioned(
                right: 0,
                top: 0,
                bottom: 0,
                width: _actionW,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    _actionButton(
                      progress: pinP,
                      hiddenShift: 60,
                      bg: MynoteTokens.warning,
                      svgPath: 'M12 17v5|M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z',
                      label: widget.pinned ? '取消' : '置顶',
                      onTap: widget.onPin ?? () {},
                    ),
                    const SizedBox(width: 8),
                    _actionButton(
                      progress: delP,
                      hiddenShift: 30,
                      bg: MynoteTokens.danger,
                      svgPath: 'M3 6h18|M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6|M10 11v6|M14 11v6|M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
                      label: '删除',
                      onTap: widget.onDelete ?? () {},
                    ),
                    const SizedBox(width: 10),
                  ],
                ),
              ),
            Transform.translate(
              offset: Offset(_dx, 0),
              child: FocusableActionDetector(
                actions: <Type, Action<Intent>>{
                  ActivateIntent: CallbackAction<ActivateIntent>(
                    onInvoke: (_) {
                      if (_opened) {
                        _close();
                      } else {
                        widget.onTap();
                      }
                      return null;
                    },
                  ),
                },
                child: RawGestureDetector(
                  gestures: widget.isNewCard
                      ? <Type, GestureRecognizerFactory>{
                          TapGestureRecognizer:
                              GestureRecognizerFactoryWithHandlers<
                                TapGestureRecognizer
                              >(() => TapGestureRecognizer(), (r) {
                                // 新建卡在 pointerdown 即触发（原版）
                                r.onTapDown = (_) => widget.onTap();
                              }),
                        }
                      : <Type, GestureRecognizerFactory>{
                          TapGestureRecognizer:
                              GestureRecognizerFactoryWithHandlers<
                                TapGestureRecognizer
                              >(() => TapGestureRecognizer(), (r) {
                                r.onTap = () {
                                  if (_opened) {
                                    _close();
                                  } else {
                                    widget.onTap();
                                  }
                                };
                              }),
                          _SwipeRecognizer:
                              GestureRecognizerFactoryWithHandlers<
                                _SwipeRecognizer
                              >(
                                () => _SwipeRecognizer(
                                  onDirectionReject: () => _snapTo(0),
                                ),
                                (r) {
                                  r.gestureSettings =
                                      const DeviceGestureSettings(touchSlop: 5);
                                  r.onStart = (_) => _anim.stop();
                                  r.onUpdate = (d) => setState(() {
                                    _dx = (_dx + d.delta.dx)
                                        .clamp(-_actionW, 0)
                                        .toDouble();
                                  });
                                  r.onEnd = (_) {
                                    if (_opened) {
                                      _snapTo(
                                        _dx > -_actionW + _threshold
                                            ? 0
                                            : -_actionW,
                                      );
                                    } else {
                                      _snapTo(
                                        _dx < -_threshold ? -_actionW : 0,
                                      );
                                    }
                                  };
                                  r.onCancel = () =>
                                      _snapTo(_opened ? -_actionW : 0);
                                },
                              ),
                        },
                  child: widget.child,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 横滑识别器（原版 useSwipeGesture.js 方向判定）：决断前若
/// |dy| > |dx| + 8 则自我拒绝（纵向滚动接管），并回调关闭已开行。
class _SwipeRecognizer extends HorizontalDragGestureRecognizer {
  _SwipeRecognizer({required this.onDirectionReject});

  final VoidCallback onDirectionReject;
  Offset _start = Offset.zero;
  bool _decided = false;

  @override
  void addPointer(PointerDownEvent event) {
    _start = event.position;
    _decided = false;
    super.addPointer(event);
  }

  @override
  void handleEvent(PointerEvent event) {
    if (event is PointerMoveEvent && !_decided) {
      final d = event.position - _start;
      if (d.dy.abs() > d.dx.abs() + 8) {
        _decided = true;
        resolve(GestureDisposition.rejected);
        onDirectionReject();
        return;
      }
      if (d.dx.abs() > 5) _decided = true;
    }
    super.handleEvent(event);
  }
}
