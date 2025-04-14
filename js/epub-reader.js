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
let sessionId = ''; // 当前会话的唯一标识符
let isRestoringBook = false; // 标记是否正在恢复书籍

// 应用设置
const settings = {
    theme: 'light',
    fontSize: 18,
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
        } catch (e) {
            console.error('加载设置出错:', e);
        }
    }
}

// 保存设置到本地存储
function saveSettings() {
        localStorage.setItem('lightreader-settings', JSON.stringify(settings));
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

// 生成会话ID
function generateSessionId() {
    return 'session-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
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

// 改变字体大小
function changeFontSize(delta) {
    settings.fontSize = Math.max(12, Math.min(24, settings.fontSize + delta));
    document.documentElement.style.setProperty('--font-size-base', `${settings.fontSize}px`);
    saveSettings();
}

// 打开新文件
function openNewFile() {
    // 保存当前阅读进度
    if (book) {
        saveReadingProgress();
    }
    
    // 获取完整的基本URL（使用完整绝对URL，确保使用当前完整域名）
    const currentHost = window.location.origin;
    
    // 直接在新窗口打开完整的URL
    window.open(currentHost, '_blank');
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
                    // 获取文件数据
                    const fileData = new Uint8Array(arrayBuffer);
                    
                    // 将文件分成更小的块存储到localStorage
                    const chunkSize = 1024 * 64; // 使用更小的块大小(64KB)，进一步降低失败风险
                    const chunkCount = Math.ceil(fileData.length / chunkSize);
                    
                    // 清除之前可能存在的块
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                        if (key && key.startsWith(`${bookId}_chunk_`)) {
                        localStorage.removeItem(key);
                    }
                }
                
                    console.log(`正在将EPUB文件分成${chunkCount}个块进行存储...`);
                    
                    // 存储新的块 - 使用Base64编码，更加高效和安全
                    let totalStored = 0;
                    for (let i = 0; i < chunkCount; i++) {
                    const start = i * chunkSize;
                        const end = Math.min(start + chunkSize, fileData.length);
                        const chunk = fileData.subarray(start, end);
                        totalStored += (end - start);
                        
                        // 将二进制数据转换为Base64字符串
                        const binaryStr = Array.from(chunk).map(b => String.fromCharCode(b)).join('');
                        const base64Str = btoa(binaryStr);
                        
                        try {
                            localStorage.setItem(`${bookId}_chunk_${i}`, base64Str);
                        } catch (e) {
                            // 静默处理localStorage错误，不再提示用户
                            console.log('无法存储书籍数据，但阅读功能不受影响');
                            break; // 退出存储循环
                        }
                    }
                    
                    console.log(`成功存储书籍数据，共${chunkCount}个块，总大小: ${totalStored}/${fileData.length}字节`);
                    
                    // 验证所有块是否已成功存储
                    if (totalStored !== fileData.length) {
                        console.log(`存储不完整，但不影响当前阅读`);
                    }
                    
                    // 更新阅读进度中的文件信息
                    if (!settings.readingProgress[bookId]) {
                        settings.readingProgress[bookId] = {};
                    }
                    
                    // 保存文件信息用于后续恢复
                    settings.readingProgress[bookId].fileInfo = {
                    name: file.name,
                        type: file.type || 'application/epub+zip',
                        size: file.size,
                        chunks: chunkCount,
                        lastModified: file.lastModified,
                        storedSize: totalStored // 记录实际存储的字节数
                    };
                    
                    // 保存元数据
                    settings.readingProgress[bookId].metadata = {
                        title: bookTitle,
                        author: getAuthor(metadata) || '未知作者',
                        totalChapters: chapters.length
                    };
            } catch (e) {
                    console.log('存储数据时出现问题，但不影响当前阅读:', e.message);
                    // 继续阅读，无需警告用户
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
            
            // 返回成功
            return true;
            
        } catch (e) {
            console.error('解析EPUB文件出错:', e);
            viewer.innerHTML = `
                <div class="error">
                    <h3>解析EPUB文件出错</h3>
                    <p>${e.message}</p>
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
        
        manifest[id] = { href, mediaType };
    });
    
    // 获取脊柱（章节顺序）
    const spineElement = xmlDoc.getElementsByTagName('spine')[0];
    const spineItems = spineElement ? Array.from(spineElement.getElementsByTagName('itemref')) : [];
    const spine = spineItems.map(item => item.getAttribute('idref'));
    
    // 寻找目录文件
    let tocPath = null;
    for (const id in manifest) {
        if (manifest[id].mediaType === 'application/x-dtbncx+xml') {
            tocPath = manifest[id].href;
            break;
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
    const navPoints = xmlDoc.getElementsByTagName('navPoint');
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
        const content = await book.zip.file(chapter.href).async('text');
        
        // 解析HTML内容
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(content, 'text/html');
        
        // 提取<body>内容
        const bodyContent = htmlDoc.body ? htmlDoc.body.innerHTML : content;
        
        // 提取CSS
        const styles = Array.from(htmlDoc.querySelectorAll('style, link[rel="stylesheet"]'));
        let cssContent = '';
        
        for (const style of styles) {
            if (style.tagName === 'STYLE') {
                cssContent += style.textContent;
            } else if (style.tagName === 'LINK' && style.getAttribute('href')) {
                const href = style.getAttribute('href');
                const cssPath = new URL(href, 'file://' + chapter.href).pathname.substring(1);
                const cssFile = book.zip.file(cssPath);
                
                if (cssFile) {
                    const css = await cssFile.async('text');
                    cssContent += css;
                }
            }
        }
        
        // 处理图片
        const images = Array.from(htmlDoc.querySelectorAll('img'));
        for (const img of images) {
            if (img.getAttribute('src')) {
                const src = img.getAttribute('src');
                const imgPath = new URL(src, 'file://' + chapter.href).pathname.substring(1);
                const imgFile = book.zip.file(imgPath);
                
                if (imgFile) {
                    const blob = await imgFile.async('blob');
                    const url = URL.createObjectURL(blob);
                    img.setAttribute('src', url);
                }
            }
        }
        
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
    // 获取当前URL
    const currentUrl = new URL(window.location.href);
    
    // 只有在URL中没有sid参数时才生成新的会话ID
    if (!currentUrl.searchParams.has('sid')) {
        // 生成会话ID
        sessionId = generateSessionId();
        
        // 添加会话ID到URL查询参数，用于识别当前会话
        currentUrl.searchParams.set('sid', sessionId);
        window.history.replaceState({}, '', currentUrl);
    } else {
        // 如果URL中已有会话ID，直接使用它
        sessionId = currentUrl.searchParams.get('sid');
    }
    
    // 加载设置
    loadSettings();
    
    // 添加事件监听器
    themeToggle.addEventListener('click', toggleTheme);
    fontIncrease.addEventListener('click', () => changeFontSize(1));
    fontDecrease.addEventListener('click', () => changeFontSize(-1));
    
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
        
        // 添加超时处理
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => {
                resolve({ timeout: true });
            }, 10000); // 10秒超时
        });
        
        // 竞态请求，看哪个先完成
        Promise.race([
            restoreBookFromId(bookFromHash),
            timeoutPromise
        ]).then(result => {
            isRestoringBook = false;
            
            if (result && result.timeout) {
                // 超时处理
                console.log("恢复书籍超时");
                viewer.innerHTML = `
                    <div class="error-message">
                        <h3>📶 加载失败</h3>
                        <p>您的书籍加载超时，可能是由于网络连接问题。</p>
                        <p>建议:</p>
                        <ul>
                            <li>检查您的网络连接</li>
                            <li>如果您在中国大陆访问，网络可能不稳定</li>
                            <li>尝试刷新页面或上传新的EPUB文件</li>
                        </ul>
                        <button class="retry-button" onclick="location.reload()">刷新页面</button>
                        <button class="upload-new-button" onclick="dropArea.classList.remove('hidden'); viewer.classList.add('hidden');">上传新文件</button>
                    </div>
                `;
                return false;
            }
            
            if (!result) {
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
    console.log('LightReader v1.0.0', `会话ID: ${sessionId}`);
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
        // 从localStorage中获取文件块
        const chunks = [];
        const chunkCount = progress.fileInfo.chunks || 0;
        const expectedSize = progress.fileInfo.storedSize || progress.fileInfo.size || 0;
        
        if (chunkCount <= 0) {
            console.error('块数量无效:', chunkCount);
            return false;
        }
        
        console.log(`开始从localStorage恢复书籍，预期${chunkCount}个块，总大小约${expectedSize}字节`);
        
        // 先检查所有块是否存在
        const missingChunks = [];
            for (let i = 0; i < chunkCount; i++) {
            const chunkKey = `${bookId}_chunk_${i}`;
            if (!localStorage.getItem(chunkKey)) {
                missingChunks.push(i);
            }
        }
        
        if (missingChunks.length > 0) {
            console.error(`缺少文件块: ${missingChunks.join(', ')}`);
            return false;
        }
        
        // 所有块都存在，开始恢复
        let actualSize = 0;
        for (let i = 0; i < chunkCount; i++) {
            const chunkKey = `${bookId}_chunk_${i}`;
            const chunk = localStorage.getItem(chunkKey);
            
            try {
                // 将Base64编码的数据转换回二进制
                const binaryChunk = atob(chunk);
                actualSize += binaryChunk.length;
                chunks.push(binaryChunk);
            } catch (error) {
                console.error(`解析文件块${i}数据失败:`, error);
                return false;
            }
        }
        
        // 将所有块合并为完整的文件数据
        const fileContent = chunks.join('');
        console.log(`成功读取所有文件块，总大小: ${fileContent.length}字节`);
        
        // 验证文件大小
        if (Math.abs(fileContent.length - expectedSize) > 100) { // 允许100字节的误差
            console.warn(`文件大小不匹配：预期约${expectedSize}字节，实际${fileContent.length}字节`);
        }
        
        // 将字符串转换为二进制数据
        const binaryData = new Uint8Array(fileContent.length);
        for (let i = 0; i < fileContent.length; i++) {
            binaryData[i] = fileContent.charCodeAt(i);
        }
        
        // 创建File对象
        const file = new File(
            [new Blob([binaryData.buffer], {type: progress.fileInfo.type || 'application/epub+zip'})],
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