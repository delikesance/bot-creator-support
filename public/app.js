// Support desk: shell (header, views), inbox, full-screen conversation, live updates.
import { h, icon, bibi, api, post, onAuthLost, store, ago, clock, dur, bytes, initials, extOf, plain, toast, modal, confirmDialog } from "./lib.js";
import { createComposer, LIMITS } from "./composer.js";

const STATUS = {
  open: { label: "Open", color: "#A78BFA" },
  in_progress: { label: "In progress", color: "#FFB86B" },
  closed: { label: "Closed", color: "#5C5B58" },
};
const VIEWS = [
  ["waiting-us", "Waiting on us", "var(--accent-ink)"],
  ["waiting-customer", "Waiting on customer", "var(--amber)"],
  ["mine", "Assigned to me", null],
  ["unassigned", "Unassigned", null],
  ["open", "All open", null],
  ["closed", "Closed", "var(--faint)"],
];
const PRIORITIES = [["urgent", "Urgent", "var(--danger)"], ["high", "High", "var(--amber)"], ["normal", "Normal", "var(--muted)"], ["low", "Low", "var(--faint)"]];
const REASONS = [["resolved", "Resolved"], ["no_reply", "No reply from customer"], ["duplicate", "Duplicate"], ["other", "Other"]];
const SORTS = [["oldest", "Oldest first"], ["newest", "Newest first"]];
const DEFAULT_TARGETS = { firstReplyMs: 900_000, replyMs: 3_600_000 };

const state = {
  view: "waiting-us", tag: "", fPriority: "", fAssignee: "", fLang: "", sort: null, query: "",
  me: null, guilds: [], guild: null, tickets: [], stats: { open: 0, in_progress: 0, closed: 0 }, awaiting: { support: 0, customer: 0 },
  tags: null, metrics: null, metricsDays: 7, replies: null, audit: [], hits: null, selected: null, detail: null,
  loading: true, online: true, changed: new Set(), animate: true, intro: true, slide: false,
  pop: null, dirty: false, notify: store.get("notify") === "1", tipOff: store.get("tip") === "off",
};
const app = document.getElementById("app");
const composers = new Map();
let shell = null, lastSig = "", lastKpi = {}, metricsAt = 0, metricsKey = "", searchTimer = 0;

/* ---------- Data ---------- */
const isOpen = (t) => t.status !== "closed";
const isMine = (t) => (t.assigneeId && state.me?.id && t.assigneeId === state.me.id) || (t.assignee && state.me?.name && t.assignee === state.me.name);
const targets = () => state.metrics?.targets ?? DEFAULT_TARGETS;
const since = (t) => t.waitingSince ?? t.updatedAt;

const VIEW_TEST = {
  "waiting-us": (t) => isOpen(t) && t.awaiting === "support",
  "waiting-customer": (t) => isOpen(t) && t.awaiting === "customer",
  mine: (t) => isOpen(t) && isMine(t),
  unassigned: (t) => isOpen(t) && !t.assignee,
  open: isOpen,
  closed: (t) => !isOpen(t),
};
const viewCount = (key) => state.tickets.filter(VIEW_TEST[key]).length;
const viewLabel = (key) => VIEWS.find((v) => v[0] === key)?.[1] ?? "Tickets";

