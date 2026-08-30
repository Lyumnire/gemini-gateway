/**
 * ImageGenView — Nano Banana 生图界面（对话式布局，风格与 ChatView 一致）。
 *
 * 走网关 /openai/v1/images/generations（b64_json，=s0 原始分辨率）。
 */

import {
  memo, useCallback, useEffect, useRef, useState,
  type KeyboardEvent, type ChangeEvent,
} from 'react';
import { ArrowUp, Square, Download, Check, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { api } from '@/lib/api_client';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  prompt?: string;
  /** 生成结果（data URL） */
  image?: string;
  generating?: boolean;
  error?: string;
}

let _id = 0;
const uid = () => `img${++_id}`;

// ------------------------------------------------------------------
// 下载原图（PNG 转码，与官网下载一致）
// ------------------------------------------------------------------

function useDownload() {
  const [downloadedId, setDownloadedId] = useState<string | null>(null);
  const download = useCallback((image: string, id: string) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gemini-image-${id}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, 'image/png');
    };
    img.src = image;
    setDownloadedId(id);
    setTimeout(() => setDownloadedId(null), 1500);
  }, []);
  return { downloadedId, download };
}

// ------------------------------------------------------------------
// Bubble — 用户提示词靠右，生成图靠左
// ------------------------------------------------------------------

const Bubble = memo(function Bubble({
  msg, onDownload, downloadedId,
}: {
  msg: Msg;
  onDownload: (image: string, id: string) => void;
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
        {msg.generating && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '14px 18px', borderRadius: '16px', width: 'fit-content',
              background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(148,163,184,0.12)',
            }}
          >
            <Loader2 size={16} className="animate-spin" style={{ color: '#1e293b' }} />
            <span style={{ fontSize: '14px', color: '#475569' }}>正在绘制，约需 10-60 秒…</span>
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

        {msg.image && (
          <div
            style={{
              maxWidth: '480px', borderRadius: '16px', overflow: 'hidden',
              background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(148,163,184,0.15)',
            }}
          >
            <img src={msg.image} alt={msg.prompt} style={{ display: 'block', width: '100%' }} />
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderTop: '1px solid rgba(148,163,184,0.12)',
              }}
            >
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Nano Banana Pro · PNG</span>
              <button
                type="button"
                onClick={() => onDownload(msg.image!, msg.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '5px 12px', borderRadius: '10px', border: 'none',
                  cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                  background: '#0f172a', color: '#ffffff',
                  transition: 'all 0.15s',
                }}
              >
                {downloadedId === msg.id ? <Check size={13} /> : <Download size={13} />}
                {downloadedId === msg.id ? '已下载' : '下载原图'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ------------------------------------------------------------------
// InputPill — 生图输入
// ------------------------------------------------------------------

function InputPill({
  streaming, input, onInput, onKeyDown, onSend, onStop,
}: {
  streaming: boolean;
  input: string;
  onInput: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const canSend = input.trim() && !streaming;

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
          placeholder="描述你想要的画面…"
          rows={1}
          className={cn(
            'w-full bg-transparent text-[15px] text-slate-800 placeholder-slate-400/50',
            'resize-none focus:outline-none leading-[1.6] min-h-[28px] py-0.5',
          )}
          style={{ maxHeight: 160, flex: 1 }}
          disabled={streaming}
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
            cursor: canSend || streaming ? 'pointer' : 'not-allowed',
            background: streaming ? 'transparent' : canSend ? '#0f172a' : 'transparent',
            color: streaming ? '#f87171' : canSend ? '#ffffff' : '#cbd5e1',
            transition: 'all 0.2s ease',
            boxShadow: canSend && !streaming ? '0 2px 8px rgba(15,23,42,0.2)' : 'none',
          }}
          disabled={!canSend && !streaming}
          onClick={streaming ? onStop : onSend}
        >
          {streaming ? <Square size={14} /> : <ArrowUp size={16} strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// ImageGenView
// ------------------------------------------------------------------

export function ImageGenView({ model }: { model: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { downloadedId, download } = useDownload();

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || streaming || !model) return;

    setInput('');
    const userMsg: Msg = { id: uid(), role: 'user', prompt, content: prompt };
    const botMsg: Msg = { id: uid(), role: 'assistant', content: '', generating: true };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await api.generateImage(model, prompt, controller.signal);
      setMessages((prev) => prev.map((m) => (m.id === botMsg.id ? { ...m, image: result.image, generating: false } : m)));
    } catch (e: any) {
      const aborted = e.name === 'AbortError';
      setMessages((prev) => prev.map((m) => (m.id === botMsg.id
        ? { ...m, generating: false, error: aborted ? '已停止生成' : `生成失败：${e.message}` }
        : m)));
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }, [input, streaming, model]);

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
    streaming, input, onInput: handleInput, onKeyDown: handleKeyDown, onSend: handleSend, onStop: handleStop,
  };

  return messages.length === 0 ? (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} className="animate-fade-in">
      <div style={{ textAlign: 'center', marginBottom: '48px' }} className="animate-fade-in-up stagger-1">
        <h1 style={{ fontSize: '32px', fontWeight: 600, color: '#334155', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
          画点什么？
        </h1>
        <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center' }}>
          <span
            style={{
              padding: '6px 16px', borderRadius: '999px', fontSize: '12px',
              color: '#94a3b8', background: 'rgba(255,255,255,0.35)',
              backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.45)',
            }}
          >
            Nano Banana Pro · 下载为 PNG 原图
          </span>
        </div>
      </div>
      <div style={{ width: '100%', padding: '0 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }} className="animate-fade-in-up stagger-2">
        <div style={{ width: '100%', maxWidth: '680px' }}>
          <InputPill {...shared} />
        </div>
      </div>
    </div>
  ) : (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="w-full flex justify-center">
          <div style={{ width: '100%', maxWidth: '720px', padding: '32px 24px 32px', display: 'flex', flexDirection: 'column', gap: '40px' }}>
            {messages.map((m) => (
              <Bubble key={m.id} msg={m} onDownload={download} downloadedId={downloadedId} />
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
