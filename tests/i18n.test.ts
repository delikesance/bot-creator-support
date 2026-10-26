import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { handleInteraction, type Ix } from "../src/bot/handlers";
import { langOf, welcomeText, openedText, pack, quotaText, commandLocalizations } from "../src/i18n";

const sent: string[] = [];
const gw: Gateway = {
  createTicketChannel: async () => "chan1",
  send: async (_c, t) => void sent.push(t),
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};
const user = { guildId: "gA", userId: "u1", userName: "alice" };

let desk: SupportDesk;
beforeEach(() => {
  sent.length = 0;
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
});

describe("langue de l'utilisateur", () => {
  test("les locales Discord se ramènent à une langue gérée", () => {
    expect(langOf("fr")).toBe("fr");
    expect(langOf("en-US")).toBe("en");
    expect(langOf("en-GB")).toBe("en");
    expect(langOf("es-ES")).toBe("es");
    expect(langOf("es-419")).toBe("es");
    expect(langOf("pt-BR")).toBe("pt");
    expect(langOf("zh-CN")).toBe("zh");
    expect(langOf("zh-TW")).toBe("zh");
    expect(langOf("ja")).toBe("ja");
  });
  test("langue inconnue ou absente : anglais", () => {
    expect(langOf("xx-YY")).toBe("en");
    expect(langOf(undefined)).toBe("en");
    expect(langOf("")).toBe("en");
  });
});

describe("message d'accueil", () => {
  test("mentionne l'utilisateur et le numéro du ticket", () => {
    for (const l of ["en", "fr", "es", "de", "pt", "it", "nl", "pl", "ru", "tr", "ja", "ko", "zh"]) {
      const t = welcomeText(l, 7, "u1");
      expect(t).toContain("<@u1>");
      expect(t).toContain("#7");
    }
  });
  test("hors anglais : prévient que le support se fait en anglais, dans la langue de l'utilisateur", () => {
    const fr = welcomeText("fr-FR".slice(0, 2), 7, "u1");
    expect(fr).toContain("anglais");
    expect(fr).toContain("solution");
    expect(welcomeText("de", 7, "u1")).toContain("Englisch");
    expect(welcomeText("es-ES", 7, "u1")).toContain("inglés");
    expect(welcomeText("ja", 7, "u1")).toContain("英語");
  });
  test("en anglais : pas d'avertissement superflu", () => {
    const en = welcomeText("en-US", 7, "u1");
    expect(en).toContain("received");
    expect(en).not.toContain("🌐");
  });
  test("la confirmation éphémère suit aussi la langue", () => {
    expect(openedText("fr", 7, "c1")).toContain("ouvert");
    expect(openedText("en-GB", 7, "c1")).toContain("open");
    expect(openedText("de", 7, "c1")).toContain("<#c1>");
  });
});

describe("à l'ouverture d'un ticket", () => {
  test("le message posté dans le salon est dans la langue de l'utilisateur", async () => {
    await desk.open({ ...user, subject: "a", locale: "fr" });
    expect(sent[0]).toContain("bien été reçu");
    expect(sent[0]).toContain("anglais");
  });
  test("sans locale : anglais", async () => {
    await desk.open({ ...user, subject: "a" });
    expect(sent[0]).toContain("received");
  });
  test("la modale Discord transmet la locale de l'utilisateur", async () => {
    const replies: string[] = [];
    const ix: Ix = {
      kind: "modal", id: "ticket:modal", ...user, channelId: "", isStaff: false, locale: "de",
      subject: "Titel", description: "Beschreibung des Problems",
      reply: async (t) => void replies.push(t), showSubjectModal: async () => {}, postPanel: async () => {},
    };
    await handleInteraction(desk, ix);
    expect(sent[0]).toContain("Englisch");
    expect(replies[0]).toContain("<#chan1>");
    expect(replies[0]).toContain("Ticket");
  });
});

const LANGS = ["en", "fr", "es", "de", "pt", "it", "nl", "pl", "ru", "tr", "ja", "ko", "zh"];

