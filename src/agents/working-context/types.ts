import { z } from "zod";

// Session types matching OpenClaw's session model
export const SESSION_TYPES = ["dm", "webhook", "cron", "group"] as const;

export const SessionTypeSchema = z.enum(SESSION_TYPES);

export type SessionType = z.infer<typeof SessionTypeSchema>;

// Schema for creating a new context entry
export const CreateEntrySchema = z.object({
  sessionKey: z.string().min(1),
  sessionType: SessionTypeSchema,
  summary: z.string().min(1),
  taskId: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type CreateEntryInput = z.infer<typeof CreateEntrySchema>;

// Full context entry as stored in the database
export type ContextEntry = {
  id: string;
  sessionKey: string;
  sessionType: SessionType;
  summary: string;
  taskId: string | null;
  pinned: boolean;
  createdAt: number; // Unix timestamp ms
  expiresAt: number; // Unix timestamp ms
  metadata: Record<string, string> | null;
};

// Configuration for WorkingContextManager
export const ManagerConfigSchema = z.object({
  dbPath: z.string().min(1),
  maxEntries: z.number().int().positive().default(20),
  defaultTtlMinutes: z.number().int().nonnegative().default(120),
});

export type ManagerConfig = z.infer<typeof ManagerConfigSchema>;

// Options for querying recent entries
export type GetRecentOptions = {
  maxTokens?: number;
  maxAge?: number; // minutes
  sessionType?: SessionType;
  taskId?: string;
};

// Raw row shape from SQLite
export type ContextEntryRow = {
  id: string;
  session_key: string;
  session_type: string;
  summary: string;
  task_id: string | null;
  pinned: number; // SQLite stores booleans as 0/1
  created_at: number;
  expires_at: number;
  metadata: string | null; // JSON string
};
