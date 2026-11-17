#!/usr/bin/env node
/**
 * 静态校验：在没有打包器的前提下，替代「构建」这一步的最低限度检查。
 *   1. Moment.html / index.html 的本地脚本与样式引用必须存在
 *   2. 所有 src/ 脚本与页面内联脚本必须能通过语法解析
 *   3. 页面不得残留内联 style/script（启动页字号引导已外移）
 *   4. 本地 src/ 资源必须携带统一版本串
 *   5. 跨模块顶层声明不得重复；preview.js 必须在列表组件之前引入
 *   6. CSS 自定义属性必须全部有定义
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, ext, out);
    else if (e.name.endsWith(ext)) out.push(rel);
  }
  return out;
}

const pages = ['Moment.html', 'index.html'];
const allLocalRefs = [];
for (const page of pages) {
  const html = read(page);
  const scriptRefs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  const styleRefs = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1]);
  const localRefs = [...scriptRefs, ...styleRefs];
  allLocalRefs.push(...localRefs.map(r => r.split('?')[0].replace(/^\.\//, '')));

  for (const ref of localRefs) {
    if (/^https?:/.test(ref)) { notes.push(`${page}: 外部资源 ${ref}`); continue; }
    const clean = ref.split('?')[0].replace(/^\.\//, '');
    if (!fs.existsSync(path.join(root, clean))) problems.push(`${page}: 缺少本地资源 ${clean}`);
    if (ref.startsWith('./src/') && !/\?v=/.test(ref)) problems.push(`${page}: src 资源缺少版本串 ${ref}`);
  }

  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  inline.forEach((code, i) => {
    try { new vm.Script(code, { filename: `${page}#inline${i}` }); }
    catch (e) { problems.push(`${page} 内联脚本 #${i} 语法错误: ${e.message}`); }
    if (code.trim()) problems.push(`${page} 仍存在内联脚本，应外移到 src/`);
  });
  if (/<style[\s>]/i.test(html)) problems.push(`${page} 仍存在内联 style，应外移到 src/styles/`);

  const qv = [...html.matchAll(/\?v=([A-Za-z0-9._-]+)/g)].map(x => x[1]);
  const pkgVersion = JSON.parse(read('package.json')).version;
  const qvBad = [...new Set(qv)].filter(v => v !== pkgVersion);
  if (qvBad.length) problems.push(`${page} 缓存串版本不一致: ${qvBad.join(', ')}（应为 ${pkgVersion}）`);
}

// 仓库没有生产构建步骤，GitHub Pages 等静态发布会暴露根目录文件。
// 因此危险的开发用 Drive 清理入口必须是纯静态说明页，且不得被应用入口链接。
const cleanupEntry = read('clear_drive.html');
const cleanupDev = read('dev/clear_drive.html');
const appEntry = pages.map(read).join('\n');
if (/clear_drive|dev\/clear_drive/i.test(appEntry)) problems.push('应用入口不得引用 Drive 清理页');
for (const [file, html] of [['clear_drive.html', cleanupEntry], ['dev/clear_drive.html', cleanupDev]]) {
  if (/<script\b|googleapis\.com\/drive|drive\.appdata|appDataFolder|oauth2|\.delete\s*\(/i.test(html)) {
    problems.push(`${file}: 开发清理页必须保持无可执行 Drive 清理代码`);
  }
}

const srcFiles = walk('src', '.js');
for (const f of srcFiles) {
  try { new vm.Script(read(f), { filename: f }); }
  catch (e) { problems.push(`${f} 语法错误: ${e.message}`); }
}

// 跨经典脚本共享全局词法环境：同名顶层声明会直接冲突。
const declarations = new Map();
for (const f of srcFiles.filter(f => f.startsWith('src/app/'))) {
  const code = read(f);
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm;
  for (const m of code.matchAll(re)) {
    const name = m[1] || m[2];
    if (!declarations.has(name)) declarations.set(name, []);
    declarations.get(name).push(f);
  }
}
const dup = [...declarations.entries()].filter(([, files]) => new Set(files).size > 1);
if (dup.length) problems.push(`跨模块重复顶层声明: ${dup.map(([n, f]) => `${n}(${f.join(' / ')})`).join(', ')}`);

// 所有新增模块和样式都必须被页面真实引用
for (const f of srcFiles.filter(f => f.startsWith('src/app/'))) {
  if (!allLocalRefs.includes(f)) problems.push(`模块未被页面引用: ${f}`);
}
for (const f of walk('src/styles', '.css')) {
  if (!allLocalRefs.includes(f)) problems.push(`样式未被页面引用: ${f}`);
}

const cssFiles = walk('src/styles', '.css');
const css = cssFiles.map(read).join('\n');
const js = srcFiles.map(read).join('\n');
const definedVars = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map(m => m[1]));
const usedVars = new Set([...(`${css}\n${js}`).matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map(m => m[1]));
const undefinedVars = [...usedVars].filter(v => !definedVars.has(v));
if (undefinedVars.length) problems.push(`未定义的 CSS 变量: ${undefinedVars.join(', ')}`);

const moments = read('Moment.html');
const order = [...moments.matchAll(/<script[^>]*\ssrc="\.\/src\/([^"?]+)/g)].map(m => m[1]);
const iPreview = order.indexOf('utils/preview.js');
const iSwipe = order.indexOf('components/SwipeRow.js');
const iImg = order.indexOf('components/ImageCard.js');
if (iPreview === -1) problems.push('Moment.html 未引入 src/utils/preview.js');
else if (iPreview > iSwipe || iPreview > iImg) problems.push('preview.js 必须在 SwipeRow/ImageCard 之前引入');

// ---- 版本号单一来源 ----
const pkg = JSON.parse(read('package.json'));
const constSrc = read('src/constants.js');
const vMatch = constSrc.match(/APP_VERSION:\s*'([^']+)'/);
if (!vMatch) problems.push('src/constants.js 缺少 APP_VERSION');
else if (vMatch[1] !== pkg.version) problems.push(`版本不一致: package.json ${pkg.version} vs constants.js ${vMatch[1]}`);

console.log(`检查脚本: ${srcFiles.length} 个 src 模块，${cssFiles.length} 个样式文件，${pages.length} 个页面`);
for (const n of notes) console.log('  note: ' + n);
if (problems.length === 0) {
  console.log('✅ 静态校验通过');
} else {
  console.error('❌ 静态校验发现问题:');
  for (const p of problems) console.error('  - ' + p);
  process.exitCode = 1;
}