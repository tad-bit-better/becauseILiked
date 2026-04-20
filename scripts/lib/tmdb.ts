// Thin wrapper around TMDB's REST API.
// Docs: https://developer.themoviedb.org/reference/intro/getting-started

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500'

export interface TMDBMovie {
  id: number
  title: string
  original_title: string
  release_date: string
  overview: string
  poster_path: string | null
  genre_ids: number[]
  popularity: number
  vote_average: number
  vote_count: number
}

export interface TMDBMovieDetails extends TMDBMovie {
  runtime: number | null
  genres: Array<{ id: number; name: string }>
  credits?: {
    crew: Array<{ job: string; name: string; id: number }>
    cast: Array<{ name: string; character: string; id: number; order: number }>
  }
  keywords?: {
    keywords: Array<{ id: number; name: string }>
  }
}

// Shared fetch helper with auth + error handling
async function tmdbFetch<T>(path: string, attempt = 1): Promise<T> {
  const MAX_ATTEMPTS = 5
  const url = `${TMDB_BASE_URL}${path}`

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}`,
      },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `TMDB request failed: ${response.status} ${response.statusText}\nPath: ${path}\nBody: ${body}`
      )
    }

    return response.json() as Promise<T>
  } catch (err) {
    const isTransient =
      err instanceof TypeError || // "fetch failed" wrapper
      (err as NodeJS.ErrnoException)?.code === 'ECONNRESET' ||
      (err as NodeJS.ErrnoException)?.code === 'ETIMEDOUT' ||
      (err as NodeJS.ErrnoException)?.code === 'UND_ERR_SOCKET'

    if (isTransient && attempt < MAX_ATTEMPTS) {
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000)
      console.warn(
        `  ⟲ retry ${attempt}/${MAX_ATTEMPTS - 1} for ${path} after ${backoffMs}ms (${(err as Error).message.slice(0, 60)})`
      )
      await new Promise((r) => setTimeout(r, backoffMs))
      return tmdbFetch<T>(path, attempt + 1)
    }

    throw err
  }
}

/**
 * Fetch a page of popular movies. TMDB returns 20 per page.
 * Page 1 = most popular, higher pages = less popular.
 */
export async function fetchPopularMovies(page: number): Promise<{
  results: TMDBMovie[]
  total_pages: number
}> {
  return tmdbFetch(`/movie/popular?language=en-US&page=${page}`)
}

/**
 * Fetch full details for a movie including credits and keywords.
 * We need this because the "popular" endpoint doesn't include director/keywords.
 * append_to_response lets us bundle 3 requests into 1.
 */
export async function fetchMovieDetails(movieId: number): Promise<TMDBMovieDetails> {
  return tmdbFetch(
    `/movie/${movieId}?language=en-US&append_to_response=credits,keywords`
  )
}

export function posterUrl(posterPath: string | null): string | null {
  return posterPath ? `${POSTER_BASE_URL}${posterPath}` : null
}