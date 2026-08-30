/**
 * Layout — Liquid Crystal 液态玻璃布局。
 *
 * 结构：
 * ┌─ Sidebar ─┬─ Header ─────────────────┐
 * │  Brand     │                           │
 * │  Nav       │  [Model selector] [Avatar]│
 * │  History   ├─ Main (flex-1) ──────────┤
 * │  Footer    │  (children)               │
 * └────────────┴───────────────────────────┘
 */

import { useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/** 会话条目 */
export interface SessionEntry {
  id: number;
  title: string;
  modality: string;
  model_name: string | null;
  created_at: string;
}

// ------------------------------------------------------------------
// Sidebar — 磨砂玻璃，统一内边距 + 呼吸感
// ------------------------------------------------------------------

function Sidebar({
  sessions, currentSessionId, onSessionSelect, onSessionDelete, onNewChat,
}: {
  sessions: SessionEntry[];
  currentSessionId: number | null;
  onSessionSelect: (id: number) => void;
  onSessionDelete: (id: number) => void;
  onNewChat: () => void;
}) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <aside
      style={{
        width: '232px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'rgba(255,255,255,0.35)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRight: '1px solid rgba(255,255,255,0.5)',
        padding: '20px 12px',
        gap: '4px',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 10px', height: '44px', flexShrink: 0 }}>
        <img src="/favicon.svg" alt="Gemini Web" style={{ width: '28px', height: '28px', borderRadius: '8px' }} />
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1e293b', letterSpacing: '-0.01em' }}>Gemini Web</div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', margin: '8px 10px', background: 'linear-gradient(to right, transparent, rgba(148,163,184,0.25), transparent)' }} />

      {/* Divider */}
      <div style={{ height: '1px', margin: '8px 10px', background: 'linear-gradient(to right, transparent, rgba(148,163,184,0.25), transparent)' }} />

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
                onClick={() => onSessionSelect(s.id)}
                onMouseEnter={() => setHoveredId(s.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background: isCurrent ? 'rgba(15,23,42,0.06)' : 'transparent',
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
                {isHovered && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSessionDelete(s.id);
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
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                      e.currentTarget.style.color = '#ef4444';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#94a3b8';
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', margin: '8px 10px', background: 'linear-gradient(to right, transparent, rgba(148,163,184,0.25), transparent)' }} />

      {/* Footer */}
      <div style={{ padding: '4px 0', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {/* New chat */}
        <button
          onClick={onNewChat}
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
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Plus size={16} style={{ flexShrink: 0 }} />
          新对话
        </button>
        
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------
// Header — 极薄透明条
// ------------------------------------------------------------------

function Header({
  models, selectedModel, onModelChange,
}: {
  models: Record<string, unknown>;
  selectedModel: string;
  onModelChange: (m: string) => void;
}) {
  const names = Object.keys(models);

  return (
    <header
      style={{
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: '32px',
        paddingRight: '24px',
        flexShrink: 0,
        background: 'rgba(255,255,255,0.25)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(255,255,255,0.45)',
      }}
    >
      {/* Model selector */}
      <Select
        value={selectedModel}
        onValueChange={(v) => { if (v && v !== '__empty') onModelChange(v); }}
      >
        <SelectTrigger
          className="group/select"
          style={{
            width: 'auto',
            minWidth: '160px',
            height: '36px',
            padding: '6px 12px',
            fontSize: '15px',
            fontWeight: 500,
            color: '#334155',
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: '12px',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.5)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'transparent';
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
// Layout — 根容器
// ------------------------------------------------------------------

export function Layout({
  models, selectedModel, onModelChange,
  sessions, currentSessionId, onSessionSelect, onSessionDelete, onNewChat,
  children,
}: {
  models: Record<string, unknown>;
  selectedModel: string;
  onModelChange: (m: string) => void;
  sessions: SessionEntry[];
  currentSessionId: number | null;
  onSessionSelect: (id: number) => void;
  onSessionDelete: (id: number) => void;
  onNewChat: () => void;
  children: ReactNode;
}) {

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={onSessionSelect}
        onSessionDelete={onSessionDelete}
        onNewChat={onNewChat}
      />
      <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full">
        <Header
          models={models}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
        />
        <main className="flex-1 flex flex-col min-h-0 w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
