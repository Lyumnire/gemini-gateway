/**
 * Composer — 官网式 + 工具菜单：上传文件 / 生成图片 / 深度研究。
 * 激活的工具以胶囊标签形式显示在输入框左侧，点击 ✕ 取消。
 */

import { useRef, useState, type KeyboardEvent, type ChangeEvent } from 'react';
import { ArrowUp, Square, ImageIcon, Telescope, X, Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export type Tool = 'image' | 'research';

export interface AttachedFile {
  file: File;
  type: 'image' | 'text';
  /** 图片的 data URL（视觉输入） */
  dataUrl?: string;
  /** 文本文件的内容（内联进消息） */
  text?: string;
}

interface Props {
  tool: Tool | null;
  attached: AttachedFile | null;
  streaming: boolean;
  input: string;
  onToolChange: (t: Tool | null) => void;
  onAttach: (f: AttachedFile) => void;
  onDetach: () => void;
  onInput: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
}

const TOOL_META: Record<Tool, { label: string; icon: typeof ImageIcon }> = {
  image: { label: '生成图片', icon: ImageIcon },
  research: { label: '深度研究', icon: Telescope },
};

export function Composer({
  tool, attached, streaming, input, onToolChange, onAttach, onDetach,
  onInput, onKeyDown, onSend, onStop,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = input.trim() && !streaming;

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () =>
        onAttach({ file, type: 'image', dataUrl: reader.result as string });
      reader.readAsDataURL(file);
    } else if (/\.(txt|md)$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = () =>
        onAttach({ file, type: 'text', text: String(reader.result || '') });
      reader.readAsText(file);
    }
    setMenuOpen(false);
  };

  const pickTool = (t: Tool) => {
    onToolChange(tool === t ? null : t);
    setMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* + 工具菜单 */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="glass-strong scale-in absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-2xl shadow-lg">
            <label
              className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.06]"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="text-slate-400">📎</span>
              上传文件
              <span className="ml-auto text-[10px] text-slate-400">图片 / TXT</span>
            </label>
            <div className="mx-3 my-1 h-px bg-slate-900/[0.06] dark:bg-white/[0.08]" />
            {(['image', 'research'] as Tool[]).map((t) => {
              const Icon = TOOL_META[t].icon;
              const active = tool === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => pickTool(t)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors',
                    active
                      ? 'bg-slate-900/[0.05] text-slate-900 dark:bg-white/[0.08] dark:text-white'
                      : 'text-slate-700 hover:bg-slate-900/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.06]',
                  )}
                >
                  <Icon className={active ? 'h-4 w-4 text-indigo-500' : 'h-4 w-4 text-slate-400'} />
                  {TOOL_META[t].label}
                  {active && <Check className="ml-auto h-4 w-4 text-indigo-500" />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 隐藏文件输入：图片 + 文本 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.txt,.md"
        className="hidden"
        onChange={handleFile}
      />

      {/* 输入舱主体 */}
      <div
        className="w-full rounded-[28px] border border-white/65 bg-white/72 px-4 py-2.5 shadow-[0_2px_20px_rgba(0,0,0,0.04),0_8px_40px_rgba(0,0,0,0.03)] backdrop-blur-2xl transition-shadow dark:border-white/10 dark:bg-slate-800/60"
      >
        {/* 工具胶囊 / 附件预览 */}
        {(tool || attached) && (
          <div className="mb-1.5 flex items-center gap-2">
            {tool && (
              <span className="flex items-center gap-1.5 rounded-full bg-slate-900/[0.06] px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-white/[0.1] dark:text-slate-200">
                {tool === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <Telescope className="h-3.5 w-3.5" />}
                {tool === 'image' ? 'Images' : 'Deep Research'}
                <button
                  type="button"
                  aria-label="取消工具"
                  onClick={() => onToolChange(null)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-slate-900/10 dark:hover:bg-white/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {attached && (
              <span className="flex max-w-[240px] items-center gap-1.5 truncate rounded-full bg-slate-900/[0.06] px-3 py-1.5 text-xs text-slate-700 dark:bg-white/[0.1] dark:text-slate-200">
                📎 {attached.file.name}
                <button
                  type="button"
                  aria-label="移除附件"
                  onClick={onDetach}
                  className="rounded-full p-0.5 hover:bg-slate-900/10 dark:hover:bg-white/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* + 按钮 */}
          <button
            type="button"
            aria-label="工具菜单"
            disabled={streaming}
            onClick={() => setMenuOpen((v) => !v)}
            tabIndex={-1}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
              menuOpen
                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'text-slate-400 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.08]',
            )}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <span className="text-[20px] leading-none">+</span>}
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInput}
            onKeyDown={onKeyDown}
            placeholder={tool === 'image' ? '描述你想要的画面…' : tool === 'research' ? '想深入研究什么课题？' : '输入消息…'}
            rows={1}
            className="max-h-40 min-h-[28px] w-full flex-1 resize-none bg-transparent text-[15px] leading-[1.6] text-slate-800 placeholder-slate-400/50 focus:outline-none dark:text-slate-100 dark:placeholder-slate-500"
            disabled={streaming}
          />

          <button
            type="button"
            aria-label={streaming ? '停止' : '发送'}
            disabled={!canSend && !streaming}
            onClick={streaming ? onStop : onSend}
            style={{ boxShadow: canSend && !streaming ? '0 2px 10px rgba(15,23,42,0.25)' : 'none' }}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all',
              streaming
                ? 'text-red-400'
                : canSend
                  ? 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200'
                  : 'text-slate-300 dark:text-slate-600',
            )}
          >
            {streaming ? <Square className="h-4 w-4" /> : <ArrowUp className="h-5 w-5" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
