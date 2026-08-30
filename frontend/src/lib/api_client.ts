/**
 * API 客户端 — Gemini Web Gateway 网关契约 + 本地会话适配层。
 *
 * 网关端点：
 *   POST /openai/v1/chat/completions   聊天（SSE，OpenAI 兼容）
 *   POST /openai/v1/images/generations 文生图（b64_json，=s0 原图）
 *   GET  /openai/v1/models             模型列表
 *   POST /gemini/v1beta/deepresearch/stream  深度研究（SSE）
 *
 * 会话存储在浏览器 localStorage（按模态分组），不依赖服务端。
 * 访问认证由 Caddy basic_auth 在浏览器层完成，此处无需 Token。
 */

// ------------------------------------------------------------------
// 类型
// ------------------------------------------------------------------

export type ThinkingType = 'controllable' | 'forced' | 'none';

export interface LlmModelEntry {
  path: string;
  thinking_type: ThinkingType;
}

export interface ModelList {
  llm: Record<string, LlmModelEntry>;
  image: Record<string, string>;
  video: Record<string, string>;
  tts: Record<string, string>;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 流式输出事件 */
export type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'metadata'; tokensPerSecond: number; completionTokens: number; elapsedSeconds: number };

export interface ImageResult {
  image: string; // data URL
  width: number;
  height: number;
}

export interface ResearchSource {
  title?: string;
  url?: string;
  snippet?: string;
  domain?: string;
}

export type DeepResearchEvent =
  | { event: 'progress'; message?: string; progress?: number }
  | { event: 'step'; message?: string; progress?: number; step?: { step_number?: number; description?: string; result?: string } }
  | { event: 'source'; source?: ResearchSource; message?: string }
  | { event: 'result'; result?: { summary?: string; sources?: ResearchSource[] } }
  | { event: 'error'; error?: string };

// ------------------------------------------------------------------
// 会话存储（localStorage 适配层）
// ------------------------------------------------------------------

export interface SessionRecord {
  id: number;
  title: string;
  modality: string;
  model_name: string | null;
  created_at: string;
  messages: Array<{ role: string; content: string }>;
}

const SESSIONS_KEY = 'gg-sessions';

function loadStore(): Record<number, SessionRecord> {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveStore(store: Record<number, SessionRecord>) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(store));
  } catch {
    /* 配额满时静默失败 */
  }
}

// ------------------------------------------------------------------
// 通用请求
// ------------------------------------------------------------------

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try {
      const json = JSON.parse(body);
      detail = json.error?.message || json.detail || JSON.stringify(json);
    } catch {}
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json();
}

// ------------------------------------------------------------------
// 模型列表
// ------------------------------------------------------------------

export const api = {
  listModels: async (): Promise<ModelList> => {
    const data = await request<{ data?: Array<{ id: string }> }>('/openai/v1/models');
    const llm: Record<string, LlmModelEntry> = {};
    const image: Record<string, string> = {};
    for (const m of data.data ?? []) {
      const id = m.id;
      if (id.includes('image')) image[id] = id;
      else llm[id] = { path: id, thinking_type: 'controllable' };
    }
    return { llm, image, video: {}, tts: {} };
  },

  // ----------------------------------------------------------------
  // 聊天（SSE 流式；reasoning_content → thinking 事件）
  // ----------------------------------------------------------------

  chatCompletion: async function* (
    model: string,
    messages: ChatMessage[],
    _maxTokens = 2048,
    _temperature = 0.7,
    imageDataUrl?: string,
    _filePath?: string,
    signal?: AbortSignal,
    _enableThinking = false,
    _sessionId?: number | null,
  ): AsyncGenerator<StreamEvent> {
    // 图片附件：转为 OpenAI 视觉格式（data URL 内联）
    const outbound = messages.map((m, i) => {
      if (i === messages.length - 1 && m.role === 'user' && imageDataUrl) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    const res = await fetch('/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: outbound, stream: true }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      let detail = body;
      try {
        detail = JSON.parse(body).error?.message || body;
      } catch {}
      throw new Error(`Chat ${res.status}: ${detail}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        if (trimmed === 'data: [DONE]') return;
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content) yield { type: 'thinking', text: delta.reasoning_content };
          if (delta.content) yield { type: 'content', text: delta.content };
        } catch {
          console.warn('[SSE] JSON 解析失败:', trimmed.slice(6));
        }
      }
      if (done) break;
    }
    decoder.decode();
  },

  // ----------------------------------------------------------------
  // 文生图（一次性返回 b64；后端以 =s0 下载原图）
  // ----------------------------------------------------------------

  generateImage: async (
    model: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<ImageResult> => {
    const data = await request<{ data?: Array<{ b64_json?: string }> }>(
      '/openai/v1/images/generations',
      {
        method: 'POST',
        body: JSON.stringify({ model, prompt, n: 1, response_format: 'b64_json' }),
        signal,
      },
    );
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('未返回图片数据');
    return { image: `data:image/png;base64,${b64}`, width: 0, height: 0 };
  },

  // ----------------------------------------------------------------
  // 深度研究（SSE 流式）
  // ----------------------------------------------------------------

  deepResearchStream: async function* (
    query: string,
    signal?: AbortSignal,
  ): AsyncGenerator<DeepResearchEvent> {
    const res = await fetch('/gemini/v1beta/deepresearch/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, language: 'zh' }),
      signal,
    });
    if (!res.ok) throw new Error(`DeepResearch ${res.status}: ${await res.text()}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        try {
          yield JSON.parse(trimmed.slice(5).trim()) as DeepResearchEvent;
        } catch {
          /* 忽略坏行 */
        }
      }
      if (done) break;
    }
    decoder.decode();
  },

  // ----------------------------------------------------------------
  // 图片上传（转 data URL，随消息内联发送）
  // ----------------------------------------------------------------

  uploadFile: async (file: File): Promise<{ path: string; size: number; filename: string; type: string }> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return { path: dataUrl, size: file.size, filename: file.name, type: file.type };
  },

  // ----------------------------------------------------------------
  // 会话管理（localStorage 适配层）
  // ----------------------------------------------------------------

  getSessions: (modality?: string): SessionRecord[] => {
    const store = loadStore();
    return Object.values(store)
      .filter((s) => !modality || s.modality === modality)
      .sort((a, b) => b.id - a.id);
  },

  createSession: (title: string, modality: string, modelName?: string): SessionRecord => {
    const store = loadStore();
    const id = Date.now();
    const rec: SessionRecord = {
      id,
      title,
      modality,
      model_name: modelName ?? null,
      created_at: new Date().toISOString(),
      messages: [],
    };
    store[id] = rec;
    saveStore(store);
    return rec;
  },

  getSessionMessages: (sessionId: number) => {
    const store = loadStore();
    const rec = store[sessionId];
    return {
      session: rec ?? { id: sessionId, title: '', modality: '', model_name: null },
      messages: (rec?.messages ?? []).map((m, i) => ({
        id: i,
        role: m.role,
        content: m.content,
        metadata: null,
        created_at: rec?.created_at ?? '',
      })),
    };
  },

  saveSessionMessages: (sessionId: number, messages: Array<{ role: string; content: string }>) => {
    const store = loadStore();
    const rec = store[sessionId];
    if (!rec) return;
    rec.messages = messages;
    saveStore(store);
  },

  deleteSession: (sessionId: number) => {
    const store = loadStore();
    delete store[sessionId];
    saveStore(store);
    return { message: 'ok' };
  },
};
