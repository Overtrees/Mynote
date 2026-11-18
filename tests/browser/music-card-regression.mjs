#!/usr/bin/env node
/* Mobile regression: slash music command → paste → immediate Enter → async completion → reopen. */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8080/Moment.html';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const failures = [];
page.on('pageerror', error => { failures.push(error.message); console.log('PAGEERROR', error.stack); });
page.on('console', message => { console.log('CONSOLE', message.type(), message.text()); if (message.type() === 'error' && !/favicon|404|status of 503 \(Service Unavailable\)/.test(message.text())) failures.push(message.text()); });
page.on('request', request => {});
let failureAttempts = 0;
await page.route('**/meta?*', async route => {
  if (route.request().url().includes('mobile-race-fail')) {
    await new Promise(resolve => setTimeout(resolve, 250));
    failureAttempts += 1;
    if (failureAttempts <= 2) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'simulated metadata failure' }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Retry Recovered Song', subtitle: 'Retry Artist', source: 'Mock', type: 'music', cover: 'https://example.test/retry-cover.png' }) });
    }
    return;
  }
  await new Promise(resolve => setTimeout(resolve, 900));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Regression Song', subtitle: 'Regression Artist', source: 'Mock', type: 'music', cover: 'https://example.test/music-cover.png' }) });
});
await page.route('**/img*', async route => route.fulfill({
  status: 200,
  contentType: 'image/png',
  body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
}));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const measureMusicCover = async () => page.evaluate(() => {
  const card = document.querySelector('.editor-body a.music-card-link[href*="mobile-race-regression"]');
  const cover = card && card.querySelector('.lkc-cover');
  const image = cover && cover.querySelector('img');
  if (!cover || !image) return null;
  const rect = cover.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  const imageStyle = getComputedStyle(image);
  return {
    width: rect.width,
    height: rect.height,
    ratio: rect.width / rect.height,
    fill: rect.width / card.clientWidth,
    imageWidth: imageRect.width,
    imageHeight: imageRect.height,
    imageMargin: imageStyle.margin,
    imageBorderRadius: imageStyle.borderRadius,
    objectFit: imageStyle.objectFit
  };
});

const measureRenderedCoverLayouts = async width => {
  await page.setViewportSize({ width, height: 844 });
  return page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'editor-body';
    host.style.cssText = 'position:fixed;left:16px;top:0;width:calc(100vw - 32px);visibility:hidden;pointer-events:none;z-index:-1;';
    const originalProxyImg = window.proxyImg;
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    try {
      window.proxyImg = url => url;
      host.innerHTML = window.MynoteEditor.renderDocToEditorHTML([
        { id: 'cover-layout-music', type: 'musicCard', url: 'https://open.spotify.com/track/layout-check', status: 'ready', meta: { title: 'Square artwork', source: 'Mock', cover: png } },
        { id: 'cover-layout-link', type: 'link-card', url: 'https://example.test/article', meta: { title: 'Panoramic link', source: 'Example', cover: png } },
        { id: 'cover-layout-loading', type: 'musicCard', url: 'https://open.spotify.com/track/layout-loading', status: 'loading' }
      ], {});
    } finally {
      window.proxyImg = originalProxyImg;
    }
    document.body.appendChild(host);
    const measure = (selector, hasImage) => {
      const element = host.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const card = element.parentElement;
      const result = { width: rect.width, height: rect.height, ratio: rect.width / rect.height, fill: rect.width / card.clientWidth, cardWidth: card.getBoundingClientRect().width };
      if (hasImage) {
        const image = element.querySelector('img');
        const imageRect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        result.imageWidth = imageRect.width;
        result.imageHeight = imageRect.height;
        result.imageMargin = style.margin;
        result.imageBorderRadius = style.borderRadius;
        result.objectFit = style.objectFit;
      }
      return result;
    };
  const result = {
      music: measure('.music-card-link .lkc-cover', true),
      link: measure('.link-card-block[data-blockid="cover-layout-link"] > .lkc-cover', true),
      loading: measure('.link-card-skeleton[data-type="musicCard"] .link-card-skeleton-cover', false),
      loadingCard: measure('.link-card-skeleton[data-type="musicCard"]', false)
    };
    host.remove();
    return result;
  });
};