function tagList() {
  if (state.tags) return state.tags;
  const n = new Map();
  for (const t of state.tickets) for (const g of t.tags ?? []) n.set(g, (n.get(g) ?? 0) + 1);
  return [...n].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function visible() {
  const q = state.query.trim().toLowerCase();
  const list = state.tickets.filter((t) =>
    (q || VIEW_TEST[state.view](t)) &&
    (!state.tag || t.tags?.includes(state.tag)) &&
    (!state.fPriority || (t.priority ?? "normal") === state.fPriority) &&
    (!state.fAssignee || (state.fAssignee === "me" ? isMine(t) : state.fAssignee === "none" ? !t.assignee : t.assignee === state.fAssignee)) &&
    (!state.fLang || t.locale === state.fLang) &&
    (!q || state.hits?.has(t.id) || `${t.id} ${t.subject} ${t.description ?? ""} ${t.userName} ${t.assignee ?? ""} ${t.lastMessage?.content ?? ""} ${(t.tags ?? []).join(" ")}`.toLowerCase().includes(q)));
  const order = state.sort ?? (state.view === "waiting-us" ? "oldest" : "newest");
  return list.sort((a, b) => order === "oldest" ? since(a) - since(b) : b.updatedAt - a.updatedAt);
}

async function loadMetrics(force = false) {
  const key = `${state.guild}:${state.metricsDays}`;
  if (!force && key === metricsKey && Date.now() - metricsAt < 60_000) return;
  metricsAt = Date.now(); metricsKey = key;
  try { state.metrics = await api(`/metrics?guild=${encodeURIComponent(state.guild)}&days=${state.metricsDays}`); }
  catch (e) { if (e.message === "auth") throw e; state.metrics = null; }
}
/** Server-side search: subject, customer, description and message content, internal notes included. */
async function searchServer(q) {
  try {
    const r = await api(`/tickets?guild=${encodeURIComponent(state.guild)}&q=${encodeURIComponent(q)}`);
    if (q !== state.query.trim()) return;
    state.hits = new Set(r.tickets.map((t) => t.id));
    state.animate = false; renderContent();
  } catch (e) { if (e.message !== "auth") state.hits = null; }
}
async function loadAudit() {
  if (!state.selected) { state.audit = []; return; }
  try { state.audit = (await api(`/audit?ticket=${state.selected}`)).entries ?? []; }
  catch (e) { if (e.message === "auth") throw e; state.audit = []; }
}
let repliesFor = null;
async function loadReplies() {
  if (repliesFor === state.guild) return;
  repliesFor = state.guild;
  try { state.replies = (await api(`/replies?guild=${encodeURIComponent(state.guild)}`)).replies ?? []; }
  catch (e) { if (e.message === "auth") throw e; state.replies = []; repliesFor = null; }
}

async function load() {
  state.me ??= await api("/me").catch((e) => { if (e.message === "auth") throw e; return null; });
  state.guilds = (await api("/guilds")).guilds;
  if (!state.guilds.some((g) => g.id === state.guild)) {
    const saved = store.get("guild");
    state.guild = (state.guilds.find((g) => g.id === saved) ?? state.guilds[0])?.id ?? null;
  }
  if (!state.guild) {
    state.tickets = []; state.stats = { open: 0, in_progress: 0, closed: 0 }; state.detail = null; state.selected = null;
    return;
  }
  const [data] = await Promise.all([api("/tickets?guild=" + encodeURIComponent(state.guild)), loadMetrics(), loadReplies()]);
  const prev = new Map(state.tickets.map((t) => [t.id, t.status + t.updatedAt]));
  state.changed = new Set(state.tickets.length ? data.tickets.filter((t) => prev.get(t.id) !== t.status + t.updatedAt).map((t) => t.id) : []);
  state.tickets = data.tickets;
  state.stats = data.stats;
  state.awaiting = data.awaiting ?? { support: 0, customer: 0 };
  state.tags = data.tags;
  if (state.selected) {
    try { [state.detail] = await Promise.all([api("/tickets/" + state.selected), loadAudit()]); }
    catch (e) { if (e.message === "auth") throw e; state.selected = null; state.detail = null; }
  }
}

/* ---------- Dropdown menus ---------- */
function setPop(id) {
  state.pop = id;
  render();
  const m = document.querySelector(".menu[role=menu]");
  if (m) (m.querySelector("[aria-checked=true]") ?? m.querySelector("[role^=menuitem]"))?.focus();
}
function closePop(focusTrigger = true) {
  if (!state.pop) return;
  const id = state.pop;
  state.pop = null;
  render();
  if (focusTrigger) document.getElementById("b-" + id)?.focus();
}
function menuKeys(e) {
  const items = [...e.currentTarget.querySelectorAll("[role^=menuitem]")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
  else if (e.key === "End") { e.preventDefault(); items.at(-1)?.focus(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(); }
  else if (e.key === "Tab") closePop(false);
}
/** items: { label, lead?, small?, checked?, cls?, onpick } | { heading } | { sep:true } */
function dropdown(id, trigger, items, { cls = "chip", right = false, label, title } = {}) {
  const open = state.pop === id;
  const btn = h("button", { class: cls, type: "button", id: "b-" + id, "aria-haspopup": "menu", "aria-expanded": String(open), "aria-label": label, title,
    onclick: (e) => { e.stopPropagation(); setPop(open ? null : id); } }, trigger);
  const menu = open ? h("div", { class: "menu" + (right ? " right" : ""), role: "menu", "aria-label": label, onclick: (e) => e.stopPropagation(), onkeydown: menuKeys },
    items.map((it) => {
      if (it.heading) return h("div", { class: "eyebrow" }, it.heading);
      if (it.sep) return h("hr");
      return h("button", { class: "opt " + (it.cls ?? ""), type: "button", role: it.checked === undefined ? "menuitem" : "menuitemradio", "aria-checked": it.checked === undefined ? null : String(!!it.checked),
        onclick: () => { closePop(false); it.onpick?.(); } }, it.lead ?? null, h("span", { class: "grow truncate" }, it.label), it.small ? h("small", {}, it.small) : null, it.trail ?? null);
    })) : null;
  return h("div", { class: "pop" }, btn, menu);
}

/* ---------- Shell: header, views ---------- */
function buildShell() {
  const input = h("input", { id: "q", type: "search", placeholder: "Search tickets, people and messages", "aria-label": "Search tickets, people and messages", autocomplete: "off",
    oninput: (e) => {
      state.query = e.target.value; state.animate = false; state.hits = null;
      clearTimeout(searchTimer);
      const q = state.query.trim();
      if (q && state.guild) searchTimer = setTimeout(() => searchServer(q), 220);
      renderSide(); renderContent();
    } });
  const field = h("label", { class: "field" }, icon("search", 16), input, h("span", { class: "kbd", "aria-hidden": "true" }, "/"));
  shell = {
    root: h("div", { class: "shell" }), input, field,
    head: h("header", { class: "top" }),
    side: h("nav", { class: "side", "aria-label": "Views" }),
    main: h("div", { class: "frame-main", style: "flex:1;min-width:0;display:flex;flex-direction:column" }),
  };
  shell.root.append(shell.head, h("div", { class: "frame" }, shell.side, shell.main));
  app.replaceChildren(shell.root);
}

function guildIcon(g) {
  return g.icon ? h("img", { class: "gicon", src: g.icon, alt: "", referrerpolicy: "no-referrer" })
    : h("span", { class: "gicon", "aria-hidden": "true" }, [...g.name][0]?.toUpperCase() ?? "?");
}

function guildPicker() {
  const cur = state.guilds.find((g) => g.id === state.guild);
  if (!cur) return h("span", { class: "eyebrow" }, "No server");
  if (state.guilds.length === 1) return h("div", { class: "btn guild-btn static", title: "Server" }, guildIcon(cur), h("span", { class: "truncate" }, cur.name));
  const others = state.guilds.filter((g) => g.id !== cur.id).reduce((n, g) => n + g.stats.open, 0);
  return dropdown("guild", [guildIcon(cur), h("span", { class: "truncate" }, cur.name),
    others ? h("span", { class: "gcount", title: `${others} open ticket${others === 1 ? "" : "s"} on other servers` }, String(others)) : null,
    h("span", { class: "chev" }, icon("chev", 14))], [
    { heading: "Servers" },
    ...state.guilds.map((g) => ({ label: g.name, lead: guildIcon(g), checked: g.id === state.guild,
      small: g.stats.open ? null : "all clear", trail: g.stats.open ? h("span", { class: "gcount" }, String(g.stats.open)) : null,
      onpick: () => switchGuild(g.id) })),
  ], { cls: "btn guild-btn", label: "Choose a server" });
}

function renderHeader() {
  const me = state.me;
  const av = h("span", { class: "avatar accent", style: "--s:36px" }, me?.avatarUrl ? h("img", { src: me.avatarUrl, alt: "", referrerpolicy: "no-referrer" }) : initials(me?.name ?? "?"));
  const bell = h("button", { class: "btn icon ghost bell", type: "button", "aria-label": "Desktop notifications", "aria-pressed": String(state.notify), title: state.notify ? "Notifications on" : "Notifications off", onclick: toggleNotify }, icon("bell"));
  shell.head.replaceChildren(...[
    h("a", { class: "brand", href: "#", onclick: (e) => { e.preventDefault(); closeTicket(); }, "aria-label": "Support desk, back to the inbox" }, bibi("idle", 28), h("span", {}, "Support"), h("span", { class: "eyebrow" }, "Desk")),
    guildPicker(), shell.field, h("div", { class: "spacer" }),
    h("span", { class: "live" + (state.online ? "" : " off"), role: "status" }, h("span", { class: "sq" }), h("span", {}, state.online ? "LIVE" : "OFFLINE")),
    bell,
    me ? dropdown("me", av, [
      { heading: me.name },
      { label: "Sign out", lead: icon("out", 16), onpick: logout },
    ], { cls: "me-btn", right: true, label: `Account menu, ${me.name}` }) : null].filter(Boolean));
}

async function logout() { await post("/logout").catch(() => {}); state.me = null; renderLogin(); }

async function toggleNotify() {
  if (!("Notification" in window)) return toast("This browser does not support notifications.");
  if (!state.notify && Notification.permission === "denied") return toast("Notifications are blocked. Allow them in your browser's site settings, then try again.");
  if (!state.notify) {
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (p !== "granted") return toast("Notifications are blocked in your browser settings.");
  }
  state.notify = !state.notify;
  store.set("notify", state.notify ? "1" : "0");
  toast(state.notify ? "You will be notified when a customer writes." : "Notifications are off.", true);
  renderHeader();
}

function renderSide() {
  const nav = (on, onclick, lead, label, n, extra = {}) =>
    h("button", { class: "nav" + (on ? " on" : ""), type: "button", "aria-current": on ? "page" : null, onclick, ...extra }, lead, h("span", { class: "truncate" }, label), n == null ? null : h("b", {}, String(n)));
  const tags = tagList();
  // replaceChildren turns null into the text "null", so optional sections are filtered out.
  shell.side.replaceChildren(...[
    h("div", { class: "navgroup" }, h("div", { class: "eyebrow" }, "Views"),
      VIEWS.map(([key, label, c]) => nav(!state.query && state.view === key && !state.tag, () => setView(key), h("span", { class: "sq", style: c ? `--c:${c}` : "" }), label, viewCount(key)))),
    h("div", { class: "navgroup" }, h("div", { class: "eyebrow" }, "Reports"),
      nav(state.view === "metrics" && !state.query, () => setView("metrics"), h("span", { class: "sq", style: "--c:var(--accent-ink)" }), "Metrics")),
    tags.length ? h("div", { class: "navgroup" }, h("div", { class: "eyebrow" }, "Tags"),
      tags.map((g) => nav(state.tag === g.name, () => { state.tag = state.tag === g.name ? "" : g.name; if (state.tag) state.view = "open"; state.animate = true; render(); }, h("span", { class: "hash", "aria-hidden": "true" }, "#"), g.name, g.count))) : null,
    state.tipOff ? null : h("aside", { class: "panel tipcard", "aria-label": "Tip" },
      h("div", { class: "tiphead" }, bibi("idle", 32, true), h("span", { class: "eyebrow", style: "color:var(--accent-ink)" }, "BIBI_")),
      h("p", {}, "Drop a screenshot on a ticket, or paste it, to attach it to your reply. Press ", h("span", { class: "kbd" }, "/"), " to search."),
      h("button", { class: "btn sm ghost", type: "button", style: "align-self:flex-start", onclick: () => { state.tipOff = true; store.set("tip", "off"); renderSide(); } }, "Got it"))].filter(Boolean));
}

function setView(key) {
  state.view = key; state.tag = ""; state.query = ""; state.hits = null; shell.input.value = "";
  state.fPriority = state.fAssignee = state.fLang = ""; state.sort = null;
  state.animate = true;
  if (state.selected) { closeTicket(); return; }
  render();
}

/* ---------- Inbox ---------- */
const lang = (t) => (t.locale ?? "").toUpperCase();
const fmtTarget = (ms) => ms >= 3_600_000 ? `${+(ms / 3_600_000).toFixed(1)} h` : `${Math.round(ms / 60_000)} min`;

function kpiTile(label, value, sub, { late = false, key } = {}) {
  const n = h("span", { class: "n" + (late ? " late" : "") }, value);
  if (key && lastKpi[key] !== undefined && lastKpi[key] !== value) n.classList.add("tick");
  if (key) lastKpi[key] = value;
  return h("div", { class: "panel kpi" + (state.intro ? " rise" : ""), style: `--i:${key === "wait" ? 1 : key === "old" ? 2 : key === "third" ? 3 : 4}` }, h("span", { class: "eyebrow" }, label), n, h("span", { class: "small" }, sub));
}

function renderKpis() {
  const tg = targets();
  const waiting = state.tickets.filter(VIEW_TEST["waiting-us"]);
  const now = Date.now();
  const late = waiting.filter((t) => now - since(t) > tg.replyMs).length;
  const oldest = waiting.reduce((a, t) => (!a || since(t) < since(a) ? t : a), null);
  const m = state.metrics;
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const resolved = m?.resolvedToday ?? state.tickets.filter((t) => t.status === "closed" && (t.closedAt ?? t.updatedAt) >= day.getTime()).length;
  const third = m?.firstReplyMedianMs != null
    ? kpiTile("First reply (median)", dur(m.firstReplyMedianMs), `Last 7 days · target ${fmtTarget(tg.firstReplyMs)}`, { key: "third" })
    : kpiTile("In progress", String(state.stats.in_progress), "A teammate replied, not closed yet", { key: "third" });
  return h("div", { class: "kpis" },
    kpiTile("Waiting on us", String(waiting.length), late ? `${late} past the ${fmtTarget(tg.replyMs)} target` : `All within the ${fmtTarget(tg.replyMs)} target`, { key: "wait" }),
    kpiTile("Oldest waiting", oldest ? dur(now - since(oldest)) : "None", oldest ? `${oldest.userName} · ${oldest.subject}` : "Nobody is waiting", { late: !!oldest && now - since(oldest) > tg.replyMs, key: "old" }),
    third,
    kpiTile("Resolved today", String(resolved), m?.satisfactionAvg != null ? `Satisfaction ${m.satisfactionAvg.toFixed(1)} / 5` : `${state.stats.closed} closed in total`, { key: "res" }));
}

function filterBar(list) {
  const tickets = state.tickets;
  const chips = [];
  // key = state key; "tag" is shared with the sidebar.
  const chip = (key, label, shown, items) => dropdown("f-" + key, [state[key] ? `${label}: ${shown}` : label, h("span", { class: "chev" }, icon("chev", 14))],
    [{ label: "Any", checked: !state[key], onpick: () => { state[key] = ""; state.animate = true; render(); } },
      ...items.map(([v, l, c]) => ({ label: l, checked: state[key] === v, lead: c ? h("span", { class: "sq", style: `--c:${c}` }) : null, onpick: () => { state[key] = v; state.animate = true; render(); } }))],
    { cls: "chip" + (state[key] ? " set" : ""), label });
  chips.push(chip("fPriority", "Priority", PRIORITIES.find((p) => p[0] === state.fPriority)?.[1], PRIORITIES));
  const tg = tagList();
  if (tg.length) chips.push(chip("tag", "Tag", "#" + state.tag, tg.map((g) => [g.name, "# " + g.name])));
  const names = [...new Set(tickets.map((t) => t.assignee).filter(Boolean))].sort();
  chips.push(chip("fAssignee", "Assignee", state.fAssignee === "me" ? "Me" : state.fAssignee === "none" ? "Unassigned" : state.fAssignee,
    [["me", "Assigned to me"], ["none", "Unassigned"], ...names.map((n) => [n, n])]));
  const langs = [...new Set(tickets.map((t) => t.locale).filter(Boolean))].sort();
  if (langs.length > 1) chips.push(chip("fLang", "Language", state.fLang.toUpperCase(), langs.map((l) => [l, l.toUpperCase()])));
  const any = state.tag || state.fPriority || state.fAssignee || state.fLang;
  return h("div", { class: "filters", role: "group", "aria-label": "Filters" }, chips, any ? h("button", { class: "clear", type: "button", onclick: () => { state.tag = state.fPriority = state.fAssignee = state.fLang = ""; render(); } }, "Clear filters") : null,
    h("span", { class: "small count", "aria-live": "polite" }, `${list.length} ticket${list.length === 1 ? "" : "s"}`));
}

function timerFor(t) {
  const target = targets().replyMs;
  if (!isOpen(t)) return h("span", { class: "timer calm" }, ago(t.closedAt ?? t.updatedAt));
  const ms = Date.now() - since(t);
  const waitingUs = t.awaiting === "support";
  return h("span", { class: "timer" + (waitingUs ? (ms > target ? " late" : "") : " calm"), "data-since": since(t), "data-target": waitingUs ? target : "" }, dur(ms));
}

function waitLabel(t) {
  if (!isOpen(t)) return h("span", { class: "wait", style: "--c:var(--faint)" }, h("span", { class: "sq" }), "Closed");
  return t.awaiting === "support"
    ? h("span", { class: "wait", style: "--c:var(--accent-ink)" }, h("span", { class: "sq" }), "Waiting on us")
    : h("span", { class: "wait", style: "--c:var(--amber)" }, h("span", { class: "sq" }), "Waiting on customer");
}

function row(t, i) {
  const pr = t.priority && t.priority !== "normal" ? PRIORITIES.find((p) => p[0] === t.priority) : null;
  const prev = plain(t.lastMessage?.content ?? t.description ?? "").replace(/\s+/g, " ");
  const extras = [lang(t) ? h("span", { class: "mono" }, lang(t)) : null, t.attachmentCount ? `${t.attachmentCount} file${t.attachmentCount === 1 ? "" : "s"}` : null].filter(Boolean);
  return h("a", { class: "row" + (state.changed.has(t.id) ? " flash" : "") + (state.animate ? " rise" : ""), href: "#/t/" + t.id, style: `--i:${Math.min(i, 8)}` },
    h("span", { class: "avatar", style: "--s:40px", "aria-hidden": "true" }, initials(t.userName)),
    h("div", { class: "main" },
      h("div", { class: "line" }, h("span", { class: "subj" }, t.subject), (t.tags ?? []).slice(0, 3).map((g) => h("span", { class: "tag" }, "# " + g)),
        pr && t.priority !== "low" ? h("span", { class: "badge " + (t.priority === "urgent" ? "danger" : "amber") }, pr[1]) : pr ? h("span", { class: "badge" }, pr[1]) : null),
      prev ? h("div", { class: "prev truncate" }, prev) : null,
      h("div", { class: "meta" }, `#${t.id} · ${t.userName}`, extras.flatMap((x) => [" · ", x]))),
    h("div", { class: "when" }, timerFor(t), waitLabel(t)),
    h("span", { class: "avatar asg" + (t.assignee ? " accent" : " none"), style: "--s:28px;font-size:11px", title: t.assignee ? `Assigned to ${t.assignee}` : "Unassigned" }, t.assignee ? initials(t.assignee) : "?"));
}

function emptyMessage(list) {
  if (!state.tickets.length) return ["No tickets yet", "Everything is quiet."];
  if (state.query.trim() || state.tag || state.fPriority || state.fAssignee || state.fLang) return ["No match", "Nothing fits this search or these filters."];
  if (state.view === "waiting-us") return ["All caught up", "Nobody is waiting on us."];
  return ["Nothing here", "No ticket in this view."];
}

function exportCsv(list) {
  const q = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = [["id", "subject", "customer", "status", "awaiting", "priority", "assignee", "tags", "created", "updated"],
    ...list.map((t) => [t.id, t.subject, t.userName, t.status, t.awaiting, t.priority ?? "", t.assignee ?? "", (t.tags ?? []).join(" "), new Date(t.createdAt).toISOString(), new Date(t.updatedAt).toISOString()])];
  const a = h("a", { href: URL.createObjectURL(new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" })), download: `tickets-${state.view}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderInbox() {
  const list = visible();
  const searching = !!state.query.trim();
  const order = state.sort ?? (state.view === "waiting-us" ? "oldest" : "newest");
  let body;
  if (state.loading) body = [1, 2, 3, 4].map(() => h("div", { class: "skel" }));
  else if (list.length) body = list.map(row);
  else { const [a, b] = emptyMessage(list); body = [h("div", { class: "empty" }, bibi("empty", 44), h("div", {}, h("b", {}, a), h("div", {}, b)))]; }
  return h("main", { class: "inbox", id: "content" },
    h("div", { class: "head" + (state.intro ? " rise" : "") },
      h("div", { class: "t" }, h("span", { class: "eyebrow", style: "color:var(--accent-ink)" }, searching ? "Search" : "Inbox"), h("h1", { class: "display" }, searching ? `Results for “${state.query.trim()}”` : state.tag ? `# ${state.tag}` : viewLabel(state.view))),
      h("div", { class: "tools" },
        dropdown("sort", [SORTS.find((s) => s[0] === order)[1], h("span", { class: "chev" }, icon("chev", 14))], SORTS.map(([k, l]) => ({ label: l, checked: order === k, onpick: () => { state.sort = k; state.animate = true; render(); } })), { cls: "chip", label: "Sort tickets", right: true }),
        h("button", { class: "btn ghost", type: "button", disabled: !list.length, onclick: () => exportCsv(list) }, "Export CSV"))),
    renderKpis(),
    filterBar(list),
    h("section", { class: "panel list", "aria-label": "Tickets", "aria-busy": String(state.loading) }, body));
}

/* ---------- Message text: clickable links, inline images (DOM only, never innerHTML) ---------- */
const TOKEN_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"']+/g;
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
function isImage(url) {
  try { const u = new URL(url); return IMG_EXT.test(u.pathname) || (u.hostname === "media.discordapp.net" && u.pathname.startsWith("/attachments/")); }
  catch { return false; }
}
const stickBottom = (img) => img.addEventListener("load", () => { const m = img.closest(".msgs"); if (m?.dataset.stick) m.scrollTop = m.scrollHeight; });
function imageLink(url, img, cap) {
  const a = h("a", { class: "att", href: url, target: "_blank", rel: "noopener noreferrer", title: "Open the image" }, img, cap);
  // Plain click opens the panel viewer. Ctrl/Cmd/middle click keep opening a tab.
  a.addEventListener("click", (e) => { if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return; e.preventDefault(); openLightbox(url); });
  img.addEventListener("error", () => { a.classList.add("broken"); a.removeAttribute("href"); a.replaceChildren("Image unavailable" + (cap ? "" : " (link expired)")); });
  stickBottom(img);
  return a;
}
function renderText(text) {
  const out = [], imgs = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    out.push(text.slice(last, m.index));
    if (m[2]) {
      last = m.index + m[0].length;
      out.push(h("a", { href: m[2], target: "_blank", rel: "noopener noreferrer" }, m[1]));
      continue;
    }
    const url = m[0].replace(/[).,;!?]+$/, "");
    last = m.index + url.length;
    if (isImage(url)) imgs.push(imageLink(url, h("img", { src: url, alt: "Attached image", loading: "lazy", referrerpolicy: "no-referrer" })));
    else out.push(h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url));
  }
  out.push(text.slice(last));
  const rest = out.filter((x) => x !== "");
  const hasText = rest.some((x) => typeof x !== "string" || x.trim());
  return { text: hasText ? rest : [], imgs };
}
const extBadge = (name, big) => h("span", { class: "badge", style: big ? "" : "padding:3px 5px" }, (extOf(name) || "file").slice(0, 4));
function attachmentEl(a) {
  if (a.kind === "image") return imageLink(a.url, h("img", { src: a.url, alt: a.name, loading: "lazy" }), h("span", { class: "cap", style: "font:500 12px var(--mono)" }, `${a.name} · ${bytes(a.size)}`));
  return h("div", { class: "dl" }, extBadge(a.name, true),
    h("span", { class: "nm" }, h("b", { class: "truncate" }, a.name), h("span", { class: "small" }, bytes(a.size))),
    h("a", { class: "btn sm ghost", href: a.url, download: a.name }, icon("download", 14), "Download"));
}

/* ---------- Viewer (mounted on <body>, untouched when the panel re-renders) ---------- */
let lb = null;
function openLightbox(url) {
  closeLightbox(true);
  const urls = [...document.querySelectorAll(".msgs .att[href], .aside .thumb[data-img]")].map((a) => a.href || a.dataset.img);
  const list = [...new Set(urls.map((u) => new URL(u, location.href).href))];
  const abs = new URL(url, location.href).href;
  if (!list.includes(abs)) list.push(abs);
  let i = list.indexOf(abs);
  const opener = document.activeElement;
  const img = h("img", { class: "lb-img", alt: "Attached image, enlarged" });
  const count = h("span", { class: "lb-count" });
  const orig = h("a", { class: "btn ghost", target: "_blank", rel: "noopener noreferrer" }, "Open original");
  const nav = (cls, label, d, ic) => h("button", { class: "lb-nav " + cls, type: "button", "aria-label": label, onclick: (e) => { e.stopPropagation(); go(d); } }, ic);
  const close = h("button", { class: "btn ghost", type: "button", onclick: (e) => { e.stopPropagation(); closeLightbox(); } }, "Close");
  const el = h("div", { class: "lb", role: "dialog", "aria-modal": "true", "aria-label": "Image viewer", onclick: () => closeLightbox() },
    h("div", { class: "lb-bar", onclick: (e) => e.stopPropagation() }, count, h("div", { class: "spacer" }), orig, close),
    list.length > 1 ? [nav("prev", "Previous image", -1, icon("back", 20)), nav("next", "Next image", 1, h("span", { style: "display:grid;transform:scaleX(-1)" }, icon("back", 20)))] : null, img);
  img.addEventListener("click", (e) => e.stopPropagation());
  const show = () => { img.classList.remove("in"); void img.offsetWidth; img.classList.add("in"); img.src = list[i]; orig.href = list[i]; count.textContent = list.length > 1 ? `${i + 1} / ${list.length}` : ""; };
  const go = (d) => { i = (i + d + list.length) % list.length; show(); };
  lb = { el, opener, go, many: list.length > 1 };
  document.body.append(el);
  document.body.style.overflow = "hidden";
  show(); close.focus();
}
function closeLightbox(silent = false) {
  if (!lb) return;
  lb.el.remove(); document.body.style.overflow = "";
  if (!silent && lb.opener?.isConnected) lb.opener.focus();
  lb = null;
}

/* ---------- Conversation ---------- */
function avatarFor(name, accent, size = 36) {
  const mine = accent && state.me?.avatarUrl && state.me.name === name;
  return h("span", { class: "avatar" + (accent ? " accent" : ""), style: `--s:${size}px`, "aria-hidden": "true" }, mine ? h("img", { src: state.me.avatarUrl, alt: "", referrerpolicy: "no-referrer" }) : initials(name));
}

function messageEl(m, t, fresh) {
  const f = fresh ? " fresh" : "";
  const text = plain(m.content);
  if (m.source === "system") return h("div", { class: "sys" + f }, h("span", { class: "sq", style: `--c:${STATUS[t.status].color}` }), text, h("span", { class: "mono" }, clock(m.createdAt)));
  const { text: nodes, imgs } = renderText(text);
  const atts = (m.attachments ?? []);
  const bubble = h("div", { class: "bubble" },
    nodes.length ? h("div", { class: "txt" }, nodes) : null,
    imgs.length || atts.length ? h("div", { class: "atts" }, imgs, atts.map(attachmentEl)) : null);
  if (m.internal) {
    return h("div", { class: "m staff note" + f }, h("div", { class: "col" },
      h("div", { class: "who" }, h("b", {}, m.authorName), h("span", { class: "badge amber", style: "padding:3px 6px" }, "Internal note"), h("span", { class: "mono" }, clock(m.createdAt))), bubble), avatarFor(m.authorName, false));
  }
  if (m.source === "panel") {
    return h("div", { class: "m staff" + f }, h("div", { class: "col" },
      h("div", { class: "who" }, h("b", {}, m.authorName), h("span", { class: "mono" }, clock(m.createdAt)), h("span", { class: "ok" }, icon("check", 12), "Delivered to Discord")), bubble), avatarFor(m.authorName, true));
  }
  return h("div", { class: "m" + f }, avatarFor(m.authorName, false), h("div", { class: "col" },
    h("div", { class: "who" }, h("b", {}, m.authorName), lang(t) ? h("span", { class: "mono" }, lang(t)) : null, h("span", { class: "mono" }, clock(m.createdAt))), bubble));
}

const caps = () => ({ notes: true, replies: true });

function getComposer(d) {
  let c = composers.get(d.ticket.id);
  if (!c) {
    c = createComposer({
      ticket: d.ticket, me: state.me, caps: caps(),
      getReplies: async () => state.replies ?? [], manageReplies: () => manageReplies(),
      onSent: (_res, mode) => { if (mode === "note") toast("Note added.", true); const m = document.querySelector(".msgs"); if (m) m.dataset.stick = "1"; refresh(true); },
    });
    composers.set(d.ticket.id, c);
  } else c.update({ ticket: d.ticket, me: state.me, caps: caps() });
  return c;
}

const act = (label, path, cls, run) => {
  const b = h("button", { class: "btn " + cls, type: "button", onclick: async () => {
    if (!(await run?.())) return;
    b.classList.add("busy");
    try { await post(`/tickets/${state.selected}/${path}`); await refresh(true); } catch (e) { if (e.message !== "auth") toast(e.message); }
    b.classList.remove("busy");
  } }, label);
  return b;
};

async function closeFlow(t) {
  const r = await modal((done) => {
    const msg = h("textarea", { id: "cl-msg", rows: "3", placeholder: "Leave empty to send the default closing message." });
    const rating = h("input", { type: "checkbox", id: "cl-rate" }), tr = h("input", { type: "checkbox", id: "cl-tr" });
    return h("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Close ticket", onsubmit: (e) => {
      e.preventDefault();
      done({ reason: new FormData(e.target).get("reason"), message: msg.value.trim() || undefined, askRating: rating.checked, sendTranscript: tr.checked });
    } },
      h("h3", {}, `Close ticket #${t.id}?`), h("p", {}, `${t.userName} will not be able to write in the channel anymore.`),
      h("div", { class: "fld" }, h("span", { class: "lab" }, "Reason"),
        h("div", { class: "checks", role: "radiogroup" }, REASONS.map(([v, l], i) => h("label", { class: "check" }, h("input", { type: "radio", name: "reason", value: v, checked: i === 0 }), l)))),
      h("div", { class: "fld" }, h("label", { for: "cl-msg" }, "Closing message"), msg),
      h("div", { class: "checks" }, h("label", { class: "check", for: "cl-rate" }, rating, "Ask the customer for a rating"), h("label", { class: "check", for: "cl-tr" }, tr, "Post a transcript in the channel")),
      h("div", { class: "actions" }, h("button", { class: "btn ghost", type: "button", onclick: () => done(null) }, "Cancel"), h("button", { class: "btn danger", type: "submit", "data-autofocus": "" }, "Close ticket")));
  });
  if (!r) return;
  try { await post(`/tickets/${t.id}/close`, r); await refresh(true); } catch (e) { if (e.message !== "auth") toast(e.message); }
}

async function setAssignee(t, assignee) { await mutate(`/tickets/${t.id}/assign`, { assignee }); }
async function mutate(path, body) {
  try { await post(path, body); await refresh(true); } catch (e) { if (e.message !== "auth") toast(e.message); }
}

async function tagDialog(t) {
  const name = await modal((done) => {
    const input = h("input", { id: "tg", type: "text", maxlength: "24", autocomplete: "off", "data-autofocus": "", class: "mono", style: "font-size:13px" });
    const err = h("div", { class: "err", role: "alert", style: "min-height:0" });
    return h("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Add a tag", onsubmit: (e) => {
      e.preventDefault();
      const v = input.value.trim().toLowerCase().replace(/^#/, "");
      if (!/^[a-z0-9-]{1,24}$/.test(v)) { err.textContent = "Use 1 to 24 letters, digits or dashes."; return; }
      done(v);
    } }, h("h3", {}, "Add a tag"), h("div", { class: "fld" }, h("label", { for: "tg" }, "Tag"), input, h("span", { class: "help" }, "Lowercase letters, digits and dashes. Up to 8 tags per ticket.")), err,
      h("div", { class: "actions" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => done(null) }, "Cancel"), h("button", { class: "btn hero sm", type: "submit" }, "Add tag")));
  });
  if (name && !t.tags.includes(name)) await mutate(`/tickets/${t.id}/tags`, { tags: [...t.tags, name] });
}

/* Assignment and priority controls. */
function assigneeControl(t, cls) {
  const me = state.me?.name;
  const others = [...new Set(state.tickets.map((x) => x.assignee).filter((n) => n && n !== me))].sort();
  return dropdown("assign", [avatarFor(t.assignee ?? "?", !!t.assignee, 20), t.assignee ?? "Unassigned", h("span", { class: "chev" }, icon("chev", 12))], [
    { heading: "Assignee" },
    ...(me ? [{ label: `Assign to me (${me})`, checked: t.assignee === me, onpick: () => setAssignee(t, me) }] : []),
    ...others.map((n) => ({ label: n, checked: t.assignee === n, onpick: () => setAssignee(t, n) })),
    { label: "Unassigned", checked: !t.assignee, onpick: () => setAssignee(t, null) },
  ], { cls: "sel " + cls, label: "Assignee" });
}
function priorityControl(t, cls) {
  const p = PRIORITIES.find((x) => x[0] === t.priority) ?? PRIORITIES[2];
  return dropdown("prio", [h("span", { class: "sq", style: `--c:${p[2]}` }), p[1], h("span", { class: "chev" }, icon("chev", 12))],
    [{ heading: "Priority" }, ...PRIORITIES.map(([v, l, c]) => ({ label: l, lead: h("span", { class: "sq", style: `--c:${c}` }), checked: t.priority === v, onpick: () => mutate(`/tickets/${t.id}/priority`, { priority: v }) }))],
    { cls: "sel " + cls, label: "Priority" });
}

const ACTIONS = {
  assign: "Assigned", priority: "Priority changed", tags: "Tags changed", close: "Closed", reopen: "Reopened",
  delete: "Channel deleted", note: "Note added", reply: "Reply sent", rating: "Rated",
};
function activitySection() {
  const entries = [...state.audit].sort((a, b) => b.at - a.at);
  if (!entries.length) return null;
  const shown = state.auditAll ? entries : entries.slice(0, 6);
  return h("div", { class: "sec" }, h("div", { class: "eyebrow" }, `Activity · ${entries.length}`),
    h("ol", { class: "audit", "aria-label": "Activity log" }, shown.map((e) =>
      h("li", {}, h("span", { class: "sq", "aria-hidden": "true" }),
        h("div", { class: "what" }, h("b", {}, ACTIONS[e.action] ?? e.action.replaceAll("_", " ")), e.detail ? h("span", { class: "truncate" }, plain(e.detail)) : null),
        h("span", { class: "small mono", title: new Date(e.at).toLocaleString("en-GB") }, `${e.actor} · ${ago(e.at)}`)))),
    entries.length > 6 ? h("button", { class: "btn sm ghost", type: "button", style: "align-self:flex-start", onclick: () => { state.auditAll = !state.auditAll; renderContent(); } }, state.auditAll ? "Show less" : `Show all ${entries.length}`) : null);
}

/* Saved replies manager: list, add or update (upsert by name), delete. */
async function manageReplies() {
  const reload = async () => { repliesFor = null; await loadReplies(); };
  await modal((done) => {
    const list = h("div", { class: "checks" });
    const name = h("input", { id: "sr-name", type: "text", maxlength: "32", autocomplete: "off", class: "mono", style: "font-size:13px", placeholder: "refund-policy", "data-autofocus": "" });
    const text = h("textarea", { id: "sr-text", rows: "3", placeholder: "Hi {customer}, ..." });
    const err = h("div", { class: "err", role: "alert", style: "min-height:0" });
    const draw = () => list.replaceChildren(...((state.replies ?? []).length ? state.replies.map((r) =>
      h("div", { class: "kv", style: "align-items:flex-start;gap:12px" },
        h("div", { style: "min-width:0;display:flex;flex-direction:column;gap:2px" }, h("span", { class: "cmd mono" }, "/" + r.name), h("span", { class: "small", style: "white-space:pre-wrap" }, r.text)),
        h("span", { style: "display:flex;gap:6px;flex:none" },
          h("button", { class: "btn sm ghost", type: "button", "aria-label": `Edit ${r.name}`, onclick: () => { name.value = r.name; text.value = r.text; text.focus(); } }, "Edit"),
          h("button", { class: "btn sm caution", type: "button", "aria-label": `Delete ${r.name}`, onclick: async () => {
            try { await api("/replies/" + r.id, { method: "DELETE" }); await reload(); draw(); } catch (e) { if (e.message !== "auth") err.textContent = e.message; }
          } }, "Delete"))))
      : [h("p", { class: "small" }, "No saved replies yet.")]));
    draw();
    return h("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Saved replies", style: "width:min(560px,92vw)", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      const n = name.value.trim().toLowerCase().replace(/^\//, "");
      if (!/^[a-z0-9-]{1,32}$/.test(n)) { err.textContent = "Name: 1 to 32 letters, digits or dashes."; return; }
      if (!text.value.trim()) { err.textContent = "Write the reply text."; return; }
      try { await post("/replies", { guild: state.guild, name: n, text: text.value.trim() }); await reload(); name.value = ""; text.value = ""; draw(); toast("Saved reply stored.", true); }
      catch (x) { if (x.message !== "auth") err.textContent = x.message; }
    } },
      h("h3", {}, "Saved replies"), h("p", {}, "Type / in a reply to insert one. {customer} becomes the customer's name."), list,
      h("div", { class: "fld" }, h("label", { for: "sr-name" }, "Name"), name),
      h("div", { class: "fld" }, h("label", { for: "sr-text" }, "Text"), text), err,
      h("div", { class: "actions" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => done(null) }, "Done"), h("button", { class: "btn hero sm", type: "submit" }, "Save reply")));
  });
}

