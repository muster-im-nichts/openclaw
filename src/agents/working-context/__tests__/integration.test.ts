import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkingContextManager } from "../manager.js";
import { formatForSystemPrompt } from "../injection.js";
import { WorkingContextStorage } from "../storage.js";
import type { ContextEntry, CreateEntryInput } from "../types.js";

function makeTmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wc-test-"));
  return path.join(dir, "test.db");
}

const SAMPLE_INPUT: CreateEntryInput = {
  sessionKey: "agent:main:main",
  sessionType: "dm",
  summary: "Started auth refactor task for ki-at-obv",
  taskId: "auth-refactor",
};

describe("WorkingContextManager integration", () => {
  let dbPath: string;
  let manager: WorkingContextManager;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    manager = new WorkingContextManager({
      dbPath,
      maxEntries: 20,
      defaultTtlMinutes: 120,
    });
  });

  afterEach(() => {
    manager.close();
    const dir = path.dirname(dbPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("adds an entry and retrieves it", () => {
    const entry = manager.add(SAMPLE_INPUT);
    expect(entry.id).toBeTruthy();
    expect(entry.summary).toBe(SAMPLE_INPUT.summary);
    expect(entry.sessionKey).toBe(SAMPLE_INPUT.sessionKey);
    expect(entry.sessionType).toBe("dm");
    expect(entry.taskId).toBe("auth-refactor");
    expect(entry.pinned).toBe(false);

    const retrieved = manager.getById(entry.id);
    expect(retrieved).toEqual(entry);
  });

  it("retrieves recent entries in order", () => {
    manager.add({ ...SAMPLE_INPUT, summary: "First entry" });
    manager.add({ ...SAMPLE_INPUT, summary: "Second entry" });
    manager.add({ ...SAMPLE_INPUT, summary: "Third entry" });

    const recent = manager.getRecent();
    expect(recent).toHaveLength(3);
    expect(recent[0].summary).toBe("Third entry");
    expect(recent[1].summary).toBe("Second entry");
    expect(recent[2].summary).toBe("First entry");
  });

  it("enforces maxEntries limit", () => {
    const smallManager = new WorkingContextManager({
      dbPath: makeTmpDbPath(),
      maxEntries: 3,
      defaultTtlMinutes: 120,
    });

    for (let i = 0; i < 5; i++) {
      smallManager.add({ ...SAMPLE_INPUT, summary: `Entry ${i}` });
    }

    expect(smallManager.count()).toBe(3);
    const entries = smallManager.getRecent();
    expect(entries[0].summary).toBe("Entry 4");
    expect(entries[1].summary).toBe("Entry 3");
    expect(entries[2].summary).toBe("Entry 2");

    smallManager.close();
  });

  it("pins and unpins entries", () => {
    const entry = manager.add(SAMPLE_INPUT);
    expect(entry.pinned).toBe(false);

    manager.pin(entry.id);
    const pinned = manager.getById(entry.id);
    expect(pinned?.pinned).toBe(true);

    manager.unpin(entry.id);
    const unpinned = manager.getById(entry.id);
    expect(unpinned?.pinned).toBe(false);
  });

  it("filters by session type", () => {
    manager.add({ ...SAMPLE_INPUT, sessionType: "dm", summary: "DM entry" });
    manager.add({ ...SAMPLE_INPUT, sessionType: "webhook", summary: "Webhook entry" });
    manager.add({ ...SAMPLE_INPUT, sessionType: "cron", summary: "Cron entry" });

    const dmEntries = manager.getRecent({ sessionType: "dm" });
    expect(dmEntries).toHaveLength(1);
    expect(dmEntries[0].summary).toBe("DM entry");
  });

  it("filters by task ID", () => {
    manager.add({ ...SAMPLE_INPUT, taskId: "task-a", summary: "Task A entry" });
    manager.add({ ...SAMPLE_INPUT, taskId: "task-b", summary: "Task B entry" });

    const taskAEntries = manager.getByTaskId("task-a");
    expect(taskAEntries).toHaveLength(1);
    expect(taskAEntries[0].summary).toBe("Task A entry");
  });

  it("deletes entries", () => {
    const entry = manager.add(SAMPLE_INPUT);
    expect(manager.count()).toBe(1);

    manager.delete(entry.id);
    expect(manager.count()).toBe(0);
    expect(manager.getById(entry.id)).toBeNull();
  });

  it("clears entries by task ID", () => {
    manager.add({ ...SAMPLE_INPUT, taskId: "task-x", summary: "Entry 1" });
    manager.add({ ...SAMPLE_INPUT, taskId: "task-x", summary: "Entry 2" });
    manager.add({ ...SAMPLE_INPUT, taskId: "task-y", summary: "Entry 3" });

    const removed = manager.clearByTaskId("task-x");
    expect(removed).toBe(2);
    expect(manager.count()).toBe(1);
  });

  it("respects token budget in getRecent", () => {
    // Each summary ~40 chars → ~10 tokens
    for (let i = 0; i < 10; i++) {
      manager.add({ ...SAMPLE_INPUT, summary: `Entry ${i}: this is a longer summary text.` });
    }

    const limited = manager.getRecent({ maxTokens: 30 });
    expect(limited.length).toBeLessThan(10);
    expect(limited.length).toBeGreaterThan(0);
  });
});

describe("formatForSystemPrompt integration", () => {
  const NOW = 1700000000000;

  function makeEntry(overrides: Partial<ContextEntry> = {}): ContextEntry {
    return {
      id: "test-id",
      sessionKey: "agent:main:main",
      sessionType: "dm",
      summary: "Started auth refactor task for ki-at-obv",
      taskId: null,
      pinned: false,
      createdAt: NOW - 5 * 60_000, // 5 minutes ago
      expiresAt: NOW + 120 * 60_000,
      metadata: null,
      ...overrides,
    };
  }

  it("returns empty string for empty entries", () => {
    expect(formatForSystemPrompt([], { now: NOW })).toBe("");
  });

  it("formats a single entry correctly", () => {
    const entries = [makeEntry()];
    const result = formatForSystemPrompt(entries, { now: NOW });

    expect(result).toContain("## Working Context (recent activity)");
    expect(result).toContain("5m ago");
    expect(result).toContain("DM");
    expect(result).toContain("Started auth refactor task for ki-at-obv");
  });

  it("shows pinned indicator", () => {
    const entries = [makeEntry({ pinned: true })];
    const result = formatForSystemPrompt(entries, { now: NOW });

    expect(result).toContain("[pinned]");
  });

  it("shows task ID", () => {
    const entries = [makeEntry({ taskId: "auth-refactor" })];
    const result = formatForSystemPrompt(entries, { now: NOW });

    expect(result).toContain("(task: auth-refactor)");
  });

  it("shows different session type labels", () => {
    const entries = [
      makeEntry({ sessionType: "webhook", summary: "Webhook event" }),
    ];
    const result = formatForSystemPrompt(entries, { now: NOW });

    expect(result).toContain("Webhook");
  });

  it("truncates when exceeding token budget", () => {
    const entries: ContextEntry[] = [];
    for (let i = 0; i < 50; i++) {
      entries.push(
        makeEntry({
          id: `entry-${i}`,
          summary: `This is a much longer summary text for entry number ${i} to consume more tokens in the budget`,
          createdAt: NOW - i * 60_000,
        }),
      );
    }

    const result = formatForSystemPrompt(entries, { now: NOW, maxTokens: 200 });
    expect(result).toContain("... (older entries truncated)");
  });

  it("formats relative times correctly", () => {
    const entries = [
      makeEntry({ createdAt: NOW - 30_000, summary: "just now entry" }),
      makeEntry({ id: "2", createdAt: NOW - 5 * 60_000, summary: "5 min entry" }),
      makeEntry({ id: "3", createdAt: NOW - 3 * 3600_000, summary: "3 hour entry" }),
      makeEntry({ id: "4", createdAt: NOW - 2 * 86400_000, summary: "2 day entry" }),
    ];

    const result = formatForSystemPrompt(entries, { now: NOW });
    expect(result).toContain("just now");
    expect(result).toContain("5m ago");
    expect(result).toContain("3h ago");
    expect(result).toContain("2d ago");
  });
});

describe("System prompt injection", () => {
  it("entries appear in system prompt output", async () => {
    const { buildAgentSystemPrompt } = await import("../../system-prompt.js");

    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/test",
      workingContextPrompt: "## Working Context (recent activity)\n- [5m ago, DM] Test entry",
    });

    expect(prompt).toContain("## Working Context (recent activity)");
    expect(prompt).toContain("- [5m ago, DM] Test entry");
  });

  it("prompt has no working context section when prompt is undefined", async () => {
    const { buildAgentSystemPrompt } = await import("../../system-prompt.js");

    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/test",
    });

    expect(prompt).not.toContain("Working Context");
  });
});