await page.goto(BASE, { waitUntil: 'commit' });
await page.waitForSelector('.list-item');
const target = page.locator('.list-item').nth(2);
const memoTitle = (await target.innerText()).trim();
const failureTarget = page.locator('.list-item').nth(3);
const failureMemoTitle = (await failureTarget.innerText()).trim().split('\n')[0];
await target.click();
await page.locator('.editor-body').waitFor();
await page.locator('.editor-body').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('/');
const musicRow = page.locator('.slash-row').filter({ hasText: '音乐卡片' }).first();
if (!(await musicRow.isVisible().catch(() => false))) { console.log('DEBUG after slash:', (await page.locator('body').innerText()).slice(-1000)); throw new Error('music slash command did not appear'); }
await musicRow.tap();
const input = page.locator('.editor-body [data-music-url="pending"]');
await input.waitFor({ state: 'visible' });
await input.tap();
const retargetedPaste = await page.evaluate(() => {
  // Paste directly into the editable music capsule. Its loading skeleton must
  // keep the same shape as the resolved card (panoramic cover + body).
  const input = document.querySelector('.editor-body [data-music-url="pending"]');
  const host = document.querySelector('.editor-body');
  const markedBefore = document.querySelector('.editor-body')?.dataset.activeMusicInputId || null;
  const data = new DataTransfer();
  data.setData('text/plain', 'https://open.spotify.com/track/mobile-race-regression');
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return { prevented: event.defaultPrevented, target: event.target.className, active: document.activeElement?.dataset?.musicUrl || null, marked: markedBefore, markerAfter: document.querySelector('.editor-body')?.dataset.activeMusicInputId || null };
});
const pastedImmediately = await page.evaluate(() => {
  const card = document.querySelector('.editor-body .link-card-skeleton[data-type="musicCard"]');
  const cover = card && card.querySelector('.link-card-skeleton-cover');
  const input = document.querySelector('.editor-body [data-music-url="pending"]');
  const rect = card && card.getBoundingClientRect();
  const coverRect = cover && cover.getBoundingClientRect();
  return { skeleton: !!card, inputRemaining: !!input, pasteTransition: !!card?.classList.contains('music-card-paste-transition'), aspectAnimation: cover ? getComputedStyle(cover).animationName : '', spinnerAnimation: cover ? getComputedStyle(cover, '::after').animationName : '', coverRatio: coverRect && coverRect.height ? coverRect.width / coverRect.height : 0, bodyVisible: !!card?.querySelector('.link-card-skeleton-body') && getComputedStyle(card.querySelector('.link-card-skeleton-body')).display !== 'none', radius: card ? getComputedStyle(card).borderTopLeftRadius : '', width: rect?.width || 0, height: rect?.height || 0, loadingCaretHidden: !getSelection()?.rangeCount };
});
check('pasting in the music edit capsule shows the same-shaped skeleton as the resolved card', retargetedPaste.prevented && pastedImmediately.skeleton && !pastedImmediately.inputRemaining && !pastedImmediately.pasteTransition && pastedImmediately.aspectAnimation === 'none' && pastedImmediately.spinnerAnimation === 'mynoteSkeletonSpin' && Math.abs(pastedImmediately.coverRatio - 2.4) < 0.03 && pastedImmediately.bodyVisible && pastedImmediately.radius === '32px' && pastedImmediately.loadingCaretHidden, JSON.stringify({ retargetedPaste, pastedImmediately }));
await page.waitForFunction(() => {
  const cover = document.querySelector('.editor-body .link-card-skeleton[data-type="musicCard"] .link-card-skeleton-cover');
  if (!cover) return false;
  const rect = cover.getBoundingClientRect();
  return rect.height > 0 && Math.abs(rect.width / rect.height - 2.4) < 0.03;
});

