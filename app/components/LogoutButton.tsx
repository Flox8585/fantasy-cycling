'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function LogoutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  )

  async function handleLogout() {
    setLoading(true)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
    >
      {loading ? 'Déconnexion...' : 'Déconnexion'}
    </button>
  )
}
