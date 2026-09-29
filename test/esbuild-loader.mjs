// ESM 加载钩子：.jsx 交给 esbuild 转译；.css 返回空模块。
// Node 20 对“未知扩展名 + format:module”会报 ERR_UNKNOWN_MODULE_FORMAT，
// 因此把虚拟模块 URL 做成同目录下 .mjs 路径 + 查询参数，保证相对导入基准正确。
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';

const virtualUrl = (realUrl, kind) =>
  realUrl.replace(/\.(jsx|css)$/, `.__${kind}.$1.mjs?src=${encodeURIComponent(realUrl)}`);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.jsx') || specifier.endsWith('.css')) {
    const parentURL = context.parentURL || 'file:///';
    const target = new URL(specifier, parentURL).href;
    const kind = target.endsWith('.jsx') ? 'jsx' : 'css';
    return { url: virtualUrl(target, kind), format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const m = url.match(/[?&]src=(.*)$/);
  if (url.includes('.__jsx.jsx.mjs?')) {
    const realUrl = decodeURIComponent(m[1]);
    const file = new URL(realUrl).pathname;
    const source = await readFile(file, 'utf8');
    const result = await transform(source, {
      loader: 'jsx',
      format: 'esm',
      jsx: 'automatic',
      sourcefile: file,
    });
    return { format: 'module', source: result.code, shortCircuit: true };
  }
  if (url.includes('.__css.css.mjs?')) {
    return { format: 'module', source: 'export default {}', shortCircuit: true };
  }
  return nextLoad(url, context);
}
