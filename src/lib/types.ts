export type Medium = 'film' | 'tv' | 'book' | 'game'

export const MEDIUM_LABELS: Record<Medium, string> = {
  film: 'Films',
  tv: 'TV Shows',
  book: 'Books',
  game: 'Games',
}

export const MEDIUM_SINGULAR: Record<Medium, string> = {
  film: 'Film',
  tv: 'TV Show',
  book: 'Book',
  game: 'Game',
}

/**
 * Currently active media in the UI. Extend this list as catalogs come online
 * in Phase 2 (books and games pending).
 */
export const ACTIVE_MEDIA: Medium[] = ['film', 'tv', 'book']

export function isValidMedium(value: string | undefined): value is Medium {
  return value === 'film' || value === 'tv' || value === 'book' || value === 'game'
}