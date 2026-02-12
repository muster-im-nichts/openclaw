# Phase 2: Working Context Layer - OpenClaw Integration

## Status: Complete

## Files Created

### Core Working Context Module (`src/agents/working-context/`)
- `types.ts` - Zod schemas and TypeScript types (ContextEntry, SessionType, CreateEntryInput, etc.)
- `storage.ts` - SQLite persistence layer using better-sqlite3 (WAL mode, indexed queries)
- `manager.ts` - High-level API: add/get/pin/delete/prune entries with token budget truncation
- `injection.ts` - Formatting for system prompt injection (relative time, session labels, token budget)
- `singleton.ts` - Global singleton manager with lazy initialization from OpenClaw config
- `capture.ts` - Agent event listener that auto-captures turn summaries for cross-session context
- `index.ts` - Module barrel exports
- `__tests__/integration.test.ts` - 20 integration tests covering full lifecycle

## Files Modified

### Config Schema
- `src/config/zod-schema.ts` - Added `workingContext` section (enabled, maxEntries, defaultTtlMinutes, maxInjectedTokens, autoCapture)
- `src/config/types.openclaw.ts` - Added `workingContext` type to `OpenClawConfig`

### System Prompt
- `src/agents/system-prompt.ts` - Added `workingContextPrompt` parameter; injects after Project Context section
- `src/agents/pi-embedded-runner/system-prompt.ts` - Passes `workingContextPrompt` through to `buildAgentSystemPrompt`

### System Prompt Callers
- `src/agents/pi-embedded-runner/run/attempt.ts` - Fetches working context entries and formats prompt at system prompt build time
- `src/agents/cli-runner/helpers.ts` - Same working context injection for CLI runner

### Gateway Integration
- `src/gateway/server.impl.ts` - Registers agent event listener for auto-capture; cleans up on shutdown

### Dependencies
- `package.json` - Added `better-sqlite3` (dependency) and `@types/better-sqlite3` (devDependency)

## How to Test

### Run the integration tests:
```bash
pnpm vitest run src/agents/working-context/__tests__/integration.test.ts
```

### Typecheck:
```bash
npx tsc --noEmit
```
(Pre-existing extension errors unrelated to this change are expected)

### Manual testing:
1. Add `workingContext` to your `openclaw.json`:
```json
{
  "workingContext": {
    "enabled": true,
    "maxEntries": 20,
    "defaultTtlMinutes": 120,
    "maxInjectedTokens": 2000,
    "autoCapture": true
  }
}
```
2. Start the gateway and send messages across sessions
3. Check system prompt via `/context` command - should include "Working Context (recent activity)" section
4. The SQLite database is stored at `~/.openclaw/working-context/context.db`

## Architecture

```
Agent Turn Completes
    │
    ▼
capture.ts listener (onAgentEvent)
    │
    ▼
WorkingContextManager.add()
    │  - validates input (Zod)
    │  - prunes expired entries
    │  - stores in SQLite
    │  - enforces maxEntries
    ▼
System Prompt Build (next turn)
    │
    ▼
getRecent({maxTokens, maxAge})
    │  - queries SQLite (pinned first, then by recency)
    │  - truncates to token budget
    ▼
formatForSystemPrompt()
    │  - relative timestamps (just now, 5m ago, 3h ago)
    │  - session type labels (DM, Webhook, Cron, Group)
    │  - pinned/task indicators
    ▼
Injected into system prompt after "# Project Context"
```

## Configuration Defaults
| Setting | Default | Description |
|---------|---------|-------------|
| enabled | true | Enable/disable working context |
| maxEntries | 20 | Maximum stored entries |
| defaultTtlMinutes | 120 | Entry expiration (2 hours) |
| maxInjectedTokens | 2000 | Token budget for prompt injection |
| autoCapture | true | Auto-capture agent turn summaries |

## Issues / Notes
- `better-sqlite3` requires native compilation. The prebuilt binary from Node 22 was used; environments without `make`/`gcc` may need a prebuild or Docker layer.
- The `~4 chars/token` heuristic is used for token estimation (as agreed). Can integrate `js-tiktoken` later.
- Session type mapping in `capture.ts` uses simple string prefix matching on session keys. This works for the documented key formats.

## Suggestions for Phase 3
1. **LLM-powered summarization**: Replace truncated-text summaries with LLM-generated one-liners for better context density
2. **Manual context tools**: Add agent tools to pin/unpin/list/clear working context entries
3. **Task awareness**: Extract task IDs from agent turns (e.g., from tool calls or explicit task markers)
4. **Cross-agent visibility**: When multi-agent is enabled, allow configurable cross-agent context sharing
5. **Token counting**: Integrate `js-tiktoken` for accurate token counting instead of the 4-char heuristic
6. **Context compaction**: When approaching token budget, summarize older entries together instead of truncating
