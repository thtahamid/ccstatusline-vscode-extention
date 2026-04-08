# ccstatusline VS Code Extension — 3-Phase Implementation Plan

## Architecture Overview

Fork ccstatusline into a monorepo containing the terminal tool alongside a new VS Code extension. The extension renders the same multi-line powerline ANSI output in a bottom panel using an embedded xterm.js widget, reusing ccstatusline's rendering pipeline directly.

**Key insight**: ccstatusline's rendering pipeline is a pure function chain: `StatusJSON` + file-derived metrics → `RenderContext` → `preRenderAllWidgets()` → `renderStatusLine()` → ANSI strings. The extension constructs the same `RenderContext` from disk data and calls the same renderer. No reimplementation needed.

---

## Monorepo Structure

```
ccstatusline/
  package.json                       # Root workspace config
  tsconfig.base.json                 # Shared TS compiler options
  packages/
    core/                            # Forked ccstatusline (shared engine + CLI)
      package.json                   # @ccstatusline/core
      tsconfig.json
      src/
        ccstatusline.ts              # Existing CLI entry point (unchanged)
        index.ts                     # NEW: library exports for the extension
        types/                       # All existing types (unchanged)
        utils/                       # All existing utils (unchanged)
        widgets/                     # All existing widgets (unchanged)
        tui/                         # TUI configurator (unchanged)
      dist/
    extension/                       # VS Code extension
      package.json                   # ccstatusline-vscode
      tsconfig.json
      esbuild.js                     # Bundles core + extension into single file
      .vscodeignore
      src/
        extension.ts                 # activate / deactivate
        panel/
          StatusPanelProvider.ts      # WebviewViewProvider for bottom panel
          panelHtml.ts               # HTML template with xterm.js
          PanelThemeSync.ts          # VS Code theme → xterm.js theme mapping
        session/
          SessionDiscovery.ts        # Find active Claude Code VS Code sessions
          StatusJSONBuilder.ts       # Construct StatusJSON from disk files
          RenderContextBuilder.ts    # Build RenderContext (mirrors ccstatusline.ts:88-155)
          TranscriptParser.ts        # Efficient JSONL tail-reading
        render/
          PipelineRunner.ts          # Orchestrates full render pipeline
        polling/
          SessionPoller.ts           # fs.watch + interval polling lifecycle
        config/
          SettingsSync.ts            # Watch ~/.config/ccstatusline/settings.json
          ExtensionSettings.ts       # VS Code-side settings reader
        errors/
          ErrorDisplay.ts            # Error/loading/no-session ANSI states
        media/
          xterm.js                   # Bundled xterm.js UMD
          xterm.css
          xterm-addon-fit.js         # Fit addon
          panel.js                   # Webview-side script
      out/                           # Compiled output
```

---

## Phase 1: Fork, Monorepo, xterm.js Panel Skeleton

### Goal

A working VS Code extension that registers a "Claude Code Status" tab in the bottom panel (alongside Problems/Output/Terminal), containing an xterm.js terminal widget rendering a hardcoded ANSI demo. The forked ccstatusline CLI continues to build and work independently.

### Shippable Output

A `.vsix` that installs into VS Code, adds the panel tab, and displays a static multi-line powerline demo. Proof that the rendering path works end-to-end.

### Files to Create

#### Root workspace

**`package.json`**
```json
{
  "private": true,
  "workspaces": ["packages/core", "packages/extension"],
  "scripts": {
    "build": "npm run build --workspaces",
    "build:core": "npm run build -w packages/core",
    "build:extension": "npm run build -w packages/extension"
  }
}
```

**`tsconfig.base.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

#### `packages/core/`

Fork of ccstatusline. Copy all source files from the repo.

**`packages/core/package.json`** — renamed to `@ccstatusline/core`, add `exports` field:
```json
{
  "name": "@ccstatusline/core",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "bin": { "ccstatusline": "dist/ccstatusline.js" }
}
```

**`packages/core/src/index.ts`** — new library entry point:
```typescript
// Render pipeline
export { preRenderAllWidgets, renderStatusLine, calculateMaxWidthsFromPreRendered } from './utils/renderer';
export { loadSettings, initConfigPath } from './utils/config';
export { updateColorMap } from './utils/colors';

