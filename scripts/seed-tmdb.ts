import { setDefaultResultOrder } from 'node:dns'
setDefaultResultOrder('ipv4first')

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { fetchPopularMovies, fetchMovieDetails } from './lib/tmdb'
import { tmdbMovieToItem, type ItemRow } from './lib/transform'

// ----- Config -----
const TARGET_COUNT = 500
const BATCH_INSERT_SIZE = 50
const DETAIL_REQUEST_DELAY_MS = 50
const PAGE_BUFFER = 5 // extra pages of popular movies to fetch as insurance against duplicates

// ----- Supabase admin client (bypasses RLS) -----
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

// ----- Helpers -----
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Upsert a batch of items into Supabase.
 * Deduplicates within the batch as a defensive measure — a single upsert command
 * cannot touch the same row twice, and TMDB occasionally returns the same movie
 * across pages, so we guard against it here too.
 */
async function upsertBatch(batch: ItemRow[]): Promise<number> {
  const seen = new Set<string>()
  const deduped = batch.filter((item) => {
    const id = String(item.external_ids.tmdb_id)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  const { error } = await supabase.from('items').upsert(deduped, {
    onConflict: 'tmdb_id',
  })

  if (error) {
    console.error('  ! upsert failed:', error.message)
    console.error('  full error:', error)
    throw error
  }

  return deduped.length
}

// ----- Main -----
async function main() {
  console.log(`Starting TMDB seed — target: ${TARGET_COUNT} movies`)

  // Step 1: Collect unique movie IDs across popular-movie pages.
  // TMDB sometimes returns the same movie on adjacent pages as popularity shifts,
  // so we track seen IDs and fetch a few extra pages as a buffer.
  const pagesNeeded = Math.ceil(TARGET_COUNT / 20) + PAGE_BUFFER
  const seenIds = new Set<number>()
  const movieIds: number[] = []

  console.log(`\nStep 1: Fetching up to ${pagesNeeded} pages of popular movies...`)
  for (let page = 1; page <= pagesNeeded; page++) {
    if (movieIds.length >= TARGET_COUNT) break

    const data = await fetchPopularMovies(page)
    for (const movie of data.results) {
      if (movieIds.length >= TARGET_COUNT) break
      if (seenIds.has(movie.id)) continue
      seenIds.add(movie.id)
      movieIds.push(movie.id)
    }
    console.log(`  page ${page}/${pagesNeeded} — collected ${movieIds.length} unique IDs`)
    await sleep(100)
  }

  // Step 2 + 3 interleaved: fetch details, upsert in batches as we go.
  // Interleaving means if the script dies midway, whatever batches already
  // succeeded are already in the DB — safe to rerun and pick up where we left off.
  console.log(`\nStep 2+3: Fetching details and upserting in batches of ${BATCH_INSERT_SIZE}...`)
  let buffer: ItemRow[] = []
  let successCount = 0
  let failures = 0

  for (let i = 0; i < movieIds.length; i++) {
    const id = movieIds[i]
    try {
      const details = await fetchMovieDetails(id)
      buffer.push(tmdbMovieToItem(details))
    } catch (err) {
      failures++
      console.warn(`  ! failed to fetch movie ${id}:`, (err as Error).message)
    }

    // Flush buffer whenever it hits the batch size
    if (buffer.length >= BATCH_INSERT_SIZE) {
      const upserted = await upsertBatch(buffer)
      successCount += upserted
      console.log(`  ✓ upserted batch — ${successCount}/${movieIds.length} saved`)
      buffer = []
    }

    await sleep(DETAIL_REQUEST_DELAY_MS)
  }

  // Flush any remaining items
  if (buffer.length > 0) {
    const upserted = await upsertBatch(buffer)
    successCount += upserted
    console.log(`  ✓ upserted final batch — ${successCount}/${movieIds.length} saved`)
  }

  console.log(
    `\n✅ Seed complete. ${successCount} items upserted. ${failures} detail fetch failures.`
  )
}

main().catch((err) => {
  console.error('\n❌ Seed failed with unexpected error:')
  console.error(err)
  process.exit(1)
})