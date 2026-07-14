// packages/main/src/domain/domainPackLoader.ts
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type { DomainPackManifest } from '@shared/index'

/** Parse and return a domain pack manifest from a YAML file. */
export function load(filePath: string): DomainPackManifest {
  const raw = fs.readFileSync(filePath, 'utf8')
  const data = parse(raw) as unknown
  return validate(data)
}

/** Validate the shape of a parsed YAML object as a DomainPackManifest. */
export function validate(data: unknown): DomainPackManifest {
  if (!data || typeof data !== 'object') {
    throw new Error('Domain pack must be a YAML object')
  }
  const d = data as Record<string, unknown>
  if (typeof d['name'] !== 'string') {
    throw new Error('Domain pack must have a string "name" field')
  }
  if (typeof d['version'] !== 'string') {
    throw new Error('Domain pack must have a string "version" field')
  }
  if (typeof d['domain'] !== 'string') {
    throw new Error('Domain pack must have a string "domain" field')
  }
  return d as unknown as DomainPackManifest
}

/**
 * Discover all *.pack.yaml / *.pack.yml files in a directory.
 * Returns an empty array if the directory does not exist.
 */
export function discover(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.pack.yaml') || f.endsWith('.pack.yml'))
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}
