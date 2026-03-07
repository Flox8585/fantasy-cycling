'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

type Mode = 'login' | 'signup' | 'reset'

export default function LoginPage() {
  const router = useRouter()

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  )

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) {
          setMessage(`Erreur: ${error.message}`)
          return
        }

        router.push('/dashboard')
        router.refresh()
        return
      }

      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        })

        if (error) {
          setMessage(`Erreur: ${error.message}`)
          return
        }

        setMessage(
          'Compte créé ✅ Si Supabase demande une confirmation email, va dans ta boîte mail puis reconnecte-toi.'
        )
        setMode('login')
        return
      }

      if (mode === 'reset') {
        const redirectTo =
          typeof window !== 'undefined'
            ? `${window.location.origin}/auth/update-password`
            : undefined

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        })

        if (error) {
          setMessage(`Erreur: ${error.message}`)
          return
        }

        setMessage(
          'Email envoyé ✅ Ouvre le lien reçu puis choisis ton nouveau mot de passe.'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="p-10 max-w-xl mx-auto">
      <h1 className="text-5xl font-bold mb-10">Connexion</h1>

      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          type="button"
          onClick={() => {
            setMode('login')
            setMessage('')
          }}
          className={`px-4 py-2 rounded-md border ${
            mode === 'login' ? 'bg-white text-black font-semibold' : 'border-white/20'
          }`}
        >
          Se connecter
        </button>

        <button
          type="button"
          onClick={() => {
            setMode('signup')
            setMessage('')
          }}
          className={`px-4 py-2 rounded-md border ${
            mode === 'signup' ? 'bg-white text-black font-semibold' : 'border-white/20'
          }`}
        >
          Créer un compte
        </button>

        <button
          type="button"
          onClick={() => {
            setMode('reset')
            setMessage('')
          }}
          className={`px-4 py-2 rounded-md border ${
            mode === 'reset' ? 'bg-white text-black font-semibold' : 'border-white/20'
          }`}
        >
          Mot de passe oublié
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          placeholder="email@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border px-4 py-3 text-black"
          required
        />

        {mode !== 'reset' && (
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border px-4 py-3 text-black"
            required
            minLength={6}
          />
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-white text-black px-4 py-3 font-semibold disabled:opacity-50"
        >
          {loading
            ? 'Chargement...'
            : mode === 'login'
            ? 'Se connecter'
            : mode === 'signup'
            ? 'Créer le compte'
            : 'Recevoir le lien'}
        </button>
      </form>

      <div className="mt-6 text-sm opacity-80 space-y-2">
        {mode === 'login' && <p>Connecte-toi avec ton email et ton mot de passe.</p>}
        {mode === 'signup' && (
          <p>Crée un compte avec email + mot de passe. Plus besoin de magic link ensuite.</p>
        )}
        {mode === 'reset' && (
          <p>
            Pour les anciens comptes créés avec magic link, utilise ce bouton une seule fois pour
            définir un mot de passe.
          </p>
        )}
      </div>

      {message ? <p className="mt-6 text-sm">{message}</p> : null}
    </main>
  )
}
