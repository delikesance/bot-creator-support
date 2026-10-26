// Reply box: text, attachments (button, drag and drop, paste), link with preview,
// internal note and saved replies.
import { h, icon, api, post, upload, bytes, extOf, toast, modal } from "./lib.js";

const ALLOWED = new Set(["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "log", "md", "json", "csv", "zip"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
export const LIMITS = { files: 10, file: 25 * 1024 * 1024, total: 40 * 1024 * 1024 };
const TYPES_HELP = "PNG, JPG, GIF, WEBP, PDF, TXT, LOG, MD, JSON, CSV or ZIP";

let seq = 0;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const validUrl = (s) => { try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; } };

/** Link preview: same card in the insert dialog and under the text. */
function previewCard(p, onRemove) {
  return h("div", { class: "file", style: "align-items:flex-start" },
    h("span", { class: "lico" }, icon("link", 16)),
    h("span", { class: "inf", style: "gap:2px" },
      h("span", { class: "mono small" }, p.site || hostOf(p.url)),
      h("b", { class: "truncate" }, p.title || p.url),
      h("span", { class: "small" }, "Discord will show this preview under your message.")),
    onRemove ? h("button", { class: "btn icon ghost sm", type: "button", "aria-label": "Remove preview", style: "width:30px", onclick: onRemove }, icon("x", 14)) : null);
}

/** `GET /api/unfurl` : missing or failing, nothing is shown. */
async function unfurl(url, signal) {
  try { const p = await api("/unfurl?url=" + encodeURIComponent(url), { signal }); return p?.url ? p : null; }
  catch { return null; }
}

function linkDialog(selected) {
  return modal((done) => {
    const text = h("input", { id: "lk-text", type: "text", autocomplete: "off", value: selected });
    const url = h("input", { id: "lk-url", type: "url", inputmode: "url", autocomplete: "off", placeholder: "https://", class: "mono", style: "font-size:13px", "data-autofocus": "" });
    const err = h("div", { class: "err", role: "alert", style: "min-height:0" });
    const slot = h("div", { "aria-live": "polite" });
    let timer, ctl, found = null;
    url.addEventListener("input", () => {
      clearTimeout(timer); ctl?.abort(); found = null; slot.replaceChildren(); err.textContent = "";
      const v = url.value.trim();
      if (!validUrl(v)) return;
      timer = setTimeout(async () => {
        ctl = new AbortController();
        const p = await unfurl(v, ctl.signal);
        if (p && url.value.trim() === v) { found = p; slot.replaceChildren(previewCard(p)); }
      }, 400);
    });
    const form = h("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Insert a link", onsubmit: (e) => {
      e.preventDefault();
      const u = url.value.trim();
      if (!validUrl(u)) { err.textContent = "Enter a link that starts with http:// or https://"; url.focus(); return; }
      done({ text: text.value.trim(), url: u, preview: found });
    } },
      h("h3", {}, "Insert a link"),
      h("div", { class: "fld" }, h("label", { for: "lk-text" }, "Text"), text, h("span", { class: "help" }, "Optional. Leave empty to show the link itself.")),
      h("div", { class: "fld" }, h("label", { for: "lk-url" }, "Link"), url),
      err, slot,
      h("div", { class: "actions" },
        h("button", { class: "btn ghost sm", type: "button", onclick: () => done(null) }, "Cancel"),
        h("button", { class: "btn hero sm", type: "submit" }, "Insert link")));
    return form;
  });
}

/**
 * opts: { ticket, me, caps:{notes,replies}, getReplies(): Promise<{name,text}[]|null>, onSent(res) }
 * Returns { el, overlay, update(next), addFiles(list), showDrop(bool), focus() }.
 */
