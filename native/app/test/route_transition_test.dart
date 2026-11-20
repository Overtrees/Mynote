import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/core/content_slide.dart';
import 'package:mynote_app/core/page_header.dart';
import 'package:mynote_app/core/page_route.dart';

/// 整页滑动测试页：与设置/备份页同构（slideContent 包整页：
/// 页眉 + 内容，2026-11-19 用户裁决页眉也要动）。
class _StaticHeaderPage extends StatefulWidget {
  const _StaticHeaderPage();

  @override
  State<_StaticHeaderPage> createState() => _StaticHeaderPageState();
}

class _StaticHeaderPageState extends State<_StaticHeaderPage>
    with RouteAware, TickerProviderStateMixin, ContentSlideMixin {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: slideContent(
          Column(
            children: [
              PageHeader(title: '测试', onBack: popWithSlide),
              Expanded(child: ListView(children: const [Text('content-row')])),
            ],
          ),
        ),
      ),
    );
  }
}

void main() {
  testWidgets('设置页：页眉与内容整体滑动入场（中途偏移在 0~24、终点归零）', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        navigatorObservers: [mynoteRouteObserver],
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  mynoteStaticHeaderRoute(context, const _StaticHeaderPage()),
                ),
                child: const Text('go'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('go'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 140));
    // 内容（ListView）的滑动变换：中途 x 应在 (0, 24)
    final slideTransforms = find
        .ancestor(
          of: find.byType(ListView).first,
          matching: find.byType(Transform),
        )
        .evaluate()
        .map((e) => (e.widget as Transform).transform.getTranslation().x)
        .toList();
    expect(
      slideTransforms.any((x) => x > 0 && x < 24),
      isTrue,
      reason: '内容应在滑动中途: $slideTransforms',
    );
    // 页眉也在滑动变换下（与内容同行，用户裁决：页眉也要动）
    final headerTransforms = find
        .ancestor(of: find.byType(PageHeader), matching: find.byType(Transform))
        .evaluate()
        .map((e) => (e.widget as Transform).transform.getTranslation().x)
        .toList();
    expect(
      headerTransforms.any((x) => x > 0 && x < 24),
      isTrue,
      reason: '页眉应与内容一同滑动: $headerTransforms',
    );
    await tester.pump(const Duration(milliseconds: 300));
    final settled = find
        .ancestor(
          of: find.byType(ListView).first,
          matching: find.byType(Transform),
        )
        .evaluate()
        .map((e) => (e.widget as Transform).transform.getTranslation().x)
        .toList();
    expect(settled.every((x) => x == 0), isTrue, reason: '终点归零: $settled');
  });

  testWidgets('整页路由退场走 slideOutToRight 终点值（opacity 向 .92 而非 .94）', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  mynotePageRoute(
                    context,
                    const Scaffold(body: Center(child: Text('target'))),
                  ),
                ),
                child: const Text('go'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('go'));
    await tester.pumpAndSettle();
    // 返回：退场 280ms，取样于 210ms（v≈0.25）
    final nav = tester.state<NavigatorState>(find.byType(Navigator));
    nav.pop();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 210));
    final opacityWidgets = find
        .ancestor(of: find.text('target'), matching: find.byType(Opacity))
        .evaluate()
        .map((e) => (e.widget as Opacity).opacity)
        .toList();
    expect(opacityWidgets.isNotEmpty, isTrue);
    expect(
      opacityWidgets.every((o) => o < 0.945),
      isTrue,
      reason: '退场 opacity 应走 .92 终点映射（约 .93），而非入场反播的 .965: $opacityWidgets',
    );
    await tester.pumpAndSettle();
  });
}
