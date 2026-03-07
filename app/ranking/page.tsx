import Link from 'next/link'
import { createSupabaseServerClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PointsRules = 'final_top3' | 'stage_top3' | 'final_top5' | 'gc_top5' | 'gc_top10'

function topSizeFromQuestionType(questionType: PointsRules) {
  if (questionType === 'final_top3' || questionType === 'stage_top3') return 3
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

  // hors top demandé => 0
  if (actualPos > topSize) return 0

  // barème de base :
  // top 5 => 1er=5, 2e=4, ..., 5e=1
  // top 10 => 1er=10, ..., 10e=1
  const basePoints = topSize - actualPos + 1

  // malus selon l'écart entre prono et réel
  const gap = Math.abs(predictedPos - actualPos)

  // minimum 1 point si le coureur est bien dans le top demandé
  return Math.max(1, basePoints - gap)
}

export default async function RankingPage() {
  const supabase = await createSupabaseServerClient()

  const { data: races } = await supabase
    .from('races')
    .select('id, name, pcs_year')
    .order('name')

  const raceById = new Map<string, { id: string; name: string; pcs_year: number | null }>()
  for (const r of races ?? []) raceById.set((r as any).id, r as any)

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')

  const usernameByUser = new Map<string, string>()
  for (const p of profiles ?? []) {
    if ((p as any).id && (p as any).username) {
      usernameByUser.set((p as any).id, (p as any).username)
    }
  }

  // on ne prend que la question principale active par course (GC/course)
  const { data: questions } = await supabase
    .from('prediction_questions')
    .select('id, race_id, stage_id, type, label, slots, is_active, created_at')
    .eq('is_active', true)
    .is('stage_id', null)

  const mainQuestionByRace = new Map<string, any>()
  for (const q of questions ?? []) {
    const qq = q as any
    const prev = mainQuestionByRace.get(qq.race_id)
    if (!prev) {
      mainQuestionByRace.set(qq.race_id, qq)
    } else {
      const prevDate = new Date(prev.created_at ?? 0).getTime()
      const curDate = new Date(qq.created_at ?? 0).getTime()
      if (curDate >= prevDate) mainQuestionByRace.set(qq.race_id, qq)
    }
  }

  const mainQuestions = Array.from(mainQuestionByRace.values())
  const mainQuestionIds = mainQuestions.map((q: any) => q.id)

  const { data: entries } = mainQuestionIds.length
    ? await supabase
        .from('prediction_entries')
        .select('question_id, user_id, rider_id, position')
        .in('question_id', mainQuestionIds)
    : { data: [] as any[] }

  const { data: results } = await supabase
    .from('results')
    .select('race_id, rider_id, position, stage_id')

  const resultPosByRaceRider = new Map<string, number>()
  for (const r of results ?? []) {
    const rr = r as any
    if (rr.race_id && rr.rider_id && rr.position && !rr.stage_id) {
      resultPosByRaceRider.set(`${rr.race_id}:${rr.rider_id}`, rr.position)
    }
  }

  const qById = new Map<string, any>()
  for (const q of mainQuestions) qById.set(q.id, q)

  const pointsByUser = new Map<string, number>()
  const pointsByRaceByUser = new Map<string, number>() // raceId:userId

  for (const e of entries ?? []) {
    const ee = e as any
    const q = qById.get(ee.question_id)
    if (!q) continue

    const qType = q.type as PointsRules
    const raceId = q.race_id as string
    const actualPos = resultPosByRaceRider.get(`${raceId}:${ee.rider_id}`) ?? null

    const pts = pointsForPick({
      questionType: qType,
      actualPos,
      predictedPos: ee.position,
    })

    pointsByUser.set(ee.user_id, (pointsByUser.get(ee.user_id) ?? 0) + pts)

    const k = `${raceId}:${ee.user_id}`
    pointsByRaceByUser.set(k, (pointsByRaceByUser.get(k) ?? 0) + pts)
  }

  const leaderboard = Array.from(pointsByUser.entries())
    .map(([userId, points]) => ({
      userId,
      points,
      label: usernameByUser.get(userId) ?? userId.slice(0, 8),
    }))
    .sort((a, b) => b.points - a.points)

  const racesWithQuestions = mainQuestions
    .map((q: any) => q.race_id as string)
    .filter(Boolean)

  const uniqueRaceIds = Array.from(new Set(racesWithQuestions))

  return (
    <main className="p-10 max-w-4xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-bold">Classement global</h1>
        <Link href="/rules" className="underline opacity-80 text-sm">
          Voir les règles
        </Link>
      </div>

      {leaderboard.length === 0 ? (
        <p className="mt-4 opacity-70">Aucun prono / aucun résultat pour l’instant.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {leaderboard.map((row, idx) => (
            <div key={row.userId} className="border rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-7 text-center font-semibold opacity-70">#{idx + 1}</div>
                <div className="font-medium">{row.label}</div>
              </div>
              <div className="font-bold">{row.points} pts</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-3">Classement par course</h2>
        <p className="text-sm opacity-70 mb-4">
          On compte uniquement la question principale active de la course.
        </p>

        <div className="space-y-3">
          {uniqueRaceIds.map((raceId) => {
            const race = raceById.get(raceId)
            const q = mainQuestionByRace.get(raceId)
            if (!q) return null

            return (
              <details key={raceId} className="border rounded-lg p-3">
                <summary className="cursor-pointer font-semibold">
                  <Link className="underline" href={`/ranking/${raceId}`}>
                    {race?.name ?? 'Course'} {race?.pcs_year ? `(${race.pcs_year})` : ''}
                  </Link>
                  <span className="opacity-70 text-sm"> — {q.type}</span>
                </summary>

                <div className="mt-3 space-y-1 text-sm">
                  {leaderboard.map((u) => {
                    const k = `${raceId}:${u.userId}`
                    const pts = pointsByRaceByUser.get(k) ?? 0
                    return (
                      <div key={k} className="flex items-center justify-between">
                        <div className="opacity-80">{u.label}</div>
                        <div className="font-semibold">{pts} pts</div>
                      </div>
                    )
                  })}
                </div>
              </details>
            )
          })}
        </div>
      </div>
    </main>
  )
}
