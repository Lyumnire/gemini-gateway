import { useRef, useState, type KeyboardEvent } from 'react';
import { CloseIcon, ImageIcon, SendIcon, StopIcon } from './icons';

interface Props {
  busy: boolean;
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
}

const MAX_IMAGES = 4;

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Composer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 触屏设备上 Enter 换行、按钮发送；桌面 Enter 发送、Shift+Enter 换行
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const canSend = (text.trim().length > 0 || images.length > 0) && !busy;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), images);
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
      {images.length > 0 && (
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
        <button
          type="button"
          aria-label="添加图片"
          disabled={busy || images.length >= MAX_IMAGES}
          onClick={() => fileRef.current?.click()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-200/70 disabled:opacity-40 dark:hover:bg-slate-700"
        >
          <ImageIcon />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          placeholder="给 Gemini 发送消息…"
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow transition-colors hover:bg-indigo-700 disabled:opacity-40"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
