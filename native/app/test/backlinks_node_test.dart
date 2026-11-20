import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/convert/doc_converter.dart';
import 'package:mynote_app/data/convert/doc_nodes.dart';
import 'package:super_editor/super_editor.dart';
import 'package:attributed_text/attributed_text.dart';

void main() {
  test('BacklinksNode 不进存储序列化', () {
    final nodes = <DocumentNode>[
      ParagraphNode(id: 'p1', text: AttributedText('正文')),
      BacklinksNode(
        sources: const [BacklinkSource(memoId: 'm2', title: '来源笔记')],
      ),
    ];
    final json = DocConverter.toJson(nodes);
    expect(json.length, 1);
    expect(json.first['type'], 'paragraph');
  });

  test('BacklinksNode 等价比较按来源列表', () {
    final a = BacklinksNode(
      sources: const [BacklinkSource(memoId: 'm2', title: 'T')],
    );
    final b = BacklinksNode(
      sources: const [BacklinkSource(memoId: 'm2', title: 'T')],
    );
    final c = BacklinksNode(
      sources: const [BacklinkSource(memoId: 'm3', title: 'T')],
    );
    expect(a.hasEquivalentContent(b), isTrue);
    expect(a.hasEquivalentContent(c), isFalse);
  });
}
