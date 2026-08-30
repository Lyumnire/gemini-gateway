/**
 * DeepResearchView — 深度研究界面（对话式布局，风格与 ChatView 一致）。
 *
 * 走网关 /gemini/v1beta/deepresearch/stream（SSE）：
 * 进度 → 步骤时间线 → 来源收集 → 最终报告（Markdown）。
 * 支持会话持久化（localStorage，modality=research）。
 */

import {
  memo, useCallback, useEffect, useRef, useState,
  type KeyboardEvent, type ChangeEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Square, Loader2, Globe, FileDown, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { api } from '@/lib/api_client';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Source {
  title?: string;
  url?: string;
  domain?: string;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  query?: string;
  progress: number;
  status: string;
  sources: Source[];
  /** 最终报告（Markdown） */
  report?: string;
  running?: boolean;
  error?: string;
}

let _id = 0;
const uid = () => `dr${++_id}`;

// ------------------------------------------------------------------
// 下载报告（Markdown）
// ------------------------------------------------------------------

function useDownloadReport() {
  const [downloadedId, setDownloadedId] = useState<string | null>(null);
  const download = useCallback((msg: Msg) => {
    const blob = new Blob([msg.report ?? ''], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-${msg.id}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setDownloadedId(msg.id);
    setTimeout(() => setDownloadedId(null), 1500);
  }, []);
  return { downloadedId, download };
}

// ------------------------------------------------------------------
// Bubble
// ------------------------------------------------------------------

const Bubble = memo(function Bubble({
  msg, onDownloadReport, downloadedId,
}: {
  msg: Msg;
  onDownloadReport: (m: Msg) => void;
  downloadedId: string | null;
}) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div className="w-full flex justify-end msg-enter">
        <div
          style={{
            maxWidth: '80%',
            background: '#e2e8f0',
            color: '#1e293b',
            borderRadius: '24px',
            padding: '10px 20px',
            fontSize: '16px',
            lineHeight: '1.7',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'flex-start', minWidth: 0 }} className="msg-enter">
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 进度卡 */}
        {msg.running && (
          <div
            style={{
              padding: '14px 18px', borderRadius: '16px', marginBottom: '12px',
              background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(148,163,184,0.12)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Loader2 size={15} className="animate-spin" style={{ color: '#0f766e' }} />
              <span style={{ fontSize: '14px', color: '#334155', fontWeight: 500 }}>{msg.status}</span>
              {msg.progress > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#94a3b8' }}>{msg.progress}%</span>
              )}
            </div>
            <div style={{ marginTop: '10px', height: '4px', borderRadius: '4px', background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(msg.progress, 4)}%`, height: '100%',
                  borderRadius: '4px', background: '#0d9488',
                  transition: 'width 0.6s ease',
                }}
              />
            </div>
            {msg.sources.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>
                已收集 {msg.sources.length} 个来源
              </div>
            )}
          </div>
        )}

        {msg.error && (
          <div
            style={{
              padding: '12px 16px', borderRadius: '16px', fontSize: '14px',
              background: 'rgba(254,243,199,0.7)', color: '#92400e',
              border: '1px solid rgba(251,191,36,0.3)',
            }}
          >
            {msg.error}
          </div>
        )}

        {msg.report && (
          <div
            style={{
              padding: '16px 18px', borderRadius: '16px',
              background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(13,148,136,0.2)',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#0d9488', marginBottom: '8px', letterSpacing: '0.04em' }}>
              研究报告
            </div>
            <div className="md-body" style={{ color: '#334155' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.report}</ReactMarkdown>
            </div>
          </div>
        )}

        {msg.sources.length > 0 && msg.report && (
          <details style={{ marginTop: '10px' }}>
            <summary
              style={{
                cursor: 'pointer', fontSize: '12px', fontWeight: 500, color: '#94a3b8',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <Globe size={13} />
              参考来源（{msg.sources.length}）
            </summary>
            <ol style={{ marginTop: '8px', paddingLeft: '18px', fontSize: '12px', color: '#64748b', lineHeight: 1.8 }}>
              {msg.sources.map((s, i) => (
                <li key={i}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener" style={{ color: '#2563eb', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                      {s.title || s.url}
                    </a>
                  ) : (
                    <span>{s.title}</span>
                  )}
                  {s.domain && <span style={{ color: '#cbd5e1', marginLeft: 4 }}>{s.domain}</span>}
                </li>
              ))}
            </ol>
          </details>
        )}

        {/* 操作栏 */}
        {!msg.running && msg.report && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', opacity: 0.6 }}>
            <button
              type="button"
              onClick={() => onDownloadReport(msg)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 10px', borderRadius: '8px', border: 'none',
                cursor: 'pointer', fontSize: '12px', background: 'transparent', color: '#64748b',
              }}
            >
              {downloadedId === msg.id ? <Check size={13} /> : <FileDown size={13} />}
              {downloadedId === msg.id ? '已下载' : '下载报告 .md'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ------------------------------------------------------------------
// InputPill
// ------------------------------------------------------------------

function InputPill({
  running, input, onInput, onKeyDown, onSend, onStop,
}: {
  running: boolean;
  input: string;
  onInput: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const canSend = input.trim() && !running;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div
        style={{
          width: '100%',
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.65)',
          borderRadius: '28px',
          padding: '6px 12px 6px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.3s ease',
          boxShadow: '0 2px 20px rgba(0,0,0,0.04), 0 8px 40px rgba(0,0,0,0.03)',
        }}
      >
        <textarea
          value={input}
          onChange={onInput}
          onKeyDown={onKeyDown}
          placeholder="想深入研究什么课题？"
          rows={1}
          className={cn(
            'w-full bg-transparent text-[15px] text-slate-800 placeholder-slate-400/50',
            'resize-none focus:outline-none leading-[1.6] min-h-[28px] py-0.5',
          )}
          style={{ maxHeight: 160, flex: 1 }}
          disabled={running}
        />
        <button
          type="button"
          style={{
            flexShrink: 0,
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            cursor: canSend || running ? 'pointer' : 'not-allowed',
            background: running ? 'transparent' : canSend ? '#0f766e' : 'transparent',
            color: running ? '#f87171' : canSend ? '#ffffff' : '#cbd5e1',
            transition: 'all 0.2s ease',
            boxShadow: canSend && !running ? '0 2px 8px rgba(13,148,136,0.25)' : 'none',
          }}
          disabled={!canSend && !running}
          onClick={running ? onStop : onSend}
        >
          {running ? <Square size={14} /> : <ArrowUp size={16} strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// DeepResearchView
// ------------------------------------------------------------------

export function DeepResearchView() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { downloadedId, download } = useDownloadReport();

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    const query = input.trim();
    if (!query || running) return;

    setInput('');
    const userMsg: Msg = { id: uid(), role: 'user', query, content: query, progress: 0, status: '', sources: [] };
    const botMsg: Msg = {
      id: uid(), role: 'assistant', content: '', progress: 4,
      status: '正在启动深度研究…', sources: [], running: true,
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const state: { progress: number; status: string; sources: Source[] } = {
      progress: 4, status: '正在启动深度研究…', sources: [],
    };

    try {
      for await (const ev of api.deepResearchStream(query, controller.signal)) {
        if (ev.event === 'error') throw new Error(ev.error || '研究失败');

        if (ev.event === 'result') {
          setMessages((prev) => prev.map((m) => (m.id === botMsg.id
            ? { ...m, running: false, report: ev.result?.summary || '（研究完成，未返回报告正文）', sources: ev.result?.sources ?? state.sources, progress: 100 }
            : m)));
          continue;
        }

        if (ev.event === 'progress' || ev.event === 'step') {
          state.progress = ev.progress ?? state.progress;
          state.status = ev.message ?? state.status;
        } else if (ev.event === 'source' && ev.source) {
          if (!state.sources.some((s) => s.url && s.url === ev.source?.url)) {
            state.sources = [...state.sources, ev.source];
          }
        }

        setMessages((prev) => prev.map((m) => (m.id === botMsg.id
          ? { ...m, progress: state.progress, status: state.status, sources: [...state.sources] }
          : m)));
      }
      setMessages((prev) => prev.map((m) => (m.id === botMsg.id && m.running ? { ...m, running: false } : m)));
    } catch (e: any) {
      const aborted = e.name === 'AbortError';
      setMessages((prev) => prev.map((m) => (m.id === botMsg.id
        ? {
            ...m,
            running: false,
            error: aborted ? '已停止研究' : `研究失败：${e.message}`,
            report: aborted ? (state as any).partialReport : undefined,
          }
        : m)));
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, [input, running]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleInput = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  const shared = {
    running, input, onInput: handleInput, onKeyDown: handleKeyDown, onSend: handleSend, onStop: handleStop,
  };

  return messages.length === 0 ? (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} className="animate-fade-in">
      <div style={{ textAlign: 'center', marginBottom: '48px' }} className="animate-fade-in-up stagger-1">
        <h1 style={{ fontSize: '32px', fontWeight: 600, color: '#334155', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
          想深入研究什么？
        </h1>
        <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center' }}>
          <span
            style={{
              padding: '6px 16px', borderRadius: '999px', fontSize: '12px',
              color: '#94a3b8', background: 'rgba(255,255,255,0.35)',
              backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.45)',
            }}
          >
            多来源检索 · 自动汇总 · 可下载报告
          </span>
        </div>
      </div>
      <div style={{ width: '100%', padding: '0 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }} className="animate-fade-in-up stagger-2">
        <div style={{ width: '100%', maxWidth: '680px' }}>
          <InputPill {...shared} />
        </div>
        <div style={{ marginTop: '12px', fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>
          研究通常需要几分钟，完成后可下载 Markdown 报告
        </div>
      </div>
    </div>
  ) : (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="w-full flex justify-center">
          <div style={{ width: '100%', maxWidth: '720px', padding: '32px 24px 32px', display: 'flex', flexDirection: 'column', gap: '40px' }}>
            {messages.map((m) => (
              <Bubble key={m.id} msg={m} onDownloadReport={download} downloadedId={downloadedId} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ width: '100%', flexShrink: 0, padding: '8px 24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: '680px' }}>
          <InputPill {...shared} />
        </div>
      </div>
    </div>
  );
}
