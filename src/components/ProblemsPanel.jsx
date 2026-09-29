import React from 'react';

const KIND_LABEL = {
  duplicate: '重复连接',
  dangling: '悬空引用',
  self: '自环连接',
  isolated: '孤立节点',
  ip: '非法地址',
};

// 问题面板：列出问题但不锁定编辑，画布始终可操作。
// state=open 仅展示；state=confirm 是保存前的确认视图。
export default function ProblemsPanel({
  state,
  issues,
  errorCount,
  warningCount,
  onClose,
  onSelect,
  onForceSave,
  onBackEdit,
}) {
  if (state === 'closed') return null;

  return (
    <div className="problems">
      <div className="problems-head">
        <div>
          <strong>{state === 'confirm' ? '保存前检查未通过' : '拓扑问题清单'}</strong>
          <small>
            {issues.length === 0
              ? '未发现问题'
              : `${errorCount} 个错误 · ${warningCount} 个警告 — 编辑不受影响，可逐项处理`}
          </small>
        </div>
        <button className="problems-close" onClick={onClose} title="收起清单（编辑不受影响）">
          ×
        </button>
      </div>

      <div className="problems-body">
        {issues.map((issue, i) => (
          <button
            key={`${issue.kind}-${i}`}
            className={`problem ${issue.level}`}
            onClick={() => onSelect(issue.nodeId)}
            title="点击定位相关节点"
          >
            <span className={`problem-tag ${issue.level}`}>
              {issue.level === 'error' ? '错误' : '警告'}
            </span>
            <span className="problem-kind">{KIND_LABEL[issue.kind] ?? issue.kind}</span>
            <span className="problem-msg">{issue.message}</span>
          </button>
        ))}
        {issues.length === 0 && <div className="problems-ok">拓扑检查通过，可以保存。</div>}
      </div>

      {state === 'confirm' && (
        <div className="problems-foot">
          <span>建议先修正错误；你也可以放弃这次保存继续编辑。</span>
          <div>
            <button onClick={onBackEdit}>返回编辑</button>
            <button className="force" onClick={onForceSave} title="忽略问题仍要保存">
              仍然保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
