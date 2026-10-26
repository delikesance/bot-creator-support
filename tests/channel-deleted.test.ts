import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService, TicketError } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";

class Gw implements Gateway {
  deleted: string[] = [];
  async createTicketChannel() {
    return "chan1";
  }
  async send() {}
  async setUserLocked() {}
  async deleteChannel(c: string) {
    this.deleted.push(c);
  }
}

let gw: Gw;
let desk: SupportDesk;
const user = { userId: "u1", guildId: "g1", userName: "alice", locale: "en" };
const actions = (id: number) => desk.tickets.audit(id).map((a) => `${a.actor}:${a.action}`);

beforeEach(() => {
  gw = new Gw();
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
});

describe("channel deleted", () => {
  test("a new ticket has a channel", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    expect(t.channelDeletedAt).toBeNull();
  });
  test("deleting the channel from the desk is remembered on the ticket", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "A");
    await desk.deleteChannel(t.id, "Angelo");
    expect(desk.tickets.get(t.id)!.channelDeletedAt).toBeGreaterThan(0);
  });
  test("deleting twice does not call Discord again", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "A");
    await desk.deleteChannel(t.id, "Angelo");
    await desk.deleteChannel(t.id, "Angelo");
    expect(gw.deleted).toEqual(["chan1"]);
  });
  test("a channel deleted in Discord is recorded, even on an open ticket, and audited once", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    desk.channelRemoved("chan1");
    desk.channelRemoved("chan1");
    const after = desk.tickets.get(t.id)!;
    expect(after.status).toBe("open");
    expect(after.channelDeletedAt).toBeGreaterThan(0);
    expect(actions(t.id).filter((a) => a.endsWith("delete_channel"))).toEqual(["Discord:delete_channel"]);
  });
  test("an unknown channel is ignored", () => {
    expect(() => desk.channelRemoved("nope")).not.toThrow();
  });
  test("a ticket whose channel is gone cannot be reopened", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "A");
    await desk.deleteChannel(t.id, "Angelo");
    const err = await desk.reopen(t.id, "Angelo").catch((e) => e);
    expect(err).toBeInstanceOf(TicketError);
    expect(err.code).toBe("conflict");
    expect(desk.tickets.get(t.id)!.status).toBe("closed");
  });
  test("replying to a ticket whose channel is gone is refused", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    desk.channelRemoved("chan1");
    const err = await desk.reply(t.id, "hello", "Angelo").catch((e) => e);
    expect(err).toBeInstanceOf(TicketError);
    expect(err.code).toBe("conflict");
  });
});
