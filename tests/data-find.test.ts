import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService, TicketError } from "../src/tickets";

let svc: TicketService;
const mk = (n: number, extra: Record<string, string> = {}) =>
  svc.create({ guildId: "g1", userId: `u${n}`, userName: `user${n}`, channelId: `c${n}`, subject: `Sujet ${n}`, ...extra });
const cust = (n: number) => ({ authorId: `u${n}`, authorName: `user${n}`, source: "discord" as const });
const staff = { authorId: "a1", authorName: "admin", source: "panel" as const };

beforeEach(() => {
  svc = new TicketService(openDb(":memory:"));
});

describe("find", () => {
  test("sans filtre, renvoie tout, le plus récemment actif d'abord", () => {
    const a = mk(1);
    const b = mk(2);
    svc.addMessage(a.id, { ...cust(1), content: "bonjour" });
    expect(svc.find({}).map((t) => t.id)).toEqual([a.id, b.id]);
  });

  test("filtre par serveur, statut et awaiting", () => {
    const a = mk(1);
    const b = svc.create({ guildId: "g2", userId: "u9", userName: "z", channelId: "c9", subject: "x" });
    svc.addMessage(a.id, { ...cust(1), content: "aide" });
    svc.close(b.id);
    expect(svc.find({ guildId: "g1" }).map((t) => t.id)).toEqual([a.id]);
    expect(svc.find({ status: "closed" }).map((t) => t.id)).toEqual([b.id]);
    expect(svc.find({ awaiting: "support", status: "open" }).map((t) => t.id)).toContain(a.id);
    svc.addMessage(a.id, { ...staff, content: "salut" });
    expect(svc.find({ guildId: "g1", awaiting: "customer" }).map((t) => t.id)).toEqual([a.id]);
  });

  test("filtre assignee : me, none, nom", () => {
    const a = mk(1);
    const b = mk(2);
    const c = mk(3);
    svc.assign(a.id, "admin", "a1");
    svc.assign(b.id, "autre", "a2");
    expect(svc.find({ assignee: "me", me: "a1" }).map((t) => t.id)).toEqual([a.id]);
    expect(svc.find({ assignee: "me", me: "admin" }).map((t) => t.id)).toEqual([a.id]);
    expect(svc.find({ assignee: "none" }).map((t) => t.id)).toEqual([c.id]);
    expect(svc.find({ assignee: "autre" }).map((t) => t.id)).toEqual([b.id]);
  });

  test("filtre priorité et étiquette", () => {
    const a = mk(1);
    const b = mk(2);
    svc.setPriority(a.id, "urgent");
    svc.setTags(a.id, ["bug", "api"]);
    svc.setTags(b.id, ["bugfix"]);
    expect(svc.find({ priority: "urgent" }).map((t) => t.id)).toEqual([a.id]);
    expect(svc.find({ tag: "bug" }).map((t) => t.id)).toEqual([a.id]);
    expect(svc.find({ tag: "BUG" }).map((t) => t.id)).toEqual([a.id]);
  });

  test("q cherche sujet, nom, description, messages et notes internes", () => {
    const a = mk(1, { subject: "Crash au démarrage" });
    const b = svc.create({ guildId: "g1", userId: "u2", userName: "Bobby", channelId: "c2", subject: "x", description: "écran noir" });
    const c = mk(3);
    const d = mk(4);
    svc.addMessage(c.id, { ...cust(3), content: "le bot plante" });
    svc.addMessage(d.id, { ...staff, content: "doublon probable", internal: true });
    expect(svc.find({ q: "crash" }).map((t) => t.id)).toEqual([a.id]);
    expect(svc.find({ q: "bobby" }).map((t) => t.id)).toEqual([b.id]);
    expect(svc.find({ q: "noir" }).map((t) => t.id)).toEqual([b.id]);
    expect(svc.find({ q: "plante" }).map((t) => t.id)).toEqual([c.id]);
    expect(svc.find({ q: "doublon" }).map((t) => t.id)).toEqual([d.id]);
  });

  test("q traite % et _ comme du texte et ignore le vide", () => {
    const a = mk(1);
    svc.addMessage(a.id, { ...cust(1), content: "100% sûr" });
    mk(2);
    expect(svc.find({ q: "%" }).map((t) => t.id)).toEqual([a.id]);
    expect(svc.find({ q: "_" })).toEqual([]);
    expect(svc.find({ q: "  " })).toHaveLength(2);
  });

  test("lastMessage n'est jamais une note interne ; attachmentCount compte les fichiers", () => {
    const a = mk(1);
    expect(svc.find({})[0]!.lastMessage).toBeNull();
    svc.addMessage(a.id, {
      ...cust(1),
      content: "voir",
      attachments: [
        { name: "a.png", mime: "image/png", size: 1, file: "f1" },
        { name: "b.txt", mime: "text/plain", size: 1, file: "f2" },
      ],
    });
    svc.addMessage(a.id, { ...staff, content: "secret", internal: true });
    const t = svc.find({})[0]!;
    expect(t.lastMessage).toMatchObject({ content: "voir", authorName: "user1" });
    expect(typeof t.lastMessage!.at).toBe("number");
    expect(t.attachmentCount).toBe(2);
    expect(t.id).toBe(a.id);
  });

  test("tagCounts pour la barre latérale", () => {
    const a = mk(1);
    const b = mk(2);
    svc.setTags(a.id, ["bug", "api"]);
    svc.setTags(b.id, ["bug"]);
    expect(svc.tagCounts("g1")).toEqual([
      { name: "bug", count: 2 },
      { name: "api", count: 1 },
    ]);
    expect(svc.tagCounts("g2")).toEqual([]);
  });
});

