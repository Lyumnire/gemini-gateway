import { memo, useState } from 'react';
import type { StoredMessage } from '../types';
import Markdown from './Markdown';
import { CheckIcon, CopyIcon, RefreshIcon, SparkIcon } from './icons';

/** 把图片（data URL 或远程 URL）转成 PNG 并触发下载，与官网"下载原图"一致 */
async function downloadImage(src: string, filename: string): Promise<void> {
  try {
    let blob: Blob;
    if (src.startsWith('data:image/png')) {
      blob = await (await fetch(src)).blob();
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = src;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('转码失败'))), 'image/png'),
      );
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    // 转码失败时退化为直接打开原图
    window.open(src, '_blank');
  }
}

interface Props {
  message: StoredMessage;
  streaming?: boolean;
  showRetry?: boolean;
  onRetry?: () => void;
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="思考中">
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-indigo-500" />
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-indigo-500" />
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-indigo-500" />
    </span>
  );
}

function MessageBubble({ message, streaming, showRetry, onRetry }: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略 */
    }
  };

  if (isUser) {
    return (
      <div className="fade-in-up flex justify-end">
        <div className="max-w-[85%]">
          {message.images && message.images.length > 0 && (
            <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
              {message.images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`附件 ${i + 1}`}
                  className="max-h-36 rounded-xl border border-black/5 object-cover"
                />
              ))}
            </div>
          )}
          {message.content && (
            <div
              className="rounded-2xl rounded-br-md px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-slate-800 shadow-sm backdrop-blur-sm dark:text-slate-100"
              style={{
                background: 'var(--bubble-user-bg)',
                border: '1px solid var(--bubble-user-border)',
              }}
            >
              {message.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  const empty = !message.content && !message.reasoning && !message.images?.length;

  return (
    <div className="fade-in-up flex justify-start">
      <div className="max-w-full min-w-0 flex-1">
        <div className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${message.research ? 'text-teal-500' : 'text-indigo-500'}`}>
          <SparkIcon className="h-3.5 w-3.5" />
          Gemini
        </div>

        {message.research && !message.research.done && (
          <div className="mb-1.5 rounded-xl border border-teal-200/50 bg-teal-50/50 px-3 py-2.5 backdrop-blur-sm dark:border-teal-800/50 dark:bg-teal-950/25">
            <div className="flex items-center justify-between text-xs text-teal-700 dark:text-teal-300">
              <span className="flex items-center gap-1.5">
                <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-teal-500 motion-reduce:animate-none" />
                {message.research.message || '研究进行中…'}
              </span>
              {message.research.progress > 0 && <span>{message.research.progress}%</span>}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-900">
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-500"
                style={{ width: `${message.research.progress || 5}%` }}
              />
            </div>
            {message.research.sources.length > 0 && (
              <p className="mt-1.5 text-[11px] text-teal-600/80 dark:text-teal-400/80">
                已收集 {message.research.sources.length} 个来源
              </p>
            )}
          </div>
        )}

        {message.images && message.images.length > 0 && (
          <div className="mb-1.5 flex flex-col gap-2">
            {message.images.map((src, i) => (
              <figure
                key={i}
                className="w-full max-w-md overflow-hidden rounded-2xl border border-white/40 shadow-sm backdrop-blur-sm dark:border-white/10"
                style={{ background: 'var(--glass-bg)' }}
              >
                <img src={src} alt={`生成结果 ${i + 1}`} className="w-full" />
                <figcaption className="flex items-center justify-end gap-2 px-3 py-1.5">
                  <span className="text-[10px] text-slate-400">PNG · 原图</span>
                  <button
                    type="button"
                    onClick={() => void downloadImage(src, `gemini-image-${Date.now()}.png`)}
                    className="rounded-lg bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-900/10 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/20"
                  >
                    下载原图
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {message.reasoning && (
          <details className="mb-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400" open={streaming && !message.content}>
            <summary className="cursor-pointer select-none font-medium">思考过程</summary>
            <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap">{message.reasoning}</div>
          </details>
        )}

        {empty ? (
          streaming ? (
            <ThinkingDots />
          ) : (
            <div className="text-sm text-slate-400">（空回复）</div>
          )
        ) : (
          <div
            className={`rounded-2xl rounded-bl-md px-3.5 py-2.5 shadow-sm backdrop-blur-sm ${
              message.error
                ? 'border border-amber-300/70 bg-amber-50/80 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200'
                : message.research
                  ? 'border border-teal-200/50 bg-white/60 text-slate-800 dark:border-teal-800/50 dark:bg-slate-800/50 dark:text-slate-100'
                  : 'glass-strong text-slate-800 dark:text-slate-100'
            }`}
          >
            <Markdown content={message.content} />
            {streaming && message.content && <span className="cursor-blink" aria-hidden />}
          </div>
        )}

        {message.research && message.research.sources.length > 0 && message.research.done && (
          <details className="mt-1.5 rounded-xl bg-slate-100/80 px-3 py-2 text-xs dark:bg-slate-800/60">
            <summary className="cursor-pointer select-none font-medium text-slate-500 dark:text-slate-400">
              参考来源（{message.research.sources.length}）
            </summary>
            <ol className="mt-1.5 space-y-1.5">
              {message.research.sources.map((s, i) => (
                <li key={i} className="leading-snug">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">
                      {s.title || s.url}
                    </a>
                  ) : (
                    <span className="text-slate-600 dark:text-slate-300">{s.title}</span>
                  )}
                  {s.domain && <span className="ml-1 text-slate-400">{s.domain}</span>}
                </li>
              ))}
            </ol>
          </details>
        )}

        <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-slate-400">
          {message.content && !streaming && (
            <button type="button" onClick={copy} className="flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300">
              {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
              {copied ? '已复制' : '复制'}
            </button>
          )}
          {showRetry && !streaming && onRetry && (
            <button type="button" onClick={onRetry} className="flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300">
              <RefreshIcon className="h-3 w-3" />
              重试
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MessageBubble);
