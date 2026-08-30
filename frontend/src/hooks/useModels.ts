/**
 * useModels — 启动时拉取网关模型列表，按模态分类。
 * 含 "image" 的 ID 归为绘图模型，其余归为对话模型。
 */

import { useEffect, useState } from 'react';
import { api, type ModelList } from '../lib/api_client';

export function useModels() {
  const [models, setModels] = useState<ModelList>({
    llm: {}, image: {}, video: {}, tts: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listModels()
      .then(setModels)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { models, loading, error };
}
