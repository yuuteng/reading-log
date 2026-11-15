# 读书札记 · Reading Log

A single-page ledger of finished books: title, author, main characters, rating, tags and a note for each one.

Live: https://yuuteng.github.io/reading-log/

## Features

- One row per book. Tap a row to unfold the full note, tags, and the edit and delete actions.
- Sort by finish date, date added, rating, title or author, ascending or descending. Empty values always sort last.
- Filter by tag, search across title, author, characters and notes.
- Import from pasted iPhone Notes text, or from a JSON backup. Export to JSON or Markdown.
- Works offline: every change is saved in the browser first, then synced.
- Optional cloud sync through a small Cloudflare Worker, so the same list shows up on every device.
- Phone layout with bottom sheets you can drag down to dismiss; table layout from 820px up. Follows the system light or dark theme and the reduced-motion setting.

## Layout

| Path | Purpose |
|------|---------|
| `index.html` | The whole app: styles, data layer, UI |
| `worker/worker.js` | Cloudflare Worker that stores the list in KV |
| `worker/deploy.mjs` | Deploys the Worker through the Cloudflare REST API |

## Where the data lives

Books are stored in `localStorage` on each device. With sync turned on, the page posts its list to the Worker, which merges it with the stored copy (per book, newest edit wins; deletes are kept as tombstones) and returns the result. The Worker keeps one snapshot per day for 30 days under `backup:<date>`.

The repository holds no book data. The Worker only answers requests that carry the passphrase.

## Deploying the Worker

Needs Node 18+ and a Cloudflare API token with **Workers Scripts: Edit** and **Workers KV Storage: Edit**.

```sh
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export READING_KEY='a long passphrase'   # only when setting or changing it
node worker/deploy.mjs
```

The script creates the `reading-log` KV namespace if it is missing, uploads the Worker and enables its `workers.dev` route. If the printed URL differs from the `API` constant at the top of the script in `index.html`, update that constant.

Then open the page, tap the cloud button and enter the passphrase. "复制配置链接" gives a link that sets up another device in one tap.

## Running locally

```sh
python3 -m http.server 8000
```

Open http://localhost:8000/. The Worker accepts `localhost` origins.
