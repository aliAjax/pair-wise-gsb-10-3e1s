import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { App } from '../src/main.jsx';

let currentRoot = null;

test.beforeEach(() => {
  window.localStorage.clear();
});

test.afterEach(() => {
  if (currentRoot) {
    act(() => currentRoot.unmount());
    currentRoot = null;
  }
});

function mount() {
  document.getElementById('root').innerHTML = '<div id="root-inner"></div>';
  const container = document.getElementById('root-inner');
  const root = createRoot(container);
  currentRoot = root;
  act(() => {
    root.render(React.createElement(App));
  });
  return { root, container };
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const mousedown = (el) => act(() => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
const mouseup = () => act(() => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
const mousemove = (x, y) =>
  act(() => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y })));

const findButton = (text) =>
  $$('button').find((b) => b.textContent.trim().replace(/\s+/g, ' ').includes(text));

const nodeButtons = () => $$('button.node');
const undoBtn = () => findButton('撤销');
const redoBtn = () => findButton('重做');

test('初始渲染：内置 6 个节点与 5 条连接', () => {
  mount();
  assert.equal(nodeButtons().length, 6);
  assert.equal($$('.edge').length, 5);
});

test('误删设备后可撤销恢复，连线一并恢复；重做再次删除', async () => {
  mount();
  // 选中 db（4 条连接相关节点 gw/sw1…），删除
  const db = $$('.node-list button').find((b) => b.textContent.includes('Database'));
  await click(db);
  const before = nodeButtons().length;
  const edgesBefore = $$('.edge').length;
  await click(findButton('删除设备'));
  assert.equal(nodeButtons().length, before - 1);
  assert.ok($$('.edge').length < edgesBefore, '关联连线应随设备一起删除');

  await click(undoBtn());
  assert.equal(nodeButtons().length, before, '撤销后设备恢复');
  assert.equal($$('.edge').length, edgesBefore, '撤销后关联连线恢复');

  await click(redoBtn());
  assert.equal(nodeButtons().length, before - 1, '重做再次删除');
});

test('节点操作与连线变化共用同一份历史，按序回放', async () => {
  mount();
  const startNodes = nodeButtons().length;
  // 1) 添加设备
  await click(findButton('＋ 设备'));
  assert.equal(nodeButtons().length, startNodes + 1);
  // 2) 添加连线：进入连接模式后点画布上第一个其他节点
  await click(findButton('连接'));
  const others = nodeButtons().filter((b) => !b.className.includes('picked'));
  await click(others[0]);
  const afterEdge = $$('.edge').length;
  assert.equal(afterEdge, 6);

  // 撤销顺序：先连线，后节点
  await click(undoBtn());
  assert.equal($$('.edge').length, 5);
  assert.equal(nodeButtons().length, startNodes + 1);
  await click(undoBtn());
  assert.equal(nodeButtons().length, startNodes);
  // 重做恢复
  await click(redoBtn());
  assert.equal(nodeButtons().length, startNodes + 1);
  await click(redoBtn());
  assert.equal($$('.edge').length, 6);
});

test('重复连接被拒绝进入历史', async () => {
  mount();
  await click($$('.node-list button')[0]);
  await click(findButton('连接'));
  // 选一个已经相连的节点（gw 与 sw1 已连）；画布中挑第一个非选中
  // gw 默认选中，相连的是 sw1/sw2
  const target = nodeButtons().find((b) => b.textContent.includes('交换机 A'));
  await click(target);
  const toast = $('.toast')?.textContent || '';
  assert.match(toast, /已经存在连接/);
  assert.equal($$('.edge').length, 5);
  assert.ok(undoBtn().disabled, '被拒绝的操作不产生历史步');
});

test('拖动是一个历史步：撤销后节点回到原位', async () => {
  mount();
  const n = nodeButtons()[0];
  const before = n.style.left;
  mousedown(n);
  // board.getBoundingClientRect 在 jsdom 全为 0，坐标会被夹到 0,0
  await mousemove(300, 300);
  await mouseup();
  assert.notEqual(nodeButtons()[0].style.left, before);
  await click(undoBtn());
  assert.equal(nodeButtons()[0].style.left, before, '一次撤销回到拖动前位置');
});

