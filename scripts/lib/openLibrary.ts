// Thin wrapper around Open Library's search and works APIs.
// Docs: https://openlibrary.org/developers/api
//
// Two endpoints we care about:
//   /search.json?q=<query>&sort=<sort>  → lightweight search results
//   /works/<olid>.json                   → full detail for a single work

const OPENLIBRARY_BASE = 'https://openlibrary.org'
const COVER_BASE = 'https://covers.openlibrary.org/b/id'

export interface OLSearchDoc {
  key: string                       // "/works/OL45804W" — strip prefix for canonical ID
  title: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number                  // cover image ID; null for many books
  subject?: string[]                // sometimes heavily polluted with tags; we'll filter
  ratings_average?: number
  edition_count?: number
  language?: string[]               // e.g. ["eng", "fre"] — lets us filter to English
  isbn?: string[]
}

export interface OLWork {
  key: string                       // "/works/OL45804W"
  title: string
  description?: string | { value: string }  // sometimes a string, sometimes an object; normalize
  subjects?: string[]
  covers?: number[]
  first_publish_date?: string
  authors?: Array<{ author: { key: string } }>  // author keys need separate resolution; skip for now
}

/**
 * Strip the "/works/" prefix to get the canonical OLID (e.g. "OL45804W").
 */
export function workIdFromKey(key: string): string {
  return key.replace(/^\/works\//, '')
}

/**
 * Normalize Open Library's description which may be a string or an object wrapper.
 */
export function normalizeDescription(
  d: OLWork['description']
): string | null {
  if (!d) return null
  return typeof d === 'string' ? d : d.value
}

/**
 * Build a cover URL for a given cover ID. Returns null if no cover.
 * Sizes: S (small), M (medium), L (large).
 */
export function coverUrl(coverId: number | null | undefined, size: 'S' | 'M' | 'L' = 'L'): string | null {
  return coverId ? `${COVER_BASE}/${coverId}-${size}.jpg` : null
}

// ----- Fetch with retry -----

async function olFetch<T>(path: string, attempt = 1): Promise<T> {
  const MAX_ATTEMPTS = 5
  const url = `${OPENLIBRARY_BASE}${path}`

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'User-Agent': 'BecauseILiked/1.0 (personal project; github.com/yourhandle)',
      },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `OpenLibrary request failed: ${response.status} ${response.statusText}\nPath: ${path}\nBody: ${body.slice(0, 200)}`
      )
    }

    return response.json() as Promise<T>
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    const isTransient =
      err instanceof TypeError ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'UND_ERR_SOCKET'

    if (isTransient && attempt < MAX_ATTEMPTS) {
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000)
      console.warn(
        `  ⟲ retry ${attempt}/${MAX_ATTEMPTS - 1} for ${path} after ${backoffMs}ms`
      )
      await new Promise((r) => setTimeout(r, backoffMs))
      return olFetch<T>(path, attempt + 1)
    }

    throw err
  }
}

/**
 * Search for books by subject, sorted by rating.
 * Returns at most `limit` results per page.
 */
export async function searchBooksBySubject(
  subject: string,
  page: number,
  limit: number = 50
): Promise<{ numFound: number; docs: OLSearchDoc[] }> {
  // `language:eng` filter keeps the corpus English-only for now.
  // `has_fulltext:true` is tempting but over-filters — lots of good books lack Open Library fulltext.
  const q = encodeURIComponent(`subject:${subject} language:eng`)
  const path = `/search.json?q=${q}&sort=rating&limit=${limit}&page=${page}&fields=key,title,author_name,first_publish_year,cover_i,subject,ratings_average,edition_count,language,isbn`
  return olFetch(path)
}

/**
 * Fetch a single work's full details by OLID (e.g. "OL45804W").
 */
export async function fetchWork(olid: string): Promise<OLWork> {
  return olFetch(`/works/${olid}.json`)
}