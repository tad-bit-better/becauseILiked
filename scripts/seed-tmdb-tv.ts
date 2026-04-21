import { setDefaultResultOrder } from 'node:dns'
setDefaultResultOrder('ipv4first')

import { config } from 'dotenv'
config({ path: '.env.local' })

import { fetchPopularShows, fetchShowDetails } from './lib/tmdb'
import { tmdbShowToItem } from './lib/transform'
import { createAdminClient } from './lib/supabase'
import {
  upsertItemBatch,
  runInterleavedPipeline,
  sleep,
} from './lib/seed-helpers'

const TARGET_COUNT = 500
const BATCH_INSERT_SIZE = 50
const DETAIL_REQUEST_DELAY_MS = 50
const PAGE_BUFFER = 5

async function main() {
  console.log(`Starting TMDB TV seed — target: ${TARGET_COUNT} shows`)

  const supabase = createAdminClient()

  // Step 1: Collect unique show IDs
  const pagesNeeded = Math.ceil(TARGET_COUNT / 20) + PAGE_BUFFER
  const seenIds = new Set<number>()
  const showIds: number[] = []

  console.log(`\nStep 1: Fetching up to ${pagesNeeded} pages of popular shows...`)
  for (let page = 1; page <= pagesNeeded; page++) {
    if (showIds.length >= TARGET_COUNT) break
    const data = await fetchPopularShows(page)
    for (const show of data.results) {
      if (showIds.length >= TARGET_COUNT) break
      if (seenIds.has(show.id)) continue
      seenIds.add(show.id)
      showIds.push(show.id)
    }
    console.log(`  page ${page}/${pagesNeeded} — collected ${showIds.length} unique IDs`)
    await sleep(100)
  }

  // Steps 2+3 via the shared pipeline
  const { successCount, failures } = await runInterleavedPipeline({
    label: 'Step 2+3',
    batchSize: BATCH_INSERT_SIZE,
    detailDelayMs: DETAIL_REQUEST_DELAY_MS,
    ids: showIds,
    fetchDetail: fetchShowDetails,
    toItem: tmdbShowToItem,
    upsertBatch: (batch) =>
      upsertItemBatch(supabase, batch, 'tmdb_uid', 'tmdb_id'),
  })

  console.log(
    `\n✅ TV seed complete. ${successCount} items upserted. ${failures} failures.`
  )
}

main().catch((err) => {
  console.error('\n❌ Seed failed:')
  console.error(err)
  process.exit(1)
})