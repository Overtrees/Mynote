// 按 Moments.html 的真实顺序加载全部非 vendor 脚本，供结构回归测试使用。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeEnv, loadScript } from './env.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MOMENTS = path.join(ROOT, 'Moments.html');

export function readPage(file = MOMENTS) {
  return fs.readFileSync(file, 'utf8');
}

export function localScripts(html = readPage()) {
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
    .map(m => m[1])
    .filter(ref => !/^https?:/.test(ref) && !ref.includes('/vendor/'))
    .map(ref => ref.split('?')[0].replace(/^\.\//, ''));
}

export function makeAppEnv() {
  const env = makeEnv();
  const w = env.win;
  const doc = env.doc;

  // 错误浮层在 DOMContentLoaded 后挂载；测试只验证模块注册，不执行挂载。
  doc.readyState = 'loading';
  w.addEventListener = function () {};
  w.removeEventListener = function () {};
  w.React.Component = class {
    constructor(props) { this.props = props || {}; }
    setState() {}
  };
  w.ReactDOM.flushSync = fn => fn();
  w.marked = { setOptions() {}, parse: source => String(source || '') };
  w.fetch = async () => { throw new Error('network disabled in tests'); };
  w.AbortSignal = { timeout: () => undefined };
  w.navigator = {
    userAgent: 'node',
    language: 'zh-CN',
    standalone: false,
    share: undefined,
    canShare: undefined
  };

  const loaded = [];
  for (const rel of localScripts()) {
    loadScript(env, path.join(ROOT, rel));
    loaded.push(rel);
  }
  return { env, win: w, doc, loaded };
}

export function runInApp(env, code) {
  return vm.runInContext(code, env.ctx);
}