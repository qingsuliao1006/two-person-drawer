/**
 * 记念 · Service Worker
 *
 * 存在的唯一理由：iOS 把网页「添加到主屏幕」后，独立模式启动时**不会**
 * 去服务器核对 index.html，可能一直拿着几天前的旧副本，表现为
 * 「电脑和安卓都更新了，iPad 还是老样子，重进多少次都没用」。
 *
 * 策略分三档：
 *   1. 页面导航（HTML）  → 网络优先（带 no-cache 校验）。拿不到网才回缓存。
 *      iOS 独立模式自己不会问，那就由这里替它问。
 *   2. /assets/ /fonts/ → 缓存优先。文件名带 hash，内容改了名字就变，不会拿错。
 *      **/icons/ 不能走缓存优先**：文件名是固定的（icon-512.png），换了图标
 *      名字也不变，缓存优先会让桌面上的旧图标一直留着。它们很小，走网络优先。
 *   3. 其它同源 GET（manifest 等）→ 网络优先，失败回缓存。
 * 跨域请求（Supabase 接口、图片存储）一律不碰，不缓存、不拦截。
 *
 * 改了下面的策略就要改 VERSION，激活时会把旧缓存清掉。
 */
const VERSION = 'v9'
const CACHE = `jinian-${VERSION}`
const OFFLINE_URL = './index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, './manifest.webmanifest']))
      // 预缓存失败不该让整个 SW 装不上
      .catch(() => undefined),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('jinian-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  if (/\/(assets|fonts)\//.test(url.pathname)) {
    event.respondWith(cacheFirst(request))
    return
  }

  event.respondWith(networkFirst(request))
})

/** 网络优先：no-cache 只做 ETag 校验，没变时服务器回 304，几乎不耗流量 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE)

  try {
    const response = await fetch(request, { cache: 'no-cache' })
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached

    const offline = await cache.match(OFFLINE_URL)
    if (offline) return offline

    throw error
  }
}

/** 缓存优先：这些文件名带 hash，内容变了名字就变了，不会拿错 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response && response.ok) cache.put(request, response.clone())
  return response
}
