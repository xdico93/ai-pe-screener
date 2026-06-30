# AI PE 筛选器

> 找出 AI 概念板块中 PE(TTM)/动态市盈率 > 1.5 的标的，移动端适配，微信可直接打开。

## 一键部署到 GitHub Pages（永久免费）

### 1. 创建仓库

在 GitHub 新建一个 **Public** 仓库，名称随意（如 `ai-pe-screener`）。

### 2. 上传文件

把本目录下的所有文件拖到 GitHub 仓库里（Web 端直接拖拽即可）：

```
index.html    ← 主应用（单文件，无需构建）
README.md     ← 本说明
```

### 3. 开启 Pages

仓库 → **Settings** → **Pages** → 做以下设置：

| 选项 | 值 |
|------|-----|
| Source | **Deploy from a branch** |
| Branch | **main** (或 master) |
| Folder | **/ (root)** |

点击 **Save**，等待 1-2 分钟。

### 4. 获取链接

页面顶部会显示：`Your site is live at https://你的用户名.github.io/ai-pe-screener/`

**这个链接永久有效**，复制到微信里就能打开。

---

## 更新数据

数据内嵌在 `index.html` 的 `STOCK_DATA` 数组里。拿到新数据后替换这个数组，重新 push 即可自动更新。

---

## 自定义域名（可选）

如果想用自己的域名（如 `pe.你的域名.com`）：

1. 在仓库 Settings → Pages → Custom domain 填入域名
2. 在域名 DNS 添加一条 CNAME 记录指向 `你的用户名.github.io`
3. 勾选 Enforce HTTPS

---

*数据来源：通达信 | 仅供研究参考，不构成投资建议*
