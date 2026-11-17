#!/usr/bin/env node
/**
 * Glass/card visual regression matrix: mobile/tablet/desktop × light/dark ×
 * native/reduced-transparency/no-backdrop-filter fallback.
 *
 *   npm run test:browser:visual
 *   UPDATE_VISUAL_BASELINES=1 npm run test:browser:visual
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINES = path.join(ROOT, 'tests/browser/visual-baselines');
const UPDATE = process.env.UPDATE_VISUAL_BASELINES === '1';
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const MIME = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json'
};
const SUPPORTS_FILTER = '@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {';
const FALLBACK_FILTER = '@supports not (backdrop-filter: blur(1px)) and not (-webkit-backdrop-filter: blur(1px)) {';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`);
};

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); }
  catch { res.writeHead(400).end('Bad request'); return; }
  const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, 'utf8', (err, source) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    const fallback = url.searchParams.get('scenario')?.startsWith('fallback-');
    if (fallback && file.endsWith('/src/styles/tokens.css')) {
      if (!source.includes(SUPPORTS_FILTER)) { res.writeHead(500).end('Could not find backdrop-filter enhancement block'); return; }
      source = source.replace(SUPPORTS_FILTER, '@media not all {');
    }
    if (fallback && file.endsWith('/src/styles/base.css')) {
      if (!source.includes(FALLBACK_FILTER)) { res.writeHead(500).end('Could not find no-backdrop-filter fallback block'); return; }
      source = source.replace(FALLBACK_FILTER, '@media all {');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(source);
  });
});

const fixture = (scenario, port) => {
  const baseUrl = `http://127.0.0.1:${port}`;
  const cssUrl = name => `/src/styles/${name}?scenario=${scenario}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${baseUrl}/">
<title>Mynote glass visual regression fixture</title>
<link rel="stylesheet" href="${cssUrl('tokens.css')}">
<link rel="stylesheet" href="${cssUrl('base.css')}">
<link rel="stylesheet" href="${cssUrl('editor.css')}">
<link rel="stylesheet" href="${cssUrl('cards.css')}">
<link rel="stylesheet" href="${cssUrl('editor-shell.css')}">
<style>
  html, body { min-height: 100%; }
  body {
    background-image:
      radial-gradient(ellipse at 14% 18%, rgba(120, 120, 124, 0.10), transparent 38%),
      radial-gradient(ellipse at 86% 78%, rgba(96, 96, 100, 0.08), transparent 42%);
    background-attachment: fixed;
  }
  .visual-canvas { box-sizing: border-box; width: 100%; max-width: 1180px; margin: 0 auto; padding: 26px 20px 36px; }
  .visual-heading { margin: 0 0 18px; }
  .visual-kicker { margin-bottom: 7px; color: var(--text-secondary); font-size: 0.6875rem; letter-spacing: 0.08em; }
  .visual-heading h1 { margin: 0; color: var(--text-main); font-size: 1.5rem; font-weight: 650; line-height: 1.25; }
  .visual-heading p { margin-top: 6px; color: var(--text-secondary); font-size: 0.8125rem; line-height: 1.4; }
  .visual-grid { display: grid; grid-template-columns: minmax(0, 1fr); align-items: stretch; gap: 14px; }
  .visual-grid > .list-item { min-height: 68px; }
  .visual-grid > .img-card { align-self: stretch; }
  .visual-grid > .editor-body { min-height: 0; padding: 0; align-self: stretch; }
  .visual-grid > .editor-body .link-card-block { margin: 0; height: 100%; }
  .visual-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; margin-top: 18px; }
  .visual-controls .action-btn { min-height: 36px; }
  .visual-controls .glass-tag { border: 1px solid var(--glass-control-border); }
  @media (min-width: 680px) { .visual-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 1100px) { .visual-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; scroll-behavior: auto !important; caret-color: transparent !important; }
</style>
</head>
<body>
<main class="visual-canvas">
  <header class="visual-heading">
    <div class="visual-kicker">MYNOTE / SURFACE SYSTEM</div>
    <h1>Cards, quietly separated</h1>
    <p>Neutral edges and calm surface layers across devices and display preferences.</p>
  </header>
  <section class="visual-grid" aria-label="Card surface samples">
    <article class="list-item">
      <div class="item-left"><div class="item-title"><span class="item-title-text">A neutral card edge</span></div><div class="item-meta">Updated a moment ago</div></div>
      <time class="item-time">09:41</time>
    </article>
    <article class="img-card">
      <div class="img-cover-fb" aria-hidden="true">IMAGE</div>
      <div class="img-body"><div class="img-text"><div class="t">Quiet morning light</div><div class="m">A saved image and short note</div></div><button class="expand-btn" type="button">Open</button></div>
    </article>
    <a class="link-card" href="#">
      <div class="link-card-body"><div class="link-card-title">Color and surface hierarchy</div><div class="link-card-subtitle">A clipped subtitle showing the content-card layer.</div><div class="link-card-source"><span class="link-card-source-dot"></span><span>mynote.app</span></div></div>
    </a>
    <div class="editor-body">
      <a class="link-card-block music-card-link" href="#"><div class="lkc-body"><div class="lkc-title">Ambient loop</div><div class="lkc-subtitle">A compact editor link card</div><div class="lkc-source">Audio · saved</div></div></a>
    </div>
    <article class="link-card-skeleton">
      <div class="link-card-skeleton-cover"></div>
      <div class="link-card-skeleton-body"><div class="link-card-skeleton-line" style="width:72%"></div><div class="link-card-skeleton-line" style="width:48%"></div></div>
    </article>
    <article class="link-card-error"><span class="link-card-type-icon">↗</span><div><strong>Link unavailable</strong><div class="link-card-subtitle">Tap to retry or open the source.</div></div></article>
  </section>
  <div class="visual-controls"><button class="action-btn" type="button">Search</button><span class="glass-tag">READER</span><button class="expand-btn" type="button">More</button></div>
</main>
</body>
</html>`;
};

function decodePng(buffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(buffer.subarray(0, 8).equals(sig), 'Screenshot is not a PNG');
  let width = 0, height = 0, bitDepth = 0, colorType = 0, palette = null, transparency = null;
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset); offset += 4;
    const type = buffer.toString('ascii', offset, offset + 4); offset += 4;
    const data = buffer.subarray(offset, offset + length); offset += length + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IEND') break;
  }
  assert.equal(bitDepth, 8, `Unsupported PNG bit depth ${bitDepth}`);
  const bytesPerPixel = ({ 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  assert.ok(bytesPerPixel, `Unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bytesPerPixel;
  const decoded = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const input = y * (stride + 1) + 1;
    const output = y * stride;
    const filter = raw[input - 1];
    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? decoded[output + x - bytesPerPixel] : 0;
      const up = y > 0 ? decoded[output + x - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? decoded[output + x - stride - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      } else assert.equal(filter, 0, `Unsupported PNG filter ${filter}`);
      decoded[output + x] = (raw[input + x] + predictor) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const src = i * bytesPerPixel, dst = i * 4;
    if (colorType === 6) decoded.copy(rgba, dst, src, src + 4);
    else if (colorType === 2) { rgba[dst] = decoded[src]; rgba[dst + 1] = decoded[src + 1]; rgba[dst + 2] = decoded[src + 2]; rgba[dst + 3] = 255; }
    else if (colorType === 4) { rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = decoded[src]; rgba[dst + 3] = decoded[src + 1]; }
    else if (colorType === 3) {
      const index = decoded[src], p = index * 3;
      assert.ok(p + 2 < palette.length, `Invalid palette index ${index}`);
      rgba[dst] = palette[p]; rgba[dst + 1] = palette[p + 1]; rgba[dst + 2] = palette[p + 2];
      rgba[dst + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    }
  }
  return { width, height, rgba };
}

function comparePng(actualBuffer, expectedBuffer) {
  const actual = decodePng(actualBuffer), expected = decodePng(expectedBuffer);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return { ok: false, changed: 1, limit: 0, detail: `尺寸 ${actual.width}×${actual.height} ≠ ${expected.width}×${expected.height}` };
  }
  const pixels = actual.width * actual.height;
  let changed = 0, totalDelta = 0;
  for (let i = 0; i < actual.rgba.length; i += 4) {
    const delta = Math.max(Math.abs(actual.rgba[i] - expected.rgba[i]), Math.abs(actual.rgba[i + 1] - expected.rgba[i + 1]), Math.abs(actual.rgba[i + 2] - expected.rgba[i + 2]), Math.abs(actual.rgba[i + 3] - expected.rgba[i + 3]));
    if (delta > 3) changed++;
    totalDelta += Math.abs(actual.rgba[i] - expected.rgba[i]) + Math.abs(actual.rgba[i + 1] - expected.rgba[i + 1]) + Math.abs(actual.rgba[i + 2] - expected.rgba[i + 2]);
  }
  const limit = Math.max(24, Math.ceil(pixels * 0.002));
  const ratio = changed / pixels;
  return { ok: changed <= limit, changed, limit, detail: `${changed}/${pixels} 像素 (${(ratio * 100).toFixed(3)}%) 超过 3 级通道差；平均 RGB 差 ${(totalDelta / (pixels * 3)).toFixed(3)}` };
}

function fixtureHTML(scenario, port) {
  return fixture(scenario, port);
}

await fs.promises.mkdir(BASELINES, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let browser;
try {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const viewports = [
    { id: 'mobile', width: 390, height: 844 },
    { id: 'tablet', width: 820, height: 1180 },
    { id: 'desktop', width: 1440, height: 1000 }
  ];
  const schemes = ['light', 'dark'];
  const modes = [
    { id: 'native', query: 'native', reduced: 'no-preference' },
    { id: 'reduced-transparency', query: 'reduced', reduced: 'reduce' },
    { id: 'no-backdrop-filter', query: 'fallback', reduced: 'no-preference' }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const scheme of schemes) {
      for (const mode of modes) {
        const scenario = `${mode.query}-${viewport.id}-${scheme}`;
        const label = `${viewport.id} ${scheme} ${mode.id}`;
        await cdp.send('Emulation.setEmulatedMedia', {
          media: 'screen',
          features: [
            { name: 'prefers-color-scheme', value: scheme },
            { name: 'prefers-reduced-transparency', value: mode.reduced }
          ]
        });
        await page.setContent(fixtureHTML(scenario, port), { waitUntil: 'load' });
        await page.locator('.visual-grid .list-item').waitFor();
        await page.evaluate(() => document.fonts.ready);

        const state = await page.evaluate(() => {
          const parseColor = value => {
            const values = value.match(/[\d.]+/g)?.map(Number) || [];
            return [values[0], values[1], values[2], values.length > 3 ? values[3] : 1];
          };
          const luma = rgb => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          const composite = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
          const root = getComputedStyle(document.documentElement);
          const card = document.querySelector('.link-card');
          const cardStyle = getComputedStyle(card);
          const body = getComputedStyle(document.body);
          const bg = parseColor(body.backgroundColor).slice(0, 3);
          const layer = key => {
            const raw = parseColor(root.getPropertyValue(`--glass-${key}-bg`).trim());
            return luma(composite(raw, bg));
          };
          return {
            supportsFilter: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
            reduced: matchMedia('(prefers-reduced-transparency: reduce)').matches,
            edgeToken: root.getPropertyValue('--glass-content-border').trim(),
            edgeColor: cardStyle.borderTopColor,
            edgeWidth: cardStyle.borderTopWidth,
            backgroundToken: root.getPropertyValue('--glass-content-bg').trim(),
            backgroundColor: cardStyle.backgroundColor,
            filter: cardStyle.backdropFilter || cardStyle.webkitBackdropFilter,
            shadows: [...document.querySelectorAll('.list-item, .img-card, .link-card, .link-card-block, .link-card-error, .link-card-skeleton')].map(el => getComputedStyle(el).boxShadow),
            layers: { overlay: layer('overlay'), content: layer('content'), control: layer('control') },
            pageWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            gridColumns: getComputedStyle(document.querySelector('.visual-grid')).gridTemplateColumns
          };
        });

        check(`${label}: 实际应用主题/偏好已生效`, state.reduced === (mode.reduced === 'reduce') && (scheme === 'dark' ? state.layers.overlay < state.layers.content : state.layers.content < state.layers.overlay) && state.layers.content < state.layers.control, JSON.stringify({ reduced: state.reduced, layers: state.layers }));
        const expectedEdge = scheme === 'dark' ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.16)';
        const expectedColumns = viewport.width >= 1100 ? 3 : viewport.width >= 680 ? 2 : 1;
        const columnCount = state.gridColumns.trim().split(/\s+/).length;
        const edgeWidth = parseFloat(state.edgeWidth);
        check(`${label}: 中性 16% 细描边、设备宽度和响应式列数正常`, state.edgeToken === expectedEdge && state.edgeColor === expectedEdge && edgeWidth > 0 && edgeWidth <= 1 && state.pageWidth <= state.clientWidth + 1 && columnCount === expectedColumns, JSON.stringify({ token: state.edgeToken, border: state.edgeColor, width: state.edgeWidth, columns: columnCount, page: [state.pageWidth, state.clientWidth] }));
        const expectedSurface = scheme === 'dark'
          ? { native: 'rgba(32, 32, 36, 0.86)', 'reduced-transparency': 'rgba(32, 32, 36, 0.97)', 'no-backdrop-filter': 'rgba(32, 32, 36, 0.96)' }
          : { native: 'rgba(255, 255, 255, 0.74)', 'reduced-transparency': 'rgba(255, 255, 255, 0.96)', 'no-backdrop-filter': 'rgba(255, 255, 255, 0.94)' };
        check(`${label}: 透明度/无滤镜回退使用对应表面层级`, state.supportsFilter && (mode.id === 'native' ? state.filter.includes('blur(') : state.filter === 'none') && state.backgroundToken === expectedSurface[mode.id], JSON.stringify({ background: state.backgroundToken, computed: state.backgroundColor, filter: state.filter, supportsFilter: state.supportsFilter }));
        check(`${label}: 卡片不使用外投影`, state.shadows.length >= 5 && state.shadows.every(shadow => shadow === 'none'), JSON.stringify(state.shadows));

        const screenshot = await page.screenshot({ fullPage: true, animations: 'disabled' });
        const baseline = path.join(BASELINES, `${viewport.id}-${scheme}-${mode.id}.png`);
        if (UPDATE) {
          await fs.promises.writeFile(baseline, screenshot);
          check(`${label}: 更新视觉基线`, true, path.relative(ROOT, baseline));
        } else if (!fs.existsSync(baseline)) {
          check(`${label}: 存在视觉基线`, false, `缺少 ${path.relative(ROOT, baseline)}；运行 UPDATE_VISUAL_BASELINES=1 npm run test:browser:visual`);
        } else {
          const diff = comparePng(screenshot, await fs.promises.readFile(baseline));
          check(`${label}: 截图与视觉基线匹配`, diff.ok, diff.detail);
          if (!diff.ok) {
            const failurePath = path.join(BASELINES, `${viewport.id}-${scheme}-${mode.id}.actual.png`);
            await fs.promises.writeFile(failurePath, screenshot);
            console.log(`  当前截图已保存：${path.relative(ROOT, failurePath)}`);
          }
        }
      }
    }
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} 检查通过${UPDATE ? '（基线已更新）' : ''}`);
process.exitCode = failed.length ? 1 : 0;
