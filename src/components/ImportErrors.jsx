import React from 'react';

// 导入失败提示：列出结构 / 引用错误，当前图保持不变
export default function ImportErrors({ file, errors, onClose }) {
  return (
    <div className="import-errors">
      <div className="import-errors-head">
        <strong>无法导入「{file}」</strong>
        <button onClick={onClose} title="关闭">×</button>
      </div>
      <p className="import-errors-sub">已保留当前正在编辑的拓扑，未做任何改动。请核对文件：</p>
      <ul>
        {errors.map((err, i) => (
          <li key={i}>{err}</li>
        ))}
      </ul>
    </div>
  );
}
