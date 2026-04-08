# ccstatusline VS Code Extension

A VS Code extension that displays [ccstatusline](https://github.com/sirmalloc/ccstatusline) session stats in a bottom panel — same multi-line powerline output, same widgets, same colors.

Built on top of the ccstatusline rendering engine. If you use ccstatusline in your terminal, this extension gives you the same view inside VS Code.

## What it does

- Detects active Claude Code sessions (both VS Code chat and CLI)
- Reads JSONL transcripts and session data from `~/.claude/`
- Renders your ccstatusline widget layout in a panel using xterm.js
- Uses your existing `~/.config/ccstatusline/settings.json` — no separate config

## Supported widgets

All 37 ccstatusline widgets work, including:

| Category | Widgets |
|----------|---------|
| **Session** | model, version, session-clock, session-cost, session-name |
| **Tokens** | tokens-input, tokens-output, tokens-cached, tokens-total |
| **Context** | context-length, context-percentage, context-bar |
| **Usage** | session-usage, weekly-usage, block-timer, reset-timer |
| **Git** | git-branch, git-changes, git-insertions, git-deletions |
| **Speed** | input-speed, output-speed, total-speed |
| **Custom** | custom-text, custom-command, link |

Powerline mode, multi-line layouts, and truecolor themes are fully supported.

## Installation

### From .vsix

```bash
cd packages/extension
npm run build
npx @vscode/vsce package --allow-missing-repository
code --install-extension ccstatusline-vscode-0.1.0.vsix
```

### From source

```bash
git clone https://github.com/thtahamid/ccstatusline-vscode-extention.git
cd ccstatusline-vscode-extention
npm install --legacy-peer-deps
npm run build:extension
```

## Prerequisites

- [ccstatusline](https://github.com/sirmalloc/ccstatusline) configured (`~/.config/ccstatusline/settings.json`)
- Claude Code installed and running
- A Powerline-patched font for powerline glyphs (e.g., MesloLGS NF, FiraCode Nerd Font)

## Usage

1. Open VS Code
2. Look at the bottom panel (alongside Terminal, Problems, Output)
3. Click the **Claude Code Status** tab
4. Start a Claude Code session — the panel renders your status line
5. Use **Cmd+Shift+P → "Claude Code: Refresh Status Panel"** to manually refresh

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccstatusline.enabled` | `true` | Enable the status panel |
| `ccstatusline.pollIntervalMs` | `2000` | Refresh interval in milliseconds |
| `ccstatusline.panelFontFamily` | `""` | Font family (defaults to terminal font) |
| `ccstatusline.panelFontSize` | `13` | Font size for the panel |

Widget layout and colors are configured via `ccstatusline` itself:

```bash
npx ccstatusline
```

## Architecture

```
packages/
  core/         # Forked ccstatusline (git subtree from sirmalloc/ccstatusline)
  extension/    # VS Code extension
    src/
      session/    SessionDiscovery, StatusJSONBuilder
      render/     PipelineRunner (calls core's render pipeline)
      panel/      StatusPanelProvider, xterm.js webview
```

The extension calls ccstatusline's rendering functions directly — same `preRenderAllWidgets()` → `renderStatusLine()` pipeline. No subprocess, no reimplementation.

### Pulling upstream updates

The `packages/core/` directory is a [git subtree](https://www.atlassian.com/git/tutorials/git-subtree) of the upstream ccstatusline repo:

```bash
# Pull latest changes from upstream
git subtree pull --prefix=packages/core upstream main --squash

# Push contributions back to your fork
git subtree push --prefix=packages/core fork feature/my-change
```

## License

MIT — see [LICENSE](packages/extension/LICENSE)

ccstatusline core is MIT licensed by [sirmalloc](https://github.com/sirmalloc/ccstatusline).
