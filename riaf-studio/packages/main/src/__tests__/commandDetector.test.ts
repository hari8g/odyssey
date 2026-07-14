import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectCommands } from '../indexer/commandDetector'

describe('detectCommands', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'riaf-cmd-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads scripts from package.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        scripts: {
          build: 'tsc',
          test: 'vitest',
          lint: 'eslint .',
          typecheck: 'tsc --noEmit',
        },
      }),
    )

    const cmds = detectCommands(tmpDir)
    const purposes = cmds.map((c) => c.purpose)
    expect(purposes).toContain('build')
    expect(purposes).toContain('test')
    expect(purposes).toContain('lint')
  })
})
