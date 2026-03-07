import Link from 'next/link'
import { createSupabaseServerClient } from '../../../lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PointsRules = 'final_top3' | 'final_top5' | 'gc_top5' | 'gc_top10'

function pointsForPick(opts: {
  questionType: PointsRules
  actualPos: number | null
  predictedPos: number
}) {
  const { questionType, actualPos, predictedPos } = opts
  if (!actualPos) return 0
  const exact = actualPos === predictedPos

  if (questionType === 'final_top3') {
    if (actualPos === 1 && predictedPos === 1) return 3
    if (actualPos === 2 && predictedPos === 2) return 2
    if (actualPos === 3 && predictedPos === 3) return 1
    if (actualPos <= 3) return 1
    return 0
  }

  if (questionType === 'final_top5' || questionType === 'gc_top5') {
    if (actualPos === 1) return 5 + (exact ? 1 : 0)
    if (actualPos <= 3) return 3 + (exact ? 1 : 0)
    if (actualPos <= 5) return 1 + (exact ? 1 : 0)
    return 0
  }

  if (questionType === 'gc_top10') {
    if (actualPos === 1) return 10 + (exact ? 1 : 0)
    if (actualPos <= 3) return 5 + (exact ? 1 : 0)
    if (actualPos <= 5) return 3 + (exact ? 1 : 0)
    if (actualPos <= 10) return 1 + (exact ? 1 : 0)
    return 0
  }

  return 0
}

