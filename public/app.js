// Pit Wall front end: listens to the /events stream, renders the grid, talks to /api/*.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const api = (method, path, body) =>
  fetch("/api/" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  });

const monDialog = $("dm");
const chDialog = $("dc");

let state = { monitors: [], channels: [] };
let first = true; // entrance animation plays once
let audio;
let boxed = new Set(); // names that were BOX on the previous render, so we beep only on new ones
let editId = null;
let lastMsg = 0;
const open = new Set(); // expanded car ids

const PILL = { ok: "OK", slow: "SLOW", box: "BOX", paused: "PAUSED", pending: "WAIT" };
const COLOR = { ok: "#00d26a", slow: "#ffd60a", box: "#e10600" };
const FLAG_TEXT = { ok: "Green flag", slow: "Yellow flag", box: "Red flag" };

const beep = () => {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator();
    o.connect(audio.destination);
    o.frequency.value = 880;
    o.start();
    o.stop(audio.currentTime + 0.25);
  } catch {}
};

const ms = (v) => (v == null ? "–" : v.toFixed(0) + "ms");

// timing cell: best = at personal best, slow = >1.5x best, good otherwise (F1 timing-screen colours)
const cell = (v, best) => {
  const kind = !best || v <= best * 1.02 ? "best" : v > best * 1.5 ? "slow" : "good";
  return `<span class="cell cell-${kind}">${ms(v)}</span>`;
};

const pct = (v) =>
  v == null
    ? "–"
    : `<span class="${v < 95 ? "text-bad" : v < 99 ? "text-warn" : ""}">${v.toFixed(v == 100 ? 0 : 2)}%</span>`;

function spark(a, flag) {
  if (!a.length) return '<span class="spark-empty">waiting for first lap…</span>';
  const max = Math.max(1, ...a);
  const w = 100 / Math.max(a.length - 1, 1);
  const y = (v) => 34 - (v / max) * 30;
  const color = COLOR[flag] || COLOR.ok;
  const pts = a.map((v, i) => (v < 0 ? null : [i * w, y(v)])).filter(Boolean);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = pts.length ? `${pts[0][0]},36 ${line} ${pts[pts.length - 1][0]},36` : "";
  const lastPt = a[a.length - 1] < 0 ? null : pts[pts.length - 1];
  const fails = a
    .map((v, i) =>
      v < 0
        ? `<line x1="${i * w}" x2="${i * w}" y2="36" stroke="#e10600" stroke-width="2" vector-effect="non-scaling-stroke"/>`
        : "",
    )
    .join("");
  const dot = lastPt
    ? `<span class="spark-dot" style="left:${lastPt[0]}%;top:${(lastPt[1] / 36) * 100}%;background:${color}"></span>`
    : "";
  return (
    `<svg class="spark-svg" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">` +
    `<polygon fill="${color}" opacity=".12" points="${area}"/>` +
    `<polyline fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${line}"/>` +
    `${fails}</svg>${dot}`
  );
}

const detail = (label, value) =>
  `<span><span class="details-label eyebrow">${label}</span>${value}</span>`;
const stat = (v) => `<b class="details-value num">${v}</b>`;

function carHtml(x, i, enter) {
  const l = x.last || {};
  const isOpen = open.has(x.id);
  const lap = !x.last ? "–" : l.ok ? cell(l.ms, x.best) : '<span class="cell cell-bad">FAIL</span>';
  const actions = [
    ["more", isOpen ? "▴" : "▾", `Details for ${x.name}`, `aria-expanded=${isOpen}`],
    ["edit", "✎", `Edit ${x.name}`, ""],
    ["pause", x.enabled ? "⏸" : "▶", `${x.enabled ? "Pause" : "Resume"} ${x.name}`, ""],
    ["del", "✕", `Delete ${x.name}`, ""],
  ]
    .map(
      ([a, icon, label, extra]) =>
        `<button class="btn btn-ghost" data-a=${a} ${extra} aria-label="${esc(label)}">${icon}</button>`,
    )
    .join("");
  return `
    <div class="car car-${x.flag}${enter ? " car-enter" : ""}" data-id=${x.id} style="--i:${i}">
      <div class="car-row">
        <b class="car-pos">${i + 1}</b>
        <div class="car-info">
          <span class="car-name">${esc(x.name)}</span>
          <span class="car-url subtle">${esc(x.url)}</span>
        </div>
        <span class="pill pill-${x.flag}">${PILL[x.flag]}</span>
        <span class="metric metric-lap num">${lap}</span>
        <span class="metric metric-up num">${pct(x.up24)}</span>
        <div class="spark">${spark(x.spark, x.flag)}</div>
        <span class="actions car-actions">${actions}</span>
      </div>
      <div class="car-details" ${isOpen ? "" : "hidden"}>
        ${detail("Sector 1 (header)", l.ok ? cell(l.s1, x.bestS1) : "–")}
        ${detail("Sector 2 (body)", l.ok ? cell(l.s2, x.bestS2) : "–")}
        ${detail("HTTP", `<b class="details-value num ${l.ok ? "text-good" : "text-bad"}">${x.last ? l.status || "ERR" : "–"}</b>`)}
        ${detail("Best lap", stat(ms(x.best || null)))}
        ${detail("Median", stat(ms(x.p50 || null)))}
        ${detail("p95", stat(ms(x.p95 || null)))}
        ${detail("Up 7d", stat(pct(x.up7)))}
        ${detail("Up 30d", stat(pct(x.up30)))}
        <span class="details-note">${esc(x.method)} every <b class="details-value details-strong num">${x.interval_s}s</b>, timeout <b class="details-value details-strong num">${x.timeout_ms}ms</b>, expects <b class="details-value details-strong num">${x.expect_status || "&lt;400"}</b></span>
        ${l.err ? `<span class="details-note text-bad">Last error: ${esc(l.err)}</span>` : ""}
      </div>
    </div>`;
}

