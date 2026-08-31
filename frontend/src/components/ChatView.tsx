/**
 * ChatView — 统一对话视图（官网式工具融合）。
 *
 * + 菜单即工具入口：
 *   - 上传文件：图片（视觉输入）或 TXT/MD（内联文本）
 *   - 生成图片：Nano Banana Pro，产图以卡片嵌入对话流
 *   - 深度研究：进度 → 来源 → Markdown 报告
 * 三种产物都留在同一对话流里，无缝衔接。
 */

import React, {
  memo, useCallback, useEffect, useRef, useState,
  type KeyboardEvent, type ChangeEvent,
} from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  FileText, Copy, RotateCw, Check,
  ChevronDown, Brain, Loader2, Download, Globe,
} from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

import { api, type ChatMessage } from '@/lib/api_client';
import { parseThinkingMessage } from '@/lib/think_parser';
import { Composer, type Tool, type AttachedFile } from './Composer';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Source {
  title?: string;
  url?: string;
  domain?: string;
}

interface ResearchState {
  progress: number;
  status: string;
  sources: Source[];
  done: boolean;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 思考过程（reasoning_content 流式累积） */
  thinking?: string;
  /** 生图结果（data URL） */
  image?: string;
  /** 深度研究状态 */
  research?: ResearchState;
  /** 用户附件 */
  attachment?: {
    type: 'image' | 'text';
    filename: string;
    previewUrl?: string;
    dataUrl?: string;
    text?: string;
  };
  streaming?: boolean;
  error?: boolean;
}

let _id = 0;
const uid = () => `m${++_id}`;


// ------------------------------------------------------------------
// 生成图下载（PNG 转码）
// ------------------------------------------------------------------

function downloadImage(image: string, id: string) {
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
}

// ------------------------------------------------------------------
// Bubble — 统一渲染：文本 / 思考 / 生图 / 深度研究
// ------------------------------------------------------------------

