'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '../../lib/supabase-browser'

export default function LoginPage() {
  const supabase = createSupabaseBrowserClient()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('')

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setStatus('Envoi du lien...')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })

    if (error) {
      setStatus(`Erreur: ${error.message}`)
      return
    }

    setStatus('Check tes emails : lien envoyé ✅')
  }

  return (
    <main className="p-10 max-w-md">
      <h1 className="text-3xl font-bold">Connexion</h1>

      <form className="mt-6 space-y-3" onSubmit={signIn}>
        <input
          className="w-full rounded-md border px-3 py-2 text-black"
          type="email"
          placeholder="ton@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button className="w-full rounded-md bg-white text-black px-3 py-2 font-semibold">
          Recevoir un lien
        </button>
      </form>

      {status && <p className="mt-4 text-sm">{status}</p>}
    </main>
  )
}