/**
 * App — 根组件：单一对话流（生图/深度研究作为 + 工具融合在对话里）。
 */

import { useState, useEffect, useCallback } from 'react';
import { Layout, type SessionEntry } from './components/Layout';
import { ChatView } from './components/ChatView';
import { useModels } from './hooks/useModels';
import { api } from './lib/api_client';

export default function App() {
  const { models, loading } = useModels();
  const [selectedModel, setSelectedModel] = useState('');

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);

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
    if (!loading && !selectedModel && modelNames.length > 0) {
      setSelectedModel(modelNames[0]);
    }
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
        currentSessionId={currentSessionId}
        onSessionCreated={handleSessionCreated}
      />
    </Layout>
  );
}
