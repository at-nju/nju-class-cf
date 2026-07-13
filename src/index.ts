import { search } from "./search";
import { refresh, seedStaticOnly } from "./refresh";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SEATABLE_API_TOKEN?: string; // NJU Table
  SEATABLE_FORK_API_TOKEN?: string; // fork25
  SEATABLE_ASTRA_API_TOKEN?: string; // ad-astra
  DEPLOY_REFRESH_TOKEN?: string;
  ALLOW_MANUAL_REFRESH?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function validRefreshToken(request: Request, expected?: string): Promise<boolean> {
  if (!expected) return false;
  const provided = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// 检查是否有数据
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

    // 本地允许 GET；部署脚本使用带 Token 的 POST。
    if (pathname === "/__refresh") {
      const allowed =
        (request.method === "GET" && env.ALLOW_MANUAL_REFRESH === "true") ||
        (request.method === "POST" && (await validRefreshToken(request, env.DEPLOY_REFRESH_TOKEN)));
      if (!allowed) return json({ error: "Unauthorized" }, 401);

      try {
        const count = await refresh(env);
        return json({ ok: true, rows: count });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }
    // 仅用静态源填充（仅本地/测试）
    if (pathname === "/__seed_static" && env.ALLOW_MANUAL_REFRESH === "true") {
      try {
        const count = await seedStaticOnly(env);
        return json({ ok: true, rows: count });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }

    // 静态资源
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
