// 拓扑数据模型：种子数据、校验规则、导入归一化、导出

export const STORAGE_KEY = 'topology';
const SEP = String.fromCharCode(0); // 边的键分隔符，节点 id 不会包含空字符

export const NODE_TYPES = [
  { type: 'router', glyph: '◉', label: '路由器' },
  { type: 'switch', glyph: '▦', label: '交换机' },
  { type: 'server', glyph: '▣', label: '服务器' },
  { type: 'device', glyph: '▱', label: '终端设备' },
];

export const TYPE_LABEL = Object.fromEntries(NODE_TYPES.map((t) => [t.type, t.label]));

export const glyphOf = (type) => NODE_TYPES.find((t) => t.type === type)?.glyph ?? '▱';

export const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 200, ip: '10.0.0.1' },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 350, ip: '10.0.1.1' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 350, ip: '10.0.2.1' },
    { id: 'web', name: 'Web Server', type: 'server', x: 110, y: 500, ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 530, ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 510, ip: '10.0.2.22' },
  ],
  edges: [
    ['gw', 'sw1'],
    ['gw', 'sw2'],
    ['sw1', 'web'],
    ['sw1', 'db'],
    ['sw2', 'user'],
  ],
};

export const clone = (graph) => structuredClone(graph);

export const sameGraph = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const edgeId = (a, b) => [a, b].sort().join(SEP);
export const edgeKey = edgeId;
export const parseEdgeId = (id) => id.split(SEP);

export const hasEdge = (edges, a, b) =>
  edges.some(([x, y]) => edgeId(x, y) === edgeId(a, b));

// ---------- IPv4 校验 ----------
const OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
const IP_RE = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);

export const isValidIp = (value) =>
  typeof value === 'string' && IP_RE.test(value.trim());

