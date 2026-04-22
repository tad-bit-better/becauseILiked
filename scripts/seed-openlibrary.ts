import { setDefaultResultOrder } from 'node:dns'
setDefaultResultOrder('ipv4first')

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from './lib/supabase'
import {
  upsertItemBatch,
  runInterleavedPipeline,
  sleep,
  type ItemRow,
} from './lib/seed-helpers'
import {
  searchBooksBySubject,
  fetchWork,
  workIdFromKey,
  type OLSearchDoc,
} from './lib/openLibrary'
import { olBookToItem } from './lib/transform'

// Subjects chosen to give breadth across what recommendation users actually want.
// Open Library subjects are user-tagged so we pick broad ones with decent data.
const SUBJECTS = [
  'fiction',
  'science_fiction',
  'fantasy',
  'mystery',
  'thriller',
  'romance',
  'historical_fiction',
  'literary_fiction',
  'horror',
  'young_adult',
  'biography',
  'memoir',
  'philosophy',
  'psychology',
  'history',
]

const PER_SUBJECT_TARGET = 100        // ~100 books per subject
const SEARCH_PAGE_SIZE = 50           // Open Library max is 100 but 50 is faster
const BATCH_INSERT_SIZE = 50
const DETAIL_REQUEST_DELAY_MS = 100   // Open Library is less permissive than TMDB

async function main() {
  console.log(
    `Starting Open Library seed — targeting ~${PER_SUBJECT_TARGET} books × ${SUBJECTS.length} subjects = ~${PER_SUBJECT_TARGET * SUBJECTS.length} books max`
  )

  const supabase = createAdminClient()

  // Step 1: Collect search docs (with dedup by work ID) across all subjects.
  // We keep the search docs themselves (not just IDs) because they contain
  // fields like author_name that aren't in the /works endpoint.
  const collected = new Map<string, OLSearchDoc>()

  console.log(`\nStep 1: Searching across ${SUBJECTS.length} subjects...`)
  for (const subject of SUBJECTS) {
    const before = collected.size
    const pagesNeeded = Math.ceil(PER_SUBJECT_TARGET / SEARCH_PAGE_SIZE)

    for (let page = 1; page <= pagesNeeded; page++) {
      try {
        const result = await searchBooksBySubject(subject, page, SEARCH_PAGE_SIZE)
        for (const doc of result.docs) {
          const olid = workIdFromKey(doc.key)
          if (!collected.has(olid)) {
            collected.set(olid, doc)
          }
        }
      } catch (err) {
        console.warn(`  ! search failed for subject=${subject} page=${page}:`, (err as Error).message)
      }
      await sleep(200) // be polite between searches
    }

    const added = collected.size - before
    console.log(`  ✓ ${subject}: +${added} new (total ${collected.size})`)
  }

  console.log(`\nCollected ${collected.size} unique books across subjects.`)

  // Step 2+3: Fetch detail + upsert. Key: Array.from needed for the pipeline.
  const entries = Array.from(collected.entries())  // [[olid, searchDoc], ...]
  const olids = entries.map(([olid]) => olid)
  const searchDocByOlid = new Map(entries)

  const { successCount, failures } = await runInterleavedPipeline({
    label: 'Step 2+3',
    batchSize: BATCH_INSERT_SIZE,
    detailDelayMs: DETAIL_REQUEST_DELAY_MS,
    ids: olids,
    fetchDetail: async (olid: string) => {
      const work = await fetchWork(olid)
      const searchDoc = searchDocByOlid.get(olid)!
      return { searchDoc, work }
    },
    toItem: ({ searchDoc, work }): ItemRow => olBookToItem(searchDoc, work),
    upsertBatch: (batch) =>
      upsertItemBatch(supabase, batch, 'olid_uid', 'olid_uid'),
  })

  console.log(
    `\n✅ Book seed complete. ${successCount} items upserted. ${failures} failures.`
  )
}

main().catch((err) => {
  console.error('\n❌ Seed failed:')
  console.error(err)
  process.exit(1)
})