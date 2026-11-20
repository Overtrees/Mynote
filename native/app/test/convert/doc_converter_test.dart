import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/data/convert/doc_converter.dart';
import 'package:mynote_app/data/convert/doc_nodes.dart';
import 'package:super_editor/super_editor.dart';

/// 规范化 JSON：递归按 key 排序后编码，比较时不受键序影响。
String canonical(dynamic value) {
  dynamic normalize(dynamic v) {
    if (v is Map) {
      final keys = v.keys.map((k) => k.toString()).toList()..sort();
      return {for (final k in keys) k: normalize(v[k])};
    }
    if (v is List) return v.map(normalize).toList();
    return v;
  }

  return jsonEncode(normalize(value));
}

void expectRoundTrip(List<dynamic> fixture, String label) {
  final doc = DocConverter.fromJson(fixture);
  final out = DocConverter.toJson(doc);
  expect(canonical(out), canonical(fixture), reason: label);
}

void main() {
  group('round-trip 无损', () {
    test('文本类：段落/标题/待办/引用/分割线（含行内语法原文）', () {
      expectRoundTrip([
        {
          'id': 'b1',
          'type': 'paragraph',
          'children': [
            {'text': '今天去了 UCCA 的「非物质再现」展。'},
          ],
        },
        {
          'id': 'b2',
          'type': 'paragraph',
          'children': [
            {'text': '想起那句话：==所谓的边界，只是我们还没习惯的过渡带==，还有 **粗体** 与 `代码`。'},
          ],
        },
        {
          'id': 'b3',
          'type': 'heading',
          'attrs': {'level': 2},
          'children': [
            {'text': '实用信息'},
          ],
        },
        {
          'id': 'b4',
          'type': 'heading',
          'attrs': {'level': 5},
          'children': [
            {'text': '五级标题'},
          ],
        },
        {
          'id': 'b5',
          'type': 'todo',
          'attrs': {'checked': true},
          'children': [
            {'text': '厨房插座至少留 6 个'},
          ],
        },
        {
          'id': 'b6',
          'type': 'todo',
          'attrs': {'checked': false},
          'children': [
            {'text': '地板收边条'},
          ],
        },
        {
          'id': 'b7',
          'type': 'quote',
          'children': [
            {'text': '引用一段话'},
          ],
        },
        {'id': 'b8', 'type': 'divider'},
        {
          'id': 'b9',
          'type': 'paragraph',
          'children': [
            {'text': ''},
          ],
        },
      ], 'text blocks');
    });

    test('媒体类：图片/画廊/图文卡/图文行/附件', () {
      expectRoundTrip([
        {
          'id': 'm1',
          'type': 'image',
          'attrs': {
            'fileId': 'f_100',
            'src': 'https://example.com/a.jpg',
            'alt': '展厅',
          },
        },
        {
          'id': 'm2',
          'type': 'gallery',
          'attrs': {
            'items': [
              'https://example.com/1.jpg',
              {
                'fileId': 'f_101',
                'url': 'https://example.com/2.jpg',
                'alt': '二',
              },
            ],
          },
        },
        {
          'id': 'm3',
          'type': 'imgTextCard',
          'attrs': {'fileId': 'f_102'},
          'children': [
            {'text': '卡片正文'},
          ],
        },
        {
          'id': 'm4',
          'type': 'imageTextRow',
          'attrs': {'fileId': 'f_103'},
          'children': [
            {'text': '混排正文'},
          ],
        },
        {'id': 'm5', 'type': 'attachment', 'fileId': 'f_104', 'image': true},
        {'id': 'm6', 'type': 'attachment', 'fileId': 'f_105'},
      ], 'media blocks');
    });

    test('卡片类：音乐卡/链接卡/嵌入卡（顶层 url/status/meta）', () {
      expectRoundTrip([
        {
          'id': 'c1',
          'type': 'musicCard',
          'url': 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
          'status': 'ready',
          'meta': {
            'title': 'Never Gonna Give You Up',
            'subtitle': 'Rick Astley',
            'source': 'Spotify',
            'cover': 'https://i.scdn.co/image/abc',
            'type': 'music',
          },
        },
        {
          'id': 'c2',
          'type': 'musicCard',
          'url': 'https://music.163.com/song?id=1',
          'status': 'loading',
        },
        {'id': 'c3', 'type': 'musicCard', 'status': 'input'},
        {
          'id': 'c4',
          'type': 'link-card',
          'url': 'https://example.com/post',
          'status': 'done',
          'meta': {
            'title': '一篇文章',
            'siteName': 'Example',
            'favicon': 'https://example.com/f.ico',
          },
        },
        {
          'id': 'c5',
          'type': 'embedCard',
          'url': 'https://www.bilibili.com/video/BV1xx',
          'status': 'error',
        },
      ], 'card blocks');
    });

    test('边角：未知类型/无 id/多子项/未知键透传', () {
      expectRoundTrip([
        {
          'id': 'e1',
          'type': 'video',
          'children': [
            {'text': '历史视频块'},
          ],
        },
        {
          'type': 'paragraph',
          'children': [
            {'text': '没有 id 的块'},
          ],
        },
        {
          'id': 'e3',
          'type': 'paragraph',
          'children': [
            {'text': '前半'},
            {'text': '后半'},
          ],
        },
        {
          'id': 'e4',
          'type': 'paragraph',
          'attrs': {'align': 'center', 'futureKey': 42},
          'children': [
            {'text': '带未知属性'},
          ],
          'customTop': 'keep-me',
        },
        {
          'id': 'e5',
          'type': 'heading',
          'children': [
            {'text': '无 level 的标题'},
          ],
        },
      ], 'edge cases');
    });

    test('嵌套 children（分栏结构）原样保留', () {
      expectRoundTrip([
        {
          'id': 'n1',
          'type': 'paragraph',
          'children': [
            {
              'text': '左栏',
              'children': [
                {
                  'id': 'n1a',
                  'type': 'paragraph',
                  'children': [
                    {'text': '嵌套块'},
                  ],
                },
              ],
            },
          ],
        },
      ], 'nested children');
    });
  });

  group('编辑后导出', () {
    test('改段落文本：新文本落盘，嵌套结构保留', () {
      final fixture = [
        {
          'id': 'n1',
          'type': 'paragraph',
          'children': [
            {
              'text': '左栏',
              'children': [
                {
                  'id': 'n1a',
                  'type': 'paragraph',
                  'children': [
                    {'text': '嵌套块'},
                  ],
                },
              ],
            },
          ],
        },
      ];
      final doc = DocConverter.fromJson(fixture);
      final oldNode = doc.getNodeById('n1')! as ParagraphNode;
      doc.replaceNode(
        oldNode: oldNode,
        newNode: ParagraphNode(
          id: 'n1',
          text: AttributedText('改过的左栏'),
          metadata: oldNode.metadata,
        ),
      );
      final out = DocConverter.toJson(doc);
      final block = out.single;
      expect((block['children'] as List).single['text'], '改过的左栏');
      final nested = (block['children'] as List).single['children'] as List;
      expect((nested.single as Map)['id'], 'n1a');
    });

    test('L3 换图：fileId 字段为准，attrs 镜像同步新 id、不残留旧 id', () {
      final doc = DocConverter.fromJson([
        {
          'id': 'i1',
          'type': 'image',
          'attrs': {'fileId': 'f_old'},
        },
      ]);
      final old = doc.getNodeById('i1')! as MediaNode;
      expect(old.effectiveFileId, 'f_old');
      doc.replaceNode(
        oldNode: old,
        newNode: MediaNode(
          id: 'i1',
          kind: 'image',
          attrs: {'fileId': 'f_new'},
          fileId: 'f_new',
          metadata: old.metadata,
        ),
      );
      final out = DocConverter.toJson(doc);
      expect((out.single['attrs'] as Map)['fileId'], 'f_new');
      expect(canonical(out).contains('f_old'), isFalse);
      final reimported =
          DocConverter.fromJson(out).getNodeById('i1')! as MediaNode;
      expect(reimported.effectiveFileId, 'f_new');
    });

    test('L3 双写残留：顶层块字段与旧 attrs 并存时导出双处同步新 id', () {
      final doc = MutableDocument(
        nodes: [
          MediaNode(
            id: 'a1',
            kind: 'attachment',
            fileId: 'f_new',
            attrs: {'fileId': 'f_old'},
          ),
        ],
      );
      final out = DocConverter.toJson(doc);
      expect(out.single['fileId'], 'f_new');
      expect((out.single['attrs'] as Map)['fileId'], 'f_new');
    });

    test('L3 粘贴式新节点：字段+attrs 双写导出不丢、当场口径可读', () {
      final node = MediaNode(
        id: 'i9',
        kind: 'image',
        fileId: 'f_paste',
        attrs: {'fileId': 'f_paste'},
      );
      expect(node.effectiveFileId, 'f_paste');
      final out = DocConverter.toJson(MutableDocument(nodes: [node]));
      expect((out.single['attrs'] as Map)['fileId'], 'f_paste');
      expect(out.single['fileId'], 'f_paste');
    });

    test('改待办勾选状态', () {
      final doc = DocConverter.fromJson([
        {
          'id': 't1',
          'type': 'todo',
          'attrs': {'checked': false},
          'children': [
            {'text': '待办事项'},
          ],
        },
      ]);
      final task = doc.getNodeById('t1')! as TaskNode;
      doc.replaceNode(
        oldNode: task,
        newNode: TaskNode(
          id: 't1',
          text: task.text,
          isComplete: true,
          metadata: task.metadata,
        ),
      );
      final out = DocConverter.toJson(doc);
      expect(((out.single['attrs'] as Map)['checked']), isTrue);
    });
  });
}
