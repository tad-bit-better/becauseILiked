import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/server';

const PAGE_SIZE = 24;

interface SearchParams {
  page?: string;
  q?: string;
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const query = params.q?.trim() ?? '';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Build the query. We paginate with .range() — Supabase is 0-indexed inclusive.
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = supabase
    .from('items')
    .select('id, title, year, poster_url, themes', { count: 'exact' })
    .eq('medium', 'film')
    .order('year', { ascending: false, nullsFirst: false })
    .range(from, to);

  if (query) {
    q = q.ilike('title', `%${query}%`);
  }

  const { data: items, count, error } = await q;

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-600">Failed to load items: {error.message}</p>
      </div>
    );
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="text-2xl font-bold">
            BecauseILiked
          </Link>
          <form action="/browse" className="flex-1 max-w-md">
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search movies..."
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </form>
          <nav className="flex gap-2">
            {user ? (
              <>
                <Link
                  href="/my/loves"
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  My Loves
                </Link>
                <Link
                  href="/dashboard"
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Dashboard
                </Link>
              </>
            ) : (
              <Link
                href="/sign-in"
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">
            {query ? `Results for "${query}"` : 'Browse Movies'}
          </h1>
          <p className="text-sm text-gray-600">
            {count ?? 0} {count === 1 ? 'movie' : 'movies'}
          </p>
        </div>

        {items && items.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {items.map((item) => (
              <MovieCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="text-gray-600">No movies found.</p>
        )}

        {totalPages > 1 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            query={query}
          />
        )}
      </main>
    </div>
  );
}

function MovieCard({
  item,
}: {
  item: {
    id: string;
    title: string;
    year: number | null;
    poster_url: string | null;
    themes: string[];
  };
}) {
  return (
    <Link
      href={`/browse/${item.id}`}
      className="bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition block"
    >
      <div className="aspect-[2/3] bg-gray-200 relative">
        {item.poster_url ? (
          <Image
            src={item.poster_url}
            alt={item.title}
            fill
            sizes="(min-width: 1024px) 16vw, (min-width: 768px) 25vw, 50vw"
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm p-2 text-center">
            {item.title}
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-medium text-sm line-clamp-2">{item.title}</h3>
        <p className="text-xs text-gray-500 mt-1">
          {item.year ?? '—'}
          {item.themes.length > 0 && ` · ${item.themes.slice(0, 2).join(', ')}`}
        </p>
      </div>
    </Link>
  );
}

function Pagination({
  currentPage,
  totalPages,
  query,
}: {
  currentPage: number;
  totalPages: number;
  query: string;
}) {
  const qParam = query ? `&q=${encodeURIComponent(query)}` : '';
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;

  return (
    <nav className="mt-8 flex items-center justify-center gap-2">
      <Link
        href={prevDisabled ? '#' : `/browse?page=${currentPage - 1}${qParam}`}
        aria-disabled={prevDisabled}
        className={`px-4 py-2 border rounded-md ${
          prevDisabled
            ? 'text-gray-400 border-gray-200 pointer-events-none'
            : 'border-gray-300 hover:bg-gray-100'
        }`}
      >
        Previous
      </Link>
      <span className="text-sm text-gray-600">
        Page {currentPage} of {totalPages}
      </span>
      <Link
        href={nextDisabled ? '#' : `/browse?page=${currentPage + 1}${qParam}`}
        aria-disabled={nextDisabled}
        className={`px-4 py-2 border rounded-md ${
          nextDisabled
            ? 'text-gray-400 border-gray-200 pointer-events-none'
            : 'border-gray-300 hover:bg-gray-100'
        }`}
      >
        Next
      </Link>
    </nav>
  );
}
