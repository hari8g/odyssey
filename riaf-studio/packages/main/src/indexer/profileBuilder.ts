import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CommandEntry, FrameworkEntry, WorkspaceProfile } from '@shared/index'
import type { ScannedFile } from './workspaceScanner'

// ---------------------------------------------------------------------------
// Framework detection rules (package.json deps)
// ---------------------------------------------------------------------------

type FrameworkRule = {
  dep: string
  name: string
  versionKey?: string
}

const FRAMEWORK_RULES: FrameworkRule[] = [
  // Frontend
  { dep: 'next', name: 'Next.js' },
  { dep: 'nuxt', name: 'Nuxt' },
  { dep: 'react', name: 'React' },
  { dep: 'vue', name: 'Vue' },
  { dep: '@angular/core', name: 'Angular' },
  { dep: 'svelte', name: 'Svelte' },
  { dep: '@sveltejs/kit', name: 'SvelteKit' },
  { dep: 'solid-js', name: 'SolidJS' },
  { dep: 'astro', name: 'Astro' },
  { dep: 'remix', name: 'Remix' },
  { dep: '@remix-run/react', name: 'Remix' },
  { dep: 'gatsby', name: 'Gatsby' },
  // Backend / fullstack
  { dep: 'express', name: 'Express' },
  { dep: 'fastify', name: 'Fastify' },
  { dep: '@nestjs/core', name: 'NestJS' },
  { dep: 'hono', name: 'Hono' },
  { dep: 'koa', name: 'Koa' },
  { dep: 'hapi', name: 'Hapi' },
  { dep: 'elysia', name: 'Elysia' },
  // Database ORMs / clients
  { dep: 'prisma', name: 'Prisma' },
  { dep: '@prisma/client', name: 'Prisma' },
  { dep: 'drizzle-orm', name: 'Drizzle ORM' },
  { dep: 'typeorm', name: 'TypeORM' },
  { dep: 'sequelize', name: 'Sequelize' },
  { dep: 'mongoose', name: 'Mongoose' },
  // Testing
  { dep: 'vitest', name: 'Vitest' },
  { dep: 'jest', name: 'Jest' },
  { dep: 'playwright', name: 'Playwright' },
  { dep: 'cypress', name: 'Cypress' },
  // Build
  { dep: 'vite', name: 'Vite' },
  { dep: 'webpack', name: 'Webpack' },
  { dep: 'turbo', name: 'Turborepo' },
  { dep: 'nx', name: 'Nx' },
  // Electron
  { dep: 'electron', name: 'Electron' },
  { dep: 'tauri', name: 'Tauri' },
]

// ---------------------------------------------------------------------------
// Package-manager lockfile detection
// ---------------------------------------------------------------------------

const LOCKFILE_MAP: Array<{ file: string; name: string }> = [
  { file: 'bun.lockb', name: 'bun' },
  { file: 'pnpm-lock.yaml', name: 'pnpm' },
  { file: 'yarn.lock', name: 'yarn' },
  { file: 'package-lock.json', name: 'npm' },
  { file: 'Pipfile.lock', name: 'pipenv' },
  { file: 'poetry.lock', name: 'poetry' },
  { file: 'Cargo.lock', name: 'cargo' },
  { file: 'go.sum', name: 'go modules' },
  { file: 'Gemfile.lock', name: 'bundler' },
  { file: 'composer.lock', name: 'composer' },
  { file: 'pom.xml', name: 'maven' },
  { file: 'build.gradle', name: 'gradle' },
]

// ---------------------------------------------------------------------------
// WorkspaceProfileBuilder
// ---------------------------------------------------------------------------

