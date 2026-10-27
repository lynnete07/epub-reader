const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3300;
const ROOT_DIR = __dirname;
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

function sendFile(res, filePath, method) {
    const extname = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    if (method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
}

function sendStatus(res, status, message, method) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    if (method !== 'HEAD') res.end(message);
    else res.end();
}

function isNavigationRequest(req, pathname) {
    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    return (req.method === 'GET' || req.method === 'HEAD') && acceptsHtml && !path.extname(pathname);
}

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendStatus(res, 405, 'Method Not Allowed', req.method);
    }

    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (error) {
        return sendStatus(res, 400, 'Bad Request', req.method);
    }

    const relativePath = pathname === '/'
        ? 'index.html'
        : path.normalize(pathname).replace(/^[/\\]+/, '');
    const filePath = path.resolve(ROOT_DIR, relativePath);

    if (filePath !== ROOT_DIR && !filePath.startsWith(ROOT_DIR + path.sep)) {
        return sendStatus(res, 403, 'Forbidden', req.method);
    }

    fs.stat(filePath, (error, stats) => {
        if (!error && stats.isFile()) return sendFile(res, filePath, req.method);

        if (error && error.code !== 'ENOENT') {
            return sendStatus(res, 500, 'Internal Server Error', req.method);
        }

        // SPA 路由只服务于浏览器的 HTML 导航；缺失的脚本、图片等必须明确 404。
        if (isNavigationRequest(req, pathname)) {
            return sendFile(res, path.join(ROOT_DIR, 'index.html'), req.method);
        }

        return sendStatus(res, 404, 'Not Found', req.method);
    });
});

server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}/`);
    console.log('按 Ctrl+C 停止服务器');
});
