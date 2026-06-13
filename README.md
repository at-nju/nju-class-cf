# NJU 选课助手 — Cloudflare 版

原 Flask 应用（[carottX/nju-class](https://github.com/carottX/nju-class)）的 Cloudflare 重写：单个 Worker + D1（FTS5 trigram 全文索引）+ Cron Trigger，前端用 Workers Static Assets 托管。无 Python / 无常驻进程。

## 架构

```
浏览器 ─▶ Worker.fetch()      GET /              → 静态资源 (public/)
                              GET /search/teacher → D1 分层模糊搜索
                              GET /search/course  → D1 分层模糊搜索
Cron  ─▶ Worker.scheduled()   每小时：拉 SeaTable → 合并静态历史源 → 算拼音 → 重写 D1
```

- 搜索分层：精确 → 前缀 → 子串(FTS5 trigram) → 拼音全拼 → 拼音首字母 → 子序列兜底。
- 数据写入暂存表后**原子换入**正式表，读端始终看到完整快照。
- 静态历史源（`src/data/*.json`，由 `convert.py` 从 xlsx 离线转出）打包进 Worker，刷新时与 SeaTable 实时数据合并。

## 本地开发

```bash
npm install

# 1) 创建本地 D1 并建表
npx wrangler d1 create nju-class          # 把返回的 database_id 填进 wrangler.toml
npm run schema:local

# 2) 配置 SeaTable token（本地用 .dev.vars）
echo 'SEATABLE_API_TOKEN = "你的token"' > .dev.vars
# 并在 wrangler.toml 的 [vars] 里把 ALLOW_MANUAL_REFRESH 设为 "true"

# 3) 启动 + 灌一次数据
npm run dev
curl http://localhost:8787/__refresh        # 触发一次刷新（需 ALLOW_MANUAL_REFRESH=true）

# 4) 验证
open http://localhost:8787/
curl "http://localhost:8787/search/teacher?name=zml"
```

## 部署

```bash
npm run schema:remote
npx wrangler secret put SEATABLE_API_TOKEN
npx wrangler deploy
# 首次部署后手动触发一次刷新（临时开启 ALLOW_MANUAL_REFRESH 或等待首个 cron）
```

## 更新静态历史源

把新的 xlsx 用原仓库的 `convert.py` 转成 json，替换 `src/data/` 下对应文件，重新 `wrangler deploy`。
