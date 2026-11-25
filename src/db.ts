// Turso (hosted SQLite) in production, a local SQLite file in development.
import type { Client, InStatement } from "@libsql/client";
import { ConfigError, isDev } from "./auth.js";
import { SCHEMA } from "./schema.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

let client: Client | null = null;
let ready: Promise<void> | null = null;

async function getClient(): Promise<Client> {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL || (isDev() ? "file:local.db" : "");
  if (!url) throw new ConfigError("TURSO_DATABASE_URL");
  // Local files need the native driver; Turso only needs the pure-HTTP "web" client.
  const { createClient } = url.startsWith("file:") ? await import("@libsql/client") : await import("@libsql/client/web");
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}

/** Connect and make sure the tables exist (once per warm function instance). */
export async function db(): Promise<Client> {
  const c = await getClient();
  if (!ready) ready = c.executeMultiple(SCHEMA).catch((e) => { ready = null; throw e; });
  await ready;
  return c;
}

export async function all(sql: string, args: unknown[] = []): Promise<Row[]> {
  const rs = await (await db()).execute({ sql, args: args as never });
  return rs.rows as unknown as Row[];
}

export async function one(sql: string, args: unknown[] = []): Promise<Row | undefined> {
  return (await all(sql, args))[0];
}

export async function run(sql: string, args: unknown[] = []) {
  return (await db()).execute({ sql, args: args as never });
}

/** Several writes in one atomic transaction. */
export async function tx(stmts: InStatement[]) {
  return (await db()).batch(stmts, "write");
}
