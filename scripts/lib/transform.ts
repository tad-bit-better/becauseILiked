import type { TMDBMovieDetails } from './tmdb'
import { posterUrl } from './tmdb'

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
    },
    poster_url: posterUrl(movie.poster_path),
  }
}