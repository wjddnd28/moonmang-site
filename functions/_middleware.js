/**
 * HTTP Basic auth for the private pages.
 *
 * This runs ahead of every request, so the fast path matters: anything that
 * is not the dashboard or its data endpoint falls straight through to the
 * static asset with a single regex test.
 *
 * Configure two encrypted secrets on the Pages project:
 *   DASH_USER — the login name
 *   DASH_PASS — the password
 *
 * If either is missing the gate fails closed. Exposing the numbers because a
 * variable was mistyped is worse than a dashboard that will not open.
 */

const PROTECTED = /^\/(dashboard(\.html)?|api\/stats)\/?$/;

const REALM = 'Basic realm="Moonmang dashboard", charset="UTF-8"';

function challenge(message = "Authentication required.") {
  return new Response(message, {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

/** Length-independent comparison, so the response time leaks nothing. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** Decode base64 as UTF-8 rather than latin-1, so non-ASCII passwords work. */
function decodeCredentials(encoded) {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function onRequest({ request, env, next }) {
  const { pathname } = new URL(request.url);
  if (!PROTECTED.test(pathname)) return next();

  if (!env.DASH_USER || !env.DASH_PASS) {
    return new Response(
      "Dashboard credentials are not configured. Set DASH_USER and DASH_PASS on the Pages project.",
      {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      }
    );
  }

  const header = request.headers.get("Authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return challenge();

  let decoded;
  try {
    decoded = decodeCredentials(encoded);
  } catch (err) {
    return challenge("Malformed credentials.");
  }

  const split = decoded.indexOf(":");
  const user = split < 0 ? "" : decoded.slice(0, split);
  const pass = split < 0 ? "" : decoded.slice(split + 1);

  // Both comparisons always run, so a wrong username and a wrong password
  // are indistinguishable from the outside.
  const okUser = safeEqual(user, env.DASH_USER);
  const okPass = safeEqual(pass, env.DASH_PASS);
  if (!okUser || !okPass) return challenge("Invalid credentials.");

  return next();
}
