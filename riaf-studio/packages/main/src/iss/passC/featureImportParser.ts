// packages/main/src/iss/passC/featureImportParser.ts
import type { FeatureCreateInput, ImportFormat, ImportPreviewResult, SDLCPhase } from '@shared/index'

const VALID_PHASES = new Set([
  'requirements',
  'design',
  'implementation',
  'testing',
  'deployment',
  'maintenance',
])

export class FeatureImportParser {
  detectFormat(content: string, hint?: string): ImportFormat {
    if (hint === 'csv') return 'csv'
    if (hint === 'json') return 'json'
    if (hint === 'yaml' || hint === 'yml') return 'yaml'
    const trimmed = content.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json'
    if (trimmed.includes('label:') || trimmed.includes('- name:')) return 'yaml'
    if (trimmed.includes(',') && trimmed.split('\n')[0]?.includes(',')) return 'csv'
    return 'text'
  }

  parse(content: string, format?: ImportFormat): FeatureCreateInput[] {
    const fmt = format ?? this.detectFormat(content)
    switch (fmt) {
      case 'text':
        return this.parseText(content)
      case 'csv':
        return this.parseCsv(content)
      case 'json':
        return this.parseJson(content)
      case 'yaml':
        return this.parseYaml(content)
      default:
        return this.parseText(content)
    }
  }

  preview(
    content: string,
    format?: ImportFormat,
    existingLabels?: Set<string>,
  ): ImportPreviewResult {
    const fmt = format ?? this.detectFormat(content)
    let items: FeatureCreateInput[] = []
    let parseError: string | null = null

    try {
      items = this.parse(content, fmt)
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
    }

    const known = existingLabels ?? new Set<string>()
    const previews = items.map((item) => {
      const errors: string[] = []
      if (!item.label || item.label.length < 3) errors.push('Label must be at least 3 characters')
      if (!item.description || item.description.length < 10)
        errors.push('Description must be at least 10 characters (needed for C4 alignment)')
      const isDuplicate = known.has(item.label.toLowerCase())
      return {
        label: item.label,
        description: item.description,
        sdlcPhase: (item.sdlcPhase ?? 'requirements') as SDLCPhase,
        valid: errors.length === 0 && !isDuplicate,
        error:
          errors.length > 0
            ? errors.join('; ')
            : isDuplicate
              ? 'Duplicate: a feature with this name already exists'
              : undefined,
      }
    })

    if (parseError) {
      return {
        format: fmt,
        total: 0,
        valid: 0,
        invalid: 0,
        duplicates: 0,
        items: [
          {
            label: '',
            description: parseError,
            sdlcPhase: 'requirements',
            valid: false,
            error: parseError,
          },
        ],
      }
    }

    return {
      format: fmt,
      total: previews.length,
      valid: previews.filter((p) => p.valid).length,
      invalid: previews.filter((p) => !p.valid && !p.error?.startsWith('Duplicate')).length,
      duplicates: previews.filter((p) => p.error?.startsWith('Duplicate')).length,
      items: previews,
    }
  }

  private parseText(content: string): FeatureCreateInput[] {
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((line) => {
        const sepIdx = line.search(/\s*[—–]|--|:\s/)
        if (sepIdx > 0) {
          const label = line.slice(0, sepIdx).trim()
          const description = line
            .slice(sepIdx)
            .replace(/^[—–:–\-]+\s*/, '')
            .trim()
          return { label, description, sdlcPhase: 'requirements' as SDLCPhase }
        }
        return { label: line, description: line, sdlcPhase: 'requirements' as SDLCPhase }
      })
  }

  private parseCsv(content: string): FeatureCreateInput[] {
    const lines = content.trim().split('\n')
    if (lines.length < 2) return []

    const headers = this.splitCsvRow(lines[0]!).map((h) => h.toLowerCase().trim())
    const nameIdx = headers.findIndex((h) => ['name', 'label', 'feature', 'title'].includes(h))
    const descIdx = headers.findIndex((h) =>
      ['description', 'desc', 'details', 'summary'].includes(h),
    )
    const phaseIdx = headers.findIndex((h) => ['phase', 'sdlc_phase', 'stage'].includes(h))
    const refIdx = headers.findIndex((h) => ['source_ref', 'ref', 'id', 'ticket'].includes(h))

    if (nameIdx === -1) {
      throw new Error('CSV must have a column named "name", "label", "feature", or "title"')
    }
    if (descIdx === -1) {
      throw new Error(
        'CSV must have a column named "description", "desc", "details", or "summary". ' +
          'A description is required for C4 alignment.',
      )
    }

    return lines
      .slice(1)
      .map((line) => this.splitCsvRow(line))
      .filter((cols) => cols.length > nameIdx && cols[nameIdx]?.trim())
      .map((cols) => {
        const rawPhase = phaseIdx >= 0 ? cols[phaseIdx]?.toLowerCase().trim() : undefined
        const phase = (
          rawPhase && VALID_PHASES.has(rawPhase) ? rawPhase : 'requirements'
        ) as SDLCPhase
        return {
          label: (cols[nameIdx] ?? '').trim(),
          description: (cols[descIdx] ?? '').trim(),
          sdlcPhase: phase,
          sourceRef: refIdx >= 0 ? cols[refIdx]?.trim() : undefined,
        }
      })
  }

