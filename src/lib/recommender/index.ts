import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A single recommendation returned by the recommender.
 * The shape is deliberately designed to be stable across implementations —
 * Phase 3 will add semantic similarity, Phase 4 will add LLM-generated
 * `explanation` text, but the SHAPE won't change.
 */
export interface Recommendation {
  itemId: string
  title: string
  year: number | null
  posterUrl: string | null
  /** Why this was recommended. Phase 1 = generic; Phase 4 = LLM-personalized. */
  explanation: string
}

/**
 * The source "love" we're recommending against.
 */
export interface RecommenderInput {
  userId: string
  loveId: string
  itemId: string | null
  freeText: string
  /** Medium filter: only recommend within the same medium by default. */
  medium: 'film' | 'tv' | 'book' | 'game'
}

/**
 * The recommender's contract. Any implementation must conform to this.
 * Phase 1: random same-genre picks with a generic explanation.
 * Phase 3: semantic similarity using pgvector embeddings.
 * Phase 4: RAG — retrieve candidates with embeddings, rerank + explain with LLM.
 */
export type Recommender = (
  supabase: SupabaseClient,
  input: RecommenderInput
) => Promise<Recommendation[]>

/**
 * PHASE 1 IMPLEMENTATION — placeholder.
 * Picks 5 random items from the same medium that share at least one theme
 * with the source item. Does NOT use the free_text at all. This is
 * intentional: it proves the UI flow with zero AI dependency.
 *
 * Phase 3 will replace this with an embedding-based retriever.
 * Phase 4 will add LLM-written explanations.
 */
export const placeholderRecommender: Recommender = async (supabase, input) => {
  // Fetch source item to know its themes
  if (!input.itemId) {
    // User described something not in our catalog (freeform title).
    // Phase 1 can't handle that — just return nothing for now.
    return []
  }

  const { data: sourceItem } = await supabase
    .from('items')
    .select('id, themes')
    .eq('id', input.itemId)
    .single()

  if (!sourceItem) return []

  const sourceThemes = sourceItem.themes as string[]

  // Pull a pool of candidates in the same medium, sharing at least one theme,
  // excluding the source item itself.
  // We over-fetch (30) and shuffle client-side — Postgres's random ordering
  // is expensive at scale, but at 500 rows it's fine. Phase 3's retriever
  // will use pgvector instead.
  let query = supabase
    .from('items')
    .select('id, title, year, poster_url, themes')
    .eq('medium', input.medium)
    .neq('id', input.itemId)
    .limit(30)

  // Theme overlap filter — requires at least one common theme
  if (sourceThemes.length > 0) {
    query = query.overlaps('themes', sourceThemes)
  }

  const { data: candidates } = await query
  if (!candidates || candidates.length === 0) return []

  // Shuffle and take 5
  const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 5)

  return shuffled.map((c) => ({
    itemId: c.id,
    title: c.title,
    year: c.year,
    posterUrl: c.poster_url,
    explanation:
      'We found this because it shares themes with what you loved. Our AI-powered recommendations are coming soon — they\'ll explain exactly why each match fits your specific reasons.',
  }))
}

/**
 * The exported recommender that the rest of the app calls.
 * Swap this binding when a better implementation is ready.
 */
export const getRecommendations: Recommender = placeholderRecommender