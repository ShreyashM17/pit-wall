# Pit Wall: Knowledge Doc

Updated after every change. Newest entry goes at the bottom of the Changelog.

## What this is
A self-hosted uptime monitor styled as an F1 pit-wall screen. A team adds URLs in the browser. A Node server probes them on a schedule, stores every result in SQLite, shows live latency and 24h/7d/30d uptime, and posts to Slack, Discord or a webhook when a monitor goes "BOX BOX" and when it recovers.

## Why a server is needed
Browsers block cross-origin reads (CORS), so a page can't see another site's status code or timing. The Node server makes the requests and pushes the results to the page.

## Run it
- **Local, just you:** `node server.js`, then open http://localhost:3000. It needs Node 22.13 or newer (built-in `node:sqlite`, no `npm install`). With no password it only listens on `127.0.0.1`.
- **Team / cloud, any VPS with Docker:** point a DNS record at the server, then:
  ```
  cp .env.example .env     # set DOMAIN and ADMIN_PASSWORD (12+ characters)
  docker compose up -d --build
  ```
  Caddy gets a free HTTPS certificate and proxies to Pit Wall, so the Basic-auth password is never sent in clear text. The browser asks for a login (any username, password = `ADMIN_PASSWORD`). Data is in the `pitwall-data` volume: back it up. Update with `git pull && docker compose up -d --build`.
- **Cloud platforms (Fly.io, Render, Railway, etc.):** deploy the Dockerfile, set `ADMIN_PASSWORD`, mount a persistent volume at `/data`, use `/healthz` as the health check, and let the platform provide HTTPS. Run exactly **one** instance: SQLite plus the in-process scheduler means two copies would double-probe and double-alert. A platform without a persistent disk loses history on every redeploy.
- The server refuses to listen on any non-local `HOST` without `ADMIN_PASSWORD`, and refuses a password under 12 characters there.
- **Env vars:** `ADMIN_PASSWORD`, `HOST` (default `127.0.0.1`), `PORT` (3000), `DB_PATH` (`./data/pitwall.db`).
- **Tests:** `node test.js` (pure logic only, no database or network).

## Files
| File | Role |
|---|---|
| `server.js` | Entry point (19 lines): HTTP server, auth check, routing, starts the scheduler. |
| `src/config.js` | Env vars (`ADMIN_PASSWORD`, `HOST`, `PORT`, `DB_PATH`) and constants (`N`=60 samples, `DAY`, `RETAIN_DAYS`=31). |
| `src/health.js` | Pure logic: `med`, `judge`, `edge`. No I/O. |
| `src/validate.js` | `bad`, `httpUrl`, `cleanMon`: input checking. |
| `src/auth.js` | `authed(req)` and the "no password, no network" startup guard. |
| `src/db.js` | SQLite schema, prepared statements, `up()` uptime query, one-time seed from `targets.json`. |
| `src/state.js` | In-memory per-monitor state, `snapshot()`, and the SSE client list. |
| `src/alerts.js` | `send` and `notify` for Slack/Discord/webhook. |
| `src/probe.js` | `probe()`: one HTTP check, saves the sample, fires alerts on edges. |
| `src/scheduler.js` | `start()`: the 1-second tick. |
| `src/api.js` | `/api/*` routes for monitors and channels, plus `json()` helper. |
| `index.html` | The UI. Inline CSS and JS, no libraries. |
| `test.js` | Unit checks for `judge`, `edge`, `httpUrl`. |
| `Dockerfile` | Container image: non-root user, tini as PID 1, health check. Data lives in the `/data` volume. |
| `compose.yaml`, `Caddyfile`, `.env.example` | One-command VPS deploy: Pit Wall behind Caddy with automatic HTTPS. |
| `.dockerignore` | Keeps the database, tests and docs out of the image. |
| `targets.json` | Old v1 list. Only read once, to seed an empty database. Safe to delete afterwards. |
| `data/pitwall.db` | Created at runtime: monitors, samples, channels. |
| `KNOWLEDGE.md` | This document. |

### Module dependencies (no cycles)
```
config, health, validate        (no internal deps)
auth -> config
db -> config, validate
alerts -> db
state -> db, config, health
probe -> db, config, health, state, alerts
scheduler -> db, config, state, probe
api -> db, validate, state, alerts
server.js -> config, auth, api, state, scheduler
```

