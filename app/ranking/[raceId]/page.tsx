import Link from 'next/link'
import { createSupabaseServerClient } from '../../../lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PointsRules = 'final_top3' | 'stage_top3' | 'final_top5' | 'gc_top5' | 'gc_top10'

function topSizeFromQuestionType(questionType: PointsRules) {
  if (questionType === 'final_top3' || questionType === 'stage_top3') return 3
  if (questionType === 'final_top5' || questionType === 'gc_top5') return 5
  if (questionType === 'gc_top10') return 10
  return 0
}

function normalizeRaceName(name: string | null | undefined) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isMonumentRaceName(name: string | null | undefined) {
  const n = normalizeRaceName(name)

  return (
    n.includes('milano-sanremo') ||
    n.includes('milan-sanremo') ||
    n.includes('ronde van vlaanderen') ||
    n.includes('tour of flanders') ||
    n.includes('paris-roubaix') ||
    n.includes('liege-bastogne-liege') ||
    n.includes('liège-bastogne-liège') ||
    n.includes('il lombardia') ||
    n.includes('giro di lombardia') ||
    n.includes('lombardy')
  )
}

function pointsForPick(opts: {
  questionType: PointsRules
  actualPos: number | null
  predictedPos: number
  raceName: string | null
}) {
  const { questionType, actualPos, predictedPos, raceName } = opts
  if (!actualPos) return 0

  const topSize = topSizeFromQuestionType(questionType)
  if (!topSize) return 0
  if (actualPos > topSize) return 0

  const basePoints = topSize - actualPos + 1
  const gap = Math.abs(predictedPos - actualPos)

  let pts = Math.max(1, basePoints - gap)

  const isGc = questionType === 'gc_top5' || questionType === 'gc_top10'
  const isMonument = isMonumentRaceName(raceName)

  if (isGc || isMonument) {
    pts = pts * 2
  }

  return pts
}

type PickRow = {
  riderId: string
  riderName: string
  team: string | null
  predictedPos: number
  actualPos: number | null
  points: number
}

