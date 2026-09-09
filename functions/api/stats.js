/**
 * GET /api/stats?days=30 — aggregated visit counts for the dashboard.
 *
 * Access control lives in functions/_middleware.js, which challenges this
 * path with HTTP Basic auth before the request ever reaches here.
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return json({ error: "no_database", hint: "Bind a D1 database as DB." }, 503);
  }

  const url = new URL(request.url);
  let days = parseInt(url.searchParams.get("days") || "30", 10);
  if (!Number.isFinite(days) || days < 1) days = 30;
  if (days > 365) days = 365;

  // Same KST bucketing as hit.js, so the ranges line up with the stored days.
  const kstDay = (offsetDays = 0) =>
    new Date(Date.now() + 32400000 - offsetDays * 86400000).toISOString().slice(0, 10);

  const from = kstDay(days - 1);

  try {
    const [byDay, byCountry, byPath, totals] = await Promise.all([
      env.DB.prepare(
        `SELECT day, SUM(n) AS n FROM hits WHERE day >= ?1 GROUP BY day ORDER BY day`
      ).bind(from).all(),
      env.DB.prepare(
        `SELECT country, SUM(n) AS n FROM hits WHERE day >= ?1
         GROUP BY country ORDER BY n DESC LIMIT 40`
      ).bind(from).all(),
      env.DB.prepare(
        `SELECT path, SUM(n) AS n FROM hits WHERE day >= ?1
         GROUP BY path ORDER BY n DESC LIMIT 25`
      ).bind(from).all(),
      env.DB.prepare(
        `SELECT
           (SELECT COALESCE(SUM(n),0) FROM hits)                   AS all_time,
           (SELECT COALESCE(SUM(n),0) FROM hits WHERE day = ?1)    AS today,
           (SELECT COALESCE(SUM(n),0) FROM hits WHERE day >= ?2)   AS last7,
           (SELECT COUNT(DISTINCT country) FROM hits WHERE day >= ?3) AS countries`
      )
        .bind(kstDay(0), kstDay(6), from)
        .first(),
    ]);

    return json({
      from,
      days,
      totals,
      byDay: byDay.results,
      byCountry: byCountry.results,
      byPath: byPath.results,
    });
  } catch (err) {
    return json({ error: "query_failed", detail: String(err.message || err) }, 500);
  }
}
