/*
 * 拓扑编辑器的纯数据逻辑：历史模型、导入结构校验、编辑期问题检查。
 * 不依赖 React，可被界面与测试共同引用。
 */

/* --------------------------------- 基础 ---------------------------------- */

export const cloneDoc = (d) => ({
  nodes: d.nodes.map((n) => ({ ...n })),
  edges: d.edges.map((e) => [...e]),
});

export const emptyDoc = () => ({ nodes: [], edges: [] });

export const isValidIP = (ip) => {
  if (typeof ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim())) return false;
  return ip
    .trim()
    .split('.')
    .every((p) => Number(p) >= 0 && Number(p) <= 255);
};

// JSON.stringify 后排序拼接，任何 id 字符都不会产生键碰撞
export const edgeKey = (a, b) => [JSON.stringify(a), JSON.stringify(b)].sort().join('');

export const nameOf = (doc, id) => doc.nodes.find((n) => n.id === id)?.name || id;

export const newUid = (() => {
  let seq = 0;
  return (prefix = 'node') =>
    `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
})();

/* -------------------------------- 历史模型 -------------------------------- */
/* 节点操作与连线变化进入同一份历史；每个历史步都是一份完整文档快照，           */
/* 撤销/重做严格按操作顺序回放。拖拽与连续键入通过相同 token 合并为一步。       */

export const initHistory = (doc) => ({ past: [], present: cloneDoc(doc), future: [] });

export function historyReducer(state, action) {
  const { present } = state;
  // action.doc 可以是文档，也可以是基于最新 present 计算文档的 producer
  // （拖拽高频事件持有旧闭包时，producer 形式可避免基于陈旧快照重建）
  const resolve = (payload) =>
    typeof payload === 'function' ? payload(cloneDoc(present)) : payload;
  switch (action.type) {
    // 普通一步操作
    case 'commit': {
      return {
        past: [...state.past, { label: action.label, doc: present }].slice(-200),
        present: cloneDoc(resolve(action.doc)),
        future: [],
      };
    }
    // 连续编辑合并（拖拽移动、同一字段连续键入）
    case 'commit-coalesce': {
      const { token, label } = action;
      const last = state.past[state.past.length - 1];
      let past;
      if (last && last.token === token) {
        past = state.past.slice();
        past[past.length - 1] = { ...last, label };
      } else {
        past = [...state.past, { label, doc: present, token }].slice(-200);
      }
      return { past, present: cloneDoc(resolve(action.doc)), future: [] };
    }
    case 'undo': {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: cloneDoc(prev.doc),
        future: [{ label: prev.label, doc: present }, ...state.future].slice(0, 200),
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        past: [...state.past, { label: next.label, doc: present }].slice(-200),
        present: cloneDoc(next.doc),
        future: state.future.slice(1),
      };
    }
    // 载入合法文件：作为历史中的一步，导入之后仍可一路撤销回旧图
    case 'load':
      return {
        past: [...state.past, { label: action.label || '导入拓扑', doc: present }].slice(-200),
        present: cloneDoc(action.doc),
        future: [],
      };
    // 保存后重新起一段历史：基线更新为当前文档，撤销链清空
    case 'checkpoint':
      return { past: [], present, future: [] };
    default:
      return state;
  }
}

/* ------------------------------ 导入结构校验 ------------------------------ */
/* 硬性拒绝（坏文件保留当前图）：JSON 非法、顶层结构错、节点 id 缺失/重复、     */
/* 名称/类型/坐标非法、连线端点引用缺失或形态错误。                              */
/* 语义问题（坏 IP、自连、重复连接）不拒绝：合法载入后由问题面板列出。           */

export function validateImport(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, errors: ['文件不是合法的 JSON，无法解析'] };
  }

  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['顶层结构必须是包含 nodes 与 edges 的对象'] };
  }

  const { nodes, edges } = data;

  if (!Array.isArray(nodes)) {
    errors.push('缺少 nodes 数组（节点列表）');
  }
  if (!Array.isArray(edges)) {
    errors.push('缺少 edges 数组（连接列表）');
  }
  if (errors.length) return { ok: false, errors };

  const ids = new Set();
  const normalizedNodes = [];
  nodes.forEach((n, i) => {
    const where = `nodes[${i}]`;
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      errors.push(`${where} 不是对象`);
      return;
    }
    if (typeof n.id !== 'string' || !n.id.trim()) {
      errors.push(`${where} 缺少有效 id`);
    } else if (ids.has(n.id)) {
      errors.push(`${where} 节点 id 重复：“${n.id}”`);
    } else {
      ids.add(n.id);
    }
    if (typeof n.name !== 'string' || !n.name.trim()) {
      errors.push(`${where}（${n.id || '?'}）缺少设备名称`);
    }
    if (!['router', 'switch', 'server', 'device'].includes(n.type)) {
      errors.push(`${where}（${n.id || '?'}）设备类型非法：“${n.type}”`);
    }
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
      errors.push(`${where}（${n.id || '?'}）坐标 x/y 缺失或不是数字`);
    }
    if (typeof n.ip !== 'string') {
      // IP 缺失属于可编辑语义问题：允许载入，由检查面板列出，不拒绝整个文件
      n.ip = '';
    }
    normalizedNodes.push({
      id: n.id,
      name: String(n.name),
      type: n.type,
      x: n.x,
      y: n.y,
      ip: String(n.ip).trim(),
    });
  });

  const normalizedEdges = [];
  edges.forEach((e, i) => {
    const where = `edges[${i}]`;
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || typeof e[1] !== 'string') {
      errors.push(`${where} 必须是形如 ["a","b"] 的两个节点 id`);
      return;
    }
    const [a, b] = e;
    if (!ids.has(a) || !ids.has(b)) {
      errors.push(`${where} 引用了不存在的节点：“${!ids.has(a) ? a : b}”`);
      return;
    }
    // 自连与重复属于语义问题，不阻断导入，载入后由检查面板列出
    normalizedEdges.push([a, b]);
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, doc: { nodes: normalizedNodes, edges: normalizedEdges } };
}

/* ------------------------------ 编辑期问题检查 ----------------------------- */
/* 保存前检查三类问题：重复连接（含自连）、孤立节点、非法/重复地址。            */

export function inspectDoc(doc) {
  const problems = [];

  // 1. 重复连接（无向去重）与自连
  const seen = new Map();
  doc.edges.forEach(([a, b]) => {
    if (a === b) {
      problems.push({
        kind: 'duplicate',
        edgeKey: `${JSON.stringify(a)}${JSON.stringify(b)}`,
        message: `节点“${nameOf(doc, a)}”存在自连`,
      });
      return;
    }
    const k = edgeKey(a, b);
    if (seen.has(k)) {
      problems.push({
        kind: 'duplicate',
        edgeKey: k,
        message: `“${nameOf(doc, a)}”与“${nameOf(doc, b)}”之间存在重复连接`,
      });
    } else {
      seen.set(k, [a, b]);
    }
  });

  // 2. 孤立节点
  const linked = new Set(doc.edges.flat());
  doc.nodes.forEach((n) => {
    if (!linked.has(n.id)) {
      problems.push({
        kind: 'isolated',
        nodeId: n.id,
        message: `节点“${n.name}”（${n.id}）没有任何连接`,
      });
    }
  });

  // 3. 非法 / 重复 IP
  const ipOwners = new Map();
  doc.nodes.forEach((n) => {
    if (!isValidIP(n.ip)) {
      problems.push({
        kind: 'ip',
        nodeId: n.id,
        message: `节点“${n.name}”的 IP 地址非法：“${n.ip}”`,
      });
    } else {
      const key = n.ip.trim();
      if (!ipOwners.has(key)) ipOwners.set(key, []);
      ipOwners.get(key).push(n);
    }
  });
  ipOwners.forEach((list) => {
    if (list.length > 1) {
      list.forEach((n) =>
        problems.push({
          kind: 'ip',
          nodeId: n.id,
          message: `IP ${n.ip} 被 ${list.length} 个节点共用（含“${n.name}”）`,
        })
      );
    }
  });

  return problems;
}
