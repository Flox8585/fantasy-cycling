'use client'

import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '../../lib/supabase-browser'

export default function LogoutButton() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={logout}
      className="rounded-md bg-white text-black px-3 py-2 font-semibold"
    >
      Se déconnecter
    </button>
  )
}