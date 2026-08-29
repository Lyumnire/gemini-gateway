import { useEffect, useRef, useState } from 'react';
import type { Conversation } from '../types';
import type { UiMode } from '../lib/storage';
import MessageBubble from './MessageBubble';
import Composer from './Composer';
import { ChevronDownIcon, MenuIcon, SparkIcon } from './icons';

interface Props {
  conversation: Conversation;
  uiMode: UiMode;
  imageTool: boolean;
  model: string;
  models: string[];
  busy: boolean;
  onUiModeChange: (m: UiMode) => void;
  onImageToolChange: (on: boolean) => void;
  onModelChange: (m: string) => void;
  onOpenSidebar: () => void;
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
  onRetry?: () => void;
}

const SUGGESTIONS: Record<'chat' | 'image' | 'research', string[]> = {
  chat: [
    '用通俗易懂的方式解释一下量子纠缠',
    '帮我写一首关于秋天的现代诗',
    '三天两夜的上海旅行计划，喜欢美食和漫步',
    '把下面这段话翻译成英文并润色：……',
  ],
  image: [
    '赛博朋克风格的霓虹城市夜景，雨后倒影',
    '一只漂浮在太空中的橘猫，扁平插画',
    '极简主义海报：远山与日出，留白构图',
    '水彩风格的江南水乡清晨',
  ],
  research: [
    '深度比较：固态电池与氢能源的产业化前景',
    '研究 2026 年手机影像技术的演进路线',
    '分析远程办公对一线城市住房结构的影响',
    '梳理开源大模型许可证的差异与风险',
  ],
};

export default function ChatView({
  conversation,
  uiMode,
  imageTool,
  model,
  models,
  busy,
  onUiModeChange,
  onImageToolChange,
  onModelChange,
  onOpenSidebar,
  onSend,
  onStop,
  onRetry,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const messages = conversation.messages;
  const lastMsg = messages[messages.length - 1];
  const showRetry = !busy && lastMsg?.role === 'assistant' && !!lastMsg.error;

  // 新消息/流式更新时，若用户停在底部则自动滚动
  useEffect(() => {
    if (pinned) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, pinned]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setPinned(nearBottom);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      setPinned(true);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* 顶栏 */}
      <header
        className="flex items-center gap-1 border-b border-slate-200/80 bg-white/80 px-2 backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/80"
        style={{ paddingTop: 'max(0.4rem, var(--safe-top))', paddingBottom: '0.4rem' }}
      >
        <button
          type="button"
          aria-label="打开菜单"
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
        >
          <MenuIcon />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold">{conversation.title}</h1>
        {uiMode === 'chat' && !imageTool && (
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            aria-label="选择模型"
            className="max-w-[9.5rem] truncate rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-xs text-slate-500 outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            {(models.length ? models : [model]).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </header>

      {/* 消息区 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto overscroll-contain px-3 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 pb-16 text-center">
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg ${
                imageTool
                  ? 'bg-gradient-to-br from-fuchsia-500 to-purple-600'
                  : uiMode === 'research'
                    ? 'bg-gradient-to-br from-teal-500 to-cyan-600'
                    : 'bg-gradient-to-br from-indigo-500 to-violet-600'
              }`}
            >
              <SparkIcon className="h-7 w-7" />
            </div>
            <div>
              <p className="text-lg font-semibold">
                {imageTool ? '描述你想要的画面' : uiMode === 'research' ? '想深入研究什么？' : '有什么可以帮你？'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {imageTool
                  ? '生成结果以图片形式展示'
                  : uiMode === 'research'
                    ? '会自动检索多个来源并汇总成报告'
                    : '由 Mac 上的 Gemini 网页版会话驱动'}
              </p>
            </div>
            <div className="grid w-full max-w-md grid-cols-1 gap-2 px-2 sm:grid-cols-2">
              {(imageTool ? SUGGESTIONS.image : SUGGESTIONS[uiMode]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSend(s, [])}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] leading-snug text-slate-600 shadow-sm transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                streaming={busy && i === messages.length - 1 && m.role === 'assistant'}
                showRetry={showRetry && i === messages.length - 1}
                onRetry={onRetry}
              />
            ))}
            <div className="h-2" />
          </div>
        )}

        {!pinned && messages.length > 0 && (
          <button
            type="button"
            aria-label="回到底部"
            onClick={scrollToBottom}
            className="sticky bottom-2 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md transition-colors hover:text-indigo-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <ChevronDownIcon className="h-4.5 w-4.5" />
          </button>
        )}
      </div>

      <Composer
        uiMode={uiMode}
        imageTool={imageTool}
        busy={busy}
        onUiModeChange={onUiModeChange}
        onImageToolChange={onImageToolChange}
        onSend={onSend}
        onStop={onStop}
      />
    </div>
  );
}
