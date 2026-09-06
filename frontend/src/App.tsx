/**
 * App — 根组件：认证网关 + 单一对话流（生图/深度研究作为 + 工具融合在对话里）。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout, type SessionEntry } from './components/Layout';
import { ChatView } from './components/ChatView';
import { LoginPage } from './components/LoginPage';
import { RegisterPage } from './components/RegisterPage';
import { SettingsPage } from './components/SettingsPage';
import type { Tool } from './components/Composer';
import { useModels } from './hooks/useModels';
import { api, getToken, setToken, clearToken, setOnUnauthorized, readCachedProfile, cacheProfile, type UserProfile } from './lib/api_client';

type AuthPage = 'login' | 'register';

export default function App() {
  const [authPage, setAuthPage] = useState<AuthPage | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthPage('login');
    }
    setAuthChecked(true);
    setOnUnauthorized(() => {
      setAuthPage('login');
    });
  }, []);

  const handleLogin = useCallback(async (token: string) => {
    setToken(token);
    setAuthPage(null);
    await api.syncFromServer();
    window.location.reload();
  }, []);

  const handleRegister = useCallback(async (token: string) => {
    setToken(token);
    setAuthPage(null);
    window.location.reload();
  }, []);

  const handleLogout = useCallback(() => {
    clearToken();
    setAuthPage('login');
  }, []);

  if (!authChecked) return null;

  if (authPage === 'login') {
    return <LoginPage onLogin={handleLogin} onSwitchToRegister={() => setAuthPage('register')} />;
  }
  if (authPage === 'register') {
    return <RegisterPage onRegister={handleRegister} onSwitchToLogin={() => setAuthPage('login')} />;
  }

  return <AppContent onLogout={handleLogout} />;
}

function AppContent({ onLogout }: { onLogout: () => void }) {
  const { models, loading } = useModels();
  const [selectedModel, setSelectedModel] = useState('');
  // 缓存优先：回访时头像/用户名立即渲染，后台再刷新最新资料
  const [user, setUser] = useState<UserProfile | null>(() => readCachedProfile());
  const [showSettings, setShowSettings] = useState(false);

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const modelBeforeToolRef = useRef<string>('');

  const modelNames = Object.keys(models.llm || {});

  // 加载用户资料（后台刷新缓存值）
  useEffect(() => {
    api.getProfile()
      .then((u) => { setUser(u); cacheProfile(u); })
      .catch(() => {});
  }, []);

  const fetchSessions = useCallback(() => {
    setSessions(api.getSessions());
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const modelNamesKey = modelNames.join(',');
  useEffect(() => {
    if (loading || selectedModel || modelNames.length === 0) return;
    setSelectedModel(
      modelNames.includes('gemini-advanced') ? 'gemini-advanced' : modelNames[0],
    );
  }, [loading, selectedModel, modelNamesKey]);

  // 缓存预选的模型可能在后台刷新后已下线：此时自动回退到默认模型，保证能正常发消息
  useEffect(() => {
    if (!selectedModel || modelNames.length === 0) return;
    const isImageModel = Object.keys(models.image || {}).includes(selectedModel);
    if (!modelNames.includes(selectedModel) && !isImageModel) {
      setSelectedModel(
        modelNames.includes('gemini-advanced') ? 'gemini-advanced' : modelNames[0],
      );
    }
  }, [modelNamesKey]);

  const handleSessionSelect = useCallback((id: number) => {
    setCurrentSessionId(id);
  }, []);

  const handleSessionDelete = useCallback((id: number) => {
    api.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setCurrentSessionId((cur) => (cur === id ? null : cur));
  }, []);

  const handleNewChat = useCallback(() => {
    setCurrentSessionId(null);
  }, []);

  const imageModel = ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'].find(m => modelNames.includes(m)) || 'gemini-3-pro-image';
  const handleToolChange = useCallback((t: Tool | null) => {
    setActiveTool(t);
    if (t === 'image') {
      modelBeforeToolRef.current = selectedModel;
      setSelectedModel(imageModel);
    } else if (t === null && selectedModel === imageModel) {
      setSelectedModel(modelBeforeToolRef.current || 'gemini-advanced');
    }
  }, [selectedModel, imageModel]);

  const handleSessionCreated = useCallback((id: number) => {
    setCurrentSessionId(id);
    fetchSessions();
  }, [fetchSessions]);

  return (
    <>
      <Layout
        models={models.llm || {}}
        imageModels={models.image || {}}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        activeTool={activeTool}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={handleSessionSelect}
        onSessionDelete={handleSessionDelete}
        onNewChat={handleNewChat}
        user={user}
        onSettingsClick={() => setShowSettings(true)}
      >
        <ChatView
          model={selectedModel}
          models={models}
          activeTool={activeTool}
          onToolChange={handleToolChange}
          currentSessionId={currentSessionId}
          onSessionCreated={handleSessionCreated}
        />
      </Layout>

      {showSettings && user && (
        <SettingsPage
          user={user}
          onClose={() => setShowSettings(false)}
          onLogout={() => { setShowSettings(false); onLogout(); }}
          onUserUpdate={(u) => { setUser(u); setShowSettings(false); }}
        />
      )}
    </>
  );
}
