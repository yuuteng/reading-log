// Cloudflare Worker: stores the reading log in KV so the page works on any device.
//
// Bindings (set by deploy.mjs):
//   DB               KV namespace
//   ACCESS_KEY       secret; the page sends it as "Authorization: Bearer <key>"
//   ALLOWED_ORIGINS  comma-separated page origins, default https://yuuteng.github.io
//
// GET  /sync   -> { books: { id: book }, deleted: { id: ms } }
// POST /sync   { books, deleted } -> merges with what is stored, returns the merged state
//
// Merge is per book, last write wins by updatedAt. A tombstone in `deleted` beats any version
// that is not newer than it. Merging is idempotent, so a lost race is repaired by the next sync.
// One snapshot per day is kept for 30 days under backup:<date>.

const MAX_BODY = 6 * 1024 * 1024, MAX_BOOKS = 20000, TOMBSTONE_TTL = 400 * 86400000;

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "https://yuuteng.github.io").split(",").map(s => s.trim());
    const okOrigin = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin : allowed[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !okOrigin) return json({ error: "origin not allowed" }, 403, cors);

    const url = new URL(req.url);
    if (url.pathname !== "/sync") return json({ ok: true, service: "reading-log" }, 200, cors);
    if (!env.ACCESS_KEY) return json({ error: "ACCESS_KEY not set" }, 500, cors);
    const given = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!(await same(given, env.ACCESS_KEY))) return json({ error: "unauthorized" }, 401, cors);

    const stored = normalize(await env.DB.get("library", "json"));
    if (req.method === "GET") return json(stored, 200, cors);
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "too large" }, 413, cors);
    let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: "bad json" }, 400, cors); }
    const incoming = normalize(body);
    if (Object.keys(incoming.books).length > MAX_BOOKS) return json({ error: "too many books" }, 413, cors);

    const changed = mergeInto(stored, incoming);
    const now = Date.now();
    for (const id in stored.deleted) if (now - stored.deleted[id] > TOMBSTONE_TTL) delete stored.deleted[id];
    if (changed) {
      const text = JSON.stringify(stored);
      await env.DB.put("library", text);
      const day = "backup:" + new Date().toISOString().slice(0, 10);
      if (!(await env.DB.get(day))) await env.DB.put(day, text, { expirationTtl: 30 * 86400 });
    }
    return json(stored, 200, cors);
  },
};

function mergeInto(dst, src) {
  let ch = false; const sb = src.books, sd = src.deleted;
  for (const id in sd) if (!(dst.deleted[id] >= sd[id])) { dst.deleted[id] = sd[id]; ch = true; }
  for (const id in sb) { const l = dst.books[id], r = sb[id]; if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) { dst.books[id] = r; ch = true; } }
  for (const id in dst.deleted) { const b = dst.books[id]; if (!b) continue; if (dst.deleted[id] >= (b.updatedAt || 0)) { delete dst.books[id]; ch = true; } else { delete dst.deleted[id]; ch = true; } }
  return ch;
}

const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const list = (v, n) => (Array.isArray(v) ? v : []).slice(0, n).map(x => str(x, 60));
function normalize(d) {
  const out = { books: {}, deleted: {} };
  if (!d || typeof d !== "object") return out;
  for (const id in d.books || {}) {
    const b = d.books[id];
    if (!/^[\w.~:@+-]{1,64}$/.test(id) || !b || typeof b !== "object" || !str(b.title, 200).trim()) continue;
    out.books[id] = {
      title: str(b.title, 200), author: str(b.author, 120), cast: list(b.cast, 8), finished: /^\d{4}-\d{2}-\d{2}$/.test(b.finished) ? b.finished : "",
      rating: Math.max(0, Math.min(5, Math.round(Number(b.rating) || 0))), tags: list(b.tags, 12), thoughts: str(b.thoughts, 50000),
      createdAt: Number(b.createdAt) || 0, updatedAt: Number(b.updatedAt) || 0,
    };
  }
  for (const id in d.deleted || {}) { const t = Number(d.deleted[id]); if (/^[\w.~:@+-]{1,64}$/.test(id) && t > 0) out.deleted[id] = t; }
  return out;
}

async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors } });
}