/* ---------- Metrics view ---------- */
function targetBar(label, value, target) {
  const pct = value == null ? 0 : Math.min(100, Math.round((value / target) * 100));
  return h("div", { class: "panel mbar" },
    h("div", { class: "kv" }, h("span", {}, label), h("span", { class: "mono", style: "font-weight:700" }, value == null ? "No data" : dur(value))),
    h("div", { class: "pixel-bar", role: "img", "aria-label": value == null ? `${label}: no data` : `${label}: ${dur(value)} of ${fmtTarget(target)} allowed` }, h("i", { style: `width:${pct}%` })),
    h("span", { class: "small" }, `Target ${fmtTarget(target)}${value == null ? "" : value <= target ? " · met" : " · missed"}`));
}

function renderMetrics() {
  const m = state.metrics;
  const d = state.metricsDays;
  const days = dropdown("days", [`Last ${d} days`, h("span", { class: "chev" }, icon("chev", 14))],
    [7, 30, 90].map((n) => ({ label: `Last ${n} days`, checked: d === n, onpick: () => { state.metricsDays = n; state.metrics = null; loadMetrics(true).then(render); render(); } })), { cls: "chip", label: "Period", right: true });
  let body;
  if (!m) body = [h("div", { class: "kpis" }, [1, 2, 3, 4].map(() => h("div", { class: "skel" })))];
  else {
    const tg = m.targets ?? DEFAULT_TARGETS;
    const o = m.oldestWaiting;
    body = [
      h("div", { class: "kpis" },
        kpiTile("Waiting now", String(m.waitingNow), "Customers waiting on us", { key: "m-wait" }),
        kpiTile("Oldest waiting", o ? dur(o.ms) : "None", o ? `${o.userName} · ${o.subject}` : "Nobody is waiting", { late: !!o && o.ms > tg.replyMs, key: "m-old" }),
        kpiTile("Resolved today", String(m.resolvedToday), "Tickets closed since midnight", { key: "m-res" }),
        kpiTile("Satisfaction", m.satisfactionAvg != null ? `${m.satisfactionAvg.toFixed(1)} / 5` : "No ratings", `${m.satisfactionCount} rating${m.satisfactionCount === 1 ? "" : "s"} · last ${d} days`, { key: "m-sat" })),
      h("div", { class: "mgrid" },
        targetBar(`First reply, median (${d} days)`, m.firstReplyMedianMs, tg.firstReplyMs),
        h("div", { class: "panel mbar" },
          h("div", { class: "kv" }, h("span", {}, `Time to resolution, median (${d} days)`), h("span", { class: "mono", style: "font-weight:700" }, m.resolutionMedianMs == null ? "No data" : dur(m.resolutionMedianMs))),
          h("span", { class: "small" }, "From the ticket opening to its closing.")),
        o ? h("a", { class: "panel mbar link", href: "#/t/" + o.ticketId },
          h("span", { class: "eyebrow" }, "Longest wait"), h("span", { style: "font-weight:600" }, `#${o.ticketId} ${o.subject}`), h("span", { class: "small" }, `${o.userName} has waited ${dur(o.ms)}. Open the ticket.`)) : null)];
  }
  return h("main", { class: "inbox", id: "content" },
    h("div", { class: "head" + (state.intro ? " rise" : "") },
      h("div", { class: "t" }, h("span", { class: "eyebrow", style: "color:var(--accent-ink)" }, "Reports"), h("h1", { class: "display" }, "Metrics")),
      h("div", { class: "tools" }, days)),
    body);
}

