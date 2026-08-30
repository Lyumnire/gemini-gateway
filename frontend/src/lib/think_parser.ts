/**
 * think_parser — 流式解析 <think>...</think> 标签，分离思考过程与正式回答。
 */

// 清洗模型泄漏的底层 token
const DIRTY_TOKENS_RE = /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|\f/g;

export interface ParsedMessage {
  /** 思考过程内容（已清洗） */
  thought: string;
  /** 正式回答内容（已清洗） */
  answer: string;
  /** 是否正在思考中（有 <think> 但还没有 </think>） */
  isThinking: boolean;
}

/**
 * 解析流式文本，分离思考过程和正式回答。
 *
 * 处理三种状态：
 * 1. 只有 <think> 没有 </think> → 正在思考中
 * 2. 同时有 <think> 和 </think> → 思考结束，有正式回答
 * 3. 都没有 → 纯文本回答（不支持 thinking 的模型）
 */
export function parseThinkingMessage(raw: string): ParsedMessage {
  // 清洗脏数据
  const clean = raw.replace(DIRTY_TOKENS_RE, '');

  const thinkOpen = clean.indexOf('<think>');
  const thinkClose = clean.indexOf('</think>');

  // 没有 <think> 标签 → 纯文本回答
  if (thinkOpen === -1) {
    return { thought: '', answer: clean, isThinking: false };
  }

  // 有 <think> 但没有 </think> → 正在思考中
  if (thinkClose === -1) {
    const thought = clean.slice(thinkOpen + 7).trim();
    return { thought, answer: '', isThinking: true };
  }

  // 同时有 <think> 和 <think></think> → 思考结束
  const thought = clean.slice(thinkOpen + 7, thinkClose).trim();
  const answer = clean.slice(thinkClose + 8).trim();
  return { thought, answer, isThinking: false };
}
