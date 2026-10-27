// 缓存名称和版本
// 任何静态资源或阅读逻辑变动后，递增版本号以触发客户端缓存更新
const CACHE_NAME = 'lightreader-cache-v11';

// 需要缓存的静态资源
// 图标同时用于浏览器标签页与 PWA 安装界面，需随页面一起预缓存。
const CACHE_ASSETS = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/js/epub-reader.js',
    '/manifest.json',
    '/img/icon.svg',
    '/img/icon-192.png',
    '/img/icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2'
];

// 安装事件 - 预缓存资源
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: 缓存文件');
                // 逐项缓存并吞掉单个失败：cache.addAll 是原子的，
                // 任何一项 404 都会让整个 install 失败、离线能力全丢
                return Promise.all(
                    CACHE_ASSETS.map(url =>
                        cache.add(url).catch(err => {
                            console.warn('Service Worker: 跳过缓存失败的资源', url, err);
                        })
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log('Service Worker: 清理旧缓存');
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

// 请求拦截
self.addEventListener('fetch', event => {
    // 跳过非GET请求
    if (event.request.method !== 'GET') return;
    
    // 跳过跨域请求
    if (!event.request.url.startsWith(self.location.origin) && 
        !event.request.url.startsWith('https://cdnjs.cloudflare.com')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // 如果在缓存中找到，返回缓存内容
                if (cachedResponse) {
                    return cachedResponse;
                }
                
                // 否则发起网络请求
                return fetch(event.request)
                    .then(response => {
                        // 确保响应有效
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        // 克隆响应以便同时使用和缓存
                        const responseToCache = response.clone();
                        
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                            
                        return response;
                    })
                    .catch(() => {
                        // 如果网络请求失败，尝试返回离线页面
                        if (event.request.url.includes('html')) {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});
