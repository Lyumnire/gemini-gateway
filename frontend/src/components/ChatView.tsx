/**
 *
 * 核心修复：
 * - 用 flex justify-center 替代 max-w + mx-auto（后者在深嵌套 flex 中失效）
 * - 用户气泡改为浅灰色（匹配输入框风格）
 * - 输入框和气泡强制居中
 *
 * 新增功能：
 * - 文件上传：点击 + 按钮选择文件 / 拖拽文件到输入区域
 * - 图片和文档预览
 */

import {
  memo, useCallback, useEffect, useRef, useState,
  type KeyboardEvent, type ChangeEvent, type DragEvent,
} from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Square, ArrowUp, Plus, X, FileText, Copy, RotateCw, Check, ChevronDown, Brain, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

import { cn } from '@/lib/utils';
import { api, type ChatMessage, type ModelList } from '@/lib/api_client';
import { parseThinkingMessage } from '@/lib/think_parser';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 思考过程（reasoning_content 流式累积） */
  thinking?: string;
  streaming?: boolean;
  /** Token 输出速率 (token/s) */
  tokenRate?: number;
  /** 附件信息（用户消息时存在） */
  attachment?: {
    type: 'image' | 'document';
    filename: string;
    previewUrl?: string; // 图片的本地预览 URL
    serverPath?: string; // 服务端路径（用于重试）
  };
}

interface AttachedFile {
  file: File;
  serverPath?: string; // 上传后的服务器路径
  previewUrl?: string; // 图片本地预览
  type: 'image' | 'document';
  uploading: boolean;
  error?: string;
}

let _id = 0;
const uid = () => `m${++_id}`;

// 网关仅支持图片输入（内联 data URL）
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.bmp', '.webp', '.gif',
]);

function getFileType(file: File): 'image' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  return 'document';
}