const immediate = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.editor-body [data-type="musicCard"], .editor-body [data-music-url="pending"]')].map(el => ({ id: el.dataset.blockid, type: el.dataset.type, url: el.dataset.url, pending: el.dataset.musicUrl, className: el.className })),
  loadingCoverRatio: (() => { const el = document.querySelector('.editor-body .link-card-skeleton[data-type="musicCard"] .link-card-skeleton-cover'); const r = el && el.getBoundingClientRect(); return r && r.height ? r.width / r.height : 0; })(),
  loadingCaretHidden: !getSelection()?.rangeCount,
  slashRows: document.querySelectorAll('.slash-row').length,
  bodyText: document.querySelector('.editor-body')?.innerText || ''
}));
check('pasting in the edit capsule consumes the input and hides the caret during loading', retargetedPaste.prevented && !!retargetedPaste.marked && immediate.loadingCaretHidden, JSON.stringify({ retargetedPaste, immediate }));
check('edit-capsule paste keeps exactly one same-shaped loading card', immediate.cards.length === 1 && immediate.cards[0].className.includes('skeleton') && !immediate.cards[0].className.includes('music-card-paste-transition') && Math.abs(immediate.loadingCoverRatio - 2.4) < 0.03, JSON.stringify(immediate));
check('slash search closes and no stray slash remains', immediate.slashRows === 0 && !/(^|\n)\s*\/\s*(\n|$)/.test(immediate.bodyText), `rows=${immediate.slashRows}`);
await page.locator('.editor-body a.music-card-link[href="https://open.spotify.com/track/mobile-race-regression"]').waitFor({ state: 'visible', timeout: 10000 });
const resolved = await page.evaluate(() => [...document.querySelectorAll('.editor-body [data-type="musicCard"]')].map(el => ({ id: el.dataset.blockid, url: el.dataset.url, className: el.className, text: el.innerText, hasCover: !!el.querySelector('.lkc-cover img') })));
check('async completion preserves one resolved music card with artwork', resolved.length === 1 && resolved[0].text.includes('Regression Song') && resolved[0].hasCover, JSON.stringify(resolved));
const caretAfterLoad = await page.evaluate(() => {
  const card = document.querySelector('.editor-body a.music-card-link[href="https://open.spotify.com/track/mobile-race-regression"]');
  const next = card && card.nextElementSibling;
  const selection = getSelection();
  const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  const focusNode = selection && selection.focusNode;
  const inNext = !!(next && focusNode && (focusNode === next || next.contains(focusNode)));
  const atStart = !!(range && range.collapsed && (range.startContainer === next && range.startOffset === 0 || next && range.startContainer === next.firstChild && range.startOffset === 0));
  return { nextTag: next?.tagName || '', inNext, atStart, rangeCount: selection?.rangeCount || 0 };
});
check('after loading the caret returns at the start of the line below the music card', caretAfterLoad.nextTag === 'P' && caretAfterLoad.inNext && caretAfterLoad.atStart, JSON.stringify(caretAfterLoad));
const mobileMusicLayout = await measureMusicCover();
await page.setViewportSize({ width: 1280, height: 844 });
const desktopMusicLayout = await measureMusicCover();
await page.setViewportSize({ width: 390, height: 844 });
const isPanoramicAndFilled = layout => !!layout && Math.abs(layout.ratio - 2.4) < 0.02 && layout.fill >= 0.99 && Math.abs(layout.imageWidth - layout.width) <= 1 && Math.abs(layout.imageHeight - layout.height) <= 1 && layout.imageMargin === '0px' && layout.imageBorderRadius === '0px' && layout.objectFit === 'cover';
check('inserted music cover fills the panoramic banner on narrow viewport', isPanoramicAndFilled(mobileMusicLayout), JSON.stringify(mobileMusicLayout));
check('inserted music cover fills the panoramic banner on desktop viewport', isPanoramicAndFilled(desktopMusicLayout), JSON.stringify(desktopMusicLayout));
await page.waitForTimeout(1500); // allow autosave/debounce to commit before closing.
await page.locator('.editor-fab.left').click();
await page.waitForSelector('.list-item');
await page.locator('.list-item').nth(2).click();
await page.locator('.editor-body').waitFor();
await page.locator('.editor-body a.music-card-link[href="https://open.spotify.com/track/mobile-race-regression"]').waitFor({ state: 'visible', timeout: 10000 });
const reopened = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.editor-body [data-type="musicCard"]')].map(el => ({ id: el.dataset.blockid, url: el.dataset.url, className: el.className, text: el.innerText, hasCover: !!el.querySelector('.lkc-cover img') })),
  straySlash: [...document.querySelectorAll('.editor-body p')].some(p => p.textContent.trim() === '/')
}));
check('reopen retains exactly one resolved card with artwork and no slash placeholder', reopened.cards.length === 1 && reopened.cards[0].text.includes('Regression Song') && reopened.cards[0].hasCover && !reopened.straySlash, JSON.stringify(reopened));
// A second memo exercises failed metadata resolution and persistence independently.
await page.locator('.editor-fab.left').click();
await page.waitForSelector('.list-item');
await page.locator('.list-item').filter({ hasText: failureMemoTitle }).first().click();
await page.locator('.editor-body').waitFor();
await page.locator('.editor-body').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('/');
await page.locator('.slash-row').filter({ hasText: '音乐卡片' }).first().tap();
await page.locator('.editor-body [data-music-url="pending"]').waitFor({ state: 'visible' });
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', 'https://open.spotify.com/track/mobile-race-fail');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector('.editor-body [data-music-url="pending"]').dispatchEvent(ev);
});
await page.keyboard.press('Enter');
await page.locator('.editor-body .music-card-error[data-url*="mobile-race-fail"]').waitFor({ state: 'visible', timeout: 10000 });
const failedBeforeReopen = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.editor-body [data-type="musicCard"], .editor-body .music-card-error')].map(el => ({ id: el.dataset.blockid, type: el.dataset.type, url: el.dataset.url, className: el.className, linkUrl: el.querySelector('.music-card-error-url')?.href || '', retryButtons: el.querySelectorAll('[data-music-retry]').length })),
  straySlash: [...document.querySelectorAll('.editor-body p')].some(p => p.textContent.trim() === '/')
}));
check('failed lookup preserves its original clickable URL and retry button', failedBeforeReopen.cards.length === 1 && /music-card-error/.test(failedBeforeReopen.cards[0].className) && failedBeforeReopen.cards[0].linkUrl === 'https://open.spotify.com/track/mobile-race-fail' && failedBeforeReopen.cards[0].retryButtons === 1 && !failedBeforeReopen.straySlash, JSON.stringify(failedBeforeReopen));
await page.waitForTimeout(1500);
const failedReloadResponse = page.waitForResponse(response => response.url().includes('mobile-race-fail') && response.status() === 503);
await page.locator('.editor-fab.left').click();
await page.waitForSelector('.list-item');
await page.locator('.list-item').filter({ hasText: failureMemoTitle }).first().click();
await page.locator('.editor-body').waitFor();
await failedReloadResponse;
await page.locator('.editor-body .music-card-error[data-url*="mobile-race-fail"]').waitFor({ state: 'visible', timeout: 10000 });
const failedReopen = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.editor-body [data-type="musicCard"], .editor-body .music-card-error')].map(el => ({ id: el.dataset.blockid, type: el.dataset.type, url: el.dataset.url, className: el.className })),
  linkUrl: document.querySelector('.editor-body .music-card-error-url')?.href || '',
  retryButtons: document.querySelectorAll('.editor-body .music-card-error [data-music-retry]').length,
  pending: document.querySelectorAll('.editor-body [data-music-url="pending"], .editor-body.link-card-skeleton').length,
  straySlash: [...document.querySelectorAll('.editor-body p')].some(p => p.textContent.trim() === '/')
}));
check('failed card survives reopen with its URL and retry button', failedReopen.cards.length === 1 && failedReopen.linkUrl === 'https://open.spotify.com/track/mobile-race-fail' && failedReopen.retryButtons === 1 && failedReopen.pending === 0 && !failedReopen.straySlash, JSON.stringify(failedReopen));
await page.locator('.editor-body .music-card-error [data-music-retry]').click();
await page.locator('.editor-body a.music-card-link .lkc-title').filter({ hasText: 'Retry Recovered Song' }).waitFor({ state: 'visible', timeout: 10000 });
const retried = await page.evaluate(() => {
  const link = document.querySelector('.editor-body a.music-card-link');
  return { count: document.querySelectorAll('.editor-body [data-type="musicCard"]').length, href: link?.href || '', title: link?.querySelector('.lkc-title')?.textContent || '', loading: document.querySelectorAll('.editor-body .link-card-skeleton[data-type="musicCard"]').length, retry: document.querySelectorAll('.editor-body .music-card-retry').length };
});
check('retry re-runs metadata parsing and replaces the skeleton with the same music URL', retried.count === 1 && retried.href === 'https://open.spotify.com/track/mobile-race-fail' && retried.title === 'Retry Recovered Song' && retried.loading === 0 && retried.retry === 0, JSON.stringify(retried));

