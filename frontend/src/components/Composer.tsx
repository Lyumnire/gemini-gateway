/**
 * Composer — OmniHermit「Gemini 级别大气悬浮输入框」原样保留，
 * 仅在 + 按钮上叠加官网式工具菜单：上传文件 / 生成图片 / 深度研究。
 * 激活的工具以胶囊标签显示在 + 的位置（点击 ✕ 取消）。
 */

import {
  useCallback, useEffect, useRef, useState,
  type KeyboardEvent, type ChangeEvent, type DragEvent,
} from 'react';
import {
  ArrowUp, Square, Plus, X, FileText, ImageIcon, Telescope, Check,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { cn } from '@/lib/utils';

export type Tool = 'image' | 'research';

export interface AttachedFile {
  file: File;
  type: 'image' | 'text';
  /** 文件的 data URL（base64 编码） */
  dataUrl?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 文本文件的内容（仅纯文本） */
  text?: string;
  previewUrl?: string;
}

interface Props {
  tool: Tool | null;
  attached: AttachedFile[];
  streaming: boolean;
  input: string;
  onToolChange: (t: Tool | null) => void;
  onAttach: (f: AttachedFile) => void;
  onDetach: (index?: number) => void;
  onInput: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
  compact?: boolean;
  enableThinking?: boolean;
  onToggleThinking?: () => void;
  thinkingType?: string;
}

const TOOL_META: Record<Tool, { label: string; icon: typeof ImageIcon }> = {
  image: { label: '生成图片', icon: ImageIcon },
  research: { label: '深度研究', icon: Telescope },
};

export function Composer({
  tool, attached, streaming, input, onToolChange, onAttach, onDetach,
  onInput, onKeyDown, onSend, onStop, compact,
  enableThinking, onToggleThinking, thinkingType = 'controllable',
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = '28px';
    }
  }, [input]);

  // + 按钮现在打开工具菜单（上传文件 / 生成图片 / 深度研究）
  const handlePlusClick = useCallback(() => {
    setMenuOpen((v) => !v);
  }, []);

  const handleMenuUpload = useCallback(() => {
    fileInputRef.current?.click();
    setMenuOpen(false);
  }, []);

  const handleMenuTool = useCallback((t: Tool) => {
    onToolChange(tool === t ? null : t);
    setMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [onToolChange, tool]);

  const processFile = useCallback((file: File) => {
    if (tool) return; // 工具激活时不接受附件
    if (attached.length >= 10) return; // 最多10份

    if (file.type.startsWith('image/')) {
      // 图片：读取为 data URL
      const reader = new FileReader();
      reader.onload = () =>
        onAttach({ file, type: 'image', dataUrl: reader.result as string, mimeType: file.type, previewUrl: reader.result as string });
      reader.readAsDataURL(file);
    } else if (file.type === 'text/plain' || /\.(txt|md)$/i.test(file.name)) {
      // 纯文本：读取为文本内容
      const reader = new FileReader();
      reader.onload = () =>
        onAttach({ file, type: 'text', text: String(reader.result || ''), mimeType: 'text/plain' });
      reader.readAsText(file);
    } else {
      // 其他文件（PDF、doc 等）：读取为 data URL
      const reader = new FileReader();
      reader.onload = () =>
        onAttach({ file, type: 'text', dataUrl: reader.result as string, mimeType: file.type || 'application/octet-stream' });
      reader.readAsDataURL(file);
    }
  }, [onAttach, tool, attached.length]);

  const handleFileInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    files.forEach((file) => processFile(file));
  }, [processFile]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files || []);
    files.forEach((file) => processFile(file));
  }, [processFile]);

  const canSend = (input.trim() || (!tool && attached.length > 0)) && !streaming;


  // 思考开关（omnihermit 原样）
  const ThinkingToggle = (
    <>
      <span style={{ fontSize: '13px', color: enableThinking ? '#1e293b' : '#94a3b8', fontWeight: 500, flexShrink: 0, userSelect: 'none' }}>
        Extended
      </span>
      <button
        type="button"
        onClick={onToggleThinking}
        style={{
          flexShrink: 0,
          height: '28px',
          padding: '0',
          borderRadius: '14px',
          border: 'none',
          cursor: 'pointer',
          background: enableThinking ? '#1e293b' : '#e2e8f0',
          transition: 'background 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          width: '48px',
        }}
        title={enableThinking ? '思考模式：开' : '思考模式：关'}
      >
        <div style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background: '#ffffff',
          position: 'absolute',
          top: '3px',
          left: enableThinking ? '23px' : '3px',
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }} />
      </button>
    </>
  );

  const SendButton = (
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
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: 'relative', width: '100%' }}
    >
      {/* 拖拽覆盖层 */}
      {dragOver && (
        <div
          style={{
            position: 'absolute',
            inset: '-4px',
            borderRadius: '32px',
            border: '2px dashed rgba(100,116,139,0.4)',
            background: 'rgba(148,163,184,0.08)',
            backdropFilter: 'blur(4px)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>
            松开以附加文件
          </span>
        </div>
      )}

      {/* 工具菜单浮层 */}
      {menuOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div
            className="scale-in"
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: 0,
              zIndex: 20,
              width: '240px',
              borderRadius: '16px',
              overflow: 'hidden',
              padding: '5px',
              background: '#ffffff',
              border: '1px solid rgba(148,163,184,0.25)',
              boxShadow: '0 12px 40px rgba(15,23,42,0.14)',
            }}
          >
            <button
              type="button"
              onClick={handleMenuUpload}
              disabled={!!tool}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 12px', fontSize: 14, borderRadius: 11, border: 'none',
                cursor: tool ? 'not-allowed' : 'pointer', background: 'transparent',
                color: tool ? '#cbd5e1' : '#334155', transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { if (!tool) e.currentTarget.style.background = 'rgba(15,23,42,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <FileText size={16} style={{ color: tool ? '#cbd5e1' : '#94a3b8', flexShrink: 0 }} />
              上传文件
              <span style={{ marginLeft: 'auto', fontSize: 10, color: tool ? '#cbd5e1' : '#94a3b8' }}>
                最多10份
              </span>
            </button>
            <div style={{ height: 1, margin: '4px 8px', background: 'linear-gradient(to right, transparent, rgba(148,163,184,0.25), transparent)' }} />
            {(['image', 'research'] as Tool[]).map((t) => {
              const { label, icon: Icon } = { label: TOOL_META[t].label, icon: TOOL_META[t].icon };
              const active = tool === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleMenuTool(t)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '9px 12px', fontSize: 14, borderRadius: 11, border: 'none',
                    cursor: 'pointer',
                    background: active ? 'rgba(15,23,42,0.06)' : 'transparent',
                    color: active ? '#1e293b' : '#334155', transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(15,23,42,0.04)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icon size={16} style={{ color: active ? '#1e293b' : '#94a3b8', flexShrink: 0 }} />
                  {label}
                  {active && <Check size={15} style={{ marginLeft: 'auto', color: '#1e293b' }} />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 附件预览 */}
      {attached.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {attached.map((f, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.6)',
                backdropFilter: 'blur(12px)',
                borderRadius: 12,
                border: '1px solid rgba(148,163,184,0.12)',
                maxWidth: 200,
              }}
            >
              {f.type === 'image' && (f.previewUrl || f.dataUrl) ? (
                <div style={{ width: 28, height: 28, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9' }}>
                  <img src={f.previewUrl || f.dataUrl} alt={f.file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ) : (
                <FileText size={16} style={{ color: '#64748b', flexShrink: 0 }} />
              )}
              <span style={{ fontSize: 12, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.file.name}
              </span>
              <button
                type="button"
                onClick={() => onDetach(i)}
                style={{ width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0 }}
              >
                <X size={12} style={{ color: '#94a3b8' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.txt,.md,.pdf,.doc,.docx,.json,.csv,.py,.js,.ts,.go,.java,.c,.cpp,.h,.hpp,.rs,.rb,.php,.swift,.kt,.scala,.sh,.bash,.yaml,.yml,.toml,.ini,.cfg,.conf,.log,.xml,.html,.css,.sql,.r,.m,.mm"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* 输入框主体 — 固定布局，不随多行切换 */}
      <div
        style={{
          width: '100%',
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.65)',
          borderRadius: compact ? '28px' : '32px',
          padding: compact ? '6px 12px 6px 16px' : '10px 12px 10px 16px',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: '8px',
          boxShadow: focused
            ? '0 0 0 1px rgba(148,163,184,0.15), 0 8px 40px rgba(0,0,0,0.08), 0 20px 60px rgba(0,0,0,0.05)'
            : '0 2px 20px rgba(0,0,0,0.04), 0 8px 40px rgba(0,0,0,0.03)',
        }}
      >
        {/* 左侧：+ 按钮 / 工具胶囊 */}
        <AnimatePresence mode="popLayout" initial={false}>
          {tool ? (
            <motion.button
              key="tool-chip"
              type="button"
              onClick={() => onToolChange(null)}
              title="取消工具"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 32, padding: '0 12px', border: 'none', cursor: 'pointer',
                background: '#0f172a', color: '#ffffff',
                fontSize: 13, fontWeight: 500, flexShrink: 0,
                borderRadius: '16px',
              }}
            >
              {tool === 'image' ? <ImageIcon size={14} /> : <Telescope size={14} />}
              {tool === 'image' ? 'Images' : 'Deep Research'}
              <X size={13} style={{ opacity: 0.7 }} />
            </motion.button>
          ) : (
            <motion.button
              key="plus"
              type="button"
              onClick={handlePlusClick}
              tabIndex={-1}
              title="工具菜单"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              style={{
                flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer',
                background: menuOpen ? '#0f172a' : 'transparent',
                color: menuOpen ? '#ffffff' : '#94a3b8',
                marginBottom: compact ? 0 : 2,
              }}
            >
              <Plus size={18} strokeWidth={2} style={{ transform: menuOpen ? 'rotate(45deg)' : 'none', transition: 'transform 0.15s ease' }} />
            </motion.button>
          )}
        </AnimatePresence>

        {/* 中间：文本输入区（自动增长） */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={onInput}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={tool === 'image' ? '描述你想要的画面…' : tool === 'research' ? '想深入研究什么课题？' : '输入消息…'}
          rows={1}
          className={cn(
            'w-full bg-transparent text-[15px] text-slate-800 placeholder-slate-400/50',
            'resize-none focus:outline-none leading-[1.6]',
            compact ? 'py-0.5' : 'py-1',
          )}
          style={{ maxHeight: 160, minHeight: 28, flex: 1 }}
          disabled={streaming}
        />

        {/* 右侧：思考开关 + 发送按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginBottom: compact ? 0 : 2 }}>
          {(thinkingType === 'controllable' || thinkingType === 'forced') && ThinkingToggle}
          {SendButton}
        </div>
      </div>
    </div>
  );
}
