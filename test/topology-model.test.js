import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneDoc,
  edgeKey,
  historyReducer,
  initHistory,
  inspectDoc,
  validateImport,
} from '../src/topology-model.js';

const docA = {
  nodes: [
    { id: 'a', name: 'A', type: 'router', x: 0, y: 0, ip: '10.0.0.1' },
    { id: 'b', name: 'B', type: 'switch', x: 10, y: 10, ip: '10.0.0.2' },
  ],
  edges: [['a', 'b']],
};

const addNode = (d, id, ip = '192.168.1.1') => ({
  nodes: [...d.nodes, { id, name: id, type: 'device', x: 1, y: 1, ip }],
  edges: d.edges,
});

/* ------------------------------- 历史回放 -------------------------------- */

test('节点操作与连线操作进入同一份历史，按顺序撤销/重做', () => {
  let h = initHistory(docA);

  const docB = addNode(h.present, 'c');
  h = historyReducer(h, { type: 'commit', label: '加节点 c', doc: docB });
  const docC = { ...docB, edges: [...docB.edges, ['b', 'c']] };
  h = historyReducer(h, { type: 'commit', label: '连线 b-c', doc: docC });

  assert.equal(h.past.length, 2);
  assert.deepEqual(h.present.nodes.map((n) => n.id), ['a', 'b', 'c']);
  assert.equal(h.present.edges.length, 2);

  // 撤销先回退连线，再回退节点
  h = historyReducer(h, { type: 'undo' });
  assert.deepEqual(h.present.edges, [['a', 'b']]);
  assert.equal(h.present.nodes.length, 3, '节点仍在，撤销的只是连线');
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.present.nodes.length, 2);

  // 重做按顺序恢复
  h = historyReducer(h, { type: 'redo' });
  assert.equal(h.present.nodes.length, 3);
  h = historyReducer(h, { type: 'redo' });
  assert.equal(h.present.edges.length, 2);
});

test('相同 token 的连续编辑合并为一步', () => {
  let h = initHistory(docA);
  const mk = (name) => ({
    ...h.present,
    nodes: h.present.nodes.map((n) => (n.id === 'a' ? { ...n, name } : n)),
  });
  h = historyReducer(h, { type: 'commit-coalesce', token: 't1', label: '改名', doc: mk('A1') });
  h = historyReducer(h, { type: 'commit-coalesce', token: 't1', label: '改名', doc: mk('A2') });
  h = historyReducer(h, { type: 'commit-coalesce', token: 't1', label: '改名', doc: mk('A3') });
  assert.equal(h.past.length, 1, '三次键入只占一步');
  assert.equal(h.present.nodes[0].name, 'A3');
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.present.nodes[0].name, 'A', '一次撤销回到键入前');
});

test('新操作会清空重做分支', () => {
  let h = initHistory(docA);
  h = historyReducer(h, { type: 'commit', label: 'x', doc: addNode(h.present, 'c') });
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.future.length, 1);
  h = historyReducer(h, { type: 'commit', label: 'y', doc: addNode(h.present, 'd') });
  assert.equal(h.future.length, 0);
  assert.deepEqual(h.present.nodes.map((n) => n.id), ['a', 'b', 'd']);
});

test('导入合法文件是历史中的一步，可撤销回旧图', () => {
  let h = initHistory(docA);
  const incoming = {
    nodes: [{ id: 'x', name: 'X', type: 'device', x: 1, y: 2, ip: '1.1.1.1' }],
    edges: [],
  };
  h = historyReducer(h, { type: 'load', label: '导入 f.json', doc: incoming });
  assert.deepEqual(h.present.nodes.map((n) => n.id), ['x']);
  h = historyReducer(h, { type: 'undo' });
  assert.deepEqual(
    h.present.nodes.map((n) => n.id),
    ['a', 'b'],
    '撤销导入后完整恢复旧图'
  );
});

test('保存（checkpoint）后历史重新开始', () => {
  let h = initHistory(docA);
  h = historyReducer(h, { type: 'commit', label: 'x', doc: addNode(h.present, 'c') });
  h = historyReducer(h, { type: 'checkpoint' });
  assert.deepEqual(h.past, []);
  assert.deepEqual(h.future, []);
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.present.nodes.length, 3, '无历史可撤销，当前图不变');
});

test('历史保存的是快照而非引用，旧步不被后续变更污染', () => {
  let h = initHistory(docA);
  const next = cloneDoc(docA);
  next.nodes[0].ip = '10.0.0.9';
  h = historyReducer(h, { type: 'commit', label: '改 IP', doc: next });
  next.nodes[0].ip = '10.0.0.250'; // 外部再改提交对象
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.present.nodes[0].ip, '10.0.0.1');
  h = historyReducer(h, { type: 'redo' });
  assert.equal(h.present.nodes[0].ip, '10.0.0.9', '历史步中的快照未被外部引用污染');
});

/* ------------------------------ 导入结构校验 ------------------------------ */

const validFile = JSON.stringify({
  nodes: [
    { id: 'a', name: 'A', type: 'router', x: 1, y: 2, ip: '10.0.0.1' },
    { id: 'b', name: 'B', type: 'device', x: 3, y: 4, ip: '10.0.0.2' },
  ],
  edges: [['a', 'b']],
});