// Data layer
export { getTokenMetrics, getSessionDuration, getSpeedMetricsCollection } from './utils/jsonl';
export { prefetchUsageDataIfNeeded } from './utils/usage-prefetch';
export { getSkillsMetrics } from './utils/skills';
export { advanceGlobalSeparatorIndex } from './utils/separator-index';
export { getVisibleText } from './utils/ansi';

// Types
export type { RenderContext } from './types/RenderContext';
export type { StatusJSON } from './types/StatusJSON';
export { StatusJSONSchema } from './types/StatusJSON';
export type { Settings } from './types/Settings';
export type { TokenMetrics, SpeedMetrics, SkillsMetrics, WidgetItem } from './types';
```

**`packages/core/tsconfig.json`** — extends base, `rootDir: "./src"`, `outDir: "./dist"`, `composite: true`.

#### `packages/extension/`

**`packages/extension/package.json`**
```json
{
  "name": "ccstatusline-vscode",
  "displayName": "Claude Code Status",
  "description": "Show Claude Code session stats in VS Code — powerline, tokens, cost, context",
  "version": "0.1.0",
  "publisher": "ccstatusline",
  "license": "MIT",
  "engines": { "vscode": "^1.94.0" },
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "viewsContainers": {
      "panel": [{
        "id": "ccstatusline",
        "title": "Claude Code Status",
        "icon": "images/icon.png"
      }]
    },
    "views": {
      "ccstatusline": [{
        "type": "webview",
        "id": "ccstatusline.statusPanel",
        "name": "Status"
      }]
    },
    "commands": [{
      "command": "ccstatusline.refresh",
      "title": "Claude Code: Refresh Status Panel"
    }]
  },
  "dependencies": {
    "@ccstatusline/core": "workspace:*"
  },
  "devDependencies": {
    "@types/vscode": "^1.94.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "esbuild": "^0.21.0",
    "xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@vscode/vsce": "^3.0.0"
  }
}
```

**`packages/extension/src/extension.ts`** — registers the webview view provider:
```typescript
import * as vscode from 'vscode';
import { StatusPanelProvider } from './panel/StatusPanelProvider';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Claude Code Status');
  const provider = new StatusPanelProvider(context.extensionUri, channel);

  context.subscriptions.push(
    channel,
    vscode.window.registerWebviewViewProvider(
      'ccstatusline.statusPanel',
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  channel.appendLine('ccstatusline-vscode activated');
}

export function deactivate(): void {}
```

**`packages/extension/src/panel/StatusPanelProvider.ts`** — WebviewViewProvider:
- Creates HTML with embedded xterm.js from `media/`
- Sends ANSI strings via `webview.postMessage({ type: 'render', ansi })` 
- Receives terminal column count via `webview.onDidReceiveMessage`
- Phase 1: sends hardcoded demo ANSI

**`packages/extension/src/panel/panelHtml.ts`** — generates the webview HTML:
- Loads xterm.js, xterm.css, addon-fit, panel.js via `webview.asWebviewUri()`
- Content security policy allowing scripts from extension media folder
- Container div for xterm.js terminal instance

**`packages/extension/src/media/panel.js`** — webview-side script:
- Initializes xterm `Terminal` with `{ disableStdin: true, cursorBlink: false }`
- Applies `FitAddon` for responsive sizing
- Listens for `message` events: on `{ type: 'render', ansi }`, clears terminal and writes content
- Reports column count back to extension host on resize
- Handles VS Code theme (background matching)

**`packages/extension/esbuild.js`** — build script:
- Entry: `src/extension.ts`
- Platform: `node`, Format: `cjs`
- External: `['vscode']`
- Bundle: `true` (inlines `@ccstatusline/core` and all deps)
- Output: `out/extension.js`
- Copies `media/` to `out/media/`

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Module system**: esbuild bundles ESM core → CJS extension | VS Code extension host requires `require()`. Core uses ESM. esbuild handles the conversion and tree-shakes away TUI/React code. |
| **xterm.js in webview** (not terminal API) | Full ANSI rendering support, exact visual parity with terminal. Webview panels persist as bottom tabs. |
| **`retainContextWhenHidden: true`** | Preserves xterm.js state when user switches to another panel tab. No re-render needed. |
| **Terminal width override** | Renderer calls `getTerminalWidth()`. We override via `RenderContext.terminalWidth` set to xterm.js column count reported from webview. |
| **chalk level forced to 3** | xterm.js supports truecolor. Force `chalk.level = 3` regardless of Node.js environment detection. |

### Acceptance Criteria

- [ ] `npm run build` from root succeeds
- [ ] `packages/core/dist/ccstatusline.js` works as standalone CLI (pipe JSON, get ANSI output)
- [ ] `.vsix` installs in VS Code and shows "Claude Code Status" panel tab at the bottom
- [ ] Panel renders multi-line colored powerline demo via xterm.js
- [ ] Resizing the panel refits the xterm.js terminal
- [ ] Webview state survives panel tab hide/show

---

## Phase 2: Data Layer & Live Rendering

### Goal

Connect the panel to live Claude Code session data. The extension discovers active VS Code sessions, reads JSONL transcripts, constructs `RenderContext`, calls ccstatusline's render pipeline, and displays real widget output. Manual refresh; no auto-polling yet.

### Shippable Output

Panel shows real session data using the user's `~/.config/ccstatusline/settings.json` widget layout, rendered identically to the terminal. A "Refresh" command updates it.

### Files to Create

**`packages/extension/src/session/SessionDiscovery.ts`**

Discovers active Claude Code VS Code sessions:
```typescript
export interface DiscoveredSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  entrypoint: string;       // "claude-vscode" | "cli"
  transcriptPath: string;   // resolved path to JSONL
}

