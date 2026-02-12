import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  ContextEntry,
  ContextEntryRow,
  CreateEntryInput,
} from "./types.js";

const SCHEMA_VERSION = 1;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS context_entries (
    id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    session_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    task_id TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    metadata TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_entries_session_key
    ON context_entries(session_key);
  CREATE INDEX IF NOT EXISTS idx_entries_task_id
    ON context_entries(task_id);
  CREATE INDEX IF NOT EXISTS idx_entries_created_at
    ON context_entries(created_at);
  CREATE INDEX IF NOT EXISTS idx_entries_expires_at
    ON context_entries(expires_at);

  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

function rowToEntry(row: ContextEntryRow): ContextEntry {
  return {
    id: row.id,
    sessionKey: row.session_key,
    sessionType: row.session_type as ContextEntry["sessionType"],
    summary: row.summary,
    taskId: row.task_id,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, string>) : null,
  };
}

export class WorkingContextStorage {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(CREATE_TABLE_SQL);

    const meta = this.db
      .prepare<[string], { value: string }>(
        "SELECT value FROM schema_meta WHERE key = ?",
      )
      .get("schema_version");

    if (!meta) {
      this.db
        .prepare("INSERT INTO schema_meta (key, value) VALUES (?, ?)")
        .run("schema_version", String(SCHEMA_VERSION));
    }
  }

  insert(input: CreateEntryInput, ttlMinutes: number): ContextEntry {
    const now = Date.now();
    const entry: ContextEntry = {
      id: randomUUID(),
      sessionKey: input.sessionKey,
      sessionType: input.sessionType,
      summary: input.summary,
      taskId: input.taskId ?? null,
      pinned: false,
      createdAt: now,
      expiresAt: now + ttlMinutes * 60 * 1000,
      metadata: input.metadata ?? null,
    };

    this.db
      .prepare(
        `INSERT INTO context_entries
         (id, session_key, session_type, summary, task_id, pinned, created_at, expires_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.sessionKey,
        entry.sessionType,
        entry.summary,
        entry.taskId,
        entry.pinned ? 1 : 0,
        entry.createdAt,
        entry.expiresAt,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      );

    return entry;
  }

  getById(id: string): ContextEntry | null {
    const row = this.db
      .prepare<[string], ContextEntryRow>(
        "SELECT * FROM context_entries WHERE id = ?",
      )
      .get(id);

    return row ? rowToEntry(row) : null;
  }

  getRecent(options: {
    limit?: number;
    maxAgeMs?: number;
    sessionType?: string;
    taskId?: string;
  } = {}): ContextEntry[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    const now = Date.now();

    // Exclude expired entries (unless pinned)
    conditions.push("(expires_at > ? OR pinned = 1)");
    params.push(now);

    if (options.maxAgeMs != null) {
      conditions.push("(created_at > ? OR pinned = 1)");
      params.push(now - options.maxAgeMs);
    }

    if (options.sessionType != null) {
      conditions.push("session_type = ?");
      params.push(options.sessionType);
    }

    if (options.taskId != null) {
      conditions.push("task_id = ?");
      params.push(options.taskId);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const limit = options.limit ?? 100;

    const sql = `
      SELECT * FROM context_entries
      ${where}
      ORDER BY pinned DESC, created_at DESC, rowid DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = this.db
      .prepare<(string | number)[], ContextEntryRow>(sql)
      .all(...params);

    return rows.map(rowToEntry);
  }

  getByTaskId(taskId: string): ContextEntry[] {
    const rows = this.db
      .prepare<[string], ContextEntryRow>(
        `SELECT * FROM context_entries
         WHERE task_id = ?
         ORDER BY created_at DESC`,
      )
      .all(taskId);

    return rows.map(rowToEntry);
  }

  pin(id: string): boolean {
    const result = this.db
      .prepare("UPDATE context_entries SET pinned = 1 WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  unpin(id: string): boolean {
    const result = this.db
      .prepare("UPDATE context_entries SET pinned = 0 WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM context_entries WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  deleteByTaskId(taskId: string): number {
    const result = this.db
      .prepare("DELETE FROM context_entries WHERE task_id = ?")
      .run(taskId);
    return result.changes;
  }

  pruneExpired(): number {
    const now = Date.now();
    const result = this.db
      .prepare(
        "DELETE FROM context_entries WHERE expires_at <= ? AND pinned = 0",
      )
      .run(now);
    return result.changes;
  }

  enforceMaxEntries(maxEntries: number): number {
    // Keep pinned entries, delete oldest unpinned entries beyond the limit
    const result = this.db
      .prepare(
        `DELETE FROM context_entries
         WHERE id IN (
           SELECT id FROM context_entries
           WHERE pinned = 0
           ORDER BY created_at DESC
           LIMIT -1 OFFSET ?
         )`,
      )
      .run(maxEntries);
    return result.changes;
  }

  count(): number {
    const row = this.db
      .prepare<[], { cnt: number }>(
        "SELECT COUNT(*) as cnt FROM context_entries",
      )
      .get();
    return row?.cnt ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