describe("réponses enregistrées", () => {
  test("upsert par serveur et nom, liste triée par nom", () => {
    svc.saveReply("g1", "merci", "Merci {customer}");
    svc.saveReply("g1", "bienvenue", "Bonjour");
    svc.saveReply("g2", "merci", "autre serveur");
    const r = svc.saveReply("g1", "merci", "Merci beaucoup");
    expect(svc.listReplies("g1").map((x) => [x.name, x.text])).toEqual([
      ["bienvenue", "Bonjour"],
      ["merci", "Merci beaucoup"],
    ]);
    expect(svc.listReplies("g1").find((x) => x.name === "merci")!.id).toBe(r.id);
    expect(svc.listReplies("g2")).toHaveLength(1);
  });

  test("valide le nom et le texte", () => {
    expect(() => svc.saveReply("g1", "Mauvais Nom", "x")).toThrow(TicketError);
    expect(() => svc.saveReply("g1", "", "x")).toThrow(TicketError);
    expect(() => svc.saveReply("g1", "a".repeat(33), "x")).toThrow(TicketError);
    expect(() => svc.saveReply("g1", "ok", "  ")).toThrow(TicketError);
  });

  test("deleteReply supprime et dit s'il existait", () => {
    const r = svc.saveReply("g1", "x", "texte");
    expect(svc.deleteReply(r.id)).toBe(true);
    expect(svc.deleteReply(r.id)).toBe(false);
    expect(svc.listReplies("g1")).toEqual([]);
  });
});

describe("audit", () => {
  test("log libre et lecture dans l'ordre", () => {
    const t = mk(1);
    svc.log(t.id, "bob", "delete_channel", "salon supprimé");
    const e = svc.audit(t.id);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ actor: "bob", action: "delete_channel", detail: "salon supprimé" });
    expect(typeof e[0]!.at).toBe("number");
  });

  test("entrées automatiques pour assign, priorité, étiquettes, fermeture, réouverture, note", () => {
    const t = mk(1);
    svc.assign(t.id, "admin", "a1", "admin");
    svc.setPriority(t.id, "high", "admin");
    svc.setTags(t.id, ["bug"], "admin");
    svc.addMessage(t.id, { ...staff, content: "note perso", internal: true });
    svc.close(t.id, { reason: "resolved", actor: "admin" });
    svc.reopen(t.id, "admin");
    const e = svc.audit(t.id);
    expect(e.map((x) => x.action)).toEqual(["assign", "priority", "tags", "note", "close", "reopen"]);
    expect(e[0]).toMatchObject({ actor: "admin", detail: "admin" });
    expect(e[1]!.detail).toBe("high");
    expect(e[2]!.detail).toBe("bug");
    expect(e[3]!.actor).toBe("admin");
    expect(e[4]!.detail).toBe("resolved");
  });

  test("acteur par défaut : system ; un message normal n'est pas audité", () => {
    const t = mk(1);
    svc.setPriority(t.id, "low");
    svc.addMessage(t.id, { ...staff, content: "public" });
    expect(svc.audit(t.id)).toHaveLength(1);
    expect(svc.audit(t.id)[0]!.actor).toBe("system");
  });

  test("réponses enregistrées auditées sans ticket ; supprimer un ticket efface son audit", () => {
    const r = svc.saveReply("g1", "x", "t", "admin");
    svc.deleteReply(r.id, "admin");
    expect(svc.audit(null).map((e) => e.action)).toEqual(["reply_save", "reply_delete"]);
    expect(svc.audit(null)[0]).toMatchObject({ actor: "admin", detail: "x" });
  });
});
