import { beforeEach, describe, expect, test } from "bun:test";
import { ApplicationCommandOptionType, ChannelType } from "discord.js";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { handleInteraction, type Ix } from "../src/bot/handlers";
import { commandDefinitions } from "../src/bot/register";
import { pack } from "../src/i18n";

let created: { guildId: string; categoryId?: string | null }[];
const gw: Gateway = {
  createTicketChannel: async (o) => {
    created.push({ guildId: o.guildId, categoryId: o.categoryId });
    return `chan${created.length}`;
  },
  send: async () => {},
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};

let desk: SupportDesk;
let panels: string[];

function ix(over: Partial<Ix>): Ix {
  return {
    kind: "command",
    id: "setup",
    userId: "u1",
    guildId: "g1",
    userName: "alice",
    channelId: "chat",
    isStaff: true,
    reply: async () => {},
    showSubjectModal: async () => {},
    postPanel: async (confirmation) => void panels.push(confirmation),
    ...over,
  };
}

beforeEach(() => {
  created = [];
  panels = [];
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw, { maxActivePerUser: 5 });
});

describe("category stored per server", () => {
  test("no category until one is set", () => {
    expect(desk.tickets.categoryId("g1")).toBeNull();
  });
  test("set, read, and kept separate per server", () => {
    desk.tickets.setCategory("g1", "cat1");
    desk.tickets.setCategory("g2", "cat2");
    expect(desk.tickets.categoryId("g1")).toBe("cat1");
    expect(desk.tickets.categoryId("g2")).toBe("cat2");
  });
  test("a new value replaces the old one, null clears it", () => {
    desk.tickets.setCategory("g1", "cat1");
    desk.tickets.setCategory("g1", "cat9");
    expect(desk.tickets.categoryId("g1")).toBe("cat9");
    desk.tickets.setCategory("g1", null);
    expect(desk.tickets.categoryId("g1")).toBeNull();
  });
});

describe("ticket creation uses the server's category", () => {
  test("the gateway receives the category of the ticket's server only", async () => {
    desk.tickets.setCategory("g1", "cat1");
    await desk.open({ guildId: "g1", userId: "u1", userName: "alice", subject: "A" });
    await desk.open({ guildId: "g2", userId: "u2", userName: "bob", subject: "B" });
    expect(created).toEqual([
      { guildId: "g1", categoryId: "cat1" },
      { guildId: "g2", categoryId: null },
    ]);
  });
});

describe("/setup with a category", () => {
  test("staff: saves the category and confirms it by name, in the admin's language", async () => {
    await handleInteraction(desk, ix({ category: { id: "cat1", name: "Support" }, locale: "fr" }));
    expect(desk.tickets.categoryId("g1")).toBe("cat1");
    expect(panels).toHaveLength(1);
    expect(panels[0]).toContain(pack("fr").panelPosted);
    expect(panels[0]).toContain("Support");
  });
  test("without the option, the category already set is kept", async () => {
    desk.tickets.setCategory("g1", "cat1");
    await handleInteraction(desk, ix({}));
    expect(desk.tickets.categoryId("g1")).toBe("cat1");
    expect(panels[0]).toBe(pack("en").panelPosted);
  });
  test("a non-staff user changes nothing", async () => {
    await handleInteraction(desk, ix({ isStaff: false, category: { id: "cat1", name: "Support" } }));
    expect(desk.tickets.categoryId("g1")).toBeNull();
    expect(panels).toHaveLength(0);
  });
});

describe("/setup command definition", () => {
  const setup = commandDefinitions.find((c) => c.name === "setup")!;
  const option = setup.options?.find((o) => o.name === "category") as any;
  test("has an optional category option that only accepts categories", () => {
    expect(option.type).toBe(ApplicationCommandOptionType.Channel);
    expect(option.required).toBeFalsy();
    expect(option.channel_types).toEqual([ChannelType.GuildCategory]);
  });
});

describe("texts", () => {
  test("every language has the confirmation, with the category name placeholder", () => {
    for (const lang of ["en", "fr", "es", "de", "pt", "it", "nl", "pl", "ru", "tr", "ja", "ko", "zh"]) {
      expect(pack(lang).categorySet).toContain("{name}");
    }
  });
});
