import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MIN_LENGTH = 32;

/** Secret de signature des sessions, conservé à côté de la base : les connexions survivent aux redémarrages et aux déploiements. */
export function persistedSessionSecret(dbPath: string): string {
  if (dbPath === ":memory:") return randomBytes(32).toString("hex");
  const file = join(dirname(dbPath), "session-secret");
  try {
    const stored = readFileSync(file, "utf8").trim();
    if (stored.length >= MIN_LENGTH) return stored;
  } catch {
    // absent : premier démarrage
  }
  const secret = randomBytes(32).toString("hex");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, secret + "\n", { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // systèmes de fichiers sans permissions
  }
  return secret;
}
