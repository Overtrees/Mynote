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
  assert.equal('tagColors' in w.MynoteTokens.palette, false);
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


test('首页横屏与平板保留时间分组并使用叠卡网格，宽桌面支持四列方卡', () => {
  const home = read('src/styles/base.css');
  assert.match(home, /@media \(min-width: 768px\), \(orientation: landscape\) and \(max-height: 560px\)/);
  assert.match(home, /\.container\s*\{\s*display:\s*grid;/);
  assert.match(home, /\.container \.list-group\s*\{\s*display:\s*contents;/);
  assert.match(home, /\.container > div:not\(\.empty-tip\)\s*\{\s*display:\s*contents;/);
  assert.match(home, /\.container \.section-header\s*\{[\s\S]*?display:\s*block;[\s\S]*?grid-column:\s*1\s*\/\s*-1;/);
  assert.match(home, /\.container \.gap-16\s*\{\s*display:\s*none;/);
  assert.match(home, /\.container \.card-expand-wrapper\s*\{[\s\S]*?display:\s*block;[\s\S]*?aspect-ratio:\s*1\s*\/\s*1;/);
  assert.match(home, /\.container \.card-expand-wrapper::before,[\s\S]*?\.container \.card-expand-wrapper::after/);
  assert.match(home, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(home, /@media \(min-width: 1280px\)\s*\{\s*\.container\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(home, /aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(home, /border-radius:\s*var\(--radius-26\)/);
  assert.match(home, /\.container \.item-title-text[\s\S]*?-webkit-line-clamp:\s*3;/);
  assert.match(home, /\.container \.item-tag-more\s*\{[\s\S]*?display:\s*inline-flex;/);
  assert.match(read('src/styles/tokens.css'), /--radius-26:\s*26px/);
  assert.match(home, /\.container \.img-card \{ display: flex; flex-direction: column; \}/);
});

test('首页转场尊重减少动态效果偏好，关闭等待与 280ms 动画一致', () => {
  const home = read('src/styles/base.css');
  assert.match(home, /--motion-page-transition:\s*280ms/);
  assert.match(home, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(home, /animation-duration:\s*0\.01ms !important/);
  for (const file of ['src/components/SettingsView.js', 'src/components/BackupView.js']) {
    const component = read(file);
    assert.match(component, /getPageTransitionMs/);
    assert.match(component, /var\(--motion-page-transition\)/);
    assert.doesNotMatch(component, /setTimeout\([^)]*320/);
  }
});

test('恐龙 SVG 保留浅色灰蓝，并在深色主题切换为浅灰白', () => {
  const dino = read('dino.svg');
  assert.match(dino, /stroke="#8A9BB0"/);
  assert.match(dino, /@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*svg\s*\{\s*stroke:\s*#E5E7EB;/);
  const tokens = read('src/styles/tokens.css');
  assert.match(tokens, /--color-icon-muted:\s*#8A9BB0;/);
  assert.match(tokens, /@media \(prefers-color-scheme: dark\)[\s\S]*--color-icon-muted:\s*#E5E7EB;/);
  assert.match(read('index.html'), /stroke="var\(--color-icon-muted\)"/);
  assert.match(read('src/app/memo-list.js'), /stroke:\s*"var\(--color-icon-muted\)"/);
  assert.match(read('src/app/editor.js'), /stroke:\s*"var\(--color-icon-muted\)"/);
});


test('HTML/PDF 导出消费编辑器快照，而 Markdown 导出使用语义内容', () => {
  const editor = read('src/app/editor.js');
  const exporter = read('src/app/editor/export.js');
  assert.match(editor, /captureEditorSnapshot\(editorBodyRef\.current\)/);
  assert.match(editor, /format === 'pdf'[\s\S]*?toHTMLDocument\(doc, noteTitle, filesRef\.current \|\| \{\}, editorSnapshot, exportOptions\)/);
  assert.match(editor, /format === 'html'[\s\S]*?toHTMLDocument\(doc, noteTitle, filesRef\.current \|\| \{\}, editorSnapshot, exportOptions\)/);
  assert.match(editor, /toMarkdown\(doc, noteTitle, filesRef\.current \|\| \{\}, editorSnapshot\)/);
  assert.match(exporter, /function toMarkdown\(doc, title, files, snapshot\)\s*\{\s*return toSemanticMarkdown\(doc, title, files\);\s*\}/);
});

test('编辑器大屏采用跨页双栏，窄屏手机横屏维持单栏，媒体卡片不拆分', () => {
  const shell = read('src/styles/editor-shell.css');
  assert.match(shell, /@media \(min-width: 768px\) and \(min-height: 600px\), \(min-width: 1100px\)/);
  assert.match(shell, /\.editor-spread > \.editor-body\s*\{[\s\S]*?column-count:\s*2;[\s\S]*?column-gap:[\s\S]*?column-rule:/);
  assert.match(shell, /\.editor-spread > \.editor-body > \.atomic,[\s\S]*?break-inside:\s*avoid;/);
  assert.match(shell, /\.editor-spread > \.editor-body > \[data-type="musicCard"\][\s\S]*?column-span:\s*all;/);
  assert.match(shell, /@media \(orientation: landscape\) and \(max-height: 560px\) and \(max-width: 1099px\)[\s\S]*?column-count:\s*1;/);
  assert.match(shell, /\.editor-column-mode-toggle\s*\{[^}]*display:\s*none\s*!important;/);
  assert.match(shell, /@media \(min-width: 768px\) and \(min-height: 600px\), \(min-width: 1100px\)\s*\{[\s\S]*?\.editor-column-mode-toggle\s*\{\s*display:\s*flex\s*!important;/);
});


test('双栏编辑模块的窄栏排版与控件适配有回归覆盖', () => {
  const shell = read('src/styles/editor-shell.css');
  const editorCss = read('src/styles/editor.css');
  const editor = read('src/app/editor.js');
  const slash = read('src/app/editor/slash-panel.js');
  assert.match(shell, /column-gap:\s*clamp\(28px,\s*3\.2vw,\s*52px\)/);
  assert.match(shell, /\.editor-spread > \.editor-body > \*\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
  assert.match(shell, /\.editor-spread > \.editor-body \[data-type="todo"\] \.todo-text[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(shell, /\.editor-spread > \.editor-body > \.atomic\.attachment:has\(> img\)[\s\S]*?column-span:\s*all/);
  assert.match(shell, /\.editor-spread > \.editor-body \.lkc-source-text[\s\S]*?min-width:\s*0/);
  assert.match(editorCss, /\.editor-body \.callout\s*\{/);
  assert.match(editorCss, /\.editor-body \[data-type="todo"\] \.todo-checkbox::before\s*\{\s*width:\s*22px;\s*height:\s*22px/);
  assert.match(editor, /className: "editor-menu-panel"/);
  assert.match(editor, /aria-label": "打开更多菜单"/);
  assert.match(editor, /className: "editor-column-mode-toggle"[\s\S]*?role: "switch"[\s\S]*?aria-checked": independentColumns/);
  assert.match(editor, /sj_editor_independent_scroll/);
  assert.match(read('src/editor/editor.render.js'), /function getEditorBlocks[\s\S]*?function setIndependentScroll[\s\S]*?var children = getEditorBlocks\(containerEl\)/);
  assert.match(read('src/app/editor/export.js'), /MynoteEditorColumns\.flatten\(clone,\s*false\)/);
  assert.match(slash, /className: 'slash-panel'/);
  assert.match(slash, /className: 'slash-recent-pill'/);
  assert.match(slash, /className: 'slash-shortcut'/);
});
