// IGDB client.
// Docs: https://api-docs.igdb.com/
//
// Auth flow:
//   POST https://id.twitch.tv/oauth2/token?client_id=X&client_secret=Y&grant_type=client_credentials
//   → { access_token, expires_in, token_type }
//
// Queries are POST to https://api.igdb.com/v4/<endpoint>
// Body is Apicalypse (plain text): "fields name,summary; where rating > 80; limit 500;"
// Every request needs headers: Client-ID: <client_id>, Authorization: Bearer <token>

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const IGDB_BASE = 'https://api.igdb.com/v4'
const COVER_BASE = 'https://images.igdb.com/igdb/image/upload/t_cover_big'

// ----- Types -----

export interface IGDBGame {
  id: number
  name: string
  summary?: string
  storyline?: string
  first_release_date?: number  // unix timestamp (seconds)
  cover?: { id: number; image_id: string }
  genres?: Array<{ id: number; name: string }>
  themes?: Array<{ id: number; name: string }>
  keywords?: Array<{ id: number; name: string }>
  involved_companies?: Array<{
    company: { id: number; name: string }
    developer: boolean
    publisher: boolean
  }>
  rating?: number               // 0-100, aggregated critic rating
  rating_count?: number
  total_rating?: number         // blend of critic + user
  total_rating_count?: number
  platforms?: Array<{ id: number; name: string; abbreviation?: string }>
  game_modes?: Array<{ id: number; name: string }>
}

// ----- Token management -----

interface TokenCache {
  accessToken: string
  expiresAt: number  // unix timestamp (ms) when token expires
}

let tokenCache: TokenCache | null = null

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s safety margin)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken
  }

  const clientId = process.env.TWITCH_CLIENT_ID
  const clientSecret = process.env.TWITCH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET in env')
  }

  const url = `${TWITCH_TOKEN_URL}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`
  const response = await fetch(url, { method: 'POST' })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to get Twitch token: ${response.status}\n${body}`)
  }

  const data = (await response.json()) as {
    access_token: string
    expires_in: number
    token_type: string
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }

  console.log(
    `  🔑 Fetched new Twitch token (expires in ${Math.floor(data.expires_in / 86400)} days)`
  )
  return data.access_token
}

// ----- Fetch with retry -----

async function igdbFetch<T>(endpoint: string, body: string, attempt = 1): Promise<T> {
  const MAX_ATTEMPTS = 5
  const token = await getAccessToken()

  try {
    const response = await fetch(`${IGDB_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'Client-ID': process.env.TWITCH_CLIENT_ID!,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body,
    })

    if (!response.ok) {
      const errBody = await response.text()
      // 401 = token expired mid-flight; clear cache and let next call refresh
      if (response.status === 401) {
        tokenCache = null
        throw new Error(`IGDB returned 401 (token invalid); will refresh on retry`)
      }
      throw new Error(
        `IGDB ${endpoint} failed: ${response.status} ${response.statusText}\n${errBody.slice(0, 200)}`
      )
    }

    return response.json() as Promise<T>
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    const message = (err as Error).message || ''
    const isTransient =
      err instanceof TypeError ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'UND_ERR_SOCKET' ||
      message.includes('401')

    if (isTransient && attempt < MAX_ATTEMPTS) {
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000)
      console.warn(
        `  ⟲ retry ${attempt}/${MAX_ATTEMPTS - 1} for IGDB ${endpoint} after ${backoffMs}ms`
      )
      await new Promise((r) => setTimeout(r, backoffMs))
      return igdbFetch<T>(endpoint, body, attempt + 1)
    }

    throw err
  }
}

// ----- Public API -----

/**
 * Fetch a page of popular games, ordered by IGDB's blended total_rating.
 * IGDB's Apicalypse language lets us request only the fields we need —
 * much cheaper than fetching every column.
 *
 * The "relationship expansion" syntax (e.g. `genres.name`) tells IGDB to
 * resolve the foreign key inline, saving us round trips.
 */
export async function fetchPopularGames(
  offset: number,
  limit: number = 100
): Promise<IGDBGame[]> {
  const body = `
    fields
      name, summary, storyline, first_release_date,
      cover.id, cover.image_id,
      genres.name, themes.name, keywords.name,
      involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
      rating, rating_count, total_rating, total_rating_count,
      platforms.name, platforms.abbreviation, game_modes.name;
    where total_rating_count > 10;
    sort total_rating desc;
    limit ${limit};
    offset ${offset};
  `.trim()

  return igdbFetch<IGDBGame[]>('games', body)
}

export function coverUrl(imageId: string | undefined): string | null {
  return imageId ? `${COVER_BASE}/${imageId}.jpg` : null
}