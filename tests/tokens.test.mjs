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

test('Markdown 共享排版、明暗语义色与焦点状态均有定义', () => {
  for (const token of ['--md-font-body', '--md-line-height', '--md-heading-h1', '--md-heading-h2', '--md-heading-h3', '--md-heading-h4', '--md-link-color', '--md-focus-ring', '--md-quote-bg', '--md-checkbox-border', '--md-checkbox-checked', '--md-callout-note-bg', '--md-callout-warning-bg', '--md-callout-tip-bg', '--md-callout-important-bg', '--md-callout-caution-bg', '--md-text-muted', '--md-callout-note-icon', '--md-callout-warning-icon', '--md-callout-tip-icon', '--md-callout-important-icon', '--md-callout-caution-icon']) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:'));
  }
  assert.match(css, /@media \(prefers-color-scheme: dark\)[\s\S]*--md-link-color:\s*#72b7ff/);
  assert.match(css, /\.markdown-render h1, \.editor-body h1/);
  assert.match(css, /\.markdown-render blockquote, \.editor-body blockquote/);
  assert.match(css, /\.markdown-render a:focus-visible/);
  assert.match(css, /\.markdown-render \.task-list-item input\[type=\"checkbox\"\]:focus-visible/);
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

test('玻璃表面按 overlay/content/control 分层，并保留无模糊实色回退', () => {
  for (const layer of ['overlay', 'content', 'control']) {
    for (const part of ['bg', 'border', 'filter']) {
      assert.match(css, new RegExp(`--glass-${layer}-${part}\\s*:`));
    }
  }
  assert.match(css, /@supports \(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)[\s\S]*rgba\(255, 255, 255, 0\.84\)/);
  assert.match(css, /@supports not \(backdrop-filter: blur\(1px\)\) and not \(-webkit-backdrop-filter: blur\(1px\)\)[\s\S]*--glass-content-bg:\s*rgba\(255, 255, 255, 0\.94\)/);
  assert.match(css, /prefers-reduced-transparency:\s*reduce[\s\S]*--glass-overlay-filter:\s*none/);
  const env = makeEnv();
  loadScript(env, path.join(ROOT, 'src/styles/tokens.js'));
  assert.equal(env.win.MynoteTokens.glass.overlay.background, 'var(--glass-overlay-bg)');
  assert.equal(env.win.MynoteTokens.glass.content.background, 'var(--glass-content-bg)');
  assert.equal(env.win.MynoteTokens.glass.control.background, 'var(--glass-control-bg)');
  assert.equal(env.win.MynoteTokens.glass.label, 'var(--glass-label-color)');
  assert.equal(env.win.MynoteTokens.glass.focusRing, 'var(--glass-focus-ring)');
});

test('小标签、搜索、列表卡片和 Markdown 预览具备高对比度/键盘焦点规则', () => {
  assert.match(css, /\.glass-tag\s*\{[\s\S]*color:\s*var\(--glass-label-accent\)[\s\S]*background:\s*var\(--glass-control-bg\)/);
  assert.match(css, /\.glass-search-panel:focus-within\s*\{[\s\S]*outline:\s*3px solid var\(--glass-focus-ring\)/);
  assert.match(css, /\.list-item:focus-visible[\s\S]*\.editor-body \.md-preview:focus-visible/);
  const blocks = read('src/editor/md-blocks.js');
  const editor = read('src/app/editor.js');
  const dom = read('src/app/editor/use-editor-dom.js');
  assert.match(blocks, /tabIndex\s*=\s*0/);
  assert.match(blocks, /aria-label.*按回车或空格编辑/);
  assert.match(editor, /e\.key === 'Enter' \|\| e\.key === ' '/);
  assert.match(dom, /removeAttribute\('contenteditable'\)/);
  assert.match(dom, /classList\.remove\('md-preview-inline'\)/);
});

test('卡片、面板、控件玻璃材质不提亮、不加高光或投影', () => {
  assert.match(read('src/styles/tokens.css'), /@media \(prefers-color-scheme: dark\)[\s\S]*--glass-content-border:\s*rgba\(255, 255, 255, 0\.16\);/);
  assert.match(read('src/styles/base.css'), /--glass-overlay-bg:\s*rgba\(28, 28, 30, 0\.98\)[\s\S]*--glass-content-bg:\s*rgba\(32, 32, 36, 0\.96\)/);
  assert.doesNotMatch(css, /brightness\s*\(/i);
  assert.doesNotMatch(css, /contrast\s*\(/i);
  assert.doesNotMatch(css, /glass-edge|glass-caustic/i);
  assert.doesNotMatch(css, /shimmer/i);
  assert.doesNotMatch(css, /box-shadow\s*:/i);
  assert.doesNotMatch(css, /text-shadow\s*:/i);
  assert.match(css, /--glass-highlight\s*:\s*none;/);
  const shadowTokens = [...css.matchAll(/(--shadow-[\w-]+)\s*:\s*([^;]+);/g)];
  assert.ok(shadowTokens.length >= 8, '应保留旧阴影令牌供兼容使用');
  assert.ok(shadowTokens.every(([, , value]) => value.trim() === 'none'), '所有兼容阴影令牌都应关闭');

  const js = walkJs('src').map(read).join('\n');
  assert.doesNotMatch(js, /\bboxShadow\s*:/);
  assert.doesNotMatch(js, /drop-shadow\s*\(/i);
  assert.doesNotMatch(js, /\btextShadow\s*:/i);
  const preview = read('glass-preview.html');
  assert.doesNotMatch(preview, /box-shadow|text-shadow|brightness\s*\(|contrast\s*\(|glass-edge|glass-caustic/i);
});
