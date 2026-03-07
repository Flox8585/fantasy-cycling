'use client'

import { useMemo, useState, useTransition } from 'react'
import { createSupabaseBrowserClient } from '../../../lib/supabase-browser'

type Rider = { id: string; name: string; team: string }
type TeamGroup = { team: string; logoUrl?: string | null; riders: Rider[] }
type Entry = {
  rider_id: string
  position: number
  riders?: { id: string; name: string; team: string } | null
}

export default function StartlistPicker(props: {
  questionId: string
  slots: number
  teams: TeamGroup[]
  initialEntries: Entry[]
  locked: boolean
}) {
  const supabase = createSupabaseBrowserClient()
  const [isPending, startTransition] = useTransition()

  const [entries, setEntries] = useState<Entry[]>(
    [...(props.initialEntries ?? [])].sort((a, b) => a.position - b.position)
  )

  const pickedIds = useMemo(() => new Set(entries.map((e) => e.rider_id)), [entries])
  const pickedCount = entries.length

  async function refreshFromDb() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from('prediction_entries')
      .select('rider_id, position, riders ( id, name, team )')
      .eq('question_id', props.questionId)
      .eq('user_id', user.id)
      .order('position')

    setEntries((data ?? []) as any)
  }

  async function persistPositionsSafe(next: Entry[]) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const ordered = [...next].sort((a, b) => a.position - b.position)
    ordered.forEach((e, idx) => (e.position = idx + 1))

    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i]
      const tmpPos = 1000 + (i + 1)
      const { error } = await supabase
        .from('prediction_entries')
        .update({ position: tmpPos })
        .eq('question_id', props.questionId)
        .eq('user_id', user.id)
        .eq('rider_id', e.rider_id)
      if (error) throw new Error(error.message)
    }

    for (const e of ordered) {
      const { error } = await supabase
        .from('prediction_entries')
        .update({ position: e.position })
        .eq('question_id', props.questionId)
        .eq('user_id', user.id)
        .eq('rider_id', e.rider_id)
      if (error) throw new Error(error.message)
    }
  }

  async function togglePick(r: Rider) {
    if (props.locked) return

    const isPicked = pickedIds.has(r.id)

    let nextEntries: Entry[]
    if (isPicked) {
      nextEntries = entries.filter((e) => e.rider_id !== r.id)
    } else {
      if (pickedCount >= props.slots) return
      nextEntries = [...entries, { rider_id: r.id, position: pickedCount + 1, riders: r }]
    }

    nextEntries = [...nextEntries]
      .sort((a, b) => a.position - b.position)
      .map((e, idx) => ({ ...e, position: idx + 1 }))

    setEntries(nextEntries)

    startTransition(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      if (isPicked) {
        const { error } = await supabase
          .from('prediction_entries')
          .delete()
          .eq('question_id', props.questionId)
          .eq('user_id', user.id)
          .eq('rider_id', r.id)
        if (error) throw new Error(error.message)

        await persistPositionsSafe(nextEntries)
      } else {
        const { error } = await supabase.from('prediction_entries').insert({
          question_id: props.questionId,
          user_id: user.id,
          rider_id: r.id,
          position: nextEntries.length,
        })
        if (error) throw new Error(error.message)
      }

      await refreshFromDb()
    })
  }

  function move(index: number, dir: -1 | 1) {
    if (props.locked) return

    const ordered = [...entries].sort((a, b) => a.position - b.position)
    const j = index + dir
    if (j < 0 || j >= ordered.length) return

    const next = [...ordered]
    const tmp = next[index]
    next[index] = next[j]
    next[j] = tmp

    const normalized = next.map((e, idx) => ({ ...e, position: idx + 1 }))
    setEntries(normalized)

    startTransition(async () => {
      try {
        await persistPositionsSafe(normalized)
        await refreshFromDb()
      } catch {
        await refreshFromDb()
      }
    })
  }

  return (
    <div>
      {props.locked && (
        <div className="mb-3 text-sm text-red-300 font-semibold">
          🔒 Pronostics verrouillés (départ effectué)
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm opacity-80">
          Sélection : <span className="font-semibold">{pickedCount}</span> / {props.slots}
        </div>
        {isPending && <div className="text-xs opacity-70">Enregistrement…</div>}
      </div>

      <div className="mb-6 border rounded-lg p-3">
        <div className="font-semibold mb-2">Tes picks (ordre)</div>

        {entries.length === 0 ? (
          <div className="text-sm opacity-70">Clique des coureurs dans la startlist.</div>
        ) : (
          <div className="space-y-2">
            {entries
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((e, idx) => (
                <div key={e.rider_id} className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <span className="opacity-70 mr-2">#{idx + 1}</span>
                    <span className="font-medium">{e.riders?.name ?? e.rider_id}</span>
                    {e.riders?.team ? <span className="opacity-60"> — {e.riders.team}</span> : null}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => move(idx, -1)}
                      className="border rounded px-2 py-1 text-sm hover:bg-zinc-800 disabled:opacity-40"
                      disabled={props.locked || idx === 0 || isPending}
                      title="Monter"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(idx, 1)}
                      className="border rounded px-2 py-1 text-sm hover:bg-zinc-800 disabled:opacity-40"
                      disabled={props.locked || idx === entries.length - 1 || isPending}
                      title="Descendre"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {props.teams.map(({ team, riders, logoUrl }) => (
          <details key={team} className="border rounded-lg p-3">
            <summary className="cursor-pointer font-medium flex items-center gap-2">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={team}
                  className="w-4 h-4 object-contain"
                />
              ) : (
                <span className="w-4 h-4 inline-block rounded bg-zinc-800" />
              )}
              <span>
                {team} <span className="opacity-70">({riders.length})</span>
              </span>
            </summary>

            <div className="mt-3 columns-2 md:columns-3 lg:columns-4 gap-6">
              {riders.map((r) => {
                const on = pickedIds.has(r.id)
                const disabled = props.locked || (!on && pickedCount >= props.slots)

                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => togglePick(r)}
                    disabled={disabled || isPending}
                    className={
                      'break-inside-avoid py-1 text-sm text-left w-full rounded px-2 ' +
                      (on ? 'bg-white text-black font-semibold' : 'hover:bg-zinc-800') +
                      (disabled ? ' opacity-40' : '')
                    }
                    title={props.locked ? 'Verrouillé' : (on ? 'Cliquer pour retirer' : 'Cliquer pour sélectionner')}
                  >
                    {r.name}
                  </button>
                )
              })}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}