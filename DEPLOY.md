# LightReader 部署指南

本文档提供了将 LightReader EPUB 阅读器部署到各种平台的详细步骤。

## 目录

- [前期准备](#前期准备)
- [构建优化版本](#构建优化版本)
- [静态托管平台部署](#静态托管平台部署)
  - [GitHub Pages](#github-pages)
  - [Netlify](#netlify)
  - [Vercel](#vercel)
- [传统服务器部署](#传统服务器部署)
  - [Apache](#apache)
  - [Nginx](#nginx)
- [云服务部署](#云服务部署)
  - [Amazon S3](#amazon-s3)
- [自定义域名设置](#自定义域名设置)
- [HTTPS 配置](#https-配置)
- [性能优化建议](#性能优化建议)

## 前期准备

在开始部署之前，请确保您已经完成以下步骤：

1. 确保代码已经最终确认并测试通过
2. 检查所有资源文件（js, css, 图像）都已正确引用
3. 更新 `manifest.json` 和 `robots.txt` 中的域名为您将部署的实际域名
4. 确保您有网站图标和 PWA 图标文件

## 构建优化版本

使用以下命令构建优化后的产品版本：

```bash
# 安装依赖
npm install

# 构建优化版本
npm run build
```

构建完成后，`dist` 目录下将包含所有优化后的文件，可以直接用于部署。

## 静态托管平台部署

### GitHub Pages

1. 创建一个 GitHub 仓库
2. 将代码推送到仓库
3. 在仓库设置中启用 GitHub Pages
   - 访问 `Settings` > `Pages`
   - 选择分支（通常是 `main` 或 `master`）
   - 点击 `Save`

4. (可选) 添加自定义域名
   - 在 `Settings` > `Pages` 中输入自定义域名
   - 在您的域名注册商处添加 CNAME 记录，指向 `yourusername.github.io`

### Netlify

1. 注册/登录 [Netlify](https://www.netlify.com/)
2. 点击 "New site from Git"
3. 选择您的代码仓库
4. 设置构建命令（如果有）：`npm run build`
5. 设置发布目录：`dist`
6. 点击 "Deploy site"

### Vercel

1. 注册/登录 [Vercel](https://vercel.com/)
2. 点击 "Import Project"
3. 选择 "Import Git Repository" 并输入仓库 URL
4. 配置项目：
   - 构建命令：`npm run build`
   - 输出目录：`dist`
5. 点击 "Deploy"

## 传统服务器部署

### Apache

1. 将 `dist` 目录下的所有文件上传到您的 Web 服务器根目录
2. 创建 `.htaccess` 文件添加以下配置：

```apache
# 开启 GZIP 压缩
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css application/javascript application/json
</IfModule>

# 设置缓存策略
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType image/x-icon "access plus 1 year"
</IfModule>

# 确保PWA service worker正常工作
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  # 确保请求不是文件或目录时返回index.html
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

### Nginx

1. 将 `dist` 目录下的所有文件上传到您的 Web 服务器目录
2. 配置 Nginx：

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    root /path/to/dist;
    index index.html;

    # 启用 gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/javascript application/json;

    # 添加缓存头
    location ~* \.(js|css|png|jpg|jpeg|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000";
    }

    # 处理 PWA service worker
    location /service-worker.js {
        add_header Cache-Control "no-cache";
    }

    # 所有未找到的路由指向 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## 云服务部署

### Amazon S3

1. 创建 S3 存储桶
2. 上传 `dist` 目录下所有文件
3. 启用"静态网站托管"功能
4. 设置存储桶权限允许公共访问
5. 配置存储桶策略：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForGetBucketObjects",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

6. (可选) 使用 CloudFront 配置 CDN 和 HTTPS

## 自定义域名设置

无论选择哪种托管方式，如果您想使用自定义域名，需要完成以下步骤：

1. 购买域名（如通过 GoDaddy, Namecheap, Google Domains 等）
2. 在域名注册商处添加 DNS 记录：
   - A 记录：指向您的托管服务提供商的 IP 地址
   - 或 CNAME 记录：指向托管服务提供商的域名

## HTTPS 配置

强烈建议为您的站点启用 HTTPS：

- GitHub Pages, Netlify, Vercel 等平台会自动提供 HTTPS
- 对于传统服务器，推荐使用 [Let's Encrypt](https://letsencrypt.org/) 获取免费 SSL 证书
- 对于 AWS S3，结合 CloudFront 可以启用 HTTPS

## 性能优化建议

部署后，可以使用以下工具测试和优化您的网站性能：

- Google PageSpeed Insights
- WebPageTest
- Lighthouse

常见优化措施包括：

- 确保所有图片已压缩
- 启用 HTTP/2
- 使用 CDN 分发静态资源
- 定期检查并更新第三方库 