test('合法文件通过校验并归一化', () => {
  const r = validateImport(validFile);
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.length, 2);
  assert.deepEqual(r.doc.edges, [['a', 'b']]);
});

test('坏 JSON 被拒绝', () => {
  const r = validateImport('{not json');
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /JSON/);
});

test('顶层结构错误被拒绝', () => {
  assert.equal(validateImport('[]').ok, false);
  assert.equal(validateImport(JSON.stringify({ nodes: [] })).ok, false);
});

test('节点 id 缺失或重复被拒绝', () => {
  const dup = { nodes: [
    { id: 'a', name: 'A', type: 'router', x: 1, y: 1, ip: '1.1.1.1' },
    { id: 'a', name: 'A2', type: 'device', x: 2, y: 2, ip: '1.1.1.2' },
  ], edges: [] };
  const r = validateImport(JSON.stringify(dup));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('重复')));
  assert.equal(
    validateImport(JSON.stringify({ nodes: [{ name: 'X', type: 'device', x: 1, y: 1 }], edges: [] })).ok,
    false
  );
});

test('连线引用不存在的节点被拒绝', () => {
  const r = validateImport(JSON.stringify({
    nodes: [{ id: 'a', name: 'A', type: 'router', x: 1, y: 1, ip: '1.1.1.1' }],
    edges: [['a', 'ghost']],
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('ghost')));
});

test('类型非法、坐标缺失、连线形态错误都被拒绝', () => {
  const r = validateImport(JSON.stringify({
    nodes: [
      { id: 'a', name: 'A', type: 'firewall', x: 1, y: 1, ip: '1.1.1.1' },
      { id: 'b', name: 'B', type: 'device', x: 'left', ip: '1.1.1.2' },
    ],
    edges: [['a']],
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 3);
});

test('坏 IP 与自连/重复连线不阻断导入（载入后由检查列出）', () => {
  const r = validateImport(JSON.stringify({
    nodes: [
      { id: 'a', name: 'A', type: 'router', x: 1, y: 1, ip: '999.1.1.1' },
      { id: 'b', name: 'B', type: 'device', x: 2, y: 2, ip: '1.1.1.2' },
    ],
    edges: [['a', 'b'], ['b', 'a'], ['a', 'a']],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.doc.edges.length, 3);
});

test('校验失败不返回 doc（调用方据此保留当前图）', () => {
  const r = validateImport('{"nodes":[],"edges":[[1,2]]}');
  assert.equal(r.ok, false);
  assert.equal(r.doc, undefined);
});

/* ------------------------------ 保存前问题检查 ----------------------------- */

test('检查重复连接（无向）与自连', () => {
  const d = {
    nodes: [
      { id: 'a', name: 'A', type: 'router', x: 0, y: 0, ip: '1.1.1.1' },
      { id: 'b', name: 'B', type: 'device', x: 0, y: 0, ip: '1.1.1.2' },
    ],
    edges: [['a', 'b'], ['b', 'a'], ['a', 'a']],
  };
  const p = inspectDoc(d);
  assert.equal(p.filter((x) => x.kind === 'duplicate').length, 2);
});

test('检查孤立节点', () => {
  const d = {
    nodes: [
      { id: 'a', name: 'A', type: 'router', x: 0, y: 0, ip: '1.1.1.1' },
      { id: 'b', name: 'B', type: 'device', x: 0, y: 0, ip: '1.1.1.2' },
    ],
    edges: [],
  };
  const p = inspectDoc(d);
  assert.deepEqual(p.filter((x) => x.kind === 'isolated').map((x) => x.nodeId).sort(), ['a', 'b']);
});

test('检查非法与重复 IP', () => {
  const d = {
    nodes: [
      { id: 'a', name: 'A', type: 'router', x: 0, y: 0, ip: '10.0.0.1' },
      { id: 'b', name: 'B', type: 'device', x: 0, y: 0, ip: '10.0.0.1' },
      { id: 'c', name: 'C', type: 'device', x: 0, y: 0, ip: 'abc' },
    ],
    edges: [['a', 'b'], ['a', 'c']],
  };
  const p = inspectDoc(d);
  assert.equal(p.filter((x) => x.kind === 'ip').length, 3, '两个重复 + 一个非法');
  assert.ok(p.some((x) => x.message.includes('abc')));
});

test('合法拓扑零问题', () => {
  assert.deepEqual(inspectDoc({
    nodes: [
      { id: 'a', name: 'A', type: 'router', x: 0, y: 0, ip: '10.0.0.1' },
      { id: 'b', name: 'B', type: 'device', x: 0, y: 0, ip: '10.0.0.2' },
    ],
    edges: [['a', 'b']],
  }), []);
});

test('edgeKey 无向相等且不被特殊 id 干扰', () => {
  assert.equal(edgeKey('a', 'b'), edgeKey('b', 'a'));
  assert.notEqual(edgeKey('a::b', 'c'), edgeKey('a', 'b::c'));
});
