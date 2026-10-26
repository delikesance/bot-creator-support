import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { handleInteraction, type Ix } from "../src/bot/handlers";
import { TicketError } from "../src/tickets";
import { pack } from "../src/i18n";

const gw: Gateway = {
  createTicketChannel: async () => "chanX",
  send: async () => {},
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};

let desk: SupportDesk;
let out: { replies: string[]; modal: number; panel: number };

function ix(over: Partial<Ix>): Ix {
  return {
    kind: "command",
    id: "",
    userId: "u1",
    guildId: "g1", userName: "alice",
    channelId: "chat",
    isStaff: false,
    reply: async (t) => void out.replies.push(t),
    showSubjectModal: async () => void out.modal++,
    postPanel: async () => void out.panel++,
    ...over,
  };
}

beforeEach(() => {
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw, { maxActivePerUser: 1 });
  out = { replies: [], modal: 0, panel: 0 };
});

describe("ouverture côté utilisateur", () => {
  test("/ticket ouvre la modale", async () => {
    await handleInteraction(desk, ix({ kind: "command", id: "ticket" }));
    expect(out.modal).toBe(1);
  });
  test("bouton ouvrir ouvre la modale", async () => {
    await handleInteraction(desk, ix({ kind: "button", id: "ticket:open" }));
    expect(out.modal).toBe(1);
  });
  test("soumission de la modale crée le ticket et pointe vers le salon", async () => {
    await handleInteraction(desk, ix({ kind: "modal", id: "ticket:modal", subject: "Bug" }));
    expect(desk.tickets.list()).toHaveLength(1);
    expect(out.replies[0]).toContain("<#chanX>");
  });
  test("limite atteinte : message d'erreur clair, pas de crash", async () => {
    await handleInteraction(desk, ix({ kind: "modal", id: "ticket:modal", subject: "a" }));
    await handleInteraction(desk, ix({ kind: "modal", id: "ticket:modal", subject: "b" }));
    expect(out.replies[1]).toContain("already");
    expect(desk.tickets.list()).toHaveLength(1);
  });
});

describe("/setup", () => {
  test("réservé au staff", async () => {
    await handleInteraction(desk, ix({ id: "setup", isStaff: false }));
    expect(out.panel).toBe(0);
    expect(out.replies[0]).toMatch(/permission/i);
  });
  test("staff : poste le panneau", async () => {
    await handleInteraction(desk, ix({ id: "setup", isStaff: true }));
    expect(out.panel).toBe(1);
  });
});

describe("gestion dans le salon ticket", () => {
  let id: number;
  beforeEach(async () => {
    id = (await desk.open({ userId: "u1", guildId: "g1", userName: "alice", subject: "a" })).id;
  });
  const inTicket = { channelId: "chanX" };

  test("le propriétaire peut fermer son ticket", async () => {
    await handleInteraction(desk, ix({ kind: "button", id: "ticket:close", ...inTicket }));
    expect(desk.tickets.get(id)!.status).toBe("closed");
  });
  test("un tiers non staff ne peut pas fermer", async () => {
    await handleInteraction(desk, ix({ kind: "button", id: "ticket:close", userId: "u2", ...inTicket }));
    expect(desk.tickets.get(id)!.status).toBe("open");
  });
  test("/close dans un salon non-ticket : erreur", async () => {
    await handleInteraction(desk, ix({ id: "close", channelId: "random" }));
    expect(out.replies[0]).toMatch(/ticket/i);
  });
  test("/close fonctionne dans un salon ticket", async () => {
    await handleInteraction(desk, ix({ id: "close", ...inTicket }));
    expect(desk.tickets.get(id)!.status).toBe("closed");
  });
  test("reopen réservé au staff", async () => {
    await desk.close(id, "x");
    await handleInteraction(desk, ix({ kind: "button", id: "ticket:reopen", ...inTicket }));
    expect(desk.tickets.get(id)!.status).toBe("closed");
    await handleInteraction(desk, ix({ kind: "button", id: "ticket:reopen", isStaff: true, ...inTicket }));
    expect(desk.tickets.get(id)!.status).toBe("open");
  });
});

describe("note du client", () => {
  const rated: unknown[][] = [];
  const stub = (fail = false) =>
    ({ rate: async (...a: unknown[]) => (rated.push(a), fail ? Promise.reject(new TicketError("déjà noté")) : undefined) }) as unknown as SupportDesk;
  beforeEach(() => (rated.length = 0));

  test("le bouton transmet ticket, utilisateur et note, puis remercie dans la langue", async () => {
    await handleInteraction(stub(), ix({ kind: "button", id: "rate:12:4", userId: "u9", locale: "fr" }));
    expect(rated).toEqual([[12, "u9", 4]]);
    expect(out.replies).toEqual([pack("fr").ratingThanks]);
  });
  test("note refusée par le desk : message localisé, pas de crash", async () => {
    await handleInteraction(stub(true), ix({ kind: "button", id: "rate:12:4", locale: "de" }));
    expect(out.replies).toEqual([pack("de").ratingDone]);
  });
  test("identifiant hors 1 à 5 : ignoré", async () => {
    await handleInteraction(stub(), ix({ kind: "button", id: "rate:12:9" }));
    expect(rated).toEqual([]);
  });
});