function buildSectionData(opts: {
  question: any
  results: any[]
  entries: any[]
  usernameByUser: Map<string, string>
  raceName: string | null
}) {
  const { question, results, entries, usernameByUser, raceName } = opts

  const actualPosByRider = new Map<string, number>()
  for (const r of results ?? []) {
    const rr = r as any
    if (rr?.rider_id && rr?.position) actualPosByRider.set(rr.rider_id, rr.position)
  }

  const picksByUser = new Map<string, PickRow[]>()

  for (const e of entries ?? []) {
    const ee = e as any
    const rider = ee.riders
    if (!ee.user_id || !ee.rider_id || !ee.position || !rider?.name) continue

    const actualPos = actualPosByRider.get(ee.rider_id) ?? null
    const points = pointsForPick({
      questionType: question.type as PointsRules,
      actualPos,
      predictedPos: ee.position,
      raceName,
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

  return {
    users,
    hasResults: (results?.length ?? 0) > 0,
  }
}

function RankingSection(props: {
  title: string
  subtitle?: string
  results: any[]
  users: {
    userId: string
    username: string
    total: number
    picks: PickRow[]
  }[]
  emptyResultsText: string
}) {
  const { title, subtitle, results, users, emptyResultsText } = props

  return (
    <div className="mt-10">
      <h2 className="text-xl font-semibold">{title}</h2>
      {subtitle ? <p className="text-sm opacity-70 mt-1">{subtitle}</p> : null}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="border rounded-lg p-4">
          <h3 className="text-lg font-semibold">Résultat</h3>

          {!results || results.length === 0 ? (
            <p className="mt-3 opacity-70">{emptyResultsText}</p>
          ) : (
            <div className="mt-3 space-y-2">
              {results.slice(0, 20).map((r: any) => (
                <div key={r.rider_id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-7 text-center font-semibold opacity-70">#{r.position}</div>
                    <div>
                      <div className="font-medium">{r.riders?.name ?? '—'}</div>
                      {r.riders?.team ? <div className="opacity-60">{r.riders.team}</div> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-lg p-4">
          <h3 className="text-lg font-semibold">Classement joueurs</h3>

          {users.length === 0 ? (
            <p className="mt-3 opacity-70">Aucun prono pour cette section.</p>
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

      <div className="mt-6">
        <h3 className="text-lg font-semibold">Pronostics détaillés</h3>

        <div className="mt-3 space-y-3">
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
    </div>
  )
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
    .select('id, name, pcs_year, pcs_url, pcs_is_stage_race')
    .eq('id', raceId)
    .single()

  const { data: stages } = await supabase
    .from('stages')
    .select('id, race_id, stage_number, name')
    .eq('race_id', raceId)
    .order('stage_number', { ascending: true })

  const { data: questions } = await supabase
    .from('prediction_questions')
    .select('id, race_id, stage_id, type, label, slots, is_active, created_at')
    .eq('race_id', raceId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  const { data: allResults } = await supabase
    .from('results')
    .select('race_id, stage_id, rider_id, position, riders ( id, name, team )')
    .eq('race_id', raceId)

  const { data: allEntries } = await supabase
    .from('prediction_entries')
    .select('question_id, user_id, rider_id, position, riders ( id, name, team )')

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')

  const usernameByUser = new Map<string, string>()
  for (const p of profiles ?? []) {
    if ((p as any).id && (p as any).username) {
      usernameByUser.set((p as any).id, (p as any).username)
    }
  }

  const mainQuestion = (questions ?? []).find((q: any) => q.stage_id === null) as any

  const gcResults = (allResults ?? []).filter((r: any) => !r.stage_id)
  const gcEntries = mainQuestion
    ? (allEntries ?? []).filter((e: any) => e.question_id === mainQuestion.id)
    : []

  const gcSubtitle =
    mainQuestion?.type === 'gc_top5' || mainQuestion?.type === 'gc_top10'
      ? 'Le classement général compte x2.'
      : isMonumentRaceName(race?.name)
        ? 'Monument : les points comptent x2.'
        : 'Barème normal.'

  const gcData = mainQuestion
    ? buildSectionData({
        question: mainQuestion,
        results: gcResults,
        entries: gcEntries,
        usernameByUser,
        raceName: race?.name ?? null,
      })
    : { users: [], hasResults: false }

  const stageBlocks = (stages ?? []).map((stage: any) => {
    const stageQuestion = (questions ?? []).find((q: any) => q.stage_id === stage.id) as any
    const stageResults = (allResults ?? []).filter((r: any) => r.stage_id === stage.id)
    const stageEntries = stageQuestion
      ? (allEntries ?? []).filter((e: any) => e.question_id === stageQuestion.id)
      : []

    const stageData = stageQuestion
      ? buildSectionData({
          question: stageQuestion,
          results: stageResults,
          entries: stageEntries,
          usernameByUser,
          raceName: race?.name ?? null,
        })
      : { users: [], hasResults: false }

    return {
      stage,
      stageQuestion,
      stageResults,
      stageData,
    }
  })

  return (
    <main className="p-10 max-w-5xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link className="opacity-70 underline" href="/ranking">
            ← Retour classement
          </Link>

          <h1 className="text-3xl font-bold mt-4">
            {race?.name ?? 'Course'} {race?.pcs_year ? `(${race.pcs_year})` : ''}
          </h1>
        </div>

        <div className="flex gap-4 items-center">
          <Link className="opacity-70 underline" href="/rules">
            Règles
          </Link>
          {race?.pcs_url ? (
            <a className="opacity-70 underline" href={race.pcs_url} target="_blank" rel="noreferrer">
              Voir PCS
            </a>
          ) : null}
        </div>
      </div>

      {mainQuestion ? (
        <p className="opacity-70 mt-2">
          Question principale : <span className="font-medium opacity-100">{mainQuestion.label}</span>
        </p>
      ) : null}

      {mainQuestion ? (
        <RankingSection
          title="Classement général / course"
          subtitle={gcSubtitle}
          results={gcResults}
          users={gcData.users}
          emptyResultsText="Aucun résultat GC / course importé pour l’instant."
        />
      ) : (
        <div className="mt-10 border rounded-lg p-4">
          <p className="opacity-70">Aucune question principale active pour cette course.</p>
        </div>
      )}

      {race?.pcs_is_stage_race ? (
        <div className="mt-12">
          <h2 className="text-2xl font-bold">Étapes</h2>
          <p className="text-sm opacity-70 mt-1">
            Les étapes comptent maintenant au barème normal.
          </p>

          <div className="mt-4 space-y-8">
            {stageBlocks.map(({ stage, stageQuestion, stageResults, stageData }) => (
              <div key={stage.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-xl font-semibold">{stage.name}</h3>
                    {stageQuestion ? (
                      <p className="text-sm opacity-70 mt-1">{stageQuestion.label}</p>
                    ) : (
                      <p className="text-sm opacity-70 mt-1">Pas de question active pour cette étape.</p>
                    )}
                  </div>

                  <Link href={`/stage/${stage.id}`} className="underline opacity-80 text-sm">
                    Voir la page étape
                  </Link>
                </div>

                {stageQuestion ? (
                  <RankingSection
                    title="Classement étape"
                    subtitle="Barème normal."
                    results={stageResults}
                    users={stageData.users}
                    emptyResultsText="Aucun résultat importé pour cette étape."
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  )
}
