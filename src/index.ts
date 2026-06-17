import { search } from "./search";
import { refresh, seedStaticOnly } from "./refresh";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SEATABLE_API_TOKEN?: string; // NJU Table base
  SEATABLE_FORK_API_TOKEN?: string; // fork25 base
  ALLOW_MANUAL_REFRESH?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// 已有数据？（reviews 为空视为「尚未加载」，对齐原 503 行为）
async function hasData(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM reviews LIMIT 1").first();
  return row != null;
}

async function handleSearch(env: Env, field: "teacher" | "course", name: string | null): Promise<Response> {
  const label = field === "teacher" ? "Teacher" : "Course";
  if (!name) return json({ error: `${label} name is required` }, 400);

  if (!(await hasData(env))) return json({ error: "Data not loaded yet" }, 503);

  const results = await search(env.DB, field, name);
  if (results.length === 0) {
    const msg = field === "teacher" ? "No courses found for this teacher" : "No reviews found for this course";
    return json({ message: msg }, 404);
  }
  // 与原 Flask 一致：直接返回记录数组
  return json(results);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/search/teacher") {
      return handleSearch(env, "teacher", url.searchParams.get("name"));
    }
    if (pathname === "/search/course") {
      return handleSearch(env, "course", url.searchParams.get("name"));
    }

    // 仅本地/测试：手动触发一次刷新（拉 SeaTable + 静态源）
    if (pathname === "/__refresh" && env.ALLOW_MANUAL_REFRESH === "true") {
      try {
        const count = await refresh(env);
        return json({ ok: true, rows: count });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }
    // 仅本地/测试：仅用静态历史源填充（无需 SeaTable token）
    if (pathname === "/__seed_static" && env.ALLOW_MANUAL_REFRESH === "true") {
      try {
        const count = await seedStaticOnly(env);
        return json({ ok: true, rows: count });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }

    // 其余交给静态资源（index.html / css）
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      refresh(env)
        .then((count) => console.log(`Data snapshot updated successfully: ${count} rows`))
        .catch((e) => console.error(`Failed to update data: ${e}`)),
    );
  },
} satisfies ExportedHandler<Env>;
