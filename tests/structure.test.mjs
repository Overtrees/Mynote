import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const moments = read('Moments.html');
const index = read('index.html');
const scriptRefs = html => [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
const styleRefs = html => [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1]);
const refPath = ref => ref.split('?')[0].replace(/^\.\//, '');

test('Moments.html 只保留页面骨架与外部引用', () => {
  assert.ok(moments.split('\n').length < 120, 'Moments.html 应保持为薄入口');
  assert.doesNotMatch(moments, /<style[\s>]/i, '不应再有内联 style');
  assert.doesNotMatch(moments, /<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/i, '不应再有内联 script');
  assert.ok(index.split('\n').length < 70, '启动页应保持短小');
  assert.doesNotMatch(index, /<style[\s>]/i, '启动页不应再有内联 style');
  assert.doesNotMatch(index, /<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/i, '启动页不应再有内联 script');
});

test('本地脚本与样式引用全部存在且带统一版本串', () => {
  const all = [...scriptRefs(moments), ...styleRefs(moments), ...scriptRefs(index), ...styleRefs(index)];
  const version = JSON.parse(read('package.json')).version;
  for (const ref of all) {
    if (/^https?:/.test(ref)) continue;
    assert.ok(exists(refPath(ref)), '缺少资源: ' + ref);
    if (ref.startsWith('./src/')) {
      assert.match(ref, new RegExp('\\?v=' + version.replace(/\./g, '\\.') + '$'), '版本串不一致: ' + ref);
    }
  }
});

test('应用模块与样式均被页面真实引用', () => {
  const refs = new Set([
    ...scriptRefs(moments), ...styleRefs(moments),
    ...scriptRefs(index), ...styleRefs(index)
  ].map(refPath));
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + entry.name;
      if (entry.isDirectory()) walk(rel, out);
      else if (entry.name.endsWith('.js')) out.push(rel);
    }
    return out;
  };
  const appFiles = walk('src/app');
  for (const file of appFiles) assert.ok(refs.has(file), '模块未被引用: ' + file);
  for (const file of fs.readdirSync(path.join(ROOT, 'src/styles')).filter(f => f.endsWith('.css'))) {
    assert.ok(refs.has('src/styles/' + file), '样式未被引用: ' + file);
  }
});

test('拆分后的脚本顺序满足依赖', () => {
  const srcOrder = scriptRefs(moments).map(refPath).filter(ref => ref.startsWith('src/'));
  const at = file => srcOrder.indexOf(file);
  assert.ok(at('src/styles/tokens.js') < at('src/styles/inline.js'), 'tokens 必须先于 inline');
  assert.ok(at('src/styles/inline.js') < at('src/components/BgSheet.js'), 'inline 样式必须先于组件');
  assert.ok(at('src/app/runtime.js') < at('src/app/editor.js'), 'runtime 必须先于 editor');
  assert.ok(at('src/app/editor/commands.js') < at('src/app/editor.js'), 'commands 必须先于 editor');
  assert.ok(at('src/app/editor.js') < at('src/app/memo-list.js'), 'editor 必须先于 MemoList');
  assert.ok(at('src/app/memo-list.js') < at('src/app/bootstrap.js'), 'MemoList 必须先于启动');
});