// ---------- 当前图的语义校验（非阻塞，问题列在面板中） ----------
// level: error 需要确认后才能保存；warning 仅提示
export function validateGraph(graph) {
  const issues = [];
  const nameOf = (id) => graph.nodes.find((n) => n.id === id)?.name ?? id;

  // 1. 连接层面：悬空引用、自环、重复连接
  const seen = new Map();
  graph.edges.forEach(([a, b]) => {
    if (!graph.nodes.some((n) => n.id === a) || !graph.nodes.some((n) => n.id === b)) {
      const missing = !graph.nodes.some((n) => n.id === a) ? a : b;
      const other = graph.nodes.some((n) => n.id === a)
        ? a
        : graph.nodes.some((n) => n.id === b)
          ? b
          : null;
      issues.push({
        level: 'error',
        kind: 'dangling',
        nodeId: other,
        message: `连接引用了不存在的节点 “${missing}”`,
      });
      return;
    }
    if (a === b) {
      issues.push({
        level: 'error',
        kind: 'self',
        nodeId: a,
        message: `自环连接：${nameOf(a)} 连接到了自身`,
      });
      return;
    }
    const key = edgeId(a, b);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  seen.forEach((count, key) => {
    if (count > 1) {
      const [a, b] = parseEdgeId(key);
      issues.push({
        level: 'error',
        kind: 'duplicate',
        nodeId: a,
        message: `重复连接：${nameOf(a)} ↔ ${nameOf(b)} 出现了 ${count} 次`,
      });
    }
  });

  // 2. 孤立节点
  const linked = new Set(graph.edges.flat());
  graph.nodes.forEach((n) => {
    if (!linked.has(n.id)) {
      issues.push({
        level: 'warning',
        kind: 'isolated',
        nodeId: n.id,
        message: `孤立节点：${n.name}（${n.ip || '未配置 IP'}）没有任何连接`,
      });
    }
  });

  // 3. 非法地址
  graph.nodes.forEach((n) => {
    if (!isValidIp(n.ip)) {
      issues.push({
        level: 'error',
        kind: 'ip',
        nodeId: n.id,
        message: `非法地址：${n.name} 的 IP “${n.ip}” 不是合法的 IPv4 地址`,
      });
    }
  });

  return issues;
}

// ---------- 导入文件结构校验 ----------
// 硬错误（结构 / 节点引用）=> 拒绝载入，保留当前图；
// 语义问题（重复连接、孤立、非法 IP）载入后交给校验面板列出，不阻断。
export function normalizeImport(raw) {
  const errors = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      graph: null,
      errors: ['文件根结构必须是 JSON 对象，例如 { "nodes": [...], "edges": [...] }'],
    };
  }
  if (!Array.isArray(raw.nodes)) errors.push('缺少 nodes 数组（节点列表）');

  const nodes = [];
  const ids = new Set();
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];

  rawNodes.forEach((n, i) => {
    const where = `nodes[${i}]`;
    if (n === null || typeof n !== 'object' || Array.isArray(n)) {
      errors.push(`${where} 必须是设备对象`);
      return;
    }
    if (typeof n.id !== 'string' || !n.id.trim()) {
      errors.push(`${where} 缺少有效的字符串 id`);
      return;
    }
    const id = n.id.trim();
    if (ids.has(id)) {
      errors.push(`${where} 节点 id 重复：“${id}”`);
      return;
    }
    const name =
      typeof n.name === 'string' && n.name.trim() ? n.name : id;
    let type = 'device';
    if (n.type !== undefined) {
      if (!NODE_TYPES.some((t) => t.type === n.type)) {
        errors.push(`${where} 的设备类型 “${n.type}” 非法（router / switch / server / device）`);
        return;
      }
      type = n.type;
    }
    const x = n.x === undefined ? 420 + (i % 4) * 40 : n.x;
    const y = n.y === undefined ? 220 + (i % 4) * 40 : n.y;
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
      errors.push(`${where} 的坐标 x / y 必须是数字`);
      return;
    }
    if (typeof n.ip !== 'undefined' && typeof n.ip !== 'string') {
      errors.push(`${where} 的 ip 必须是字符串`);
      return;
    }
    ids.add(id);
    nodes.push({ id, name, type, x, y, ip: n.ip ?? '' });
  });

  const edges = [];
  if (raw.edges !== undefined && !Array.isArray(raw.edges)) {
    errors.push('edges 必须是数组（连接列表）');
  } else {
    (Array.isArray(raw.edges) ? raw.edges : []).forEach((e, i) => {
      let a;
      let b;
      if (Array.isArray(e) && e.length === 2) {
        [a, b] = e;
      } else if (e && typeof e === 'object' && !Array.isArray(e)) {
        a = e.source ?? e.from ?? e.a;
        b = e.target ?? e.to ?? e.b;
      } else {
        errors.push(`edges[${i}] 必须是 [起点 id, 终点 id] 形式`);
        return;
      }
      if (typeof a !== 'string' || typeof b !== 'string') {
        errors.push(`edges[${i}] 的两个端点必须是节点 id 字符串`);
        return;
      }
      if (!ids.has(a) || !ids.has(b)) {
        const missing = !ids.has(a) ? a : b;
        errors.push(`edges[${i}] 引用了不存在的节点 “${missing}”`);
        return;
      }
      edges.push([a, b]); // 重复 / 自环属于语义问题，保留并在校验面板列出
    });
  }

  // 硬错误时不返回半成品 graph，调用方只能继续使用当前图
  return { ok: errors.length === 0, graph: errors.length === 0 ? { nodes, edges } : null, errors };
}

export function loadInitialGraph() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { ok, graph } = normalizeImport(JSON.parse(raw));
      if (ok) return graph;
    }
  } catch {
    /* 损坏的本地数据回落到种子图 */
  }
  return clone(seed);
}

// ---------- 导出：与正在编辑的图逐字段对应 ----------
export function serializeGraph(graph) {
  return JSON.stringify(
    {
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
        ip: n.ip,
      })),
      edges: graph.edges.map(([a, b]) => [a, b]),
    },
    null,
    2,
  );
}

export function downloadGraph(graph, filename = 'network-topology.json') {
  const url = URL.createObjectURL(new Blob([serializeGraph(graph)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