export function createComposer(opts) {
  let { ticket, me, caps } = opts;
  let mode = "reply", sending = false, preview = null, files = [], slash = null;
  const rows = new Map();

  const ta = h("textarea", { id: "reply", rows: "3", "aria-label": "Reply" });
  const live = h("div", { class: "sr", "aria-live": "polite" });
  const filesEl = h("div", { class: "files", role: "list", "aria-label": "Attachments" });
  const prevEl = h("div", { class: "cprev" });
  const fileInput = h("input", { type: "file", multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });
  const imageInput = h("input", { type: "file", multiple: true, accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true, "aria-hidden": "true", tabindex: "-1" });
  const tabs = h("div", { class: "ctabs", role: "tablist", "aria-label": "Reply type" });
  const bar = h("div", { class: "cbar" });
  const send = h("button", { class: "btn hero", type: "submit" });
  const overlay = h("div", { class: "dropzone", hidden: true, "aria-hidden": "true" },
    h("div", { class: "in" }, icon("upload", 28), h("b", {}, "Drop to attach to your reply"), h("span", { class: "small" }, "PNG, JPG, GIF, PDF, TXT, LOG · up to 25 MB each · 10 files")));
  const box = h("div", { class: "cbox" },
    h("div", { class: "nbanner" }, h("span", { class: "badge amber" }, "Internal note"), h("span", { class: "small" }, "Only your team can read this.")),
    ta, filesEl, prevEl, bar);
  const el = h("form", { class: "composer", "aria-label": "Reply", novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } }, tabs, box, live, fileInput, imageInput);

  const closed = () => ticket.status === "closed";
  const say = (msg) => { live.textContent = ""; setTimeout(() => { live.textContent = msg; }, 20); };

  /* ----- Attachments ----- */
  function addFiles(list) {
    if (closed()) return;
    const added = [];
    for (const file of list) {
      const ext = extOf(file.name);
      const f = { id: ++seq, file, name: file.name || "file", size: file.size, ext, error: null, pct: null, thumb: null };
      if (!ALLOWED.has(ext)) f.error = `.${ext || "?"} is not an allowed type. Use ${TYPES_HELP}.`;
      else if (file.size > LIMITS.file) f.error = `${bytes(file.size)} is over the 25 MB limit. Compress it or share a link instead.`;
      else if (files.filter((x) => !x.error).length + added.filter((x) => !x.error).length >= LIMITS.files) f.error = "Only 10 files fit in one message.";
      if (!f.error && IMAGE.has(ext)) f.thumb = URL.createObjectURL(file);
      added.push(f);
    }
    files.push(...added);
    renderFiles();
    const bad = added.filter((f) => f.error).length;
    say(`${added.length - bad} file${added.length - bad === 1 ? "" : "s"} attached${bad ? `, ${bad} rejected` : ""}.`);
    sync();
  }
  function dropFile(f) {
    if (f.thumb) URL.revokeObjectURL(f.thumb);
    files = files.filter((x) => x !== f);
    renderFiles(); sync();
  }
  function renderFiles() {
    rows.clear();
    filesEl.replaceChildren(...files.map((f) => {
      const th = h("span", { class: "th", "aria-hidden": "true" }, f.thumb ? h("img", { src: f.thumb, alt: "" }) : h("span", { class: "badge" + (f.error ? " danger" : ""), style: "padding:3px 5px" }, (f.ext || "?").slice(0, 4)));
      const sub = h("span", { class: "small" }, f.error ?? `${bytes(f.size)} · ready`);
      const barEl = h("span", { class: "pixel-bar", role: "progressbar", "aria-label": `Uploading ${f.name}`, "aria-valuemin": "0", "aria-valuemax": "100", hidden: true }, h("i", { style: "width:0%" }));
      rows.set(f.id, { sub, barEl, pct: h("span", { class: "mono small", hidden: true }) });
      const r = rows.get(f.id);
      return h("div", { class: "file" + (f.error ? " err" : ""), role: "listitem" },
        th, h("span", { class: "inf" }, h("b", { class: "truncate" }, f.name), sub, barEl), r.pct,
        h("button", { class: "btn icon ghost sm", type: "button", "aria-label": `Remove ${f.name}`, style: "width:30px", onclick: () => { dropFile(f); ta.focus(); } }, icon("x", 14)));
    }));
  }
  function progress(p) {
    for (const f of files) {
      const r = rows.get(f.id);
      if (!r || f.error) continue;
      const v = Math.round(p * 100);
      r.barEl.hidden = false; r.pct.hidden = false;
      r.barEl.firstChild.style.width = v + "%";
      r.barEl.setAttribute("aria-valuenow", String(v));
      r.pct.textContent = v + "%";
      r.sub.textContent = p >= 1 ? "Posting to Discord" : "Uploading";
    }
  }

  /* ----- Link preview under the text ----- */
  function renderPreview() {
    prevEl.replaceChildren(...(preview ? [previewCard(preview, () => { preview = null; renderPreview(); ta.focus(); })] : []));
  }

  /* ----- Toolbar and tabs ----- */
  function chrome() {
    const isClosed = closed();
    el.classList.toggle("closed", isClosed);
    el.classList.toggle("note", mode === "note");
    ta.disabled = isClosed;
    ta.placeholder = isClosed ? "Ticket closed. Reopen it to reply."
      : mode === "note" ? "Write a note for your team. It is never sent to Discord."
      : `Write a reply. It is posted in the Discord channel as ${me?.name ?? "you"}.`;
    const hint = h("span", { class: "small" }, mode === "note" ? "Visible to staff only" : ["Sent to Discord as ", h("b", {}, me?.name ?? "you")]);
    const tabBtn = (key, label) => h("button", { class: "ctab", type: "button", role: "tab", "aria-selected": String(mode === key), tabindex: mode === key ? "0" : "-1",
      onclick: () => { mode = key; chrome(); ta.focus(); } }, label);
    tabs.replaceChildren(...(caps.notes ? [tabBtn("reply", "Reply to customer"), tabBtn("note", "Internal note")] : [h("span", { class: "eyebrow", style: "padding:12px 0" }, "Reply to customer")]), hint);
    const tool = (name, label, onclick, extra = {}) => h("button", { class: "tool", type: "button", "aria-label": label, title: label, disabled: isClosed, onclick, ...extra }, typeof name === "string" && name.length > 1 ? icon(name) : name);
    bar.replaceChildren(...[
      tool("clip", "Attach a file", () => fileInput.click()),
      tool("image", "Add an image", () => imageInput.click()),
      tool("link", "Insert a link", insertLink),
      caps.replies && mode === "reply" ? tool("/", "Saved replies", () => { ta.focus(); openSlash(true); }, { class: "tool mono" }) : null,
      h("span", { class: "spacer" }),
      h("span", { class: "small hint" }, "Drop or paste images anywhere"),
      send].filter(Boolean));
    send.replaceChildren(mode === "note" ? "Add note" : "Send reply", h("span", { class: "kbd" }, "Ctrl ↵"));
    sync();
  }
  function sync() {
    const ready = files.some((f) => !f.error);
    send.disabled = closed() || sending || (!ta.value.trim() && !ready);
    send.classList.toggle("busy", sending);
  }

  /* ----- Text ----- */
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 240) + "px"; };
  ta.addEventListener("input", () => { grow(); sync(); openSlash(); });
  ta.addEventListener("paste", (e) => {
    const list = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
    if (!list.length) return;
    // A pasted screenshot is named "image.png": give it a readable name.
    const stamp = new Date().toTimeString().slice(0, 8).replaceAll(":", "");
    const named = list.map((f, i) => (/^image\.\w+$/i.test(f.name) || !f.name) ? new File([f], `screenshot-${stamp}${list.length > 1 ? "-" + (i + 1) : ""}.${extOf(f.name) || (f.type.split("/")[1] ?? "png")}`, { type: f.type }) : f);
    if (!e.clipboardData.getData("text/plain")) e.preventDefault();
    addFiles(named);
  });
  ta.addEventListener("keydown", (e) => {
    if (slash) {
      const n = slash.items.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); slash.i = (slash.i + (e.key === "ArrowDown" ? 1 : -1) + n) % n; slash.nav = true; renderSlash(); return; }
      // The "manage" entry only opens on purpose: a typed path like /usr must not trap Enter.
      if ((e.key === "Enter" || e.key === "Tab") && (!slash.items[slash.i].manage || slash.nav)) { e.preventDefault(); pickSlash(slash.items[slash.i]); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSlash(); return; }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  });
  fileInput.addEventListener("change", () => { addFiles([...fileInput.files]); fileInput.value = ""; });
  imageInput.addEventListener("change", () => { addFiles([...imageInput.files]); imageInput.value = ""; });

  async function insertLink() {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const r = await linkDialog(ta.value.slice(s, e));
    if (!r) return ta.focus();
    // Text differs from the address: [text](url) syntax; the server decides the form posted on Discord.
    const out = r.text && r.text !== r.url ? `[${r.text}](${r.url})` : r.url;
    ta.setRangeText(out, s, e, "end");
    ta.dispatchEvent(new Event("input"));
    if (r.preview) { preview = r.preview; renderPreview(); }
    ta.focus();
  }

  /* ----- Saved replies: "/" at the start of a line ----- */
  const slashEl = h("div", { class: "menu slashmenu", role: "listbox", "aria-label": "Saved replies", hidden: true });
  box.append(slashEl);
  async function openSlash(force = false) {
    if (!caps.replies || mode !== "reply") return closeSlash();
    const before = ta.value.slice(0, ta.selectionStart);
    const m = /(^|\n)\/([a-z0-9-]*)$/.exec(before);
    if (!m && !force) return closeSlash();
    const list = (await opts.getReplies?.()) ?? [];
    const q = m?.[2] ?? "";
    const items = [...list.filter((r) => r.name.includes(q)), { manage: true }];
    slash = { items, i: 0, start: m ? before.length - q.length - 1 : ta.selectionStart };
    renderSlash();
  }
  function renderSlash() {
    if (!slash) return;
    slashEl.hidden = false;
    slashEl.replaceChildren(...slash.items.map((r, i) =>
      h("div", { class: "opt" + (r.manage ? " manage" : ""), role: "option", "aria-selected": String(i === slash.i), onmousedown: (e) => { e.preventDefault(); pickSlash(r); } },
        r.manage ? h("span", { class: "grow", style: "color:var(--ink2)" }, slash.items.length === 1 ? "No saved replies yet. Add one" : "Manage saved replies")
          : [h("span", { class: "cmd" }, "/" + r.name), h("span", { class: "grow truncate", style: "color:var(--ink2)" }, r.text)])));
    slashEl.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  }
  function closeSlash() { slash = null; slashEl.hidden = true; }
  function pickSlash(r) {
    const { start } = slash;
    const end = ta.selectionStart;
    closeSlash();
    if (r.manage) { ta.setRangeText("", start, end, "end"); ta.dispatchEvent(new Event("input")); opts.manageReplies?.(); return; }
    ta.setRangeText(r.text.replaceAll("{customer}", ticket.userName), start, end, "end");
    ta.dispatchEvent(new Event("input"));
    ta.focus();
  }
  ta.addEventListener("blur", () => setTimeout(() => ta.isConnected && closeSlash(), 120));

  /* ----- Send ----- */
  async function submit() {
    const content = ta.value.trim();
    const ready = files.filter((f) => !f.error);
    if (closed() || sending || (!content && !ready.length)) return;
    if (ready.reduce((n, f) => n + f.size, 0) > LIMITS.total) return toast("Attachments are over 40 MB in total. Remove a file and try again.");
    sending = true; ta.readOnly = true; sync();
    const path = `/tickets/${ticket.id}/${mode === "note" ? "note" : "reply"}`;
    try {
      let res;
      if (ready.length) {
        const fd = new FormData();
        fd.set("content", content);
        for (const f of ready) fd.append("files", f.file, f.name);
        progress(0);
        res = await upload(path, fd, progress);
      } else res = await post(path, { content });
      for (const f of files) if (f.thumb) URL.revokeObjectURL(f.thumb);
      ta.value = ""; files = []; preview = null; grow();
      renderFiles(); renderPreview();
      opts.onSent?.(res, mode);
    } catch (x) {
      if (x.message !== "auth") toast(x.message);
      for (const f of ready) { const r = rows.get(f.id); if (r) { r.barEl.hidden = true; r.pct.hidden = true; r.sub.textContent = `${bytes(f.size)} · ready`; } }
    }
    sending = false; ta.readOnly = false; sync();
    if (!closed()) ta.focus({ preventScroll: true });
  }

  chrome();
  renderFiles();
  return {
    el, overlay,
    update(next) {
      const was = [closed(), me?.name, caps.notes, caps.replies];
      ({ ticket, me, caps } = { ticket: next.ticket ?? ticket, me: next.me ?? me, caps: next.caps ?? caps });
      if (!caps.notes) mode = "reply";
      if (was[0] !== closed() || was[1] !== me?.name || was[2] !== caps.notes || was[3] !== caps.replies) chrome();
    },
    addFiles,
    showDrop(on) { overlay.hidden = !on; },
    get canDrop() { return !closed() && !sending; },
    focus(which, opts2) { if (which === "note" && caps.notes && mode !== "note") { mode = "note"; chrome(); } else if (which === "reply" && mode !== "reply") { mode = "reply"; chrome(); } if (!ta.disabled) ta.focus(opts2); },
    get typing() { return !!ta.value; },
  };
}
