// 统一历史栈：节点操作（增删改、移动）与连线变化进入同一份历史。
// 每个条目记录操作前 / 操作后两份快照，撤销与重做严格按操作顺序回放。
import { sameGraph } from './topology';

export const initialHistory = (graph) => ({
  past: [], // [{ label, prev, next }]，越靠后越新
  present: graph,
  future: [], // 撤销后暂存的条目，[0] 是最近撤销的
});

export function historyReducer(state, action) {
  switch (action.type) {
    // 拖拽 / 输入过程中的临时更新：只改当前图，不入历史
    case 'live':
      return { ...state, present: action.graph };

    // 一次完整操作提交（prev 允许由“临时更新”开始前的快照指定）
    case 'commit': {
      const prev = action.prev ?? state.present;
      if (sameGraph(prev, action.graph)) return state;
      return {
        past: [...state.past, { label: action.label, prev, next: action.graph }],
        present: action.graph,
        future: [], // 新操作会清空重做分支
      };
    }

    case 'undo': {
      const entry = state.past[state.past.length - 1];
      if (!entry) return state;
      return {
        past: state.past.slice(0, -1),
        present: entry.prev,
        future: [entry, ...state.future],
      };
    }

    case 'redo': {
      const entry = state.future[0];
      if (!entry) return state;
      return {
        past: [...state.past, entry],
        present: entry.next,
        future: state.future.slice(1),
      };
    }

    // 保存后从当前状态重新起一段历史：之前的操作不可再跨越撤销
    case 'checkpoint':
      return { past: [], present: state.present, future: [] };

    // 按操作顺序连续回放，跳到历史中的某一步
    case 'jumpPast': {
      const count = state.past.length - 1 - action.index;
      if (count <= 0) return state;
      // moved 为旧→新顺序；最旧一步的 prev 即目标状态
      const moved = state.past.slice(state.past.length - count);
      return {
        past: state.past.slice(0, state.past.length - count),
        present: moved[0].prev,
        // future 为新→旧顺序
        future: [...moved.slice().reverse(), ...state.future],
      };
    }

    case 'jumpFuture': {
      const count = action.index + 1;
      // moved 取自 future（新→旧顺序）
      const moved = state.future.slice(0, count);
      if (moved.length === 0) return state;
      return {
        // 拼回 past 时恢复成旧→新顺序
        past: [...state.past, ...moved.slice().reverse()],
        present: moved[0].next, // 最新一步的结果
        future: state.future.slice(count),
      };
    }

    default:
      return state;
  }
}
