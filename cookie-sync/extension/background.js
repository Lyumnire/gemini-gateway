// Gemini Gateway Cookie Sync — 最终版
// 重点：保持 Service Worker 存活 + 强制推送

const RECEIVER_URL = 'http://127.0.0.1:8799/cookies';
const TOKEN = '__TOKEN__'; // install-cookie-sync.sh 烘焙真实值到 extension-dist（源码不入真实 Token）
const COOKIE_NAMES = ['__Secure-1PSID', '__Secure-1PSIDTS'];
const COOKIE_URL = 'https://gemini.google.com';

async function readCookies() {
  const out = {};
  for (const name of COOKIE_NAMES) {
    try {
      const c = await chrome.cookies.get({ url: COOKIE_URL, name });
      if (c && c.value) out[name] = c.value;
    } catch (e) {
      console.warn('[gg-sync] readCookies error for', name, e);
    }
  }
  return out;
}

async function sync(reason) {
  try {
    const cookies = await readCookies();
    if (!cookies['__Secure-1PSID'] || !cookies['__Secure-1PSIDTS']) {
      console.log('[gg-sync] 跳过：Cookie 未就绪（' + reason + '）');
      return false;
    }

    console.log('[gg-sync] 推送中（' + reason + '）...');
    const res = await fetch(RECEIVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': TOKEN },
      body: JSON.stringify({ cookies, reason }),
    });
    if (res.ok) {
      const data = await res.json();
      console.log('[gg-sync] 已推送（' + reason + '）changed=' + data.changed);
      return true;
    } else {
      const text = await res.text();
      console.warn('[gg-sync] 推送被拒：' + res.status + ' ' + text);
      return false;
    }
  } catch (e) {
    console.warn('[gg-sync] 同步失败：' + (e && e.message));
    return false;
  }
}

// === 触发点 ===

// 1. 扩展安装/更新
chrome.runtime.onInstalled.addListener(() => { console.log('[gg-sync] onInstalled'); sync('install'); });

// 2. 浏览器启动
chrome.runtime.onStartup.addListener(() => { console.log('[gg-sync] onStartup'); sync('startup'); });

// 3. gemini.google.com 页面加载完成
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url && tab.url.startsWith(COOKIE_URL)) {
    console.log('[gg-sync] pageload: ' + tab.url);
    sync('pageload');
  }
});

// 4. 每 3 分钟定时推送（保持 Service Worker 存活）
chrome.alarms.create('sync', { periodInMinutes: 3, delayInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'sync') {
    console.log('[gg-sync] alarm fired');
    sync('alarm');
  }
});

// 5. Service Worker 启动时立即推送
console.log('[gg-sync] worker-start');
sync('worker-start');

// 6. Cookie 变化时推送
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.cookie && changeInfo.cookie.domain &&
      changeInfo.cookie.domain.includes('google.com')) {
    const name = changeInfo.cookie.name;
    if (COOKIE_NAMES.includes(name)) {
      console.log('[gg-sync] cookie changed: ' + name);
      sync('cookie-change');
    }
  }
});

// 7. Keep-alive: 每 25 秒记录一次心跳（防止 Service Worker 被挂起）
setInterval(() => {
  console.log('[gg-sync] heartbeat ' + new Date().toISOString());
}, 25000);
