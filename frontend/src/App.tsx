import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation, StoredMessage } from './types';
import { ApiError } from './types';
import { buildContent, listModels, streamChat, type ChatMessageInput } from './lib/api';
import {
  createMessage,
  loadActiveId,
  loadConversations,
  loadModel,
  loadTheme,
  newConversation,
  saveActiveId,
  saveConversations,
  saveModel,
  saveTheme,
  titleFrom,
  type ThemeMode,
} from './lib/storage';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';

const FALLBACK_MODELS = ['gemini-advanced', 'gemini-pro'];

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const list = loadConversations();
    return list.length > 0 ? list : [newConversation()];
  });
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId());
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);
  const [model, setModel] = useState<string>(() => loadModel(FALLBACK_MODELS[0]));
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0] ?? null,
    [conversations, activeId],
  );

  // activeId 失效时回落到第一个会话
  useEffect(() => {
    if (conversations.length > 0 && !conversations.some((c) => c.id === activeId)) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId]);

  useEffect(() => saveConversations(conversations), [conversations]);
  useEffect(() => saveActiveId(activeId), [activeId]);

  // 深色模式：跟随系统 + 手动三态
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#0f172a' : '#4f46e5');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // 启动时拉取可用模型列表（失败则用默认）
  useEffect(() => {
    let cancelled = false;
    listModels()
      .then((ids) => {
        if (!cancelled && ids.length > 0) {
          setModels(ids);
          setModel((cur) => (ids.includes(cur) ? cur : ids[0]));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const patchConversation = useCallback((convId: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === convId ? fn(c) : c)));
  }, []);

  const patchMessage = useCallback(
    (convId: string, msgId: string, patch: Partial<StoredMessage>) => {
      patchConversation(convId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
      }));
    },
    [patchConversation],
  );

  const runChat = useCallback(
    async (convId: string, history: StoredMessage[]) => {
      const assistant = createMessage('assistant', '');
      patchConversation(convId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: [...c.messages, assistant],
      }));
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const apiMessages: ChatMessageInput[] = history
        .filter((m) => !m.error && (m.content || (m.images && m.images.length > 0)))
        .map((m) => ({ role: m.role, content: buildContent(m.content, m.images ?? []) }));

      let content = '';
      let reasoning = '';
      try {
        const result = await streamChat(
          model,
          apiMessages,
          {
            onDelta: (t) => {
              content += t;
              patchMessage(convId, assistant.id, { content });
            },
            onReasoning: (t) => {
              reasoning += t;
              patchMessage(convId, assistant.id, { reasoning });
            },
          },
          controller.signal,
        );
        content = result.content || content;
        reasoning = result.reasoning || reasoning;
        patchMessage(convId, assistant.id, { content, reasoning });
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        if (aborted) {
          patchMessage(convId, assistant.id, {
            content: content || '（已停止生成）',
            reasoning,
          });
        } else {
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : '未知错误';
          const errorText = content
            ? `${content}\n\n> ⚠️ 生成中断：${msg}`
            : `⚠️ 请求失败：${msg}`;
          patchMessage(convId, assistant.id, {
            content: errorText,
            reasoning,
            error: !content,
          });
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [model, patchConversation, patchMessage],
  );

  const sendMessage = useCallback(
    (text: string, images: string[]) => {
      if (!active || busy) return;
      const userMsg = createMessage('user', text, { images: images.length ? images : undefined });
      const history = [...active.messages, userMsg];
      patchConversation(active.id, (c) => ({
        ...c,
        title: c.title === '新对话' ? titleFrom(text) : c.title,
        updatedAt: Date.now(),
        messages: [...c.messages, userMsg],
      }));
      void runChat(active.id, history);
    },
    [active, busy, patchConversation, runChat],
  );

  const retryLast = useCallback(() => {
    if (!active || busy) return;
    const msgs = [...active.messages];
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant' && last.error) msgs.pop();
    patchConversation(active.id, (c) => ({ ...c, messages: msgs }));
    void runChat(active.id, msgs);
  }, [active, busy, patchConversation, runChat]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const handleNew = useCallback(() => {
    const conv = newConversation();
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
  }, []);

  const handleSelect = useCallback((id: string) => setActiveId(id), []);

  const handleDelete = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (next.length === 0) {
          const conv = newConversation();
          setActiveId(conv.id);
          return [conv];
        }
        return next;
      });
    },
    [],
  );

  const handleThemeChange = useCallback((m: ThemeMode) => {
    setTheme(m);
    saveTheme(m);
  }, []);

  const handleModelChange = useCallback((m: string) => {
    setModel(m);
    saveModel(m);
  }, []);

  if (!active) return null;

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={active.id}
        theme={theme}
        onClose={() => setSidebarOpen(false)}
        onNew={handleNew}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onThemeChange={handleThemeChange}
      />
      <ChatView
        conversation={active}
        model={model}
        models={models}
        busy={busy}
        onModelChange={handleModelChange}
        onOpenSidebar={() => setSidebarOpen(true)}
        onSend={sendMessage}
        onStop={stop}
        onRetry={retryLast}
      />
    </div>
  );
}