describe("tous les textes sont traduits", () => {
  test("chaque langue a tous les champs, non vides, sans reste d'un autre gabarit", () => {
    const keys = Object.keys(pack("en"));
    for (const l of LANGS) {
      const p = pack(l) as unknown as Record<string, string>;
      expect(Object.keys(p).sort()).toEqual([...keys].sort());
      for (const k of keys) if (!(l === "en" && k === "english")) expect(p[k]!.trim().length).toBeGreaterThan(0);
    }
  });
  test("limites Discord respectées (modale, bouton, commandes)", () => {
    for (const l of LANGS) {
      const p = pack(l);
      expect(p.modalTitle.length).toBeLessThanOrEqual(45);
      expect(p.subjectLabel.length).toBeLessThanOrEqual(45);
      expect(p.descLabel.length).toBeLessThanOrEqual(45);
      expect(p.subjectPh.length).toBeLessThanOrEqual(100);
      expect(p.descPh.length).toBeLessThanOrEqual(100);
      for (const c of [p.cmdTicket, p.cmdClose, p.cmdSetup]) expect(c.length).toBeLessThanOrEqual(100);
    }
  });
  test("les gabarits gardent leurs variables", () => {
    for (const l of LANGS) {
      expect(pack(l).welcome).toContain("{id}");
      expect(pack(l).opened).toContain("{id}");
      expect(pack(l).opened).toContain("{channel}");
      expect(pack(l).quota).toContain("{n}");
    }
  });
  test("quotaText remplit le nombre de tickets", () => {
    expect(quotaText("fr", 2)).toContain("2");
    expect(quotaText("en", 2)).toContain("2");
  });
  test("localisations des commandes slash : codes Discord valides", () => {
    const loc = commandLocalizations("cmdTicket");
    expect(loc.fr).toBe(pack("fr").cmdTicket);
    expect(loc["es-ES"]).toBe(pack("es").cmdTicket);
    expect(loc["pt-BR"]).toBe(pack("pt").cmdTicket);
    expect(loc["zh-CN"]).toBe(pack("zh").cmdTicket);
    expect(loc["zh-TW"]).toBe(pack("zh").cmdTicket);
    expect(loc["en-US"]).toBeUndefined();
  });
});

describe("dans la langue du ticket", () => {
  test("la locale est mémorisée sur le ticket", async () => {
    const t = await desk.open({ ...user, subject: "a", locale: "pt-BR" });
    expect(desk.tickets.get(t.id)!.locale).toBe("pt");
  });
  test("fermeture et réouverture (même depuis le panel) : messages dans la langue de l'utilisateur", async () => {
    const t = await desk.open({ ...user, subject: "a", locale: "de" });
    sent.length = 0;
    await desk.close(t.id, "Staff");
    await desk.reopen(t.id, "Staff");
    expect(sent[0]).toBe(pack("de").noticeClosed);
    expect(sent[1]).toBe(pack("de").noticeReopened);
  });
  test("limite de tickets : erreur dans la langue de l'utilisateur", async () => {
    const d = new SupportDesk(new TicketService(openDb(":memory:")), gw, { maxActivePerUser: 1 });
    await d.open({ ...user, subject: "a", locale: "es" });
    await expect(d.open({ ...user, subject: "b", locale: "es" })).rejects.toThrow(/ticket/i);
    await expect(d.open({ ...user, subject: "b", locale: "es" })).rejects.toThrow(quotaText("es", 1));
  });
  test("réponses du bot (droits, mauvais salon, fermeture) dans la langue", async () => {
    const replies: string[] = [];
    const base: Ix = {
      kind: "command", id: "setup", ...user, channelId: "nope", isStaff: false, locale: "it",
      reply: async (t) => void replies.push(t), showSubjectModal: async () => {}, postPanel: async () => {},
    };
    await handleInteraction(desk, base);
    await handleInteraction(desk, { ...base, id: "close" });
    expect(replies[0]).toBe(pack("it").noPerm);
    expect(replies[1]).toBe(pack("it").wrongChannel);
    const t = await desk.open({ ...user, subject: "a", locale: "it" });
    await handleInteraction(desk, { ...base, id: "close", channelId: t.channelId });
    expect(replies[2]).toBe(pack("it").closedReply);
  });
});
