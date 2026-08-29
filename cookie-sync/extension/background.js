// Gemini Gateway Cookie Sync
// 读取 gemini.google.com 的 __Secure-1PSID / __Secure-1PSIDTS（含 HttpOnly，
// 需要 host_permissions 授权），推送到本机接收服务(127.0.0.1:8799)。
// 仅在值发生变化时推送；接收端校验 Token，且只监听回环地址。

const RECEIVER_URL = 'http://127.0.0.1:8799/cookies';
const TOKEN = '__TOKEN__'; // 由 scripts/install-cookie-sync.sh 写入
const COOKIE_NAMES = ['__Secure-1PSID', '__Secure-1PSIDTS'];
const COOKIE_URL = 'https://gemini.google.com';

async function readCookies() {
  const out = {};
  for (const name of COOKIE_NAMES) {
    const c = await chrome.cookies.get({ url: COOKIE_URL, name });
    if (c && c.value) out[name] = c.value;
  }
  return out;
}

async function sync(reason) {
  try {
    const cookies = await readCookies();
    if (!cookies['__Secure-1PSID'] || !cookies['__Secure-1PSIDTS']) {
      console.log('[gg-sync] 跳过：Cookie 未就绪（', reason, '）');
      return;
    }
    const sig = JSON.stringify(cookies);
    const { lastSig } = await chrome.storage.local.get('lastSig');
    if (lastSig === sig) return; // 无变化，不推送

    const res = await fetch(RECEIVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': TOKEN },
      body: JSON.stringify({ cookies, reason }),
    });
    if (res.ok) {
      await chrome.storage.local.set({ lastSig: sig, lastPushAt: Date.now() });
      console.log('[gg-sync] 已推送（', reason, '）');
    } else {
      console.warn('[gg-sync] 推送被拒：', res.status, await res.text());
    }
  } catch (e) {
    console.warn('[gg-sync] 同步失败：', e && e.message);
  }
}

chrome.runtime.onInstalled.addListener(() => sync('install'));
chrome.runtime.onStartup.addListener(() => sync('startup'));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url && tab.url.startsWith(COOKIE_URL)) {
    sync('pageload');
  }
});
chrome.alarms.create('sync', { periodInMinutes: 30, delayInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'sync') sync('alarm');
});
sync('worker-start');

// 模型令牌配置：转发给接收服务（用于自动更新 GEMINI_MODEL_ALIASES）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'GG_MODEL_CONFIG' && Array.isArray(msg.chunks)) {
    fetch(RECEIVER_URL.replace('/cookies', '/models-config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': TOKEN },
      body: JSON.stringify({ chunks: msg.chunks }),
    }).catch(() => {});
  }
});
