// Briques communes du panel : DOM, icônes, API, formats, toasts, mascotte.

/** Construit un élément DOM. Jamais d'innerHTML : le texte reste du texte. */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent?.append(e);
  return e;
};

/* ---------- Icônes (traits carrés, 24 px, héritent de currentColor) ---------- */
const ICONS = {
  search: [["circle", { cx: 11, cy: 11, r: 7 }], ["path", { d: "M20 20l-4-4" }]],
  bell: [["path", { d: "M6 17V11a6 6 0 0112 0v6l2 2H4z" }], ["path", { d: "M10 21h4" }]],
  clip: [["path", { d: "M20 11l-8 8a5 5 0 01-7-7l8-8a3.5 3.5 0 015 5l-8 8a2 2 0 01-3-3l7-7" }]],
  image: [["rect", { x: 3, y: 4, width: 18, height: 16 }], ["circle", { cx: 9, cy: 10, r: 2 }], ["path", { d: "M3 18l6-5 4 3 3-3 5 4" }]],
  link: [["path", { d: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" }], ["path", { d: "M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" }]],
  upload: [["path", { d: "M12 16V4M7 9l5-5 5 5M4 20h16" }]],
  x: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
  chev: [["path", { d: "M6 9l6 6 6-6" }]],
  check: [["path", { d: "M5 12l5 5 9-10" }]],
  back: [["path", { d: "M19 12H5M11 6l-6 6 6 6" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  download: [["path", { d: "M12 4v12M7 11l5 5 5-5M4 20h16" }]],
  file: [["path", { d: "M6 3h8l4 4v14H6z" }], ["path", { d: "M14 3v4h4" }]],
  note: [["path", { d: "M5 4h14v12l-4 4H5z" }], ["path", { d: "M15 20v-4h4" }]],
  slash: [["path", { d: "M16 4L8 20" }]],
  out: [["path", { d: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9" }]],
};
export function icon(name, size = 18) {
  const svg = svgEl("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "square", "aria-hidden": "true", focusable: "false" });
  for (const [tag, attrs] of ICONS[name] ?? []) svgEl(tag, attrs, svg);
  return svg;
}

/* ---------- Bibi (mascotte du design system, grille 12, coins en escalier) ---------- */
const BIBI = {
  idle: { g: "#F4F0EA", i: "#09090C", r: [[3.4, 4.8, 1.6, 1.6], [6.8, 4.8, 1.6, 1.6]], blink: true },
  welcome: { g: "#7C5CF0", i: "#09090C", r: [[3.2, 5.4, 2, .55]], l: ["6.8,6.2 7.8,4.8 8.8,6.2"] },
  empty: { g: "#F4F0EA", i: "#09090C", r: [[2.6, 4.8, 1.6, 1.6], [6, 4.8, 1.6, 1.6]] },
  success: { g: "#7C5CF0", i: "#09090C", l: ["3.2,6.2 4.2,4.8 5.2,6.2", "6.8,6.2 7.8,4.8 8.8,6.2"] },
  error: { g: "#FF8A8A", i: "#09090C", l: ["3.2,4.8 4.8,5.6 3.2,6.4", "8.8,4.8 7.2,5.6 8.8,6.4"], w: .65 },
};
export function bibi(mood = "idle", size = 28, move = false) {
  const d = BIBI[mood];
  const svg = svgEl("svg", { width: size, height: size, viewBox: "0 0 12 12", "shape-rendering": "crispEdges", "aria-hidden": "true" });
  const body = svgEl("g", { class: "body" }, svg);
  const ground = svgEl("g", { fill: d.g }, body);
  for (const [x, y, w, hh] of [[3, 1, 6, 1], [2, 2, 8, 1], [1, 3, 10, 6], [2, 9, 8, 1], [3, 10, 6, 1]]) svgEl("rect", { x, y, width: w, height: hh }, ground);
  const eyes = svgEl("g", { fill: d.i, class: d.blink ? "blink" : "" }, body);
  for (const [x, y, w, hh] of d.r ?? []) svgEl("rect", { x, y, width: w, height: hh }, eyes);
  const lines = svgEl("g", { fill: "none", stroke: d.i, "stroke-width": d.w ?? .7, "stroke-linecap": "round", "stroke-linejoin": "round", "shape-rendering": "geometricPrecision" }, body);
  for (const points of d.l ?? []) svgEl("polyline", { points }, lines);
  const wrap = h("span", { class: `bibi ${mood}${move ? " move" : ""}`, role: "img", "aria-label": "Bibi, the mascot", style: `width:${size}px;height:${size}px` });
  wrap.append(svg);
  return wrap;
}

/* ---------- API ---------- */
let authHandler = () => {};
export const onAuthLost = (fn) => { authHandler = fn; };

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, opts = {}) {
  const headers = opts.body instanceof FormData ? {} : { "content-type": "application/json" };
  const res = await fetch("/api" + path, { headers, ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") { authHandler(); throw new ApiError("auth", 401); }
  if (!res.ok) throw new ApiError(data.error || "Error " + res.status, res.status);
  return data;
}
export const post = (path, body) => api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

/** Envoi avec progression (fetch n'expose pas l'avancement du téléversement). */
export function upload(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api" + path);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError("Network error. Check your connection and try again.", 0));
    xhr.onload = () => {
      const data = xhr.response ?? {};
      if (xhr.status === 401) { authHandler(); return reject(new ApiError("auth", 401)); }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || "Error " + xhr.status, xhr.status));
    };
    xhr.send(form);
  });
}

export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};

/* ---------- Formats ---------- */
export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
export const clock = (ts) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const dayLabel = (ts) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Durée courte : 2h 14m, 38m, 3d 4h. */
export function dur(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const hh = Math.floor(m / 60);
  if (hh < 24) return `${hh}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(hh / 24)}d ${hh % 24}h`;
}

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export const initials = (name) => {
  const parts = String(name ?? "?").trim().split(/\s+/).filter(Boolean);
  const a = [...(parts[0] ?? "?")][0] ?? "?";
  const b = parts.length > 1 ? [...parts.at(-1)][0] : "";
  return (a + b).toUpperCase();
};
export const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();

/** Texte nettoyé pour les aperçus et messages système (le markdown Discord n'a pas de sens ici). */
export const plain = (text) => String(text ?? "").replaceAll("**", "").replace(/^\p{Extended_Pictographic}️?\s*/u, "");

/* ---------- Toasts ---------- */
let toastHost = null;
export function toast(msg, ok = false) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const t = h("div", { class: "toast" + (ok ? " ok" : "") }, bibi(ok ? "success" : "error", 24), h("span", {}, msg));
  toastHost.append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 220); }, 4000);
}

/* ---------- Dialogues modaux ---------- */
/** Pose un dialogue sur <body> ; Échap et clic extérieur le ferment, Tab reste à l'intérieur. */
export function modal(build) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    let scrim;
    const done = (v) => { scrim.classList.add("out"); setTimeout(() => scrim.remove(), 140); opener?.isConnected && opener.focus(); resolve(v); };
    const dialog = build(done);
    scrim = h("div", { class: "scrim", onmousedown: (e) => e.target === scrim && done(null) },
      dialog);
    scrim.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); done(null); }
      if (e.key !== "Tab") return;
      const f = [...dialog.querySelectorAll("button:not([disabled]), input, textarea, a[href], select")].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.body.append(scrim);
    (dialog.querySelector("[data-autofocus]") ?? dialog.querySelector("button, input, textarea"))?.focus();
  });
}

export function confirmDialog(title, text, confirmLabel, cls = "caution") {
  return modal((done) =>
    h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("h3", {}, title), h("p", {}, text),
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => done(false) }, "Cancel"),
        h("button", { class: "btn " + cls, type: "button", "data-autofocus": "", onclick: () => done(true) }, confirmLabel)))).then((v) => v === true);
}
