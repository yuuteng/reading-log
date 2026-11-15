#!/usr/bin/env node
// Deploy the reading-log Worker through the Cloudflare REST API (no wrangler needed, Node 18+).
//
//   CLOUDFLARE_API_TOKEN   token with "Workers Scripts: Edit" and "Workers KV Storage: Edit"
//   CLOUDFLARE_ACCOUNT_ID
//   READING_KEY            optional: (re)set the sync passphrase. Omit to keep the current one.
//
//   node worker/deploy.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const NAME = "reading-log", KV_TITLE = "reading-log";
const { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, READING_KEY } = process.env;
if (!TOKEN || !ACCOUNT) { console.error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first."); process.exit(1); }
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
const call = async (path, init = {}) => {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) } });
  const d = await res.json().catch(() => ({}));
  if (!d.success) throw new Error(`${init.method || "GET"} ${path}: ${JSON.stringify(d.errors || res.status)}`);
  return d.result;
};
const jsonBody = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// 1. KV namespace
const spaces = await call("/storage/kv/namespaces?per_page=100");
let kv = spaces.find(s => s.title === KV_TITLE);
if (!kv) { kv = await call("/storage/kv/namespaces", jsonBody("POST", { title: KV_TITLE })); console.log("kv: created"); } else console.log("kv: exists");

// 2. script + bindings (existing secrets are kept unless READING_KEY is given)
const bindings = [{ type: "kv_namespace", name: "DB", namespace_id: kv.id }];
if (READING_KEY) bindings.push({ type: "secret_text", name: "ACCESS_KEY", text: READING_KEY });
const form = new FormData();
form.append("metadata", new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-09-01", bindings, keep_bindings: ["secret_text", "plain_text"] })], { type: "application/json" }));
form.append("worker.js", new Blob([await readFile(fileURLToPath(new URL("./worker.js", import.meta.url)))], { type: "application/javascript+module" }), "worker.js");
await call(`/workers/scripts/${NAME}`, { method: "PUT", body: form });
console.log("upload: ok" + (READING_KEY ? " (passphrase set)" : " (passphrase unchanged)"));

// 3. workers.dev route
const sub = (await call("/workers/subdomain")).subdomain;
await call(`/workers/scripts/${NAME}/subdomain`, jsonBody("POST", { enabled: true, previews_enabled: false }));
console.log(`URL: https://${NAME}.${sub}.workers.dev`);
