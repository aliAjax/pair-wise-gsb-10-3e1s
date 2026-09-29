import React, { useRef } from 'react';
import { edgeId, glyphOf } from '../state/topology';

const Edge = ({ graph, a, b, selected, pending, onSelect, onRemove }) => {
  const n1 = graph.nodes.find((n) => n.id === a);
  const n2 = graph.nodes.find((n) => n.id === b);
  if (!n1 || !n2) return null;

  const dx = n2.x - n1.x;
  const dy = n2.y - n1.y;
  const len = Math.hypot(dx, dy);
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;

  // 缩短到节点边缘，避免线条没入节点
  const pad = 38;
  const start = Math.min(pad, len / 2);
  const width = Math.max(0, len - pad * 2);

  return (
    <div
      className={`edge-row${selected ? ' sel' : ''}${pending ? ' pending' : ''}`}
      style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}
    >
      <div
        className="edge-hit"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(edgeId(a, b));
        }}
      >
        <div className="edge-line" style={{ marginLeft: start, width }} />
      </div>
      <button
        className="edge-del"
        style={{ left: len / 2 }}
        title="删除此连接（可撤销）"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(a, b);
        }}
      >
        ×
      </button>
    </div>
  );
};

export default function Canvas({
  graph,
  selected,
  selectedEdge,
  pendingFrom,
  zoom,
  onSelectNode,
  onSelectEdge,
  onRemoveEdge,
  onNodeMouseDown,
  onCancelConnect,
}) {
  const boardRef = useRef(null);

  return (
    <section className="canvas-wrap">
      {pendingFrom && (
        <div className="connect-banner">
          连线模式：从「{graph.nodes.find((n) => n.id === pendingFrom)?.name ?? pendingFrom}」
          点击另一个设备完成连接
          <button onClick={onCancelConnect}>取消 (Esc)</button>
        </div>
      )}
      <div
        className="canvas"
        ref={boardRef}
        onMouseDown={() => onSelectEdge(null)}
      >
        <div
          className="canvas-inner"
          style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%`, height: `${100 / zoom}%` }}
        >
          {graph.edges.map(([a, b]) => (
            <Edge
              key={edgeId(a, b)}
              graph={graph}
              a={a}
              b={b}
              selected={selectedEdge === edgeId(a, b)}
              pending={pendingFrom === a || pendingFrom === b}
              onSelect={onSelectEdge}
              onRemove={onRemoveEdge}
            />
          ))}

          {graph.nodes.map((n) => (
            <button
              key={n.id}
              className={
                'node ' +
                n.type +
                (selected === n.id ? ' picked' : '') +
                (pendingFrom === n.id ? ' connect-src' : '') +
                (pendingFrom && pendingFrom !== n.id ? ' connect-target' : '')
              }
              style={{ left: n.x - 42, top: n.y - 31 }}
              onMouseDown={(e) => {
                e.stopPropagation();
                const rect = boardRef.current.getBoundingClientRect();
                onNodeMouseDown(n.id, e, rect, zoom);
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectNode(n.id);
              }}
              title={pendingFrom && pendingFrom !== n.id ? '点击连接到此设备' : n.name}
            >
              <i>{glyphOf(n.type)}</i>
              <strong>{n.name}</strong>
              <small>{n.ip || '未配置 IP'}</small>
            </button>
          ))}

          <div className="legend">
            <span><i className="router" />路由器</span>
            <span><i className="switch" />交换机</span>
            <span><i className="server" />服务器</span>
            <span><i className="device" />终端</span>
          </div>
        </div>
      </div>
      <div className="canvas-footer">
        <span>
          拖动节点调整位置 · {graph.edges.length} 条连接 · {graph.nodes.length} 个节点
          {selectedEdge ? ' · 已选中一条连接（Delete 删除）' : ''}
        </span>
        <span>坐标系：画布局部 · {Math.round(zoom * 100)}%</span>
      </div>
    </section>
  );
}
