import 'dart:async';
import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../app/providers.dart';
import '../../core/body_scroll.dart';
import '../../core/body_scroll_column.dart';
import '../../core/content_slide.dart';
import '../../core/sheet_route.dart';
import '../../core/diag.dart';
import '../../core/page_header.dart';
import '../../core/prefs_store.dart';
import '../../core/tokens.dart';
import '../../services/drive_service.dart';
import '../../services/google_auth.dart';
import 'download_bytes.dart';

/// 备份与恢复页（原版 BackupView + panels.css 逐项对齐）：
/// 状态总览 hero、本地备份卡（导出/导入行）、Drive 卡（状态行 +
/// 备份/恢复行 + 胶囊按钮条）；云端恢复支持覆盖 / 合并两种模式。
class BackupPage extends ConsumerStatefulWidget {
  const BackupPage({super.key});

  @override
  ConsumerState<BackupPage> createState() => _BackupPageState();
}

class _BackupPageState extends ConsumerState<BackupPage>
    with RouteAware, TickerProviderStateMixin, ContentSlideMixin {
  final ScrollController _scroll = ScrollController();

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

  GoogleSession? _session;
  bool _busy = false;
  String _status = '';
  int _attachCount = 0;
  bool _attachLoaded = false;
  List<Map<String, dynamic>> _history = const [];
  Timer? _toastTimer;

  @override
  void initState() {
    super.initState();
    hostInsets.addListener(_onHostInsets);
    _history = _loadHistory();
    _refreshAttachCount();
  }

  @override
  void dispose() {
    hostInsets.removeListener(_onHostInsets);
    _scroll.dispose();
    _toastTimer?.cancel();
    super.dispose();
  }

  // ---- 操作历史（原版 memos_backup_history：localStorage 持久、上限 20） ----
  List<Map<String, dynamic>> _loadHistory() {
    try {
      final raw = prefsGet('memos_backup_history');
      if (raw == null || raw.isEmpty) return const [];
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        return decoded
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      }
    } catch (_) {}
    return const [];
  }

  void _addHistory(
    String type,
    String status,
    String message, [
    String? detail,
  ]) {
    final entry = <String, dynamic>{
      'type': type,
      'status': status,
      'message': message,
      if (detail != null && detail.isNotEmpty) 'detail': detail,
      'timestamp': DateTime.now().toIso8601String(),
    };
    final next = [entry, ..._history].take(20).toList();
    prefsSet('memos_backup_history', jsonEncode(next));
    if (mounted) setState(() => _history = next);
  }

  /// 附件计数（原版口径）：遍历全部笔记 doc，仅统计 type=attachment 且有
  /// fileId 的块，按 fileId 去重。
  Future<void> _refreshAttachCount() async {
    try {
      final db = ref.read(databaseProvider);
      final rows = await db.select(db.memos).get();
      final ids = <String>{};
      for (final memo in rows) {
        final doc = jsonDecode(memo.docJson);
        if (doc is List) {
          for (final node in doc) {
            if (node is Map && node['type'] == 'attachment') {
              final fid = node['fileId']?.toString() ?? '';
              if (fid.isNotEmpty) ids.add(fid);
            }
          }
        }
      }
      if (mounted) {
        setState(() {
          _attachCount = ids.length;
          _attachLoaded = true;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _attachLoaded = true);
    }
  }

  int _toastAnimKey = 0;

  void _setStatus(String s) {
    String cls(String v) => v.isEmpty
        ? 'empty'
        : (v.startsWith('✅') ? 'ok' : (v.startsWith('❌') ? 'err' : 'info'));
    if (cls(_status) != cls(s)) _toastAnimKey++;
    if (mounted) setState(() => _status = s);
    _toastTimer?.cancel();
    // Toast 时长（原版）：成功 3s、失败 6s；无 emoji 的 info 文案常驻
    if (s.startsWith('✅')) {
      _toastTimer = Timer(const Duration(seconds: 3), () => _setStatus(''));
    } else if (s.startsWith('❌')) {
      _toastTimer = Timer(const Duration(seconds: 6), () => _setStatus(''));
    }
  }

  // ---- 玻璃底部弹层（原版 backup modal：透明遮罩 + glass-overlay 面板） ----
  // 安全区（原版 BackupView.js 口径）：外层下距 = 安全区 + 14，
  // 面板内下距 = 14 + 安全区；安全区取生效值（引擎与宿主桥取大）——
  // 嵌入 Web 引擎恒 0，只读 MediaQuery 时真机上两层都不生效。
  Future<T?> _glassSheet<T>(Widget child) {
    return showMynoteSheet<T>(
      context: context,
      builder: (context) {
        final effBottom = effectiveInsets(
          MediaQuery.of(context).padding,
          hostInsets.value,
        ).bottom;
        return Padding(
          padding: EdgeInsets.fromLTRB(14, 0, 14, 14 + effBottom),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 600),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(28),
                child: BackdropFilter(
                  filter: MynoteTokens.overlayFilter,
                  child: Container(
                    padding: EdgeInsets.fromLTRB(14, 14, 14, 14 + effBottom),
                    decoration: BoxDecoration(
                      color: MynoteTokens.glassOverlayBg,
                      border: Border.all(
                        color: MynoteTokens.glassOverlayBorder,
                        width: 0.5,
                      ),
                      borderRadius: BorderRadius.circular(28),
                    ),
                    child: child,
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  /// 确认弹层：居中标题 + 居中正文 + primary 确认 + secondary 取消。
  Future<bool> _confirmSheet({
    required String title,
    required String body,
    required String confirmLabel,
  }) async {
    final ok = await _glassSheet<bool>(
      Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          Text(
            body,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              height: 1.45,
              color: MynoteTokens.textSecondary,
            ),
          ),
          const SizedBox(height: 12),
          _sheetButton(
            confirmLabel,
            primary: true,
            onTap: () => Navigator.pop(context, true),
          ),
          const SizedBox(height: 10),
          _sheetButton('取消', onTap: () => Navigator.pop(context, false)),
        ],
      ),
    );
    return ok == true;
  }

  Widget _sheetButton(
    String label, {
    bool primary = false,
    VoidCallback? onTap,
  }) {
    return _pillButton(label, primary: primary, onTap: onTap);
  }

  Future<void> _exportLocal() async {
    final confirmed = await _confirmSheet(
      title: '确认导出备份',
      body: '打包全部笔记、附件与头像为 zip，将通过系统分享面板保存或发送。',
      confirmLabel: '确认导出',
    );
    if (!confirmed) return;
    setState(() => _busy = true);
    try {
      final service = await ref.read(backupServiceProvider.future);
      final bytes = await service.exportZip(
        level: 6,
        onProgress: (d, t) => _setStatus('正在打包附件 $d/$t...'),
      );
      final now = DateTime.now().toUtc();
      final name =
          '此刻备份_${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}.zip';
      downloadBytes(bytes, name, mime: 'application/zip');
      _setStatus('✅ 本地备份已下载 (.zip)');
      _addHistory('export', 'success', '备份已下载', name);
      Diag.log('BACKUP', 'local export $name (${bytes.length}B)');
    } catch (e) {
      _setStatus('❌ 导出失败: $e');
      _addHistory('export', 'fail', '导出失败', '$e');
      Diag.error('BACKUP', e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _importLocal() async {
    // 原版顺序：先选文件，再弹确认（覆盖不可撤销），确认后才导入。
    const typeGroup = XTypeGroup(label: 'ZIP 备份', extensions: ['zip']);
    final file = await openFile(acceptedTypeGroups: [typeGroup]);
    if (file == null) return;
    final confirmed = await _confirmSheet(
      title: '确认恢复备份',
      body: '当前所有数据将被覆盖，此操作不可撤销。',
      confirmLabel: '确认恢复',
    );
    if (!confirmed) return;
    setState(() => _busy = true);
    try {
      final bytes = await file.readAsBytes();
      final service = await ref.read(backupServiceProvider.future);
      final report = await service.importZip(
        bytes,
        onProgress: (d, t) => _setStatus('正在校验附件 $d/$t...'),
      );
      _setStatus('✅ 恢复成功：${report.memos} 篇笔记、${report.attachments} 个附件');
      _addHistory('restore', 'success', '从本地文件恢复', file.name);
      _refreshAttachCount();
    } catch (e) {
      _setStatus('❌ 导入失败: $e');
      _addHistory('restore', 'fail', '导入失败', '$e');
      Diag.error('BACKUP', e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _connect() async {
    setState(() => _busy = true);
    try {
      final session = await requestGoogleAccess();
      if (session == null) {
        _setStatus('❌ 授权失败，请重试');
        _addHistory('connect', 'fail', '授权失败');
      } else {
        setState(() => _session = session);
        _setStatus('✅ Google 账号已连接');
        _addHistory('connect', 'success', 'Google 账号已连接', session.name);
      }
    } catch (e) {
      _setStatus('❌ 连接失败: $e');
      _addHistory('connect', 'fail', '连接失败', '$e');
      Diag.error('DRIVE', e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _disconnect() {
    // 原版：吊销 token + 清 google_avatar（Flutter 的 GIS 会话为内存态，
    // 这里清本地会话与头像缓存，状态文案常驻显示）
    prefsRemove('google_avatar');
    setState(() => _session = null);
    _setStatus('已断开 Google 账号');
  }

  DriveApi? _api() {
    final s = _session;
    if (s == null) return null;
    if (!s.isValid) {
      setState(() => _session = null);
      _setStatus('❌ Google 授权已失效，请重新连接');
      return null;
    }
    return DriveApi(s.accessToken);
  }

  Future<void> _backupToDrive() async {
    final api = _api();
    if (api == null) return;
    setState(() => _busy = true);
    try {
      final service = await ref.read(backupServiceProvider.future);
      final bytes = await service.exportZip(
        includeAvatarsJson: true,
        onProgress: (d, t) => _setStatus('正在打包附件 $d/$t...'),
      );
      if (bytes.length > 50 * 1024 * 1024)
        throw StateError('压缩后的备份超过 50 MiB 安全上限');
      final existing = selectMynoteBackup(await api.listBackups());
      await api.uploadResumable(
        fileId: existing?.id,
        bytes: bytes,
        name: driveBackupFileName,
      );
      final memoCount =
          (ref.read(memosProvider).valueOrNull ?? const []).length;
      _setStatus('✅ 云端备份完成');
      _addHistory('upload', 'success', '云端备份成功', '$memoCount 条笔记');
    } on DriveAuthException catch (e) {
      setState(() => _session = null);
      _setStatus(
        e.kind == 'expired' ? '❌ Google 授权已失效，请重新连接' : '❌ Google 拒绝访问（403）',
      );
      _addHistory('upload', 'fail', '云端备份失败', e.kind);
    } catch (e) {
      _setStatus('❌ 云端备份失败: $e');
      _addHistory('upload', 'fail', '云端备份失败', '$e');
      Diag.error('DRIVE', e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _restoreFromDrive() async {
    final api = _api();
    if (api == null) return;
    setState(() => _busy = true);
    try {
      final target = selectMynoteBackup(await api.listBackups());
      if (target == null) {
        _setStatus('云端暂无备份');
        return;
      }
      if (!mounted) return;
      // 原版恢复方式弹层（玻璃底部层 + 语义色选项卡）
      final mode = await _glassSheet<String>(
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              '从云端恢复',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            _restoreOption(
              'replace',
              '覆盖本地恢复',
              '清空本地后用云端完整替换，适合换设备或彻底回档。',
              danger: true,
            ),
            const SizedBox(height: 10),
            _restoreOption(
              'merge',
              '合并云端到本地',
              '保留本地独有数据，重复项以云端为准。',
              danger: false,
            ),
            const SizedBox(height: 10),
            _sheetButton('取消', onTap: () => Navigator.pop(context)),
          ],
        ),
      );
      if (mode == null) return;
      // 原版选后还有一层 window.confirm 二次确认（覆盖不可撤销）
      final confirmed = await _confirmSheet(
        title: mode == 'merge' ? '合并云端到本地' : '覆盖本地恢复',
        body: mode == 'merge'
            ? '从云端合并到本地？云端数据将与本地合并，重复项以云端为准，本地数据不会被覆盖。'
            : '确认从云端恢复？当前所有数据将被覆盖，此操作不可撤销。',
        confirmLabel: mode == 'merge' ? '确认合并' : '确认覆盖',
      );
      if (!confirmed) return;
      _addHistory('restore', 'info', '从云端恢复', '进行中...');
      _setStatus('正在下载云端备份...');
      final bytes = await api.download(target.id);
      final service = await ref.read(backupServiceProvider.future);
      final isJson = target.name.toLowerCase().endsWith('.json');
      if (mode == 'merge') {
        final report = isJson
            ? await service.importCloudJson(bytes, merge: true)
            : await service.importZipMerge(
                bytes,
                onProgress: (d, t) => _setStatus('正在校验附件 $d/$t...'),
              );
        _setStatus(
          '✅ 合并成功：云端 ${report.memos} 篇笔记已并入，新增 ${report.attachments} 个附件',
        );
      } else {
        final report = isJson
            ? await service.importCloudJson(bytes)
            : await service.importZip(
                bytes,
                onProgress: (d, t) => _setStatus('正在校验附件 $d/$t...'),
              );
        _setStatus('✅ 云端恢复成功：${report.memos} 篇笔记、${report.attachments} 个附件');
        _addHistory('restore', 'success', '从云端恢复', target.name);
      }
      _refreshAttachCount();
    } on DriveAuthException catch (e) {
      setState(() => _session = null);
      _setStatus(
        e.kind == 'expired' ? '❌ Google 授权已失效，请重新连接' : '❌ Google 拒绝访问（403）',
      );
      _addHistory('restore', 'fail', '云端恢复失败', e.kind);
    } catch (e) {
      _setStatus('❌ 云端恢复失败: $e');
      _addHistory('restore', 'fail', '云端恢复失败', '$e');
      Diag.error('DRIVE', e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// 恢复方式选项卡（原版语义色：覆盖 = danger 边/题，合并 = accent 边/题）。
  Widget _restoreOption(
    String mode,
    String title,
    String desc, {
    required bool danger,
  }) {
    final color = danger ? const Color(0xFFFF3B30) : MynoteTokens.accent;
    final border = danger ? const Color(0x33FF3B30) : const Color(0x40007AFF);
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: BackdropFilter(
        filter: MynoteTokens.contentFilter,
        child: Container(
          width: double.infinity,
          decoration: BoxDecoration(
            color: MynoteTokens.glassContentBg,
            border: Border.all(color: border, width: 0.5),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              borderRadius: BorderRadius.circular(22),
              splashColor: Colors.transparent,
              highlightColor: MynoteTokens.fillHoverStrong,
              onTap: () => Navigator.pop(context, mode),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          danger
                              ? Icons.warning_amber_rounded
                              : Icons.merge_type_rounded,
                          size: 18,
                          color: color,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          title,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: color,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Padding(
                      padding: const EdgeInsets.only(left: 24),
                      child: Text(
                        desc,
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.45,
                          color: MynoteTokens.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// 上次备份（原版口径）：历史中最近一条 upload+success 推导；
  /// 无 →「暂无」，时间戳坏 →「未知」；今天/昨天 + 时分（随系统 12/24 小时制）。
  String _lastBackupLabel(BuildContext context) {
    for (final e in _history) {
      if (e['type'] == 'upload' && e['status'] == 'success') {
        final t = DateTime.tryParse(e['timestamp']?.toString() ?? '');
        if (t == null) return '未知';
        final use24 = MediaQuery.of(context).alwaysUse24HourFormat;
        final String time;
        if (use24) {
          time =
              '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
        } else {
          final h12 = t.hour % 12 == 0 ? 12 : t.hour % 12;
          time =
              '${t.hour < 12 ? '上午' : '下午'} $h12:${t.minute.toString().padLeft(2, '0')}';
        }
        final now = DateTime.now();
        final today = DateTime(now.year, now.month, now.day);
        final day = DateTime(t.year, t.month, t.day);
        if (day == today) return '今天 $time';
        if (day == today.subtract(const Duration(days: 1))) return '昨天 $time';
        return '${t.month}/${t.day} $time';
      }
    }
    return '暂无';
  }

  @override
  Widget build(BuildContext context) {
    final memos = ref.watch(memosProvider).valueOrNull ?? const [];
    final connected = _session != null;
    final eff = effectiveInsets(
      MediaQuery.of(context).padding,
      hostInsets.value,
    );
    final safeTop = eff.top;
    final safeBottom = eff.bottom;
    // 安全区统一模型（同设置页）：底色全屏漆满、页眉固定覆盖、
    // 内容全屏滚动；顶距 126 = 原版备份页口径，底距 40 + 安全区
    return Scaffold(
      backgroundColor: MynoteTokens.primaryBg,
      body: Stack(
        children: [
          slideContent(
            Stack(
              children: [
                Positioned.fill(
                  child: BodyScrollColumn(
                    fallbackController: _scroll,
                    padding: EdgeInsets.fromLTRB(20, 126, 20, 40 + safeBottom),
                    children: [
                      // 状态总览 hero（glass content、圆角 30、内距 18、真模糊）
                      _glassCard(
                        30,
                        Padding(
                          padding: const EdgeInsets.all(18),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  const Text(
                                    '备份状态总览',
                                    style: TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const Spacer(),
                                  _badge(connected),
                                ],
                              ),
                              const SizedBox(height: 10),
                              Text.rich(
                                TextSpan(
                                  style: TextStyle(
                                    fontSize: 13,
                                    height: 1.5,
                                    color: MynoteTokens.textSecondary,
                                  ),
                                  children: [
                                    TextSpan(
                                      text:
                                          '☁️ Google Drive ${connected ? '正常' : '未连接'}',
                                    ),
                                    TextSpan(
                                      text: ' · ',
                                      style: TextStyle(
                                        color: MynoteTokens.textSecondary
                                            .withValues(alpha: 0.3),
                                      ),
                                    ),
                                    TextSpan(
                                      text: '上次备份 ${_lastBackupLabel(context)}',
                                    ),
                                    TextSpan(
                                      text: ' · ',
                                      style: TextStyle(
                                        color: MynoteTokens.textSecondary
                                            .withValues(alpha: 0.3),
                                      ),
                                    ),
                                    TextSpan(text: '${memos.length} 条笔记'),
                                    if (_attachLoaded) ...[
                                      TextSpan(
                                        text: ' · ',
                                        style: TextStyle(
                                          color: MynoteTokens.textSecondary
                                              .withValues(alpha: 0.3),
                                        ),
                                      ),
                                      TextSpan(text: '$_attachCount 个附件'),
                                    ],
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 30),
                      // 本地备份卡
                      _glassCard(
                        28,
                        Column(
                          children: [
                            _backupRow(
                              svgPath: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M17 8l-5-5-5 5M12 3v12',
                              title: '导出备份',
                              desc: '分享 zip 到系统文件 App',
                              onTap: _busy ? null : _exportLocal,
                              showDivider: true,
                            ),
                            _backupRow(
                              svgPath: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5M12 15V3',
                              title: '导入备份',
                              desc: '从文件 App 选择 zip 恢复',
                              onTap: _busy ? null : _importLocal,
                              showDivider: false,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      // Drive 卡
                      _glassCard(
                        28,
                        Column(
                          children: [
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 18,
                                vertical: 16,
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          'Google Drive 云备份',
                                          style: TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                        SizedBox(height: 6),
                                        Text(
                                          '开启后，笔记与附件将自动备份到云端。',
                                          style: TextStyle(
                                            fontSize: 13,
                                            height: 1.45,
                                            color: MynoteTokens.glassLabel,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  _badge(connected),
                                ],
                              ),
                            ),
                            // 操作区（原版内联内距 10/14/14 + 顶分隔）
                            Container(
                              padding: const EdgeInsets.fromLTRB(
                                14,
                                10,
                                14,
                                14,
                              ),
                              decoration: BoxDecoration(
                                border: Border(
                                  top: BorderSide(
                                    color: MynoteTokens.border,
                                    width: 0.5,
                                  ),
                                ),
                              ),
                              child: connected
                                  ? Column(
                                      children: [
                                        _pillButton(
                                          _busy ? '备份中...' : '上传到云端',
                                          primary: true,
                                          icon: true,
                                          onTap: _busy ? null : _backupToDrive,
                                        ),
                                        const SizedBox(height: 8),
                                        Row(
                                          children: [
                                            Expanded(
                                              child: _pillButton(
                                                '断开账号',
                                                onTap: _busy
                                                    ? null
                                                    : _disconnect,
                                              ),
                                            ),
                                            const SizedBox(width: 8),
                                            Expanded(
                                              child: _pillButton(
                                                '从云端恢复',
                                                onTap: _busy
                                                    ? null
                                                    : _restoreFromDrive,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ],
                                    )
                                  : _pillButton(
                                      '连接 Google 账号',
                                      primary: true,
                                      onTap: _busy ? null : _connect,
                                    ),
                            ),
                          ],
                        ),
                      ),
                      if (_history.isNotEmpty) _historySection(),
                    ],
                  ),
                ),
                Positioned(
                  top: safeTop,
                  left: 0,
                  right: 0,
                  child: PageHeader(title: '备份与恢复', onBack: popWithSlide),
                ),
              ],
            ),
          ),
          if (_status.isNotEmpty) _toast(),
        ],
      ),
    );
  }

  /// 玻璃卡：半透明底 + BackdropFilter 真模糊（原版 glass-content-filter）。
  Widget _glassCard(double radius, Widget child) {
    return ClipRRect(
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
    );
  }

  /// 状态 Toast（原版：底部浮层 glass-overlay、圆角 28、图标按类型；
  /// 入场 toastSlideUp：上移 24px + scale .94、220ms 回弹曲线）。
  Widget _toast() {
    final isSuccess = _status.startsWith('✅');
    final isError = _status.startsWith('❌');
    final text = _status.replaceFirst(RegExp(r'^[✅❌]\s*'), '');
    // 原版备份 toast：bottom calc(env(bottom) + 16px)——用生效 inset
    // （引擎与宿主桥取大），与编辑器 toast 同一口径
    final safeBottom = effectiveInsets(
      MediaQuery.of(context).padding,
      hostInsets.value,
    ).bottom;
    return Positioned(
      left: 16,
      right: 16,
      bottom: 16 + safeBottom,
      child: TweenAnimationBuilder<double>(
        key: ValueKey(_toastAnimKey),
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
                children: [
                  if (isSuccess)
                    const Text('✅', style: TextStyle(fontSize: 16))
                  else if (isError)
                    const Text('❌', style: TextStyle(fontSize: 16))
                  else
                    const _ToastSpinner(),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      text,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        height: 1.35,
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

  /// 最近操作（原版：最多 6 条，状态点 + 类型 chip + 时间 + detail）。
  Widget _historySection() {
    const typeLabels = {'upload': '云端', 'export': '导出', 'restore': '恢复'};
    final items = _history.take(6).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 16, bottom: 8, left: 4),
          child: Text(
            '最近操作',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              letterSpacing: 0.5,
              color: MynoteTokens.glassLabel,
            ),
          ),
        ),
        _glassCard(
          28,
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Column(
              children: [
                for (var i = 0; i < items.length; i++)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      border: (i < _history.length - 1 && i < 5)
                          ? Border(
                              bottom: BorderSide(
                                color: MynoteTokens.border,
                                width: 0.5,
                              ),
                            )
                          : null,
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: items[i]['status'] == 'success'
                                  ? MynoteTokens.success
                                  : items[i]['status'] == 'fail'
                                  ? const Color(0xFFFF3B30)
                                  : MynoteTokens.accent,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      items[i]['message']?.toString() ?? '',
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
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
                                      typeLabels[items[i]['type']] ?? '连接',
                                      style: TextStyle(
                                        fontSize: 9,
                                        fontWeight: FontWeight.w700,
                                        letterSpacing: 0.3,
                                        color: MynoteTokens.glassLabel,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              _historyTimeLine(items[i]),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// 历史时间行：时间戳 + detail 以 0.3 透明的「·」连接（原版规格）。
  Widget _historyTimeLine(Map<String, dynamic> e) {
    final t = DateTime.tryParse(e['timestamp']?.toString() ?? '');
    final detail = e['detail']?.toString() ?? '';
    final style = TextStyle(fontSize: 12, color: MynoteTokens.textSecondary);
    if (t == null) return Text(detail, style: style);
    final stamp =
        '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')} ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    if (detail.isEmpty) return Text(stamp, style: style);
    return Text.rich(
      TextSpan(
        style: style,
        children: [
          TextSpan(text: stamp),
          TextSpan(
            text: ' · ',
            style: TextStyle(
              color: MynoteTokens.textSecondary.withValues(alpha: 0.3),
            ),
          ),
          TextSpan(text: detail),
        ],
      ),
    );
  }

  Widget _badge(bool connected) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: connected ? const Color(0x2434C759) : const Color(0x1F7F7F7F),
        border: Border.all(color: MynoteTokens.glassControlBorder, width: 1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        connected ? '已连接' : '未连接',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: connected ? MynoteTokens.success : MynoteTokens.glassLabel,
        ),
      ),
    );
  }

  Widget _backupRow({
    required String svgPath,
    required String title,
    required String desc,
    required VoidCallback? onTap,
    required bool showDivider,
  }) {
    // 按压态：同心圆角——卡片半径 28、横向内缩 8、高亮半径 20
    // （= 28 − 8）；纵向内缩 2 保持多行分隔节奏；本地 Material
    // 画布保证墨迹只出现在圆角内，不再溢出成直角矩形
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: Material(
        type: MaterialType.transparency,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          splashColor: Colors.transparent,
          highlightColor: MynoteTokens.fillHoverStrong,
          hoverColor: Colors.transparent,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
            decoration: BoxDecoration(
              border: showDivider
                  ? Border(
                      bottom: BorderSide(
                        color: MynoteTokens.border,
                        width: 0.5,
                      ),
                    )
                  : null,
            ),
            child: Row(
              children: [
                SvgPicture.string(
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath.split('|').map((p) => '<path d="$p"/>').join()}</svg>',
                  width: 28,
                  height: 28,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        desc,
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.45,
                          color: MynoteTokens.glassLabel,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  '›',
                  style: TextStyle(
                    fontSize: 18,
                    color: MynoteTokens.glassLabel.withValues(alpha: 0.45),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _pillButton(
    String label, {
    bool primary = false,
    bool danger = false,
    bool icon = false,
    VoidCallback? onTap,
  }) {
    final bg = primary
        ? const Color(0xDB007AFF)
        : danger
        ? const Color(0x24FF453A)
        : MynoteTokens.glassControlBg;
    final fg = primary
        ? Colors.white
        : danger
        ? MynoteTokens.danger
        : MynoteTokens.textMain;
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        splashColor: Colors.transparent,
        highlightColor: Colors.transparent,
        hoverColor: Colors.transparent,
        onTap: onTap,
        child: Container(
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border.all(
              color: primary
                  ? const Color(0x3DFFFFFF)
                  : danger
                  ? const Color(0x2EFF453A)
                  : MynoteTokens.glassControlBorder,
              width: 1,
            ),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon) ...[
                SvgPicture.string(
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v12M7 12l3 3 3-3M4 16v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1"/></svg>',
                  width: 16,
                  height: 16,
                ),
                const SizedBox(width: 6),
              ],
              Text(
                label,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Toast info 指示器（原版 toastSpin）：16×16 圆环，底环 accent 20%，
/// 顶弧 accent，0.7s 线性无限旋转。
class _ToastSpinner extends StatefulWidget {
  const _ToastSpinner();

  @override
  State<_ToastSpinner> createState() => _ToastSpinnerState();
}

class _ToastSpinnerState extends State<_ToastSpinner>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 700),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 16,
      height: 16,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => CustomPaint(
          painter: _ToastRingPainter(_c.value * 6.283185307179586),
        ),
      ),
    );
  }
}

class _ToastRingPainter extends CustomPainter {
  _ToastRingPainter(this.rotation);
  final double rotation;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 1;
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = MynoteTokens.accent.withValues(alpha: 0.2);
    canvas.drawCircle(center, radius, base);
    final arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..color = MynoteTokens.accent;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      rotation - 1.5707963267948966,
      1.6,
      false,
      arc,
    );
  }

  @override
  bool shouldRepaint(_ToastRingPainter old) => old.rotation != rotation;
}
