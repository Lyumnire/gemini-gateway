import { useRef, useState, type KeyboardEvent } from 'react';
import { CloseIcon, ImageIcon, PlusIcon, SendIcon, SparkIcon, StopIcon, TelescopeIcon } from './icons';

interface Props {
  uiMode: 'chat' | 'research';
  imageTool: boolean;
  busy: boolean;
  onUiModeChange: (m: 'chat' | 'research') => void;
  onImageToolChange: (on: boolean) => void;
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
}

const MAX_IMAGES = 4;

const MODE_META = {
  chat: { label: '对话', accent: 'bg-indigo-600 hover:bg-indigo-700' },
  research: { label: '深度研究', accent: 'bg-teal-600 hover:bg-teal-700' },
} as const;

const PLACEHOLDER = {
  chat: '给 Gemini 发送消息…',
  research: '想深入研究什么课题？',
} as const;

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Composer({
  uiMode,
  imageTool,
  busy,
  onUiModeChange,
  onImageToolChange,
  onSend,
  onStop,
}: Props) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 触屏设备上 Enter 换行、按钮发送；桌面 Enter 发送、Shift+Enter 换行
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const canSend = (text.trim().length > 0 || (uiMode === 'chat' && !imageTool && images.length > 0)) && !busy;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), uiMode === 'chat' && !imageTool ? images : []);
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

  const accent = imageTool ? 'bg-fuchsia-600 hover:bg-fuchsia-700' : MODE_META[uiMode].accent;

  return (
    <div className="glass relative z-10 border-t border-t-white/40 px-3 pb-[max(0.6rem,var(--safe-bottom))] pt-2 dark:border-t-white/5">
      {/* + 工具菜单 */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="glass-strong scale-in absolute bottom-full left-3 z-20 mb-2 w-56 overflow-hidden rounded-2xl shadow-lg">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                fileRef.current?.click();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.04] disabled:opacity-40 dark:text-slate-200 dark:hover:bg-white/[0.06]"
            >
              <ImageIcon className="h-4 w-4 text-slate-400" />
              上传图片
              <span className="ml-auto text-[10px] text-slate-400">看图</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onUiModeChange('chat');
                onImageToolChange(!imageTool);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.04] disabled:opacity-40 dark:text-slate-200 dark:hover:bg-white/[0.06]"
            >
              <SparkIcon className={`h-4 w-4 ${imageTool ? 'text-fuchsia-500' : 'text-slate-400'}`} />
              {imageTool ? '关闭生成图片' : '生成图片'}
              <span className="ml-auto text-[10px] text-slate-400">文生图</span>
            </button>
          </div>
        </>
      )}

      {/* 模式与工具状态行 */}
      <div className="mb-2 flex items-center gap-1.5">
        {(Object.keys(MODE_META) as (keyof typeof MODE_META)[]).map((m) => {
          const active = uiMode === m && !imageTool;
          const Icon = m === 'chat' ? SparkIcon : TelescopeIcon;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              disabled={imageTool}
              onClick={() => onUiModeChange(m)}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 disabled:opacity-50 ${
                active
                  ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {MODE_META[m].label}
            </button>
          );
        })}
        {imageTool && (
          <span
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-fuchsia-700 backdrop-blur-sm dark:text-fuchsia-300"
            style={{ background: 'var(--bubble-user-bg)', border: '1px solid var(--bubble-user-border)' }}
          >
            生成图片
            <button
              type="button"
              aria-label="关闭生成图片"
              onClick={() => onImageToolChange(false)}
              className="rounded-full p-0.5 hover:bg-fuchsia-200 dark:hover:bg-fuchsia-900"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      {uiMode === 'chat' && !imageTool && images.length > 0 && (
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
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void pickImages(e.target.files)}
        />
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="工具菜单"
            disabled={busy}
            onClick={() => setMenuOpen((v) => !v)}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
              menuOpen
                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'text-slate-500 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.08]'
            }`}
          >
            {menuOpen ? <CloseIcon /> : <PlusIcon />}
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          placeholder={imageTool ? '描述你想要的画面…' : PLACEHOLDER[uiMode]}
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-slate-300/50 bg-white/60 px-3.5 py-2.5 text-[15px] leading-snug shadow-sm outline-none backdrop-blur placeholder:text-slate-400 transition-shadow focus:border-indigo-300 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.08)] dark:border-slate-600/50 dark:bg-slate-800/50 dark:text-slate-100 dark:focus:shadow-[0_0_0_3px_rgba(129,140,248,0.12)]"
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
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow transition-colors disabled:opacity-40 ${accent}`}
          >
            <SendIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