const Bubble = memo(function Bubble({
  msg, onCopy, onRetry, enableThinking, onDownloadImage, onDownloadReport, downloadedReportId,
}: {
  msg: Msg;
  onCopy?: () => void;
  onRetry?: () => void;
  enableThinking?: boolean;
  onDownloadImage?: (image: string, id: string) => void;
  onDownloadReport?: (msg: Msg) => void;
  downloadedReportId?: string | null;
}) {
  const isUser = msg.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    onCopy?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [onCopy]);

  // ---- 全部 hooks 前置（条件 return 之前，保证每次渲染调用顺序恒定）----

  // 等待反馈计时（仅在等待期运行）
  const [elapsed, setElapsed] = useState(0);
  const waitingPhase = Boolean(msg.streaming && !msg.content && !msg.thinking && !msg.image && !msg.research);
  useEffect(() => {
    if (!waitingPhase) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [waitingPhase]);

  // 思考面板开关（思考中自动展开，正文出现自动折叠）
  const [thinkingOpen, setThinkingOpen] = useState(false);

  // 思考内容派生（不依赖 hooks，可安全在 return 前计算）
  const parsed = parseThinkingMessage(msg.content);
  const streamThought = enableThinking ? (msg.thinking ?? '') : '';
  const thought = streamThought.length > 0 ? streamThought : (enableThinking ? parsed.thought : '');
  const isThinking = Boolean(msg.streaming && streamThought && !msg.content);
  const hasThinking = thought.length > 0;

  useEffect(() => {
    if (isThinking) setThinkingOpen(true);
    else if (hasThinking && !isThinking) setThinkingOpen(false);
  }, [isThinking, hasThinking]);

  if (isUser) {
    return (
      <div className="w-full flex justify-end msg-enter">
        <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {msg.attachment?.type === 'image' && msg.attachment.previewUrl && (
            <img
              src={msg.attachment.previewUrl}
              alt={msg.attachment.filename}
              style={{ maxWidth: 280, borderRadius: 16, border: '1px solid rgba(148,163,184,0.15)' }}
            />
          )}
          {msg.attachment?.type === 'text' && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                borderRadius: 14, background: 'rgba(255,255,255,0.6)',
                border: '1px solid rgba(148,163,184,0.15)', fontSize: 12, color: '#64748b',
              }}
            >
              <FileText size={14} /> {msg.attachment.filename}
            </div>
          )}
          {msg.content && (
            <div
              style={{
                background: '#e2e8f0', color: '#1e293b', borderRadius: '24px',
                padding: '10px 20px', fontSize: '16px', lineHeight: 1.7,
                wordBreak: 'break-word', whiteSpace: 'pre-wrap',
              }}
            >
              {msg.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- 助手消息 ----

  // 等待反馈：后端为"完成后切块下发"的伪流式，首字前需要等待
  if (waitingPhase) {
    return (
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4, paddingTop: 8 }} className="msg-enter">
        <Loader2 size={14} className="animate-spin" style={{ color: '#94a3b8', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: '#94a3b8' }}>
          正在生成…{elapsed > 0 && <span style={{ marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{elapsed}s</span>}
        </span>
      </div>
    );
  }

  // 生图结果卡片
  if (msg.image) {
    return (
      <div style={{ width: '100%', display: 'flex', minWidth: 0 }} className="msg-enter">
        <div style={{ flex: 1, minWidth: 0, maxWidth: 480 }}>
          <div
            style={{
              borderRadius: 16, overflow: 'hidden',
              background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(148,163,184,0.15)',
            }}
          >
            <img src={msg.image} alt="生成结果" style={{ display: 'block', width: '100%' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 10px', borderTop: '1px solid rgba(148,163,184,0.12)' }}>
              <button
                type="button"
                onClick={() => onDownloadImage?.(msg.image!, msg.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
                  borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12,
                  fontWeight: 500, background: '#0f172a', color: '#fff',
                }}
              >
                <Download size={13} /> 下载原图
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 深度研究卡片
  if (msg.research) {
    const r = msg.research;
    return (
      <div style={{ width: '100%', display: 'flex', minWidth: 0 }} className="msg-enter">
        <div style={{ flex: 1, minWidth: 0 }}>
          {r.done && msg.error && (
            <div style={{ padding: '12px 16px', borderRadius: 16, fontSize: 14, background: 'rgba(254,243,199,0.7)', color: '#92400e', border: '1px solid rgba(251,191,36,0.3)' }}>
              {msg.error}
            </div>
          )}
          {!r.done && (
            <div
              style={{
                padding: '14px 18px', borderRadius: 16, marginBottom: 12,
                background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(12px)',
                border: '1px solid rgba(148,163,184,0.12)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Loader2 size={15} className="animate-spin" style={{ color: '#0f766e' }} />
                <span style={{ fontSize: 14, color: '#334155', fontWeight: 500 }}>{r.status}</span>
                {r.progress > 0 && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{r.progress}%</span>}
              </div>
              <div style={{ marginTop: 10, height: 4, borderRadius: 4, background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(r.progress, 4)}%`, height: '100%', borderRadius: 4, background: '#0d9488', transition: 'width 0.6s ease' }} />
              </div>
              {r.sources.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>已收集 {r.sources.length} 个来源</div>
              )}
            </div>
          )}
          {r.done && msg.content && (
            <div
              style={{
                padding: '16px 18px', borderRadius: 16,
                background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(12px)',
                border: '1px solid rgba(13,148,136,0.2)',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: '#0d9488', marginBottom: 8, letterSpacing: '0.04em' }}>
                研究报告
              </div>
              <div className="md-body" style={{ color: '#334155' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.content}</ReactMarkdown>
              </div>
            </div>
          )}
          {r.done && r.sources.length > 0 && msg.content && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 500, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Globe size={13} /> 参考来源（{r.sources.length}）
              </summary>
              <ol style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: '#64748b', lineHeight: 1.8 }}>
                {r.sources.map((s, i) => (
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
          {r.done && msg.content && onDownloadReport && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, opacity: 0.6 }}>
              <button
                type="button"
                onClick={() => onDownloadReport(msg)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                  borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
                  background: 'transparent', color: '#64748b',
                }}
              >
                {downloadedReportId === msg.id ? <Check size={13} /> : <Download size={13} />}
                {downloadedReportId === msg.id ? '已下载' : '下载报告 .md'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- 普通文本（含思考面板；派生值已在顶部计算）----
  // 3.1 Pro 聊天生图时返回 _528\n![image](https://lh3.googleusercontent.com/...)
  const contentRaw = parsed.answer || (hasThinking ? '' : msg.content) || '';
  const imageUrls = [...contentRaw.matchAll(/(?:https?:\/\/lh[\w.-]*\.googleusercontent\.com\/[^\)\s"\x60]+)|(?:!\[image\]\(https?:\/\/[^\)]+\))|(?:!\[[^\]]*\]\(https?:\/\/lh[\w.-]*\.googleusercontent\.com\/[^\)]+\))/g)]
    .map((m) => { const u = m[0].match(/https?:\/\/[^\)\s"]+/); return u ? u[0] : ''; })
    .filter(Boolean);
  const textForMarkdown = contentRaw.replace(/!\[[^\]]*\]\(https?:\/\/[^\)]+\)/g, '').replace(/https?:\/\/lh[\w.-]*\.googleusercontent\.com\/[^\)\s"\x60]+/g, '').replace(/^\s*_\d+\s*\n?/, '').trim();



  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'flex-start', minWidth: 0 }} className="msg-enter">
      <div style={{ flex: 1, minWidth: 0 }}>
        {hasThinking && (
          <Collapsible open={thinkingOpen} onOpenChange={setThinkingOpen}>
            <CollapsibleTrigger
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', marginBottom: 8,
                borderRadius: 10, border: 'none', cursor: 'pointer',
                background: thinkingOpen ? 'rgba(241,245,249,0.8)' : 'transparent',
                transition: 'all 0.2s ease',
                width: '100%', textAlign: 'left',
              }}
              onMouseEnter={(e) => { if (!thinkingOpen) e.currentTarget.style.background = 'rgba(241,245,249,0.5)'; }}
              onMouseLeave={(e) => { if (!thinkingOpen) e.currentTarget.style.background = 'transparent'; }}
            >
              {isThinking ? (
                <Loader2 size={14} className="animate-spin" style={{ color: '#1e293b', flexShrink: 0 }} />
              ) : (
                <Brain size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
              )}
              <span style={{ fontSize: 13, color: isThinking ? '#1e293b' : '#94a3b8', fontWeight: 500 }}>
                {isThinking ? '正在深入思考...' : '查看思考过程'}
              </span>
              <ChevronDown
                size={13}
                style={{ color: '#94a3b8', flexShrink: 0, marginLeft: 'auto', transition: 'transform 0.2s ease', transform: thinkingOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </CollapsibleTrigger>
            <CollapsibleContent style={{ overflow: 'hidden', transition: 'all 0.3s ease' }}>
              <div style={{ borderLeft: '2px solid #1e293b', marginLeft: 6, padding: '8px 12px', marginBottom: 12, background: 'rgba(241,245,249,0.6)', borderRadius: '0 8px 8px 0' }}>
                <div className="md-body" style={{ fontSize: 13, lineHeight: 1.7, color: '#64748b', wordBreak: 'break-word' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{thought}</ReactMarkdown>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="md-body" style={{ fontSize: 16, lineHeight: 1.8, color: '#334155', wordBreak: 'break-word' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{textForMarkdown}</ReactMarkdown>
          {msg.streaming && msg.content && <span className="cursor-blink" aria-hidden />}
        </div>

        {imageUrls.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {imageUrls.map((url, i) => (
              <figure key={i} style={{ maxWidth: 480, borderRadius: 16, overflow: 'hidden', background: 'rgba(255,255,255,0.72)', border: '1px solid rgba(148,163,184,0.15)' }}>
                <img
                  src={`/proxy-image/g?src=${encodeURIComponent(url)}`}
                  alt={'gen '+(i+1)}
                  loading="lazy"
                  style={{ display: 'block', width: '100%' }}
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    img.style.display = 'none';
                    const fallback = document.createElement('div');
                    fallback.style.cssText = 'padding:12px;text-align:center;font-size:12px;color:#94a3b8;';
                    fallback.innerHTML = '图片加载失败 <a href="'+url+'" target="_blank" style="color:#2563eb;word-break:break-all">'+url.slice(0,80)+'…</a>';
                    img.parentElement?.insertBefore(fallback, img);
                  }}
                />
                <figcaption style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 10px', borderTop: '1px solid rgba(148,163,184,0.12)' }}>
                  <button type="button" onClick={() => onDownloadImage?.(url, msg.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: '#0f172a', color: '#fff' }}>
                    <Download size={13} /> 下载原图
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {!msg.streaming && msg.content && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, opacity: 0.5, transition: 'opacity 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; }}
          >
            <button
              onClick={handleCopy}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'transparent', color: '#64748b' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(148,163,184,0.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              title="复制"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {onRetry && (
              <button
                onClick={onRetry}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'transparent', color: '#64748b' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(148,163,184,0.15)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                title="重试"
              >
                <RotateCw size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ------------------------------------------------------------------
// useReportDownload — 报告下载
// ------------------------------------------------------------------

function useReportDownload() {
  const [downloadedReportId, setDownloadedReportId] = useState<string | null>(null);
  const download = useCallback((msg: Msg) => {
    const blob = new Blob([msg.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-${msg.id}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setDownloadedReportId(msg.id);
    setTimeout(() => setDownloadedReportId(null), 1500);
  }, []);
  return { downloadedReportId, download };
}

// ------------------------------------------------------------------
// ViewErrorBoundary — 渲染异常兜底（防整树卸载白屏）
// ------------------------------------------------------------------

class ViewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#64748b' }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#b91c1c' }}>渲染出错：{this.state.error.message}</div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{ padding: '6px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#0f172a', color: '#fff', fontSize: 13 }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ------------------------------------------------------------------
// ChatView
// ------------------------------------------------------------------

export function ChatView({
  model, models: _models, activeTool, onToolChange,
  currentSessionId, onSessionCreated,
}: {
  model: string;
  models: unknown;
  activeTool: Tool | null;
  onToolChange: (t: Tool | null) => void;
  currentSessionId: number | null;
  onSessionCreated: (id: number) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [enableThinking, setEnableThinking] = useState(false);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { downloadedReportId, download: downloadReport } = useReportDownload();

  const sessionIdRef = useRef<number | null>(currentSessionId);
  sessionIdRef.current = currentSessionId;

  // 会话历史加载（localStorage 适配层，同步）
  useEffect(() => {
    if (!currentSessionId || streaming) {
      if (!currentSessionId) setMessages([]);
      return;
    }
    const data = api.getSessionMessages(currentSessionId);
    setMessages(data.messages.map((m) => ({
      id: uid(),
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })));
  }, [currentSessionId, streaming]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // ---- 附件（图片 data URL / 文本内容）----

  const handleAttach = useCallback((f: AttachedFile) => {
    setAttachedFile(f);
  }, []);

  const handleDetach = useCallback(() => {
    setAttachedFile(null);
  }, []);

  // ---- 保存会话消息 ----

  const persistMessages = useCallback((sessionId: number | null, msgs: Msg[]) => {
    if (!sessionId) return;
    api.saveSessionMessages(
      sessionId,
      msgs.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content })),
    );
  }, []);

  // ---- 发送（按工具分流）----

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && !attachedFile) || streaming) return;
    if (!text && activeTool !== 'image') return;

    setInput('');
    const currentAttachment = attachedFile;
    setAttachedFile(null);

    // 确保会话存在
    let activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      const session = api.createSession(text.slice(0, 50) || '新对话', 'chat', activeTool ?? model);
      activeSessionId = session.id;
      sessionIdRef.current = session.id;
      onSessionCreated(session.id);
    }

    const attachment = currentAttachment ? {
      type: currentAttachment.type,
      filename: currentAttachment.file.name,
      previewUrl: currentAttachment.type === 'image' ? currentAttachment.dataUrl : undefined,
      dataUrl: currentAttachment.type === 'image' ? currentAttachment.dataUrl : undefined,
      text: currentAttachment.type === 'text' ? currentAttachment.text : undefined,
    } : undefined;

    const userMsg: Msg = {
      id: uid(),
      role: 'user',
      content: activeTool === 'image' ? text : text || `(附件：${attachment?.filename ?? ''})`,
      attachment,
    };

    const botMsg: Msg = { id: uid(), role: 'assistant', content: '', streaming: true };
    setMessages((prev) => [...prev, userMsg, botMsg]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // 思考开关：Flash 开启时路由到 Extended Thinking 变体
    let reqModel = model;
    if (enableThinking && !activeTool && model === 'gemini-3-flash-preview') {
      reqModel = 'gemini-3-flash-extended';
    }

    const finish = (patch: Partial<Msg>, opts: { persist?: boolean } = {}) => {
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === botMsg.id
          ? { ...m, ...patch, streaming: opts.persist ? false : m.streaming }
          : m));
        if (opts.persist) persistMessages(activeSessionId, next);
        return next;
      });
    };

    try {
      // ---- 深度研究工具 ----
      if (activeTool === 'research') {
        const state = { progress: 4, status: '正在启动深度研究…', sources: [] as Source[] };
        for await (const ev of api.deepResearchStream(text, controller.signal)) {
          if (ev.event === 'error') throw new Error(ev.error || '研究失败');
          if (ev.event === 'result') {
            finish({
              research: { progress: 100, status: '完成', sources: ev.result?.sources ?? state.sources, done: true },
              content: ev.result?.summary || '（研究完成，未返回报告正文）',
            });
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
            ? { ...m, research: { ...state, done: false } }
            : m)));
        }
        finish({ research: { ...state, done: true }, streaming: false }, { persist: true });
      }
      // ---- 普通对话（含图片视觉 / 文本附件）----
      else {
        let outboundText = text;
        if (attachment?.type === 'text' && attachment.text) {
          outboundText = `${text}\n\n--- 附件：${attachment.filename} ---\n${attachment.text}`;
        }
        const history: ChatMessage[] = [
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: outboundText },
        ];

        let acc = '';
        let thinking = '';
        let lastFlush = 0;
        for await (const event of api.chatCompletion(
          reqModel, history, 2048, 0.7,
          attachment?.type === 'image' ? attachment.dataUrl : undefined,
          undefined, controller.signal, enableThinking, activeSessionId,
        )) {
          if (event.type === 'content') {
            acc += event.text;
            const now = Date.now();
            if (now - lastFlush >= 120) { lastFlush = now; finish({ content: acc }); }
          } else if (event.type === 'thinking') {
            thinking += event.text;
            const now = Date.now();
            if (now - lastFlush >= 120) { lastFlush = now; finish({ thinking }); }
          }
        }
        finish({ content: acc, thinking, streaming: false }, { persist: true });
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        finish({ streaming: false }, { persist: true });
      } else {
        finish({ content: `加载失败: ${e.message}`, error: true, streaming: false }, { persist: true });
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }, [input, streaming, model, messages, attachedFile, activeTool, enableThinking, onSessionCreated, persistMessages]);

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

  const handleCopyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content).catch(() => {});
  }, []);

  // 重试（仅普通文本消息）
  const [retryTrigger, setRetryTrigger] = useState<Msg[] | null>(null);

  useEffect(() => {
    if (!retryTrigger) return;
    const botMsg: Msg = { id: uid(), role: 'assistant', content: '', streaming: true };
    const newMessages = [...retryTrigger, botMsg];
    setMessages(newMessages);
    setStreaming(true);
    setRetryTrigger(null);

    const history: ChatMessage[] = retryTrigger.map((m) => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        let acc = '';
        for await (const event of api.chatCompletion(model, history, 2048, 0.7, undefined, undefined, controller.signal, enableThinking, sessionIdRef.current)) {
          if (event.type === 'content') {
            acc += event.text;
            const snap = acc;
            setMessages((ms) => ms.map((m) => (m.id === botMsg.id ? { ...m, content: snap } : m)));
          }
        }
        setMessages((ms) => ms.map((m) => (m.id === botMsg.id ? { ...m, streaming: false } : m)));
      } catch (e: any) {
        setMessages((ms) => ms.map((m) => (m.id === botMsg.id ? { ...m, streaming: false, content: `加载失败: ${e.message}` } : m)));
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    })();
  }, [retryTrigger, model, enableThinking]);

  const handleRetryMessage = useCallback((messageId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx < 0) return prev;
      const userMsgIdx = idx - 1;
      if (userMsgIdx < 0) return prev;
      const kept = prev.slice(0, userMsgIdx + 1);
      setTimeout(() => setRetryTrigger(kept), 0);
      return kept;
    });
  }, []);

  const shared = {
    tool: activeTool,
    attached: attachedFile,
    streaming,
    input,
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onSend: handleSend,
    onStop: handleStop,
    onToolChange,
    onAttach: handleAttach,
    onDetach: handleDetach,
    enableThinking,
    onToggleThinking: () => setEnableThinking((v) => !v),
    thinkingType: 'controllable',
  };

  const emptyView = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} className="animate-fade-in">
      <div style={{ textAlign: 'center', marginBottom: 48 }} className="animate-fade-in-up stagger-1">
        <h1 style={{ fontSize: 32, fontWeight: 600, color: '#334155', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
          有什么可以帮你的？
        </h1>
      </div>
      <div style={{ width: '100%', padding: '0 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }} className="animate-fade-in-up stagger-2">
        <div style={{ width: '100%', maxWidth: 680 }}>
          <Composer {...shared} />
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
          Gemini Web v{__BUILD_ID__} · 可能会犯错，请核查重要信息。
        </div>
      </div>
    </div>
  );

  const chatStream = (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="w-full flex justify-center">
          <div style={{ width: '100%', maxWidth: 720, padding: '32px 24px 32px', display: 'flex', flexDirection: 'column', gap: 40 }}>
            {messages.map((m) => (
              <Bubble
                key={m.id}
                msg={m}
                enableThinking={enableThinking}
                onCopy={m.role === 'assistant' && m.content ? () => handleCopyMessage(m.content) : undefined}
                onRetry={m.role === 'assistant' && !streaming && m.content && !m.image && !m.research ? () => handleRetryMessage(m.id) : undefined}
                onDownloadImage={downloadImage}
                onDownloadReport={downloadReport}
                downloadedReportId={downloadedReportId}
              />
            ))}
          </div>
        </div>
      </div>
      <div style={{ width: '100%', flexShrink: 0, padding: '8px 24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 680 }}>
          <Composer {...shared} />
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
          Gemini Web v{__BUILD_ID__} · 可能会犯错，请核查重要信息。
        </div>
      </div>
    </div>
  );

  return <ViewErrorBoundary>{messages.length === 0 ? emptyView : chatStream}</ViewErrorBoundary>;
}
