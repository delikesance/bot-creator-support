# Desk redesign: working contract

Source of truth shared by the three workstreams (A data, B Discord and API, C panel). If something here is wrong or missing, tell the lead; do not diverge silently.

Design reference: https://claude.ai/artifact/5oH6HvoEThG9dCW5MFHNgp (Inbox, Conversation, Composer, Close dialog). Bot Creator Design System: dark only, Geist + JetBrains Mono, 2 px radius, 8 px square status markers, no emoji, short imperative copy.

Conventions: timestamps are epoch ms; every `/api/*` route needs a session and a guild check (a ticket from a guild the session cannot access is a 404); errors are `{ "error": string }` with 400 / 403 / 404 / 409 / 413 / 429 / 500. Existing behaviour and existing tests keep working unless a change is listed here.

## Waves

1. **Wave 1**: attachments and links (sections 1, 2, 9).
2. **Wave 2**: notes, saved replies, assignee, priority, tags, metrics, close reason, rating, transcript, audit (sections 3 to 8).
3. **Wave 3**: panel only (notifications, message search UI, shortcuts, mobile). Server search is in wave 2.

Each wave ends with `bun test` and `bunx tsc --noEmit` green.

## Types (additions)

```ts
type Priority = "low" | "normal" | "high" | "urgent";
type CloseReason = "resolved" | "no_reply" | "duplicate" | "other";

interface Attachment {
  id: number;
  messageId: number;
  name: string;            // sanitized original name
  mime: string;
  size: number;            // bytes
  kind: "image" | "file";  // image = png, jpg, gif, webp
  url: string;             // "/api/attachments/:id" (served by the desk, never the Discord CDN URL)
}

// Ticket gains:
priority: Priority;               // default "normal"
tags: string[];                   // lowercase, [a-z0-9-], 1..24 chars, max 8
assigneeId: string | null;        // `assignee` (name) already exists
closeReason: CloseReason | null;
channelDeletedAt: number | null;   // set when the Discord channel is gone; replies and reopening answer 409
rating: number | null;            // 1..5
firstResponseAt: number | null;   // first staff message
waitingSince: number | null;      // time of the last customer message while awaiting === "support"

// TicketMessage gains:
internal: boolean;                // internal note: staff only, never sent to Discord, never in the transcript
attachments: Attachment[];
```

## 1. Attachments

- Limits: 10 files per message, 25 MB each, 40 MB per request. Allowed: png, jpg, gif, webp, pdf, txt, log, md, json, csv, zip. Server decides by extension and sniffed bytes, never by the client MIME alone. Violations are 413 (size) or 400 (type), message names the file.
- Storage: `ATTACHMENTS_DIR` (default `<db dir>/attachments`, in Docker `/data/attachments`), files named by random id, never by user input. Path traversal impossible by construction.
- `GET /api/attachments/:id`: session + guild check; images `inline`, others `attachment`; `X-Content-Type-Options: nosniff`; `Cache-Control: private, max-age=86400`.
- Customer attachments posted in the Discord channel are downloaded when the message is recorded (the Discord CDN URL expires after about 24 h). If the download fails, the message is still recorded and the attachment is skipped with a system note.
- Staff files sent from the panel are posted in the channel through the webhook (as the staff member), and stored locally.

## 2. Reply

`POST /api/tickets/:id/reply`

- `multipart/form-data`: `content` (string, may be empty if there is at least one file), `files` (repeatable). `application/json` `{ content }` still works.
- Returns `{ ok: true, message: TicketMessage }`.
- Links: plain URLs stay as text in the message (Discord unfurls them itself). Panel may send markdown-style `[text](url)`; the desk posts it to Discord as `text (url)` form that Discord renders (`[text](<url>)` is not valid in webhooks, so use the bare URL on its own line when text differs). Decision is B's; document it in the code.
- `GET /api/unfurl?url=`: server-side preview `{ url, title, description, site }` or 404. SSRF protected: http/https only, resolve host and refuse private, loopback and link-local ranges, 3 s timeout, 512 KB cap, no redirect to a private host.

## 3. Internal notes

`POST /api/tickets/:id/note` (JSON `{ content }` or multipart like reply). Stored as a message with `internal: true`, `source: "panel"`. Does not change `awaiting`, does not auto-claim, never goes to Discord. Mentions `@name` are plain text.

## 4. Assignment, priority, tags

- `POST /api/tickets/:id/assign` `{ assignee: string | null }` (name; id taken from the session when it is the caller, else null id). Adds a system note.
- `POST /api/tickets/:id/priority` `{ priority }`.
- `POST /api/tickets/:id/tags` `{ tags: string[] }` replaces the set.
- Each emits a `ticket` SSE event and an audit entry.