export default async function RaceRankingPage(props: any) {
  const supabase = await createSupabaseServerClient()
  const params = await Promise.resolve(props.params)
  const raceId = params?.raceId as string | undefined

  if (!raceId) {
    return (
      <main className="p-10">
        <p className="text-red-400">raceId manquant.</p>
      </main>
    )
  }

  const { data: race } = await supabase
    .from('races')
    .select('id, name, pcs_year, pcs_url')
    .eq('id', raceId)
    .single()

  // Question principale (course) : active + la plus récente si multiple
  const { data: questions } = await supabase
    .from('prediction_questions')
    .select('id, race_id, stage_id, type, label, slots, is_active, created_at')
    .eq('race_id', raceId)
    .is('stage_id', null)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)

  const q = questions?.[0] as any
  if (!q?.id) {
    return (
      <main className="p-10 max-w-4xl">
        <Link className="opacity-70 underline" href="/ranking">
          ← Retour classement
        </Link>
        <h1 className="text-3xl font-bold mt-4">{race?.name ?? 'Course'}</h1>
        <p className="mt-4 opacity-70">
          Aucune question principale active pour cette course.
        </p>
      </main>
    )
  }

  // Résultats (peuvent être partiels si course pas finie)
  const { data: results } = await supabase
    .from('results')
    .select('rider_id, position, riders ( id, name, team )')
    .eq('race_id', raceId)
    .order('position', { ascending: true })
    .limit(50)

  const actualPosByRider = new Map<string, number>()
  for (const r of results ?? []) {
    const rr = r as any
    if (rr?.rider_id && rr?.position) actualPosByRider.set(rr.rider_id, rr.position)
  }

  // Pronos de tous (entries) pour cette question
  const { data: entries } = await supabase
    .from('prediction_entries')
    .select('question_id, user_id, rider_id, position, riders ( id, name, team )')
    .eq('question_id', q.id)
    .order('user_id', { ascending: true })
    .order('position', { ascending: true })

  // Pseudos
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')

  const usernameByUser = new Map<string, string>()
  for (const p of profiles ?? []) {
    if ((p as any).id && (p as any).username) {
      usernameByUser.set((p as any).id, (p as any).username)
    }
  }

  // Group entries by user
  type PickRow = {
    riderId: string
    riderName: string
    team: string | null
    predictedPos: number
    actualPos: number | null
    points: number
  }

  const picksByUser = new Map<string, PickRow[]>()

  for (const e of entries ?? []) {
    const ee = e as any
    const rider = ee.riders
    if (!ee.user_id || !ee.rider_id || !ee.position || !rider?.name) continue

    const actualPos = actualPosByRider.get(ee.rider_id) ?? null
    const points = pointsForPick({
      questionType: q.type as PointsRules,
      actualPos,
      predictedPos: ee.position,
    })

    const row: PickRow = {
      riderId: ee.rider_id,
      riderName: rider.name,
      team: rider.team ?? null,
      predictedPos: ee.position,
      actualPos,
      points,
    }

    if (!picksByUser.has(ee.user_id)) picksByUser.set(ee.user_id, [])
    picksByUser.get(ee.user_id)!.push(row)
  }

  // Build scoreboard per user
  const users = Array.from(picksByUser.entries()).map(([userId, picks]) => {
    const total = picks.reduce((s, p) => s + p.points, 0)
    return {
      userId,
      username: usernameByUser.get(userId) ?? userId.slice(0, 8),
      total,
      picks,
    }
  })

  users.sort((a, b) => b.total - a.total)

  const hasResults = (results?.length ?? 0) > 0

  return (
    <main className="p-10 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <Link className="opacity-70 underline" href="/ranking">
          ← Retour classement
        </Link>
        {race?.pcs_url ? (
          <a className="opacity-70 underline" href={race.pcs_url} target="_blank" rel="noreferrer">
            Voir PCS
          </a>
        ) : null}
      </div>

      <h1 className="text-3xl font-bold mt-4">
        {race?.name ?? 'Course'} {race?.pcs_year ? `(${race.pcs_year})` : ''}
      </h1>
      <p className="opacity-70 mt-1">
        Question: <span className="font-medium opacity-100">{q.label}</span> — type: {q.type}
      </p>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Résultat */}
        <section className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold">Résultat (actuel)</h2>
          {!hasResults ? (
            <p className="mt-3 opacity-70">
              Aucun résultat importé pour l’instant (ou course pas encore importée).
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {(results ?? []).slice(0, 20).map((r: any) => (
                <div key={r.rider_id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-7 text-center font-semibold opacity-70">#{r.position}</div>
                    <div>
                      <div className="font-medium">{r.riders?.name ?? '—'}</div>
                      {r.riders?.team ? (
                        <div className="opacity-60">{r.riders.team}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-xs opacity-60 mt-3">
                (Si la course n’est pas terminée, ce classement peut être incomplet → points partiels.)
              </p>
            </div>
          )}
        </section>

        {/* Score course */}
        <section className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold">Classement sur la course</h2>

          {users.length === 0 ? (
            <p className="mt-3 opacity-70">Aucun prono pour cette course.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {users.map((u, idx) => (
                <div key={u.userId} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-7 text-center font-semibold opacity-70">#{idx + 1}</div>
                    <div className="font-medium">{u.username}</div>
                  </div>
                  <div className="font-bold">{u.total} pts</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Détail pronos */}
      <div className="mt-10">
        <h2 className="text-xl font-semibold">Pronostics & points (détail)</h2>
        <p className="text-sm opacity-70 mt-1">
          Tu peux comparer la position prévue, la position réelle (si dispo) et les points gagnés.
        </p>

        <div className="mt-4 space-y-3">
          {users.map((u) => (
            <details key={u.userId} className="border rounded-lg p-3" open={users.length <= 2}>
              <summary className="cursor-pointer font-semibold">
                {u.username} — <span className="opacity-80">{u.total} pts</span>
              </summary>

              {u.picks.length === 0 ? (
                <p className="mt-3 opacity-70">Aucun pick.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="opacity-70">
                      <tr>
                        <th className="text-left py-2 pr-3">Prono</th>
                        <th className="text-left py-2 pr-3">Coureur</th>
                        <th className="text-left py-2 pr-3">Réel</th>
                        <th className="text-right py-2">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {u.picks
                        .sort((a, b) => a.predictedPos - b.predictedPos)
                        .map((p) => (
                          <tr key={`${u.userId}:${p.riderId}`} className="border-t border-white/10">
                            <td className="py-2 pr-3 font-semibold">#{p.predictedPos}</td>
                            <td className="py-2 pr-3">
                              <div className="font-medium">{p.riderName}</div>
                              {p.team ? <div className="opacity-60">{p.team}</div> : null}
                            </td>
                            <td className="py-2 pr-3">
                              {p.actualPos ? (
                                <span className="font-semibold">#{p.actualPos}</span>
                              ) : (
                                <span className="opacity-60">—</span>
                              )}
                            </td>
                            <td className="py-2 text-right font-bold">{p.points}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>

                  <p className="text-xs opacity-60 mt-3">
                    “Réel —” = pas encore dans les résultats importés → 0 point pour l’instant.
                  </p>
                </div>
              )}
            </details>
          ))}
        </div>
      </div>
    </main>
  )
}