// packages/main/src/aep/upstream/passE/customerSignalIngester.ts
import fs from 'node:fs'
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import { upsertNode } from '../../graphWrite'

type SignalType = 'feature_request' | 'defect' | 'usability' | 'churn_risk' | 'pricing' | 'noise'

const VALID_TYPES = new Set<SignalType>([
  'feature_request',
  'defect',
  'usability',
  'churn_risk',
  'pricing',
  'noise',
])

function normalizeType(raw: string | undefined): SignalType {
  const t = (raw ?? '').toLowerCase().replace(/[-\s]/g, '_') as SignalType
  return VALID_TYPES.has(t) ? t : 'noise'
}

interface RawSignal {
  cohort: string
  type: string
  text: string
  date?: string
}

export interface SignalIngestResult {
  inserted: number
  skipped: number
  signalNodeIds: number[]
}

function parseCsv(content: string): RawSignal[] {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase())
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
    const obj: Record<string, string> = {}
    header.forEach((h, i) => { obj[h] = values[i] ?? '' })
    return { cohort: obj['cohort'] ?? '', type: obj['type'] ?? '', text: obj['text'] ?? '', date: obj['date'] }
  })
}

export class CustomerSignalIngester {
  private readonly insertSignal: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertSignal = db.prepare(
      `INSERT OR IGNORE INTO customer_signals
       (signal_node_id, source_system, source_id, customer_cohort, signal_type, raw_text_hash, signal_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
  }

  ingestFile(filePath: string, sourceSystem = 'import'): SignalIngestResult {
    const content = fs.readFileSync(filePath, 'utf8')
    const ext = filePath.split('.').pop()?.toLowerCase()
    const signals: RawSignal[] = ext === 'json'
      ? (JSON.parse(content) as RawSignal[])
      : parseCsv(content)
    return this.ingestSignals(signals, sourceSystem)
  }

  ingestRaw(signals: RawSignal[], sourceSystem = 'api'): SignalIngestResult {
    return this.ingestSignals(signals, sourceSystem)
  }

  private ingestSignals(signals: RawSignal[], sourceSystem: string): SignalIngestResult {
    const signalNodeIds: number[] = []
    let inserted = 0
    let skipped = 0

    const run = this.db.transaction(() => {
      for (const s of signals) {
        if (!s.text?.trim() || !s.cohort?.trim()) { skipped++; continue }

        const hash = crypto.createHash('sha256').update(s.text).digest('hex')
        const existing = this.db
          .prepare<[string], { signal_node_id: number }>(
            'SELECT signal_node_id FROM customer_signals WHERE raw_text_hash = ?',
          )
          .get(hash)
        if (existing) {
          signalNodeIds.push(existing.signal_node_id)
          skipped++
          continue
        }

        const label = s.text.slice(0, 120)
        const nodeId = upsertNode(this.db, {
          kind: 'CUSTOMER_SIGNAL',
          label,
          description: s.text.length > 120 ? s.text.slice(0, 500) : null,
          source_type: 'customer_signal',
          source_ref: sourceSystem,
        })

        const signalDate = s.date
          ? (new Date(s.date).getTime() || Date.now())
          : Date.now()

        this.insertSignal.run(
          nodeId,
          sourceSystem,
          hash.slice(0, 16),
          s.cohort,
          normalizeType(s.type),
          hash,
          signalDate,
        )
        signalNodeIds.push(nodeId)
        inserted++
      }
    })
    run()
    return { inserted, skipped, signalNodeIds }
  }
}
