// DOM 元素
const dropArea = document.getElementById('drop-area');
const fileInput = document.getElementById('file-input');
const viewer = document.getElementById('viewer');
const tocButton = document.getElementById('toc-button');
const tocContainer = document.getElementById('toc-container');
const tocContent = document.getElementById('toc-content');
const themeToggle = document.getElementById('theme-toggle');
const fontIncrease = document.getElementById('font-increase');
const fontDecrease = document.getElementById('font-decrease');
const openNewFileBtn = document.getElementById('open-new-file');
const overlay = document.getElementById('overlay');
const fontButton = document.getElementById('font-button');
const fontPanel = document.getElementById('font-panel');

// 可选阅读字体。默认仅一项系统无衬线栈，其余交给「自定义」——用户填本机
// 已安装的字体名（支持逗号分隔回退栈，如 "iA Writer Quattro S, 方正屏显雅宋简体"：
// 拉丁字形用前者、中文自动回落后者）。不打包字体文件：商业字体再分发有授权问题，
// 引用字体名完全合法，未安装的设备走回退栈，体验不降级。
// lineHeight 与字体成套搭配；将来新增预置字体只需在此表加一项。
const READER_FONTS = {
    sans: {
        name: '默认 · 无衬线',
        lineHeight: 1.7,
        stack: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    }
};
const DEFAULT_FONT_KEY = 'sans';
const CUSTOM_FONT_KEY = 'custom';

// EPUB 相关变量
let book = null;
let currentChapter = 0;
let chapters = [];
let toc = [];
let bookTitle = '';
let currentBookPath = '';
let fromTocNavigation = false; // 标记当前章节切换是否来自目录导航
let isProcessingScroll = false; // 用于防止滚动过程中多次触发章节切换
let lastScrollTime = 0; // 最后一次滚动的时间戳
let scrollThrottleTime = 500; // 滚动切换章节的间隔时间（毫秒）
let isRestoringBook = false; // 标记是否正在恢复书籍
let objectUrls = []; // 本章为图片/字体等资源创建的 blob URL，切章时统一回收
let legacyMigration = null; // 旧 localStorage 书籍分块 -> IndexedDB 的迁移 Promise

// 应用设置
const settings = {
    theme: 'light',
    fontSize: 18,
    fontFamily: DEFAULT_FONT_KEY,
    customFontStack: '',
    readingProgress: {}
};

// 从本地存储加载设置
function loadSettings() {
    const savedSettings = localStorage.getItem('lightreader-settings');
    if (savedSettings) {
        try {
            const parsed = JSON.parse(savedSettings);
            Object.assign(settings, parsed);
            
            // 应用主题
            if (settings.theme === 'dark') {
                document.body.classList.add('dark-mode');
                themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
            }
            
            // 应用字体大小
            document.documentElement.style.setProperty('--font-size-base', `${settings.fontSize}px`);

            // 应用阅读字体（非法或缺失的键回落到默认）
            applyFontFamily(settings.fontFamily || DEFAULT_FONT_KEY, false);
        } catch (e) {
            console.error('加载设置出错:', e);
        }
    }
}

// 解析自定义字体栈：逗号分段、去空白、统一加引号（含空格/中文的字体名安全），
// 尾部追加默认栈兜底，用户字体缺失时静默回退
function customStackToCss(raw) {
    const userStack = (raw || '')
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, '').trim())
        .filter(Boolean)
        .map(name => `"${name.replace(/"/g, '')}"`)
        .join(', ');
    return userStack ? userStack + ', ' + READER_FONTS[DEFAULT_FONT_KEY].stack : '';
}

function getFontStack(key) {
    if (key === CUSTOM_FONT_KEY) {
        return customStackToCss(settings.customFontStack) || READER_FONTS[DEFAULT_FONT_KEY].stack;
    }
    return (READER_FONTS[key] || READER_FONTS[DEFAULT_FONT_KEY]).stack;
}

// 应用阅读字体。rescaleProgress 为 true 时按比例换算滚动位置：
// 字体改变会让内容重排，已存的像素进度会漂移，按 scrollHeight 比例修正
function applyFontFamily(key, rescaleProgress = true) {
    // 自定义字体不在 READER_FONTS 表里（它由 settings.customFontStack 提供），
    // 必须单独放行——否则会被下一行当成非法键静默回落默认，用户输入永远无效。
    // 栈为空时同样回落默认。
    const useCustom = key === CUSTOM_FONT_KEY && (settings.customFontStack || '').trim() !== '';
    if (!useCustom && !READER_FONTS[key]) key = DEFAULT_FONT_KEY;

    // 自定义字体沿用默认档的行距
    const lineHeight = useCustom
        ? READER_FONTS[DEFAULT_FONT_KEY].lineHeight
        : READER_FONTS[key].lineHeight;
    const beforeTop = viewer.scrollTop;
    const beforeHeight = viewer.scrollHeight;

    settings.fontFamily = key;
    viewer.style.setProperty('--reader-font-family', getFontStack(key));
    viewer.style.setProperty('--reader-line-height', String(lineHeight));

    if (rescaleProgress && beforeHeight > 0 && viewer.scrollHeight > 0) {
        viewer.scrollTop = Math.round(beforeTop / beforeHeight * viewer.scrollHeight);
    }
    updateFontPanelActive();
}

// 构建字体选择面板：预置项以自身字体渲染名字做预览；自定义区支持
// 输入本机已安装的字体名（逗号分隔多字体回退栈），输入框即时预览
function buildFontPanel() {
    fontPanel.innerHTML = '';

    // 选项一：预置字体（与「自定义」互斥，二选一）
    for (const [key, font] of Object.entries(READER_FONTS)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'font-option';
        item.dataset.fontKey = key;
        item.style.fontFamily = font.stack;
        item.textContent = font.name;
        item.addEventListener('click', () => {
            applyFontFamily(key);
            saveSettings();
        });
        fontPanel.appendChild(item);
    }

    // 选项二：自定义本机字体
    const customWrap = document.createElement('div');
    customWrap.className = 'font-custom';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'font-custom-input';
    input.placeholder = 'iA Writer Quattro S, 方正屏显雅宋简体';
    input.value = settings.customFontStack || '';
    input.spellcheck = false;

    // 提交自定义栈：非空则切到自定义，空则回落到默认（保持二选一语义）
    const commitCustom = () => {
        settings.customFontStack = input.value.trim();
        applyFontFamily(settings.customFontStack ? CUSTOM_FONT_KEY : DEFAULT_FONT_KEY);
        saveSettings();
    };

    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'font-option font-option-custom';
    customBtn.dataset.fontKey = CUSTOM_FONT_KEY;
    customBtn.textContent = '使用本机字体（自定义）';
    customBtn.addEventListener('click', () => {
        // 还没填就先聚焦输入框，而不是静默什么都不做
        if (!input.value.trim()) {
            input.focus();
            return;
        }
        commitCustom();
    });
    customWrap.appendChild(customBtn);
    customWrap.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'font-custom-actions';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'font-apply';
    applyBtn.textContent = '应用';
    applyBtn.addEventListener('click', commitCustom);
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'font-clear';
    clearBtn.textContent = '清除';
    clearBtn.addEventListener('click', () => {
        input.value = '';
        input.style.fontFamily = '';
        settings.customFontStack = '';
        applyFontFamily(DEFAULT_FONT_KEY);
        saveSettings();
    });
    actions.appendChild(applyBtn);
    actions.appendChild(clearBtn);
    customWrap.appendChild(actions);

    // 输入即时预览（不落盘）
    input.addEventListener('input', () => {
        input.style.fontFamily = customStackToCss(input.value);
    });
    // 失焦或回车提交
    input.addEventListener('change', commitCustom);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitCustom();
        }
    });

    const hint = document.createElement('p');
    hint.className = 'font-hint';
    hint.textContent = '填本机已安装的字体名，逗号分隔、依次回退：前面的字体优先，缺字自动用后面的补。\n查字体名：macOS 打开「字体册」（Font Book）；Windows 设置 → 个性化 → 字体。\n多字体可按语言分工，如示例：英文用 Quattro S、中文回退雅宋。';
    customWrap.appendChild(hint);

    fontPanel.appendChild(customWrap);

    // 状态行：明确告诉用户当前生效的是哪一项
    const status = document.createElement('div');
    status.className = 'font-status';
    fontPanel.appendChild(status);

    updateFontPanelActive();
}

