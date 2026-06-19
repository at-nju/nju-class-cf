# NJU 选课助手 — Cloudflare 版

原 Flask 应用（[carottX/nju-class](https://github.com/carottX/nju-class)）的 Cloudflare 重写：单个 Worker + D1（FTS5 trigram 全文索引）+ Cron Trigger，前端用 Workers Static Assets 托管。无 Python / 无常驻进程。

## 架构

```
浏览器 ─> Worker.fetch()       GET /               -> 静态资源 (public/)
                              GET /search/teacher -> D1 分层模糊搜索
                              GET /search/course  -> D1 分层模糊搜索
Cron  ─> Worker.scheduled()   每天零点：拉 SeaTable -> 合并静态历史源 → 算拼音 → 内容变了才重写 D1
```

- 搜索分层：精确 → 前缀 → 子串(FTS5 trigram) → 拼音全拼 → 拼音首字母 → 子序列兜底。
- 数据写入暂存表后**原子换入**正式表，读端始终看到完整快照。
- **增量跳过**：每次刷新对去重后的整套数据算 SHA-256 内容哈希，存在 `meta` 表。与上次一致则**整体跳过重写**（仅 1 行读、0 行写），避免红黑榜低频更新场景下每天无谓地全量重建 D1 + FTS 索引。
- 多个 SeaTable base 并行拉取（NJU Table / fork25 / ad-astra），按各自的列名规则归一，再与静态历史源合并去重。
- 静态历史源打包进 Worker，刷新时与 SeaTable 实时数据合并。

## 本地开发

```bash
npm install

# 1 创建本地 D1 并建表
npx wrangler d1 create nju-class
# 1.1 把返回的 database_id 填进 wrangler.toml
npm run schema:local

# 2 配置环境变量（本地用 .dev.vars）
# 2.1 把 ALLOW_MANUAL_REFRESH 设为 "true"
echo 'ALLOW_MANUAL_REFRESH = "true"' > .dev.vars
# 2.2 配置 SeaTable Token
echo 'SEATABLE_API_TOKEN = "你的token"' > .dev.vars
echo 'SEATABLE_FORK_API_TOKEN = "你的token"' > .dev.vars
echo 'SEATABLE_ASTRA_API_TOKEN = "你的token"' > .dev.vars

# 3 启动 + 灌一次数据
npm run dev
# 3.1 触发一次刷新（需 ALLOW_MANUAL_REFRESH=true）
curl http://localhost:8787/__refresh

# 4 验证
open http://localhost:8787/
curl "http://localhost:8787/search/teacher?name=zml"
```

## 部署

```bash
npm run schema:remote
# NJU Table 老红黑榜
npx wrangler secret put SEATABLE_API_TOKEN
# fork-25 新红黑榜
npx wrangler secret put SEATABLE_FORK_API_TOKEN
# ad-astra 鼓励你学哪门课榜
npx wrangler secret put SEATABLE_ASTRA_API_TOKEN
npx wrangler deploy
# 首次部署后手动触发一次刷新（临时开启 ALLOW_MANUAL_REFRESH 或等待首个 cron）
```

## 许可证

本项目是 [carottX/nju-class](https://github.com/carottX/nju-class) 的衍生作品，原项目采用 **GPL-3.0** 许可证。根据 GPL-3.0 的 copyleft 要求，本项目同样以 **GPL-3.0** 许可证发布。

详见 [LICENSE](LICENSE)。这意味着：

- 你可以自由使用、修改和分发本项目；
- 任何基于本项目的衍生作品也必须以 GPL-3.0 发布并开放源代码；
- 必须保留原作者版权声明与本许可证声明。
