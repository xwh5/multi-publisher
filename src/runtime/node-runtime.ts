/**
 * Node.js 运行时实现
 */
import type { RuntimeInterface } from './index.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let _configDir: string | null = null

function getConfigDir(): string {
  if (!_configDir) {
    const env = process.env.XDG_CONFIG_HOME || process.env.APPDATA || os.homedir()
    _configDir = path.join(env, '.config', 'multi-publisher')
  }
  return _configDir
}

export function createNodeRuntime(): RuntimeInterface {
  return {
    async fetch(url: string, init?: RequestInit) {
      return globalThis.fetch(url, init)
    },

    async readFile(filePath: string): Promise<string> {
      return fs.readFile(filePath, 'utf-8')
    },

    async readFileBuffer(filePath: string): Promise<Buffer> {
      return fs.readFile(filePath)
    },

    getConfigDir,
  }
}
