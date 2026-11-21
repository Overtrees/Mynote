import 'dart:async';
import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/diag.dart';
import 'core/chrome_sync.dart';
import 'core/update_check.dart';
import 'core/body_scroll.dart';
import 'core/safe_area_bridge.dart';
import 'core/content_slide.dart';
import 'core/reload_page.dart';
import 'core/tokens.dart';
import 'app/providers.dart';
import 'features/list/memo_list_page.dart';

void main() {
  // 必须最先初始化 binding：其后任何 Binding.instance 访问
  // （如 PaintingBinding）在初始化前调用会直接抛错、runApp 永远
  // 到不了，页面就死在加载屏（35be6f01 曾因此整版进不去）
  WidgetsFlutterBinding.ensureInitialized();
  Diag.init();
  // P13：解码图片缓存上限 32MB（默认 100MB 在移动 Web 上偏高，
  // 与附件字节双份持有时易触内存上限导致页面被系统重载）
  PaintingBinding.instance.imageCache.maximumSizeBytes = 32 << 20;
  // 全局异常捕获（对应 Web error-boundary 的 error/unhandledrejection 双通道）
  FlutterError.onError = (details) {
    Diag.error('APP', '${details.exceptionAsString()}\n${details.stack}');
    FlutterError.presentError(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    Diag.error('APP', '$error\n$stack');
    return true;
  };
  // 构建异常兜底页（对应 Web 的品牌化崩溃页）
  ErrorWidget.builder = (details) => const _CrashFallback();
  runZonedGuarded(
    () => runApp(const ProviderScope(child: MynoteApp())),
    (error, stack) => Diag.error('APP', '$error\n$stack'),
  );
}

/// 崩溃兜底（Web error-boundary 文案逐字对齐）。
class _CrashFallback extends StatelessWidget {
  const _CrashFallback();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: MynoteTokens.primaryBg,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '页面遇到问题',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: MynoteTokens.textMain,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                '笔记数据仍保存在本机。可以刷新页面重新打开。',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  height: 1.6,
                  color: MynoteTokens.textSecondary,
                ),
              ),
              const SizedBox(height: 22),
              FilledButton(
                onPressed: reloadPage,
                style: FilledButton.styleFrom(
                  backgroundColor: MynoteTokens.accent,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(999),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 28,
                    vertical: 12,
                  ),
                ),
                child: const Text('刷新页面'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 正式工程骨架（Phase 1）：主题与字体先行，功能页随阶段接入。
/// 深色模式跟随系统（原版 prefers-color-scheme）：平台亮度变化时
/// 切换 MynoteTokens 令牌值并整树重建。
class MynoteApp extends ConsumerStatefulWidget {
  const MynoteApp({super.key});

  @override
  ConsumerState<MynoteApp> createState() => _MynoteAppState();
}

class _MynoteAppState extends ConsumerState<MynoteApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    MynoteTokens.applyDark(
      WidgetsBinding.instance.platformDispatcher.platformBrightness ==
          Brightness.dark,
    );
    // 宿主底色与应用底色同源（原版 body 底色模型）：首帧后同步一次
    WidgetsBinding.instance.addPostFrameCallback((_) {
      syncChromeColor(MynoteTokens.primaryBg);
    });
    startUpdateChecker();
    startSafeAreaBridge();
    // 滚动模型标记（全平台内部滚动；Web 实现在 Diag 打一行标记）
    initBodyScroll();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangePlatformBrightness() {
    MynoteTokens.applyDark(
      WidgetsBinding.instance.platformDispatcher.platformBrightness ==
          Brightness.dark,
    );
    syncChromeColor(MynoteTokens.primaryBg);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final scale = fontScaleOf(ref.watch(fontSizeProvider));
    final pageTransitions = PageTransitionsTheme(
      builders: {
        TargetPlatform.android: CupertinoPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.windows: CupertinoPageTransitionsBuilder(),
        TargetPlatform.linux: CupertinoPageTransitionsBuilder(),
      },
    );
    return MaterialApp(
      scrollBehavior: const _MynoteScrollBehavior(),
      builder: (context, child) {
        final media = MediaQuery.of(context);
        return MediaQuery(
          data: media.copyWith(textScaler: TextScaler.linear(scale)),
          child: SafeAreaBridgeScope(child: child ?? const SizedBox.shrink()),
        );
      },
      title: '此刻',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.system,
      theme: ThemeData(
        // P3：主字体改 NotoSansSC（原 Roboto 三件套 ~0.5MB 不再打包/
        // 下载；拉丁字形由 NotoSansSC 自带，与原版系统字体观感更近）
        fontFamily: 'NotoSansSC',
        colorScheme: ColorScheme.fromSeed(
          seedColor: MynoteTokens.accent,
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: MynoteTokens.primaryBg,
        useMaterial3: true,
        // 页面过渡贴近原版的右入滑动（slideInFromRight）
        pageTransitionsTheme: pageTransitions,
      ),
      darkTheme: ThemeData(
        // P3：主字体改 NotoSansSC（原 Roboto 三件套 ~0.5MB 不再打包/
        // 下载；拉丁字形由 NotoSansSC 自带，与原版系统字体观感更近）
        fontFamily: 'NotoSansSC',
        colorScheme: ColorScheme.fromSeed(
          seedColor: MynoteTokens.accent,
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: MynoteTokens.primaryBg,
        useMaterial3: true,
        pageTransitionsTheme: pageTransitions,
      ),
      navigatorObservers: [mynoteRouteObserver],
      home: const MemoListPage(),
    );
  }
}

/// 全局滚动物理：原版为窗口原生滚动（iOS Safari 橡皮筋回弹），
/// Flutter 非 iOS 默认 Clamping 无回弹——统一为 Bouncing。
class _MynoteScrollBehavior extends MaterialScrollBehavior {
  const _MynoteScrollBehavior();

  @override
  ScrollPhysics getScrollPhysics(BuildContext context) =>
      const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics());
}
