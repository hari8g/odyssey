# RIAF Studio

Cross-platform Electron desktop app for **Repository Intelligence and Analysis Framework** (RIAF).

Opens a local repo, runs a 10-stage indexing pipeline into `.riaf/riaf.db`, exposes search + UCG graphs, and runs an LLM agent that writes a 12-section `*_context.md`.

## Packages

| Package | Role |
|---------|------|
| `packages/shared` | IPC channels + shared types |
| `packages/main` | Electron main: SQLite, indexer, LLM, RIAF agent |
| `packages/preload` | `window.electronAPI` bridge |
| `packages/renderer` | React UI (7 panels) |

## Prerequisites

- **Node.js 20 LTS** (required — Node 24 lacks prebuilt `better-sqlite3` binaries)
- **pnpm 9** via Corepack (global pnpm 10 requires Node 22.13+ and will not run on Node 20)
- Git (for git indexing)
- LLM API key (Anthropic or OpenAI-compatible) for RIAF analysis

**Homebrew (recommended if `nvm` is not in your shell):**

```bash
brew install node@20   # skip if already installed
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
node -v                # should print v20.x, not v24.x
```

**Or with nvm** (add to `~/.zshrc` if `nvm: command not found`):

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
node -v
```

## Setup

```bash
cd riaf-studio

# Use Node 20 (see Prerequisites above)
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
node -v   # v20.x

# Use pnpm 9 (project pins this via packageManager — do not use global pnpm 10 on Node 20)
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm -v   # 9.15.9

pnpm install
pnpm dev
```

## Commands

```bash
pnpm rebuild:node       # better-sqlite3 for Vitest / Node
pnpm rebuild:electron   # better-sqlite3 for Electron (also runs before `pnpm dev`)
pnpm dev                # Electron + Vite HMR
pnpm build              # Production build → out/
pnpm test               # Vitest (auto-runs rebuild:node first)
pnpm package            # Electron Forge package
pnpm make               # Installers (DMG / Squirrel / ZIP)
```

## Usage

1. **Settings** — set Anthropic API key (or OpenAI-compat base URL/key) and model.
2. **Workspace** — Open Repository (or pick a Recent).
3. Watch **Indexing** progress (scan → chunk → symbols → imports → graph → commands → git → embeddings → profile).
4. Use **Search**, **Symbols**, and **UCG** panels.
5. **RIAF Analysis** — configure output file / max files → Run Analysis → `repo_context.md` is written to the workspace root.

Shortcuts: `Cmd/Ctrl+O` workspace panel, `Cmd/Ctrl+R` re-index.

## ISS extensibility (Phase 1 stubs)

- Empty tables: `graph_nodes`, `graph_edges`, `feature_traces`
- IPC `iss:*` channels return `{ error: 'ISS Graph not yet implemented' }`
- `registerToolPlugin()` / `registerPostIndexHook()` for additive ISS plugins
