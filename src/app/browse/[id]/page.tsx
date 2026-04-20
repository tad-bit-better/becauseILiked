import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { AddLoveForm } from './add-love-form';

export default async function MovieDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: item, error } = await supabase
    .from('items')
    .select(
      'id, medium, title, year, synopsis, themes, tone, creators, poster_url',
    )
    .eq('id', id)
    .single();

  if (error || !item) {
    notFound();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check if this user already loved this item (prevents duplicate entries)
  let existingLoveId: string | null = null;
  if (user) {
    const { data: existing } = await supabase
      .from('user_loves')
      .select('id')
      .eq('user_id', user.id)
      .eq('item_id', item.id)
      .maybeSingle();
    existingLoveId = existing?.id ?? null;
  }

  const directors = (item.creators as Array<{ role: string; name: string }>)
    .filter((c) => c.role === 'director')
    .map((c) => c.name);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href="/browse"
            className="text-sm text-indigo-600 hover:underline"
          >
            ← Back to browse
          </Link>
          <Link href="/" className="text-xl font-bold">
            BecauseILiked
          </Link>
          <nav className="flex gap-2">
            {user ? (
              <Link
                href="/my/loves"
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                My Loves
              </Link>
            ) : (
              <Link
                href="/sign-in"
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid md:grid-cols-[240px_1fr] gap-8">
          {/* Poster */}
          <div className="aspect-[2/3] bg-gray-200 relative rounded-lg overflow-hidden shadow">
            {item.poster_url ? (
              <Image
                src={item.poster_url}
                alt={item.title}
                fill
                sizes="240px"
                className="object-cover"
                priority
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 p-4 text-center">
                {item.title}
              </div>
            )}
          </div>

          {/* Details */}
          <div>
            <h1 className="text-3xl font-bold">{item.title}</h1>
            <p className="mt-1 text-gray-600">
              {item.year ?? 'Unknown year'}
              {directors.length > 0 && ` · Directed by ${directors.join(', ')}`}
            </p>

            {item.themes.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {item.themes.map((theme: string) => (
                  <span
                    key={theme}
                    className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-full"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            )}

            {item.synopsis && (
              <p className="mt-6 text-gray-800 leading-relaxed">
                {item.synopsis}
              </p>
            )}

            <div className="mt-8 border-t pt-8">
              <AddLoveForm
                itemId={item.id}
                itemTitle={item.title}
                isSignedIn={!!user}
                existingLoveId={existingLoveId}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
