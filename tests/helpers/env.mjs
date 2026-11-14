// 极简浏览器环境桩：只提供模块在「加载期」真正访问到的 API。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function stubEl(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {}, children: [], childNodes: [], files: null,
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    innerHTML: '', textContent: '', contentEditable: 'true',
    appendChild() {}, insertBefore() {}, removeChild() {}, remove() {}, after() {}, before() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {}, blur() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    closest() { return null; }, getContext() { return null; }
  };
}

export function makeEnv() {
  const storage = new Map();
  const win = {};
  const doc = {
    createElement: stubEl,
    createTextNode: (t) => ({ nodeType: 3, textContent: t }),
    createRange: () => ({ setStart() {}, setEnd() {}, collapse() {}, selectNodeContents() {}, setStartAfter() {}, deleteContents() {}, insertNode() {}, cloneRange() { return this; }, getClientRects: () => [], getBoundingClientRect: () => ({}) }),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    head: stubEl('head'), body: stubEl('body'), documentElement: stubEl('html'),
    execCommand() { return true; }, activeElement: null
  };
  win.window = win;
  win.document = doc;
  win.navigator = { userAgent: 'node', language: 'zh-CN', share: undefined, canShare: undefined };
  win.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
  };
  win.sessionStorage = win.localStorage;
  win.location = { href: 'https://example.test/Moments.html', search: '', host: 'example.test', reload() {} };
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  win.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  win.cancelAnimationFrame = (id) => clearTimeout(id);
  win.console = console;
  win.URL = URL; win.Blob = Blob; win.FormData = FormData;
  win.File = class File {};
  win.fetch = async () => { throw new Error('network disabled in tests'); };
  win.indexedDB = undefined;
  win.IntersectionObserver = class { observe() {} disconnect() {} };
  win.ResizeObserver = class { observe() {} disconnect() {} };
  win.MutationObserver = class { observe() {} disconnect() {} };
  win.Intl = Intl; win.JSON = JSON; win.Date = Date; win.Math = Math;
  win.React = {
    createElement: () => ({}), Fragment: Symbol('Fragment'),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {}, useLayoutEffect: () => {},
    useRef: (v) => ({ current: v }),
    useCallback: (f) => f,
    useMemo: (f) => (typeof f === 'function' ? f() : f),
    memo: (f) => f, Children: { map: () => [] }
  };
  win.ReactDOM = { createRoot: () => ({ render() {} }) };
  return { win, ctx: vm.createContext(win), doc };
}

export function loadScript(env, file) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), env.ctx, { filename: path.basename(file) });
}
