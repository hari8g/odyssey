import { describe, it, expect } from 'vitest'
import { registerToolPlugin, getAllTools, buildRiafTools, executeTool } from '../riaf/riafTools'
import { makeTestDb } from './helpers'

describe('ISS tool plugin hooks', () => {
  it('registerToolPlugin adds tools without replacing core tools', () => {
    const coreCount = buildRiafTools().length
    registerToolPlugin({
      tool: {
        name: 'trace_feature_to_code',
        description: 'ISS stub: trace a feature to code',
        input_schema: {
          type: 'object',
          properties: { feature: { type: 'string', description: 'Feature name' } },
          required: ['feature'],
        },
      },
      execute: async (input) => `ISS stub: would trace ${String(input.feature)}`,
    })

    const all = getAllTools()
    expect(all.length).toBeGreaterThan(coreCount)
    expect(all.some((t) => t.name === 'trace_feature_to_code')).toBe(true)
  })

  it('executeTool dispatches to registered plugins', async () => {
    const db = makeTestDb()
    const result = await executeTool(
      { id: '1', name: 'trace_feature_to_code', input: { feature: 'login' } },
      db,
      '/tmp',
    )
    expect(result).toContain('login')
    db.close()
  })
})