// 高亮当前选中的字体项（二选一，任何时候只有一项 active）
function updateFontPanelActive() {
    if (!fontPanel) return;
    fontPanel.querySelectorAll('[data-font-key]').forEach(el => {
        el.classList.toggle('active', el.dataset.fontKey === settings.fontFamily);
    });
    const wrap = fontPanel.querySelector('.font-custom');
    if (wrap) wrap.classList.toggle('active', settings.fontFamily === CUSTOM_FONT_KEY);

    const status = fontPanel.querySelector('.font-status');
    if (status) {
        const label = settings.fontFamily === CUSTOM_FONT_KEY
            ? '自定义 · ' + (settings.customFontStack || '')
            : (READER_FONTS[settings.fontFamily] || READER_FONTS[DEFAULT_FONT_KEY]).name;
        status.textContent = '当前生效：' + label;
    }
}

// 保存设置到本地存储。
// localStorage 只有约 5MB 且按 UTF-16 计费，书籍数据塞进去后很容易写满，
// 导致设置（含阅读进度）静默丢失——所以这里必须容错，绝不把异常抛给调用方。
function saveSettings() {
    try {
        localStorage.setItem('lightreader-settings', JSON.stringify(settings));
        return true;
    } catch (e) {
        console.warn('保存设置失败:', e.name, e.message);
        // 先尝试瘦身：只保留当前书籍的阅读进度再写一次
        try {
            const keep = currentBookPath && settings.readingProgress[currentBookPath]
                ? { [currentBookPath]: settings.readingProgress[currentBookPath] }
                : {};
            localStorage.setItem('lightreader-settings',
                JSON.stringify(Object.assign({}, settings, { readingProgress: keep })));
            console.warn('已精简阅读进度后保存成功（其他书籍的进度记录被丢弃）');
            return true;
        } catch (e2) {
            console.error('设置仍无法保存，阅读进度本次不会持久化:', e2.name);
            return false;
        }
    }
}

// ===== 书籍文件存储 =====
// EPUB 二进制原先以 base64 分块塞进 localStorage：体积膨胀 33% 且按 UTF-16
// 计配额，稍大一点的书必然写不下，表现为"刷新后书不见了"。
// 改为优先存 IndexedDB（容量远大于 localStorage，且直接存二进制），
// localStorage 分块只作为 IndexedDB 不可用时的回落。
const BOOK_DB_NAME = 'lightreader-books';
const BOOK_DB_STORE = 'files';

function openBookDb() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('浏览器不支持 IndexedDB'));
        let req;
        try {
            req = indexedDB.open(BOOK_DB_NAME, 1);
        } catch (e) {
            return reject(e);
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(BOOK_DB_STORE)) {
                db.createObjectStore(BOOK_DB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
        req.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞'));
    });
}

// 存储书籍二进制（ArrayBuffer）
async function storeBookFile(bookId, arrayBuffer) {
    const db = await openBookDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(BOOK_DB_STORE, 'readwrite');
            tx.objectStore(BOOK_DB_STORE).put(arrayBuffer, bookId);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error('写入 IndexedDB 失败'));
            tx.onabort = () => reject(tx.error || new Error('写入 IndexedDB 被中止'));
        });
    } finally {
        db.close();
    }
}

// 读取书籍二进制，返回 ArrayBuffer，不存在则为 undefined
async function getBookFile(bookId) {
    const db = await openBookDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(BOOK_DB_STORE, 'readonly');
            const req = tx.objectStore(BOOK_DB_STORE).get(bookId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('读取 IndexedDB 失败'));
        });
    } finally {
        db.close();
    }
}

// 回落方案：localStorage 分块（同步，返回块数量与实际存储字节数）
function storeBookFileLegacy(bookId, arrayBuffer) {
    const fileData = new Uint8Array(arrayBuffer);
    const chunkSize = 1024 * 64;
    const chunkCount = Math.ceil(fileData.length / chunkSize);
    let stored = 0;
    for (let i = 0; i < chunkCount; i++) {
        const chunk = fileData.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, fileData.length));
        let binary = '';
        for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
        localStorage.setItem(`${bookId}_chunk_${i}`, btoa(binary));
        stored += chunk.length;
        if (stored >= fileData.length) break;
    }
    return { chunkCount, storedSize: stored };
}

// 回落方案：读取 localStorage 分块，任一块缺失返回 null
function loadBookFileLegacy(bookId, chunkCount) {
    let binary = '';
    for (let i = 0; i < chunkCount; i++) {
        const v = localStorage.getItem(`${bookId}_chunk_${i}`);
        if (v === null) return null;
        binary += atob(v);
    }
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.buffer;
}

// 一次性迁移：把历史上存在 localStorage 的书籍分块搬进 IndexedDB，
// 成功后删除 localStorage 分块，把被书籍占位挤满的配额还给设置存储。
// 只有 IndexedDB 写入成功才删除，避免数据两头丢失。
async function migrateLegacyBookChunks() {
    if (!('indexedDB' in window)) return 0;
    const groups = new Map();
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const m = key && key.match(/^(.+)_chunk_(\d+)$/);
        if (!m) continue;
        if (!groups.has(m[1])) groups.set(m[1], []);
        groups.get(m[1]).push([parseInt(m[2], 10), key]);
    }
    if (groups.size === 0) return 0;

    let moved = 0;
    for (const [bookId, entries] of groups) {
        entries.sort((a, b) => a[0] - b[0]);
        try {
            let binary = '';
            for (const [, key] of entries) {
                const v = localStorage.getItem(key);
                if (v === null) throw new Error('缺少分块');
                binary += atob(v);
            }
            const buf = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
            await storeBookFile(bookId, buf.buffer);
            for (const [, key] of entries) localStorage.removeItem(key);
            const progress = settings.readingProgress && settings.readingProgress[bookId];
            if (progress && progress.fileInfo) {
                progress.fileInfo.storage = 'indexeddb';
                progress.fileInfo.chunks = 0;
                delete progress.fileInfo.storedSize;
            }
            moved++;
        } catch (e) {
            console.warn('迁移旧书籍数据失败，保留原 localStorage 分块:', bookId, e.message);
        }
    }
    if (moved > 0) saveSettings();
    return moved;
}

// 保存阅读进度
function saveReadingProgress() {
    if (!currentBookPath || !book) return;
    
    const oldProgress = settings.readingProgress[currentBookPath] || {};
    
    settings.readingProgress[currentBookPath] = {
        title: bookTitle,
        chapter: currentChapter,
        position: viewer.scrollTop,
        timestamp: new Date().getTime(),
        totalChapters: chapters.length,
        fileInfo: oldProgress.fileInfo || {
            name: currentBookPath.split('-').pop() + '.epub',
            size: 0,
            lastModified: new Date().getTime()
        }
    };
    
    saveSettings();
}

// 加载阅读进度
function loadReadingProgress(restoreScrollPosition = true) {
    if (!currentBookPath || !book) return;
    
    const progress = settings.readingProgress[currentBookPath];
    if (progress && progress.chapter !== undefined) {
        currentChapter = progress.chapter;
        displayChapter(currentChapter).then(() => {
            // 只有当不是从目录导航来的，且需要恢复滚动位置时，才恢复之前的位置
            if (restoreScrollPosition && progress.position && !fromTocNavigation) {
                viewer.scrollTop = progress.position;
            }
        });
    }
}

// 生成文件ID
function generateFileId(file, title) {
    // 生成一个基于文件信息和标题的唯一ID
    const fileInfo = `${file.name}-${file.size}-${file.lastModified}`;
    const titleInfo = title ? `-${title}` : '';
    return `book-${btoa(fileInfo + titleInfo).replace(/[+/=]/g, '')}`;
}

// 匿名产品事件上报（Vercel Web Analytics）
// 只上报事件名称，绝不携带书名、作者、正文、阅读位置、书籍 ID 或任何可识别信息。
// 统计不可用时静默失败，任何情况下都不影响阅读。
function trackEvent(name) {
    try {
        if (typeof window.va === 'function') {
            window.va('event', { name });
        }
    } catch (e) {
        // 统计失败不应打断阅读
    }
}

