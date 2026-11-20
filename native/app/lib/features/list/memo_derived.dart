// 列表派生数据缓存：摘要/标签/图片判定/封面/搜索文本按 (id, updatedAt)
// 一次解码、多处复用。此前每次列表构建对每篇笔记多次 jsonDecode
// （摘要、hasImage、封面、搜索各一份），编辑保存触发列表重建时全库重算；
// 搜索更是每键一轮全库解码。缓存后每篇每版本只算一次。
import '../../data/db/database.dart';
import 'memo_preview.dart';
import 'memo_search.dart';

class MemoDerived {
  const MemoDerived({
    required this.previewFull,
    required this.tags,
    required this.attachCount,
    required this.hasImage,
    required this.coverFileId,
    required this.searchTextLower,
  });

  /// 未截断的预览文本（截断在调用点按 80/60/200 口径做）
  final String previewFull;
  final List<String> tags;
  final int attachCount;
  final bool hasImage;
  final String? coverFileId;

  /// 标题 + 文档字段拼接后的小写文本（搜索子串匹配用）
  final String searchTextLower;

  String preview(int maxLen) => previewFull.length > maxLen
      ? previewFull.substring(0, maxLen)
      : previewFull;
}

final Map<String, (int, MemoDerived)> _derivedCache = {};

MemoDerived derivedForMemo(Memo memo) {
  final hit = _derivedCache[memo.id];
  if (hit != null && hit.$1 == memo.updatedAt) return hit.$2;
  final summary = summarizeMemoDoc(memo.docJson, 1 << 30);
  final derived = MemoDerived(
    previewFull: summary.preview,
    tags: summary.tags,
    attachCount: summary.attachCount,
    hasImage: memoHasImage(memo.docJson),
    coverFileId: memoCoverFileId(memo.docJson),
    searchTextLower: memoSearchText(memo.title, memo.docJson).toLowerCase(),
  );
  if (_derivedCache.length > 600) _derivedCache.clear();
  _derivedCache[memo.id] = (memo.updatedAt, derived);
  return derived;
}