test('保存前检查列出孤立节点/非法地址，面板打开时编辑不受阻', async () => {
  mount();
  // 添加一个孤立节点
  await click(findButton('＋ 设备'));
  // 把选中节点的 IP 改成非法值
  const ipInput = $$('.inspector input')[1];
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(ipInput, '999.1.1.1');
    ipInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // 点保存：应被拦截并打开问题面板，而不是写入
  await click(findButton('保存更改'));
  const dock = $('.problem-dock');
  assert.ok(dock, '问题面板出现');
  const text = dock.textContent;
  assert.ok(text.includes('孤立') || text.includes('没有任何连接'));
  assert.ok(text.includes('IP'));
  assert.equal(window.localStorage.getItem('topology'), null, '有问题时未写入本地');

  // 面板打开期间仍可添加设备（编辑不受影响）
  const nodesNow = nodeButtons().length;
  await click(findButton('＋ 设备'));
  assert.equal(nodeButtons().length, nodesNow + 1);

  // “仍要保存”：强制写入
  await click(findButton('仍要保存'));
  assert.ok(window.localStorage.getItem('topology'));
});

test('保存后历史重置：撤销按钮禁用', async () => {
  mount();
  await click(findButton('＋ 设备'));
  assert.ok(!undoBtn().disabled);
  // 让检查通过：把新节点连上。直接走连接流程
  await click(findButton('连接'));
  await click(nodeButtons().filter((b) => !b.className.includes('picked'))[0]);
  await click(findButton('保存更改'));
  // 若无问题则直接保存；若还有孤立节点（新节点已连，但原来均相连）应直接成功
  const stored = window.localStorage.getItem('topology');
  if (stored) {
    assert.ok(undoBtn().disabled, '保存后撤销链清空');
    assert.ok(redoBtn().disabled);
  } else {
    // 万一面板打开（IP 重复默认 192.168.0.10 唯一），走强制保存
    await click(findButton('仍要保存'));
    assert.ok(undoBtn().disabled);
  }
});

test('导入坏文件：当前图与历史原样保留', async () => {
  mount();
  await click(findButton('＋ 设备'));
  const canUndoBefore = !undoBtn().disabled;
  const bad = new window.File(['{"nodes":[{"id":"a"}], "edges":[["a","ghost"]]}'], 'bad.json', {
    type: 'application/json',
  });
  const input = $('input[type=file]');
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
  const dock = $('.problem-dock');
  assert.ok(dock.textContent.includes('ghost'));
  assert.equal(nodeButtons().length, 7, '当前图未被坏文件替换');
  assert.equal(!undoBtn().disabled, canUndoBefore, '坏文件没有动历史');
});

test('导入合法文件后可撤销回旧图', async () => {
  mount();
  const good = new window.File(
    [JSON.stringify({
      nodes: [
        { id: 'x1', name: '导入设备', type: 'router', x: 10, y: 10, ip: '172.16.0.1' },
        { id: 'x2', name: '导入终端', type: 'device', x: 20, y: 20, ip: '172.16.0.2' },
      ],
      edges: [['x1', 'x2']],
    })],
    'good.json',
    { type: 'application/json' }
  );
  const input = $('input[type=file]');
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [good], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.equal(nodeButtons().length, 2);
  assert.equal($$('.edge').length, 1);
  assert.ok(nodeButtons()[0].textContent.includes('导入设备'));
  // 撤销导入：旧图完整回来
  await click(undoBtn());
  assert.equal(nodeButtons().length, 6);
  assert.equal($$('.edge').length, 5);
});

test('检查面板的一键清理重复连接可撤销', async () => {
  mount();
  // 手工构造重复：加两次相同连线——UI 会拒绝，所以直接通过连续添加两台设备并各连同一目标不行。
  // 改为导入一个含重复连线的合法文件（语义问题不阻断导入）
  const dup = new window.File(
    [JSON.stringify({
      nodes: [
        { id: 'a', name: 'A', type: 'router', x: 0, y: 0, ip: '1.1.1.1' },
        { id: 'b', name: 'B', type: 'switch', x: 0, y: 0, ip: '1.1.1.2' },
      ],
      edges: [['a', 'b'], ['b', 'a']],
    })],
    'dup.json',
    { type: 'application/json' }
  );
  const input = $('input[type=file]');
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [dup], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.equal($$('.edge').length, 2);
  await click(findButton('一键清理重复连接'));
  assert.equal($$('.edge').length, 1);
  await click(undoBtn());
  assert.equal($$('.edge').length, 2, '清理操作也在历史里，可撤销');
});
