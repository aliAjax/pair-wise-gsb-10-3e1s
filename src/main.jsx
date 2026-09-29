import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import {
  cloneDoc,
  edgeKey,
  historyReducer,
  initHistory,
  inspectDoc,
  isValidIP,
  nameOf,
  newUid,
  validateImport,
} from './topology-model.js';

/* ------------------------------ 常量 / 工具 ------------------------------ */

const STORAGE_KEY = 'topology';
const DOC_VERSION = 1;
const NODE_TYPES = [
  ['router', '◉', '路由器'],
  ['switch', '▦', '交换机'],
  ['server', '▣', '服务器'],
  ['device', '▱', '终端设备'],
];
const TYPE_ICON = (t) =>
  t === 'router' ? '◉' : t === 'switch' ? '▦' : t === 'server' ? '▣' : '▱';
const TYPE_NAME = (t) =>
  ({ router: '路由器', switch: '交换机', server: '服务器', device: '终端设备' }[t] || t);

const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 220, ip: '10.0.0.1' },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 370, ip: '10.0.1.1' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 370, ip: '10.0.2.1' },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 520, ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 550, ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 530, ip: '10.0.2.22' },
  ],
  edges: [
    ['gw', 'sw1'],
    ['gw', 'sw2'],
    ['sw1', 'web'],
    ['sw1', 'db'],
    ['sw2', 'user'],
  ],
};

/* -------------------------------- 主组件 -------------------------------- */

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        const result = validateImport(JSON.stringify(parsed));
        if (result.ok) return result.doc;
      }
    }
  } catch {
    /* 落盘损坏时回落到内置示例 */
  }
  return cloneDoc(seed);
}

