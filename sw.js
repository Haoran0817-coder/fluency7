/* Fluency7 Service Worker —— 离线外壳 + 及时更新 */
const CACHE = 'f7-v2';
const SHELL = [
  '.',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/data-core.js',
  'js/data-daily.js',
  'js/data-ielts.js',
  'js/data-toefl.js',
  'js/data-big.js',
  'js/data-lessons.js',
  'js/data-lessons-extra.js',
  'js/data-lessons-extra2.js',
  'js/data-decoder.js',
  'js/data-linking.js',
  'js/data-linking-dialog.js',
  'js/data-ielts-full.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 跨域（有道/朗文/词典API）直接走网络

  // HTML 导航：network-first，保证更新及时；离线时回退缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put('index.html', cp)); return res; })
        .catch(() => caches.match('index.html').then(r => r || caches.match('.')))
    );
    return;
  }

  // app.js：network-first —— 代码必须保持最新，避免旧版本逻辑（如同步 bug）被缓存卡住
  if (/\/js\/app\.js($|\?)/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 其它静态资源（css/数据/图标）：cache-first，同时后台更新
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

// 收到页面“立即更新”指令：跳过等待，激活新 SW
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