/** Under 1100 px the side panel is a sheet: customer, details, response times, attachments, activity, previous tickets. */
function openSheet(d) {
  return modal((done) => h("div", { class: "dialog sheet", role: "dialog", "aria-modal": "true", "aria-label": "Ticket details" },
    h("div", { class: "sheet-head" }, h("h3", {}, `Ticket #${d.ticket.id} details`), h("button", { class: "btn icon ghost", type: "button", "aria-label": "Close details", "data-autofocus": "", onclick: () => done(null) }, icon("x", 16))),
    renderAside(d, { sheet: true, done })));
}

function renderAside(d, { sheet = false, done } = {}) {
  const t = d.ticket, s = STATUS[t.status], tg = targets(), now = Date.now();
  const mineTickets = state.tickets.filter((x) => x.userId === t.userId);
  const others = mineTickets.filter((x) => x.id !== t.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  const atts = d.messages.flatMap((m) => m.attachments ?? []);
  const sections = [];
  sections.push(h("div", { class: "sec" },
    h("div", { style: "display:flex;gap:14px;align-items:center" }, avatarFor(t.userName, false, 48),
      h("div", { style: "display:flex;flex-direction:column;gap:2px;min-width:0" }, h("span", { style: "font-weight:600;font-size:17px", class: "truncate" }, t.userName), h("span", { class: "small" }, `Discord · opened ${ago(t.createdAt)}`))),
    lang(t) ? h("div", { class: "kv" }, h("span", {}, "Language"), h("span", { class: "v" }, h("span", { class: "badge" }, lang(t)))) : null,
    h("div", { class: "kv" }, h("span", {}, "Tickets"), h("span", { class: "mono" }, `${mineTickets.length} · ${mineTickets.filter((x) => x.status === "closed").length} resolved`))));
  const det = [
    h("div", { class: "eyebrow" }, "Details"),
    h("div", { class: "kv" }, h("span", {}, "Status"), h("span", { class: "v" }, h("span", { class: "sq", style: `--c:${s.color}` }), s.label)),
    h("div", { class: "kv" }, h("span", {}, "Assignee"), h("span", { class: "v" }, t.assignee ?? "Unassigned")),
  ];
  // Assignee and priority are changed from the buttons in the ticket header, which stay visible at every width; here they are read-only.
  det.push(h("div", { class: "kv" }, h("span", {}, "Priority"), h("span", { class: "v" }, PRIORITIES.find((p) => p[0] === t.priority)?.[1] ?? "Normal")));
  det.push(h("div", { class: "kv", style: "align-items:flex-start" }, h("span", {}, "Tags"), h("span", { class: "v" },
    t.tags.map((g) => h("span", { class: "badge" }, "# " + g, sheet ? null : h("button", { type: "button", "aria-label": `Remove tag ${g}`, style: "background:none;border:0;padding:0;margin-left:2px;display:grid;color:var(--muted)", onclick: () => mutate(`/tickets/${t.id}/tags`, { tags: t.tags.filter((x) => x !== g) }) }, icon("x", 12)))),
    t.tags.length < 8 && !sheet ? h("button", { class: "btn sm ghost", type: "button", "aria-label": "Add a tag", style: "height:24px;padding:0 8px", onclick: () => tagDialog(t) }, icon("plus", 12)) : null)));
  if (t.closeReason) det.push(h("div", { class: "kv" }, h("span", {}, "Closed as"), h("span", { class: "v" }, REASONS.find((r) => r[0] === t.closeReason)?.[1] ?? t.closeReason)));
  if (t.rating) det.push(h("div", { class: "kv" }, h("span", {}, "Rating"), h("span", { class: "v mono" }, `${t.rating} / 5`)));
  det.push(h("div", { class: "kv" }, h("span", {}, "Server"), h("span", { class: "v" }, state.guilds.find((g) => g.id === t.guildId)?.name ?? "")));
  sections.push(h("div", { class: "sec" }, det));
  {
    const first = t.firstResponseAt ? t.firstResponseAt - t.createdAt : null;
    const pct = first == null ? 0 : Math.min(100, Math.round((first / tg.firstReplyMs) * 100));
    const left = t.awaiting === "support" && isOpen(t) ? tg.replyMs - (now - since(t)) : null;
    sections.push(h("div", { class: "sec" }, h("div", { class: "eyebrow" }, "Response times"),
      h("div", { style: "display:flex;flex-direction:column;gap:8px" },
        h("div", { class: "kv" }, h("span", {}, "First reply"), h("span", { class: "mono", style: "font-weight:700" }, first == null ? "Waiting" : dur(first))),
        h("div", { class: "pixel-bar", role: "img", "aria-label": first == null ? "No reply yet" : `First reply took ${dur(first)} of ${fmtTarget(tg.firstReplyMs)} allowed` }, h("i", { style: `width:${pct}%` })),
        h("span", { class: "small" }, `Target ${fmtTarget(tg.firstReplyMs)}${first == null ? "" : first <= tg.firstReplyMs ? " · met" : " · missed"}`)),
      h("div", { class: "kv" }, h("span", {}, "Open for"), h("span", { class: "mono", style: "font-weight:700" }, dur((t.closedAt ?? now) - t.createdAt))),
      left != null ? h("div", { class: "kv" }, h("span", {}, "Next reply due"), h("span", { class: "mono" + (left < 0 ? "" : ""), style: "font-weight:700" + (left < 0 ? ";color:var(--danger-ink)" : "") }, left < 0 ? `${dur(-left)} overdue` : `in ${dur(left)}`)) : null));
  }
  sections.push(activitySection());
  if (atts.length) sections.push(h("div", { class: "sec" }, h("div", { class: "eyebrow" }, `Attachments · ${atts.length}`),
    h("div", { class: "thumbs" }, atts.map((a) => a.kind === "image"
      ? h("a", { class: "thumb", href: a.url, "data-img": a.url, title: a.name, onclick: (e) => { e.preventDefault(); openLightbox(a.url); } }, h("img", { src: a.url, alt: a.name, loading: "lazy" }))
      : h("a", { class: "thumb", href: a.url, download: a.name, title: `Download ${a.name}` }, extBadge(a.name)))),
    h("span", { class: "small" }, "Stored for this ticket. They stay available after Discord's links expire.")));
  if (others.length) sections.push(h("div", { class: "sec" }, h("div", { class: "eyebrow" }, "Previous tickets"),
    others.map((o) => h("a", { class: "kv", href: "#/t/" + o.id, onclick: () => done?.() }, h("span", { class: "truncate" }, `#${o.id} ${o.subject}`), h("span", { class: "badge" }, STATUS[o.status].label)))));
  return sheet ? h("div", { class: "sheet-body" }, sections) : h("aside", { class: "aside", "aria-label": "Ticket context" }, sections);
}

function renderTicket() {
  const d = state.detail, t = d.ticket, s = STATUS[t.status];
  const c = getComposer(d);
  const lastId = d.messages.at(-1)?.id ?? 0;
  const seen = state.seen?.id === t.id ? state.seen.max : lastId;
  state.seen = { id: t.id, max: lastId };
  const msgs = h("div", { class: "msgs", role: "log", "aria-label": "Conversation", "aria-live": "polite" },
    d.messages.map((m) => messageEl(m, t, m.id > seen)));
  // Stick to the bottom of the conversation unless the agent scrolled up in the same ticket.
  const old = document.querySelector(".msgs");
  const atBottom = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 80;
  const keep = state.shown === t.id && !atBottom ? old.scrollTop : null;
  state.shown = t.id;
  if (keep === null) msgs.dataset.stick = "1";
  requestAnimationFrame(() => { msgs.scrollTop = keep ?? msgs.scrollHeight; });

  const buttons = isOpen(t)
    ? [act("Close ticket", "close", "caution", async () => { await closeFlow(t); return false; })]
    : [act("Reopen", "reopen", "hero", async () => true), act("Delete channel", "delete", "caution", () => confirmDialog("Delete the channel?", "The Discord channel is deleted for good. The history stays in the desk.", "Delete channel"))];
  const wait = isOpen(t) ? waitLabel(t) : null;
  return h("div", { class: "ticket" + (state.slide ? " slide" : "") },
    h("div", { class: "subbar" },
      h("button", { class: "btn ghost", type: "button", title: "Back to the inbox (Esc)", onclick: closeTicket }, icon("back", 16), "Inbox"),
      h("div", { class: "ttl" },
        h("div", { class: "line" }, h("span", { class: "eyebrow" }, `Ticket #${t.id}`), h("span", { class: "badge", style: `border-color:${s.color}55` }, h("span", { class: "sq", style: `--c:${s.color}` }), s.label), wait),
        h("h1", {}, t.subject)),
      h("div", { class: "acts" }, assigneeControl(t, "lg"), priorityControl(t, "lg"), h("button", { class: "btn ghost details-btn", type: "button", onclick: () => openSheet(d) }, "Details"), h("a", { class: "btn ghost", href: `/api/tickets/${t.id}/transcript`, download: `ticket-${t.id}.txt`, title: "Download the public messages as a text file" }, icon("download", 16), "Transcript"), buttons)),
    h("div", { class: "cols" }, h("section", { class: "convo", "aria-label": "Conversation" }, msgs, c.el, c.overlay), renderAside(d)));
}

/* ---------- Render ---------- */
function renderContent() {
  const typing = document.activeElement?.id === "reply" ? document.activeElement : null;
  const sel = typing ? [typing.selectionStart, typing.selectionEnd] : null;
  shell.root.dataset.mode = state.detail ? "ticket" : "inbox";
  const node = state.detail ? renderTicket() : state.view === "metrics" && !state.query.trim() ? renderMetrics() : renderInbox();
  shell.main.replaceChildren(node);
  if (typing && typing.isConnected && !typing.disabled) { typing.focus({ preventScroll: true }); typing.setSelectionRange(...sel); }
  state.slide = false;
}

const signature = () => JSON.stringify([state.tickets, state.detail, state.guilds, state.metrics, state.audit, state.online, state.replies?.length, state.loading]);

function render() {
  lastSig = signature();
  if (!shell || !shell.root.isConnected) buildShell();
  renderHeader(); renderSide(); renderContent();
  const waiting = state.tickets.filter(VIEW_TEST["waiting-us"]).length;
  document.title = (waiting ? `(${waiting}) ` : "") + "Support desk";
  state.animate = false; state.intro = false;
}

/* ---------- Sign in ---------- */
async function renderLogin(error = "") {
  shell = null; composers.clear(); closeLightbox(true);
  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({ oauth: false }));
  document.title = "Sign in · Support desk";
  if (cfg.oauth) {
    app.replaceChildren(h("div", { class: "login-wrap" }, h("div", { class: "panel login" }, bibi("welcome", 56, true),
      h("div", {}, h("div", { class: "eyebrow" }, "Support desk"), h("h1", {}, "Sign in to support")),
      h("p", { style: "color:var(--ink2)" }, "Sign in with your Discord account. Only administrators can enter."),
      h("a", { class: "btn hero", href: "/auth/login", style: "height:48px" }, "Sign in with Discord"))));
    return;
  }
  const input = h("input", { id: "pw", type: "password", placeholder: "••••••••", autocomplete: "current-password" });
  const err = h("div", { class: "err", role: "alert" }, error);
  const btn = h("button", { class: "btn hero", type: "submit" }, "Sign in");
  const form = h("form", { class: "panel login", onsubmit: async (e) => {
    e.preventDefault();
    btn.classList.add("busy");
    try { await post("/login", { password: input.value }); await start(); }
    catch (x) { err.textContent = x.message; form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); input.select(); }
    btn.classList.remove("busy");
  } }, bibi("welcome", 56, true), h("div", {}, h("div", { class: "eyebrow" }, "Support desk"), h("h1", {}, "Sign in to support")),
  h("div", { class: "fld" }, h("label", { for: "pw" }, "Password"), input), err, btn);
  app.replaceChildren(h("div", { class: "login-wrap" }, form));
  input.focus();
}

