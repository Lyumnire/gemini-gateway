/**
 * API 客户端 — Gemini Web Gateway 网关契约 + 本地会话适配层。
 *
 * 网关端点：
 *   POST /openai/v1/chat/completions   聊天（SSE，OpenAI 兼容）
 *   POST /openai/v1/images/generations 文生图（b64_json，=s0 原图）
 *   GET  /openai/v1/models             模型列表
 *   POST /gemini/v1beta/deepresearch/stream  深度研究（SSE）
 *
 * 认证：JWT Bearer Token（30天有效），存储在 localStorage `gg-token`。
 * 会话：SQLite 服务端为主，localStorage 做离线缓存（双写）。
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
  content: string | any[];
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
  conversation_id?: string;
  response_id?: string;
  choice_id?: string;
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
// 用户资料
// ------------------------------------------------------------------

export interface UserProfile {
  id: number;
  username: string;
  avatar: string;
  created_at: string;
}

// ------------------------------------------------------------------
// Token 管理
// ------------------------------------------------------------------

const TOKEN_KEY = 'gg-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

// 用户资料本地缓存：回访时立即渲染头像/用户名，后台再刷新
const PROFILE_CACHE_KEY = 'gg-profile-cache';

export function readCachedProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as UserProfile;
    return p && typeof p.id === 'number' ? p : null;
  } catch {
    return null;
  }
}

export function cacheProfile(p: UserProfile) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p));
  } catch { /* 配额满等情况静默失败 */ }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  // 登出/换号时清掉用户资料缓存，避免下一个账号闪现上一个用户的头像
  localStorage.removeItem(PROFILE_CACHE_KEY);
}

// ------------------------------------------------------------------
// 会话存储（localStorage + 服务端双写）
// ------------------------------------------------------------------

export interface SessionRecord {
  id: number;
  server_id?: number;  // 服务端 conversation ID
  title: string;
  modality: string;
  model_name: string | null;
  created_at: string;
  messages: Array<{ role: string; content: string; image?: string; attachment?: any }>;
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

/** 找到 localStorage 中 server_id 匹配的记录 */
function findLocalByServerId(store: Record<number, SessionRecord>, serverId: number): SessionRecord | undefined {
  return Object.values(store).find(s => s.server_id === serverId);
}

// ------------------------------------------------------------------
// 通用请求（自动注入 JWT）
// ------------------------------------------------------------------

let _onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(fn: () => void) {
  _onUnauthorized = fn;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    _onUnauthorized?.();
    throw new Error('认证已过期，请重新登录');
  }
  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try {
      const json = JSON.parse(body);
      detail = json.error?.message || json.detail || json.error || JSON.stringify(json);
    } catch {}
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json();
}

// ------------------------------------------------------------------
// 模型列表
// ------------------------------------------------------------------

