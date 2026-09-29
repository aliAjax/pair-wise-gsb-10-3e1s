import React from 'react';
import { glyphOf, NODE_TYPES } from '../state/topology';

export default function Inventory({ nodes, selected, onSelect, onAdd }) {
  return (
    <aside className="inventory">
      <div className="section-title">
        <span>设备库</span>
        <small>{nodes.length} 个节点</small>
      </div>
      <div className="device-types">
        {NODE_TYPES.map(({ type, glyph, label }) => (
          <button key={type} onClick={() => onAdd(type)} title={`添加${label}`}>
            <i className={type}>{glyph}</i>
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
        {nodes.length === 0 && <div className="list-empty">画布为空，从设备库添加节点</div>}
        {nodes.map((n) => (
          <button
            className={selected === n.id ? 'sel' : ''}
            key={n.id}
            onClick={() => onSelect(n.id)}
          >
            <i className={n.type}>{glyphOf(n.type)}</i>
            <span>
              <strong>{n.name}</strong>
              <small>{n.ip || '未配置 IP'}</small>
            </span>
            <b>›</b>
          </button>
        ))}
      </div>
    </aside>
  );
}
