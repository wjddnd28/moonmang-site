/**
 * POST /api/hit — records one visit.
 *
 * Stores only: date, ISO country code (read from Cloudflare's edge), path.
 * No IP, no cookie, no identifier of any kind is written.
 *
 * Requires a D1 binding named DB. Without it this is a silent no-op so the
 * site keeps working before the database is set up.
 */
export async function onRequestPost({ request, env }) {
  if (!env.DB) return new Response(null, { status: 204 });

  // Only count beacons sent by our own pages. This will not stop a determined
  // script, but it keeps casual off-site calls out of the numbers.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response(null, { status: 204 });
  }

  let path = "/";
  try {
    const body = await request.json();
    if (typeof body.p === "string" && body.p.startsWith("/")) {
      path = body.p.slice(0, 120);
    }
  } catch (err) {
    // no body, keep the default
  }

  const country = (request.cf && request.cf.country) || "XX";
  // Days are bucketed in KST (UTC+9, no DST) so "today" matches the
  // operator's calendar rather than UTC's.
  const day = new Date(Date.now() + 32400000).toISOString().slice(0, 10);

  try {
    await env.DB.prepare(
      `INSERT INTO hits (day, country, path, n) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT(day, country, path) DO UPDATE SET n = n + 1`
    )
      .bind(day, country, path)
      .run();
  } catch (err) {
    // never let analytics break a page load
  }

  return new Response(null, { status: 204 });
}
