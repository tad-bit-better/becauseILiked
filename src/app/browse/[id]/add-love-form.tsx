'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { saveLove } from './actions';

const MAX_CHARS = 2000;
const MIN_CHARS = 30;

interface Props {
  itemId: string;
  itemTitle: string;
  isSignedIn: boolean;
  existingLoveId: string | null;
}

export function AddLoveForm({
  itemId,
  itemTitle,
  isSignedIn,
  existingLoveId,
}: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isSignedIn) {
    return (
      <div className="bg-white border rounded-lg p-6">
        <h2 className="font-semibold mb-2">
          Want to add this to your taste profile?
        </h2>
        <p className="text-gray-600 text-sm mb-4">
          Sign in to tell us what you loved about {itemTitle}. The more specific
          you are, the better the recommendations we'll give you.
        </p>
        <Link
          href={`/sign-in?next=/browse/${itemId}`}
          className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition"
        >
          Sign in to add a Love
        </Link>
      </div>
    );
  }

  if (existingLoveId) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <h2 className="font-semibold text-green-900 mb-2">
          You've already added this one
        </h2>
        <p className="text-green-800 text-sm mb-4">
          You told us why you loved {itemTitle}. You can edit your reasons
          anytime.
        </p>
        <Link
          href="/my/loves"
          className="inline-block px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition"
        >
          See all my Loves
        </Link>
      </div>
    );
  }

  const charsLeft = MAX_CHARS - text.length;
  const charsShort = MIN_CHARS - text.length;
  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveLove(formData);
        if (result?.error) {
          setError(result.error);
        }
        // On success the server redirects; no need to reset state
      } catch (err) {
        setError((err as Error).message || 'Something went wrong');
      }
    });
  }

  return (
    <form action={handleSubmit} className="bg-white border rounded-lg p-6">
      <h2 className="font-semibold mb-1">Why did you love {itemTitle}?</h2>
      <p className="text-sm text-gray-600 mb-4">
        The specific reasons — a mood, a theme, a scene, a feeling. This is what
        we use to find more like it.
      </p>

      <input type="hidden" name="item_id" value={itemId} />

      <textarea
        name="free_text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_CHARS}
        rows={6}
        placeholder="I loved the slow-burn atmosphere and the way the desert became almost a character itself. The moral decay felt earned, not forced..."
        className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
      />

      <div className="mt-2 flex items-center justify-between text-xs">
        <span
          className={
            charsShort > 0
              ? 'text-amber-600'
              : charsLeft < 100
                ? 'text-amber-600'
                : 'text-gray-500'
          }
        >
          {charsShort > 0
            ? `${charsShort} more character${charsShort === 1 ? '' : 's'} required`
            : `${text.length} / ${MAX_CHARS}`}
        </span>
        {error && <span className="text-red-600">{error}</span>}
      </div>

      <button
        type="submit"
        disabled={isPending || text.trim().length < MIN_CHARS}
        className="mt-4 px-5 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? 'Saving…' : 'Save Love'}
      </button>
    </form>
  );
}