export async function discoverActiveSessions(
  workspaceFolders: string[]
): Promise<DiscoveredSession[]>;
```

Logic:
- Read all `~/.claude/sessions/*.json` files
- Filter to `entrypoint === "claude-vscode"`
- Validate PID is still alive (`process.kill(pid, 0)`)
- Match session `cwd` against workspace folders
- Resolve transcript path: encode cwd as `cwd.replace(/[/\\:]/g, '-')` → look for `~/.claude/projects/<encoded>/<sessionId>.jsonl`
- Sort by `startedAt` descending, return most recent

**`packages/extension/src/session/StatusJSONBuilder.ts`**

Constructs a `StatusJSON` from disk data:
```typescript
export async function buildStatusJSON(
  session: DiscoveredSession
): Promise<StatusJSON>;
```

Reads the JSONL transcript to extract:
- `model` — from last assistant entry
- `version` — from last assistant entry
- `context_window` — from last assistant entry's usage data
- `cost.total_duration_ms` — computed from `session.startedAt`
- `session_id`, `transcript_path`, `cwd` — from session file

Fields not available from disk (set to `undefined`): `rate_limits`, `vim`, `output_style`.

**`packages/extension/src/session/RenderContextBuilder.ts`**

Mirrors the logic in `ccstatusline.ts` `renderMultipleLines()` (lines 88-155):
```typescript
export async function buildRenderContext(
  statusJSON: StatusJSON,
  settings: Settings,
  terminalWidth: number
): Promise<RenderContext>;
```

Steps:
1. Call `getTokenMetrics(statusJSON.transcript_path)` for token counts
2. Call `getSessionDuration(statusJSON.transcript_path)` if session-clock widget is configured
3. Call `prefetchUsageDataIfNeeded(settings.lines, statusJSON)` for usage API data
4. Call `getSpeedMetricsCollection()` if speed widgets are configured
5. Call `getSkillsMetrics()` if session_id is available
6. Set `context.terminalWidth = terminalWidth`
7. Assemble and return `RenderContext`

**`packages/extension/src/session/TranscriptParser.ts`**

Efficient JSONL tail-reader for large transcripts:
```typescript
export interface LastAssistantEntry {
  model: string;
  version: string;
  gitBranch: string;
  usage: { input_tokens: number; output_tokens: number;
           cache_creation_input_tokens: number;
           cache_read_input_tokens: number };
  timestamp: string;
  sessionName: string | null;  // from ai-title entries
}

export async function parseTranscriptTail(
  transcriptPath: string
): Promise<LastAssistantEntry | null>;
```

For files >1MB, reads only the last 64KB to find the most recent assistant entry. Full reads for smaller files.

**`packages/extension/src/render/PipelineRunner.ts`**

Orchestrates the full render:
```typescript
export interface RenderOutput {
  lines: string[];      // Each element is one ANSI-encoded line
  terminalWidth: number;
}

export async function runRenderPipeline(
  terminalCols: number,
  workspaceFolders: string[]
): Promise<RenderOutput | null>;
```

Steps:
1. `initConfigPath()` then `loadSettings()` from core
2. Set `chalk.level = settings.colorLevel` (force 3 for xterm.js)
3. Call `updateColorMap()`
4. Discover active session via `SessionDiscovery`
5. Build `StatusJSON` via `StatusJSONBuilder`
6. Build `RenderContext` via `RenderContextBuilder`
7. Call `preRenderAllWidgets(settings.lines, settings, context)`
8. Call `calculateMaxWidthsFromPreRendered(preRenderedLines, settings)`
9. Iterate lines, call `renderStatusLine()` for each
10. Apply NBSP replacement and `\x1b[0m` reset prefix (same as ccstatusline.ts:171-177)
11. Return rendered ANSI lines

### Files to Modify

**`packages/extension/src/panel/StatusPanelProvider.ts`**
- Replace hardcoded ANSI with `PipelineRunner.runRenderPipeline()` calls
- Listen for column count messages from webview
- Register `ccstatusline.refresh` command handler
- Show "No active session" when no session found

**`packages/extension/src/media/panel.js`**
- Report xterm.js column count to extension host on init and resize
- Handle `{ type: 'no-session' }` message to show placeholder

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Construct StatusJSON from disk** | Extension can't receive stdin pipe from Claude Code. All needed data is on disk. `rate_limits` comes from usage API cache at `~/.cache/ccstatusline/usage.json`. |
| **Reuse core's JSONL utils directly** | `getTokenMetrics()`, `getSessionDuration()`, `getSpeedMetricsCollection()` all accept a transcript path. No reimplementation needed. |
| **Tail-read optimization** | Large transcripts (hours-long sessions) can be >10MB. Only read the tail for "last entry" data. Full reads only for cumulative token sums. |
| **chalk level forced to 3** | xterm.js supports truecolor. User's `colorLevel` setting applies to terminal output; panel always uses truecolor. |

### Acceptance Criteria

- [ ] With an active Claude Code VS Code session, panel displays the user's actual widget layout
- [ ] Output is visually identical to terminal `ccstatusline`
- [ ] "Refresh" command updates panel with fresh data
- [ ] "No active Claude Code session" shown when no session exists
- [ ] Token counts, context %, session name, git branch all display correctly
- [ ] Usage widgets work if OAuth credentials are available
- [ ] Handles missing/corrupt JSONL gracefully (error state, no crash)

---

## Phase 3: Live Polling, Settings Sync, Error Handling, Packaging

### Goal

Production-quality extension: auto-refreshing panel, file watchers for instant updates, settings synchronization, robust error handling, publishable `.vsix`.

### Shippable Output

Polished extension ready for Marketplace. Auto-updates every 2s, responds to session changes in real-time, handles all edge cases gracefully.

### Files to Create

**`packages/extension/src/polling/SessionPoller.ts`**
```typescript
export class SessionPoller implements vscode.Disposable {
  private pollInterval: NodeJS.Timer | null = null;
  private sessionWatcher: fs.FSWatcher | null = null;
  private transcriptWatcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(
    private onUpdate: (output: RenderOutput | null) => void,
    private getTerminalCols: () => number,
    private getWorkspaceFolders: () => string[]
  );

  start(intervalMs: number): void;
  stop(): void;
  forceRefresh(): void;
  dispose(): void;
}
```

- `fs.watch` on `~/.claude/sessions/` for session start/stop
- `fs.watch` on active session's JSONL for new responses
- Fallback to interval polling (default 2000ms)
- Debounce watcher events (200ms) to coalesce burst writes
- Switch JSONL watcher when active session changes
- Calls `PipelineRunner.runRenderPipeline()` on each tick

**`packages/extension/src/config/SettingsSync.ts`**
```typescript
export class SettingsSync implements vscode.Disposable {
  private watcher: fs.FSWatcher | null = null;

  constructor(private onSettingsChanged: () => void);

  start(): void;   // watches ~/.config/ccstatusline/settings.json
  dispose(): void;
}
```

When the user changes widget layout in the ccstatusline TUI, the panel updates automatically.

**`packages/extension/src/config/ExtensionSettings.ts`**
```typescript
export interface ExtensionSettings {
  enabled: boolean;
  pollIntervalMs: number;
  claudeConfigDir: string;
  forceColorLevel: number | null;
  panelFontFamily: string;
  panelFontSize: number;
}

export function getExtensionSettings(): ExtensionSettings;
```

**`packages/extension/src/panel/PanelThemeSync.ts`**
```typescript
export function getXtermThemeFromVSCode(): ITheme;
```

Maps VS Code's `terminal.foreground`, `terminal.background`, `terminal.ansi*` colors to xterm.js theme. Listens for `onDidChangeActiveColorTheme` to update.

**`packages/extension/src/errors/ErrorDisplay.ts`**
```typescript
export function renderErrorState(error: Error): string;       // Returns ANSI
export function renderNoSessionState(): string;                // Returns ANSI
export function renderLoadingState(): string;                  // Returns ANSI
```

### Files to Modify

**`packages/extension/src/panel/StatusPanelProvider.ts`** — major update:
- Instantiate `SessionPoller` and `SettingsSync`
- Start polling when panel becomes visible, pause when hidden (`onDidChangeViewState`)
- Forward `RenderOutput` to webview via `postMessage`
- Handle error states
- Respond to VS Code configuration changes
- Dispose all watchers on deactivation

**`packages/extension/src/media/panel.js`** — add:
- Theme sync (receive theme updates, apply to xterm.js)
- Font configuration messages
- Loading/error state display
- Flicker-free rendering: diff check before clear+write

**`packages/extension/package.json`** — add full settings:
```json
{
  "contributes": {
    "configuration": {
      "title": "Claude Code Status",
      "properties": {
        "ccstatusline.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable the Claude Code Status panel"
        },
        "ccstatusline.pollIntervalMs": {
          "type": "number",
          "default": 2000,
          "minimum": 500,
          "description": "How often to refresh session data (milliseconds)"
        },
        "ccstatusline.claudeConfigDir": {
          "type": "string",
          "default": "",
          "description": "Override path to Claude config directory (default: ~/.claude)"
        },
        "ccstatusline.panelFontFamily": {
          "type": "string",
          "default": "",
          "description": "Font family for the status panel (default: terminal font)"
        },
        "ccstatusline.panelFontSize": {
          "type": "number",
          "default": 13,
          "description": "Font size for the status panel"
        }
      }
    }
  }
}
```

### Error Handling

| Scenario | Behavior |
|----------|----------|
| `~/.claude/` missing | Panel: "Claude Code not detected. Install from claude.ai/code" |
| No active VS Code session | Panel: "No active Claude Code session" with auto-retry |
| JSONL file missing/empty | Panel: "Waiting for first response..." |
| JSONL parse error on a line | Skip silently (matches ccstatusline behavior) |
| Settings file corrupt | Fall back to default settings |
| Usage API timeout | Show cached data, log to output channel |
| File watcher error | Fall back to interval polling, log to output channel |
| Extension host crash | `retainContextWhenHidden: true` preserves last render |

### Performance

- **JSONL tail-reading**: Files >1MB → read last 64KB for "last entry" data. Full reads only for cumulative token sums, cached by mtime.
- **Render caching**: Skip re-render if JSONL mtime unchanged since last render.
- **Debounced watcher events**: 200ms coalesce window.
- **Lazy polling**: Stop polling entirely when panel tab is not visible.
- **Bundle size target**: extension.js ~150-200KB (core + zod + chalk bundled). media/ ~200KB (xterm.js). Total `.vsix` < 500KB.

### Packaging & CI/CD

**`.github/workflows/ci.yml`**
```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: cd packages/extension && npx @vscode/vsce package
```

**`.github/workflows/release.yml`**
```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run build
      - run: cd packages/extension && npx @vscode/vsce package
      - uses: softprops/action-gh-release@v2
        with:
          files: 'packages/extension/*.vsix'
      - name: Publish to Marketplace
        run: cd packages/extension && npx @vscode/vsce publish
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

### Acceptance Criteria

- [ ] Panel auto-updates every 2s (or configured interval) with fresh session data
- [ ] Panel updates within 1s when a new Claude Code response completes (file watcher)
- [ ] Panel updates instantly when a session starts or stops
- [ ] Changing widget layout in ccstatusline TUI reflects in the panel within 2s
- [ ] Panel shows appropriate states: loading, no session, error, active
- [ ] VS Code settings take effect without window reload
- [ ] Negligible CPU when no session is active (no unnecessary polling)
- [ ] `vsce package` produces a `.vsix` under 500KB
- [ ] Works in VS Code, Cursor, and Windsurf (engine `^1.94.0`)
- [ ] All watchers and timers properly disposed on deactivation
- [ ] Output channel logs recoverable errors and watcher fallbacks

---

## Phase Dependency Graph

```
Phase 1 (Foundation)
  ├── Fork ccstatusline → packages/core/
  ├── Create packages/core/src/index.ts (library exports)
  ├── Monorepo workspace config
  ├── packages/extension/ skeleton
  ├── xterm.js integration in webview panel
  ├── postMessage bridge (extension ↔ webview)
  └── Hardcoded ANSI demo renders in panel
       │
Phase 2 (Data Layer)
  ├── Session discovery (~/.claude/sessions/*.json)
  ├── Transcript path resolution
  ├── StatusJSON construction from disk
  ├── RenderContext construction (mirrors ccstatusline.ts logic)
  ├── PipelineRunner calls core render functions
  ├── Terminal width communicated from webview
  └── Real data renders in panel (manual refresh)
       │
Phase 3 (Production)
  ├── SessionPoller with fs.watch + interval fallback
  ├── SettingsSync (watch ccstatusline settings file)
  ├── Error states and graceful degradation
  ├── Theme sync (VS Code → xterm.js)
  ├── VS Code settings integration
  ├── esbuild production bundle
  ├── .vsix packaging (<500KB)
  └── CI/CD pipeline
```

## Critical Source References

These files in the forked ccstatusline contain the exact logic to replicate or call:

| File | What to use |
|------|-------------|
| `src/ccstatusline.ts` (lines 88-212) | `renderMultipleLines()` — the full orchestration logic that `RenderContextBuilder` + `PipelineRunner` must mirror |
| `src/utils/renderer.ts` | `preRenderAllWidgets()`, `renderStatusLine()`, `calculateMaxWidthsFromPreRendered()` — called directly by the extension |
| `src/types/RenderContext.ts` | Data contract between data layer and renderer — every field must be populated |
| `src/types/StatusJSON.ts` | Zod schema for the status payload — the extension constructs this from disk |
| `src/utils/config.ts` | `initConfigPath()` + `loadSettings()` — must be called before any rendering |
| `src/utils/jsonl-metrics.ts` | Token/speed metric extraction from JSONL transcripts |
| `src/utils/usage-fetch.ts` | Anthropic usage API integration (OAuth, caching, rate limiting) |
| `src/utils/colors.ts` | `updateColorMap()` — must be called after setting chalk level |
