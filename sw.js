// 課堂形成性評量：Service Worker（v3.37；v3.38 背景更新改成一定向伺服器確認，發布後下一次打開就是新版）
// 目的：第二次以後打開不用重新下載 2 MB 的系統，網路慢或斷線也能開教師端。
// 策略：同網域的 .html／.js／.json 先回快取（秒開），同時在背景向伺服器拿新版存起來 → 下一次打開就是新版。
// 不經過這裡的：Firebase 等外部網址、非 GET、cache:'no-store' 的請求（例如「匯出本場」取原始檔）。
const CACHE = 'fa-cache-v1';   // 改策略時不用換名字；要清掉所有人的快取才換

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.cache === 'no-store') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (!/(\.html|\.js|\.json|\/)$/.test(url.pathname) || /\/sw\.js$/.test(url.pathname)) return;
  const key = url.origin + url.pathname;              // 不分 ?role=teacher&unit=… 等參數，同一個檔案只存一份
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    const net = (hit ? fetch(key, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req)).then(res => { if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })());
});
