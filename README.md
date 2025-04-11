# LightReader - 轻量级EPUB阅读器

LightReader 是一个基于浏览器的轻量级 EPUB 电子书阅读器，提供简洁、优雅的阅读体验。

## 特点

- 💡 简洁的黑白灰设计风格
- 📱 响应式设计，适配各种屏幕尺寸
- 🌓 支持明暗两种主题模式
- 📖 完整的章节导航和目录功能
- 🔖 自动保存阅读进度
- ⚡ 离线阅读支持（PWA）
- 🔍 字体大小调整

## 技术栈

- 纯原生 JavaScript，无需任何框架
- 使用 JSZip 解析 EPUB 文件
- 支持 PWA 特性，实现离线缓存
- 使用 localStorage 存储用户设置和阅读进度

## 使用方法

1. 访问网站或本地部署
2. 拖放 EPUB 文件到指定区域或点击选择文件
3. 使用界面控件进行阅读和设置调整

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/yourusername/lightreader.git

# 进入项目目录
cd lightreader

# 启动本地服务器（可以使用任何静态文件服务器）
# 例如使用 Python 的简易服务器
python -m http.server 8000
```

然后访问 `http://localhost:8000`

## 部署说明

该项目是纯静态网站，可以部署在任何支持静态网站托管的平台上，如：

- GitHub Pages
- Netlify
- Vercel
- Amazon S3
- 任何支持静态文件的 Web 服务器

## 隐私说明

LightReader 完全在浏览器中运行，不会将您的电子书或阅读数据发送到任何服务器。所有数据仅存储在您的浏览器的本地存储中。

## 许可证

MIT 