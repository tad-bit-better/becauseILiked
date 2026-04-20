import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '../(auth)/actions';
import Link from 'next/link';

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in');
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <form action={signOut}>
            <button
              type="submit"
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition"
            >
              Sign out
            </button>
          </form>
        </div>

        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <p className="text-sm text-gray-600">
            Signed in as <strong>{user.email}</strong>
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Link
            href="/browse"
            className="bg-white p-6 rounded-lg shadow hover:shadow-md transition block"
          >
            <h2 className="font-semibold text-lg">Browse movies</h2>
            <p className="text-sm text-gray-600 mt-1">
              Find something to love. Click into anything to tell us why.
            </p>
          </Link>
          <Link
            href="/my/loves"
            className="bg-white p-6 rounded-lg shadow hover:shadow-md transition block"
          >
            <h2 className="font-semibold text-lg">My Loves</h2>
            <p className="text-sm text-gray-600 mt-1">
              The things you've added — and your shortcut to recommendations.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