/* ---------- Navigation: a ticket is a full-screen page (#/t/12) ---------- */
const hashId = () => Number(/^#\/t\/(\d+)$/.exec(location.hash)?.[1]) || null;
function closeTicket() {
  if (!location.hash || location.hash === "#") return syncFromHash();
  location.hash = "";
}
async function syncFromHash() {
  const id = hashId();
  if (id === state.selected && (id === null || state.detail)) return;
  state.pop = null;
  if (id === null) { state.selected = null; state.detail = null; state.animate = true; render(); return; }
  state.selected = id; state.slide = true;
  try {
    const d = await api("/tickets/" + id);
    // Link to a ticket on another server: switch to it (if accessible).
    if (d.ticket.guildId !== state.guild && state.guilds.some((g) => g.id === d.ticket.guildId)) {
      state.guild = d.ticket.guildId; store.set("guild", state.guild);
      state.detail = d; await load();
    }
    state.detail = d;
  } catch (e) {
    state.selected = null; state.detail = null;
    if (e.message !== "auth") { toast(e.message); history.replaceState(null, "", location.pathname); }
    return render();
  }
  render();
  // Land in the reply box (large screens only, so the mobile keyboard stays closed).
  if (matchMedia("(min-width:901px)").matches) composers.get(id)?.focus({ preventScroll: true });
}
addEventListener("hashchange", syncFromHash);

async function switchGuild(id) {
  if (id === state.guild) return render();
  state.guild = id; store.set("guild", id);
  state.selected = null; state.detail = null; state.query = ""; shell.input.value = "";
  state.tag = state.fPriority = state.fAssignee = state.fLang = ""; state.sort = null; state.view = "waiting-us";
  if (location.hash) history.replaceState(null, "", location.pathname);
  composers.clear(); state.tickets = []; state.tags = null; state.metrics = null; state.replies = null; repliesFor = null; metricsAt = 0; metricsKey = "";
  state.loading = true; state.animate = state.intro = true;
  render();
  try { await load(); } catch (e) { if (e.message !== "auth") toast(e.message); }
  state.loading = false; state.animate = true;
  render(); connectEvents();
}

function notifyChanged() {
  if (!state.notify || !document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  for (const t of state.tickets) if (state.changed.has(t.id) && t.awaiting === "support" && isOpen(t)) {
    const n = new Notification(`#${t.id} ${t.subject}`, { body: plain(t.lastMessage?.content ?? `${t.userName} wrote.`), tag: "ticket-" + t.id });
    n.onclick = () => { window.focus(); location.hash = "#/t/" + t.id; n.close(); };
  }
}

async function refresh(force = false) {
  try {
    await load();
    state.online = true;
    notifyChanged();
    // An open menu keeps focus: defer rendering until it closes.
    if (state.pop && !force) { state.dirty = true; return; }
    if (!force && signature() === lastSig) return;
    render();
  } catch (e) {
    if (e.message === "auth") return;
    state.online = false;
    document.querySelector(".live")?.classList.add("off");
    document.querySelector(".live span:last-child") && (document.querySelector(".live span:last-child").textContent = "OFFLINE");
  }
}

/* ---------- Live updates (SSE) ---------- */
let events = null, eventsGuild = null, pending = null, slow = 0;
function connectEvents() {
  if (events && events.readyState !== 2 && eventsGuild === state.guild) return;
  events?.close(); events = null;
  if (!state.guild || typeof EventSource === "undefined") return;
  eventsGuild = state.guild;
  const es = events = new EventSource("/api/events?guild=" + encodeURIComponent(state.guild));
  es.onmessage = () => { clearTimeout(pending); pending = setTimeout(() => refresh(), 120); };
  es.onopen = () => { state.online = true; refresh(); };
  es.onerror = () => { state.online = false; renderHeader(); };
}

/* ---------- Drag and drop, paste ---------- */
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
const activeComposer = () => (state.detail ? composers.get(state.detail.ticket.id) : null);
let depth = 0;
addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); depth++;
  const c = activeComposer();
  if (c?.canDrop) c.showDrop(true);
});
addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = activeComposer()?.canDrop ? "copy" : "none"; } });
addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) activeComposer()?.showDrop(false); });
addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); depth = 0;
  const c = activeComposer();
  c?.showDrop(false);
  if (c?.canDrop) c.addFiles([...e.dataTransfer.files]);
});
document.addEventListener("paste", (e) => {
  const c = activeComposer();
  if (!c || /INPUT|TEXTAREA/.test(e.target?.tagName ?? "")) return;
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) { e.preventDefault(); c.addFiles(files); }
});

