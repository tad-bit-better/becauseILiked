import type { SupabaseClient } from '@supabase/supabase-js'

// ----- Types -----

export interface ItemRow {
  medium: 'film' | 'tv' | 'book' | 'game'
  title: string
  year: number | null
  creators: Array<{ role: string; name: string }>
  synopsis: string | null
  themes: string[]
  tone: string[]
  external_ids: Record<string, string | number>
  poster_url: string | null
}

export interface PipelineConfig<TId, TDetail> {
  label: string
  batchSize: number
  detailDelayMs: number
  ids: TId[]
  fetchDetail: (id: TId) => Promise<TDetail>
  toItem: (detail: TDetail) => ItemRow
  upsertBatch: (batch: ItemRow[]) => Promise<number>
}

// ----- Helpers -----

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function upsertItemBatch(
  supabase: SupabaseClient,
  batch: ItemRow[],
  onConflictKey: string,
  externalIdField: string
): Promise<number> {
  const seen = new Set<string>()
  const deduped = batch.filter((item) => {
    const id = String(item.external_ids[externalIdField])
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  const { error } = await supabase.from('items').upsert(deduped, {
    onConflict: onConflictKey,
  })

  if (error) {
    console.error('  ! upsert failed:', error.message)
    console.error('  full error:', error)
    throw error
  }

  return deduped.length
}

export async function runInterleavedPipeline<TId, TDetail>(
  config: PipelineConfig<TId, TDetail>
): Promise<{ successCount: number; failures: number }> {
  console.log(
    `\n${config.label}: Fetching details and upserting in batches of ${config.batchSize}...`
  )

  let buffer: ItemRow[] = []
  let successCount = 0
  let failures = 0

  for (let i = 0; i < config.ids.length; i++) {
    const id = config.ids[i]
    try {
      const detail = await config.fetchDetail(id)
      buffer.push(config.toItem(detail))
    } catch (err) {
      failures++
      console.warn(`  ! failed to fetch ${id}:`, (err as Error).message)
    }

    if (buffer.length >= config.batchSize) {
      const upserted = await config.upsertBatch(buffer)
      successCount += upserted
      console.log(`  ✓ upserted batch — ${successCount}/${config.ids.length} saved`)
      buffer = []
    }

    await sleep(config.detailDelayMs)
  }

  if (buffer.length > 0) {
    const upserted = await config.upsertBatch(buffer)
    successCount += upserted
    console.log(`  ✓ upserted final batch — ${successCount}/${config.ids.length} saved`)
  }

  return { successCount, failures }
}