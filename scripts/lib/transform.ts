import type { TMDBMovieDetails } from './tmdb'
import { posterUrl } from './tmdb'
import type { TMDBShowDetails } from './tmdb'
import type { OLSearchDoc, OLWork } from './openLibrary'
import { coverUrl, normalizeDescription, workIdFromKey } from './openLibrary'

import type { IGDBGame } from './igdb'
import { coverUrl as igdbCoverUrl } from './igdb'


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

/**
 * Transform a TMDB movie detail response into our items schema.
 * This is where the "enrichment" of Phase 1 happens — extracting
 * the signal we care about and dropping everything else.
 */
export function tmdbMovieToItem(movie: TMDBMovieDetails): ItemRow {
  const year = movie.release_date
    ? parseInt(movie.release_date.slice(0, 4), 10)
    : null

  // Directors = people in crew whose job is "Director"
  // TMDB sometimes lists multiple directors for co-directed films
  const directors =
    movie.credits?.crew
      .filter((c) => c.job === 'Director')
      .map((c) => ({ role: 'director', name: c.name })) ?? []

  // Top 3 billed cast members — enough for identification, not a dump
  const topCast =
    movie.credits?.cast
      .slice(0, 3)
      .map((c) => ({ role: 'actor', name: c.name })) ?? []

  // Writers — filter to "Screenplay" and "Writer" jobs
  const writers =
    movie.credits?.crew
      .filter((c) => c.job === 'Screenplay' || c.job === 'Writer')
      .slice(0, 2)
      .map((c) => ({ role: 'writer', name: c.name })) ?? []

  // Genres go into `themes` for now. In P3 we'll enrich these with
  // LLM-derived themes like "moral ambiguity" or "melancholy"
  const themes = movie.genres?.map((g) => g.name.toLowerCase()) ?? []

  // TMDB keywords often capture tone/mood better than genres
  // e.g. "bleak", "surreal", "coming of age". Good raw material
  const keywords =
    movie.keywords?.keywords?.map((k) => k.name.toLowerCase()) ?? []

  // For Phase 1, we dump keywords into `tone`. Phase 3 will split
  // into proper tone vs theme using the LLM.
  const tone = keywords.slice(0, 10)

  return {
    medium: 'film',
    title: movie.title,
    year,
    creators: [...directors, ...writers, ...topCast],
    synopsis: movie.overview || null,
    themes,
    tone,
    external_ids: {
  tmdb_id: movie.id,
  tmdb_uid: `film:${movie.id}`,
},
    poster_url: posterUrl(movie.poster_path),
  }
}



export function tmdbShowToItem(show: TMDBShowDetails): ItemRow {
  const year = show.first_air_date
    ? parseInt(show.first_air_date.slice(0, 4), 10)
    : null

  // Showrunners / creators — TV has a dedicated `created_by` field, cleaner than crew
  const creators = show.created_by.map((c) => ({ role: 'creator', name: c.name }))

  // Top 3 billed cast members
  const topCast =
    show.credits?.cast
      .slice(0, 3)
      .map((c) => ({ role: 'actor', name: c.name })) ?? []

  // Executive producers are sometimes more influential than "created by" in modern TV
  const executiveProducers =
    show.credits?.crew
      .filter((c) => c.job === 'Executive Producer')
      .slice(0, 2)
      .map((c) => ({ role: 'executive_producer', name: c.name })) ?? []

  const themes = show.genres?.map((g) => g.name.toLowerCase()) ?? []

  // TV keywords are nested under .results (different from films)
  const keywords =
    show.keywords?.results?.map((k) => k.name.toLowerCase()) ?? []

  const tone = keywords.slice(0, 10)

  return {
    medium: 'tv',
    title: show.name,
    year,
    creators: [...creators, ...executiveProducers, ...topCast],
    synopsis: show.overview || null,
    themes,
    tone,
  external_ids: {
  tmdb_id: show.id,
  tmdb_uid: `tv:${show.id}`,
},
    poster_url: posterUrl(show.poster_path),
  }
}


/**
 * Combine search-doc metadata (which has author/year/cover) with work-detail
 * metadata (which has description/full subject list) into a single ItemRow.
 *
 * We pass both because Open Library's search doesn't return description, and
 * the work endpoint doesn't return author names (it returns author keys that
 * would require another fetch to resolve — not worth the round trip for P2).
 */
