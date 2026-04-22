import { setDefaultResultOrder } from 'node:dns'
setDefaultResultOrder('ipv4first')

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from './lib/supabase'
import {
  upsertItemBatch,
  sleep,
  type ItemRow,
} from './lib/seed-helpers'
import { fetchPopularGames } from './lib/igdb'
import { igdbGameToItem } from './lib/transform'

// IGDB returns games with all their fields expanded in one shot (unlike TMDB
// which needs a separate detail call per item). So this seeder is simpler —
// we just page through results and upsert directly. No runInterleavedPipeline needed.

const TARGET_COUNT = 1000
const PAGE_SIZE = 100                  // IGDB max is 500 but 100 is a nice balance
const BATCH_INSERT_SIZE = 50
const INTER_PAGE_DELAY_MS = 300        // IGDB rate limit is 4 req/sec; 300ms = safe margin

async function main() {
  console.log(`Starting IGDB game seed — target: ${TARGET_COUNT} games`)

  const supabase = createAdminClient()

  let collected: ItemRow[] = []
  let offset = 0
  let pageNum = 0

  console.log(`\nStep 1: Paging through IGDB popular games...`)
  while (collected.length < TARGET_COUNT) {
    pageNum++
    const games = await fetchPopularGames(offset, PAGE_SIZE)
    if (games.length === 0) {
      console.log('  (end of results)')
      break
    }

    const items = games.map(igdbGameToItem)
    collected.push(...items)
    console.log(`  page ${pageNum} — got ${games.length} games (total ${collected.length})`)
    offset += games.length

    await sleep(INTER_PAGE_DELAY_MS)
  }

  // Trim to exact target
  collected = collected.slice(0, TARGET_COUNT)
  console.log(`\nCollected ${collected.length} games. Upserting in batches of ${BATCH_INSERT_SIZE}...`)

  let successCount = 0
  for (let i = 0; i < collected.length; i += BATCH_INSERT_SIZE) {
    const batch = collected.slice(i, i + BATCH_INSERT_SIZE)
    const upserted = await upsertItemBatch(supabase, batch, 'igdb_uid', 'igdb_uid')
    successCount += upserted
    console.log(`  ✓ upserted batch — ${successCount}/${collected.length} saved`)
  }

  console.log(`\n✅ Game seed complete. ${successCount} items upserted.`)
}

main().catch((err) => {
  console.error('\n❌ Seed failed:')
  console.error(err)
  process.exit(1)
})