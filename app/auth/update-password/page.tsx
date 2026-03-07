'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function UpdatePasswordPage() {
  const router = useRouter()

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  )

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage('')

    if (password.length < 6) {
      setMessage('Le mot de passe doit faire au moins 6 caractères.')
      return
    }

    if (password !== confirmPassword) {
      setMessage('Les mots de passe ne correspondent pas.')
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      })

      if (error) {
        setMessage(`Erreur: ${error.message}`)
        return
      }

      setMessage('Mot de passe enregistré ✅ Redirection...')
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1200)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="p-10 max-w-xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">Définir un mot de passe</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          placeholder="Nouveau mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border px-4 py-3 text-black"
          required
          minLength={6}
        />

        <input
          type="password"
          placeholder="Confirmer le mot de passe"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-md border px-4 py-3 text-black"
          required
          minLength={6}
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-white text-black px-4 py-3 font-semibold disabled:opacity-50"
        >
          {loading ? 'Enregistrement...' : 'Enregistrer le mot de passe'}
        </button>
      </form>

      {message ? <p className="mt-6 text-sm">{message}</p> : null}
    </main>
  )
}