## Data flow
```
browser: add monitor -> POST /api/monitors -> SQLite monitors table
scheduler (1s tick): monitor due? -> probe() -> sample saved in SQLite + kept in memory (last 60)
  -> judge() sets flag -> flag changed to/from red? -> notify() -> Slack/Discord/webhook
  -> dirty flag -> broadcast() snapshot over SSE (/events) -> index.html re-renders
```

## Database (SQLite)
- `monitors`: id, name, url, method (GET/HEAD), `interval_s`, `timeout_ms`, `expect_status` (0 means any status below 400), `enabled`.
- `samples`: monitor_id, t (ms timestamp), ms, s1, s2, status, ok. One row per probe. The primary key is (monitor_id, t). Rows older than 31 days are deleted hourly.
- `channels`: id, name, kind (slack/discord/webhook), url.

## Backend: how each part works (module in brackets)
- **`med(a)`** [health.js]: median of an array, used as the "normal" latency baseline because it ignores one-off spikes.
- **`judge(h)`** [health.js]: gives a monitor's flag from its recent samples `h`. First match wins:
  1. `box` (red): the last 3 probes all failed.
  2. `box`: at least 5 samples and more than 20% failed.
  3. `box`: at least 5 samples and the last lap took more than 2x the median.
  4. `slow` (yellow): the last probe failed, or the last lap took more than 1.5x the median.
  5. otherwise `ok` (green).
- **`edge(prev, next)`** [health.js]: returns `'down'` when a flag enters red, `'up'` when it leaves red, otherwise `null`. Alerts fire only on these edges, so a monitor that stays red doesn't spam. The 3-failures-in-a-row rule in `judge` acts as the debounce.
- **`httpUrl(s)` and `cleanMon(b)`** [validate.js]: validate input. URLs must parse and be http or https. Interval is clamped to 10–3600 s, timeout to 1–30 s, and name to 60 chars. If no name is given, the host is used.
- **Auth (`authed`)** [auth.js]: if `ADMIN_PASSWORD` is set, every route needs HTTP Basic auth. The password is compared with `timingSafeEqual` on SHA-256 hashes. A 401 makes the browser show a login prompt.
- **Writes are protected from cross-site posts**: `body()` in api.js rejects anything that isn't `Content-Type: application/json`. A web page on another site can't send that without a CORS preflight, which this server doesn't allow.
- **`touch()` / `flush()`** [state.js]: `touch()` marks that browsers need an update (any change calls it). `flush()` runs on the scheduler tick and sends one snapshot if something changed, so many probes finishing together cause one broadcast.
- **`rtOf(id)`** [state.js]: in-memory state for a monitor: last 60 samples, current flag, last probe time, running flag. On first use (and after a restart) it reloads the last 60 samples from SQLite.
- **`probe(m, r)`** [probe.js]: one request using the monitor's method, timeout and expected status.
  - `s1` is the time to response headers, `s2` is the body download, `ms` is the total "lap".
  - `ok` is `status === expect_status` if one is set, otherwise `status < 400`.
  - A thrown error records `ok:false` with `err` set to `timeout` or `unreachable`.
  - It saves the sample, updates the flag, and calls `notify` on a red edge.
  - If the monitor was deleted mid-probe, the result is dropped.
- **`notify(m, kind, info)` and `send(c, ...)`** [alerts.js]: build a text message and POST JSON to every channel. Slack gets `{text}`, Discord gets `{content}`, and a generic webhook gets `{text, event, monitor, url, info}`. A failing channel is logged and never blocks monitoring.
- **`snapshot()`** [state.js]: the JSON the browser receives. Per monitor it has the config, flag, last sample, 24h/7d/30d uptime from SQL, p50, p95, best lap, best sectors and the sparkline array (`-1` = failure). Flags `paused` and `pending` (no data yet) are added here. Channels are sent without their URL, only the host, so webhook tokens never go back to the browser.
- **API** [api.js] (all JSON): `POST /api/monitors`, `PUT|DELETE /api/monitors/:id`, `POST /api/channels`, `DELETE /api/channels/:id`, `POST /api/channels/:id/test`.
- **`GET /events`** [state.js `subscribe`, `flush`, `heartbeat`]: Server-Sent Events. It sends a full snapshot on connect and again whenever something changed, with a heartbeat every 15 s.
- **Scheduler** [scheduler.js]: a 1-second tick starts any enabled monitor whose interval has elapsed. Probes run in parallel and a monitor never overlaps itself. The same tick calls `flush()` and prunes old samples.