/* ---------- Keyboard ---------- */
document.addEventListener("click", () => { if (state.pop) { state.pop = null; render(); } });
document.addEventListener("keydown", (e) => {
  if (lb) {
    if (e.key === "Escape") closeLightbox();
    else if (lb.many && e.key === "ArrowRight") lb.go(1);
    else if (lb.many && e.key === "ArrowLeft") lb.go(-1);
    else if (e.key === "Tab") { e.preventDefault(); lb.el.querySelector("button, a")?.focus(); }
    return;
  }
  if (e.key === "Escape" && !document.querySelector(".scrim:not(.out)") && !state.pop && state.selected) {
    // In the reply box, the first Escape leaves the field (the draft is kept); the second returns to the list.
    if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur(); else closeTicket();
    return;
  }
  if (e.key === "Escape" && state.pop) closePop();
  const typingNow = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "") || document.activeElement?.isContentEditable;
  if (!typingNow && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector(".scrim:not(.out)") && shell) {
    if (e.key === "?") { e.preventDefault(); showShortcuts(); return; }
    if (state.detail && e.key === "c" && isOpen(state.detail.ticket)) { e.preventDefault(); closeFlow(state.detail.ticket); return; }
    if (state.detail && (e.key === "r" || e.key === "n")) { e.preventDefault(); composers.get(state.selected)?.focus(e.key === "n" ? "note" : "reply"); return; }
    if (!state.detail && (e.key === "j" || e.key === "k")) {
      const rows = [...document.querySelectorAll("a.row")];
      if (!rows.length) return;
      e.preventDefault();
      const i = rows.indexOf(document.activeElement);
      rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + (e.key === "j" ? 1 : -1)))].focus();
      return;
    }
  }
  if (e.key === "/" && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "") && !state.detail) { e.preventDefault(); shell?.input.focus(); }
});