// 把章节内的相对引用解析成 zip 条目名
// chapter.href 形如 "OEBPS/chapter1.xhtml"，没有前导斜杠。必须拼成 file:///，
// 否则 URL 会把 "OEBPS" 当成主机名而不是目录，解析结果会丢掉整个子目录前缀。
function resolveZipPath(src, baseHref) {
    if (!src) return null;
    const value = src.trim();
    // 外链与内联数据交给浏览器，不在 zip 里查找
    if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return null;
    try {
        const url = new URL(value, 'file:///' + baseHref);
        // decodeURIComponent 还原空格、中文等被百分号编码的字符
        return decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch (e) {
        return null;
    }
}

// 把 zip 内的资源转成 blob URL，并登记以便切章时回收
async function createObjectUrlFromZip(path) {
    if (!book || !path) return null;
    const entry = book.zip.file(path);
    if (!entry) return null;
    try {
        const blob = await entry.async('blob');
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return url;
    } catch (e) {
        console.warn('创建资源 URL 失败:', path, e);
        return null;
    }
}

// 把 CSS 里的 url(...) 替换为可访问的 blob URL
// basePath 传样式表自身在 zip 中的路径，这样样式表内部的相对引用才解析正确
async function inlineCssUrls(css, basePath) {
    if (!css) return css;
    const refs = css.match(/url\(([^)]*)\)/g) || [];
    for (const ref of refs) {
        const raw = ref.slice(4, -1).trim().replace(/^['"]+|['"]+$/g, '');
        const path = resolveZipPath(raw, basePath);
        if (!path) continue;
        const url = await createObjectUrlFromZip(path);
        if (url) {
            css = css.split(ref).join(`url("${url}")`);
        }
    }
    return css;
}

// 回收上一章创建的 blob URL，避免长时间阅读后内存持续增长
function releaseObjectUrls() {
    for (const url of objectUrls) {
        URL.revokeObjectURL(url);
    }
    objectUrls = [];
}

// 切换主题
function toggleTheme() {
    if (settings.theme === 'light') {
        settings.theme = 'dark';
        document.body.classList.add('dark-mode');
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    } else {
        settings.theme = 'light';
        document.body.classList.remove('dark-mode');
        themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
    }
    saveSettings();
}

// 改变字体大小（上限 32：无障碍与移动端大字阅读需求）
function changeFontSize(delta) {
    settings.fontSize = Math.max(12, Math.min(32, settings.fontSize + delta));
    document.documentElement.style.setProperty('--font-size-base', `${settings.fontSize}px`);
    saveSettings();
}

// 打开新文件
function openNewFile() {
    // 保存当前阅读进度
    if (book) {
        saveReadingProgress();
    }
    
    // 获取当前网站的基础 URL（不包含查询参数）
    const baseUrl = window.location.origin + window.location.pathname;
    
    // 直接在新窗口打开基础 URL
    window.open(baseUrl, '_blank');
}

// 初始化拖放区域事件
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => {
        dropArea.classList.add('drag-over');
    }, false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => {
        dropArea.classList.remove('drag-over');
    }, false);
});

dropArea.addEventListener('drop', handleDrop, false);
fileInput.addEventListener('change', handleFileSelect, false);

// 处理拖放
function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    
    if (files.length && (files[0].type === 'application/epub+zip' || files[0].name.toLowerCase().endsWith('.epub'))) {
        handleEpubFile(files[0]);
    } else {
        alert('请上传有效的EPUB文件');
    }
}

// 处理文件选择
function handleFileSelect(e) {
    const files = e.target.files;
    
    if (files.length && (files[0].type === 'application/epub+zip' || files[0].name.toLowerCase().endsWith('.epub'))) {
        handleEpubFile(files[0]);
    } else {
        alert('请上传有效的EPUB文件');
    }
}

// 更新书籍的URL哈希但不触发hashchange事件
function updateBookHash(bookId) {
    // 临时移除hashchange监听器
    window.removeEventListener('hashchange', handleHashChange);
    
    // 更新URL哈希
    window.location.hash = `book=${encodeURIComponent(bookId)}`;
    
    // 确保哈希保留在URL中，不会被其他参数覆盖
    setTimeout(() => {
        // 恢复hashchange监听器
        window.addEventListener('hashchange', handleHashChange);
    }, 100);
}