// iOS Safari may deliver paste without readable text/plain and put text into the
// editable capsule via beforeinput/input. The card must still become a skeleton
// immediately, without waiting for Enter or blur.
await page.locator('.editor-body').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('/');
await page.locator('.slash-row').filter({ hasText: '音乐卡片' }).first().tap();
await page.locator('.editor-body [data-music-url="pending"]').waitFor({ state: 'visible' });
const longAppleUrl = 'https://music.apple.com/hk/album/%E6%9C%88%E4%B8%8B%E7%85%AE%E8%8C%B6-%E4%B9%8B%E9%97%B4%E7%9A%84%E5%BF%83%E6%83%85/6768579330?i=6768579331';
const nativePasteFallback = await page.evaluate(url => {
  const input = document.querySelector('.editor-body [data-music-url="pending"]');
  const emptyClipboard = new DataTransfer();
  const paste = new ClipboardEvent('paste', { clipboardData: emptyClipboard, bubbles: true, cancelable: true });
  input.dispatchEvent(paste);
  input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', bubbles: true, cancelable: true }));
  input.textContent = '粘贴音乐链接到这里...' + url;
  input.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
  const skeleton = document.querySelector('.editor-body .link-card-skeleton[data-type="musicCard"][data-url="' + url + '"]');
  const rect = skeleton && skeleton.querySelector('.link-card-skeleton-cover')?.getBoundingClientRect();
  return {
    pastePrevented: paste.defaultPrevented,
    skeleton: !!skeleton,
    pasteTransition: !!skeleton?.classList.contains('music-card-paste-transition'),
    aspectAnimation: skeleton ? getComputedStyle(skeleton.querySelector('.link-card-skeleton-cover')).animationName : '',
    spinnerAnimation: skeleton ? getComputedStyle(skeleton.querySelector('.link-card-skeleton-cover'), '::after').animationName : '',
    pendingInputs: document.querySelectorAll('.editor-body [data-music-url="pending"]').length,
    ratio: rect && rect.height ? rect.width / rect.height : 0,
    corner: skeleton ? getComputedStyle(skeleton).borderTopLeftRadius : '',
    paragraphLeak: [...document.querySelectorAll('.editor-body p')].some(p => p.textContent.includes(url))
  };
}, longAppleUrl);
check('pasting within the music capsule without readable clipboard text gets the same-shaped skeleton fallback', nativePasteFallback.skeleton && !nativePasteFallback.pasteTransition && nativePasteFallback.aspectAnimation === 'none' && nativePasteFallback.spinnerAnimation === 'mynoteSkeletonSpin' && Math.abs(nativePasteFallback.ratio - 2.4) < 0.03 && nativePasteFallback.pendingInputs === 0 && nativePasteFallback.corner === '32px' && !nativePasteFallback.paragraphLeak, JSON.stringify(nativePasteFallback));
const fallbackAfterEnter = await page.evaluate(url => ({
  cardCount: document.querySelectorAll('.editor-body [data-type="musicCard"][data-url="' + url + '"]').length,
  pendingCount: document.querySelectorAll('.editor-body [data-music-url="pending"]').length,
  paragraphLeak: [...document.querySelectorAll('.editor-body p')].some(p => p.textContent.includes(url))
}), longAppleUrl);
check('native fallback paste leaves one card and no raw URL paragraph without an extra keypress', fallbackAfterEnter.cardCount === 1 && fallbackAfterEnter.pendingCount === 0 && !fallbackAfterEnter.paragraphLeak, JSON.stringify(fallbackAfterEnter));
await page.locator('.editor-body a.music-card-link[href^="https://music.apple.com/hk/album/"]').waitFor({ state: 'visible', timeout: 10000 });