function isFileAllowed(file: File): boolean {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

// ------------------------------------------------------------------
// Bubble — 非对称：用户靠右浅灰气泡，AI 靠左无气泡纯文本
// ------------------------------------------------------------------

const Bubble = memo(function Bubble({ msg, onCopy, onRetry, enableThinking }: { msg: Msg; onCopy?: () => void; onRetry?: () => void; enableThinking?: boolean }) {
  const isUser = msg.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    onCopy?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [onCopy]);

  if (isUser) {
    return (
      <div className="w-full flex justify-end msg-enter">
        <div
          style={{
            maxWidth: '80%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {/* 附件预览 */}
          {msg.attachment && (
            <div
              style={{
                maxWidth: '280px',
                borderRadius: '16px',
                overflow: 'hidden',
                border: '1px solid rgba(148,163,184,0.15)',
                background: 'rgba(255,255,255,0.8)',
              }}
            >
              {msg.attachment.type === 'image' && msg.attachment.previewUrl ? (
                <img
                  src={msg.attachment.previewUrl}
                  alt={msg.attachment.filename}
                  style={{
                    display: 'block',
                    maxHeight: '200px',
                    objectFit: 'cover',
                    width: '100%',
                  }}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px 16px',
                  }}
                >
                  <FileText size={20} style={{ color: '#64748b', flexShrink: 0 }} />
                  <span
                    style={{
                      fontSize: '13px',
                      color: '#475569',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {msg.attachment.filename}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 消息文本 */}
          {msg.content && (
            <div
              style={{
                background: '#e2e8f0',
                color: '#1e293b',
                borderRadius: '24px',
                padding: '10px 20px',
                fontSize: '16px',
                lineHeight: '1.7',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}
            >
              {msg.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 思考内容：优先使用 reasoning_content 流（msg.thinking），兼容 <think> 标签
  const parsed = parseThinkingMessage(msg.content);
  const streamThought = enableThinking ? (msg.thinking ?? '') : '';
  const thought = streamThought.length > 0 ? streamThought : (enableThinking ? parsed.thought : '');
  const isThinking = Boolean(msg.streaming && streamThought && !msg.content);
  const hasThinking = thought.length > 0;
  const [thinkingOpen, setThinkingOpen] = useState(isThinking);

  // 正在思考时自动展开，思考结束后自动折叠
  useEffect(() => {
    if (isThinking) setThinkingOpen(true);
    else if (hasThinking && !isThinking) setThinkingOpen(false);
  }, [isThinking, hasThinking]);

  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'flex-start', minWidth: 0 }} className="msg-enter">
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 思考面板 — 仅在有思考内容时显示 */}
        {hasThinking && (
          <Collapsible open={thinkingOpen} onOpenChange={setThinkingOpen}>
            <CollapsibleTrigger
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 10px', marginBottom: '8px',
                borderRadius: '10px', border: 'none', cursor: 'pointer',
                background: thinkingOpen ? 'rgba(241,245,249,0.8)' : 'transparent',
                transition: 'all 0.2s ease',
                width: '100%', textAlign: 'left',
              }}
              onMouseEnter={(e) => { if (!thinkingOpen) e.currentTarget.style.background = 'rgba(241,245,249,0.5)'; }}
              onMouseLeave={(e) => { if (!thinkingOpen) e.currentTarget.style.background = 'transparent'; }}
            >
              {parsed.isThinking ? (
                <Loader2 size={14} className="animate-spin" style={{ color: '#1e293b', flexShrink: 0 }} />
              ) : (
                <Brain size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
              )}
              <span style={{ fontSize: '13px', color: parsed.isThinking ? '#1e293b' : '#94a3b8', fontWeight: 500 }}>
                {parsed.isThinking ? '正在深入思考...' : '查看思考过程'}
              </span>
              <ChevronDown
                size={13}
                style={{
                  color: '#94a3b8', flexShrink: 0, marginLeft: 'auto',
                  transition: 'transform 0.2s ease',
                  transform: thinkingOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </CollapsibleTrigger>
            <CollapsibleContent
              style={{
                overflow: 'hidden',
                transition: 'all 0.3s ease',
              }}
            >
              <div
                style={{
                  borderLeft: '2px solid #1e293b',
                  marginLeft: '6px',
                  padding: '8px 12px',
                  marginBottom: '12px',
                  background: 'rgba(241,245,249,0.6)',
                  borderRadius: '0 8px 8px 0',
                }}
              >
                <div className="md-body" style={{ fontSize: '13px', lineHeight: '1.7', color: '#64748b', wordBreak: 'break-word' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {parsed.thought}
                  </ReactMarkdown>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 正式回答 */}
        <div className="md-body" style={{ fontSize: '16px', lineHeight: '1.8', color: '#334155', wordBreak: 'break-word' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {parsed.answer || (hasThinking ? '' : msg.content)}
          </ReactMarkdown>
        </div>

        {/* 操作栏 — 流式结束后显示 */}
        {!msg.streaming && msg.content && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', opacity: 0.5, transition: 'opacity 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; }}
          >
            {msg.tokenRate != null && (
              <span style={{ fontSize: '11px', color: '#94a3b8', marginRight: '4px', userSelect: 'none' }}>
                {msg.tokenRate} token/s
              </span>
            )}
            <button
              onClick={handleCopy}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '28px', height: '28px', borderRadius: '8px',
                border: 'none', cursor: 'pointer', background: 'transparent',
                color: '#64748b', transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(148,163,184,0.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              title="复制"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '28px', height: '28px', borderRadius: '8px',
                  border: 'none', cursor: 'pointer', background: 'transparent',
                  color: '#64748b', transition: 'all 0.15s',
                }}
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
// FilePreview — 已附加文件的预览卡片
// ------------------------------------------------------------------

function FilePreview({ attached, onRemove }: { attached: AttachedFile; onRemove: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px',
        marginBottom: '8px',
        background: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(12px)',
        borderRadius: '14px',
        border: '1px solid rgba(148,163,184,0.12)',
      }}
    >
      {/* 图片缩略图或文件图标 */}
      {attached.type === 'image' && attached.previewUrl ? (
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            overflow: 'hidden',
            flexShrink: 0,
            background: '#f1f5f9',
          }}
        >
          <img
            src={attached.previewUrl}
            alt={attached.file.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      ) : (
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f1f5f9',
            flexShrink: 0,
          }}
        >
          <FileText size={18} style={{ color: '#64748b' }} />
        </div>
      )}

      {/* 文件名 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: '#334155',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {attached.file.name}
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>
          {attached.uploading ? '上传中…' : attached.error ? attached.error : `${(attached.file.size / 1024).toFixed(1)} KB`}
        </div>
      </div>

      {/* 删除按钮 */}
      <button
        type="button"
        onClick={onRemove}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(148,163,184,0.1)',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(148,163,184,0.2)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(148,163,184,0.1)'; }}
      >
        <X size={14} style={{ color: '#64748b' }} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------
// InputPill — Gemini 级别大气悬浮输入框 + 文件上传
// ------------------------------------------------------------------

function InputPill({
  streaming, input, onInput, onKeyDown, onSend, onStop, compact,
  attachedFile, onFileSelect, onFileRemove, onFileDrop,
  enableThinking, onToggleThinking, thinkingType,
}: {
  streaming: boolean;
  input: string;
  onInput: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
  compact?: boolean;
  attachedFile: AttachedFile | null;
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
  onFileDrop: (file: File) => void;
  enableThinking?: boolean;
  onToggleThinking?: () => void;
  thinkingType?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [isMultiline, setIsMultiline] = useState(false);

  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      setIsMultiline(false);
    }
  }, [input]);

  // 检测是否多行：输入包含换行符 或 textarea 高度超过单行
  const checkMultiline = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      const hasNewline = input.includes('\n');
      const isTooTall = el.scrollHeight > 40;
      setIsMultiline(hasNewline || isTooTall);
    }
  }, [input]);

  const handlePlusClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
      // 重置 input 以允许重复选择同一文件
      e.target.value = '';
    }
  }, [onFileSelect]);

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

    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileDrop(file);
    }
  }, [onFileDrop]);

  const canSend = (input.trim() || attachedFile?.serverPath) && !streaming;

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

      {/* 文件预览 */}
      {attachedFile && (
        <FilePreview attached={attachedFile} onRemove={onFileRemove} />
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.bmp,.webp,.gif,.txt,.pdf,.docx,.html,.htm"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* 输入框主体 */}
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
          flexDirection: isMultiline ? 'column' : 'row',
          alignItems: isMultiline ? 'stretch' : 'center',
          gap: isMultiline ? '4px' : '8px',
          transition: 'all 0.3s ease',
          boxShadow: focused
            ? '0 0 0 1px rgba(148,163,184,0.15), 0 8px 40px rgba(0,0,0,0.08), 0 20px 60px rgba(0,0,0,0.05)'
            : '0 2px 20px rgba(0,0,0,0.04), 0 8px 40px rgba(0,0,0,0.03)',
        }}
      >
        {/* Plus 按钮 — 单行时在左侧，多行时在底部 */}
        {!isMultiline && (
          <button
            type="button"
            onClick={handlePlusClick}
            style={{
              flexShrink: 0,
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
              color: '#94a3b8',
              transition: 'all 0.15s',
            }}
            tabIndex={-1}
            title="附加文件"
          >
            <Plus size={18} strokeWidth={2} />
          </button>
        )}

        {/* 文本输入区 */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => { onInput(e); checkMultiline(); }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="输入消息…"
          rows={1}
          className={cn(
            'w-full bg-transparent text-[15px] text-slate-800 placeholder-slate-400/50',
            'resize-none focus:outline-none leading-[1.6] min-h-[28px]',
            compact ? 'py-0.5' : 'py-1',
          )}
          style={{ maxHeight: 160, flex: isMultiline ? undefined : 1 }}
          disabled={streaming}
        />

        {/* 多行时：底部按钮栏 */}
        {isMultiline && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
            <button
              type="button"
              onClick={handlePlusClick}
              style={{
                flexShrink: 0,
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                color: '#94a3b8',
                transition: 'all 0.15s',
              }}
              tabIndex={-1}
              title="附加文件"
            >
              <Plus size={18} strokeWidth={2} />
            </button>
            {/* 右侧：思考开关 + 发送按钮 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {(thinkingType === 'controllable' || thinkingType === 'forced') && (
                <>
                  <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500, flexShrink: 0, userSelect: 'none' }}>
                    思考
                  </span>
                  <button
                    type="button"
                    onClick={thinkingType === 'controllable' ? onToggleThinking : undefined}
                    disabled={thinkingType === 'forced'}
                    style={{
                      flexShrink: 0,
                      height: '28px',
                      padding: '0',
                      borderRadius: '14px',
                      border: 'none',
                      cursor: thinkingType === 'forced' ? 'not-allowed' : 'pointer',
                      background: (thinkingType === 'forced' || enableThinking) ? '#1e293b' : '#e2e8f0',
                      transition: 'background 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      position: 'relative',
                      width: '48px',
                      opacity: thinkingType === 'forced' ? 0.7 : 1,
                    }}
                    title={
                      thinkingType === 'forced'
                        ? '该模型为原生推理模型，必须思考'
                        : enableThinking ? '思考模式：开' : '思考模式：关'
                    }
                  >
                    <div style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: '#ffffff',
                      position: 'absolute',
                      top: '3px',
                      left: (thinkingType === 'forced' || enableThinking) ? '23px' : '3px',
                      transition: 'left 0.2s ease',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    }} />
                  </button>
                </>
              )}
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
            </div>
          </div>
        )}

        {/* 单行时：思考开关 + 发送按钮在右侧 */}
        {!isMultiline && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {/* 思考模式开关 — 根据 thinkingType 决定状态 */}
            {(thinkingType === 'controllable' || thinkingType === 'forced') && (
              <>
                <span style={{ fontSize: '13px', color: enableThinking ? '#1e293b' : '#94a3b8', fontWeight: 500, flexShrink: 0, userSelect: 'none' }}>
                  思考
                </span>
                <button
                type="button"
                onClick={thinkingType === 'controllable' ? onToggleThinking : undefined}
                disabled={thinkingType === 'forced'}
                style={{
                  flexShrink: 0,
                  height: '28px',
                  padding: '0',
                  borderRadius: '14px',
                  border: 'none',
                  cursor: thinkingType === 'forced' ? 'not-allowed' : 'pointer',
                  background: (thinkingType === 'forced' || enableThinking) ? '#1e293b' : '#e2e8f0',
                  transition: 'background 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  position: 'relative',
                  width: '48px',
                  opacity: thinkingType === 'forced' ? 0.7 : 1,
                }}
                title={
                  thinkingType === 'forced'
                    ? '该模型为原生推理模型，必须思考'
                    : enableThinking ? '思考模式：开' : '思考模式：关'
                }
              >
                <div style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: '#ffffff',
                  position: 'absolute',
                  top: '3px',
                  left: (thinkingType === 'forced' || enableThinking) ? '23px' : '3px',
                  transition: 'left 0.2s ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                }} />
              </button>
              </>
            )}
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
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// EmptyState — Gemini 风格居中问候
// ------------------------------------------------------------------

function EmptyState({
  streaming, input, onInput, onKeyDown, onSend, onStop,
  attachedFile, onFileSelect, onFileRemove, onFileDrop,
  enableThinking, onToggleThinking, thinkingType,
}: {
  streaming: boolean;
  input: string;
  onInput: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
  attachedFile: AttachedFile | null;
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
  onFileDrop: (file: File) => void;
  enableThinking: boolean;
  onToggleThinking: () => void;
  thinkingType: string;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} className="animate-fade-in">
      {/* 问候语 */}
      <div style={{ textAlign: 'center', marginBottom: '48px' }} className="animate-fade-in-up stagger-1">
        <h1 style={{ fontSize: '32px', fontWeight: 600, color: '#334155', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
          有什么可以帮你的？
        </h1>
      </div>

      {/* 输入框 — flex 居中 */}
      <div style={{ width: '100%', padding: '0 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }} className="animate-fade-in-up stagger-2">
        <div style={{ width: '100%', maxWidth: '680px' }}>
          <InputPill
            streaming={streaming}
            input={input}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onSend={onSend}
            onStop={onStop}
            attachedFile={attachedFile}
            onFileSelect={onFileSelect}
            onFileRemove={onFileRemove}
            onFileDrop={onFileDrop}
            enableThinking={enableThinking}
            onToggleThinking={onToggleThinking}
            thinkingType={thinkingType}
          />
        </div>
        {/* 免责声明 */}
        <div style={{ marginTop: '12px', fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>
          OmniHermit 可能会犯错，请核查重要信息。
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// ChatState — 居中消息流 + 沉底浮动输入
// ------------------------------------------------------------------

function ChatState({
  messages, streaming, input, onInput, onKeyDown, onSend, onStop, scrollRef,
  attachedFile, onFileSelect, onFileRemove, onFileDrop,
  onCopyMessage, onRetryMessage,
  enableThinking, onToggleThinking, thinkingType,
}: {
  messages: Msg[];
  streaming: boolean;
  input: string;
  onInput: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  attachedFile: AttachedFile | null;
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
  onFileDrop: (file: File) => void;
  onCopyMessage: (content: string) => void;
  onRetryMessage: (messageId: string) => void;
  enableThinking: boolean;
  onToggleThinking: () => void;
  thinkingType: string;
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 消息流 — flex justify-center 强制居中 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="w-full flex justify-center">
          <div style={{ width: '100%', maxWidth: '720px', padding: '32px 24px 32px', display: 'flex', flexDirection: 'column', gap: '40px' }}>
            {messages.map((m) => (
              <Bubble
                key={m.id}
                msg={m}
                onCopy={m.role === 'assistant' ? () => onCopyMessage(m.content) : undefined}
                onRetry={m.role === 'assistant' && !streaming ? () => onRetryMessage(m.id) : undefined}
                enableThinking={enableThinking}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 沉底浮动输入框 — 同样 flex justify-center */}
      <div style={{ width: '100%', flexShrink: 0, padding: '8px 24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: '680px' }}>
          <InputPill
            streaming={streaming}
            input={input}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onSend={onSend}
            onStop={onStop}
            compact
            attachedFile={attachedFile}
            onFileSelect={onFileSelect}
            onFileRemove={onFileRemove}
            onFileDrop={onFileDrop}
            enableThinking={enableThinking}
            onToggleThinking={onToggleThinking}
            thinkingType={thinkingType}
          />
        </div>
        {/* 免责声明 */}
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>
          OmniHermit 可能会犯错，请核查重要信息。
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// ChatView — 状态机分发
// ------------------------------------------------------------------

export function ChatView({
  model, models,
  currentSessionId, onSessionCreated,
}: {
  model: string;
  models: ModelList;
  currentSessionId: number | null;
  onSessionCreated: (id: number) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [enableThinking, setEnableThinking] = useState(true);

  // 会话 ID ref（避免流式回调中的 stale closure）
  const sessionIdRef = useRef<number | null>(currentSessionId);
  sessionIdRef.current = currentSessionId;

  // 从 models 元数据判断当前模型的思考模式类型
  const modelEntry = models.llm?.[model];
  const thinkingType: string = (typeof modelEntry === 'object' && modelEntry !== null && 'thinking_type' in modelEntry)
    ? (modelEntry as { thinking_type: string }).thinking_type
    : 'none';
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 当 currentSessionId 变化时，加载历史消息
  // 跳过条件：正在流式输出（避免清空正在生成的消息）
  useEffect(() => {
    if (!currentSessionId || streaming) {
      if (!currentSessionId) setMessages([]);
      return;
    }
    let cancelled = false;
    const data = api.getSessionMessages(currentSessionId);
    if (cancelled) return;
    const restored: Msg[] = data.messages.map((m) => ({
      id: uid(),
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    setMessages(restored);
    return () => { cancelled = true; };
  }, [currentSessionId, streaming]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // 选择文件（点击或拖拽）
  const handleFileSelect = useCallback((file: File) => {
    if (!isFileAllowed(file)) {
      // 简单忽略不支持的文件
      return;
    }

    const fileType = getFileType(file);
    const previewUrl = fileType === 'image' ? URL.createObjectURL(file) : undefined;

    const attached: AttachedFile = {
      file,
      previewUrl,
      type: fileType,
      uploading: true,
    };

    setAttachedFile(attached);

    // 上传文件
    api.uploadFile(file).then((result) => {
      setAttachedFile((prev) => {
        if (!prev || prev.file !== file) return prev;
        return { ...prev, serverPath: result.path, uploading: false };
      });
    }).catch((err) => {
      setAttachedFile((prev) => {
        if (!prev || prev.file !== file) return prev;
        return { ...prev, uploading: false, error: `上传失败: ${err.message}` };
      });
    });
  }, []);

  const handleFileRemove = useCallback(() => {
    setAttachedFile((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  const handleFileDrop = useCallback((file: File) => {
    handleFileSelect(file);
  }, [handleFileSelect]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && !attachedFile?.serverPath) || streaming || !model) return;

    // 如果文件还在上传中，等待
    if (attachedFile?.uploading) return;

    setInput('');
    const currentAttachment = attachedFile;
    setAttachedFile(null);

    // 如果没有当前会话，自动创建
    let activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      try {
        const session = await api.createSession(text.slice(0, 50) || '新对话', 'llm', model);
        activeSessionId = session.id;
        sessionIdRef.current = session.id;
        onSessionCreated(session.id);
      } catch {
        // 创建会话失败不阻断聊天
      }
    }

    // 构建用户消息
    const userMsg: Msg = {
      id: uid(),
      role: 'user',
      content: text,
      attachment: currentAttachment ? {
        type: currentAttachment.type,
        filename: currentAttachment.file.name,
        previewUrl: currentAttachment.previewUrl,
        serverPath: currentAttachment.serverPath,
      } : undefined,
    };

    const botMsg: Msg = { id: uid(), role: 'assistant', content: '', streaming: true };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setStreaming(true);

    const history: ChatMessage[] = [...messages, userMsg].map((m) => ({
      role: m.role, content: m.content,
    }));

    // 确定文件路径：图片用 image_path，文档用 file_path
    let imagePath: string | undefined;
    let filePath: string | undefined;
    if (currentAttachment?.serverPath) {
      if (currentAttachment.type === 'image') {
        imagePath = currentAttachment.serverPath;
      } else {
        filePath = currentAttachment.serverPath;
      }
    }

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      let acc = '';
      let thinking = '';
      let tokenRate: number | undefined;
      for await (const event of api.chatCompletion(model, history, 2048, 0.7, imagePath, filePath, controller.signal, enableThinking, activeSessionId)) {
        if (event.type === 'content') {
          acc += event.text;
          const snap = acc;
          setMessages((prev) => prev.map((m) => m.id === botMsg.id ? { ...m, content: snap } : m));
        } else if (event.type === 'thinking') {
          thinking += event.text;
          const snap = thinking;
          setMessages((prev) => prev.map((m) => m.id === botMsg.id ? { ...m, thinking: snap } : m));
        } else if (event.type === 'metadata') {
          tokenRate = event.tokensPerSecond;
        }
      }
      setMessages((prev) => {
        const next = prev.map((m) => m.id === botMsg.id ? { ...m, streaming: false, tokenRate } : m);
        if (activeSessionId) api.saveSessionMessages(activeSessionId, next.map((x) => ({ role: x.role, content: x.content })));
        return next;
      });
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // 用户主动停止
        setMessages((prev) => prev.map((m) => m.id === botMsg.id ? { ...m, streaming: false } : m));
      } else {
        setMessages((prev) => prev.map((m) =>
          m.id === botMsg.id ? { ...m, content: `加载失败: ${e.message}`, streaming: false } : m,
        ));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }, [input, streaming, model, messages, attachedFile, enableThinking, onSessionCreated]);

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

  // 复制消息内容到剪贴板
  const handleCopyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content).catch(() => {});
  }, []);

  // 重试触发器：存储需要重试的历史消息
  const [retryTrigger, setRetryTrigger] = useState<Msg[] | null>(null);

  // 处理重试：用 useEffect 避免在 setMessages 内调用异步 API
  useEffect(() => {
    if (!retryTrigger) return;

    const botMsg: Msg = { id: uid(), role: 'assistant', content: '', streaming: true };
    const newMessages = [...retryTrigger, botMsg];

    setMessages(newMessages);
    setStreaming(true);
    setRetryTrigger(null);

    const history: ChatMessage[] = retryTrigger.map((m) => ({
      role: m.role, content: m.content,
    }));

    // 从最后一条用户消息中提取附件路径（如果有）
    const lastUserMsg = [...retryTrigger].reverse().find((m) => m.role === 'user');
    let retryImagePath: string | undefined;
    let retryFilePath: string | undefined;
    if (lastUserMsg?.attachment?.serverPath) {
      if (lastUserMsg.attachment.type === 'image') {
        retryImagePath = lastUserMsg.attachment.serverPath;
      } else {
        retryFilePath = lastUserMsg.attachment.serverPath;
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        let acc = '';
        let thinking = '';
        let tokenRate: number | undefined;
        for await (const event of api.chatCompletion(model, history, 2048, 0.7, retryImagePath, retryFilePath, controller.signal, enableThinking, sessionIdRef.current)) {
          if (event.type === 'content') {
            acc += event.text;
            const snap = acc;
            setMessages((ms) => ms.map((m) => m.id === botMsg.id ? { ...m, content: snap } : m));
          } else if (event.type === 'thinking') {
            thinking += event.text;
            const snap = thinking;
            setMessages((ms) => ms.map((m) => m.id === botMsg.id ? { ...m, thinking: snap } : m));
          } else if (event.type === 'metadata') {
            tokenRate = event.tokensPerSecond;
          }
        }
        setMessages((ms) => {
          const next = ms.map((m) => m.id === botMsg.id ? { ...m, streaming: false, tokenRate } : m);
          if (sessionIdRef.current) {
            api.saveSessionMessages(sessionIdRef.current, next.map((x) => ({ role: x.role, content: x.content })));
          }
          return next;
        });
      } catch (e: any) {
        if (e.name === 'AbortError') {
          setMessages((ms) => ms.map((m) => m.id === botMsg.id ? { ...m, streaming: false } : m));
        } else {
          setMessages((ms) => ms.map((m) =>
            m.id === botMsg.id ? { ...m, content: `加载失败: ${e.message}`, streaming: false } : m,
          ));
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    })();
  }, [retryTrigger, model, enableThinking]);

  // 重试：保留到该 AI 消息之前的用户消息，重新生成
  const handleRetryMessage = useCallback((messageId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx < 0) return prev;
      const userMsgIdx = idx - 1;
      if (userMsgIdx < 0) return prev;
      const kept = prev.slice(0, userMsgIdx + 1);
      // 通过 setTimeout 在当前 render 后触发 retry
      setTimeout(() => setRetryTrigger(kept), 0);
      return kept;
    });
  }, []);

  const shared = {
    model, streaming, input, onInput: handleInput, onKeyDown: handleKeyDown, onSend: handleSend, onStop: handleStop,
    attachedFile, onFileSelect: handleFileSelect, onFileRemove: handleFileRemove, onFileDrop: handleFileDrop,
    onCopyMessage: handleCopyMessage, onRetryMessage: handleRetryMessage,
    enableThinking, onToggleThinking: () => setEnableThinking((v) => !v), thinkingType,
  };

  return messages.length === 0
    ? <EmptyState {...shared} />
    : <ChatState {...shared} messages={messages} scrollRef={scrollRef} />;
}