export function App() {
  const [hist, dispatch] = useReducer(historyReducer, undefined, () =>
    initHistory(loadInitial())
  );
  const data = hist.present;

  const [selected, setSelected] = useState(() => data.nodes[0]?.id ?? null);
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState(null); // {id, token}
  const [showProblems, setShowProblems] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(() =>
    localStorage.getItem(STORAGE_KEY) ? Date.now() : null
  );

  const boardRef = useRef(null);
  const fileInputRef = useRef(null);
  const editTimers = useRef(new Map());
  const dataRef = useRef(data);
  dataRef.current = data;
  const histRef = useRef(hist);
  histRef.current = hist;
  const selectRef = useRef(selected);
  selectRef.current = selected;

  const node = data.nodes.find((n) => n.id === selected) || null;

  const flash = (msg) => {
    setNotice(msg);
    window.clearTimeout(flash._t);
    flash._t = window.setTimeout(() => setNotice(''), 2600);
  };

  /* ------------------------------ 基础编辑 ------------------------------ */

  // producer 接收一份最新 present 的深拷贝，直接在其上修改并返回
  const commit = (label, producer) => {
    dispatch({ type: 'commit', label, doc: producer });
    setDirty(true);
  };

  const coalesce = (token, label, producer) => {
    dispatch({ type: 'commit-coalesce', token, label, doc: producer });
    setDirty(true);
  };

  const addNode = (type = 'device', labelName = '新设备') => {
    const id = newUid();
    commit('添加设备', (d) => {
      d.nodes.push({
        id,
        name: labelName,
        type,
        x: 120 + Math.random() * 560,
        y: 120 + Math.random() * 320,
        ip: '192.168.0.10',
      });
      return d;
    });
    setSelected(id);
    flash('已添加设备，可在右侧编辑属性');
  };

  const editNonces = useRef(new Map());

  const patchNode = (id, patch) => {
    const field = Object.keys(patch)[0];
    const key = `${id}:${field}`;
    // 同一字段连续键入（800ms 内）共用 nonce，合并为一个历史步；停顿后 nonce 轮换，算新的一步
    if (!editNonces.current.has(key)) editNonces.current.set(key, 0);
    const nonce = editNonces.current.get(key);
    clearTimeout(editTimers.current.get(key));
    editTimers.current.set(
      key,
      setTimeout(() => editNonces.current.set(key, nonce + 1), 800)
    );
    const token = `edit:${key}#${nonce}`;
    coalesce(token, `修改${fieldLabel(field)}`, (d) => {
      const target = d.nodes.find((n) => n.id === id);
      if (target) Object.assign(target, patch);
      return d;
    });
  };

  const fieldLabel = (f) =>
    ({ name: '设备名称', ip: 'IP 地址', type: '设备类型', x: '节点位置', y: '节点位置' }[f] || '属性');

  const removeNode = (id) => {
    const target = data.nodes.find((n) => n.id === id);
    if (!target) return;
    commit(`删除设备“${target.name}”`, (d) => {
      d.nodes = d.nodes.filter((n) => n.id !== id);
      d.edges = d.edges.filter(([a, b]) => a !== id && b !== id);
      return d;
    });
    const rest = data.nodes.filter((n) => n.id !== id);
    setSelected(rest[0]?.id ?? null);
    flash(`已删除设备“${target.name}”，可撤销恢复`);
  };

  const addEdge = (a, b) => {
    if (a === b) {
      flash('不能连接设备自身');
      return false;
    }
    if (data.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) {
      flash('这两台设备之间已经存在连接');
      return false;
    }
    commit(
      `连接“${nameOf(data, a)}”与“${nameOf(data, b)}”`,
      (d) => ({ ...d, edges: [...d.edges, [a, b]] })
    );
    return true;
  };

  // 按序号删除单条边：存在重复连接时只删被点中的那一条
  const removeEdgeAt = (index) => {
    const e = data.edges[index];
    if (!e) return;
    commit(`删除连接“${nameOf(data, e[0])}–${nameOf(data, e[1])}”`, (d) => ({
      ...d,
      edges: d.edges.filter((_, i) => i !== index),
    }));
    flash('连接已删除，可撤销恢复');
  };

  /* -------------------------------- 拖动 -------------------------------- */

  const onNodeMouseDown = (e, id) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(id);
    setDrag({ id, token: `move:${id}:${Date.now()}` });
  };

  useEffect(() => {
    if (!drag) return undefined;
    const board = boardRef.current;
    const { id, token } = drag;

    const onMove = (e) => {
      const r = board.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width - 84, e.clientX - r.left));
      const y = Math.max(0, Math.min(r.height - 62, e.clientY - r.top));
      const cur = dataRef.current.nodes.find((n) => n.id === id);
      if (cur && cur.x === Math.round(x) && cur.y === Math.round(y)) return;
      coalesce(token, '拖动节点', (d) => {
        const t = d.nodes.find((n) => n.id === id);
        if (t) {
          t.x = Math.round(x);
          t.y = Math.round(y);
        }
        return d;
      });
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.token]);

  /* --------------------------- 撤销 / 重做快捷键 -------------------------- */

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        const wantRedo = e.shiftKey || e.key.toLowerCase() === 'y';
        const canMove = wantRedo ? histRef.current.future.length : histRef.current.past.length;
        if (!canMove) return; // 交给输入框做原生撤销
        e.preventDefault();
        if (typing) e.target.blur(); // 先失焦，避免随后输入框用旧 state 覆盖回来
        dispatch({ type: wantRedo ? 'redo' : 'undo' });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selectRef.current) {
        e.preventDefault();
        removeNode(selectRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 撤销/重做后保持选中节点有效
  useEffect(() => {
    if (selected && !data.nodes.some((n) => n.id === selected)) {
      setSelected(data.nodes[0]?.id ?? null);
    }
  }, [data, selected]);

  /* ------------------------------ 检查 / 保存 ----------------------------- */

  const runInspect = useCallback(() => inspectDoc(data), [data]);

  const openProblems = () => {
    setImportErrors([]);
    setShowProblems(true);
  };

  const save = (force = false) => {
    const found = inspectDoc(data);
    if (found.length && !force) {
      setImportErrors([]);
      setShowProblems(true);
      flash(`检查发现 ${found.length} 个问题，确认后仍可保存`);
      return;
    }
    const payload = JSON.stringify({
      meta: {
        app: 'netscape-topology-studio',
        version: DOC_VERSION,
        savedAt: new Date().toISOString(),
      },
      ...cloneDoc(data),
    });
    localStorage.setItem(STORAGE_KEY, payload);
    setDirty(false);
    setSavedAt(Date.now());
    dispatch({ type: 'checkpoint' }); // 保存后重新起一段历史
    setShowProblems(false);
    flash(found.length ? `已强制保存（忽略 ${found.length} 个问题），历史已重置` : '拓扑已保存，历史已从当前状态重新开始');
  };

  /* -------------------------------- 导入 -------------------------------- */

  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = validateImport(String(reader.result || ''));
      if (!result.ok) {
        // 坏文件：保留当前图，历史原封不动
        setImportErrors(result.errors);
        setShowProblems(true);
        flash(`导入失败：${result.errors.length} 处结构问题，当前拓扑未改动`);
        return;
      }
      // 语义问题（重复/孤立/非法地址）不阻断载入，载入后列出
      const soft = inspectDoc(result.doc);
      dispatch({ type: 'load', label: `导入“${file.name}”`, doc: result.doc });
      setDirty(true);
      setSelected(result.doc.nodes[0]?.id ?? null);
      setImportErrors([]);
      setShowProblems(true);
      flash(
        soft.length
          ? `已导入 ${result.doc.nodes.length} 个节点，发现 ${soft.length} 个待处理问题；可撤销回到导入前`
          : `已导入 ${result.doc.nodes.length} 个节点，可撤销回到导入前`
      );
    };
    reader.onerror = () => flash('文件读取失败，当前拓扑未改动');
    reader.readAsText(file);
  };

  /* -------------------------------- 导出 -------------------------------- */

  const exportJson = () => {
    const payload = JSON.stringify(
      {
        meta: {
          app: 'netscape-topology-studio',
          version: DOC_VERSION,
          exportedAt: new Date().toISOString(),
        },
        ...cloneDoc(data), // 导出内容与正在编辑的 present 完全对应
      },
      null,
      2
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    a.download = 'network-topology.json';
    a.click();
    URL.revokeObjectURL(a.href);
    flash('已导出当前编辑中的拓扑');
  };

  /* ------------------------------ 连接交互 ------------------------------- */

  const [linkPick, setLinkPick] = useState(null); // 第一跳节点 id
  const beginLink = () => {
    if (!node) {
      flash('请先选择一个设备');
      return;
    }
    setLinkPick(node.id);
    flash('在画布上点击要连接的另一台设备（Esc 取消）');
  };

  useEffect(() => {
    if (!linkPick) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setLinkPick(null);
        flash('已取消连接');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkPick]);

  const onCanvasNodeClick = (id) => {
    if (linkPick && id !== linkPick) {
      addEdge(linkPick, id);
      setLinkPick(null);
    } else if (linkPick && id === linkPick) {
      flash('不能连接设备自身，请选择另一台设备');
    }
    setSelected(id);
  };

  /* -------------------------------- 渲染 -------------------------------- */

  const undo = () => dispatch({ type: 'undo' });
  const redo = () => dispatch({ type: 'redo' });
  const lastAction = hist.past[hist.past.length - 1]?.label;
  const nextAction = hist.future[0]?.label;
  // 面板打开期间实时重算：问题列出后继续编辑，列表随编辑实时变化且不阻断任何操作
  const liveProblems = showProblems ? runInspect() : [];
  const dupKeys = useMemo(() => {
    const s = new Set();
    liveProblems
      .filter((p) => p.kind === 'duplicate')
      .forEach((p) => {
        // 同一无向 key 出现的所有连线都高亮（含被判定重复的那几条）
        s.add(p.edgeKey);
      });
    return s;
  }, [liveProblems]);
  const problemNodeIds = useMemo(
    () => new Set(liveProblems.filter((p) => p.nodeId).map((p) => p.nodeId)),
    [liveProblems]
  );

  const degree = (id) => data.edges.filter(([a, b]) => a === id || b === id).length;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <div>
            <strong>NETSCAPE</strong>
            <small>TOPOLOGY STUDIO</small>
          </div>
        </div>
        <div className="file">
          <span className={`dot ${dirty ? 'dirty' : ''}`}></span>
          <div>
            <strong>
              office-network.json{dirty ? '（有未保存更改）' : ''}
            </strong>
            <small>
              {savedAt
                ? `最近保存：${new Date(savedAt).toLocaleTimeString('zh-CN')}`
                : '尚未保存到本地'}
            </small>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={openProblems} className={showProblems && liveProblems.length ? 'has-warn' : ''}>
            ✓ 检查
          </button>
          <button onClick={() => fileInputRef.current?.click()}>↑ 导入</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={onImportFile}
          />
          <button onClick={exportJson}>↓ 导出</button>
          <button className="save" onClick={() => save(false)}>
            保存更改
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <span>历史</span>
          <button
            onClick={undo}
            disabled={!hist.past.length}
            title={lastAction ? `撤销：${lastAction}` : '没有可撤销的操作'}
          >
            ↶ 撤销
          </button>
          <button
            onClick={redo}
            disabled={!hist.future.length}
            title={nextAction ? `重做：${nextAction}` : '没有可重做的操作'}
          >
            ↷ 重做
          </button>
          <small className="hist-pos">
            第 {hist.past.length + 1} 步{hist.past.length + hist.future.length > 0 ?
              ` / 共 ${hist.past.length + hist.future.length + 1} 步` : ''}
          </small>
        </div>
        <div className="tool-group">
          <span>操作</span>
          <button
            className={linkPick ? 'on' : ''}
            onClick={beginLink}
            disabled={!node}
          >
            ⌁ {linkPick ? '选择对端…' : '连接'}
          </button>
          <button onClick={() => addNode('device', '新设备')}>＋ 设备</button>
          <button
            className="danger-text"
            onClick={() => selected && removeNode(selected)}
            disabled={!node}
          >
            🗑 删除
          </button>
        </div>
      </div>

      <div className="workspace">
        <aside className="inventory">
          <div className="section-title">
            <span>设备库</span>
            <small>{data.nodes.length} 个节点</small>
          </div>
          <div className="device-types">
            {NODE_TYPES.map(([t, icon, label]) => (
              <button onClick={() => addNode(t, label)} key={t}>
                <i className={t}>{icon}</i>
                {label}
                <span>＋</span>
              </button>
            ))}
          </div>
          <div className="section-title nodes-head">
            <span>图中节点</span>
            <small>点击查看</small>
          </div>
          <div className="node-list">
            {data.nodes.map((n) => (
              <button
                className={selected === n.id ? 'sel' : ''}
                onClick={() => onCanvasNodeClick(n.id)}
                key={n.id}
              >
                <i className={n.type}>{TYPE_ICON(n.type)}</i>
                <span>
                  <strong>{n.name}</strong>
                  <small>{n.ip}</small>
                </span>
                <b>{degree(n.id)}</b>
              </button>
            ))}
            {!data.nodes.length && <p className="empty-hint">画布为空，从设备库添加</p>}
          </div>
        </aside>

        <section className="canvas-wrap">
          <div
            ref={boardRef}
            className={`canvas ${linkPick ? 'linking' : ''}`}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setLinkPick(null);
            }}
          >
            {data.edges.map(([a, b], i) => {
              const n1 = data.nodes.find((n) => n.id === a);
              const n2 = data.nodes.find((n) => n.id === b);
              if (!n1 || !n2) return null;
              const dx = n2.x - n1.x;
              const dy = n2.y - n1.y;
              const len = Math.hypot(dx, dy);
              const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
              const k = edgeKey(a, b);
              return (
                <div
                  className={`edge ${dupKeys.has(k) ? 'bad' : ''}`}
                  key={`${k}-${i}`}
                  style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}
                  onDoubleClick={() => removeEdgeAt(i)}
                  title="双击删除该连接"
                >
                  <span></span>
                </div>
              );
            })}
            {data.nodes.map((n) => (
              <button
                className={
                  'node ' +
                  n.type +
                  (selected === n.id ? ' picked' : '') +
                  (linkPick === n.id ? ' link-src' : '') +
                  (linkPick && linkPick !== n.id ? ' link-target' : '') +
                  (problemNodeIds.has(n.id) ? ' has-issue' : '')
                }
                style={{ left: n.x - 42, top: n.y - 31 }}
                onMouseDown={(e) => onNodeMouseDown(e, n.id)}
                onClick={() => onCanvasNodeClick(n.id)}
                key={n.id}
              >
                <i>{TYPE_ICON(n.type)}</i>
                <strong>{n.name}</strong>
                <small>{n.ip}</small>
                {problemNodeIds.has(n.id) && <em className="issue-dot" title="存在待处理问题">!</em>}
              </button>
            ))}
            {!data.nodes.length && (
              <div className="canvas-empty">
                空白拓扑 · 从左侧设备库添加节点，或导入 JSON 文件
              </div>
            )}
            <div className="legend">
              <span><i className="router"></i>路由器</span>
              <span><i className="switch"></i>交换机</span>
              <span><i className="server"></i>服务器</span>
              <span><i className="device"></i>终端</span>
            </div>
            {linkPick && <div className="link-banner">连接模式：点击另一台设备完成连线，Esc 取消</div>}
          </div>
          <div className="canvas-footer">
            <span>
              拖动节点调整位置 · 双击连线可删除 · {data.edges.length} 条连接
            </span>
            <span>
              {lastAction ? `上一步：${lastAction}` : '当前为已保存状态'}
              {nextAction ? ` · 下一步：${nextAction}` : ''}
            </span>
          </div>
        </section>

        <aside className="inspector">
          <div className="section-title">
            <span>属性</span>
            <small>{node ? TYPE_NAME(node.type) : '未选择'}</small>
          </div>
          {node ? (
            <>
              <label>
                设备名称
                <input
                  value={node.name}
                  onChange={(e) => patchNode(node.id, { name: e.target.value })}
                />
              </label>
              <label className={!isValidIP(node.ip) ? 'field-error' : ''}>
                IP 地址
                <input
                  value={node.ip}
                  onChange={(e) => patchNode(node.id, { ip: e.target.value })}
                />
                {!isValidIP(node.ip) && <small className="err-text">IPv4 格式非法，检查时会列出</small>}
              </label>
              <label>
                设备类型
                <select
                  value={node.type}
                  onChange={(e) => patchNode(node.id, { type: e.target.value })}
                >
                  <option value="router">路由器</option>
                  <option value="switch">交换机</option>
                  <option value="server">服务器</option>
                  <option value="device">终端设备</option>
                </select>
              </label>
              <div className="inspector-actions">
                <button onClick={beginLink}>⌁ 添加连接</button>
                <button className="danger" onClick={() => removeNode(node.id)}>
                  删除设备
                </button>
              </div>
              <div className="connections">
                <div className="section-title">
                  <span>连接（{degree(node.id)}）</span>
                  <small>双击条目删除</small>
                </div>
                {data.edges
                  .map(([a, b], i) => ({ a, b, i }))
                  .filter(({ a, b }) => a === node.id || b === node.id)
                  .map(({ a, b, i }) => {
                    const otherId = a === node.id ? b : a;
                    const other = data.nodes.find((x) => x.id === otherId);
                    const k = edgeKey(a, b);
                    return (
                      <div
                        className={`connection ${dupKeys.has(k) ? 'dup' : ''}`}
                        key={i}
                        onDoubleClick={() => removeEdgeAt(i)}
                        title="双击删除该连接"
                      >
                        <span className={`mini ${other?.type || ''}`}></span>
                        <strong>{other?.name || otherId}</strong>
                        <small>双击删除</small>
                      </div>
                    );
                  })}
                {!degree(node.id) && <p className="empty-hint">该节点尚无连接（孤立）</p>}
              </div>
            </>
          ) : (
            <p className="empty-hint" style={{ padding: 20 }}>
              选择一个设备查看属性
            </p>
          )}
        </aside>
      </div>

      {/* 问题面板：列出问题但不阻断编辑，面板打开时画布仍可随意操作 */}
      {showProblems && (
        <div className="problem-dock">
          <div className="problem-head">
            <div>
              <strong>{importErrors.length ? '导入被拒绝' : '拓扑检查'}</strong>
              <small>
                {importErrors.length
                  ? `${importErrors.length} 处结构问题 · 当前拓扑与历史均未改动`
                  : liveProblems.length
                    ? `${liveProblems.length} 个问题 · 编辑不受影响，修改后列表实时更新`
                    : '没有发现重复连接、孤立节点或非法地址'}
              </small>
            </div>
            <div className="problem-actions">
              {!importErrors.length && liveProblems.some((p) => p.kind === 'duplicate') && (
                <button
                  onClick={() => {
                    // 每个无向连接对只保留第一条；自连全部移除
                    const keep = new Set();
                    let dropped = 0;
                    const nextEdges = [];
                    data.edges.forEach(([a, b], idx) => {
                      if (a === b) {
                        dropped += 1;
                        return;
                      }
                      const k = edgeKey(a, b);
                      if (keep.has(k)) {
                        dropped += 1;
                        return;
                      }
                      keep.add(k);
                      nextEdges.push([a, b]);
                    });
                    if (dropped) {
                      commit('清理重复连接与自连', (d) => ({ ...d, edges: nextEdges }));
                      flash(`已清理 ${dropped} 条重复/自连，可撤销`);
                    }
                  }}
                >
                  一键清理重复连接
                </button>
              )}
              <button onClick={() => setShowProblems(false)}>收起</button>
              {!importErrors.length && liveProblems.length > 0 && (
                <button className="save" onClick={() => save(true)}>
                  仍要保存
                </button>
              )}
            </div>
          </div>
          {(importErrors.length > 0 || liveProblems.length > 0) && (
            <ul className="problem-list">
              {importErrors.map((message, i) => (
                <li key={`imp-${i}`} className="prob-import">
                  <span className="prob-tag">文件结构</span>
                  <span className="prob-msg">{message}</span>
                </li>
              ))}
              {liveProblems.map((p, i) => (
                <li
                  key={i}
                  className={`prob-${p.kind}`}
                  onClick={() => p.nodeId && setSelected(p.nodeId)}
                  style={p.nodeId ? { cursor: 'pointer' } : undefined}
                >
                  <span className="prob-tag">
                    {p.kind === 'duplicate' ? '重复连接' :
                     p.kind === 'isolated' ? '孤立节点' : '地址问题'}
                  </span>
                  <span className="prob-msg">{p.message}</span>
                  {p.nodeId && <em className="prob-goto">定位 →</em>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

if (typeof document !== 'undefined' && document.getElementById('root')) {
  createRoot(document.getElementById('root')).render(<App />);
}
