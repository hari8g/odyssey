/// <reference types="vite/client" />
interface Window {
  electronAPI: import('../../preload/src/preload').ElectronAPI
}