/** 提取文本中的 Google CDN 图片链接并转为 data URL（通过后端 b64 代理） */
export async function fetchImagesAsDataUrls(text: string, signal?: AbortSignal): Promise<string[]> {
  const urls = [...text.matchAll(/https?:\/\/lh[\w.-]*\.googleusercontent\.com\/[^\)"`\s]+/g)].map(m => m[0]);
  if (!urls.length) return [];
  const results: string[] = [];
  for (const url of urls) {
    try {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch("/proxy-image/b64?src=" + encodeURIComponent(url), { signal, headers });
      if (res.ok) {
        const d = await res.json();
        if (d.b64) results.push("data:" + d.content_type + ";base64," + d.b64);
      }
    } catch { /* skip */ }
  }
  return results;
}

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
    conversationMeta?: { conversation_id?: string; response_id?: string; choice_id?: string },
  ): AsyncGenerator<StreamEvent> {
    // 构建请求消息：处理附件和 multipart 内容
    const outbound = messages.map((m, i) => {
      // 如果 content 已经是数组（multipart），直接使用
      if (Array.isArray(m.content)) {
        return { role: m.role, content: m.content };
      }
      // 最后一条用户消息 + 图片附件：转为 vision 格式
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

    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const body: any = { model, messages: outbound, stream: true };
    // 传递对话元数据（用于多轮对话上下文）
    const hasMeta = !!(conversationMeta?.conversation_id && conversationMeta?.choice_id);
    if (conversationMeta) {
      if (conversationMeta.conversation_id) body.conversation_id = conversationMeta.conversation_id;
      if (conversationMeta.response_id) body.response_id = conversationMeta.response_id;
      if (conversationMeta.choice_id) body.choice_id = conversationMeta.choice_id;
    }
    console.log(`[gg] chat request | hasMeta=${hasMeta} | CID=${conversationMeta?.conversation_id || '(none)'} | RID=${conversationMeta?.response_id || '(none)'} | RCID=${conversationMeta?.choice_id || '(none)'} | msgCount=${outbound.length}`);
    const bodyStr = JSON.stringify(body);

    let res: Response;
    try {
      res = await fetch('/openai/v1/chat/completions', {
        method: 'POST',
        headers,
        body: bodyStr,
        signal,
      });
    } catch (e: any) {
      console.error('[gg] fetch failed:', e.message, e.name);
      if (e.name === 'AbortError') throw e;
      throw new Error(`网络请求失败: ${e.message}（请求大小: ${(bodyStr.length / 1024).toFixed(0)}KB）`);
    }

    if (res.status === 401) {
      clearToken();
      _onUnauthorized?.();
      throw new Error('认证已过期，请重新登录');
    }
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
          
          // 提取对话元数据（后端发送的第一个 chunk）
          if (parsed.conversation_id) {
            console.log(`[gg] stream metadata | CID=${parsed.conversation_id} | RID=${parsed.response_id} | RCID=${parsed.choice_id}`);
            yield { type: 'metadata', conversationId: parsed.conversation_id, responseId: parsed.response_id, choiceId: parsed.choice_id } as any;
          }
          
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
    conversationMeta?: { conversation_id?: string; response_id?: string; choice_id?: string },
  ): Promise<ImageResult> => {
    const body: any = { model, prompt, n: 1, response_format: 'b64_json' };
    if (conversationMeta?.conversation_id) body.conversation_id = conversationMeta.conversation_id;
    if (conversationMeta?.response_id) body.response_id = conversationMeta.response_id;
    if (conversationMeta?.choice_id) body.choice_id = conversationMeta.choice_id;

    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/openai/v1/images/generations', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 401) {
      clearToken();
      _onUnauthorized?.();
      throw new Error('认证已过期，请重新登录');
    }
    if (!res.ok) throw new Error(`Image ${res.status}: ${await res.text()}`);

    // 解析 SSE 流（心跳注释 + data 事件）
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: { data?: Array<{ b64_json?: string }>; conversation_id?: string; response_id?: string; choice_id?: string; error?: string } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          if (parsed.error) throw new Error(parsed.error);
          result = parsed;
        } catch (e: any) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
      if (done) break;
    }

    if (!result) throw new Error('未收到图片数据');
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error(result.error || '未返回图片数据');
    return {
      image: `data:image/png;base64,${b64}`,
      width: 0,
      height: 0,
      conversation_id: result.conversation_id,
      response_id: result.response_id,
      choice_id: result.choice_id,
    };
  },

  // ----------------------------------------------------------------
  // 深度研究（SSE 流式）
  // ----------------------------------------------------------------

  deepResearchStream: async function* (
    query: string,
    signal?: AbortSignal,
  ): AsyncGenerator<DeepResearchEvent> {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/gemini/v1beta/deepresearch/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, language: 'zh' }),
      signal,
    });
    if (res.status === 401) {
      clearToken();
      _onUnauthorized?.();
      throw new Error('认证已过期，请重新登录');
    }
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
  // 用户资料
  // ----------------------------------------------------------------

  getProfile: async (): Promise<UserProfile> => {
    return request<UserProfile>('/auth/me');
  },

  updateProfile: async (data: {
    username?: string;
    password?: string;
    old_password?: string;
    avatar?: string;
  }): Promise<UserProfile> => {
    return request<UserProfile>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // ----------------------------------------------------------------
  // 会话管理（localStorage + 服务端双写）
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

    // 异步同步到服务端（不阻塞 UI）
    request<{ id: number }>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, model: modelName }),
    }).then((data) => {
      rec.server_id = data.id;
      const s = loadStore();
      if (s[id]) { s[id].server_id = data.id; saveStore(s); }
    }).catch(() => {});

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
        image: m.image,
        attachment: m.attachment,
        metadata: null,
        created_at: rec?.created_at ?? '',
      })),
    };
  },

  saveSessionMessages: (sessionId: number, messages: Array<{ role: string; content: string; image?: string; attachment?: any }>) => {
    const store = loadStore();
    const rec = store[sessionId];
    if (!rec) return;
    rec.messages = messages;
    saveStore(store);

    // 异步同步到服务端
    if (rec.server_id) {
      request(`/conversations/${rec.server_id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      }).catch(() => {});
    }
  },

  deleteSession: (sessionId: number) => {
    const store = loadStore();
    const rec = store[sessionId];
    delete store[sessionId];
    saveStore(store);

    // 异步删除服务端记录
    if (rec?.server_id) {
      request(`/conversations/${rec.server_id}`, { method: 'DELETE' }).catch(() => {});
    }
    return { message: 'ok' };
  },

  // ----------------------------------------------------------------
  // 登录后从服务端拉取会话列表（合并到 localStorage）
  // ----------------------------------------------------------------

  syncFromServer: async (): Promise<void> => {
    try {
      const serverConvs = await request<Array<{ id: number; title: string; model: string; created_at: string; updated_at: string }>>('/conversations');
      const store = loadStore();

      for (const conv of serverConvs) {
        const existing = findLocalByServerId(store, conv.id);
        if (existing) {
          // 更新标题等元数据
          existing.title = conv.title;
          existing.model_name = conv.model;
        } else {
          // 从服务端拉取新会话
          try {
            const detail = await request<{ conversation: any; messages: Array<{ role: string; content: string }> }>(`/conversations/${conv.id}`);
            const localId = Date.now() + Math.random();
            store[localId] = {
              id: localId,
              server_id: conv.id,
              title: conv.title,
              modality: 'chat',
              model_name: conv.model,
              created_at: conv.created_at,
              messages: detail.messages.map(m => ({ role: m.role, content: m.content })),
            };
          } catch { /* skip */ }
        }
      }
      saveStore(store);
    } catch { /* 离线时静默失败 */ }
  },
};
