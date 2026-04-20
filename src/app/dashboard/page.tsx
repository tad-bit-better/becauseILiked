import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '../(auth)/actions';

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
        <div className="bg-white p-6 rounded-lg shadow">
          <p>
            Signed in as <strong>{user.email}</strong>
          </p>
          <p className="text-sm text-gray-600 mt-2">
            User ID: <code className="text-xs">{user.id}</code>
          </p>
        </div>
      </div>
    </div>
  );
}
