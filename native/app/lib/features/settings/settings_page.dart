import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:super_editor/super_editor.dart';

import '../../app/providers.dart';
import '../../core/diag.dart';
import '../../core/page_header.dart';
import '../../core/body_scroll.dart';
import '../../core/body_scroll_column.dart';
import '../../core/content_slide.dart';
import '../../core/page_route.dart';
import '../../core/prefs_store.dart';
import '../../core/tokens.dart';
import '../backup_ui/backup_page.dart';

/// 设置页（对照原版 SettingsView 实拍）：外观（文字大小）/ 数据
/// （备份与恢复）/ 诊断（本项目规矩，用户指定入口）/ 关于。
/// 行式为白色胶囊卡、无图标；页眉为返回圆钮 + 标题胶囊。
class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage>
    with RouteAware, TickerProviderStateMixin, ContentSlideMixin {
  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    hostInsets.addListener(_onHostInsets);
  }

  void _onHostInsets() {
    if (mounted) setState(() {});
  }

  @override
  void didPopNext() {
    super.didPopNext();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) BodyScrollColumn.reportActiveHeight();
    });
  }

  @override
  void dispose() {
    hostInsets.removeListener(_onHostInsets);
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final fontSize = ref.watch(fontSizeProvider);
    final eff = effectiveInsets(
      MediaQuery.of(context).padding,
      hostInsets.value,
    );
    final safeTop = eff.top;
    final safeBottom = eff.bottom;
    // 安全区统一模型（对齐原版 body 滚动）：Scaffold 底色全屏漆满
    // 灵动岛/小白条区，页眉为固定覆盖层（原版 editor-fab + compact
    // 标题皆 fixed 于 env(safe-area-inset-top)+7），内容全屏滚动从
    // 页眉下穿过；不再用 SafeArea 分治（各页口径不一是 iOS Web
    // 安全区渲染问题的来源）。内容顶距 126 = 原版设置页口径，
    // 底距 36 + 安全区（原版 calc(40px + env(safe-area-inset-bottom))
    // 的近似：本页原底距 36）。
    return Scaffold(
      backgroundColor: MynoteTokens.primaryBg,
      body: slideContent(
        Stack(
          children: [
            Positioned.fill(
              child: BodyScrollColumn(
                fallbackController: _scroll,
                padding: EdgeInsets.only(top: 126, bottom: 40 + safeBottom),
                children: [
                  const _SectionLabel('外观'),
                  _CapsuleCard(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 14,
                      ),
                      child: Row(
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '文字大小',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                '跟随浏览器缩放',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: MynoteTokens.glassLabel,
                                ),
                              ),
                            ],
                          ),
                          const Spacer(),
                          for (final option in const [
                            ('small', '小', 13.0),
                            ('medium', '中', 15.0),
                            ('large', '大', 17.0),
                          ])
                            Padding(
                              padding: const EdgeInsets.only(left: 6),
                              child: GestureDetector(
                                onTap: () {
                                  prefsSet('sj_fontsize', option.$1);
                                  ref.read(fontSizeProvider.notifier).state =
                                      option.$1;
                                  Diag.log(
                                    'SETTINGS',
                                    'font size -> ${option.$1}',
                                  );
                                },
                                child: AnimatedContainer(
                                  duration: const Duration(milliseconds: 180),
                                  height: 32,
                                  constraints: const BoxConstraints(
                                    minWidth: 40,
                                  ),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                  ),
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    // 选中：fill-accent-10 底 + fill-accent-35 边；
                                    // 未选：glass-control 底/边（原版规格）
                                    color: fontSize == option.$1
                                        ? MynoteTokens.fillAccent10
                                        : MynoteTokens.glassControlBg,
                                    border: Border.all(
                                      width: 0.5,
                                      color: fontSize == option.$1
                                          ? MynoteTokens.fillAccent35
                                          : MynoteTokens.glassControlBorder,
                                    ),
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                  child: Text(
                                    option.$2,
                                    style: TextStyle(
                                      fontSize: option.$3,
                                      fontWeight: fontSize == option.$1
                                          ? FontWeight.w700
                                          : FontWeight.w500,
                                      color: fontSize == option.$1
                                          ? MynoteTokens.accent
                                          : MynoteTokens.textMain,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const _SectionLabel('数据'),
                  _CapsuleCard(
                    child: _NavRow(
                      title: '备份与恢复',
                      subtitle: Text(
                        'Google Drive 云端同步',
                        style: TextStyle(
                          fontSize: 12,
                          color: MynoteTokens.glassLabel,
                        ),
                      ),
                      onTap: () => Navigator.of(context).push(
                        mynoteStaticHeaderRoute(context, const BackupPage()),
                      ),
                    ),
                  ),
                  const _SectionLabel('诊断'),
                  _CapsuleCard(
                    child: _NavRow(
                      title: '诊断日志',
                      subtitle: ListenableBuilder(
                        listenable: Diag.tick,
                        builder: (context, _) => Text(
                          '共 ${Diag.events.length} 条 · 含上次会话（崩溃/重载后仍在）',
                          style: TextStyle(
                            fontSize: 12,
                            color: MynoteTokens.glassLabel,
                          ),
                        ),
                      ),
                      onTap: () => Navigator.of(context).push(
                        mynoteStaticHeaderRoute(context, const DiagLogPage()),
                      ),
                    ),
                  ),
                  const _SectionLabel('关于'),
                  _CapsuleCard(
                    radius: 28,
                    child: Column(
                      children: [
                        Padding(
                          padding: EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 14,
                          ),
                          child: Row(
                            children: [
                              Text(
                                '版本',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              Spacer(),
                              Text(
                                '2.2.7',
                                style: TextStyle(
                                  fontSize: 14,
                                  color: MynoteTokens.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Container(
                            height: 0.5,
                            color: MynoteTokens.border,
                          ),
                        ),
                        Padding(
                          padding: EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 14,
                          ),
                          child: Row(
                            children: [
                              Text(
                                '联系我们',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              Spacer(),
                              Text(
                                'overcanopies@gmail.com',
                                style: TextStyle(
                                  fontSize: 13.6,
                                  color: MynoteTokens.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.only(top: 12),
                    child: Opacity(
                      opacity: 0.8,
                      child: Text(
                        '此刻，值得被记住。',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 12,
                          fontStyle: FontStyle.italic,
                          color: MynoteTokens.textSecondary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              top: safeTop,
              left: 0,
              right: 0,
              child: PageHeader(title: '设置', onBack: popWithSlide),
            ),
          ],
        ),
      ),
    );
  }
}

/// 设置页导航行：标题 + 副题 + ›，点按无反馈（原版 .list-item 无 :active）。
class _NavRow extends StatelessWidget {
  const _NavRow({
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final String title;
  final Widget subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // 按压态：同心圆角——卡片半径 32、内缩 8、高亮半径 24
    // （= 32 − 8，圆心同轴不别扭）；本地 Material 画布保证墨迹
    // 只出现在圆角内；文字位置与原内边距等效 16/13、总高不变
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Material(
        type: MaterialType.transparency,
        borderRadius: BorderRadius.circular(24),
        child: InkWell(
          borderRadius: BorderRadius.circular(24),
          splashColor: Colors.transparent,
          highlightColor: MynoteTokens.fillHoverStrong,
          hoverColor: Colors.transparent,
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 3),
                      subtitle,
                    ],
                  ),
                ),
                Text(
                  '›',
                  style: TextStyle(
                    fontSize: 18,
                    height: 1,
                    color: MynoteTokens.textSecondary.withValues(alpha: 0.45),
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

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 6),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.3,
          color: MynoteTokens.textSecondary,
        ),
      ),
    );
  }
}

class _CapsuleCard extends StatelessWidget {
  const _CapsuleCard({required this.child, this.radius = 32});
  final Widget child;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: BackdropFilter(
          filter: MynoteTokens.contentFilter,
          child: Container(
            decoration: BoxDecoration(
              color: MynoteTokens.glassContentBg,
              border: Border.all(
                color: MynoteTokens.glassContentBorder,
                width: 0.5,
              ),
              borderRadius: BorderRadius.circular(radius),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// 诊断日志页：Diag（全模块，持久化）+ ImeDebug（IME 客户端，本会话）
/// 合并按时间戳排序展示；可复制全文或清空。
class DiagLogPage extends StatefulWidget {
  const DiagLogPage({super.key});

  static List<String> _merged() {
    return <String>[...Diag.events, ...ImeDebug.events]..sort();
  }

  @override
  State<DiagLogPage> createState() => _DiagLogPageState();
}

class _DiagLogPageState extends State<DiagLogPage>
    with RouteAware, TickerProviderStateMixin, ContentSlideMixin {
  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    hostInsets.addListener(_onHostInsets);
    if (bodyScrollSupported) {
      // 与原内部滚动 reverse 锚底一致：进页落到最底（最新日志在底）
      WidgetsBinding.instance.addPostFrameCallback((_) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          scrollWindowTo(1e9);
        });
      });
    }
  }

  void _onHostInsets() {
    if (mounted) setState(() {});
  }

  @override
  void didPopNext() {
    super.didPopNext();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) BodyScrollColumn.reportActiveHeight();
    });
  }

  @override
  void dispose() {
    hostInsets.removeListener(_onHostInsets);
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final eff = effectiveInsets(
      MediaQuery.of(context).padding,
      hostInsets.value,
    );
    final safeTop = eff.top;
    final safeBottom = eff.bottom;
    // 安全区统一模型同设置页：底色全屏、页眉固定覆盖、内容全屏滚动
    return Scaffold(
      backgroundColor: MynoteTokens.primaryBg,
      body: slideContent(
        Stack(
          children: [
            Positioned.fill(
              child: ListenableBuilder(
                listenable: Listenable.merge([Diag.tick, ImeDebug.tick]),
                builder: (context, _) {
                  final events = DiagLogPage._merged();
                  if (events.isEmpty) {
                    return const Center(child: Text('暂无日志'));
                  }
                  return BodyScrollColumn(
                    fallbackController: _scroll,
                    padding: EdgeInsets.only(
                      top: safeTop + 65,
                      bottom: safeBottom + 8,
                    ),
                    children: [
                      for (final e in events)
                        Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 1.5,
                          ),
                          child: Text(
                            e,
                            style: const TextStyle(
                              fontSize: 10.5,
                              fontFamily: 'monospace',
                              height: 1.35,
                            ),
                          ),
                        ),
                    ],
                  );
                },
              ),
            ),
            Positioned(
              top: safeTop,
              left: 0,
              right: 0,
              child: Row(
                children: [
                  Expanded(
                    child: PageHeader(title: '诊断日志', onBack: popWithSlide),
                  ),
                  IconButton(
                    icon: const Icon(Icons.copy_outlined),
                    tooltip: '复制全部',
                    onPressed: () async {
                      await Clipboard.setData(
                        ClipboardData(text: DiagLogPage._merged().join('\n')),
                      );
                      if (context.mounted) {
                        // 浮动式并抬离底部安全区（生效值）：定宽 SnackBar
                        // 贴底会压进小白条区（2026-11-20 审计修正）。
                        final effBottom = effectiveInsets(
                          MediaQuery.of(context).padding,
                          hostInsets.value,
                        ).bottom;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: const Text('日志已复制'),
                            duration: const Duration(seconds: 1),
                            behavior: SnackBarBehavior.floating,
                            margin: EdgeInsets.fromLTRB(
                              16,
                              0,
                              16,
                              16 + effBottom,
                            ),
                          ),
                        );
                      }
                    },
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline),
                    tooltip: '清空',
                    onPressed: () {
                      Diag.clear();
                      ImeDebug.clear();
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
