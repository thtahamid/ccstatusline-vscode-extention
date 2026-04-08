# Product Requirements Document
# ccstatusline-vscode

**Version:** 1.0  
**Status:** Draft  
**Last Updated:** 2026-04-04

---

## Table of Contents

1. [Overview](#1-overview)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [User Personas](#4-user-personas)
5. [Functional Requirements](#5-functional-requirements)
6. [Data Sources & Architecture](#6-data-sources--architecture)
7. [Feature Specifications](#7-feature-specifications)
8. [Settings & Configuration](#8-settings--configuration)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Out of Scope](#10-out-of-scope)
11. [Success Metrics](#11-success-metrics)
12. [Open Questions](#12-open-questions)

---

## 1. Overview

**ccstatusline-vscode** is a VS Code extension that displays real-time Claude Code session statistics in the VS Code status bar. It brings the terminal-based `ccstatusline` experience to the VS Code chat UI — surfacing model name, context window usage, token counts, estimated cost, session duration, and git context directly in the editor without leaving the IDE.

The extension reads session data written by Claude Code to `~/.claude/` and renders it as a native VS Code status bar item with a rich hover tooltip.

---

## 2. Problem Statement

### Background

The Claude Code CLI (terminal) supports a **statusline** feature — a customizable bar at the bottom of the terminal configured via `~/.claude/settings.json`. It displays session info such as context usage, cost, model, git status, and token counts in real time, powered by a hook that pipes JSON session data to a shell script.

The community tool `ccstatusline` (`npx ccstatusline@latest`) provides a polished implementation of this terminal statusline with 35+ configurable widgets.

### The Gap

**The Claude Code VS Code extension has no equivalent feature.** When using Claude Code through the VS Code chat panel, users have no visibility into:

- How much of the context window is in use
- How much the session has cost so far
- Which model is active
- How long the session has been running
- Token consumption breakdown

The VS Code chat panel is a closed interface — there is no public API to inject UI into it directly, and Claude Code does not expose session data to the VS Code extension context the same way it does to CLI scripts.

### Impact

Users working in VS Code must either:
1. Switch to the terminal to check session stats (context-switch overhead)
2. Operate blind — not knowing context window pressure until Claude starts degrading
3. Run a separate terminal alongside VS Code purely for the statusline

This is particularly painful when context window pressure is high, as users have no warning before hitting the limit.

---

## 3. Goals & Non-Goals

### Goals

- Provide a **native VS Code status bar item** showing live Claude Code session stats
- Cover **~80% of ccstatusline terminal widgets** using data available on disk
- Work **automatically** — no configuration required to get started
- Work across **all VSCode-based editors**: VS Code, Cursor, Windsurf, VSCodium
- Stay **lightweight**: no runtime dependencies, < 100 KB installed size
- Be **non-intrusive**: hide entirely when Claude Code is not active in the workspace

### Non-Goals

- Injecting UI into the Claude Code chat panel itself
- Replicating features that require the CLI stdin pipe hook (rate limits, vim mode)
- Supporting JetBrains or Zed (different plugin systems)
- Building a standalone sidebar panel (status bar item is sufficient for v1)
- Replacing or competing with the terminal `ccstatusline` tool

---

## 4. User Personas

### Primary: VS Code Power User with Claude Code

- Uses Claude Code via the VS Code extension daily for software development
- Has an active Claude Pro or Claude API subscription
- Cares about context window usage and session cost
- Currently uses or is aware of the terminal `ccstatusline` tool
- Wants the same information without switching to the terminal

### Secondary: Multi-workspace Developer

- Has multiple projects open simultaneously in VS Code
- Runs Claude Code sessions in several workspaces
- Needs to know which workspace's session is active and its current state

### Tertiary: Cost-conscious API User

- Uses Claude Code with an Anthropic API key (not subscription)
- Actively tracks token spend per session
- Needs real-time cost estimates to manage usage

---

## 5. Functional Requirements

### FR-1: Session Detection

| ID | Requirement |
|---|---|
| FR-1.1 | Detect active Claude Code sessions for the current workspace by reading `~/.claude/sessions/*.json` |
| FR-1.2 | Verify session liveness by checking if the session PID is a running process |
| FR-1.3 | Match sessions to the current workspace using the `cwd` field (exact match or child path) |
| FR-1.4 | When multiple live sessions match the workspace, select the most recently active one |
| FR-1.5 | Hide the status bar item entirely when no live session is found for the current workspace |
| FR-1.6 | Update session state within 1 second of a session starting or stopping |

### FR-2: Data Extraction

| ID | Requirement |
|---|---|
| FR-2.1 | Parse `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` to extract session metrics |
| FR-2.2 | Accumulate token counts across all non-sidechain `assistant` entries in the JSONL |
| FR-2.3 | Use the last non-sidechain `assistant` entry for context window % calculation |
| FR-2.4 | Exclude `isSidechain: true` assistant entries from context length (but include in cost totals) |
| FR-2.5 | Extract session name from `ai-title` JSONL entries |
| FR-2.6 | Update displayed stats within 1 second of the JSONL file being written to |

### FR-3: Display

| ID | Requirement |
|---|---|
| FR-3.1 | Show a status bar item with active session indicator, model name, context bar, cost, and duration by default |
| FR-3.2 | Show a hover tooltip with full session details: all token counts, context %, cost, model, version, branch, session name, CWD, session ID |
| FR-3.3 | Color the status bar item yellow when context window is 60–80% full |
| FR-3.4 | Color the status bar item red when context window is > 80% full |
| FR-3.5 | Support clicking the status bar item to open a full session details view |
| FR-3.6 | Provide a Command Palette command "Claude Code: Show Session Details" |

### FR-4: Configuration

| ID | Requirement |
|---|---|
| FR-4.1 | All display features are individually togglable via VS Code settings |
| FR-4.2 | Settings changes take effect immediately without a window reload |
| FR-4.3 | Support overriding the `~/.claude` directory path via setting (and `CLAUDE_CONFIG_DIR` env var) |
| FR-4.4 | Support configuring status bar alignment (left/right) and priority |

---

## 6. Data Sources & Architecture

### Data Sources

Claude Code writes three categories of files to `~/.claude/` that are useful to this extension:

#### `~/.claude/sessions/<pid>.json`
One file per active session. Written when a session starts, persists after the session ends (not cleaned up).

```json
{
  "pid": 11219,
  "sessionId": "46e16423-85b1-4529-af0b-760cfc0a096e",
  "cwd": "/Users/th/github/ccstatusline_vscode_extention",
  "startedAt": 1775302821468,
  "kind": "interactive",
  "entrypoint": "claude-vscode"
}
```

Used for: session discovery, workspace matching, session duration, PID liveness check.

#### `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
Conversation history in JSON Lines format. Appended to after each model response.

Each `assistant` entry contains:
```json
{
  "type": "assistant",
  "isSidechain": false,
  "timestamp": "2026-04-04T11:41:11.671Z",
  "sessionId": "46e16423...",
  "cwd": "/Users/th/github/...",
  "gitBranch": "HEAD",
  "version": "2.1.92",
  "message": {
    "model": "claude-sonnet-4-6",
    "usage": {
      "input_tokens": 74,
      "output_tokens": 9632,
      "cache_creation_input_tokens": 43068,
      "cache_read_input_tokens": 1340870,
      "speed": "standard"
    }
  }
}
```

Used for: model name, all token counts, cost calculation, context %, speed mode, git branch, version.

**CWD encoding:** `cwd.replace(/[/\\:]/g, '-').replace(/_/g, '-')`
Example: `/Users/th/github/my_project` → `-Users-th-github-my-project`

#### `~/.claude/ide/<pid>.lock`
Written by the Claude Code VS Code extension. Contains workspace folders and IDE name.

```json
{
  "pid": 88480,
  "workspaceFolders": ["/Users/th/github/ccstatusline_vscode_extention"],
  "ideName": "Visual Studio Code",
  "transport": "ws",
  "authToken": "..."
}
```

Used for: additional workspace folder matching, IDE detection.

### Architecture

```
fs.watch(~/.claude/sessions/)      fs.watch(<session>.jsonl)
         │                                   │
         └──────────────┬────────────────────┘
                        ▼
                  SessionManager
                  (central coordinator)
                  ┌─────────────────────────────────┐
                  │ 1. readLiveSessions()            │
                  │ 2. filter by workspace cwd       │
                  │ 3. PID liveness check            │
                  │ 4. select best session           │
                  │ 5. parseJsonlFile()              │
                  │ 6. compute cost + context %      │
                  │ 7. emit onDidChangeStats         │
                  └─────────────────────────────────┘
                        │
                        ▼
                  StatusBarController
                  renders text + tooltip
                        │
                        ▼
                  vscode.StatusBarItem
```

**Update triggers:**
- `fs.watch` on sessions directory (session start/stop)
- `fs.watch` on active JSONL file (new model responses)
- Periodic poll timer (2 s default, fallback for missed watch events)
- `vscode.workspace.onDidChangeWorkspaceFolders`

**Debounce:** 200 ms on watcher events to coalesce burst writes.

---

## 7. Feature Specifications

### 7.1 Status Bar Item

**Default display:**
```
⬤ sonnet-4-6  21%[██░░░░░░░░]  $0.058  17m
```

| Component | Source | Default |
|---|---|---|
| Active indicator `⬤` | PID alive + workspace match | Always shown |
| Model name | JSONL `message.model` | Short (strip `claude-` prefix) |
| Context % | tokens / model window size | Shown |
| Context bar `[██░░░░░░░░]` | Same, 10-char Unicode blocks | Shown |
| Estimated cost | tokens × pricing table | Shown |
| Session duration | `Date.now() - startedAt` | Shown |
| Git branch | JSONL `gitBranch` | Hidden by default |
| Token count | Cumulative totals | Hidden by default |
| Session name | JSONL `ai-title` entry | Hidden by default |

### 7.2 Hover Tooltip

Full session details rendered as a `MarkdownString`:

```
Claude Code Session
―――――――――――――――――――――――――――――――――――

| Model    | claude-sonnet-4-6         |
| Speed    | standard                  |
| Version  | 2.1.92                    |
| Branch   | main                      |
| Session  | My project exploration    |
| ID       | 46e16423...               |
| Duration | 17m                       |
| CWD      | ~/github/my-project       |

―――――――――――――――――――――――――――――――――――

Context Window

21% used  [████░░░░░░░░░░░░░░░░]  42,788 / 200,000 tokens

―――――――――――――――――――――――――――――――――――

Tokens (this session)

| Input        |         74 |
| Output       |      9,632 |
| Cache writes |     43,068 |
| Cache reads  |  1,340,870 |
| Total        |  1,393,644 |

―――――――――――――――――――――――――――――――――――

Cost: ~$0.058 USD (estimated)
```

### 7.3 Session Details View

Opened by clicking the status bar item or via Command Palette. Opens a read-only plain text document with the same information as the tooltip, formatted for readability.

### 7.4 Context Window Color Coding

| Usage | Status Bar Color |
|---|---|
| 0–59% | Default (inherits VS Code theme) |
| 60–79% | Warning yellow (`statusBarItem.warningBackground`) |
| 80–100% | Error red (`statusBarItem.errorBackground`) |

### 7.5 Cost Estimation

Cost is computed locally from token counts using a bundled pricing table. The `total_cost_usd` field sent by Claude Code's stdin hook is not written to disk.

**Formula:**
```
cost = (inputTokens × inputPrice
      + outputTokens × outputPrice
      + cacheWriteTokens × cacheWritePrice
      + cacheReadTokens × cacheReadPrice) / 1,000,000
```

Pricing table is keyed by model prefix (e.g. `claude-sonnet-4` matches `claude-sonnet-4-6`). Falls back to Sonnet pricing when model is unknown. The pricing table is updated with each extension release.

### 7.6 Context Window Size

Context window sizes are stored in a bundled lookup table by model prefix. Models with `[1m]` or `1M` in their ID are treated as 1,000,000 token context. Default: 200,000.

### 7.7 Feature Parity with ccstatusline Terminal Tool

| ccstatusline Widget | VSCode Extension | Notes |
|---|---|---|
| Model | ✅ Full | |
| Version | ✅ Full | |
| Session cost | ✅ Estimated | Calculated, not exact |
| Session clock / duration | ✅ Full | |
| Context % used | ✅ Full | |
| Context bar | ✅ Full | |
| Context length (tokens) | ✅ Full | |
| Input tokens | ✅ Full | |
| Output tokens | ✅ Full | |
| Cached tokens | ✅ Full | |
| Total tokens | ✅ Full | |
| Session usage (cumulative) | ✅ Full | |
| Git branch | ✅ Full | |
| Working directory | ✅ Full | |
| Session ID | ✅ Full | |
| Session name | ✅ Full | From `ai-title` JSONL entry |
| Speed mode (fast/standard) | ✅ Full | |
| Input/output speed (tok/s) | ✅ Approximate | Derived from JSONL timestamps |
| Git insertions/deletions | ⚠️ Opt-in | Requires `git diff --stat` subprocess |
| Git root / worktree | ⚠️ Opt-in | Requires `git rev-parse` subprocess |
| Thinking effort | ✅ Full | Inferred from model ID |
| Rate limits (5hr/7day) | ❌ Not available | Only in stdin pipe, not on disk |
| Vim mode | ❌ Not available | Only in stdin pipe, not on disk |
| Block timer / reset timer | ❌ Not available | Only in stdin pipe, not on disk |
| Weekly reset timer | ❌ Not available | Only in stdin pipe, not on disk |
| Terminal width | ❌ N/A | Terminal concept only |
| Powerline/custom fonts | ❌ N/A | Terminal rendering only |

---

## 8. Settings & Configuration

All settings are under the `ccstatusline` namespace.

| Setting | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable/disable the extension |
| `statusBarAlignment` | `"left"` \| `"right"` | `"right"` | Status bar position |
| `statusBarPriority` | number | `100` | Item priority within alignment group |
| `modelDisplayStyle` | `"short"` \| `"full"` \| `"hidden"` | `"short"` | `"short"` strips `claude-` prefix |
| `showContextBar` | boolean | `true` | Show % and progress bar |
| `showCost` | boolean | `true` | Show estimated cost |
| `showDuration` | boolean | `true` | Show session duration |
| `showGitBranch` | boolean | `false` | Show git branch in status bar |
| `showTokenCounts` | boolean | `false` | Show token total in status bar |
| `showSessionName` | boolean | `false` | Show session name in status bar |
| `pollIntervalMs` | number | `2000` | Fallback poll interval (ms). Min: 500 |
| `claudeConfigDir` | string | `""` | Override `~/.claude` path. Also respects `CLAUDE_CONFIG_DIR` env var |

---

## 9. Non-Functional Requirements

### Performance
- Status bar must update within **1 second** of a new Claude response completing
- JSONL parsing must complete in **< 50 ms** for files under 10 MB
- Extension must not measurably impact VS Code startup time (`onStartupFinished` activation event)
- CPU usage must be negligible when Claude is idle (no active polling beyond the 2 s timer tick)

### Reliability
- Extension must degrade gracefully when `~/.claude/` does not exist (first-run, non-Claude user)
- Malformed JSONL lines must be silently skipped without crashing
- PID check failures must be silently handled
- File system errors (permissions, missing files) must be logged to the Output channel, not surfaced as error dialogs

### Size & Dependencies
- **Zero runtime npm dependencies** — all file I/O uses Node.js built-ins
- Bundled `.vsix` size **under 100 KB** (using esbuild)
- `node_modules/` excluded from the `.vsix`

### Compatibility

| Editor | Support |
|---|---|
| VS Code | Full (primary target) |
| VS Code Insiders | Full |
| Cursor | Full (same extension API) |
| Windsurf | Full (VSCode fork) |
| VSCodium | Full (same API) |
| JetBrains | Not supported (v1) |
| Zed | Not supported (v1) |

**Minimum VS Code engine version:** `1.94.0`  
**Node.js target:** `node18` (VS Code 1.94 ships Node 18)  
**OS support:** macOS, Linux, Windows

### Security
- The extension reads files from `~/.claude/` in **read-only** mode — no writes
- The `authToken` field in `~/.claude/ide/*.lock` files is never read, logged, or displayed
- No network requests are made by the extension
- No telemetry is collected

---

## 10. Out of Scope

The following are explicitly excluded from v1:

| Feature | Reason |
|---|---|
| Rate limit display (5hr/7day) | Only available via Claude's stdin pipe hook, not on disk |
| Vim mode display | Same — only via stdin pipe |
| Injecting UI into the Claude chat panel | No public VS Code API for this |
| Custom widget system (like ccstatusline's TUI configurator) | Complexity; standard VS Code settings are sufficient |
| JetBrains plugin | Requires separate Kotlin implementation |
| Zed extension | Different extension system |
| Historical session stats / charts | Out of scope for a status bar item |
| Multi-session switcher UI | v2 candidate — single active session per workspace is sufficient for v1 |
| Open VSX Registry publishing | v2 — add as parallel CI step after Marketplace launch |

---

## 11. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Time-to-value | Status bar shows up within 5 seconds of VS Code opening with an active Claude session | Manual test |
| Update latency | Stats refresh within 1 s of a Claude response | Manual test |
| Extension size | Installed `.vsix` < 100 KB | `vsce package` output |
| Test coverage | All unit tests pass; zero skipped | CI |
| Marketplace rating | ≥ 4.0 stars after 20+ reviews | VS Code Marketplace |
| Weekly installs | 500+ within 60 days of launch | Marketplace analytics |
| Cross-editor compat | Works in VS Code, Cursor, and Windsurf without modification | Manual test on each |

---

## 12. Open Questions

| # | Question | Priority | Owner |
|---|---|---|---|
| Q1 | Does the CWD encoding formula (`replace(/[/\\:]/g, '-').replace(/_/g, '-')`) hold on Windows with UNC paths? Needs testing on `\\server\share\project` style paths. | High | Dev |
| Q2 | Should sidechain (subagent) turns be included in the cost total, or only in the context calculation? The ccstatusline source excludes them from context % but the cost behavior needs confirmation. | High | Dev |
| Q3 | What happens to JSONL files when Claude Code's auto-compact runs? Does it truncate the file, rewrite it, or append a summary? File watcher behavior may change. | Medium | Dev |
| Q4 | For the v1 multi-session case (multiple live PIDs for the same workspace), "most recently modified JSONL" is the selection heuristic. Should this be user-configurable in v1 or deferred to v2? | Low | PM |
| Q5 | Should the extension publish to the Open VSX Registry (for VSCodium) at launch, or add it as a v2 CI step? | Low | PM |
| Q6 | Is it worth reading the `~/.claude/ide/<pid>.lock` file to verify the workspace match, in addition to the sessions `cwd` field? Or is the sessions file sufficient? | Low | Dev |

---

## Appendix A: Key File Paths

| Path | Purpose |
|---|---|
| `~/.claude/sessions/<pid>.json` | Session discovery, PID, CWD, startedAt |
| `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` | Token usage, model, cost, git branch |
| `~/.claude/ide/<pid>.lock` | IDE name, workspace folders |
| `~/.claude/settings.json` | User's Claude settings (read for reference only) |

**CWD encoding examples:**

| CWD | Encoded |
|---|---|
| `/Users/th/github/my_project` | `-Users-th-github-my-project` |
| `/home/user/work/api-service` | `-home-user-work-api-service` |
| `C:\Users\name\project` | `C--Users-name-project` |

## Appendix B: Widgets Not Implementable in v1

The following ccstatusline terminal widgets require data from Claude's **stdin pipe hook** (`StatusJSON` payload), which is only available in the terminal. This data is not written to any file on disk:

- `rate_limits.five_hour` — 5-hour usage percentage and reset time
- `rate_limits.seven_day` — 7-day usage percentage and reset time
- `vim.mode` — current Vim mode (`NORMAL`, `INSERT`, etc.)
- `cost.total_cost_usd` — exact cost (we approximate from tokens instead)
- `context_window.used_percentage` — exact % (we compute from tokens instead)

These can only be implemented if Anthropic adds a file-based or IPC-based mechanism to expose session data to external processes — or if a future Claude Code version exposes an extension API.
