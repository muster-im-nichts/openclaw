import type { AgentEventPayload } from "../../infra/agent-events.js";
import { loadConfig } from "../../config/config.js";
import { getWorkingContextManager, resolveWorkingContextConfig } from "./singleton.js";
import type { SessionType } from "./types.js";

/**
 * Map a session key to a SessionType for working context entries.
 * Session keys follow the format: `agent:<agentId>:<type>:<details>`
 */
function mapSessionType(sessionKey: string): SessionType {
  const parts = sessionKey.split(":");
  // agent:main:telegram:group:-1234567 → "group"
  // agent:main:main → "dm"
  // hook:<uuid> → "webhook"
  // cron:<jobId> → "cron"
  if (parts[0] === "cron") return "cron";
  if (parts[0] === "hook") return "webhook";
  if (parts.length >= 4 && parts[2] === "telegram" && parts[3] === "group") return "group";
  if (parts.length >= 4 && parts[2] === "discord" && parts[3] === "group") return "group";
  if (parts.length >= 4 && parts[2] === "signal" && parts[3] === "group") return "group";
  return "dm";
}

/**
 * Build a summary from the agent event data.
 * MVP: use truncated text from the event data. No LLM call.
 */
function buildSummary(evt: AgentEventPayload, sessionKey: string): string {
  const parts: string[] = [];

  // Add session context
  parts.push(`[${sessionKey}]`);

  // If there's assistant text, use it
  if (typeof evt.data?.text === "string" && evt.data.text.trim()) {
    const text = evt.data.text.trim();
    const truncated = text.length > 180 ? text.slice(0, 177) + "..." : text;
    parts.push(truncated);
  } else {
    parts.push("Agent turn completed");
  }

  return parts.join(" ");
}

// Track accumulated text per run for summarization
const runTextBuffers = new Map<string, string>();
const runSessionKeys = new Map<string, string>();

/**
 * Create an agent event listener that captures working context entries
 * after agent turns complete.
 */
export function createWorkingContextCaptureHandler() {
  return (evt: AgentEventPayload) => {
    const sessionKey = evt.sessionKey;

    // Accumulate assistant text for summarization
    if (evt.stream === "assistant" && typeof evt.data?.text === "string") {
      if (sessionKey) {
        runTextBuffers.set(evt.runId, evt.data.text);
        runSessionKeys.set(evt.runId, sessionKey);
      }
      return;
    }

    // Only capture on turn completion
    const lifecyclePhase =
      evt.stream === "lifecycle" && typeof evt.data?.phase === "string"
        ? evt.data.phase
        : null;

    if (lifecyclePhase !== "end") {
      // Clean up on error
      if (lifecyclePhase === "error") {
        runTextBuffers.delete(evt.runId);
        runSessionKeys.delete(evt.runId);
      }
      return;
    }

    const resolvedSessionKey = sessionKey ?? runSessionKeys.get(evt.runId);
    if (!resolvedSessionKey) {
      runTextBuffers.delete(evt.runId);
      runSessionKeys.delete(evt.runId);
      return;
    }

    try {
      const cfg = loadConfig();
      const wcConfig = resolveWorkingContextConfig(cfg);
      if (!wcConfig.enabled || !wcConfig.autoCapture) {
        return;
      }

      const manager = getWorkingContextManager(cfg);
      if (!manager) return;

      // Build summary from accumulated text
      const accumulatedText = runTextBuffers.get(evt.runId);
      let summary: string;
      if (accumulatedText && accumulatedText.trim()) {
        const text = accumulatedText.trim();
        summary = text.length > 200 ? text.slice(0, 197) + "..." : text;
      } else {
        summary = "Agent turn completed";
      }

      manager.add({
        sessionKey: resolvedSessionKey,
        sessionType: mapSessionType(resolvedSessionKey),
        summary,
      });
    } catch {
      // Silently ignore capture errors - working context is best-effort
    } finally {
      runTextBuffers.delete(evt.runId);
      runSessionKeys.delete(evt.runId);
    }
  };
}