// 处理EPUB文件
async function handleEpubFile(file, existingBookPath = null) {
    try {
        // 显示加载中的消息或动画
        viewer.innerHTML = '<div class="loading">加载中，请稍候...</div>';
        viewer.classList.remove('hidden');
        dropArea.classList.add('hidden');
        
        // 读取文件内容
        let arrayBuffer;
        try {
            arrayBuffer = await readFileAsArrayBuffer(file);
            
            // 添加文件完整性检查
            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                throw new Error('文件为空或无法读取');
            }
            
            // 检查文件大小是否与预期匹配
            if (file.size !== arrayBuffer.byteLength) {
                console.warn(`文件大小不匹配：预期 ${file.size}，实际 ${arrayBuffer.byteLength}`);
            }
            
            console.log(`成功读取文件，大小：${arrayBuffer.byteLength} 字节`);
        } catch (error) {
            throw new Error(`读取文件失败: ${error.message}`);
        }
        
        // 尝试解析EPUB文件
        try {
            // 使用JSZip解压EPUB - 添加错误处理
            let zip;
            try {
                zip = await JSZip.loadAsync(arrayBuffer, {
                    checkCRC32: true  // 启用CRC32校验以确保ZIP完整性
                });
            } catch (zipError) {
                console.error('解压文件失败:', zipError);
                // 尝试修复常见的ZIP文件问题
                throw new Error(`解压文件失败: ${zipError.message}。可能是EPUB文件已损坏，请尝试重新下载或使用其他EPUB文件。`);
            }
            
            // 检查ZIP文件是否包含必要的文件
            if (!zip.files['mimetype'] || !zip.files['META-INF/container.xml']) {
                throw new Error('无效的EPUB文件结构：缺少必要的文件');
            }
            
            // 解析容器文件找到OPF文件位置
            let containerXml;
            try {
                containerXml = await zip.file('META-INF/container.xml').async('text');
            } catch (error) {
                throw new Error(`无法读取容器文件: ${error.message}`);
            }
            
            const opfPath = getOpfPath(containerXml);
            
            if (!opfPath) {
                throw new Error('无法找到OPF文件路径');
            }
            
            // 确保OPF文件存在
            if (!zip.files[opfPath]) {
                throw new Error(`找不到OPF文件: ${opfPath}`);
            }
            
            // 解析OPF文件
            const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
            let opfContent;
            try {
                opfContent = await zip.file(opfPath).async('text');
            } catch (error) {
                throw new Error(`无法读取OPF文件: ${error.message}`);
            }
            
            const { spine, manifest, metadata, tocPath } = parseOpf(opfContent);
            
            // 获取书籍标题
            bookTitle = getBookTitle(metadata) || '未知书籍';
            document.title = bookTitle ? `${bookTitle} - LightReader` : 'LightReader';
            
            // 获取章节
            chapters = getChapters(spine, manifest, opfDir);
            
            if (!chapters || chapters.length === 0) {
                throw new Error('无法找到有效的章节内容');
            }
            
            // 解析目录
            let ncxContent = null;
            if (tocPath) {
                const tocFilePath = opfDir + tocPath;
                const tocFile = zip.file(tocFilePath);
                if (tocFile) {
                    try {
                    ncxContent = await tocFile.async('text');
                    } catch (error) {
                        console.warn(`无法读取目录文件: ${error.message}`);
                        // 目录读取失败不阻止继续处理
                    }
                } else {
                    console.warn(`找不到目录文件: ${tocFilePath}`);
                }
            }
            
            // 存储书籍信息
            book = {
                zip,
                opfDir,
                spine,
                manifest,
                metadata,
                toc: ncxContent ? parseNcx(ncxContent, opfDir) : []
            };
            
            // 生成唯一的书籍ID 或 使用提供的ID
            const bookId = existingBookPath || generateFileId(file, bookTitle);
            currentBookPath = bookId;
            
            console.log('处理书籍:', bookTitle, '(ID:', bookId, ')');
            
            // 只有在没有提供existingBookPath时才需要存储文件数据
            // 因为提供existingBookPath意味着我们正在从已有的存储中恢复
            if (!existingBookPath) {
                try {
                    // 优先写 IndexedDB；不可用时回落 localStorage 分块。
                    // 注意：localStorage 分块对稍大的书必然写不下，刷新就恢复不了，
                    // 所以这里必须如实记录 storage，让恢复阶段知道去哪里找数据。
                    let fileInfo;
                    try {
                        await storeBookFile(bookId, arrayBuffer);
                        fileInfo = {
                            name: file.name,
                            type: file.type || 'application/epub+zip',
                            size: file.size,
                            lastModified: file.lastModified,
                            storage: 'indexeddb'
                        };
                        console.log('书籍已存入 IndexedDB:', (file.size / 1024 / 1024).toFixed(2), 'MB');
                    } catch (idbError) {
                        console.warn('IndexedDB 不可用，回落到 localStorage 分块:', idbError.message);
                        // 清掉同名旧分块，避免新旧混杂
                        for (let i = localStorage.length - 1; i >= 0; i--) {
                            const key = localStorage.key(i);
                            if (key && key.startsWith(`${bookId}_chunk_`)) localStorage.removeItem(key);
                        }
                        const legacy = storeBookFileLegacy(bookId, arrayBuffer);
                        fileInfo = {
                            name: file.name,
                            type: file.type || 'application/epub+zip',
                            size: file.size,
                            lastModified: file.lastModified,
                            storage: 'localStorage',
                            chunks: legacy.chunkCount,
                            storedSize: legacy.storedSize
                        };
                    }

                    // 更新阅读进度中的文件信息
                    if (!settings.readingProgress[bookId]) {
                        settings.readingProgress[bookId] = {};
                    }

                    settings.readingProgress[bookId].fileInfo = fileInfo;

                    // 保存元数据
                    settings.readingProgress[bookId].metadata = {
                        title: bookTitle,
                        author: getAuthor(metadata) || '未知作者',
                        totalChapters: chapters.length
                    };

                    saveSettings();
                } catch (e) {
                    console.log('存储书籍数据时出现问题，本次阅读不受影响，但刷新后无法自动恢复:', e.message);
                }
            }
            
            // 更新URL哈希以支持刷新恢复
            updateBookHash(bookId);
            
            // 加载阅读进度或显示第一章
            let progress = null;
            if (existingBookPath) {
                // 如果是恢复的书籍，不要在这里加载阅读进度，让调用方处理
                // 只需加载第一章，阅读进度会在后续通过displayChapter设置
                currentChapter = 0;
                await displayChapter(currentChapter);
            } else {
                // 新打开的书籍，检查是否有阅读进度
                progress = settings.readingProgress[bookId];
            if (progress && progress.chapter !== undefined) {
                currentChapter = progress.chapter;
                    // 有阅读进度，恢复上次阅读位置
                await displayChapter(currentChapter);
                    
                    // 延迟恢复滚动位置，确保内容已完全加载
                setTimeout(() => {
                    if (progress.position) {
                        viewer.scrollTop = progress.position;
                    }
                }, 100);
            } else {
                    // 没有阅读进度，从第一章开始
                currentChapter = 0;
                await displayChapter(currentChapter);
                }
            }
            
            // 启用必要的控件
            tocButton.disabled = false;
            openNewFileBtn.classList.remove('hidden');
            
            // 渲染目录
            renderToc(book.toc);
            
            // 初始时自动打开目录栏
            tocContainer.classList.remove('hidden');
            
            // 初始化布局
            handleWindowResize();
            
            // 保存当前进度，同时会触发最近阅读列表更新
            saveReadingProgress();
            
            // 定期保存阅读进度
            const saveInterval = setInterval(() => {
                if (book) {
                    saveReadingProgress();
                } else {
                    clearInterval(saveInterval);
                }
            }, 30000); // 每30秒保存一次
            
            // 匿名上报：一本书被成功打开（不含书名等任何内容信息）
            trackEvent('epub_opened');

            // 返回成功
            return true;
            
        } catch (epubParseError) {
            // 仅在控制台记录详细错误
            console.error('解析EPUB文件出错:', epubParseError);
            
            // 检查是否已经加载了章节内容
            if (book && chapters && chapters.length > 0) {
                // 如果章节内容已加载，忽略其他错误
                // 这样在Base64编码错误时，只要内容已加载就不显示错误
                displayChapter(currentChapter);
                
                // 启用必要的控件
                tocButton.disabled = false;
                openNewFileBtn.classList.remove('hidden');
                
                // 渲染目录 - 即使目录解析失败也不影响阅读
                if (book.toc && book.toc.length > 0) {
                    renderToc(book.toc);
                } else {
                    tocContent.innerHTML = '<div class="empty-toc"><span class="empty-toc-icon">📝</span><p>没有可用的目录</p></div>';
                }
                
                // 初始时自动打开目录栏
                tocContainer.classList.remove('hidden');
                
                // 初始化布局
                handleWindowResize();

                // 目录等次要步骤失败但正文可用，同样视为成功打开
                trackEvent('epub_opened');

                return true;
            }
            
            // 如果章节内容未加载，则显示错误
            viewer.innerHTML = `
                <div class="error">
                    <h3>解析EPUB文件出错</h3>
                    <p>${epubParseError.message}</p>
                    <div class="error-details">
                        <p>可能的原因：</p>
                        <ul>
                            <li>EPUB文件已损坏或不完整</li>
                            <li>不符合EPUB标准的文件格式</li>
                            <li>文件过大，超出浏览器处理能力</li>
                        </ul>
                        <p>请尝试：</p>
                        <ul>
                            <li>使用其他EPUB文件测试</li>
                            <li>重新下载或获取EPUB文件</li>
                            <li>使用EPUBCheck等工具验证文件</li>
                        </ul>
                    </div>
                </div>
            `;
            return false;
        }
    } catch (error) {
        console.error('处理EPUB文件时出错:', error);
        viewer.innerHTML = `
            <div class="error">
                <h3>处理EPUB文件时出错</h3>
                <p>${error.message}</p>
                <div class="error-action">
                    <button onclick="location.reload()">刷新页面</button>
                </div>
            </div>
        `;
        return false;
    }
}

// 将文件读取为 ArrayBuffer
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(e);
        reader.readAsArrayBuffer(file);
    });
}

// 从容器XML中获取OPF文件路径
function getOpfPath(containerXml) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(containerXml, 'application/xml');
    const rootfiles = xmlDoc.getElementsByTagName('rootfile');
    
    for (let i = 0; i < rootfiles.length; i++) {
        if (rootfiles[i].getAttribute('media-type') === 'application/oebps-package+xml') {
            return rootfiles[i].getAttribute('full-path');
        }
    }
    
    return null;
}

// 解析OPF文件
function parseOpf(opfContent) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(opfContent, 'application/xml');
    
    // 获取元数据
    const metadataElement = xmlDoc.getElementsByTagName('metadata')[0];
    const metadata = metadataElement ? Array.from(metadataElement.children) : [];
    
    // 获取清单
    const manifestElement = xmlDoc.getElementsByTagName('manifest')[0];
    const manifestItems = manifestElement ? Array.from(manifestElement.getElementsByTagName('item')) : [];
    const manifest = {};
    
    manifestItems.forEach(item => {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        const mediaType = item.getAttribute('media-type');
        const properties = item.getAttribute('properties') || '';
        
        manifest[id] = { href, mediaType, properties };
    });
    
    // 获取脊柱（章节顺序）
    const spineElement = xmlDoc.getElementsByTagName('spine')[0];
    const spineItems = spineElement ? Array.from(spineElement.getElementsByTagName('itemref')) : [];
    const spine = spineItems.map(item => item.getAttribute('idref'));
    
    // 寻找目录文件
    let tocPath = null;
    let tocId = spineElement ? spineElement.getAttribute('toc') : null;
    
    // 首先尝试从 spine 的 toc 属性找到 NCX 文件 (EPUB2)
    if (tocId && manifest[tocId]) {
        tocPath = manifest[tocId].href;
    } else {
        // 查找 NCX 文件 (EPUB2)
        for (const id in manifest) {
            if (manifest[id].mediaType === 'application/x-dtbncx+xml') {
                tocPath = manifest[id].href;
                break;
            }
        }
        
        // 如果没有找到 NCX，尝试查找 EPUB3 导航文档
        if (!tocPath) {
            for (const id in manifest) {
                if (manifest[id].properties && manifest[id].properties.includes('nav')) {
                    tocPath = manifest[id].href;
                    break;
                }
            }
        }
    }
    
    return { spine, manifest, metadata, tocPath };
}

// 获取书籍标题
function getBookTitle(metadata) {
    for (const element of metadata) {
        if (element.localName === 'title') {
            return element.textContent;
        }
    }
    return '';
}

// 获取书籍作者
function getAuthor(metadata) {
    for (const element of metadata) {
        if (element.localName === 'creator') {
            return element.textContent;
        }
    }
    return '';
}

// 获取章节
function getChapters(spine, manifest, opfDir) {
    return spine
        .filter(id => manifest[id])
        .map(id => {
            const { href, mediaType } = manifest[id];
            return {
                id,
                href: opfDir + href,
                mediaType
            };
        });
}

