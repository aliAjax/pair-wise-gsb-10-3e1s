import React, { useEffect, useRef, useState } from 'react';
import { edgeId, glyphOf, TYPE_LABEL } from '../state/topology';

// 输入中实时刷新画布，失焦或回车时把整次编辑作为一条历史提交
function NodeField({ label, value, onCommit, as, typeOptions }) {
  const [text, setText] = useState(value);
  const escaped = useRef(false);
  useEffect(() => {
    setText(value);
    escaped.current = false;
  }, [value]);

  const common = {
    onBlur: () => {
      if (escaped.current) return;
      if (text !== value) onCommit(text);
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter') e.target.blur();
      if (e.key === 'Escape') {
        escaped.current = true;
        setText(value);
        e.target.blur();
      }
    },
  };

  return (
    <label>
      {label}
      {as === 'select' ? (
        <select value={text} onChange={(e) => onCommit(e.target.value)}>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
      ) : (
        <input value={text} onChange={(e) => setText(e.target.value)} {...common} />
      )}
    </label>
  );
}

export default function Inspector({
  node,
  graph,
  selectedEdge,
  onPatch,
  onRemoveNode,
  onRemoveEdge,
  onConnect,
  connecting,
}) {
  const edgeInfo = selectedEdge
    ? (() => {
        const [a, b] = selectedEdge.split(String.fromCharCode(0));
        const n1 = graph.nodes.find((n) => n.id === a);
        const n2 = graph.nodes.find((n) => n.id === b);
        return { a, b, n1, n2 };
      })()
    : null;

  return (
    <aside className="inspector">
      {edgeInfo ? (
        <>
          <div className="section-title">
            <span>连接</span>
            <small>edge</small>
          </div>
          <div className="edge-detail">
            <div className="edge-endpoint">
              <i className={edgeInfo.n1?.type}>{glyphOf(edgeInfo.n1?.type)}</i>
              <div>
                <strong>{edgeInfo.n1?.name ?? edgeInfo.a}</strong>
                <small>{edgeInfo.n1?.ip ?? '缺失节点'}</small>
              </div>
            </div>
            <div className="edge-link-mark">⇄</div>
            <div className="edge-endpoint">
              <i className={edgeInfo.n2?.type}>{glyphOf(edgeInfo.n2?.type)}</i>
              <div>
                <strong>{edgeInfo.n2?.name ?? edgeInfo.b}</strong>
                <small>{edgeInfo.n2?.ip ?? '缺失节点'}</small>
              </div>
            </div>
            <div className="inspector-actions">
              <button className="danger" onClick={() => onRemoveEdge(selectedEdge)}>
                删除此连接
              </button>
            </div>
            <p className="inspector-hint">删除后可通过撤销恢复。</p>
          </div>
        </>
      ) : node ? (
        <>
          <div className="section-title">
            <span>属性</span>
            <small>{TYPE_LABEL[node.type] ?? node.type}</small>
          </div>

          <NodeField
            label="设备名称"
            value={node.name}
            onCommit={(v) => onPatch(node.id, { name: v }, `重命名为 ${v}`)}
          />
          <NodeField
            label="IP 地址"
            value={node.ip}
            onCommit={(v) => onPatch(node.id, { ip: v.trim() }, `修改 ${node.name} 的 IP`)}
          />
          <label>
            设备类型
            <select
              value={node.type}
              onChange={(e) => onPatch(node.id, { type: e.target.value }, `更改 ${node.name} 的类型`)}
            >
              <option value="router">路由器</option>
              <option value="switch">交换机</option>
              <option value="server">服务器</option>
              <option value="device">终端设备</option>
            </select>
          </label>

          <div className="inspector-actions">
            <button className={connecting ? 'busy' : ''} onClick={() => onConnect(node.id)}>
              {connecting ? '◉ 选择对端…' : '⌁ 添加连接'}
            </button>
            <button className="danger" onClick={() => onRemoveNode(node.id)}>
              删除设备
            </button>
          </div>

          <div className="connections">
            <div className="section-title">
              <span>连接</span>
              <small>
                {graph.edges.filter(([a, b]) => a === node.id || b === node.id).length} 条
              </small>
            </div>
            {graph.edges
              .filter(([a, b]) => a === node.id || b === node.id)
              .map(([a, b]) => {
                const otherId = a === node.id ? b : a;
                const other = graph.nodes.find((n) => n.id === otherId);
                return (
                  <div className="connection" key={edgeId(a, b)}>
                    <span className={`mini ${other?.type ?? ''}`}>
                      {glyphOf(other?.type)}
                    </span>
                    <strong>{other?.name ?? otherId}</strong>
                    <small>{other ? '在线' : '引用缺失'}</small>
                  </div>
                );
              })}
            {graph.edges.every(([a, b]) => a !== node.id && b !== node.id) && (
              <p className="inspector-hint warn">该节点没有任何连接（保存前检查会提示孤立节点）。</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="section-title">
            <span>属性</span>
          </div>
          <p className="inspector-hint">画布为空。从左侧设备库添加一个设备开始。</p>
        </>
      )}
    </aside>
  );
}
