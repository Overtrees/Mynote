#!/usr/bin/env node
/**
 * 静态校验：在没有打包器的前提下，替代「构建」这一步的最低限度检查。
 *   1. Moments.html / index.html 里 <script src="..."> 指向的本地文件必须存在
 *   2. 所有 src/**\/*.js 与 HTML 内联脚本必须能通过语法解析
 *   3. Moments.html 内联脚本中不得存在重复的顶层函数声明
 *   4. 共享工具 preview.js 必须在 components 之前被引入
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const problems = [];
const notes = [];

function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out); else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

const pages = ['Moments.html', 'index.html'];
for (const page of pages) {
  const html = read(page);
  const refs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  for (const ref of refs) {
    if (/^https?:/.test(ref)) { notes.push(`${page}: 外部脚本 ${ref}`); continue; }
    const clean = ref.split('?')[0].replace(/^\.\//, '');
    if (!fs.existsSync(path.join(root, clean))) problems.push(`${page}: 缺少脚本文件 ${clean}`);
  }
  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  inline.forEach((code, i) => {
    try { new vm.Script(code, { filename: `${page}#inline${i}` }); }
    catch (e) { problems.push(`${page} 内联脚本 #${i} 语法错误: ${e.message}`); }
  });
}

const srcFiles = walk('src');
for (const f of srcFiles) {
  try { new vm.Script(read(f), { filename: f }); }
  catch (e) { problems.push(`${f} 语法错误: ${e.message}`); }
}

const moments = read('Moments.html');
const inlineAll = [...moments.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const decls = [...inlineAll.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
const dup = [...new Set(decls.filter((n, i) => decls.indexOf(n) !== i))];
if (dup.length) problems.push(`Moments.html 内联脚本存在重复顶层函数声明: ${dup.join(', ')}`);

const order = [...moments.matchAll(/<script[^>]*\ssrc="\.\/src\/([^"?]+)/g)].map(m => m[1]);
const iPreview = order.indexOf('utils/preview.js');
const iSwipe = order.indexOf('components/SwipeRow.js');
const iImg = order.indexOf('components/ImageCard.js');
if (iPreview === -1) problems.push('Moments.html 未引入 src/utils/preview.js');
else if (iPreview > iSwipe || iPreview > iImg) problems.push('preview.js 必须在 SwipeRow/ImageCard 之前引入');

// ---- 5. 版本号单一来源 ----
const pkg = JSON.parse(read('package.json'));
const constSrc = read('src/constants.js');
const vMatch = constSrc.match(/APP_VERSION:\s*'([^']+)'/);
if (!vMatch) problems.push('src/constants.js 缺少 APP_VERSION');
else if (vMatch[1] !== pkg.version) problems.push(`版本不一致: package.json ${pkg.version} vs constants.js ${vMatch[1]}`);
const qv = [...moments.matchAll(/\?v=([A-Za-z0-9._-]+)/g)].map(x => x[1]);
const qvBad = [...new Set(qv)].filter(v => v !== pkg.version);
if (qvBad.length) problems.push(`脚本缓存串版本不一致: ${qvBad.join(', ')}（应为 ${pkg.version}）`);

console.log(`检查脚本: ${srcFiles.length} 个 src 模块，${pages.length} 个页面`);
for (const n of notes) console.log('  note: ' + n);
if (problems.length === 0) {
  console.log('✅ 静态校验通过');
} else {
  console.error('❌ 静态校验发现问题:');
  for (const p of problems) console.error('  - ' + p);
  process.exitCode = 1;
}
