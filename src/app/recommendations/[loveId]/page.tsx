import Link from 'next/link';
import Image from 'next/image';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getRecommendations } from '@/lib/recommender';

export default async function RecommendationsPage({
  params,
}: {
  params: Promise<{ loveId: string }>;
}) {
  const { loveId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?next=/recommendations/${loveId}`);
  }

  // Fetch the love + its item. RLS ensures we only get rows for THIS user —
  // trying to access someone else's loveId just returns null.
  const { data: love, error } = await supabase
    .from('user_loves')
    .select(
      `
      id,
      free_text,
      item_id,
      items ( id, title, year, poster_url, medium )
    `,
    )
    .eq('id', loveId)
    .maybeSingle();

  if (error || !love) {
    notFound();
  }

  const item = love.items as unknown as {
    id: string;
    title: string;
    year: number | null;
    poster_url: string | null;
    medium: 'film' | 'tv' | 'book' | 'game';
  } | null;

  if (!item) {
    // The item was deleted or the love is freeform. Phase 1 can't handle freeform.
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-3xl mx-auto bg-white border rounded-lg p-8 text-center">
          <p className="text-gray-700">
            We can't generate recommendations for this entry yet. Try one linked
            to a movie in our catalog.
          </p>
          <Link
            href="/my/loves"
            className="inline-block mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            Back to My Loves
          </Link>
        </div>
      </div>
    );
  }

  // Call the recommender. This is the one line that will change in Phase 3/4.
  const recommendations = await getRecommendations(supabase, {
    userId: user.id,
    loveId: love.id,
    itemId: love.item_id,
    freeText: love.free_text,
    medium: item.medium,
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href="/my/loves"
            className="text-sm text-indigo-600 hover:underline"
          >
            ← Back to My Loves
          </Link>
          <Link href="/" className="text-xl font-bold">
            BecauseILiked
          </Link>
          <div />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Source context */}
        <div className="bg-white border rounded-lg p-6 mb-8 flex gap-4">
          <div className="w-20 h-28 bg-gray-200 rounded overflow-hidden shrink-0 relative">
            {item.poster_url && (
              <Image
                src={item.poster_url}
                alt={item.title}
                fill
                sizes="80px"
                className="object-cover"
              />
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm text-gray-500 uppercase tracking-wide">
              Because you loved
            </p>
            <h1 className="text-xl font-bold mt-1">
              {item.title}
              {item.year && (
                <span className="text-gray-500 font-normal">
                  {' '}
                  · {item.year}
                </span>
              )}
            </h1>
            <p className="mt-2 text-sm text-gray-700 line-clamp-3">
              {love.free_text}
            </p>
          </div>
        </div>

        {/* Recommendations */}
        <h2 className="text-2xl font-semibold mb-4">You might also like</h2>

        {recommendations.length === 0 ? (
          <div className="bg-white border rounded-lg p-8 text-center text-gray-600">
            We couldn't find good matches yet. Try adding a few more Loves and
            we'll get better at this.
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recommendations.map((rec) => (
              <li
                key={rec.itemId}
                className="bg-white border rounded-lg overflow-hidden flex"
              >
                <Link
                  href={`/browse/${rec.itemId}`}
                  className="w-24 h-36 bg-gray-200 relative shrink-0 block"
                >
                  {rec.posterUrl && (
                    <Image
                      src={rec.posterUrl}
                      alt={rec.title}
                      fill
                      sizes="96px"
                      className="object-cover"
                    />
                  )}
                </Link>
                <div className="p-4 flex-1 min-w-0">
                  <Link
                    href={`/browse/${rec.itemId}`}
                    className="font-semibold hover:underline"
                  >
                    {rec.title}
                    {rec.year && (
                      <span className="text-gray-500 font-normal">
                        {' '}
                        · {rec.year}
                      </span>
                    )}
                  </Link>
                  <p className="mt-2 text-sm text-gray-600">
                    {rec.explanation}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400">
            Recommendations powered by a placeholder. Real AI-driven matching is
            coming in the next few updates.
          </p>
        </div>
      </main>
    </div>
  );
}