// 解析NCX文件（目录）
function parseNcx(ncxContent, opfDir) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(ncxContent, 'application/xml');
    
    // 检查是否为 NCX 文件
    const navPoints = xmlDoc.getElementsByTagName('navPoint');
    if (navPoints.length > 0) {
        // 解析 EPUB2 的 NCX 文件
        const toc = [];
        
        for (let i = 0; i < navPoints.length; i++) {
            const navPoint = navPoints[i];
            const navLabel = navPoint.getElementsByTagName('navLabel')[0];
            const text = navLabel ? navLabel.getElementsByTagName('text')[0].textContent : '';
            const content = navPoint.getElementsByTagName('content')[0];
            const src = content ? content.getAttribute('src') : '';
            
            if (text && src) {
                toc.push({
                    title: text,
                    href: opfDir + src.split('#')[0], // 移除锚点
                    id: navPoint.getAttribute('id'),
                    level: getNavLevel(navPoint)
                });
            }
        }
        
        return toc;
    } else {
        // 尝试解析 EPUB3 的导航文档
        try {
            // 检查是否包含 nav 元素
            const navElement = xmlDoc.querySelector('nav[epub\\:type="toc"], nav[*|type="toc"]');
            if (navElement) {
                return parseNav(navElement, opfDir);
            }
        } catch (error) {
            console.warn("解析 EPUB3 导航文档失败:", error);
        }
        
        // 如果没有找到任何有效的目录结构，返回空数组
        return [];
    }
}

// 解析 EPUB3 导航文档中的 nav 元素
function parseNav(navElement, opfDir) {
    const toc = [];
    
    // 找到所有列表项
    const parseNavItems = (element, level = 0) => {
        if (!element) return;
        
        // 处理列表中的项目
        const items = element.querySelectorAll(':scope > li');
        
        items.forEach(item => {
            // 获取链接和标题
            const link = item.querySelector('a');
            if (link) {
                const href = link.getAttribute('href');
                const title = link.textContent.trim();
                
                if (href && title) {
                    toc.push({
                        title: title,
                        href: opfDir + href.split('#')[0], // 移除锚点
                        id: 'nav-' + toc.length, // 生成唯一ID
                        level: level
                    });
                }
            }
            
            // 递归处理嵌套列表
            const nestedList = item.querySelector('ol, ul');
            if (nestedList) {
                parseNavItems(nestedList, level + 1);
            }
        });
    };
    
    // 开始解析
    const navList = navElement.querySelector('ol, ul');
    if (navList) {
        parseNavItems(navList);
    }
    
    return toc;
}

// 获取导航点的级别
function getNavLevel(navPoint) {
    let level = 0;
    let parent = navPoint.parentNode;
    
    while (parent && parent.nodeName !== 'navMap') {
        if (parent.nodeName === 'navPoint') {
            level++;
        }
        parent = parent.parentNode;
    }
    
    return level;
}

// 显示章节内容
async function displayChapter(index) {
    if (!book || !chapters[index]) return;
    
    try {
        const chapter = chapters[index];

        // 回收上一章创建的 blob URL，避免长时间阅读后内存持续增长
        releaseObjectUrls();

        const content = await book.zip.file(chapter.href).async('text');
        
        // 解析HTML内容
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(content, 'text/html');
        
        // 提取CSS
        // 外链样式表同样要用 resolveZipPath 定位；样式表内部的 url() 以样式表
        // 自身所在目录为基准，所以要传 cssPath 而不是章节路径
        const styles = Array.from(htmlDoc.querySelectorAll('style, link[rel="stylesheet"]'));
        let cssContent = '';
        
        for (const style of styles) {
            if (style.tagName === 'STYLE') {
                cssContent += await inlineCssUrls(style.textContent, chapter.href);
            } else if (style.tagName === 'LINK' && style.getAttribute('href')) {
                const cssPath = resolveZipPath(style.getAttribute('href'), chapter.href);
                if (!cssPath) continue;
                
                const cssFile = book.zip.file(cssPath);
                if (cssFile) {
                    const css = await cssFile.async('text');
                    cssContent += await inlineCssUrls(css, cssPath);
                }
            }
        }
        
        // 处理图片：<img src> 与内嵌 SVG 的 <image href / xlink:href>
        // 必须在序列化 bodyContent 之前改 DOM，否则替换结果不会进入渲染内容
        const imageNodes = Array.from(htmlDoc.querySelectorAll('img, image'));
        for (const node of imageNodes) {
            const attr = node.hasAttribute('src') ? 'src'
                : (node.hasAttribute('href') ? 'href' : 'xlink:href');
            const src = node.getAttribute(attr);
            if (!src) continue;
            
            const imgPath = resolveZipPath(src, chapter.href);
            if (!imgPath) continue;
            
            const url = await createObjectUrlFromZip(imgPath);
            if (url) {
                node.setAttribute(attr, url);
            }
        }
        
        // 提取<body>内容
        // 必须放在资源替换之后：bodyContent 是字符串快照，早取会丢掉上面的修改
        const bodyContent = htmlDoc.body ? htmlDoc.body.innerHTML : content;
        
        // 显示内容前先重置滚动位置（除非显式指定跳转到结尾）
        if (!fromTocNavigation || !window.jumpToEnd) {
            viewer.scrollTop = 0;
        }
        
        // 显示内容
        viewer.innerHTML = `
            <style>${cssContent}</style>
            <div class="chapter-content">${bodyContent}</div>
        `;
        
        // 处理内部链接点击事件，防止无效链接导致页面刷新
        const chapterLinks = viewer.querySelectorAll('a');
        chapterLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                const href = link.getAttribute('href');
                
                // 如果没有 href 属性或是外部链接（包含 http 或 https），则使用默认行为
                if (!href || href.includes('http://') || href.includes('https://')) {
                    return;
                }
                
                // 阻止默认行为，防止页面刷新
                e.preventDefault();
                
                // 尝试解析内部链接
                try {
                    // 如果是章节内部锚点，仅处理页面滚动
                    if (href.startsWith('#')) {
                        const targetElement = viewer.querySelector(href);
                        if (targetElement) {
                            targetElement.scrollIntoView({ behavior: 'smooth' });
                        }
                        return;
                    }
                    
                    // 处理章节间链接
                    const linkPath = new URL(href, 'file://' + chapter.href).pathname.substring(1);
                    // 查找对应章节
                    const targetChapterIndex = chapters.findIndex(ch => ch.href === linkPath || ch.href === linkPath.split('#')[0]);
                    
                    if (targetChapterIndex !== -1) {
                        // 找到了对应章节，切换到该章节
                        currentChapter = targetChapterIndex;
                        fromTocNavigation = true;
                        
                        // 添加淡出效果
                        viewer.style.opacity = '0';
                        viewer.style.transition = 'opacity 0.3s ease';
                        
                        setTimeout(() => {
                            displayChapter(currentChapter).then(() => {
                                // 处理锚点
                                setTimeout(() => {
                                    if (href.includes('#')) {
                                        const anchorId = href.split('#')[1];
                                        const targetElement = viewer.querySelector(`#${anchorId}`);
                                        if (targetElement) {
                                            targetElement.scrollIntoView({ behavior: 'smooth' });
                                        }
                                    }
                                    // 添加淡入效果
                                    viewer.style.opacity = '1';
                                    fromTocNavigation = false;
                                }, 100);
                            });
                        }, 300);
                    }
                    // 如果找不到对应章节，不做任何操作，用户保持在当前页面
                } catch (error) {
                    console.warn('处理内部链接出错:', error);
                    // 出错时不做任何跳转，保持用户在当前页面
                }
            });
        });
        
        // 添加滚动监听，用于章节切换
        setupScrollChapterNavigation();
        
        // 更新目录中当前章节高亮显示
        updateActiveTocItem(chapter.href);

        // 匿名上报：一章被成功渲染（只含事件名，不含章节标题或位置）
        trackEvent('chapter_viewed');
        
        // 保存阅读进度
        saveReadingProgress();
        
        return new Promise((resolve) => {
            resolve();
        });
        
    } catch (error) {
        console.error('显示章节时出错:', error);
        viewer.innerHTML = `<div class="error">加载章节时出错: ${error.message}</div>`;
        return Promise.resolve();
    }
}

// 获取章节标题
function getChapterTitle(index) {
    if (!book || !chapters[index]) return '';
    
    // 尝试从目录中获取章节标题
    const chapterHref = chapters[index].href;
    const tocItem = book.toc.find(item => item.href === chapterHref);
    
    if (tocItem && tocItem.title) {
        return tocItem.title;
    }
    
    // 如果目录中没有找到，则使用简单的章节编号
    return `第 ${index + 1} 章`;
}

