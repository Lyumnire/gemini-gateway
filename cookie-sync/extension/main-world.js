// 主世界脚本：挂钩 fetch / XHR，捕获 Gemini 页面收到的模型令牌配置。
// 官网模型选择器的动态令牌（"!" 前缀长串）通过 batchexecute 响应下发，
// 页面加载时会自然触发——这里把包含令牌的响应片段转发给隔离世界的 relay。

(function () {
  if (window.__ggModelPatch) return;
  window.__ggModelPatch = true;

  // 快速预判 + 精确提取：!" 前缀、60+ 位 base64url 字符的令牌
  const QUICK_RE = /![A-Za-z0-9_\-]{60,}/;
  const CHUNK_RE = new RegExp('.{0,240}![A-Za-z0-9_\\-]{60,}.{0,240}', 'g');

  function scan(text) {
    if (!text || text.length < 100 || !QUICK_RE.test(text)) return null;
    const chunks = text.match(CHUNK_RE);
    return chunks && chunks.length ? chunks.slice(0, 24) : null;
  }

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        if (String(url).includes('batchexecute')) {
          p.then((res) => {
            try {
              res.clone().text().then((t) => {
                const chunks = scan(t);
                if (chunks) window.postMessage({ type: 'GG_MODEL_CONFIG', chunks }, '*');
              });
            } catch (e) { /* 忽略 */ }
          }).catch(() => {});
        }
      } catch (e) { /* 忽略 */ }
      return p;
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ggUrl = String(url || '');
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const xhr = this;
    if (xhr.__ggUrl && xhr.__ggUrl.includes('batchexecute')) {
      xhr.addEventListener('load', () => {
        try {
          const chunks = scan(String(xhr.responseText || ''));
          if (chunks) window.postMessage({ type: 'GG_MODEL_CONFIG', chunks }, '*');
        } catch (e) { /* 忽略 */ }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