await page.locator('.editor-body').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('/');
await page.locator('.slash-row').filter({ hasText: '音乐卡片' }).first().tap();
await page.locator('.editor-body [data-music-url="pending"]').waitFor({ state: 'visible' });
const retargetedNativePaste = await page.evaluate(url => {
  const host = document.querySelector('.editor-body');
  const musicInput = host.querySelector('[data-music-url="pending"]');
  const paragraph = document.createElement('p');
  paragraph.dataset.blockid = 'ios-retargeted-paste-block';
  paragraph.textContent = 'Existing paragraph text that must remain unchanged';
  host.appendChild(paragraph);
  const originalText = paragraph.textContent;
  host.dataset.activeMusicInputId = musicInput.dataset.blockid;
  host.focus();
  window.getSelection().removeAllRanges();
  const emptyClipboard = new DataTransfer();
  host.dispatchEvent(new ClipboardEvent('paste', { clipboardData: emptyClipboard, bubbles: true, cancelable: true }));
  host.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', bubbles: true, cancelable: true }));
  paragraph.textContent = originalText + url;
  host.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
  const skeleton = host.querySelector('.link-card-skeleton[data-type="musicCard"][data-url="' + url + '"]');
  const rect = skeleton && skeleton.querySelector('.link-card-skeleton-cover')?.getBoundingClientRect();
  return {
    skeleton: !!skeleton,
    pasteTransition: !!skeleton?.classList.contains('music-card-paste-transition'),
    aspectAnimation: skeleton ? getComputedStyle(skeleton.querySelector('.link-card-skeleton-cover')).animationName : '',
    ratio: rect && rect.height ? rect.width / rect.height : 0,
    corner: skeleton ? getComputedStyle(skeleton).borderTopLeftRadius : '',
    pendingInputs: host.querySelectorAll('[data-music-url="pending"]').length,
    paragraphRestored: paragraph.textContent === originalText,
    paragraphLeak: [...host.querySelectorAll('p')].some(p => p.textContent.includes(url))
  };
}, longAppleUrl + '&redirected=paragraph');
check('retargeted paste landing in a paragraph keeps the same panoramic skeleton', retargetedNativePaste.skeleton && !retargetedNativePaste.pasteTransition && retargetedNativePaste.aspectAnimation === 'none' && Math.abs(retargetedNativePaste.ratio - 2.4) < 0.03 && retargetedNativePaste.corner === '32px' && retargetedNativePaste.pendingInputs === 0 && retargetedNativePaste.paragraphRestored && !retargetedNativePaste.paragraphLeak, JSON.stringify(retargetedNativePaste));
await page.waitForFunction(url => {
  const cover = document.querySelector('.editor-body .link-card-skeleton[data-type="musicCard"][data-url="' + url + '"] .link-card-skeleton-cover');
  if (!cover) return false;
  const rect = cover.getBoundingClientRect();
  return rect.height > 0 && Math.abs(rect.width / rect.height - 2.4) < 0.03;
}, longAppleUrl + '&redirected=paragraph');
if (retargetedNativePaste.skeleton) await page.locator('.editor-body a.music-card-link[href*="redirected=paragraph"]').waitFor({ state: 'visible', timeout: 10000 });

