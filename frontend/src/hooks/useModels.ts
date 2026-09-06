/**
 * useModels — 拉取网关模型列表，按模态分类。
 * 含 "image" 的 ID 归为绘图模型，其余归为对话模型。
 *
 * 加载策略（stale-while-revalidate）：
 * 首次渲染立即使用 localStorage 缓存（回访时模型名秒出），
 * 同时后台请求最新列表，成功后更新状态与缓存。
 * 后台刷新失败时保留缓存 —— 隧道抖动时下拉框不再变空。
 */

import { useEffect, useState } from 'react';
import { api, type ModelList } from '../lib/api_client';

const MODELS_CACHE_KEY = 'gg-models-cache';

function readCachedModels(): ModelList | null {
  try {
    const raw = localStorage.getItem(MODELS_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as ModelList;
    if (!cached || typeof cached !== 'object' || !cached.llm) return null;
    // 补全可能缺失的字段，保持与 api.listModels 返回结构一致
    return { llm: cached.llm || {}, image: cached.image || {}, video: {}, tts: {} };
  } catch {
    return null;
  }
}

function cacheModels(list: ModelList) {
  try {
    localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(list));
  } catch { /* 配额满等情况静默失败 */ }
}

export function useModels() {
  // 有缓存时直接进入可用状态，无缓存才显示 loading
  const [models, setModels] = useState<ModelList>(() => readCachedModels() || {
    llm: {}, image: {}, video: {}, tts: {},
  });
  const [loading, setLoading] = useState(() => readCachedModels() === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listModels()
      .then((list) => {
        if (cancelled) return;
        // 剔除已退役的 2.x 文本模型（保留 nano banana：gemini-2.5-flash-image）
        const retired = /gemini-2\.0-|gemini-2\.5-flash$|gemini-2\.5-flash-preview|tts/;
        list.llm = Object.fromEntries(
          Object.entries(list.llm || {}).filter(([id]) => !retired.test(id)),
        );
        setModels(list);
        cacheModels(list);
        setError(null);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { models, loading, error };
}
