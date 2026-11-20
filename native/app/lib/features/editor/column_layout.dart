/// 双栏 layout 归一化（原版 editor.render.js normalizeColumnLayout）：
/// left/right 按文档顺序构成一个连续切分——边界 = 首个 right 块下标
/// （无 right 时为末个 left 块之后）。mode 仅 'flow' 保留，其余归一为
/// 'independent'。layout 非法（缺 left/right 数组）时返回 null。
Map<String, dynamic>? normalizeColumnLayout(List<String> docIds, Object? raw) {
  if (raw is! Map || raw['left'] is! List || raw['right'] is! List) {
    return null;
  }
  final idSet = docIds.toSet();
  final leftSet = <String>{};
  final rightSet = <String>{};
  for (final id in raw['left'] as List) {
    if (id is String && idSet.contains(id)) leftSet.add(id);
  }
  for (final id in raw['right'] as List) {
    if (id is String && idSet.contains(id) && !leftSet.contains(id)) {
      rightSet.add(id);
    }
  }
  var firstRight = -1;
  var lastLeft = -1;
  for (var i = 0; i < docIds.length; i++) {
    if (rightSet.contains(docIds[i]) && firstRight < 0) firstRight = i;
    if (leftSet.contains(docIds[i])) lastLeft = i;
  }
  final boundary = firstRight >= 0 ? firstRight : lastLeft + 1;
  return <String, dynamic>{
    'version': 1,
    'mode': raw['mode'] == 'flow' ? 'flow' : 'independent',
    'left': docIds.sublist(0, boundary),
    'right': docIds.sublist(boundary),
  };
}

/// 保存时捕获 layout（原版 captureColumnLayout 的等价物）：
/// 以当前文档顺序 + 切分边界重建 left/right，mode 由当前开关决定。
Map<String, dynamic> captureColumnLayout(
  List<String> docIds,
  int boundary,
  bool independent,
) {
  final b = boundary.clamp(0, docIds.length);
  return <String, dynamic>{
    'version': 1,
    'mode': independent ? 'independent' : 'flow',
    'left': docIds.sublist(0, b),
    'right': docIds.sublist(b),
  };
}

/// 双栏可用条件（原版 editor-shell.css 媒体查询）：
/// (min-width: 768px) and (min-height: 600px)，或 (min-width: 1100px)。
/// 不满足时：菜单开关行隐藏；已开启的笔记也退化为单栏流式编辑。
bool columnsAllowed(double width, double height) =>
    (width >= 768 && height >= 600) || width >= 1100;

/// 块高估算（原版 editor.render.js editorBlockHeight）：
/// 图片/画廊/图文卡 280；音乐/链接/附件卡 120；其余文本
/// 28 + ceil(字数/44) * 25（空文本至少 1 行）。
int estimateBlockHeight(Map<String, dynamic> block) {
  final type = block['type'];
  if (type == 'image' ||
      type == 'gallery' ||
      type == 'imgTextCard' ||
      type == 'imageTextRow') {
    return 280;
  }
  if (type == 'musicCard' ||
      type == 'link-card' ||
      type == 'embedCard' ||
      type == 'attachment') {
    return 120;
  }
  var len = 0;
  final children = block['children'];
  if (children is List) {
    for (final c in children) {
      if (c is Map && c['text'] is String) len += (c['text'] as String).length;
    }
  }
  var lines = (len / 44).ceil();
  if (lines < 1) lines = 1;
  return 28 + lines * 25;
}

/// 默认切分（原版 setIndependentScroll）：按块高均衡，
/// 取使 |total − 2×左栏高| 最小的切点，左栏至少 1 块。
int balancedBoundary(List<Map<String, dynamic>> blocks) {
  if (blocks.length < 2) return blocks.length;
  final weights = blocks.map(estimateBlockHeight).toList();
  final total = weights.fold<int>(0, (a, b) => a + b);
  var running = 0;
  var splitAt = 1;
  var best = double.infinity;
  for (var i = 1; i < blocks.length; i++) {
    running += weights[i - 1];
    final diff = (total - running * 2).abs().toDouble();
    if (diff < best) {
      best = diff;
      splitAt = i;
    }
  }
  return splitAt;
}
