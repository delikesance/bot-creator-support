import { expect, test } from "bun:test";
import { messageContent } from "../src/bot/content";

test("texte seul, pièces jointes seules, ou les deux", () => {
  expect(messageContent("salut", [])).toBe("salut");
  expect(messageContent("", ["https://cdn/a.png"])).toBe("https://cdn/a.png");
  expect(messageContent(" voici la capture ", ["https://cdn/a.png", "https://cdn/b.png"])).toBe(
    "voici la capture\nhttps://cdn/a.png\nhttps://cdn/b.png",
  );
  expect(messageContent("  ", [])).toBe("");
});
