import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeEnv, loadScript } from './helpers/env.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
function withPreview() {
  const env = makeEnv();
  loadScript(env, path.join(ROOT, 'src/utils/dom.js'));
  loadScript(env, path.join(ROOT, 'src/utils/preview.js'));
  return env.win;
}

// 重构前的原始实现（SwipeRow / ImageCard 旧代码），作为等价性基准
function legacySummary(doc, maxLen) {
  const w = {};
  let preview = '\u65E0\u66F4\u591A\u6587\u672C', attachCount = 0, tags = [];
  if (doc) {
    const paras = [];
    for (let ni = 0; ni < doc.length; ni++) {
      const n = doc[ni];
      if (n.type === 'paragraph' && n.children && n.children[0]) {
        const t = (n.children[0].text || '').trim();
        if (t) {
          paras.push(t);
          const mt = t.match(/#[\u4e00-\u9fa5\w-]+/g);
          if (mt) for (let ti = 0; ti < mt.length; ti++) if (tags.indexOf(mt[ti]) === -1) tags.push(mt[ti]);
        }
      }
      if (n.type === 'attachment') attachCount++;
    }
    if (paras.length > 0) {
      tags = tags.slice(0, 3);
      const stripped = (typeof w.stripMarkdownForPreview === 'function' ? w.stripMarkdownForPreview(paras.join(' ')) : paras.join(' ')).replace(/#[\u4e00-\u9fa5\w-]+/g, '').trim().slice(0, maxLen);
      preview = stripped || (tags.length > 0 ? tags[0].replace(/^#/, '') : '\u65E0\u66F4\u591A\u6587\u672C');
    }
  }
  return { preview, tags, attachCount };
}

const P = (t) => ({ id: 'p' + t, type: 'paragraph', children: [{ text: t }] });

const fixtures = [
  [], null, [P('')],
  [P('今天在地铁上想到一个点子')],
  [P('第一段'), P('第二段'), { id: 'a1', type: 'attachment', fileId: 'f1' }],
  [P('#标签 内容 #另一个'), P('尾巴')],
  [P('只有标签 #唯一')],
  [P('很长的一段文字'.repeat(30))],
  [P('**加粗** 和 `代码` 混排'), { id: 'h', type: 'heading', attrs: { level: 2 }, children: [{ text: '标题' }] }, P('尾段')]
];

for (const maxLen of [80, 60]) {
  test(`CikePreview.summarizeMemoDoc 与重构前实现逐字一致（maxLen=${maxLen}）`, () => {
    const w = withPreview();
    for (const doc of fixtures) {
      // vm 沙箱内对象的原型与测试进程不同，先序列化再比较
      const got = JSON.parse(JSON.stringify(w.CikePreview.summarizeMemoDoc(doc, maxLen)));
      assert.deepEqual(got, legacySummary(doc, maxLen), '不一致的 doc: ' + JSON.stringify(doc));
    }
  });
}

test('maxLen 缺省为 80，非法值回退 80', () => {
  const w = withPreview();
  const doc = [P('x'.repeat(100))];
  assert.equal(w.CikePreview.summarizeMemoDoc(doc).preview.length, 80);
  assert.equal(w.CikePreview.summarizeMemoDoc(doc, 0).preview.length, 80);
  assert.equal(w.CikePreview.summarizeMemoDoc(doc, 60).preview.length, 60);
});

test('tags 去重且最多 3 个，无正文时用标签兜底', () => {
  const w = withPreview();
  const r = w.CikePreview.summarizeMemoDoc([P('#a #b #a #c #d')], 80);
  assert.deepEqual(JSON.parse(JSON.stringify(r.tags)), ['#a', '#b', '#c']);
  assert.equal(r.preview, 'a');
});
