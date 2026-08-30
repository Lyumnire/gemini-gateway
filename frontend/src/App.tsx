/**
 * App — 根组件：加载模型 → 渲染 Layout → 切换模态视图。
 * 会话存储在 localStorage（api_client 适配层）。
 */

import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, ImageIcon, Telescope } from 'lucide-react';
import { Layout, type Modality, type SessionEntry } from './components/Layout';
import { ChatView } from './components/ChatView';
import { ImageGenView } from './components/ImageGenView';
import { DeepResearchView } from './components/DeepResearchView';
import { useModels } from './hooks/useModels';
import { api } from './lib/api_client';

const MODALITY_META: Record<Modality, { title: string; subtitle: string; icon: typeof MessageSquare }> = {
  llm: { title: '智能对话', subtitle: '与 AI 畅聊无限可能', icon: MessageSquare },
  image: { title: 'AI 绘图', subtitle: 'Nano Banana Pro · 输入描述生成图像', icon: ImageIcon },
  research: { title: '深度研究', subtitle: '多来源检索，自动汇总成报告', icon: Telescope },
};

function Placeholder({ modality }: { modality: Modality }) {
  const meta = MODALITY_META[modality];
  const Icon = meta.icon;

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-0 animate-fade-in">
      <div className="flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.3] backdrop-blur-xl border border-white/[0.4] flex items-center justify-center mb-5 shadow-lg shadow-black/[0.03]">
          <Icon size={24} className="text-slate-400/70" />
        </div>
        <h2 className="text-[20px] font-semibold text-slate-700 tracking-tight mb-1.5">
          {meta.title}
        </h2>
        <p className="text-[14px] text-slate-400/80 font-medium">
          {meta.subtitle}
        </p>
        <div className="mt-6 px-4 py-2 rounded-full bg-white/[0.35] backdrop-blur-lg border border-white/[0.45] text-[12px] text-slate-400/70 font-medium shadow-sm">
          即将上线
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { models, loading } = useModels();
  const [modality, setModality] = useState<Modality>('llm');
  const [selectedModel, setSelectedModel] = useState('');

  // 会话状态（localStorage 适配层）
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);

  // research 视图复用对话模型列表（端点自行选择模型）
  const headerModality = modality === 'research' ? 'llm' : modality;
  const currentModels = models[headerModality] || {};
  const modelNames = Object.keys(currentModels);

  // --- 会话管理（localStorage）---

  const fetchSessions = useCallback(() => {
    setSessions(api.getSessions(modality));
  }, [modality]);

  useEffect(() => {
    fetchSessions();
    const names = Object.keys(models[headerModality] || {});
    setSelectedModel((cur) => (names.includes(cur) ? cur : names[0] || ''));
  }, [fetchSessions, models, headerModality]);

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

  // --- 模态切换 ---

  const handleModalityChange = (m: Modality) => {
    setModality(m);
    const names = Object.keys(models[m === 'research' ? 'llm' : m] || {});
    setSelectedModel(names[0] || '');
    setCurrentSessionId(null);
  };

  useEffect(() => {
    if (!loading && !selectedModel && modelNames.length > 0) {
      setSelectedModel(modelNames[0]);
    }
  }, [loading, selectedModel, modelNames]);

  const view = () => {
    switch (modality) {
      case 'llm':
        return (
          <ChatView
            model={selectedModel}
            models={models}
            currentSessionId={currentSessionId}
            onSessionCreated={handleSessionCreated}
          />
        );
      case 'image':
        return <ImageGenView model={selectedModel} />;
      case 'research':
        return <DeepResearchView />;
      default:
        return <Placeholder modality={modality} />;
    }
  };

  return (
    <Layout
      activeModality={modality}
      onModalityChange={handleModalityChange}
      models={currentModels}
      selectedModel={selectedModel}
      onModelChange={setSelectedModel}
      sessions={sessions}
      currentSessionId={currentSessionId}
      onSessionSelect={handleSessionSelect}
      onSessionDelete={handleSessionDelete}
      onNewChat={handleNewChat}
    >
      {view()}
    </Layout>
  );
}
