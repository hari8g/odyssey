import { describe, it, expect } from 'vitest'
import { EmbeddingService } from '../indexer/embeddingService'

describe('EmbeddingService', () => {
  it('serializes and deserializes float32 vectors', () => {
    const vec = [0.1, -0.5, 1.25, 0]
    const buf = EmbeddingService.serializeFloat32(vec)
    const back = EmbeddingService.deserializeFloat32(buf)
    expect(back.length).toBe(4)
    expect(back[0]).toBeCloseTo(0.1, 5)
    expect(back[1]).toBeCloseTo(-0.5, 5)
    expect(back[2]).toBeCloseTo(1.25, 5)
  })

  it('computes cosine similarity', () => {
    expect(EmbeddingService.cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(EmbeddingService.cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('sanitizes FTS queries', () => {
    const q = EmbeddingService.sanitizeFts(`foo"bar(baz)`)
    expect(q).not.toMatch(/["()]/)
    expect(q.endsWith('*') || q.length > 0).toBe(true)
  })
})
