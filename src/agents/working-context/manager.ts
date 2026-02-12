import { CreateEntrySchema } from "./types.js";
import type {
  ContextEntry,
  CreateEntryInput,
  GetRecentOptions,
  ManagerConfig,
} from "./types.js";
import { ManagerConfigSchema } from "./types.js";
import { WorkingContextStorage } from "./storage.js";

export class WorkingContextManager {
  private readonly storage: WorkingContextStorage;
  private readonly config: ManagerConfig;

  constructor(config: ManagerConfig) {
    this.config = ManagerConfigSchema.parse(config);
    this.storage = new WorkingContextStorage(this.config.dbPath);
  }

  add(input: CreateEntryInput): ContextEntry {
    const validated = CreateEntrySchema.parse(input);
    this.pruneExpired();
    const entry = this.storage.insert(validated, this.config.defaultTtlMinutes);
    this.storage.enforceMaxEntries(this.config.maxEntries);
    return entry;
  }

  getById(id: string): ContextEntry | null {
    return this.storage.getById(id);
  }

  getRecent(options: GetRecentOptions = {}): ContextEntry[] {
    const maxAgeMs = options.maxAge != null
      ? options.maxAge * 60 * 1000
      : undefined;

    const entries = this.storage.getRecent({
      limit: this.config.maxEntries,
      maxAgeMs,
      sessionType: options.sessionType,
      taskId: options.taskId,
    });

    if (options.maxTokens != null) {
      return truncateToTokenBudget(entries, options.maxTokens);
    }

    return entries;
  }

  getByTaskId(taskId: string): ContextEntry[] {
    return this.storage.getByTaskId(taskId);
  }

  pin(id: string): boolean {
    return this.storage.pin(id);
  }

  unpin(id: string): boolean {
    return this.storage.unpin(id);
  }

  delete(id: string): boolean {
    return this.storage.delete(id);
  }

  clearByTaskId(taskId: string): number {
    return this.storage.deleteByTaskId(taskId);
  }

  clear(): void {
    const entries = this.storage.getRecent({ limit: 10000 });
    for (const entry of entries) {
      this.storage.delete(entry.id);
    }
  }

  pruneExpired(): number {
    return this.storage.pruneExpired();
  }

  count(): number {
    return this.storage.count();
  }

  close(): void {
    this.storage.close();
  }
}

/** Rough token estimate: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Return as many entries as fit within the token budget.
 * Entries are already sorted by priority (pinned first, then recent).
 */
function truncateToTokenBudget(entries: ContextEntry[], maxTokens: number): ContextEntry[] {
  const result: ContextEntry[] = [];
  let tokensUsed = 0;

  for (const entry of entries) {
    const entryTokens = estimateTokens(entry.summary);
    if (tokensUsed + entryTokens > maxTokens && result.length > 0) break;
    result.push(entry);
    tokensUsed += entryTokens;
  }

  return result;
}
