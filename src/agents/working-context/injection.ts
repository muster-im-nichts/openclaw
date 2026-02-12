import type { ContextEntry, SessionType } from "./types.js";

const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  dm: "DM",
  webhook: "Webhook",
  cron: "Cron",
  group: "Group",
};

function formatRelativeTime(timestampMs: number, nowMs: number): string {
  const diffMs = nowMs - timestampMs;
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// Rough token estimate: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function formatEntry(entry: ContextEntry, nowMs: number): string {
  const time = formatRelativeTime(entry.createdAt, nowMs);
  const label = SESSION_TYPE_LABELS[entry.sessionType];
  const pin = entry.pinned ? " [pinned]" : "";
  const task = entry.taskId ? ` (task: ${entry.taskId})` : "";
  return `- [${time}, ${label}${pin}]${task} ${entry.summary}`;
}

export type FormatOptions = {
  maxTokens?: number;
  now?: number; // Unix timestamp ms, defaults to Date.now()
};

export function formatForSystemPrompt(
  entries: ContextEntry[],
  options: FormatOptions = {},
): string {
  if (entries.length === 0) {
    return "";
  }

  const nowMs = options.now ?? Date.now();
  const maxTokens = options.maxTokens ?? 2000;
  const header = "## Working Context (recent activity)\n";
  let budget = maxTokens - estimateTokens(header);

  const lines: string[] = [];

  for (const entry of entries) {
    const line = formatEntry(entry, nowMs);
    const lineTokens = estimateTokens(line);

    if (budget - lineTokens < 0) {
      lines.push("- ... (older entries truncated)");
      break;
    }

    lines.push(line);
    budget -= lineTokens;
  }

  return header + lines.join("\n");
}
