import { useState } from 'react';

interface RegisterPageProps {
  onRegister: (token: string) => void;
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onRegister, onSwitchToLogin }: RegisterPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, invite_code: inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '注册失败');
      onRegister(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 12,
    border: '1.5px solid #e2e5f0',
    background: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #f0f4ff 0%, #e8eeff 50%, #f8f0ff 100%)',
    }}>
      <div style={{
        width: 380,
        padding: '40px 32px',
        borderRadius: 20,
        background: 'rgba(255,255,255,0.7)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        border: '1px solid rgba(255,255,255,0.6)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e', letterSpacing: -0.5 }}>
            Gemini Web
          </div>
          <div style={{ fontSize: 13, color: '#8b8fa3', marginTop: 6 }}>
            创建新账号
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder="用户名（至少2个字符）"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = '#6366f1'}
              onBlur={(e) => e.target.style.borderColor = '#e2e5f0'}
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <input
              type="password"
              placeholder="密码（至少6个字符）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = '#6366f1'}
              onBlur={(e) => e.target.style.borderColor = '#e2e5f0'}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <input
              type="text"
              placeholder="邀请码"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = '#6366f1'}
              onBlur={(e) => e.target.style.borderColor = '#e2e5f0'}
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: 'rgba(239,68,68,0.08)',
              color: '#dc2626',
              fontSize: 13,
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password || !inviteCode}
            style={{
              width: '100%',
              padding: '12px 0',
              borderRadius: 12,
              border: 'none',
              background: loading ? '#a5b4fc' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
              transition: 'opacity 0.2s',
              opacity: loading || !username || !password || !inviteCode ? 0.6 : 1,
            }}
          >
            {loading ? '注册中...' : '注册'}
          </button>
        </form>

        <div style={{
          textAlign: 'center',
          marginTop: 20,
          fontSize: 13,
          color: '#8b8fa3',
        }}>
          已有账号？{' '}
          <span
            onClick={onSwitchToLogin}
            style={{ color: '#6366f1', cursor: 'pointer', fontWeight: 500 }}
          >
            登录
          </span>
        </div>
      </div>
    </div>
  );
}
