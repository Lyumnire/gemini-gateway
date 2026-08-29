import type { ContentPart, MessageRole, OpenAIChunk } from '../types';
import { ApiError } from '../types';

export interface ChatMessageInput {
  role: MessageRole;
  content: string | ContentPart[];
}

export interface StreamCallbacks {
  onReasoning?: (text: string) => void;
  onDelta?: (text: string) => void;
}

const API_URL = '/openai/v1/chat/completions';

/** 组装带图片的消息体：文本 + data URL 图片 */
export function buildContent(text: string, images: string[]): string | ContentPart[] {
  if (images.length === 0) return text;
  const parts: ContentPart[] = [{ type: 'text', text }];
  for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
  return parts;
}

/**
 * 调用 OpenAI 兼容接口（SSE 流式）。
 * 后端为伪流式（完整回复切块下发），首字延迟等于上游完整生成时间。
 * 返回累积结果；用户中断时抛出 DOMException AbortError，已收到的内容由调用方保留。
 */
export async function streamChat(
  model: string,
  messages: ChatMessageInput[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<{ content: string; reasoning: string }> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data?.error?.message || data?.message || msg;
    } catch {
      /* 保留默认消息 */
    }
    if (res.status === 401)
      msg = '需要登录：刷新页面后输入网关账号密码（浏览器会弹出认证框）。';
    throw new ApiError(res.status, msg);
  }

  const contentType = res.headers.get('content-type') ?? '';
  let content = '';
  let reasoning = '';

  // 非流式回退
  if (!res.body || !contentType.includes('event-stream')) {
    const data = await res.json();
    const choice = data?.choices?.[0];
    content = choice?.message?.content ?? '';
    reasoning = choice?.message?.reasoning_content ?? '';
    if (reasoning) callbacks.onReasoning?.(reasoning);
    if (content) callbacks.onDelta?.(content);
    return { content, reasoning };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return { content, reasoning };
      try {
        const chunk = JSON.parse(payload) as OpenAIChunk;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          callbacks.onReasoning?.(delta.reasoning_content);
        }
        if (delta.content) {
          content += delta.content;
          callbacks.onDelta?.(delta.content);
        }
      } catch {
        /* 忽略无法解析的行 */
      }
    }
  }
  return { content, reasoning };
}

export interface ModelInfo {
  id: string;
}

export async function listModels(): Promise<string[]> {
  const res = await fetch('/openai/v1/models');
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  const data = (await res.json()) as { data?: ModelInfo[] };
  return (data.data ?? []).map((m) => m.id);
}
