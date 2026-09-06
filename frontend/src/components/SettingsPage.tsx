import { useState, useRef, useEffect } from 'react';
import { X, Camera, User, Lock, LogOut } from 'lucide-react';
import { api, type UserProfile } from '../lib/api_client';

interface SettingsPageProps {
  user: UserProfile;
  onClose: () => void;
  onLogout: () => void;
  onUserUpdate: (user: UserProfile) => void;
}

export function SettingsPage({ user, onClose, onLogout, onUserUpdate }: SettingsPageProps) {
  const [username, setUsername] = useState(user.username);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 限制文件大小 2MB
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: 'error', text: '头像文件不能超过 2MB' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatar(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const updates: any = {};
      if (username !== user.username) updates.username = username.trim();
      if (avatar !== user.avatar) updates.avatar = avatar;
      if (newPassword) {
        if (!oldPassword) {
          setMessage({ type: 'error', text: '请输入当前密码' });
          setSaving(false);
          return;
        }
        updates.old_password = oldPassword;
        updates.password = newPassword;
      }
      if (Object.keys(updates).length === 0) {
        setMessage({ type: 'success', text: '没有需要保存的更改' });
        setSaving(false);
        return;
      }
      const updated = await api.updateProfile(updates);
      onUserUpdate(updated);
      setOldPassword('');
      setNewPassword('');
      setMessage({ type: 'success', text: '已保存' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const initial = (username || 'U').charAt(0).toUpperCase();

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    border: '1.5px solid #e2e5f0',
    background: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.2s',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: '#475569',
    marginBottom: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400, maxWidth: '92vw', padding: '32px',
          borderRadius: 20,
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.12)',
          border: '1px solid rgba(255,255,255,0.6)',
        }}
      >
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#1e293b' }}>设置</div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: '50%', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(15,23,42,0.06)', cursor: 'pointer', color: '#64748b',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(15,23,42,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(15,23,42,0.06)'; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 头像 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>
            {avatar ? (
              <img
                src={avatar}
                alt="Avatar"
                style={{
                  width: 80, height: 80, borderRadius: '50%',
                  objectFit: 'cover', border: '3px solid rgba(99,102,241,0.15)',
                }}
              />
            ) : (
              <div style={{
                width: 80, height: 80, borderRadius: '50%',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 32, fontWeight: 600,
              }}>
                {initial}
              </div>
            )}
            <div
              style={{
                position: 'absolute', right: -2, bottom: -2,
                width: 30, height: 30, borderRadius: '50%', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#0f172a', color: '#fff', cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }}
            >
              <Camera size={14} />
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarChange}
          />
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10, textAlign: 'center' }}>
            点击更换头像（最大 2MB）
          </div>
        </div>

        {/* 用户名 */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>
            <User size={14} /> 用户名
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            onFocus={(e) => { e.target.style.borderColor = '#6366f1'; }}
            onBlur={(e) => { e.target.style.borderColor = '#e2e5f0'; }}
          />
        </div>

        {/* 修改密码 */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>
            <Lock size={14} /> 修改密码
          </label>
          <input
            type="password"
            placeholder="当前密码"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            style={{ ...inputStyle, marginBottom: 10 }}
            onFocus={(e) => { e.target.style.borderColor = '#6366f1'; }}
            onBlur={(e) => { e.target.style.borderColor = '#e2e5f0'; }}
          />
          <input
            type="password"
            placeholder="新密码（至少6位，留空则不修改）"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={inputStyle}
            onFocus={(e) => { e.target.style.borderColor = '#6366f1'; }}
            onBlur={(e) => { e.target.style.borderColor = '#e2e5f0'; }}
          />
        </div>

        {/* 消息提示 */}
        {message && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13,
            background: message.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: message.type === 'success' ? '#16a34a' : '#dc2626',
          }}>
            {message.text}
          </div>
        )}

        {/* 保存按钮 */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
            background: saving ? '#a5b4fc' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff', fontSize: 15, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1, marginBottom: 20,
            transition: 'opacity 0.2s',
          }}
        >
          {saving ? '保存中...' : '保存修改'}
        </button>

        {/* 分割线 */}
        <div style={{ height: 1, background: 'rgba(148,163,184,0.2)', margin: '0 0 16px' }} />

        {/* 退出登录 */}
        <button
          onClick={onLogout}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', padding: '11px 0', borderRadius: 12, border: 'none',
            background: 'rgba(239,68,68,0.08)', color: '#ef4444',
            fontSize: 14, fontWeight: 500, cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
        >
          <LogOut size={15} /> 退出登录
        </button>
      </div>
    </div>
  );
}