const channelHtml = (c) => `
  <div class="channel">
    <span class="channel-info">${esc(c.name)} <span class="channel-host subtle">${esc(c.kind)} · ${esc(c.host)}</span></span>
    <span class="actions channel-actions">
      <button class="btn btn-ghost btn-compact btn-outline" data-a=ctest data-id=${c.id}>Test</button>
      <button class="btn btn-ghost btn-compact" data-a=cdel data-id=${c.id} aria-label="Remove ${esc(c.name)}">✕</button>
    </span>
  </div>`;

const avg = (a) => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : null);

function render() {
  const d = state.monitors;
  const worst = d.some((x) => x.flag == "box")
    ? "box"
    : d.some((x) => x.flag == "slow")
      ? "slow"
      : "ok";
  $("flag").className = `flag flag-${worst}`;
  $("flag").textContent = FLAG_TEXT[worst];

  const running = d.filter((x) => x.enabled);
  const oks = running.filter((x) => x.flag == "ok").length;
  const laps = d.filter((x) => x.last && x.last.ok).map((x) => x.last.ms);
  const ups = d.filter((x) => x.up24 != null).map((x) => x.up24);
  const nb = d.filter((x) => x.flag == "box").length;
  $("s-ok").textContent = running.length ? `${oks} / ${running.length}` : "–";
  $("s-lap").textContent = ms(avg(laps));
  $("s-up").innerHTML = pct(avg(ups));
  $("s-box").innerHTML = `<span class="${nb ? "text-bad" : ""}">${nb}</span>`;

  const now = new Set(d.filter((x) => x.flag == "box").map((x) => x.name));
  $("box").style.display = now.size ? "block" : "none";
  $("box").textContent = "BOX BOX: " + [...now].join(", ");
  if ([...now].some((n) => !boxed.has(n))) beep();
  boxed = now;

  $("empty").style.display = d.length ? "none" : "block";
  const enter = first && d.length > 0;
  if (enter) first = false;
  $("t").innerHTML = d.map((x, i) => carHtml(x, i, enter)).join("");
  $("cl").innerHTML =
    state.channels.map(channelHtml).join("") ||
    '<div class="channel muted">No alert channels yet.</div>';
}

// live connection
function setLive(on) {
  $("live").classList.toggle("is-off", !on);
  $("livet").textContent = on ? "LIVE" : "RECONNECTING";
}
const es = new EventSource("/events");
es.onmessage = (e) => {
  lastMsg = Date.now();
  state = JSON.parse(e.data);
  render();
  setLive(true);
};
es.onerror = () => setLive(false);
setInterval(() => {
  if (lastMsg && !$("live").classList.contains("is-off"))
    $("livet").textContent = "LIVE · " + Math.round((Date.now() - lastMsg) / 1000) + "s ago";
}, 1000);

// forms and dialogs
const setMsg = (el, text, ok) => {
  el.textContent = text;
  el.classList.toggle("form-msg-ok", !!ok);
};

function openMon(m) {
  editId = m ? m.id : null;
  $("dmt").textContent = m ? "Edit monitor" : "Add monitor";
  setMsg($("err"), "");
  const f = $("fm");
  f.reset();
  if (m)
    for (const k of ["name", "url", "method", "interval_s", "timeout_ms", "expect_status"])
      f[k].value = m[k];
  monDialog.showModal();
}

function openCh() {
  setMsg($("cerr"), "");
  chDialog.showModal();
}

$("add-car").onclick = () => openMon();
$("team-radio").onclick = openCh;
$("dm-cancel").onclick = () => monDialog.close();
$("dc-close").onclick = () => chDialog.close();

$("fm").onsubmit = async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    await (editId ? api("PUT", "monitors/" + editId, body) : api("POST", "monitors", body));
    monDialog.close();
  } catch (x) {
    setMsg($("err"), x.message);
  }
};

$("fc").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("POST", "channels", Object.fromEntries(new FormData(e.target)));
    e.target.reset();
    setMsg($("cerr"), "");
  } catch (x) {
    setMsg($("cerr"), x.message);
  }
};

const toggleOpen = (id) => (open.has(id) ? open.delete(id) : open.add(id));

// one delegated click handler for the car rows and the channel list
document.body.onclick = async (e) => {
  const car = e.target.closest(".car");
  const b = e.target.closest("button[data-a]");
  if (car && !b && e.target.closest(".car-row")) {
    toggleOpen(+car.dataset.id); // click row = expand
    return render();
  }
  if (!b) return;
  const id = +(car ? car.dataset.id : b.dataset.id);
  const m = state.monitors.find((x) => x.id == id);
  const act = b.dataset.a;
  try {
    if (act == "more") {
      toggleOpen(id);
      render();
    }
    if (act == "edit") openMon(m);
    if (act == "pause") await api("PUT", "monitors/" + id, { ...m, enabled: !m.enabled });
    if (act == "del" && confirm("Remove " + m.name + " and its history?"))
      await api("DELETE", "monitors/" + id);
    if (act == "cdel") await api("DELETE", "channels/" + id);
    if (act == "ctest") {
      await api("POST", "channels/" + id + "/test");
      setMsg($("cerr"), "Test sent.", true);
    }
  } catch (x) {
    setMsg($("cerr"), x.message);
  }
};
