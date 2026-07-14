import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerZIP } from '@electron-forge/maker-zip'

const config: ForgeConfig = {
  packagerConfig: {
    name: 'RIAF Studio',
    executableName: 'riaf-studio',
    icon: 'resources/icon',
    asar: true,
    asarUnpack: ['**/node_modules/better-sqlite3/**'],
  },
  rebuildConfig: {
    onlyModules: ['better-sqlite3'],
  },
  makers: [
    new MakerSquirrel({ name: 'riaf_studio' }),
    new MakerDMG({ icon: 'resources/icon.icns' }),
    new MakerZIP({}, ['linux']),
  ],
}

export default config
