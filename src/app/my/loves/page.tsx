import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

interface SearchParams {
  added?: string;
}

export default async function MyLovesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=/my/loves');
  }

  // Fetch loves with their associated items (Supabase foreign-key join syntax)
  const { data: loves, error } = await supabase
    .from('user_loves')
    .select(
      `
      id,
      free_text,
      created_at,
      items ( id, title, year, poster_url )
    `,
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return <p className="p-8 text-red-600">Failed to load: {error.message}</p>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">
            BecauseILiked
          </Link>
          <nav className="flex gap-2">
            <Link
              href="/browse"
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Browse
            </Link>
            <Link
              href="/dashboard"
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">My Loves</h1>
        <p className="text-gray-600 mb-6">The films you've loved, and why.</p>

        {params.added && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-900 px-4 py-3 rounded-md text-sm">
            Saved! Keep adding more — the more specific you get, the better we
            can learn your taste.
          </div>
        )}

        {!loves || loves.length === 0 ? (
          <div className="bg-white border rounded-lg p-8 text-center">
            <p className="text-gray-600 mb-4">
              You haven't added anything yet.
            </p>
            <Link
              href="/browse"
              className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              Browse movies to add
            </Link>
          </div>
        ) : (
          <ul className="space-y-4">
            {loves.map((love) => {
              const item = love.items as unknown as {
                id: string;
                title: string;
                year: number | null;
                poster_url: string | null;
              } | null;
              return (
                <li
                  key={love.id}
                  className="bg-white border rounded-lg p-4 flex gap-4"
                >
                  <div className="w-20 h-28 bg-gray-200 rounded overflow-hidden shrink-0 relative">
                    {item?.poster_url ? (
                      <Image
                        src={item.poster_url}
                        alt={item.title}
                        fill
                        sizes="80px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    {item ? (
                      <Link
                        href={`/browse/${item.id}`}
                        className="font-semibold hover:underline"
                      >
                        {item.title}
                        {item.year && (
                          <span className="text-gray-500 font-normal">
                            {' '}
                            · {item.year}
                          </span>
                        )}
                      </Link>
                    ) : (
                      <p className="font-semibold text-gray-500">
                        (deleted item)
                      </p>
                    )}
                    <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                      {love.free_text}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-xs text-gray-400">
                        {new Date(love.created_at).toLocaleDateString(
                          undefined,
                          {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          },
                        )}
                      </p>
                      <Link
                        href={`/recommendations/${love.id}`}
                        className="text-xs font-medium px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition"
                      >
                        Find similar →
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
