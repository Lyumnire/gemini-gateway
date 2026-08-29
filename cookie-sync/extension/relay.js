// 隔离世界中继：接收主世界捕获的模型配置片段，转发给扩展后台。
window.addEventListener('message', (ev) => {
  if (ev.source !== window || !ev.data || ev.data.type !== 'GG_MODEL_CONFIG') return;
  try {
    chrome.runtime.sendMessage({ type: 'GG_MODEL_CONFIG', chunks: ev.data.chunks });
  } catch (e) {
    /* 扩展上下文失效时忽略 */
  }
});
