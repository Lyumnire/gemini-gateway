import type { ChatMode, Conversation, MessageRole, StoredMessage } from '../types';

const CONV_KEY = 'gg-conversations';
const ACTIVE_KEY = 'gg-active-conversation';
const THEME_KEY = 'gg-theme';
const MODEL_KEY = 'gg-model';

export type ThemeMode = 'system' | 'light' | 'dark';

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function newConversation(): Conversation {
  const now = Date.now();
  return { id: uid(), title: '新对话', createdAt: now, updatedAt: now, messages: [] };
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONV_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Conversation[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]): void {
  try {
    localStorage.setItem(CONV_KEY, JSON.stringify(list));
  } catch {
    /* 存储满时静默失败 */
  }
}

export function loadActiveId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function saveActiveId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

export function createMessage(
  role: MessageRole,
  content: string,
  extra?: Partial<StoredMessage>,
): StoredMessage {
  return { id: uid(), role, content, createdAt: Date.now(), ...extra };
}

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 24 ? `${t.slice(0, 24)}…` : t || '新对话';
}

export function loadTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function saveTheme(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode);
}

export function loadModel(fallback: string): string {
  return localStorage.getItem(MODEL_KEY) || fallback;
}

export function saveModel(model: string): void {
  localStorage.setItem(MODEL_KEY, model);
}

const MODE_KEY2 = 'gg-ui-mode';

export function loadUiMode(): ChatMode {
  const v = localStorage.getItem(MODE_KEY2);
  return v === 'image' || v === 'research' ? v : 'chat';
}

export function saveUiMode(m: ChatMode): void {
  localStorage.setItem(MODE_KEY2, m);
}
