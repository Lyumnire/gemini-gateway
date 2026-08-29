import { useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMode } from '../types';
import { CloseIcon, ImageIcon, SendIcon, SparkIcon, StopIcon, TelescopeIcon } from './icons';

interface Props {
  mode: ChatMode;
  busy: boolean;
  onModeChange: (m: ChatMode) => void;
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
}

const MAX_IMAGES = 4;

const MODE_META: Record<ChatMode, { label: string; accent: string }> = {
  chat: { label: '对话', accent: 'bg-indigo-600 hover:bg-indigo-700' },
  image: { label: '画图', accent: 'bg-fuchsia-600 hover:bg-fuchsia-700' },
  research: { label: '深度研究', accent: 'bg-teal-600 hover:bg-teal-700' },
};

const MODE_PLACEHOLDER: Record<ChatMode, string> = {
  chat: '给 Gemini 发送消息…',
  image: '描述你想要的画面…',
  research: '想深入研究什么课题？',
};

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Composer({ mode, busy, onModeChange, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 触屏设备上 Enter 换行、按钮发送；桌面 Enter 发送、Shift+Enter 换行
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const canSend = (text.trim().length > 0 || (mode === 'chat' && images.length > 0)) && !busy;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), mode === 'chat' ? images : []);
    setText('');
    setImages([]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault();
      submit();
    }
  };

  const pickImages = async (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, MAX_IMAGES - images.length);
    const urls = await Promise.all(picked.map(fileToDataUrl));
    setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="border-t border-slate-200/80 bg-slate-50/90 px-3 pb-[max(0.6rem,var(--safe-bottom))] pt-2 backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90">
      {/* 模式切换：每个模式一个"引擎"，颜色即身份 */}
      <div
        role="tablist"
        aria-label="模式"
        className="mb-2 flex w-fit gap-1 rounded-full bg-slate-200/80 p-1 dark:bg-slate-800"
      >
        {(Object.keys(MODE_META) as ChatMode[]).map((m) => {
          const active = m === mode;
          const Icon = m === 'chat' ? SparkIcon : m === 'image' ? ImageIcon : TelescopeIcon;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onModeChange(m)}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 ${
                active
                  ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {MODE_META[m].label}
            </button>
          );
        })}
      </div>

      {mode === 'chat' && images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt={`待发送 ${i + 1}`} className="h-16 w-16 rounded-lg border border-black/5 object-cover" />
              <button
                type="button"
                aria-label="移除图片"
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white shadow"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {mode === 'chat' ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void pickImages(e.target.files)}
            />
            <button
              type="button"
              aria-label="添加图片"
              disabled={busy || images.length >= MAX_IMAGES}
              onClick={() => fileRef.current?.click()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-200/70 disabled:opacity-40 dark:hover:bg-slate-700"
            >
              <ImageIcon />
            </button>
          </>
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
            <span className={`h-2.5 w-2.5 rounded-full ${mode === 'image' ? 'bg-fuchsia-500' : 'bg-teal-500'}`} />
          </span>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          placeholder={MODE_PLACEHOLDER[mode]}
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] leading-snug outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-900/50"
        />

        {busy ? (
          <button
            type="button"
            aria-label="停止生成"
            onClick={onStop}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-600 text-white shadow transition-colors hover:bg-slate-700"
          >
            <StopIcon className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="发送"
            disabled={!canSend}
            onClick={submit}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow transition-colors disabled:opacity-40 ${MODE_META[mode].accent}`}
          >
            <SendIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
