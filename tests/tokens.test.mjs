import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEnv, loadScript } from './helpers/env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const cssFiles = fs.readdirSync(path.join(ROOT, 'src/styles')).filter(f => f.endsWith('.css'));
const css = cssFiles.map(f => `/* ${f} */\n` + read('src/styles/' + f)).join('\n');

function walkJs(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) walkJs(rel, out);
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('全局令牌定义完整且没有悬空引用', () => {
  const defined = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map(m => m[1]));
  const js = walkJs('src').map(read).join('\n');
  const used = new Set([...(`${css}\n${js}`).matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map(m => m[1]));
  const undefinedVars = [...used].filter(name => !defined.has(name));
  assert.deepEqual(undefinedVars, [], '存在未定义变量: ' + undefinedVars.join(', '));
  for (const name of ['--primary-bg', '--glass-filter', '--color-accent', '--font-14', '--radius-32', '--shadow-card']) {
    assert.ok(defined.has(name), '缺少关键令牌: ' + name);
  }
});

test('CSS 与 JS 不再保留裸玻璃滤镜、数字字号与数字圆角', () => {
  assert.doesNotMatch(css, /blur\(40px\) saturate\(2\.5\)/);
  const js = walkJs('src').map(read).join('\n');
  assert.doesNotMatch(js, /blur\(40px\) saturate\(2\.5\)/);
  assert.doesNotMatch(js, /fontSize:\s*\d/);
  assert.doesNotMatch(js, /borderRadius:\s*\d/);
  assert.doesNotMatch(js, /font-size:\s*\d+px/);
});

test('JS 中的颜色字面量只存在于令牌调色板', () => {
  for (const rel of walkJs('src')) {
    if (rel === 'src/styles/tokens.js') continue;
    const code = read(rel);
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${rel} 仍含原始十六进制颜色`);
  }
});

test('MynoteTokens 与 MynoteInlineStyles 暴露统一入口', () => {
  const env = makeEnv();
  loadScript(env, path.join(ROOT, 'src/styles/tokens.js'));
  loadScript(env, path.join(ROOT, 'src/styles/inline.js'));
  const w = env.win;
  assert.ok(w.MynoteTokens);
  assert.ok(w.MynoteInlineStyles);
  assert.equal(w.MynoteTokens.color.accent, 'var(--color-accent)');
  assert.equal(w.MynoteTokens.font[14], 'var(--font-14)');
  assert.equal(w.MynoteTokens.radius[32], 'var(--radius-32)');
  assert.equal(w.MynoteTokens.palette.backgroundColors.length, 8);
  assert.equal(Object.keys(w.MynoteTokens.palette.tagColors).length, 6);
  assert.equal(w.MynoteInlineStyles.fixedOverlay.position, 'fixed');
});

test('首屏字号引导使用全局字号映射', () => {
  const env = makeEnv();
  env.win.localStorage.setItem('sj_fontsize', 'large');
  loadScript(env, path.join(ROOT, 'src/styles/tokens.js'));
  loadScript(env, path.join(ROOT, 'src/app/font-boot.js'));
  assert.equal(env.doc.documentElement.style.fontSize, '19px');
});