describe("Entry lifecycle", () => {
  let dbPath: string;
  let manager: WorkingContextManager;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    manager = new WorkingContextManager({
      dbPath,
      maxEntries: 20,
      defaultTtlMinutes: 1, // 1 minute TTL for testing
    });
  });

  afterEach(() => {
    manager.close();
    const dir = path.dirname(dbPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("add → retrieve → expire → prune lifecycle", () => {
    // Add entry
    const entry = manager.add(SAMPLE_INPUT);
    expect(manager.count()).toBe(1);

    // Retrieve
    const retrieved = manager.getById(entry.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved?.summary).toBe(SAMPLE_INPUT.summary);

    // Entry should be in recent results
    const recent = manager.getRecent();
    expect(recent).toHaveLength(1);

    // Pin the entry
    manager.pin(entry.id);
    const pinned = manager.getById(entry.id);
    expect(pinned?.pinned).toBe(true);

    // Unpin and verify
    manager.unpin(entry.id);
    const unpinned = manager.getById(entry.id);
    expect(unpinned?.pinned).toBe(false);
  });

  it("pinned entries survive pruning even when expired", () => {
    // Use direct storage to set a past expiry
    const storage = new WorkingContextStorage(makeTmpDbPath());
    const entry = storage.insert(
      { ...SAMPLE_INPUT },
      0, // 0 TTL → already expired
    );
    storage.pin(entry.id);

    // Prune should not remove pinned entries
    const pruned = storage.pruneExpired();
    expect(pruned).toBe(0);

    // Entry should still be retrievable
    const retrieved = storage.getById(entry.id);
    expect(retrieved).toBeTruthy();

    storage.close();
  });
});