const coverLayoutsMobile = await measureRenderedCoverLayouts(390);
const coverLayoutsDesktop = await measureRenderedCoverLayouts(1280);
const isPanoramic = layout => !!layout && Math.abs(layout.ratio - 2.4) < 0.02 && layout.fill >= 0.99;
for (const [name, layouts] of [['narrow', coverLayoutsMobile], ['desktop', coverLayoutsDesktop]]) {
  check(`music artwork and loading skeleton cover both stay panoramic and the skeleton card matches the resolved card width (${name})`, isPanoramic(layouts.music) && Math.abs(layouts.loading.ratio - 2.4) < 0.03 && Math.abs(layouts.loadingCard.width - layouts.music.cardWidth) <= 1 && layouts.music.imageMargin === '0px' && layouts.music.imageBorderRadius === '0px' && layouts.music.objectFit === 'cover' && Math.abs(layouts.music.imageWidth - layouts.music.width) <= 1 && Math.abs(layouts.music.imageHeight - layouts.music.height) <= 1, JSON.stringify({ music: layouts.music, loading: layouts.loading, loadingCard: layouts.loadingCard }));
  check(`ordinary link cover remains panoramic (${name})`, isPanoramic(layouts.link) && layouts.link.imageMargin === '0px' && layouts.link.imageBorderRadius === '0px' && layouts.link.objectFit === 'cover', JSON.stringify(layouts.link));
}

