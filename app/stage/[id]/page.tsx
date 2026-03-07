import Link from 'next/link'
import { createSupabaseServerClient } from '../../../lib/supabase-server'
import StartlistPicker from '../../race/[id]/StartlistPicker'
import AdminLockControls from '../../race/[id]/AdminLockControls'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PointsRules = 'stage_top3' | 'final_top3' | 'final_top5' | 'gc_top5' | 'gc_top10'

function topSizeFromQuestionType(questionType: PointsRules) {
  if (questionType === 'stage_top3' || questionType === 'final_top3') return 3
  if (questionType === 'final_top5' || questionType === 'gc_top5') return 5
  if (questionType === 'gc_top10') return 10
  return 0
}

function pointsForPick(opts: {
  questionType: PointsRules
  actualPos: number | null
  predictedPos: number
}) {
  const { questionType, actualPos, predictedPos } = opts
  if (!actualPos) return 0

  const topSize = topSizeFromQuestionType(questionType)
  if (!topSize) return 0
  if (actualPos > topSize) return 0

  const basePoints = topSize - actualPos + 1
  const gap = Math.abs(predictedPos - actualPos)

  return Math.max(1, basePoints - gap)
}

export default async function StagePage(props: any) {
  const supabase = await createSupabaseServerClient()

  const params = await Promise.resolve(props.params)
  const stageId = params?.id as string | undefined

  if (!stageId) {
    return (
      <main className="p-10">
        <h1 className="text-3xl font-bold">Étape</h1>
        <p className="mt-4 text-red-400">Erreur: id étape manquant.</p>
      </main>
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admins = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  const isAdmin =
    !!user?.email &&
    (admins.length === 0 || admins.includes(user.email.toLowerCase()))

  const { data: stage } = await supabase
    .from('stages')
    .select('*')
    .eq('id', stageId)
    .single()

  if (!stage) {
    return (
      <main className="p-10">
        <h1 className="text-3xl font-bold">Étape</h1>
        <p className="mt-4 text-red-400">Étape introuvable.</p>
      </main>
    )
  }

  const raceId = stage.race_id

  const { data: race } = await supabase
    .from('races')
    .select('*')
    .eq('id', raceId)
    .single()

  const { data: question } = await supabase
    .from('prediction_questions')
    .select('*')
    .eq('stage_id', stageId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lockedByTime =
    question?.lock_at ? new Date(question.lock_at) <= new Date() : false

  const locked = !!question?.locked || lockedByTime

  const { data: rr } = await supabase
    .from('race_riders')
    .select('rider_id, riders ( id, name, team )')
    .eq('race_id', raceId)

  const byTeam = new Map<string, { id: string; name: string; team: string }[]>()

  for (const row of rr ?? []) {
    const r = (row as any).riders
    if (!r?.id || !r?.name) continue

    const team = r.team && String(r.team).trim() ? r.team : 'Équipe inconnue'

    if (!byTeam.has(team)) byTeam.set(team, [])
    byTeam.get(team)!.push({
      id: r.id,
      name: r.name,
      team,
    })
  }

  const teams = Array.from(byTeam.entries())
    .map(([team, riders]) => ({
      team,
      logoUrl: null,
      riders: riders.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.team.localeCompare(b.team))

  const riderCount = rr?.length ?? 0

  const { data: myEntries } =
    user && question?.id
      ? await supabase
          .from('prediction_entries')
          .select('rider_id, position, riders ( id, name, team )')
          .eq('question_id', question.id)
          .eq('user_id', user.id)
          .order('position')
      : { data: [] as any[] }

  const { data: results } = await supabase
    .from('results')
    .select('rider_id, position, riders ( id, name, team )')
    .eq('stage_id', stageId)
    .order('position', { ascending: true })
    .limit(50)

  const actualPosByRider = new Map<string, number>()
  for (const r of results ?? []) {
    const rr = r as any
    if (rr?.rider_id && rr?.position) actualPosByRider.set(rr.rider_id, rr.position)
  }

  const { data: entries } = question?.id
    ? await supabase
        .from('prediction_entries')
        .select('question_id, user_id, rider_id, position, riders ( id, name, team )')
        .eq('question_id', question.id)
        .order('user_id', { ascending: true })
        .order('position', { ascending: true })
    : { data: [] as any[] }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')

  const usernameByUser = new Map<string, string>()
  for (const p of profiles ?? []) {
    if ((p as any).id && (p as any).username) {
      usernameByUser.set((p as any).id, (p as any).username)
    }
  }

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
      questionType: (question?.type ?? 'stage_top3') as PointsRules,
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

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">
            {race?.name} — {stage.name}
          </h1>

          <div className="mt-2 text-sm opacity-80">
            {question ? (
              <>
                <span className="font-semibold">{question.label}</span>

                {question.lock_at && (
                  <span className="ml-2 opacity-70">
                    lock auto: {new Date(question.lock_at).toLocaleString('fr-FR')}
                  </span>
                )}

                {locked ? (
                  <span className="ml-3 text-red-300 font-semibold">🔒 Verrouillé</span>
                ) : (
                  <span className="ml-3 text-green-300 font-semibold">🟢 Ouvert</span>
                )}
              </>
            ) : (
              <span className="text-yellow-300">Pas de question pour cette étape.</span>
            )}
          </div>
        </div>

        <div className="flex gap-3 text-sm">
          <Link href={`/race/${raceId}`} className="underline opacity-80">
            ← Retour course
          </Link>
          <Link href="/ranking" className="underline opacity-80">
            Classement
          </Link>
          <Link href="/rules" className="underline opacity-80">
            Règles
          </Link>
        </div>
      </div>

      {isAdmin && question?.id && (
        <AdminLockControls
          questionId={question.id}
          initialLocked={!!question.locked}
          initialLockAt={question.lock_at ?? null}
        />
      )}

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold">Résultat étape</h2>

          {!results || results.length === 0 ? (
            <p className="mt-3 opacity-70">Aucun résultat importé pour cette étape.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {results.slice(0, 20).map((r: any) => (
                <div key={r.rider_id} className="flex items-center gap-3 text-sm">
                  <div className="w-7 text-center font-semibold opacity-70">#{r.position}</div>
                  <div>
                    <div className="font-medium">{r.riders?.name ?? '—'}</div>
                    {r.riders?.team ? <div className="opacity-60">{r.riders.team}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold">Classement de l’étape</h2>

          {users.length === 0 ? (
            <p className="mt-3 opacity-70">Aucun prono pour cette étape.</p>
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

      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-4">Prono étape</h2>

        <div className="text-sm opacity-70 mb-4">
          Startlist ({riderCount})
        </div>

        {!question ? (
          <p className="opacity-70">Question non trouvée.</p>
        ) : (
          <StartlistPicker
            questionId={question.id}
            slots={question.slots}
            teams={teams}
            initialEntries={myEntries ?? []}
            locked={locked}
          />
        )}
      </div>

      <div className="mt-10">
        <h2 className="text-xl font-semibold">Pronostics des joueurs</h2>
        <p className="text-sm opacity-70 mt-1">
          Un coureur dans le top demandé rapporte au moins 1 point. Plus il finit haut et plus ton prono est proche, plus tu marques.
        </p>

        <div className="mt-4 space-y-3">
          {users.map((u) => (
            <details key={u.userId} className="border rounded-lg p-3" open={users.length <= 2}>
              <summary className="cursor-pointer font-semibold">
                {u.username} — <span className="opacity-80">{u.total} pts</span>
              </summary>

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
              </div>
            </details>
          ))}
        </div>
      </div>
    </main>
  )
}