export class WorkspaceProfileBuilder {
  /**
   * Build a WorkspaceProfile from scanned files and detected commands,
   * then persist it as the singleton workspace_profiles row.
   */
  static buildAndSave(
    db: Database.Database,
    workspaceRoot: string,
    files: ScannedFile[],
    commands: CommandEntry[],
  ): WorkspaceProfile {
    const languageStack = detectLanguageStack(db, workspaceRoot)
    const frameworks = detectFrameworks(workspaceRoot)
    const packageManagers = detectPackageManagers(workspaceRoot)
    const totalLoc = estimateLoc(db, workspaceRoot)

    // Split commands by purpose category
    const buildCommands = commands.filter((c) =>
      ['build', 'typecheck', 'start'].includes(c.purpose),
    )
    const testCommands = commands.filter((c) => c.purpose === 'test')
    const lintCommands = commands.filter((c) =>
      ['lint', 'format'].includes(c.purpose),
    )

    const profile: WorkspaceProfile = {
      workspaceRoot,
      lastScannedAt: Date.now(),
      languageStack,
      frameworks,
      packageManagers,
      buildCommands,
      testCommands,
      lintCommands,
      fileCount: files.length,
      totalLoc,
      projectPurpose: null,
      architectureSummary: null,
      isStale: false,
    }

    persist(db, profile)
    return profile
  }
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function detectLanguageStack(db: Database.Database, workspaceRoot: string): string[] {
  type Row = { language: string; cnt: number }
  const rows = db
    .prepare<[string], Row>(`
      SELECT language, COUNT(*) AS cnt
      FROM file_metadata
      WHERE workspace_root = ? AND language IS NOT NULL AND language != 'unknown'
      GROUP BY language
      ORDER BY cnt DESC
      LIMIT 10
    `)
    .all(workspaceRoot)

  return rows.map((r) => r.language)
}

function detectFrameworks(workspaceRoot: string): FrameworkEntry[] {
  const pkgPath = path.join(workspaceRoot, 'package.json')
  if (!fs.existsSync(pkgPath)) return []

  let pkg: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as typeof pkg
  } catch {
    return []
  }

  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }

  const seen = new Set<string>()
  const entries: FrameworkEntry[] = []

  for (const { dep, name } of FRAMEWORK_RULES) {
    if (seen.has(name)) continue
    const version = allDeps[dep]
    if (version !== undefined) {
      seen.add(name)
      entries.push({
        name,
        version: version.replace(/^[^0-9]*/, '') || null,
        confidence: pkg.dependencies?.[dep] !== undefined ? 'high' : 'medium',
      })
    }
  }

  return entries
}

function detectPackageManagers(workspaceRoot: string): string[] {
  const managers: string[] = []
  for (const { file, name } of LOCKFILE_MAP) {
    if (fs.existsSync(path.join(workspaceRoot, file))) {
      managers.push(name)
    }
  }
  return managers
}

/**
 * Estimate lines-of-code from the sum of size_bytes in file_metadata.
 * Using 35 bytes/line as a rough cross-language average.
 */
function estimateLoc(db: Database.Database, workspaceRoot: string): number {
  type Row = { total: number }
  const row = db
    .prepare<[string], Row>(
      'SELECT COALESCE(SUM(size_bytes), 0) AS total FROM file_metadata WHERE workspace_root = ?',
    )
    .get(workspaceRoot)

  return Math.round((row?.total ?? 0) / 35)
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function persist(db: Database.Database, p: WorkspaceProfile): void {
  db.prepare(`
    INSERT INTO workspace_profiles
      (id, workspace_root, last_scanned_at,
       language_stack_json, frameworks_json, package_managers_json,
       build_commands_json, test_commands_json, lint_commands_json,
       file_count, total_loc, project_purpose, architecture_summary)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      workspace_root        = excluded.workspace_root,
      last_scanned_at       = excluded.last_scanned_at,
      language_stack_json   = excluded.language_stack_json,
      frameworks_json       = excluded.frameworks_json,
      package_managers_json = excluded.package_managers_json,
      build_commands_json   = excluded.build_commands_json,
      test_commands_json    = excluded.test_commands_json,
      lint_commands_json    = excluded.lint_commands_json,
      file_count            = excluded.file_count,
      total_loc             = excluded.total_loc,
      project_purpose       = excluded.project_purpose,
      architecture_summary  = excluded.architecture_summary
  `).run(
    p.workspaceRoot,
    p.lastScannedAt,
    JSON.stringify(p.languageStack),
    JSON.stringify(p.frameworks),
    JSON.stringify(p.packageManagers),
    JSON.stringify(p.buildCommands),
    JSON.stringify(p.testCommands),
    JSON.stringify(p.lintCommands),
    p.fileCount,
    p.totalLoc,
    p.projectPurpose,
    p.architectureSummary,
  )
}
