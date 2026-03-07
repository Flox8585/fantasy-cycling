'use client'

import { useState, useTransition } from 'react'

export default function AdminLockControls(props: {
  questionId: string
  initialLocked: boolean
  initialLockAt: string | null
}) {
  const [locked, setLocked] = useState(props.initialLocked)
  const [lockAt, setLockAt] = useState(
    props.initialLockAt
      ? new Date(props.initialLockAt).toISOString().slice(0, 16)
      : ''
  )
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()

  async function save(values: { locked?: boolean; lockAt?: string | null }) {
    setMessage('')

    startTransition(async () => {
      const body: any = { questionId: props.questionId }

      if (typeof values.locked === 'boolean') body.locked = values.locked
      if ('lockAt' in values) body.lockAt = values.lockAt

      const res = await fetch('/api/admin/question-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setMessage(`Erreur: ${json?.error ?? res.status}`)
        return
      }

      if (typeof values.locked === 'boolean') setLocked(values.locked)
      if ('lockAt' in values) setLockAt(values.lockAt ? values.lockAt.slice(0, 16) : '')

      setMessage('Sauvegardé ✅')
    })
  }

  function lockNow() {
    save({ locked: true })
  }

  function unlock() {
    save({ locked: false })
  }

  function saveTime() {
    if (!lockAt) {
      save({ lockAt: null })
      return
    }

    const iso = new Date(lockAt).toISOString()
    save({ lockAt: iso })
  }

  function clearTime() {
    save({ lockAt: null })
  }

  return (
    <div className="mt-6 border rounded-lg p-4">
      <h3 className="font-semibold text-lg">Admin — verrouillage</h3>

      <div className="mt-3 text-sm opacity-80">
        État manuel :{' '}
        <span className={locked ? 'text-red-300 font-semibold' : 'text-green-300 font-semibold'}>
          {locked ? 'verrouillé' : 'ouvert'}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={lockNow}
          disabled={isPending}
          className="rounded-md bg-white text-black px-4 py-2 font-semibold disabled:opacity-50"
        >
          Verrouiller maintenant
        </button>

        <button
          type="button"
          onClick={unlock}
          disabled={isPending}
          className="rounded-md border border-white/30 px-4 py-2 font-semibold disabled:opacity-50"
        >
          Déverrouiller
        </button>
      </div>

      <div className="mt-5">
        <label className="block text-sm mb-2">Heure de départ / verrouillage auto</label>

        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="datetime-local"
            value={lockAt}
            onChange={(e) => setLockAt(e.target.value)}
            className="rounded-md border px-3 py-2 text-black"
          />

          <button
            type="button"
            onClick={saveTime}
            disabled={isPending}
            className="rounded-md bg-white text-black px-4 py-2 font-semibold disabled:opacity-50"
          >
            Enregistrer l’heure
          </button>

          <button
            type="button"
            onClick={clearTime}
            disabled={isPending}
            className="rounded-md border border-white/30 px-4 py-2 font-semibold disabled:opacity-50"
          >
            Effacer l’heure
          </button>
        </div>

        <p className="mt-2 text-xs opacity-60">
          Si une heure est définie, les pronos se ferment automatiquement après cette heure.
        </p>
      </div>

      {message ? <p className="mt-4 text-sm">{message}</p> : null}
    </div>
  )
}