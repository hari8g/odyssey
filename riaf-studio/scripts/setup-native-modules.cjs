/**
 * Download prebuilt better-sqlite3 binaries — never compile from source.
 * Source builds fail on macOS when Python 3.14's pyexpat is broken (node-gyp).
 */
const { execSync } = require('node:child_process')
const { dirname } = require('node:path')

function sqlitePkgDir() {
  return dirname(require.resolve('better-sqlite3/package.json'))
}

function runPrebuild(runtime, version) {
  const cwd = sqlitePkgDir()
  console.log(`[setup-native] better-sqlite3 prebuild for ${runtime}@${version}`)
  execSync(`npx prebuild-install -r ${runtime} -t ${version}`, {
    cwd,
    stdio: 'inherit',
  })
}

function main() {
  const target = process.argv[2] ?? 'node'

  if (target === 'node') {
    try {
      runPrebuild('node', process.versions.node)
    } catch {
      console.error(`
[setup-native] No prebuilt better-sqlite3 binary for Node ${process.versions.node}.

Use Node 20 LTS (required for Electron 31):

  Homebrew (you already have node@20):
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    node -v   # should print v20.x
    rm -rf node_modules && pnpm install

  Or load nvm in ~/.zshrc then:
    nvm use 20
    rm -rf node_modules && pnpm install
`)
      process.exit(1)
    }
    return
  }

  if (target === 'electron') {
    const electronVersion = require('electron/package.json').version
    try {
      runPrebuild('electron', electronVersion)
    } catch {
      console.error(`
[setup-native] Failed to download better-sqlite3 for Electron ${electronVersion}.
Try: pnpm rebuild:electron
`)
      process.exit(1)
    }
    return
  }

  console.error(`Unknown target: ${target}`)
  process.exit(1)
}

main()