await page.locator('.editor-body').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('/');
await page.locator('.slash-row').filter({ hasText: '音乐卡片' }).first().tap();
await page.locator('.editor-body [data-music-url="pending"]').waitFor({ state: 'visible' });
const ordinaryTextPaste = await page.evaluate(text => {
  const input = document.querySelector('.editor-body [data-music-url="pending"]');
  const clipboard = new DataTransfer();
  clipboard.setData('text/plain', text);
  const paste = new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true });
  input.dispatchEvent(paste);
  input.textContent = '粘贴音乐链接到这里...' + text;
  input.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
  return {
    pastePrevented: paste.defaultPrevented,
    inputRemains: !!document.querySelector('.editor-body [data-music-url="pending"]'),
    pastedText: input.textContent.includes(text),
    skeletonCreated: !!document.querySelector('.editor-body .link-card-skeleton[data-type="musicCard"]')
  };
}, 'ordinary copied notes should remain editable');
check('non-URL text pasted into the music capsule remains editable and is not consumed', !ordinaryTextPaste.pastePrevented && ordinaryTextPaste.inputRemains && ordinaryTextPaste.pastedText && !ordinaryTextPaste.skeletonCreated, JSON.stringify(ordinaryTextPaste));

await page.setViewportSize({ width: 820, height: 1180 });
const desktopDefaultUrl = 'https://music.apple.com/hk/album/default-columns-retargeted';
const desktopDefaultColumnPaste = await page.evaluate(url => {
  const host = document.querySelector('.editor-body');
  const input = host.querySelector('[data-music-url="pending"]');
  const id = input.dataset.blockid;
  input.textContent = '粘贴音乐链接到这里...';
  host.dataset.activeMusicInputId = id;
  host.focus();
  window.getSelection().removeAllRanges();
  const emptyClipboard = new DataTransfer();
  host.dispatchEvent(new ClipboardEvent('paste', { clipboardData: emptyClipboard, bubbles: true, cancelable: true }));
  host.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', bubbles: true, cancelable: true }));
  const pastedBlock = document.createElement('p');
  pastedBlock.textContent = url;
  host.appendChild(pastedBlock);
  host.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
  const skeleton = host.querySelector('.link-card-skeleton[data-blockid="' + id + '"]');
  return {
    columns: getComputedStyle(host).columnCount,
    sameIdSkeleton: !!skeleton,
    skeletonSpan: skeleton ? getComputedStyle(skeleton).columnSpan : '',
    pendingInputs: host.querySelectorAll('[data-music-url="pending"]').length,
    rawUrlBlocks: [...host.querySelectorAll('p')].filter(p => p.textContent.includes(url)).length,
    newBlockText: pastedBlock.textContent,
    visibleOldCapsule: !!host.querySelector('[data-music-url="pending"]')
  };
}, desktopDefaultUrl);
check('default two-column paste into a newly created paragraph replaces the original music capsule immediately', desktopDefaultColumnPaste.columns === '2' && desktopDefaultColumnPaste.sameIdSkeleton && desktopDefaultColumnPaste.pendingInputs === 0 && desktopDefaultColumnPaste.rawUrlBlocks === 0 && !desktopDefaultColumnPaste.visibleOldCapsule, JSON.stringify(desktopDefaultColumnPaste));
if (desktopDefaultColumnPaste.sameIdSkeleton) await page.locator(`.editor-body a.music-card-link[href="${desktopDefaultUrl}"]`).waitFor({ state: 'visible', timeout: 10000 });
const desktopDefaultResolved = await page.evaluate(url => {
  const host = document.querySelector('.editor-body');
  const matchingCards = [...host.querySelectorAll('[data-type="musicCard"]')].filter(card => card.dataset.url === url);
  return {
    matchingCards: matchingCards.length,
    className: matchingCards[0]?.className || '',
    pendingInputs: host.querySelectorAll('[data-music-url="pending"]').length,
    loadingCards: host.querySelectorAll('.link-card-skeleton[data-type="musicCard"]').length,
    rawUrlBlocks: [...host.querySelectorAll('p')].filter(p => p.textContent.includes(url)).length,
    resolvedLink: !!host.querySelector(`a.music-card-link[href="${url}"]`)
  };
}, desktopDefaultUrl);
check('default two-column async completion keeps one resolved music card and removes every paste artifact', desktopDefaultResolved.matchingCards === 1 && desktopDefaultResolved.resolvedLink && desktopDefaultResolved.pendingInputs === 0 && desktopDefaultResolved.loadingCards === 0 && desktopDefaultResolved.rawUrlBlocks === 0, JSON.stringify(desktopDefaultResolved));

