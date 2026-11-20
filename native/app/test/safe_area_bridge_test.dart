import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/core/safe_area_bridge.dart';

void main() {
  tearDown(() => safeAreaInsets.value = null);

  testWidgets('桥无读数时透传引擎 MediaQuery', (tester) async {
    EdgeInsets? seen;
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(padding: EdgeInsets.only(top: 10)),
        child: SafeAreaBridgeScope(
          child: Builder(
            builder: (context) {
              seen = MediaQuery.of(context).padding;
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );
    expect(seen?.top, 10);
  });

  testWidgets('桥已降级：有读数也不覆盖（探针在应用内浏览器恒读 0）', (tester) async {
    safeAreaInsets.value = const EdgeInsets.only(top: 59, bottom: 34);
    EdgeInsets? seenPadding;
    EdgeInsets? seenViewPadding;
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(
          padding: EdgeInsets.only(top: 10),
          viewPadding: EdgeInsets.only(top: 10),
        ),
        child: SafeAreaBridgeScope(
          child: Builder(
            builder: (context) {
              final data = MediaQuery.of(context);
              seenPadding = data.padding;
              seenViewPadding = data.viewPadding;
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );
    expect(seenPadding?.top, 10);
    expect(seenViewPadding?.top, 10);
  });
}
