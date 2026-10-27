const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const projectRoot = path.resolve(__dirname, '..', '..');
const fixturesDir = path.join(projectRoot, 'tests', 'fixtures');
const fixture = name => path.join(fixturesDir, name);
const jszipPath = path.join(projectRoot, 'node_modules', 'jszip', 'dist', 'jszip.min.js');

async function prepareReader(page) {
    // 测试不依赖 CDN 可用性；使用与生产页面版本一致的 JSZip 3.10.1。
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', route =>
        route.fulfill({ path: jszipPath, contentType: 'application/javascript' })
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '欢迎使用 LightReader' })).toBeVisible();
}

async function importFixture(page, filename, heading) {
    await page.locator('#file-input').setInputFiles(fixture(filename));
    const chapter = page.frameLocator('.chapter-frame');
    await expect(chapter.getByRole('heading', { name: heading })).toBeVisible();
    return chapter;
}

test('EPUB 3：导入、目录、跨章链接与刷新恢复', async ({ page }) => {
    await prepareReader(page);
    const chapter = await importFixture(page, 'epub3-regression.epub', 'EPUB 3 第一章');

    await expect(page.getByRole('button', { name: '打开目录' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#toc-content')).toContainText('第一章');
    await expect(page.locator('#toc-content')).toContainText('第二章');

    await chapter.getByRole('link', { name: '前往 EPUB 3 第二章' }).click();
    await expect(chapter.getByRole('heading', { name: 'EPUB 3 第二章' })).toBeVisible();

    await page.reload();
    await expect(page.frameLocator('.chapter-frame').getByRole('heading', { name: 'EPUB 3 第二章' })).toBeVisible();
});

test('EPUB 2：NCX 目录可导航', async ({ page }) => {
    await prepareReader(page);
    const chapter = await importFixture(page, 'epub2-regression.epub', 'EPUB 2 第一章');

    await expect(page.locator('#toc-content')).toContainText('EPUB 2 第二章');
    await page.locator('#toc-content a').filter({ hasText: 'EPUB 2 第二章' }).click();
    await expect(chapter.getByRole('heading', { name: 'EPUB 2 第二章' })).toBeVisible();
});

test('恶意 EPUB：危险节点与 URL 均不进入受限正文', async ({ page }) => {
    const externalRequests = [];
    page.on('request', request => {
        if (request.url().includes('example.invalid')) externalRequests.push(request.url());
    });
    await prepareReader(page);
    const chapter = await importFixture(page, 'malicious-regression.epub', '恶意 EPUB 正文');

    await expect(page).toHaveTitle('恶意 EPUB 回归样本 - LightReader');
    await expect(chapter.locator('script, iframe, object, embed')).toHaveCount(0);
    await expect(chapter.locator('[onload], [onerror], [onclick]')).toHaveCount(0);
    await expect(chapter.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(chapter.locator('link[href^="http"]')).toHaveCount(0);
    expect(externalRequests).toEqual([]);
});

test('并发重复导入：只解析一次', async ({ page }) => {
    const processingLogs = [];
    const duplicateLogs = [];
    page.on('console', message => {
        if (message.text().includes('处理书籍:')) processingLogs.push(message.text());
        if (message.text().includes('忽略重复导入请求')) duplicateLogs.push(message.text());
    });
    await prepareReader(page);

    const bytes = Array.from(fs.readFileSync(fixture('epub3-regression.epub')));
    await page.evaluate(fileBytes => {
        const file = new File([new Uint8Array(fileBytes)], 'epub3-regression.epub', {
            type: 'application/epub+zip'
        });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        const input = document.getElementById('file-input');
        Object.defineProperty(input, 'files', { configurable: true, value: dataTransfer.files });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, bytes);

    await expect(page.frameLocator('.chapter-frame').getByRole('heading', { name: 'EPUB 3 第一章' })).toBeVisible();
    expect(processingLogs).toHaveLength(1);
    expect(duplicateLogs).toHaveLength(1);
});

test('无障碍：图标按钮有名称、状态与可见键盘焦点', async ({ page }) => {
    await prepareReader(page);

    const themeButton = page.getByRole('button', { name: '切换为深色主题' });
    await expect(themeButton).toHaveAttribute('aria-pressed', 'false');
    await themeButton.click();
    await expect(page.getByRole('button', { name: '切换为浅色主题' })).toHaveAttribute('aria-pressed', 'true');

    // 用真实键盘 Tab 触发 :focus-visible，而不是程序化 focus()。
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const uploadButton = page.getByRole('button', { name: '选择文件' });
    await expect(uploadButton).toBeFocused();
    await expect(uploadButton).toHaveCSS('outline-style', 'solid');

    const fontButton = page.getByRole('button', { name: '打开阅读字体设置' });
    await fontButton.click();
    await expect(fontButton).toHaveAttribute('aria-expanded', 'true');
});