// 更新目录中当前章节的高亮显示
function updateActiveTocItem(currentHref) {
    // 移除之前的激活状态
    const previousActive = tocContent.querySelector('.toc-item-active');
    if (previousActive) {
        previousActive.classList.remove('toc-item-active');
    }
    
    // 添加当前激活状态
    const allLinks = tocContent.querySelectorAll('a');
    allLinks.forEach(link => {
        if (link.getAttribute('data-href') === currentHref) {
            link.classList.add('toc-item-active');
            
            // 确保激活的项目可见（如果在滚动容器内）
            link.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

// 更新导航按钮状态
function updateNavButtons() {
    // 导航按钮已被移除，所以这个函数现在不需要做任何事情
    // 但保留它是为了避免其他地方调用它时出错
}

// 设置滚动切换章节功能
function setupScrollChapterNavigation() {
    // 移除旧的滚动事件监听器，避免重复添加
    viewer.removeEventListener('wheel', handleWheelScroll);
    viewer.removeEventListener('touchstart', handleTouchStart);
    viewer.removeEventListener('touchmove', handleTouchMove);
    
    // 鼠标滚轮事件
    viewer.addEventListener('wheel', handleWheelScroll);
    
    // 触摸屏事件（支持移动设备）
    viewer.addEventListener('touchstart', handleTouchStart);
    viewer.addEventListener('touchmove', handleTouchMove);
}

// 处理鼠标滚轮事件
let wheelDeltaY = 0;
const wheelThreshold = 100; // 滚轮阈值，累积多少距离才触发章节切换

function handleWheelScroll(e) {
    if (!book || isProcessingScroll) return;
    
    // 确保事件是在正文区域触发的，而不是浏览器滚动条
    if (!e.target.closest('.viewer')) return;
    
    const now = Date.now();
    if (now - lastScrollTime < scrollThrottleTime) return;
    
    // 累积滚轮距离
    wheelDeltaY += e.deltaY;
    
    // 在顶部继续向上滚动 -> 切换到上一章末尾
    if (viewer.scrollTop === 0 && wheelDeltaY < -wheelThreshold) {
        if (currentChapter > 0) {
            wheelDeltaY = 0;
            lastScrollTime = now;
            isProcessingScroll = true;
            
            // 记住需要跳转到章节末尾
            window.jumpToEnd = true;
            fromTocNavigation = true;
            
            // 添加淡出效果
            viewer.style.opacity = '0';
            viewer.style.transition = 'opacity 0.3s ease';
            
            setTimeout(() => {
                currentChapter--;
                displayChapter(currentChapter).then(() => {
                    // 确保滚动到章节末尾
                    setTimeout(() => {
                        viewer.scrollTop = viewer.scrollHeight;
                        // 添加淡入效果
                        viewer.style.opacity = '1';
                        isProcessingScroll = false;
                        fromTocNavigation = false;
                    }, 100);
                });
            }, 300);
        }
    }
    // 在底部继续向下滚动 -> 切换到下一章开头
    else if ((Math.ceil(viewer.scrollTop + viewer.clientHeight) >= viewer.scrollHeight - 5) && wheelDeltaY > wheelThreshold) {
        if (currentChapter < chapters.length - 1) {
            wheelDeltaY = 0;
            lastScrollTime = now;
            isProcessingScroll = true;
            
            fromTocNavigation = true;
            
            // 添加淡出效果
            viewer.style.opacity = '0';
            viewer.style.transition = 'opacity 0.3s ease';
            
            setTimeout(() => {
                currentChapter++;
                displayChapter(currentChapter).then(() => {
                    // 确保滚动到章节开头
                    setTimeout(() => {
                        viewer.scrollTop = 0;
                        // 添加淡入效果
                        viewer.style.opacity = '1';
                        isProcessingScroll = false;
                        fromTocNavigation = false;
                    }, 100);
                });
            }, 300);
        }
    }
    // 不在顶部或底部，重置累积距离
    else if (viewer.scrollTop > 0 && Math.ceil(viewer.scrollTop + viewer.clientHeight) < viewer.scrollHeight - 5) {
        wheelDeltaY = 0;
    }
}

// 处理触摸屏手势
let touchStartY = 0;
let touchMoveY = 0;
const touchThreshold = 70; // 触摸阈值，需要多少距离才触发章节切换

function handleTouchStart(e) {
    if (!book) return;
    // 确保事件是在正文区域触发的
    if (!e.target.closest('.viewer')) return;
    
    touchStartY = e.touches[0].clientY;
}

function handleTouchMove(e) {
    if (!book || isProcessingScroll) return;
    // 确保事件是在正文区域触发的
    if (!e.target.closest('.viewer')) return;
    
    const now = Date.now();
    if (now - lastScrollTime < scrollThrottleTime) return;
    
    touchMoveY = e.touches[0].clientY;
    const touchDeltaY = touchMoveY - touchStartY;
    
    // 检查是否滚动到顶部并且继续上拉
    if (viewer.scrollTop === 0 && touchDeltaY > touchThreshold) {
        if (currentChapter > 0) {
            lastScrollTime = now;
            isProcessingScroll = true;
            
            // 记住需要跳转到章节末尾
            window.jumpToEnd = true;
            fromTocNavigation = true;
            
            // 添加淡出效果
            viewer.style.opacity = '0';
            viewer.style.transition = 'opacity 0.3s ease';
            
            setTimeout(() => {
                currentChapter--;
                displayChapter(currentChapter).then(() => {
                    // 确保滚动到章节末尾
                    setTimeout(() => {
                        viewer.scrollTop = viewer.scrollHeight;
                        // 添加淡入效果
                        viewer.style.opacity = '1';
                        isProcessingScroll = false;
                        fromTocNavigation = false;
                    }, 100);
                });
            }, 300);
        }
    }
    // 检查是否滚动到底部并且继续下拉
    else if ((Math.ceil(viewer.scrollTop + viewer.clientHeight) >= viewer.scrollHeight - 5) && touchDeltaY < -touchThreshold) {
        if (currentChapter < chapters.length - 1) {
            lastScrollTime = now;
            isProcessingScroll = true;
            
            fromTocNavigation = true;
            
            // 添加淡出效果
            viewer.style.opacity = '0';
            viewer.style.transition = 'opacity 0.3s ease';
            
            setTimeout(() => {
                currentChapter++;
                displayChapter(currentChapter).then(() => {
                    // 确保滚动到章节开头
                    setTimeout(() => {
                        viewer.scrollTop = 0;
                        // 添加淡入效果
                        viewer.style.opacity = '1';
                        isProcessingScroll = false;
                        fromTocNavigation = false;
                    }, 100);
                });
            }, 300);
        }
    }
    
    // 重置触摸起始位置
    if (Math.abs(touchDeltaY) > touchThreshold) {
        touchStartY = touchMoveY;
    }
}

// 渲染目录
function renderToc(tocItems) {
    if (!tocItems || tocItems.length === 0) {
        tocContent.innerHTML = '<div class="empty-toc"><span class="empty-toc-icon">📝</span><p>没有可用的目录</p></div>';
        return;
    }
    
    let html = '<ul>';
    
    tocItems.forEach(item => {
        const indentation = item.level * 20; // 根据级别缩进
        const chapterEmoji = getChapterEmoji(item.title);
        
        html += `
            <li style="margin-left: ${indentation}px">
                <a href="#" data-href="${item.href}" title="${item.title}">
                    <span class="toc-emoji">${chapterEmoji}</span>
                    <span class="toc-text">${item.title}</span>
                </a>
            </li>
        `;
    });
    
    html += '</ul>';
    tocContent.innerHTML = html;
    
    // 为目录项添加点击事件
    const tocLinks = tocContent.querySelectorAll('a');
    tocLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const href = link.getAttribute('data-href');
            
            // 查找对应的章节索引
            const chapterIndex = chapters.findIndex(chapter => chapter.href === href);
            
            if (chapterIndex !== -1) {
                // 标记当前章节切换来自目录导航
                fromTocNavigation = true;
                currentChapter = chapterIndex;
                displayChapter(currentChapter).then(() => {
                    // 显式地确保滚动位置重置到章节开头
                    viewer.scrollTop = 0;
                    
                    // 在移动设备上点击目录项后关闭目录
                    if (window.innerWidth < 768) {
                        tocContainer.classList.add('hidden');
                    }
                    
                    // 重置标记
                    fromTocNavigation = false;
                });
            }
        });
    });
    
    // 如果有当前章节，高亮显示
    if (book && chapters[currentChapter]) {
        updateActiveTocItem(chapters[currentChapter].href);
    }
}

