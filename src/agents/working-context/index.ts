export { WorkingContextManager, estimateTokens } from "./manager.js";
export { WorkingContextStorage } from "./storage.js";
export { formatForSystemPrompt } from "./injection.js";
export type { FormatOptions } from "./injection.js";
export {
  getWorkingContextManager,
  closeWorkingContextManager,
  resolveWorkingContextConfig,
} from "./singleton.js";
export {
  CreateEntrySchema,
  ManagerConfigSchema,
  SessionTypeSchema,
  SESSION_TYPES,
} from "./types.js";
export type {
  ContextEntry,
  CreateEntryInput,
  GetRecentOptions,
  ManagerConfig,
  SessionType,
} from "./types.js";
