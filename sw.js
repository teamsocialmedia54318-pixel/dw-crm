// يتيح تثبيت النظام كتطبيق ويسرّع فتحه. الصفحة تُعرض فورًا من النسخة المحفوظة على الجهاز،
// وفي الوقت نفسه تُجلب أحدث نسخة من الإنترنت، وإذا تغيّرت تُبلَّغ الصفحة لتعيد التحميل مرة واحدة.
// البيانات نفسها لا تُحفظ هنا أبدًا، فهي تُقرأ من خدمة جوجل في كل مرة
const CACHE = 'dw-crm-shell-v4';
const SHELL = ['./', './icon-192.png', './icon-512.png', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'dw-crm-auth').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const stamp = res => res && (res.headers.get('etag') || res.headers.get('last-modified') || '');

self.addEventListener('fetch', e => {
  const req = e.request;
  // طلبات خدمة جوجل والخطوط وغيرها تمر كما هي دون تخزين
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode !== 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(req).then(r => r || Response.error())));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match('./');
    const fresh = fetch(req).then(async res => {
      if (res.ok) {
        await cache.put('./', res.clone());
        if (cached && stamp(cached) !== stamp(res)) {
          const clients = await self.clients.matchAll({ type: 'window' });
          clients.forEach(c => c.postMessage('dw-updated'));
        }
      }
      return res;
    });
    if (cached) {
      e.waitUntil(fresh.catch(() => {}));
      return cached;
    }
    return fresh.catch(() => Response.error());
  }));
});

// ------- إشعارات التحويل الفورية (تصل حتى والنظام مغلق) -------
// الإشعار يصل من خدمة جوجل بدون محتوى، فيجلب عامل الخدمة نصه بكود الاتصال المحفوظ لهذا الجهاز ويعرضه
const AUTH_CACHE = 'dw-crm-auth';
const readJson = async (name, fallback) => { try { const r = await (await caches.open(AUTH_CACHE)).match(name); return r ? await r.json() : fallback; } catch { return fallback; } };
const writeJson = async (name, v) => { try { await (await caches.open(AUTH_CACHE)).put(name, new Response(JSON.stringify(v))); } catch {} };
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'dw-auth') e.waitUntil(writeJson('/__dw_auth', { url: e.data.url || '', relay: e.data.relay || '', key: e.data.key || '', user: e.data.user || '' }));
});
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const auth = await readJson('/__dw_auth', null);
    let items = [];
    // نص الإشعار من خدمة جوجل مباشرة، ولو الشبكة قافلاها (أو اتأخرت) من ممر Cloudflare
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
    if (auth && auth.url && auth.user) {
      const q = `action=inbox&user=${encodeURIComponent(auth.user)}`;
      try {
        const res = await withTimeout(fetch(`${auth.url}?key=${encodeURIComponent(auth.key)}&${q}`, { cache: 'no-store' }), 9000);
        items = (await res.json()).items || [];
      } catch {
        if (auth.relay) {
          try { const res = await withTimeout(fetch(`${auth.relay}?${q}`, { cache: 'no-store', headers: { 'X-CRM-Key': auth.key } }), 9000); items = (await res.json()).items || []; } catch {}
        }
      }
    }
    const seen = await readJson('/__dw_seen', []);
    let fresh = items.filter(i => !seen.includes(i.id));
    // يجب عرض إشعار لكل رسالة واردة، فإن تعذر جلب النص يظهر إشعار عام
    if (!fresh.length) fresh = [{ id: 'g' + Date.now(), title: 'Delta CRM', body: 'لديك إشعار جديد. افتح النظام لمعرفة التفاصيل', url: './#/notifications' }];
    // كل إشعار جديد يظهر لوحده (حتى 8 مرة واحدة)، الأقدم الأول
    await Promise.all(fresh.slice(0, 8).reverse().map(i => self.registration.showNotification(i.title || 'Delta CRM', {
      body: i.body || '', tag: i.id, icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'ar',
      vibrate: [200, 100, 200], renotify: true, requireInteraction: false, data: { url: i.url || './' },
    })));
    await writeJson('/__dw_seen', [...seen, ...fresh.map(i => i.id)].slice(-100));
    // الصفحة المفتوحة تجلب البيانات فورًا فيظهر التنبيه داخل النظام أيضًا
    (await self.clients.matchAll({ type: 'window' })).forEach(c => c.postMessage('dw-notice'));
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = list.find(c => c.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); try { await win.navigate(url); } catch {} return; }
    await self.clients.openWindow(url);
  })());
});