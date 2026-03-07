import { createSupabaseServerClient } from '@/lib/supabase-server'

export default async function MePage() {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Session debug</h1>
      <pre className="mt-6 text-sm whitespace-pre-wrap">
        {JSON.stringify(user, null, 2)}
      </pre>
    </main>
  )
}