export function olBookToItem(
  searchDoc: OLSearchDoc,
  work: OLWork
): ItemRow {
  const olid = workIdFromKey(searchDoc.key)

  // Authors from search doc (simpler than resolving from work's author keys)
  const creators = (searchDoc.author_name ?? [])
    .slice(0, 3)
    .map((name) => ({ role: 'author', name }))

  // Themes: prefer the work's subjects list (curated), fall back to search's
  // tags. Both can be polluted with noise like "Accessible book", "Protected DAISY"
  // that we filter out.
  const rawSubjects = work.subjects ?? searchDoc.subject ?? []
  const themes = rawSubjects
    .filter(isUsefulSubject)
    .slice(0, 10)
    .map((s) => s.toLowerCase())

  // Year: prefer search (first_publish_year is pre-parsed), fall back to work
  const year =
    searchDoc.first_publish_year ??
    (work.first_publish_date ? extractYear(work.first_publish_date) : null)

  // Cover: prefer search (already has cover_i), fall back to work
  const coverId = searchDoc.cover_i ?? work.covers?.[0] ?? null

  // Synopsis: only comes from work endpoint; may be absent
  const synopsis = normalizeDescription(work.description)

  return {
    medium: 'book',
    title: searchDoc.title || work.title,
    year,
    creators,
    synopsis: synopsis?.slice(0, 2000) ?? null,  // cap length; some OL descriptions are very long
    themes,
    tone: [],  // books don't have a keyword system like TMDB; leave empty for P2
    external_ids: {
      olid,
      olid_uid: `book:${olid}`,
    },
    poster_url: coverUrl(coverId, 'L'),
  }
}

/**
 * Filter out Open Library's "utility" tags that aren't actual themes.
 * List built from inspecting real data — expand as needed.
 */
function isUsefulSubject(subject: string): boolean {
  const noisePatterns = [
    /^accessible book$/i,
    /^protected daisy$/i,
    /^in library$/i,
    /^internet archive wishlist$/i,
    /^large type books$/i,
    /^open library staff picks$/i,
    /^lending library$/i,
    /^new york times/i,
    /^overdrive/i,
  ]
  return !noisePatterns.some((p) => p.test(subject))
}

function extractYear(dateStr: string): number | null {
  const match = dateStr.match(/\b(\d{4})\b/)
  return match ? parseInt(match[1], 10) : null
}
// posterUrl is already exported from ./tmdb; re-export for convenience
export { posterUrl } from './tmdb'



/**
 * Transform an IGDB game into our unified ItemRow.
 *
 * Design notes:
 * - IGDB's `themes` and `genres` are distinct concepts we'll merge into our
 *   single `themes` column (e.g. genre "Role-playing" + theme "Fantasy").
 * - `keywords` are IGDB's fine-grained tags (e.g. "time travel", "permadeath").
 *   These are great tone signals, so we route them into our `tone` column.
 * - We prefer `summary` over `storyline` for synopsis because storylines
 *   are often spoiler-heavy for story-driven games.
 */
export function igdbGameToItem(game: IGDBGame): ItemRow {
  const year = game.first_release_date
    ? new Date(game.first_release_date * 1000).getFullYear()
    : null

  // Developers first (usually more telling than publishers for taste),
  // then publishers, deduplicated
  const companies = game.involved_companies ?? []
  const devs = companies
    .filter((c) => c.developer)
    .slice(0, 2)
    .map((c) => ({ role: 'developer', name: c.company.name }))
  const pubs = companies
    .filter((c) => c.publisher && !c.developer)
    .slice(0, 2)
    .map((c) => ({ role: 'publisher', name: c.company.name }))

  // Merge IGDB genres + themes into our themes column
  const genres = game.genres?.map((g) => g.name.toLowerCase()) ?? []
  const igdbThemes = game.themes?.map((t) => t.name.toLowerCase()) ?? []
  const modes = game.game_modes?.map((m) => m.name.toLowerCase()) ?? []
  const themes = Array.from(new Set([...genres, ...igdbThemes, ...modes]))

  // Keywords → tone. Also include top 3 platforms as tone signal.
  const keywords = game.keywords?.map((k) => k.name.toLowerCase()) ?? []
  const platforms =
    game.platforms
      ?.map((p) => (p.abbreviation ?? p.name).toLowerCase())
      .slice(0, 3) ?? []
  const tone = Array.from(new Set([...keywords, ...platforms])).slice(0, 15)

  return {
    medium: 'game',
    title: game.name,
    year,
    creators: [...devs, ...pubs],
    synopsis: game.summary?.slice(0, 2000) ?? null,
    themes: themes.slice(0, 10),
    tone,
    external_ids: {
      igdb_id: game.id,
      igdb_uid: `game:${game.id}`,
    },
    poster_url: igdbCoverUrl(game.cover?.image_id),
  }
}