## index.html: how each part works
- **Data in:** `EventSource('/events')` receives a snapshot (`S = {monitors, channels}`) and calls `render()`, which rebuilds the grid. `esc()` HTML-escapes every user-supplied string.
- **Header:** worst-flag badge (GREEN / YELLOW / RED FLAG), a LIVE indicator, + ADD CAR and RADIO buttons.
  - **LIVE dot:** green with "LIVE · Ns ago" while messages arrive (the server sends at least a heartbeat every 15 s). Amber "RECONNECTING" when the stream errors; `EventSource` retries by itself.
- **Summary strip:** four tiles computed in the browser from the snapshot: cars OK / running, average lap, average 24h uptime, and number in BOX BOX.
- **BOX BOX banner:** lists red monitors, flashes (not if the OS asks for reduced motion), has `role=alert` so screen readers announce it, and beeps once when a monitor newly goes red (browsers may need one click first).
- **Grid, one card per monitor:** position, name and URL, a state pill with text (`OK`, `SLOW`, `BOX`, `PAUSED`, `WAIT`, so state isn't colour-only), S1 header, S2 body and LAP cells, HTTP status, uptime 24h/7d/30d, sparkline, and buttons.
  - **`cell(v, best)`:** F1 timing-screen colours: purple fill = within 2% of the monitor's best, yellow = over 1.5x best, green otherwise. A failed lap shows a red FAIL cell.
  - **`spark(a, flag)`:** inline SVG of the last 60 laps, coloured by state, with a faint area fill and a dot on the latest lap. Failed probes are red vertical ticks. A new monitor shows "waiting for first lap…".
- **Row expand:** click a row (or the ▾ button, which has `aria-expanded`) to show best lap, median, p95, last S1/S2, 7d/30d uptime, method, interval, timeout, expected status and the last error. Open rows are remembered across updates in the `open` set. Clicking a button doesn't toggle the row.
- **Buttons:** ▾ details, ✎ edit, ⏸/▶ pause or resume, ✕ delete (asks to confirm and removes history). All have `aria-label`s.
- **Mobile (under 900px):** each monitor becomes a two-line card with name, state pill, lap, 24h uptime and sparkline. The hidden columns are available in the expand.
- **📻 RADIO:** add, test and delete alert channels.
- **Empty state:** a short prompt to click + ADD CAR.

## Known limits
- Basic auth with one shared password, no per-user accounts or roles.
- No email alerts (it would need SMTP). Use a Slack/Discord/webhook channel or a webhook-to-email service.
- No public status page and no long-range charts yet; uptime is shown as 24h/7d/30d numbers.
- Alerts are sent from one server, so if the server itself is down nobody is told.
- Monitors can target any http(s) URL, including internal addresses, which is fine for a trusted team but not for open sign-up.

## Changelog
- **v1:** initial build with hard-coded `targets.json`, in-memory history, 5 s interval.
- **v2, built for real use:**
  - Added SQLite persistence. History survives restarts and uptime is shown over 24h, 7d and 30d.
  - Added add/edit/pause/delete of monitors in the UI, with per-monitor interval, timeout, method and expected status.
  - Added Slack, Discord and webhook alerts, sent on going down and on recovery.
  - Added a shared password (`ADMIN_PASSWORD`). The server refuses to listen on a network address without one.
  - Added a Dockerfile and input validation.
  - Tested: selftest, API validation, the password check, and a real webhook alert from a dead monitor. The new UI was not opened in a browser.
- **v2.1, split into modules:** `server.js` (was 180 lines) is now a 19-line entry point plus 10 modules under `src/`. Behaviour is unchanged. Two small changes came with it: the shared `dirty` flag is now `touch()`/`flush()` in `state.js`, and the self-test moved from `node server.js --selftest` to `node test.js`. Dockerfile now copies `src/`. Tested: `node test.js`, login (401 without / 200 with password), input validation, adding a monitor and receiving it over SSE, and the refusal to start on `0.0.0.0` without a password.
- **v2.2, UI polish (index.html only, no backend change):** state pills with text, F1-colour timing cells, summary strip, expandable rows showing p50/p95/best and settings, LIVE/RECONNECTING indicator, better sparkline, mobile card layout, aria-live banner, focus rings, reduced-motion support, friendlier empty and pending states. Tested in a real browser at desktop width and in a 390px-wide frame with healthy, paused and dead monitors, and a monitor name containing HTML (shown as text, not rendered). Not tested: the LIVE dot going amber after stopping the server, keyboard tabbing, and the add/edit dialogs after the redesign.
- **v2.3, layout and spacing (CSS only in index.html):** feedback was "too clumsy". Changes: base font 15px, page capped at 1240px wide, a consistent 8px-based spacing scale (16px row padding and gaps, 20px between sections, 12px between rows), larger summary tiles, a smaller less shouty BOX BOX banner that flashes more slowly, a thinner left status bar, quieter position badges, wider timing cells, a shorter sparkline, and row action buttons that are transparent until hovered or focused. Expanded details use 13px text. Mobile padding was adjusted to match. Checked at desktop width in a real browser; the mobile layout was not re-checked after this change.
- **v2.4, full-width page:** the 1240px cap added in v2.3 left empty side margins on wide screens ("page smaller than the viewport"). Removed it: the page now fills the full viewport width with side padding of `clamp(16px, 2.5vw, 40px)` and `min-height:100vh`, and the grid columns stretch to fit. Not yet checked in a browser.
- **v3.0, full UI redesign (index.html only, no backend change):** feedback was "the design sucks": too dense, not F1 enough, generic, weak hierarchy. Changes:
  - **Hierarchy:** a "race control" hero at the top. One big flag block (green/yellow/red, slanted edge, italic caps) with the four stats beside it. `#flag` is still set by `render()`; its "RACE CONTROL" label is CSS `::before`.
  - **Less density:** each row now shows only P, car, state, LAP, UP 24H, sparkline and buttons (7 columns, was 12). S1/S2 timing cells, HTTP, best/median/p95, 7d/30d uptime and config moved into the expanded panel, which is now a grid of labelled values. S1/S2 keep the purple/green/yellow colours there.
  - **F1 feel:** Bahnschrift/DIN-style system font (falls back to Segoe UI), bold italic uppercase headings, slanted position boxes and state pills like the TV timing tower, F1 red `#e10600`, carbon-fibre stripe on the background, red logo slash instead of the emoji.
  - **Unchanged:** all JS logic, element ids and `data-a` actions. Mobile (under 900px) is a 3-line card: name and state, sparkline, then lap, 24h uptime and buttons. Emoji removed from buttons and dialogs.
  - Not yet checked in a browser.
- **v3.1, load-in motion (index.html only):** `/design-motion` could not export a video here (native Windows, no ffmpeg), so the motion went into the live page instead.
  - Hero: the flag block wipes in left to right, the four stat tiles rise in one after another. Pure CSS, runs once on page load.
  - Rows: each car slides in from the left, staggered by position (`--i`), then its sparkline is revealed left to right and the latest-lap dot fades in. Controlled by the `first` flag in `render()`: only the first render with at least one monitor adds the `ent` class, so later updates (every probe) never replay it.
  - Curves never overshoot. Everything is off under `prefers-reduced-motion`. If a live update arrives during the ~2s intro, the rebuilt rows skip to their final state.
  - Not checked in a browser.
- **v3.2, cloud-ready Docker:** the image runs as the non-root `node` user, uses tini as PID 1 so `docker stop` exits in under a second, and has a HEALTHCHECK. New `GET /healthz` in `server.js`, answered before the password check so load balancers can probe without credentials. `auth.js` refuses a password under 12 characters when listening on a network address. Added `compose.yaml` + `Caddyfile` + `.env.example` (Caddy does HTTPS and does not buffer the live `/events` stream) and `.dockerignore`. Tested: image builds; missing and short passwords are refused; `/healthz` is 200 without login; `/` is 401 without and 200 with the password; runs as `node`; container reports healthy; stops in 0.8s; `docker compose config` validates. Not tested: a real deploy with a domain and certificate, and data surviving a container recreate.
- **v3.3, Team radio form alignment (CSS only in index.html):** the Add button in the alerts dialog sat higher than the Name and Type fields and was a different height. Fix: `.two` aligns its items to the bottom, and `input`, `select` and `label button` all have `height:38px`, with the button full width and the same top margin as the inputs. Checked in a real browser: all three controls measure 38px with identical top and bottom. The add-monitor dialog uses the same grid and is unaffected.
- **v3.4, custom dropdowns (CSS only in index.html):** the two `<select>` menus (Method in Add monitor, Type in Team radio) now match the theme. The closed field has its own chevron, uppercase text and a white border on hover or open. In browsers that support `appearance:base-select` (Chrome and Edge 135+) the open list is styled too: dark panel with a red top edge, uppercase options, a red bar on the selected one, hover highlight. Other browsers fall back to their native list with dark colours. Also fixed: the Save and Add buttons in dialogs lost their red fill because `.act button` overrode `button.pri`; added `.act button.pri`. Checked in Chrome 157: the open list, and the Method field is 38px tall like the inputs beside it. Firefox and Safari were not checked.
