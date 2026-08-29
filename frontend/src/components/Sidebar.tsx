import type { Conversation } from '../types';
import type { ThemeMode } from '../lib/storage';
import { CloseIcon, PlusIcon, TrashIcon } from './icons';

interface Props {
  open: boolean;
  conversations: Conversation[];
  activeId: string | null;
  theme: ThemeMode;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onThemeChange: (mode: ThemeMode) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export default function Sidebar({
  open,
  conversations,
  activeId,
  theme,
  onClose,
  onNew,
  onSelect,
  onDelete,
  onThemeChange,
}: Props) {
  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        className={`fixed bottom-0 left-0 top-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-out dark:border-slate-700 dark:bg-slate-900 lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">对话记录</span>
          <button
            type="button"
            aria-label="关闭侧栏"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-3">
          <button
            type="button"
            onClick={() => {
              onNew();
              onClose();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            <PlusIcon className="h-4 w-4" />
            新对话
          </button>
        </div>

        <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-slate-400">暂无对话</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded-xl px-2.5 py-2 transition-colors ${
                c.id === activeId
                  ? 'bg-indigo-50 dark:bg-indigo-950/50'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(c.id);
                  onClose();
                }}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-sm text-slate-700 dark:text-slate-200">{c.title}</div>
                <div className="text-[11px] text-slate-400">{formatTime(c.updatedAt)}</div>
              </button>
              <button
                type="button"
                aria-label="删除对话"
                onClick={() => {
                  if (window.confirm(`删除「${c.title}」？`)) onDelete(c.id);
                }}
                className="rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 dark:text-slate-600"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 px-3 py-2.5 dark:border-slate-700">
          <label className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>外观</span>
            <select
              value={theme}
              onChange={(e) => onThemeChange(e.target.value as ThemeMode)}
              className="rounded-lg border border-slate-200 bg-transparent px-1.5 py-1 text-xs outline-none dark:border-slate-600 dark:bg-slate-800"
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-300 dark:text-slate-600">
            Gemini Web Gateway · 私人部署
          </p>
        </div>
      </aside>
    </>
  );
}
