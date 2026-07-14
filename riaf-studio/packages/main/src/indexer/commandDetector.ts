import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CommandEntry } from '@shared/index'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Purpose = CommandEntry['purpose']
type Confidence = CommandEntry['confidence']

type Heuristic = { pattern: RegExp; purpose: Purpose }

// ---------------------------------------------------------------------------
// package.json heuristics
// ---------------------------------------------------------------------------

const BY_SCRIPT_NAME: Heuristic[] = [
  { pattern: /^(build|compile|bundle)(:.*)?$/, purpose: 'build' },
  { pattern: /^test(s)?(:.*)?$/, purpose: 'test' },
  { pattern: /^(lint|check)(:.*)?$/, purpose: 'lint' },
  { pattern: /^(type[- ]?check|tsc|typecheck)(:.*)?$/, purpose: 'typecheck' },
  { pattern: /^(start|serve|dev|run)(:.*)?$/, purpose: 'start' },
  { pattern: /^(format|fmt|prettier)(:.*)?$/, purpose: 'format' },
]

const BY_SCRIPT_VALUE: Array<Heuristic & { confidence: Confidence }> = [
  {
    pattern: /\b(tsc\b|next\s+build|webpack|vite\s+build|rollup\b|esbuild\b|turbo\s+build|parcel\s+build)\b/,
    purpose: 'build',
    confidence: 'medium',
  },
  {
    pattern: /\b(jest|vitest|mocha|ava|tap|playwright|cypress\s+run|jasmine)\b/,
    purpose: 'test',
    confidence: 'medium',
  },
  {
    pattern: /\b(eslint|tslint|oxlint|biome\s+lint|stylelint)\b/,
    purpose: 'lint',
    confidence: 'medium',
  },
  {
    pattern: /\btsc\s+(.*\s)?--noEmit\b/,
    purpose: 'typecheck',
    confidence: 'high',
  },
  {
    pattern: /\b(nodemon|ts-node\b|tsx\b|next\s+dev|vite(\s|$)|nuxt\s+dev|turbo\s+dev|expo\s+start)\b/,
    purpose: 'start',
    confidence: 'medium',
  },
  {
    pattern: /\b(prettier|biome\s+format|dprint)\b/,
    purpose: 'format',
    confidence: 'medium',
  },
]

