import Database from "@tauri-apps/plugin-sql";
import { SCHEMA_STATEMENTS } from "./schema";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:stoker.db");
    for (const stmt of SCHEMA_STATEMENTS) await db.execute(stmt);
  }
  return db;
}