## 5. Listing, filters, search

`GET /api/tickets?guild=&status=&awaiting=&assignee=&priority=&tag=&q=`

- `assignee`: `me`, `none`, or a name. `q` matches subject, user name, description, and message content (not internal notes unless the session is staff, which it always is here, so notes are searched too).
- Each ticket in the list also carries `lastMessage: { content, authorName, at } | null` (never an internal note) and `attachmentCount`.
- The existing `stats` and `awaiting` blocks stay, and `tags: { name, count }[]` is added for the sidebar.

## 6. Saved replies

Per guild. `GET /api/replies?guild=`, `POST /api/replies` `{ guild, name, text }` (name `[a-z0-9-]{1,32}`, unique per guild, upsert), `DELETE /api/replies/:id`. Text may contain `{customer}`; the panel substitutes it before sending. Returns `{ replies: { id, name, text }[] }`.

## 7. Metrics

`GET /api/metrics?guild=&days=7` returns
`{ waitingNow, oldestWaiting: { ticketId, subject, userName, ms } | null, firstReplyMedianMs | null, resolutionMedianMs | null, resolvedToday, satisfactionAvg | null, satisfactionCount, targets: { firstReplyMs: 900000, replyMs: 3600000 } }`.

## 8. Closing, rating, transcript, audit

- `POST /api/tickets/:id/close` `{ reason?: CloseReason, message?: string, askRating?: boolean, sendTranscript?: boolean }` (all optional, body optional: old callers keep working). Closing message defaults to the localized `noticeClosed`; a custom `message` is posted as written. `askRating` posts three buttons (1 to 5 stars via a select or five buttons, B decides) in the channel, localized in the 13 languages; the answer calls `setRating`. `sendTranscript` posts a `.txt` of the public messages (no internal notes) in the channel.
- `GET /api/tickets/:id/transcript` returns `text/plain` with `Content-Disposition: attachment`, public messages only.
- `GET /api/audit?ticket=:id` returns `{ entries: { at, actor, action, detail }[] }`. Audited: assign, priority, tags, close, reopen, delete channel, note added, saved reply changes.

## 9. Service interface (A provides, B consumes)

On `TicketService` (names fixed, signatures may gain optional params):

```ts
addMessage(ticketId, m: { authorId; authorName; content; source; internal?: boolean; attachments?: NewAttachment[] }): TicketMessage  // now returns the message
// NewAttachment = { name: string; mime: string; size: number; file: string }   // `file` = stored file name under ATTACHMENTS_DIR
attachment(id: number): (Attachment & { file: string; guildId: string }) | null
find(f: { guildId?; status?; awaiting?; assignee?; priority?; tag?; q?; me?: string }): TicketSummary[]  // list() stays as is
setPriority(id, p) / setTags(id, tags) / assign(id, name|null, id|null)
close(id, opts?: { reason? })        // still returns Ticket
setRating(id, n)                      // 1..5, only on closed tickets, once
listReplies(guildId) / saveReply(guildId, name, text) / deleteReply(id)
metrics(guildId, days): Metrics
log(ticketId|null, actor, action, detail) / audit(ticketId): AuditEntry[]
```

`TicketEvent` keeps `type: "ticket" | "message"`; internal notes emit `message` too.

## Ownership

| Stream | Files |
|---|---|
| A data | `src/db.ts`, `src/tickets.ts`, `src/metrics.ts`, `tests/tickets*.test.ts`, `tests/metrics.test.ts`, other new `tests/data-*.test.ts` |
| B Discord + API | `src/desk.ts`, `src/web.ts`, `src/bot/*`, `src/i18n.ts`, `src/storage.ts`, `src/unfurl.ts`, `src/index.ts`, `src/config.ts`, `Dockerfile`, `docker-compose.yml`, `.env.example`, and their tests (`tests/desk*`, `tests/web*`, `tests/bot*`, `tests/i18n*`, `tests/storage*`, `tests/unfurl*`, `tests/config*`) |
| C panel | `public/*`, `scripts/demo.ts`, `docs/*.png` |
| Lead | `docs/api-contract.md`, `README.md`, integration fixes, final review |

Rules: never edit a file you do not own; ask the lead. No `git push`, no force, no merge. Commit only your own files, small commits, on `feat/desk-redesign`. Code comments in French like the surrounding code, UI copy in English. Run `bun test` and `bunx tsc --noEmit` before reporting done. Report: files changed, decisions, risks, tests not run.
