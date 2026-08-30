/**
 * App — 根组件：单一对话流（生图/深度研究作为 + 工具融合在对话里）。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout, type SessionEntry } from './components/Layout';
import { ChatView } from './components/ChatView';
import type { Tool } from './components/Composer';
import { useModels } from './hooks/useModels';
import { api } from './lib/api_client';

export default function App() {
  const { models, loading } = useModels();
  const [selectedModel, setSelectedModel] = useState('');

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const modelBeforeToolRef = useRef<string>('');

  const modelNames = Object.keys(models.llm || {});

  const fetchSessions = useCallback(() => {
    setSessions(api.getSessions());
  }, []);

  // 会话列表只在挂载时拉取一次（避免 modelNames 每次渲染都是新数组引发无限更新）
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const modelNamesKey = modelNames.join(',');
  useEffect(() => {
    if (loading || selectedModel || modelNames.length === 0) return;
    // 默认旗舰别名：gemini-advanced
    setSelectedModel(
      modelNames.includes('gemini-advanced') ? 'gemini-advanced' : modelNames[0],
    );
  }, [loading, selectedModel, modelNamesKey]);

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

  // 官方式工具切换：生成图片 → 模型自动切到 3.1 Pro（聊天内直接出图）；取消恢复
  const handleToolChange = useCallback((t: Tool | null) => {
    setActiveTool(t);
    if (t === 'image') {
      modelBeforeToolRef.current = selectedModel;
      setSelectedModel('gemini-3.1-pro');
    } else if (t === null && selectedModel === 'gemini-3.1-pro') {
      setSelectedModel(modelBeforeToolRef.current || 'gemini-advanced');
    }
  }, [selectedModel]);

  const handleSessionCreated = useCallback((id: number) => {
    setCurrentSessionId(id);
    fetchSessions();
  }, [fetchSessions]);

  return (
    <Layout
      models={models.llm || {}}
      selectedModel={selectedModel}
      onModelChange={setSelectedModel}
      sessions={sessions}
      currentSessionId={currentSessionId}
      onSessionSelect={handleSessionSelect}
      onSessionDelete={handleSessionDelete}
      onNewChat={handleNewChat}
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
  );
}