function detectFromPackageJson(root: string): CommandEntry[] {
  const pkgPath = path.join(root, 'package.json')
  if (!fs.existsSync(pkgPath)) return []

  let pkg: { scripts?: Record<string, string> }
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as typeof pkg
  } catch {
    return []
  }

  const scripts = pkg.scripts ?? {}
  const entries: CommandEntry[] = []
  const seen = new Set<Purpose>()

  // Use a runner that respects workspace managers (yarn/pnpm/npm)
  const runner = fs.existsSync(path.join(root, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : fs.existsSync(path.join(root, 'yarn.lock'))
      ? 'yarn'
      : 'npm'

  for (const [name, value] of Object.entries(scripts)) {
    if (!value) continue

    let purpose: Purpose | null = null
    let confidence: Confidence = 'low'

    for (const h of BY_SCRIPT_NAME) {
      if (h.pattern.test(name)) {
        purpose = h.purpose
        confidence = 'high'
        break
      }
    }

    if (!purpose) {
      for (const h of BY_SCRIPT_VALUE) {
        if (h.pattern.test(value)) {
          purpose = h.purpose
          confidence = h.confidence
          break
        }
      }
    }

    if (!purpose || seen.has(purpose)) continue
    seen.add(purpose)

    const cmd = runner === 'npm' ? `npm run ${name}` : `${runner} ${name}`
    entries.push({ command: cmd, purpose, confidence, source: 'package.json' })
  }

  return entries
}

// ---------------------------------------------------------------------------
// Makefile
// ---------------------------------------------------------------------------

const MAKE_TARGET_MAP: Heuristic[] = [
  { pattern: /^(build|compile|bundle|all)$/, purpose: 'build' },
  { pattern: /^tests?$/, purpose: 'test' },
  { pattern: /^(lint|check)$/, purpose: 'lint' },
  { pattern: /^(typecheck|type-check)$/, purpose: 'typecheck' },
  { pattern: /^(start|serve|run|dev)$/, purpose: 'start' },
  { pattern: /^(format|fmt)$/, purpose: 'format' },
]

function detectFromMakefile(root: string): CommandEntry[] {
  const makePath = path.join(root, 'Makefile')
  if (!fs.existsSync(makePath)) return []

  let content: string
  try {
    content = fs.readFileSync(makePath, 'utf8')
  } catch {
    return []
  }

  const entries: CommandEntry[] = []
  const seen = new Set<Purpose>()
  const targetRegex = /^([a-zA-Z][a-zA-Z0-9_-]*):/gm
  let match: RegExpExecArray | null

  while ((match = targetRegex.exec(content)) !== null) {
    const raw = match[1]!
    const lower = raw.toLowerCase()
    for (const { pattern, purpose } of MAKE_TARGET_MAP) {
      if (pattern.test(lower) && !seen.has(purpose)) {
        seen.add(purpose)
        entries.push({ command: `make ${raw}`, purpose, confidence: 'medium', source: 'Makefile' })
        break
      }
    }
  }

  return entries
}

// ---------------------------------------------------------------------------
// Cargo.toml (Rust)
// ---------------------------------------------------------------------------

function detectFromCargoToml(root: string): CommandEntry[] {
  if (!fs.existsSync(path.join(root, 'Cargo.toml'))) return []
  return [
    { command: 'cargo build', purpose: 'build', confidence: 'high', source: 'Cargo.toml' },
    { command: 'cargo test', purpose: 'test', confidence: 'high', source: 'Cargo.toml' },
    { command: 'cargo clippy', purpose: 'lint', confidence: 'high', source: 'Cargo.toml' },
    { command: 'cargo run', purpose: 'start', confidence: 'high', source: 'Cargo.toml' },
    { command: 'cargo fmt', purpose: 'format', confidence: 'high', source: 'Cargo.toml' },
  ]
}

// ---------------------------------------------------------------------------
// pom.xml (Maven / Java)
// ---------------------------------------------------------------------------

function detectFromPomXml(root: string): CommandEntry[] {
  if (!fs.existsSync(path.join(root, 'pom.xml'))) return []
  const mvn = fs.existsSync(path.join(root, 'mvnw')) ? './mvnw' : 'mvn'
  return [
    { command: `${mvn} package -DskipTests`, purpose: 'build', confidence: 'high', source: 'pom.xml' },
    { command: `${mvn} test`, purpose: 'test', confidence: 'high', source: 'pom.xml' },
    { command: `${mvn} verify -DskipTests`, purpose: 'lint', confidence: 'medium', source: 'pom.xml' },
    { command: `${mvn} spring-boot:run`, purpose: 'start', confidence: 'medium', source: 'pom.xml' },
  ]
}

// ---------------------------------------------------------------------------
// go.mod (Go)
// ---------------------------------------------------------------------------

function detectFromGoMod(root: string): CommandEntry[] {
  if (!fs.existsSync(path.join(root, 'go.mod'))) return []
  return [
    { command: 'go build ./...', purpose: 'build', confidence: 'high', source: 'go.mod' },
    { command: 'go test ./...', purpose: 'test', confidence: 'high', source: 'go.mod' },
    { command: 'go vet ./...', purpose: 'lint', confidence: 'high', source: 'go.mod' },
    { command: 'go run .', purpose: 'start', confidence: 'medium', source: 'go.mod' },
    { command: 'gofmt -w .', purpose: 'format', confidence: 'high', source: 'go.mod' },
  ]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect build/test/lint/start/format/typecheck commands from common project
 * manifests in the given workspace root. Returns one entry per purpose,
 * preferring higher-confidence sources.
 */
export function detectCommands(workspaceRoot: string): CommandEntry[] {
  // Sources ordered by reliability: package.json first, then others
  const all: CommandEntry[] = [
    ...detectFromPackageJson(workspaceRoot),
    ...detectFromMakefile(workspaceRoot),
    ...detectFromCargoToml(workspaceRoot),
    ...detectFromPomXml(workspaceRoot),
    ...detectFromGoMod(workspaceRoot),
  ]

  // One winner per purpose (first = highest priority / confidence)
  const seen = new Set<Purpose>()
  const result: CommandEntry[] = []
  for (const entry of all) {
    if (!seen.has(entry.purpose)) {
      seen.add(entry.purpose)
      result.push(entry)
    }
  }

  return result
}