const SHORTCUTS = [
  ["/", "Search tickets"], ["?", "Show this list"], ["j / k", "Next or previous ticket in the list"], ["Enter", "Open the focused ticket"],
  ["r", "Reply to the customer"], ["n", "Write an internal note"], ["c", "Close the ticket"], ["Ctrl + Enter", "Send the reply or note"], ["/ in a reply", "Insert a saved reply"], ["Esc", "Leave the reply box, then go back to the inbox"],
];
function showShortcuts() {
  return modal((done) => h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts" },
    h("h3", {}, "Keyboard shortcuts"),
    h("div", { class: "checks" }, SHORTCUTS.map(([k, l]) => h("div", { class: "kv" }, h("span", { class: "truncate", style: "color:var(--ink)" }, l), h("span", { class: "kbd" }, k)))),
    h("div", { class: "actions" }, h("button", { class: "btn hero sm", type: "button", "data-autofocus": "", onclick: () => done(null) }, "Done"))));
}

/* ---------- Start ---------- */
onAuthLost(() => renderLogin());

async function start() {
  state.loading = true; state.animate = state.intro = true;
  render();
  try { await load(); } catch (e) { if (e.message !== "auth") toast(e.message); else return; }
  state.loading = false; state.animate = true;
  render();
  connectEvents();
  if (hashId()) await syncFromHash();
}

// Timers: waiting times advance without reloading.
setInterval(() => {
  const now = Date.now();
  document.querySelectorAll(".timer[data-since]").forEach((el) => {
    const ms = now - Number(el.dataset.since);
    el.textContent = dur(ms);
    if (el.dataset.target) el.classList.toggle("late", ms > Number(el.dataset.target));
  });
}, 30_000);
// Safety net: the live stream does most of the work, this catches a dropped connection.
setInterval(() => {
  if (!shell) return;
  if (events && events.readyState === 1) { if (++slow % 6 === 0) refresh(); } else { connectEvents(); refresh(); }
}, 5000);

start();
