import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-5xl font-bold">BecauseILiked</h1>
        <p className="text-xl text-gray-600">
          Tell us what you loved, and why. We&apos;ll find you more of it.
        </p>
        <div className="flex gap-4 justify-center">
          {user ? (
            <Link
              href="/dashboard"
              className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition"
            >
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-up"
                className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition"
              >
                Get started
              </Link>
              <Link
                href="/sign-in"
                className="px-6 py-3 bg-white text-gray-800 border border-gray-300 rounded-md hover:bg-gray-50 transition"
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
