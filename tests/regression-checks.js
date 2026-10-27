#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
const readerSource = read('js/epub-reader.js');
const zipSafetySource = read('js/zip-safety.js');
const serviceWorkerSource = read('service-worker.js');
const serverSource = read('server.js');
const indexSource = read('index.html');
const cssSource = read('css/styles.css');
const gitignoreSource = read('.gitignore');
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const manifest = JSON.parse(read('manifest.json'));

function countOccurrences(source, pattern) {
    return (source.match(pattern) || []).length;
}

function checkSyntax(relativePath) {
    const result = spawnSync(process.execPath, ['--check', relativePath], {
        cwd: projectRoot,
        encoding: 'utf8'
    });
    assert.strictEqual(
        result.status,
        0,
        `${relativePath} 语法检查失败：${result.stderr || result.stdout}`
    );
}

function readPngSize(relativePath) {
    const png = fs.readFileSync(path.join(projectRoot, relativePath));
    assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${relativePath} 不是 PNG`);
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// 基础可执行性：不依赖任何浏览器或外部测试框架，兼容 package.json 声明的 Node 14+。
['js/epub-reader.js', 'server.js', 'service-worker.js'].forEach(checkSyntax);

// EPUB 内容隔离：章节必须留在无脚本权限的 iframe，并有 CSP 与净化入口。
assert(readerSource.includes("chapterFrame.setAttribute('sandbox', 'allow-same-origin')"));
assert(!readerSource.includes("chapterFrame.setAttribute('sandbox', 'allow-scripts"));
assert(readerSource.includes("default-src 'none'"));
assert(readerSource.includes('function sanitizeEpubBody'));
assert(readerSource.includes('function sanitizeEpubCss'));
assert(readerSource.includes('const bodyContent = sanitizeEpubBody(htmlDoc)'));
assert(!readerSource.includes('<div class="chapter-content">${bodyContent}</div>'));

// 导入与进度保存：监听器和定时器都必须是单例，解析过程必须拒绝并发导入。
assert.strictEqual(countOccurrences(readerSource, /dropArea\.addEventListener\('drop', handleDrop, false\)/g), 1);
assert.strictEqual(countOccurrences(readerSource, /fileInput\.addEventListener\('change', handleFileSelect, false\)/g), 1);
assert.strictEqual(countOccurrences(readerSource, /setInterval\(/g), 1);
assert(readerSource.includes('let progressSaveInterval = null'));
assert(readerSource.includes('function startProgressAutoSave()'));
assert(readerSource.includes('function stopProgressAutoSave()'));
assert(readerSource.includes('clearInterval(progressSaveInterval)'));
assert(readerSource.includes('let isEpubImportInProgress = false'));
assert(readerSource.includes('if (isEpubImportInProgress)'));
assert(readerSource.includes('isEpubImportInProgress = false;'));
assert(readerSource.includes('const utf8Binary = encodeURIComponent(fileInfo + titleInfo)'));
assert(readerSource.includes('epubZipSafety.validateArchive(arrayBuffer)'));
assert(readerSource.includes('epubZipSafety.withParseTimeout(JSZip.loadAsync(arrayBuffer'));
assert(readerSource.includes('file.size > epubZipSafety.LIMITS.maxArchiveBytes'));
assert(zipSafetySource.includes('maxArchiveBytes: 100 * 1024 * 1024'));
assert(zipSafetySource.includes('maxEntries: 3000'));
assert(zipSafetySource.includes('maxTotalUncompressedBytes: 250 * 1024 * 1024'));
assert(zipSafetySource.includes('maxCompressionRatio: 100'));
assert(zipSafetySource.includes('parseTimeoutMs: 15_000'));

// 可访问性：图标按钮必须有名称、状态需要与实际展开状态联动，键盘焦点不可隐藏。
['theme-toggle', 'toc-button', 'open-new-file', 'font-decrease', 'font-increase', 'font-button'].forEach(id => {
    assert(new RegExp(`<button id="${id}"[^>]*aria-label=`).test(indexSource), `${id} 缺少 aria-label`);
});
assert(indexSource.includes('aria-controls="toc-container" aria-expanded="false"'));
assert(indexSource.includes('aria-controls="font-panel" aria-expanded="false"'));
assert(indexSource.includes('role="button" tabindex="0"'));
assert(readerSource.includes('function syncTocAccessibility()'));
assert(readerSource.includes('function setFontPanelOpen(open)'));
assert(readerSource.includes("status.setAttribute('role', 'status')"));
assert(cssSource.includes('button:focus-visible'));

// 本地静态服务器只能为 HTML 导航回退，缺失脚本必须给 404，不能把 HTML 当 JavaScript 返回。
assert(serverSource.includes('function isNavigationRequest(req, pathname)'));
assert(serverSource.includes("return sendStatus(res, 404, 'Not Found', req.method)"));
assert(serverSource.includes("acceptsHtml && !path.extname(pathname)"));

// 锁文件必须与当前项目声明匹配，避免 npm install 在不同机器解析到不同版本。
assert.strictEqual(packageLock.name, packageJson.name);
assert.strictEqual(packageLock.version, packageJson.version);
assert.strictEqual(packageLock.lockfileVersion, 2, 'package-lock.json 必须保持 Node 14/npm 7 兼容的 lockfile v2');
assert(packageLock.packages && packageLock.packages[''], 'package-lock.json 缺少根包记录');
assert.strictEqual(
    packageLock.packages[''].devDependencies['http-server'],
    packageJson.devDependencies['http-server']
);
assert(!gitignoreSource.split(/\r?\n/).includes('package-lock.json'), 'package-lock.json 不能被 Git 忽略');
assert.strictEqual(packageJson.scripts['test:browser'], 'playwright test');
assert(packageJson.devDependencies['@playwright/test'], '缺少浏览器回归依赖');
assert.strictEqual(packageJson.engines.node, '>=20', 'CI 的 Node 版本必须与 Playwright 支持范围一致');
assert(packageJson.devDependencies.jszip, '缺少离线浏览器回归所需的 JSZip');

// PWA 图标是真实的 maskable PNG，并且入口页和 Service Worker 都能找到它们。
const expectedIcons = [
    ['img/icon-192.png', 192],
    ['img/icon-512.png', 512]
];
const svgIcon = manifest.icons.find(item => item.src === 'img/icon.svg');
assert(svgIcon, 'manifest 缺少首选 SVG 图标');
assert.strictEqual(svgIcon.sizes, 'any');
assert.strictEqual(svgIcon.type, 'image/svg+xml');
expectedIcons.forEach(([src, size]) => {
    const icon = manifest.icons.find(item => item.src === src);
    assert(icon, `manifest 缺少 ${src}`);
    assert.strictEqual(icon.sizes, `${size}x${size}`);
    assert.strictEqual(icon.type, 'image/png');
    assert(icon.purpose.includes('maskable'));
    assert.deepStrictEqual(readPngSize(src), { width: size, height: size });
    assert(serviceWorkerSource.includes(`appAsset('${src}')`), `Service Worker 未预缓存 ${src}`);
});
assert(indexSource.includes('href="img/icon.svg"'));
assert(indexSource.includes('href="img/icon-192.png"'));
assert(indexSource.includes('src="js/zip-safety.js"'));
assert(indexSource.includes('/_vercel/insights/script.js'), 'Vercel 生产环境缺少 Analytics 脚本');
assert.strictEqual(manifest.start_url, './', 'PWA 必须从当前部署目录启动');
assert(readerSource.includes("navigator.serviceWorker.register('service-worker.js')"));
assert(serviceWorkerSource.includes("const APP_ROOT = new URL('./', self.registration.scope)"));
assert(serviceWorkerSource.includes("appAsset('js/zip-safety.js')"));

// PWA 仍需显式版本化，避免阅读逻辑更新后命中旧缓存。
assert(/const CACHE_NAME = 'lightreader-cache-v\d+'/.test(serviceWorkerSource));

// 浏览器测试必须使用提交到仓库的 fixture，确保本地与 CI 得到同一套输入。
['epub2-regression.epub', 'epub3-regression.epub', 'malicious-regression.epub'].forEach(filename => {
    const fixture = fs.readFileSync(path.join(projectRoot, 'tests', 'fixtures', filename));
    assert(fixture.subarray(0, 2).equals(Buffer.from('PK')), `${filename} 不是 ZIP/EPUB`);
});
assert(fs.existsSync(path.join(projectRoot, 'tests', 'browser', 'reader.spec.js')));

console.log('回归检查通过：语法、EPUB 隔离、导入单例、可访问性、PWA 资产、本地 404 与锁文件均符合约束。');