await page.emulateMedia({ reducedMotion: 'reduce' });
const reducedMotionLayout = await page.evaluate(() => {
  const host = document.createElement('div');
  host.className = 'editor-body';
  host.style.cssText = 'position:fixed;left:0;top:0;width:320px;visibility:hidden;pointer-events:none;';
  host.innerHTML = window.MynoteEditor.renderAtomicHTML({ id: 'reduced-motion-music', type: 'musicCard', url: 'https://open.spotify.com/track/reduced-motion', status: 'loading' }, {});
  document.body.appendChild(host);
  const card = host.querySelector('.link-card-skeleton');
  const cover = card && card.querySelector('.link-card-skeleton-cover');
  const rect = cover && cover.getBoundingClientRect();
  const result = {
    ratio: rect && rect.height ? rect.width / rect.height : 0,
    aspectAnimation: cover ? getComputedStyle(cover).animationName : '',
    spinnerAnimation: cover ? getComputedStyle(cover, '::after').animationName : ''
  };
  host.remove();
  return result;
});
check('reduced-motion skeleton keeps the panoramic cover and disables the spinner animation', Math.abs(reducedMotionLayout.ratio - 2.4) < 0.03 && reducedMotionLayout.aspectAnimation === 'none' && reducedMotionLayout.spinnerAnimation === 'none', JSON.stringify(reducedMotionLayout));
await page.emulateMedia({ reducedMotion: 'no-preference' });

check('no browser JavaScript errors', failures.length === 0, failures.join(' | '));
await browser.close();
if (results.some(result => !result.ok)) process.exitCode = 1;
