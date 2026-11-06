# 没心机 · 小心机 2.0 (源码归档与免登录独立版)

本仓库完整归档自 `https://meixjjyxinji.pages.dev/` 全套纯前端未混淆源码（共 34 个文件）。

## 分支说明

- **`original-backup` 分支（Commit `72d6db76`）**：100% 原汁原味未改动的原始站点全部文件备份。
- **`main` 分支（方案 B · 永久独立版）**：在保留全部原有功能与本地 IndexedDB 存储结构的基础上，移除了对作者远程 Supabase 服务器的强依赖：
  1. **`auth.js`**：跳过开屏 `#auth-overlay` 登录/激活码拦截锁，自动注入本地解锁凭证，原作者停服后依然可直接进入桌面。
  2. **`app.js`**：默认解锁 SillyTavern（酒馆）`.png` / `.json` 角色卡导入（`readStTavernImportUnlocked() -> true`），无需下载或验证绑定账号的验证卡。
  3. **`sw.js`**：修复原版 `PRECACHE_URLS` 第 10 行多余双逗号语法问题。

在线访问（GitHub Pages）：https://maryli00022.github.io/meixinji/
