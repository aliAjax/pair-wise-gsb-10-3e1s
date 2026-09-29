import React, { useState } from 'react';

function HistoryMenu({ past, future, onJumpPast, onJumpFuture, onUndo, onRedo }) {
  return (
    <div className="hist-menu">
      <div className="hist-col">
        <div className="hist-col-title">已执行（点击回到该步）</div>
        {past.length === 0 && <div className="hist-empty">当前历史段暂无操作</div>}
        {past.map((entry, i) => (
          <button
            key={`p-${i}-${entry.label}`}
            className="hist-item past"
            title="回放撤销到这一步之后"
            onClick={() => onJumpPast(i)}
          >
            <span className="hist-idx">{i + 1}</span>
            {entry.label}
          </button>
        ))}
      </div>
      <div className="hist-col">
        <div className="hist-col-title">可重做</div>
        {future.length === 0 && <div className="hist-empty">没有可重做的操作</div>}
        {future.map((entry, i) => (
          <button
            key={`f-${i}-${entry.label}`}
            className="hist-item future"
            title="重做到这一步"
            onClick={() => onJumpFuture(i)}
          >
            <span className="hist-idx">{i + 1}</span>
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Header({
  dirty,
  canUndo,
  canRedo,
  pastCount,
  onUndo,
  onRedo,
  onCheck,
  onImport,
  onExport,
  onSave,
  issueCount,
  errorCount,
  historyPast,
  historyFuture,
  onJumpPast,
  onJumpFuture,
}) {
  const [histOpen, setHistOpen] = useState(false);

  return (
    <header>
      <div className="brand">
        <span className="brand-mark">⌁</span>
        <div>
          <strong>NETSCAPE</strong>
          <small>TOPOLOGY STUDIO</small>
        </div>
      </div>

      <div className="file">
        <span className={`dot ${dirty ? 'unsaved' : ''}`} title={dirty ? '有未保存的修改' : '已保存'} />
        <div>
          <strong>office-network.json</strong>
          <small>{dirty ? '有未保存的修改' : '与已保存内容一致'}</small>
        </div>
      </div>

      <div className="undo-group">
        <button
          className="ubtn"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销（Ctrl/⌘ + Z）"
        >
          ↶ 撤销
        </button>
        <button
          className="ubtn"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做（Ctrl/⌘ + Y）"
        >
          ↷ 重做
        </button>
        <div className="hist-wrap">
          <button
            className="ubtn hist-btn"
            onClick={() => setHistOpen((v) => !v)}
            title="查看操作历史"
          >
            历史 ▾
          </button>
          {histOpen && (
            <HistoryMenu
              past={historyPast}
              future={historyFuture}
              onJumpPast={(i) => {
                onJumpPast(i);
              }}
              onJumpFuture={onJumpFuture}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          )}
        </div>
        <span className="hist-count" title="当前历史段中的操作数">
          {pastCount} 步
        </span>
      </div>

      <div className="top-actions">
        <button onClick={onCheck} title="检查重复连接、孤立节点与非法地址">
          ✓ 检查
          {issueCount > 0 && (
            <span className={`badge ${errorCount > 0 ? 'err' : 'warn'}`}>{issueCount}</span>
          )}
        </button>
        <button onClick={onImport} title="导入 JSON（先校验结构与引用）">
            ↑ 导入
        </button>
        <button onClick={onExport} title="导出当前正在编辑的拓扑">↓ 导出</button>
        <button className="save" onClick={onSave}>
          保存更改
        </button>
      </div>
    </header>
  );
}
