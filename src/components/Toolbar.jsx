import React from 'react';

export default function Toolbar({ zoom, setZoom }) {
  const clampZoom = (z) => Math.min(2, Math.max(0.5, Math.round(z * 100) / 100));
  return (
    <div className="toolbar">
      <div className="tool-group">
        <span>工具</span>
        <button className="on" title="选择 / 拖动节点">↖ 选择</button>
        <span className="tool-hint">选中设备后在右侧点「添加连接」；Delete 删除选中项</span>
      </div>
      <div className="tool-group zoom">
        <button onClick={() => setZoom((z) => clampZoom(z - 0.1))} title="缩小">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => clampZoom(z + 0.1))} title="放大">＋</button>
        <button onClick={() => setZoom(1)} title="恢复 100%">⌗</button>
      </div>
    </div>
  );
}