// 根据章节标题获取适当的 Emoji
function getChapterEmoji(title) {
    // 默认使用 📄
    let emoji = '📄';
    
    // 根据标题内容选择合适的 Emoji
    const lowerTitle = title.toLowerCase();
    
    if (lowerTitle.includes('章') || lowerTitle.includes('chapter')) {
        emoji = '📑';
    } else if (lowerTitle.includes('序') || lowerTitle.includes('前言') || lowerTitle.includes('preface')) {
        emoji = '📝';
    } else if (lowerTitle.includes('目录') || lowerTitle.includes('contents')) {
        emoji = '📋';
    } else if (lowerTitle.includes('附录') || lowerTitle.includes('appendix')) {
        emoji = '📎';
    } else if (lowerTitle.includes('注') || lowerTitle.includes('notes')) {
        emoji = '📌';
    } else if (lowerTitle.includes('参考') || lowerTitle.includes('reference')) {
        emoji = '📚';
    } else if (lowerTitle.includes('封面') || lowerTitle.includes('cover')) {
        emoji = '🔖';
    } else if (lowerTitle.includes('标题') || lowerTitle.includes('title')) {
        emoji = '✨';
    }
    
    return emoji;
}

// 处理窗口大小变化
function handleWindowResize() {
    // 获取头部高度
    const headerHeight = document.querySelector('.app-header').offsetHeight;
    
    // 调整目录容器和内容区域的高度
    document.querySelector('.main-content').style.height = `calc(100vh - ${headerHeight}px)`;
    tocContainer.style.top = `${headerHeight}px`;
    tocContainer.style.height = `calc(100vh - ${headerHeight}px)`;
    
    // 确保正文区域高度正确，避免出现浏览器滚动条
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    
    // 调整目录和正文区域
    if (window.innerWidth >= 768) {
        if (tocContainer.classList.contains('hidden')) {
            viewer.style.marginLeft = '0';
        } else {
            viewer.style.marginLeft = '300px';
        }
    } else {
        // 在移动设备上，正文区域始终占满全宽
        viewer.style.marginLeft = '0';
        
        // 在移动设备上，目录是绝对定位而不是固定定位
        if (!tocContainer.classList.contains('hidden')) {
            tocContainer.style.transform = 'translateX(0)';
        } else {
            tocContainer.style.transform = 'translateX(-100%)';
        }
    }
}

// 初始化应用
function init() {
    // 加载设置
    loadSettings();

    // 把历史遗留的 localStorage 书籍分块迁到 IndexedDB，把被书籍占满的
    // 配额还给设置存储（否则设置一直写不进去，表现为字体/进度记不住）
    legacyMigration = migrateLegacyBookChunks()
        .then(moved => { if (moved > 0) console.log(`已迁移 ${moved} 本书到 IndexedDB`); })
        .catch(e => { console.warn('迁移书籍数据失败:', e.message); return 0; });

    // 添加事件监听器
    themeToggle.addEventListener('click', toggleTheme);
    fontIncrease.addEventListener('click', () => changeFontSize(1));
    fontDecrease.addEventListener('click', () => changeFontSize(-1));

    // 字体选择面板
    buildFontPanel();
    fontButton.addEventListener('click', (e) => {
        e.stopPropagation();
        fontPanel.classList.toggle('hidden');
    });
    // 点击面板外任意处关闭面板
    document.addEventListener('click', (e) => {
        if (!fontPanel.classList.contains('hidden') && !fontPanel.contains(e.target) && e.target !== fontButton) {
            fontPanel.classList.add('hidden');
        }
    });
    // Esc 关闭面板
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !fontPanel.classList.contains('hidden')) {
            fontPanel.classList.add('hidden');
        }
    });
    
    // 目录按钮点击事件处理 - 修复
tocButton.addEventListener('click', () => {
        const isTocHidden = tocContainer.classList.toggle('hidden');
        
        // 切换遮罩层（只在移动设备上）
        if (window.innerWidth < 768) {
            if (isTocHidden) {
                overlay.classList.remove('active');
            } else {
                overlay.classList.add('active');
            }
        }
    
    // 在非移动设备上调整正文区域的边距
    if (window.innerWidth >= 768) {
            viewer.style.marginLeft = isTocHidden ? '0' : '300px';
    } else {
        // 在移动设备上，使用 transform 来显示/隐藏目录
            tocContainer.style.transform = isTocHidden ? 'translateX(-100%)' : 'translateX(0)';
        }
    });
    
    openNewFileBtn.addEventListener('click', openNewFile);
    
    // 遮罩层点击事件 - 确保关闭目录
    overlay.addEventListener('click', () => {
        tocContainer.classList.add('hidden');
        overlay.classList.remove('active');
        
        // 在移动设备上处理transform
        if (window.innerWidth < 768) {
            tocContainer.style.transform = 'translateX(-100%)';
        } else {
            viewer.style.marginLeft = '0';
        }
    });
    
    // 添加目录按钮的键盘快捷键
    document.addEventListener('keydown', e => {
        if (e.key === 't' && book) {
            const isTocHidden = tocContainer.classList.toggle('hidden');
            
            // 切换遮罩层（只在移动设备上）
            if (window.innerWidth < 768) {
                if (isTocHidden) {
            overlay.classList.remove('active');
        } else {
            overlay.classList.add('active');
                }
            }
            
            // 在非移动设备上调整正文区域的边距
            if (window.innerWidth >= 768) {
                viewer.style.marginLeft = isTocHidden ? '0' : '300px';
            } else {
                // 在移动设备上，使用 transform 来显示/隐藏目录
                tocContainer.style.transform = isTocHidden ? 'translateX(-100%)' : 'translateX(0)';
        }
    }
});

// 点击主内容区域关闭目录（在移动设备上）
viewer.addEventListener('click', () => {
    if (window.innerWidth < 768 && !tocContainer.classList.contains('hidden')) {
        tocContainer.classList.add('hidden');
        tocContainer.style.transform = 'translateX(-100%)';
        overlay.classList.remove('active');
    }
});

// 键盘导航
document.addEventListener('keydown', (e) => {
    if (!book) return;
    
    // 防止快速连续按键
    if (e.repeat) return;
    
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault(); // 防止页面滚动
            // 直接处理上一章的逻辑
            if (currentChapter > 0) {
                // 标记为导航切换
                fromTocNavigation = true;
                currentChapter--;
                displayChapter(currentChapter).then(() => {
                    // 确保滚动到章节开头
                    viewer.scrollTop = 0;
                    // 重置标记
                    fromTocNavigation = false;
                });
        }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault(); // 防止页面滚动
            // 直接处理下一章的逻辑
            if (currentChapter < chapters.length - 1) {
                // 标记为导航切换
                fromTocNavigation = true;
                currentChapter++;
                displayChapter(currentChapter).then(() => {
                    // 确保滚动到章节开头
                    viewer.scrollTop = 0;
                    // 重置标记
                    fromTocNavigation = false;
                });
        }
    }
    
    // 按ESC键关闭目录
    if (e.key === 'Escape' && !tocContainer.classList.contains('hidden')) {
        tocContainer.classList.add('hidden');
            overlay.classList.remove('active');
            if (window.innerWidth >= 768) {
                viewer.style.marginLeft = '0';
            } else {
                tocContainer.style.transform = 'translateX(-100%)';
            }
        }
    });
    
    // 添加拖放处理
    const preventDefaults = e => {
        e.preventDefault();
        e.stopPropagation();
    };
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
        dropArea.addEventListener(event, preventDefaults, false);
    });
    
    ['dragenter', 'dragover'].forEach(event => {
        dropArea.addEventListener(event, () => {
            dropArea.classList.add('drag-over');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(event => {
        dropArea.addEventListener(event, () => {
            dropArea.classList.remove('drag-over');
        }, false);
    });
    
    dropArea.addEventListener('drop', handleDrop, false);
    fileInput.addEventListener('change', handleFileSelect, false);
    
    // 监听窗口大小变化
    window.addEventListener('resize', handleWindowResize);
    
    // 初始化时立即调用一次窗口大小处理函数
    setTimeout(handleWindowResize, 100);
    
    // 监听滚动事件
    viewer.addEventListener('wheel', handleWheelScroll, { passive: false });
    
    // 监听触摸事件
    viewer.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewer.addEventListener('touchmove', handleTouchMove, { passive: false });
    
    // 监听哈希变化
    window.addEventListener('hashchange', handleHashChange);
    
    // 处理URL中的哈希值，尝试恢复书籍
    const bookFromHash = getBookFromHash();
    
    if (bookFromHash) {
        console.log('URL中包含书籍ID:', bookFromHash);
        
        // 标记正在恢复书籍
        isRestoringBook = true;
        
        // 显示加载中的提示
        viewer.innerHTML = '<div class="loading">正在恢复上次阅读的书籍...</div>';
        viewer.classList.remove('hidden');
        dropArea.classList.add('hidden');
        
        // 尝试恢复书籍（等迁移完成，否则可能读到还没搬进 IndexedDB 的旧数据）
        (async () => {
            if (legacyMigration) await legacyMigration;
            restoreBookFromId(bookFromHash).then(success => {
            isRestoringBook = false;
            if (!success) {
                console.log("从哈希恢复书籍失败");
                
                // 恢复失败，回到首页
                viewer.classList.add('hidden');
                dropArea.classList.remove('hidden');
                
                // 重置URL哈希，避免重复尝试恢复失败的书籍
                resetUrlHash();
            }
        }).catch(err => {
            console.error("恢复书籍出错:", err);
            isRestoringBook = false;
            
            // 显示错误消息
            viewer.innerHTML = `<div class="error">加载书籍失败: ${err.message}</div>`;
            
            // 3秒后返回首页
            setTimeout(() => {
                viewer.classList.add('hidden');
                dropArea.classList.remove('hidden');
                
                // 重置URL哈希，避免重复尝试恢复失败的书籍
                resetUrlHash();
            }, 3000);
        });
        })();
    }
    
    // 检查是否支持Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('Service Worker 注册成功:', registration.scope);
                })
                .catch(error => {
                    console.log('Service Worker 注册失败:', error);
                });
        });
    }
    
    // 显示版本信息在控制台
    console.log('LightReader v1.0.0');
}

