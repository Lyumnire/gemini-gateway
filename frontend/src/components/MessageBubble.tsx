import { memo, useState } from 'react';
import type { StoredMessage } from '../types';
import Markdown from './Markdown';
import { CheckIcon, CopyIcon, RefreshIcon, SparkIcon } from './icons';

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
            <div className="rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-white shadow-sm">
              {message.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  const empty = !message.content && !message.reasoning;

  return (
    <div className="fade-in-up flex justify-start">
      <div className="max-w-full min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-indigo-500">
          <SparkIcon className="h-3.5 w-3.5" />
          Gemini
        </div>

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
            className={`rounded-2xl rounded-bl-md px-3.5 py-2.5 shadow-sm ${
              message.error
                ? 'border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200'
                : 'bg-white text-slate-800 ring-1 ring-slate-200/70 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700'
            }`}
          >
            <Markdown content={message.content} />
          </div>
        )}

        <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-slate-400">
          {message.content && !streaming && (
            <button type="button" onClick={copy} className="flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300">
              {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
              {copied ? '已复制' : '复制'}
            </button>
          )}
          {showRetry && !streaming && (
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
