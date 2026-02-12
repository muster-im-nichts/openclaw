import path from "node:path";
import fs from "node:fs";
import type { OpenClawConfig } from "../../config/types.js";
import { resolveStateDir } from "../../config/paths.js";
import { WorkingContextManager } from "./manager.js";
import type { ManagerConfig } from "./types.js";

let instance: WorkingContextManager | null = null;

const DEFAULTS = {
  enabled: true,
  maxEntries: 20,
  defaultTtlMinutes: 120,
  maxInjectedTokens: 2000,
  autoCapture: true,
} as const;

export function resolveWorkingContextConfig(cfg?: OpenClawConfig) {
  const wc = cfg?.workingContext;
  return {
    enabled: wc?.enabled ?? DEFAULTS.enabled,
    maxEntries: wc?.maxEntries ?? DEFAULTS.maxEntries,
    defaultTtlMinutes: wc?.defaultTtlMinutes ?? DEFAULTS.defaultTtlMinutes,
    maxInjectedTokens: wc?.maxInjectedTokens ?? DEFAULTS.maxInjectedTokens,
    autoCapture: wc?.autoCapture ?? DEFAULTS.autoCapture,
  };
}

function resolveDbPath(): string {
  const stateDir = resolveStateDir();
  const dbDir = path.join(stateDir, "working-context");
  fs.mkdirSync(dbDir, { recursive: true });
  return path.join(dbDir, "context.db");
}

/**
 * Get or create the global WorkingContextManager instance.
 * Returns null if working context is disabled in config.
 */
export function getWorkingContextManager(cfg?: OpenClawConfig): WorkingContextManager | null {
  const resolved = resolveWorkingContextConfig(cfg);
  if (!resolved.enabled) {
    return null;
  }

  if (instance) {
    return instance;
  }

  const managerConfig: ManagerConfig = {
    dbPath: resolveDbPath(),
    maxEntries: resolved.maxEntries,
    defaultTtlMinutes: resolved.defaultTtlMinutes,
  };

  instance = new WorkingContextManager(managerConfig);
  return instance;
}

/**
 * Close and discard the singleton instance.
 * Used during shutdown or testing.
 */
export function closeWorkingContextManager(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/** Reset for testing only. */
export function _resetForTest(): void {
  instance = null;
}
