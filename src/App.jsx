import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Header from './components/Header';
import Toolbar from './components/Toolbar';
import Inventory from './components/Inventory';
import Canvas from './components/Canvas';
import Inspector from './components/Inspector';
import ProblemsPanel from './components/ProblemsPanel';
import ImportErrors from './components/ImportErrors';
import Toast from './components/Toast';
import { historyReducer, initialHistory } from './state/history';
import {
  clone,
  downloadGraph,
  edgeId,
  hasEdge,
  loadInitialGraph,
  normalizeImport,
  sameGraph,
  STORAGE_KEY,
  validateGraph,
} from './state/topology';

function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () =>
    initialHistory(loadInitialGraph()),
  );
  const graph = history.present;

  const [selected, setSelected] = useState(() => graph.nodes[0]?.id ?? null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [pendingFrom, setPendingFrom] = useState(null); // 连线模式起点
  const [panel, setPanel] = useState('closed'); // closed | open | confirm
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState(null);
  const [importErrors, setImportErrors] = useState(null);
  const fileRef = useRef(null);

  // 撤销 / 重做后，选中项可能已不存在，回落到第一个节点
  useEffect(() => {
    if (selected && !graph.nodes.some((n) => n.id === selected)) {
      setSelected(graph.nodes[0]?.id ?? null);
    }
    if (selectedEdge && !graph.edges.some(([a, b]) => edgeId(a, b) === selectedEdge)) {
      setSelectedEdge(null);
    }
  }, [graph, selected, selectedEdge]);

  // 保存基线只在“保存”动作后更新；未保存点据此判断
  const savedRef = useRef(clone(graph));
  const dirty = !sameGraph(savedRef.current, graph);

  const issues = useMemo(() => validateGraph(graph), [graph]);
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warningCount = issues.length - errorCount;

  const showToast = (text, kind = 'ok', ms = 2600) => {
    setToast({ text, kind });
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => setToast(null), ms);
  };

  // ---------- 编辑原语 ----------
  const commit = (next, label) => dispatch({ type: 'commit', label, graph: next });

  // ---------- 节点 ----------
  const addNode = (type = 'device') => {
    const id = `node_${Date.now().toString(36)}${Math.floor(Math.random() * 900 + 100)}`;
    const node = {
      id,
      name: { router: '新路由器', switch: '新交换机', server: '新服务器', device: '新终端' }[type],
      type,
      x: 420 + (graph.nodes.length % 5) * 28,
      y: 240 + (graph.nodes.length % 5) * 24,
      ip: '',
    };
    commit({ nodes: [...graph.nodes, node], edges: graph.edges }, `添加 ${node.name}`);
    setSelected(id);
    setSelectedEdge(null);
    setPendingFrom(null);
    showToast(`已添加「${node.name}」，可继续撤销`);
  };

  const removeNode = (id) => {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    const attached = graph.edges.filter(([a, b]) => a === id || b === id).length;
    commit(
      {
        nodes: graph.nodes.filter((n) => n.id !== id),
        edges: graph.edges.filter(([a, b]) => a !== id && b !== id),
      },
      attached ? `删除 ${node.name} 及其 ${attached} 条连接` : `删除 ${node.name}`,
    );
    if (selected === id) setSelected(graph.nodes.find((n) => n.id !== id)?.id ?? null);
    setSelectedEdge(null);
    showToast('设备已删除，可撤销恢复');
  };

  // 拖拽：按下时留存操作前快照，移动走 live，抬起时一次提交
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const dragRef = useRef(null);
  const startDrag = (id, e, rect, zoom = 1) => {
    if (pendingFromRef.current) return; // 连线模式下点击用于选择对端，不拖动
    e.preventDefault();
    const startGraph = graphRef.current;
    const node = startGraph.nodes.find((n) => n.id === id);
    dragRef.current = {
      id,
      // 画布经过缩放，把屏幕位移换算成未缩放坐标系下的位移
      offsetX: (e.clientX - rect.left) / zoom - node.x,
      offsetY: (e.clientY - rect.top) / zoom - node.y,
      prev: clone(startGraph),
      moved: false,
    };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const x = Math.min(
        Math.max((ev.clientX - rect.left) / zoom - d.offsetX, 20),
        rect.width / zoom - 20,
      );
      const y = Math.min(
        Math.max((ev.clientY - rect.top) / zoom - d.offsetY, 16),
        rect.height / zoom - 16,
      );
      d.moved = true;
      dispatch({
        type: 'live',
        graph: {
          ...graphRef.current,
          nodes: graphRef.current.nodes.map((n) => (n.id === d.id ? { ...n, x, y } : n)),
        },
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const d = dragRef.current;
      dragRef.current = null;
      if (!d || !d.moved) return;
      dispatch({
        type: 'commit',
        label: `移动 ${node.name}`,
        prev: d.prev,
        graph: graphRef.current,
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const pendingFromRef = useRef(null);
  pendingFromRef.current = pendingFrom;

  // 属性面板的字段编辑：输入中实时显示，失焦/回车时入一次历史
  const patchNode = (id, patch, label) => {
    const prev = clone(graph);
    const next = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    };
    commit(next, label);
  };

  // ---------- 连线 ----------
  const startConnect = (id) => {
    setSelected(id);
    setSelectedEdge(null);
    setPendingFrom(id);
    showToast('连线模式：点击画布上的另一个设备完成连接（Esc 取消）', 'info', 3200);
  };

  const connectTo = (targetId) => {
    const from = pendingFrom;
    if (!from || targetId === from) return;
    if (hasEdge(graph.edges, from, targetId)) {
      showToast('这两个设备之间已经存在连接', 'warn');
      return;
    }
    const n1 = graph.nodes.find((n) => n.id === from);
    const n2 = graph.nodes.find((n) => n.id === targetId);
    commit(
      { nodes: graph.nodes, edges: [...graph.edges, [from, targetId]] },
      `连接 ${n1?.name ?? from} 与 ${n2?.name ?? targetId}`,
    );
    showToast('连接已创建');
    setPendingFrom(null);
  };

  const removeEdgeById = (id) => {
    const [a, b] = id.split(String.fromCharCode(0));
    removeEdge(a, b);
  };

  const removeEdge = (a, b) => {
    const n1 = graph.nodes.find((n) => n.id === a)?.name ?? a;
    const n2 = graph.nodes.find((n) => n.id === b)?.name ?? b;
    commit(
      { nodes: graph.nodes, edges: graph.edges.filter(([x, y]) => edgeId(x, y) !== edgeId(a, b)) },
      `删除连接 ${n1} ↔ ${n2}`,
    );
    setSelectedEdge(null);
    showToast('连接已删除，可撤销恢复');
  };

  // ---------- 撤销 / 重做 ----------
  const undo = () => dispatch({ type: 'undo' });
  const redo = () => dispatch({ type: 'redo' });
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // 点击历史条目：按顺序回放（多次 undo / redo）跳到该位置
  const jumpPast = (index) => dispatch({ type: 'jumpPast', index });
  const jumpFuture = (index) => dispatch({ type: 'jumpFuture', index });

  // ---------- 保存：先检查，问题列出但编辑不受影响 ----------
  const requestSave = () => {
    if (issues.length === 0) {
      doSave();
    } else {
      setPanel('confirm');
    }
  };

  const doSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
    savedRef.current = clone(graph);
    dispatch({ type: 'checkpoint' }); // 保存后重新起一段历史
    setPanel('closed');
    showToast('已保存：导出内容与当前图一致，并已开启新的历史段');
  };

  // ---------- 导入：先核对结构与引用，坏文件保留当前图 ----------
  const onImportFile = (file) => {
    fileRef.current.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        setImportErrors({
          file: file.name,
          errors: ['文件不是合法的 JSON，无法解析'],
        });
        showToast('导入失败：文件无法解析，当前拓扑保持不变', 'error', 3600);
        return;
      }
      const { ok, graph: imported, errors } = normalizeImport(parsed);
      if (!ok) {
        setImportErrors({ file: file.name, errors });
        showToast('导入失败：结构或节点引用有误，当前拓扑保持不变', 'error', 3600);
        return;
      }
      commit(imported, `导入 ${file.name}`); // 合法文件作为一次操作入栈，仍可撤销回旧图
      setSelected(imported.nodes[0]?.id ?? null);
      setSelectedEdge(null);
      setPendingFrom(null);
      const semantic = validateGraph(imported);
      setPanel(semantic.length ? 'open' : 'closed');
      showToast(
        semantic.length
          ? `已导入：${semantic.length} 个待处理问题已列出，可继续编辑或撤销`
          : '导入成功，可继续编辑或撤销回原拓扑',
        semantic.length ? 'warn' : 'ok',
        3600,
      );
    };
    reader.readAsText(file);
  };

  const runCheck = () => {
    setPanel('open');
    showToast(
      issues.length
        ? `检查完成：${errorCount} 个错误，${warningCount} 个警告（编辑不受影响）`
        : '拓扑检查通过：连接、节点与地址均无问题',
      issues.length ? 'warn' : 'ok',
    );
  };

  const exportJson = () => {
    downloadGraph(graph);
    showToast('已导出：内容与正在编辑的拓扑完全对应');
  };

  // ---------- 快捷键 ----------
  const keyHandlers = useRef({});
  keyHandlers.current = {
    undo,
    redo,
    canUndo,
    canRedo,
    pendingFrom,
    cancelConnect: () => setPendingFrom(null),
    removeSelected: (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      if (selectedEdge) removeEdgeById(selectedEdge);
      else if (selected) removeNode(selected);
    },
  };
  useEffect(() => {
    const onKey = (e) => {
      const h = keyHandlers.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        h.undo();
      } else if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        h.redo();
      } else if (e.key === 'Escape') {
        h.cancelConnect();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        h.removeSelected(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectNode = (id) => {
    if (pendingFrom) {
      connectTo(id);
      return;
    }
    setSelected(id);
    setSelectedEdge(null);
  };

  return (
    <div className="app">
      <Header
        dirty={dirty}
        canUndo={canUndo}
        canRedo={canRedo}
        pastCount={history.past.length}
        onUndo={undo}
        onRedo={redo}
        onCheck={runCheck}
        onImport={() => fileRef.current.click()}
        onExport={exportJson}
        onSave={requestSave}
        issueCount={issues.length}
        errorCount={errorCount}
        historyPast={history.past}
        historyFuture={history.future}
        onJumpPast={jumpPast}
        onJumpFuture={jumpFuture}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => onImportFile(e.target.files?.[0])}
      />

      <Toolbar zoom={zoom} setZoom={setZoom} />

      <div className="workspace">
        <Inventory nodes={graph.nodes} selected={selected} onSelect={selectNode} onAdd={addNode} />

        <Canvas
          graph={graph}
          selected={selected}
          selectedEdge={selectedEdge}
          pendingFrom={pendingFrom}
          zoom={zoom}
          onSelectNode={selectNode}
          onSelectEdge={setSelectedEdge}
          onRemoveEdge={removeEdge}
          onNodeMouseDown={startDrag}
          onCancelConnect={() => setPendingFrom(null)}
        />

        <Inspector
          node={graph.nodes.find((n) => n.id === selected) ?? null}
          graph={graph}
          selectedEdge={selectedEdge}
          onPatch={patchNode}
          onRemoveNode={removeNode}
          onRemoveEdge={removeEdgeById}
          onConnect={startConnect}
          connecting={!!pendingFrom}
        />
      </div>

      <ProblemsPanel
        state={panel}
        issues={issues}
        errorCount={errorCount}
        warningCount={warningCount}
        onClose={() => setPanel('closed')}
        onSelect={(nodeId) => nodeId && setSelected(nodeId)}
        onForceSave={doSave}
        onBackEdit={() => setPanel('open')}
      />

      {importErrors && (
        <ImportErrors
          file={importErrors.file}
          errors={importErrors.errors}
          onClose={() => setImportErrors(null)}
        />
      )}
      {toast && <Toast text={toast.text} kind={toast.kind} />}
    </div>
  );
}

export default App;