// 从URL哈希中获取书籍ID
function getBookFromHash() {
    const hash = window.location.hash.substring(1);
    // 使用正则表达式更可靠地提取book参数
    const bookMatch = hash.match(/book=([^&]+)/);
    return bookMatch ? decodeURIComponent(bookMatch[1]) : null;
}

// 处理URL哈希变化
function handleHashChange() {
    // 如果已经在加载书籍，则跳过
    if (isRestoringBook) return;
    
    // 获取哈希中的书籍ID
    const bookFromHash = getBookFromHash();
    
    // 如果存在有效的书籍ID并且与当前不同
    if (bookFromHash) {
        if (bookFromHash !== currentBookPath) {
        // 标记正在恢复书籍
        isRestoringBook = true;
            console.log("从URL哈希恢复书籍:", bookFromHash);
            
            // 显示加载中的提示
            viewer.innerHTML = '<div class="loading">正在加载书籍，请稍候...</div>';
            viewer.classList.remove('hidden');
            dropArea.classList.add('hidden');
        
        // 恢复书籍
            restoreBookFromId(bookFromHash)
                .then(success => {
                    if (!success) {
                        console.error('恢复书籍失败:', bookFromHash);
                        
                        // 显示错误消息
                        viewer.innerHTML = `
                            <div class="error">
                                <h3>无法加载书籍</h3>
                                <p>可能是缓存数据已丢失或损坏。请重新打开EPUB文件。</p>
                            </div>
                        `;
                        
                        // 3秒后返回首页
                        setTimeout(() => {
                            viewer.classList.add('hidden');
                            dropArea.classList.remove('hidden');
                            
                            // 重置URL哈希，避免重复尝试恢复失败的书籍
                            resetUrlHash();
                        }, 3000);
                    }
                })
                .catch(error => {
                    console.error('恢复书籍时发生错误:', error);
                    
                    // 显示错误消息
                    viewer.innerHTML = `
                        <div class="error">
                            <h3>加载书籍时出错</h3>
                            <p>${error.message}</p>
                        </div>
                    `;
                    
                    // 3秒后返回首页并重置哈希
                    setTimeout(() => {
                        viewer.classList.add('hidden');
                        dropArea.classList.remove('hidden');
                        resetUrlHash();
                    }, 3000);
                })
                .finally(() => {
            isRestoringBook = false;
        });
        }
    } else if (currentBookPath) {
        // 如果哈希被清空，但有当前书籍，则显示首页
        console.log('哈希已清空，返回首页');
        viewer.classList.add('hidden');
        dropArea.classList.remove('hidden');
        currentBookPath = '';
    }
}

// 重置URL哈希
function resetUrlHash() {
    // 临时移除hashchange监听器
    window.removeEventListener('hashchange', handleHashChange);
    
    // 清空哈希
    history.replaceState(null, '', window.location.pathname + window.location.search);
    
    // 恢复hashchange监听器
    setTimeout(() => {
        window.addEventListener('hashchange', handleHashChange);
    }, 100);
}

// 从ID恢复书籍
async function restoreBookFromId(bookId) {
    console.log('尝试恢复书籍:', bookId);
    
    // 确保读取进度存在
    if (!settings.readingProgress || !settings.readingProgress[bookId]) {
        console.warn('未找到阅读进度信息:', bookId);
        return false;
    }
    
    const progress = settings.readingProgress[bookId];
    
    // 确保fileInfo存在
    if (!progress.fileInfo) {
        console.warn('缺少文件信息，无法恢复:', bookId);
        return false;
    }
    
    // 提取元数据
    const metadata = progress.metadata || {};
    if (!metadata) {
        console.warn('缺少元数据信息:', bookId);
    }
    
    try {
        // 优先从 IndexedDB 读取；读不到再试历史遗留的 localStorage 分块
        let binaryData = null;
        try {
            const buf = await getBookFile(bookId);
            if (buf) binaryData = new Uint8Array(buf);
        } catch (e) {
            console.warn('从 IndexedDB 读取书籍失败:', e.message);
        }

        if (!binaryData) {
            const chunkCount = progress.fileInfo.chunks || 0;
            if (chunkCount > 0) {
                console.log(`IndexedDB 无数据，尝试 localStorage 分块（${chunkCount} 块）`);
                const legacy = loadBookFileLegacy(bookId, chunkCount);
                if (legacy) binaryData = new Uint8Array(legacy);
            }
        }

        if (!binaryData) {
            console.error('找不到书籍文件数据：IndexedDB 与 localStorage 都没有完整数据');
            return false;
        }

        const expectedSize = progress.fileInfo.size || progress.fileInfo.storedSize || 0;
        console.log(`成功读取书籍数据，大小 ${binaryData.length} 字节（预期约 ${expectedSize} 字节）`);
        if (expectedSize && Math.abs(binaryData.length - expectedSize) > 100) {
            console.warn(`文件大小不匹配：预期约${expectedSize}字节，实际${binaryData.length}字节`);
        }

        // 创建File对象
        const file = new File(
            [new Blob([binaryData], {type: progress.fileInfo.type || 'application/epub+zip'})],
            progress.fileInfo.name || 'restored_book.epub',
            {
                type: progress.fileInfo.type || 'application/epub+zip',
                lastModified: progress.fileInfo.lastModified || Date.now()
            }
        );
        
        console.log(`创建文件对象成功，大小: ${file.size}字节`);
        
        // 加载EPUB文件并跳转到上次阅读位置
        return new Promise((resolve, reject) => {
            // 显示恢复进度
            viewer.innerHTML = '<div class="loading">正在解析书籍数据，请稍候...</div>';
            
            handleEpubFile(file, bookId).then((success) => {
                if (success) {
                    console.log('书籍加载成功:', bookId);
                    
                    // 更新当前章节索引
                    if (progress.chapter !== undefined) {
                        console.log('恢复阅读位置到章节:', progress.chapter);
                        currentChapter = progress.chapter;
                        
                        // 使用displayChapter显示正确的章节
                        displayChapter(currentChapter).then(() => {
                            // 恢复滚动位置
                            if (progress.position !== undefined) {
                                setTimeout(() => {
                                    console.log('恢复滚动位置:', progress.position);
                                    viewer.scrollTop = progress.position;
                                }, 100);
                            }
                        });
                    }
                    
                    // 更新URL哈希以支持刷新恢复
                    updateBookHash(bookId);
                    
                    resolve(true);
                } else {
                    console.warn('书籍加载失败');
                    resolve(false);
                }
            }).catch(error => {
                console.error('处理EPUB文件时出错:', error);
                viewer.innerHTML = `
                    <div class="error">
                        <h3>加载书籍失败</h3>
                        <p>${error.message}</p>
                        <div class="error-action">
                            <button onclick="location.reload()">刷新页面</button>
                        </div>
                    </div>
                `;
                reject(error);
            });
        });
    } catch (error) {
        console.error('恢复书籍过程中发生错误:', error);
        return Promise.resolve(false);
    }
}

// 尝试恢复最后阅读的书籍函数（已被禁用）
function tryRestoreLastBook() {
    // 此函数已被禁用，不再尝试恢复最后阅读的书籍
    console.log('最近阅读功能已被移除');
    return false;
}

// 窗口关闭前保存进度
window.addEventListener('beforeunload', () => {
    if (book) {
        saveReadingProgress();
    }
});

// 启动应用
init(); 