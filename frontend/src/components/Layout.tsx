/**
 * Layout — Liquid Crystal 液态玻璃布局（响应式）。
 */

import { useState, useEffect, type ReactNode } from 'react';
import { Plus, Trash2, Menu, X, Pencil } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { UserProfile } from '../lib/api_client';

export interface SessionEntry {
  id: number;
  title: string;
  modality: string;
  model_name: string | null;
  created_at: string;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

// ------------------------------------------------------------------
// 删除确认对话框
// ------------------------------------------------------------------

function DeleteConfirm({
  title, onConfirm, onCancel,
}: {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 320, padding: '24px',
          borderRadius: 20,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
          border: '1px solid rgba(255,255,255,0.6)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
          删除会话
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20, lineHeight: 1.5 }}>
          确定要删除「{title || '新对话'}」吗？此操作会将该会话从数据库和本地同时抹除，无法恢复。
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', borderRadius: 10, border: 'none',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              background: 'rgba(15,23,42,0.06)', color: '#64748b',
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 18px', borderRadius: 10, border: 'none',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              background: '#ef4444', color: '#fff',
            }}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// 重命名对话框（Enter 保存 / Esc 取消）
// ------------------------------------------------------------------

function RenameDialog({
  title, onSave, onCancel,
}: {
  title: string;
  onSave: (newTitle: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(title);
  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== title;

  return (
    <div
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && canSave) onSave(trimmed);
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 320, padding: '24px',
          borderRadius: 20,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
          border: '1px solid rgba(255,255,255,0.6)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 14 }}>
          重命名会话
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={100}
          style={{
            width: '100%', padding: '10px 12px', marginBottom: 20,
            borderRadius: 10, border: '1px solid rgba(148,163,184,0.4)',
            fontSize: 13, color: '#1e293b', outline: 'none',
            background: 'rgba(255,255,255,0.8)',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', borderRadius: 10, border: 'none',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              background: 'rgba(15,23,42,0.06)', color: '#64748b',
            }}
          >
            取消
          </button>
          <button
            onClick={() => canSave && onSave(trimmed)}
            style={{
              padding: '8px 18px', borderRadius: 10, border: 'none',
              fontSize: 13, fontWeight: 500, cursor: canSave ? 'pointer' : 'default',
              background: canSave ? '#1e293b' : 'rgba(15,23,42,0.15)', color: '#fff',
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Sidebar
// ------------------------------------------------------------------

function Sidebar({
  sessions, currentSessionId, onSessionSelect, onSessionDelete, onSessionRename, onNewChat,
  user, onSettingsClick,
  isMobile, open, onClose,
}: {
  sessions: SessionEntry[];
  currentSessionId: number | null;
  onSessionSelect: (id: number) => void;
  onSessionDelete: (id: number) => void;
  onSessionRename: (id: number, title: string) => void;
  onNewChat: () => void;
  user?: UserProfile | null;
  onSettingsClick?: () => void;
  isMobile: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionEntry | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionEntry | null>(null);

  const handleSelect = (id: number) => {
    onSessionSelect(id);
    if (isMobile) onClose();
  };

  const handleNewChat = () => {
    onNewChat();
    if (isMobile) onClose();
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      onSessionDelete(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      {/* 删除确认 */}
      {deleteTarget && (
        <DeleteConfirm
          title={deleteTarget.title}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* 重命名 */}
      {renameTarget && (
        <RenameDialog
          title={renameTarget.title}
          onSave={(newTitle) => {
            onSessionRename(renameTarget.id, newTitle);
            setRenameTarget(null);
          }}
          onCancel={() => setRenameTarget(null)}
        />
      )}

      {/* 移动端遮罩 */}
      {isMobile && open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(15,23,42,0.3)',
            backdropFilter: 'blur(2px)',
          }}
        />
      )}

      <aside
        style={{
          width: '232px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          background: isMobile ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.35)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRight: '1px solid rgba(255,255,255,0.5)',
          padding: isMobile ? '16px 12px' : '20px 12px',
          gap: '4px',
          ...(isMobile ? {
            position: 'fixed' as const,
            left: 0, top: 0, bottom: 0, zIndex: 50,
            transform: open ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: open ? '4px 0 24px rgba(0,0,0,0.1)' : 'none',
          } : {}),
        }}
      >
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 10px', height: '44px', flexShrink: 0 }}>
          <img src="/gemini-sparkle.svg" alt="" style={{ width: '28px', height: '28px' }} />
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#1e293b', letterSpacing: '-0.01em', flex: 1 }}>Gemini Web</div>
          {isMobile && (
            <button
              onClick={onClose}
              style={{
                width: 28, height: 28, borderRadius: '50%', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(15,23,42,0.06)', cursor: 'pointer', color: '#64748b',
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* 新对话按钮（紧贴 Brand 下方） */}
        <button
          onClick={handleNewChat}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            width: '100%',
            padding: '9px 12px',
            fontSize: '14px',
            fontWeight: 500,
            borderRadius: '10px',
            border: 'none',
            cursor: 'pointer',
            background: 'transparent',
            color: '#64748b',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(15,23,42,0.06)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Plus size={16} style={{ flexShrink: 0 }} />
          新对话
        </button>

        {/* Divider */}
        <div style={{ height: '1px', margin: '4px 10px', background: 'linear-gradient(to right, transparent, rgba(148,163,184,0.25), transparent)' }} />

        {/* Session history */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', padding: '4px 12px 8px', flexShrink: 0 }}>
            历史
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
            {sessions.length === 0 && (
              <div style={{ fontSize: '12px', color: '#cbd5e1', padding: '8px 12px', textAlign: 'center' }}>
                暂无会话
              </div>
            )}
            {sessions.map((s) => {
              const isCurrent = s.id === currentSessionId;
              const isHovered = hoveredId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => handleSelect(s.id)}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                    background: isCurrent
                      ? 'rgba(15,23,42,0.08)'
                      : isHovered
                        ? 'rgba(15,23,42,0.04)'
                        : 'transparent',
                    marginBottom: '2px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: isCurrent ? 500 : 400,
                      color: isCurrent ? '#1e293b' : '#64748b',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {s.title || '新对话'}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameTarget(s);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      borderRadius: '6px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      flexShrink: 0,
                      transition: 'opacity 0.15s',
                      opacity: (isHovered || (isMobile && isCurrent)) ? 1 : 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#1e293b'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(s);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      borderRadius: '6px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      flexShrink: 0,
                      transition: 'opacity 0.15s',
                      opacity: (isHovered || (isMobile && isCurrent)) ? 1 : 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: '1px', margin: '8px 10px', background: 'linear-gradient(to right, transparent, rgba(148,163,184,0.25), transparent)' }} />

        {/* 用户标签 */}
        {user && (
          <div style={{ padding: '4px 0', flexShrink: 0 }}>
            <button
              onClick={onSettingsClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '9px 12px',
                fontSize: '13px',
                fontWeight: 400,
                borderRadius: '10px',
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                color: '#64748b',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(15,23,42,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt=""
                  style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 11, fontWeight: 600,
                }}>
                  {(user.username || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.username}
              </span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

// ------------------------------------------------------------------
// Header
// ------------------------------------------------------------------

function Header({
  models, imageModels, selectedModel, onModelChange, activeTool,
  isMobile, onMenuClick,
}: {
  models: Record<string, unknown>;
  imageModels: Record<string, unknown>;
  selectedModel: string;
  onModelChange: (m: string) => void;
  activeTool?: string | null;
  isMobile: boolean;
  onMenuClick: () => void;
}) {
  const isImageMode = activeTool === 'image';
  const names = Object.keys(isImageMode ? imageModels : models);

  return (
    <header
      style={{
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: isMobile ? '12px' : '32px',
        paddingRight: isMobile ? '12px' : '24px',
        flexShrink: 0,
        gap: '8px',
        background: 'rgba(255,255,255,0.25)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(255,255,255,0.45)',
      }}
    >
      {isMobile && (
        <button
          onClick={onMenuClick}
          style={{
            width: 36, height: 36, borderRadius: '10px', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', cursor: 'pointer', color: '#64748b',
            flexShrink: 0,
          }}
        >
          <Menu size={20} />
        </button>
      )}

      <Select
        value={selectedModel}
        onValueChange={(v) => { if (v && v !== '__empty') onModelChange(v); }}
      >
        <SelectTrigger
          className="group/select"
          style={{
            width: 'auto',
            minWidth: isMobile ? '100px' : '160px',
            maxWidth: isMobile ? 'calc(100vw - 120px)' : 'none',
            height: '36px',
            padding: '6px 12px',
            fontSize: isMobile ? '13px' : '15px',
            fontWeight: 500,
            color: '#334155',
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: '12px',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }}
        >
          <SelectValue placeholder="选择模型" />
        </SelectTrigger>
        <SelectContent
          style={{
            background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.6)',
            borderRadius: '14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
            padding: '4px',
          }}
        >
          {names.length === 0 && <SelectItem value="__empty" disabled>暂无可用模型</SelectItem>}
          {names.map((n) => (
            <SelectItem
              key={n}
              value={n}
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: '#334155',
                borderRadius: '10px',
                padding: '8px 12px',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
              }}
            >
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </header>
  );
}

// ------------------------------------------------------------------
// Layout
// ------------------------------------------------------------------

export function Layout({
  models, imageModels, selectedModel, onModelChange, activeTool,
  sessions, currentSessionId, onSessionSelect, onSessionDelete, onSessionRename, onNewChat,
  user, onSettingsClick,
  children,
}: {
  models: Record<string, unknown>;
  imageModels: Record<string, unknown>;
  selectedModel: string;
  onModelChange: (m: string) => void;
  activeTool?: string | null;
  sessions: SessionEntry[];
  currentSessionId: number | null;
  onSessionSelect: (id: number) => void;
  onSessionDelete: (id: number) => void;
  onSessionRename: (id: number, title: string) => void;
  onNewChat: () => void;
  user?: UserProfile | null;
  onSettingsClick?: () => void;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="h-screen w-screen flex overflow-hidden" style={{ height: '100dvh' }}>
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={onSessionSelect}
        onSessionDelete={onSessionDelete}
        onSessionRename={onSessionRename}
        onNewChat={onNewChat}
        user={user}
        onSettingsClick={onSettingsClick}
        isMobile={isMobile}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full">
        <Header
          models={models}
          imageModels={imageModels}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          activeTool={activeTool}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="flex-1 flex flex-col min-h-0 w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
