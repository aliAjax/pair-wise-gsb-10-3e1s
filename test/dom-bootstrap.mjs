// 通过 node --import 引导：在任何被测模块加载前准备好 jsdom 全局环境，
// 并注册 .jsx/.css 的加载钩子。
import { register } from 'node:module';
import { JSDOM } from 'jsdom';

register(new URL('./esbuild-loader.mjs', import.meta.url).href);

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: 'http://localhost/', pretendToBeVisual: true }
);
const { window } = dom;

window.HTMLAnchorElement.prototype.click = function click() {};
window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};

for (const key of [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'Text', 'DocumentFragment', 'MouseEvent', 'KeyboardEvent', 'Event',
  'FileReader', 'Blob',
]) {
  globalThis[key] = window[key];
}
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.localStorage = window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