  private parseJson(content: string): FeatureCreateInput[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(content.replace(/```json|```/g, '').trim())
    } catch (e) {
      throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
    }

    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items.map((item, idx) => {
      if (typeof item !== 'object' || !item) throw new Error(`Item ${idx}: expected object`)
      const obj = item as Record<string, unknown>
      const label = (obj['name'] ?? obj['label'] ?? obj['feature'] ?? obj['title'] ?? '') as string
      const description = (obj['description'] ??
        obj['desc'] ??
        obj['details'] ??
        obj['summary'] ??
        '') as string
      const rawPhase = (obj['phase'] ?? obj['sdlc_phase'] ?? 'requirements') as string
      const phase = (
        VALID_PHASES.has(rawPhase.toLowerCase()) ? rawPhase.toLowerCase() : 'requirements'
      ) as SDLCPhase

      return {
        label: String(label).trim(),
        description: String(description).trim(),
        sdlcPhase: phase,
        sourceRef: obj['source_ref'] ? String(obj['source_ref']) : undefined,
      }
    })
  }

  private parseYaml(content: string): FeatureCreateInput[] {
    const result: FeatureCreateInput[] = []
    const lines = content.split('\n')
    let current: Partial<FeatureCreateInput> | null = null

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue

      if (line.startsWith('- ')) {
        if (current?.label) result.push(this.normalizeYamlItem(current))
        const value = line.slice(2).trim()
        if (value.includes(':')) {
          const sep = value.indexOf(':')
          const key = value.slice(0, sep).toLowerCase().trim()
          const val = value.slice(sep + 1).trim()
          current = {}
          if (['name', 'label', 'feature'].includes(key)) current.label = val
          else if (['desc', 'description'].includes(key)) current.description = val
        } else if (value.includes('--') || value.includes('—')) {
          const sep = value.search(/--|—/)
          current = {
            label: value.slice(0, sep).trim(),
            description: value
              .slice(sep)
              .replace(/^[-—]+\s*/, '')
              .trim(),
            sdlcPhase: 'requirements',
          }
          result.push(this.normalizeYamlItem(current))
          current = null
        } else {
          current = { label: value }
        }
        continue
      }

      if (current && line.includes(':')) {
        const sep = line.indexOf(':')
        const key = line.slice(0, sep).toLowerCase().trim()
        const val = line.slice(sep + 1).trim()
        if (['name', 'label', 'feature'].includes(key)) current.label = val
        if (['desc', 'description', 'details'].includes(key)) current.description = val
        if (['phase', 'sdlc_phase'].includes(key)) current.sdlcPhase = val as SDLCPhase
        if (['source_ref', 'ref', 'id'].includes(key)) current.sourceRef = val
      }
    }
    if (current?.label) result.push(this.normalizeYamlItem(current))
    return result
  }

  private normalizeYamlItem(item: Partial<FeatureCreateInput>): FeatureCreateInput {
    return {
      label: (item.label ?? '').trim(),
      description: (item.description ?? item.label ?? '').trim(),
      sdlcPhase: (
        VALID_PHASES.has(item.sdlcPhase ?? '') ? item.sdlcPhase! : 'requirements'
      ) as SDLCPhase,
      sourceRef: item.sourceRef,
    }
  }

  private splitCsvRow(line: string): string[] {
    const result: string[] = []
    let field = ''
    let inQuote = false
    let sep = ','
    if (!line.includes(',') && line.includes(';')) sep = ';'
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (ch === '"') {
        inQuote = !inQuote
        continue
      }
      if (ch === sep && !inQuote) {
        result.push(field)
        field = ''
        continue
      }
      field += ch
    }
    result.push(field)
    return result.map((f) => f.trim().replace(/^"|"$/g, ''))
  }
}
