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
  isStage: boolean
}) {
  const { questionType, actualPos, predictedPos, isStage } = opts
  if (!actualPos) return 0

  const topSize = topSizeFromQuestionType(questionType)
  if (!topSize) return 0
  if (actualPos > topSize) return 0

  const basePoints = topSize - actualPos + 1
  const gap = Math.abs(predictedPos - actualPos)

  let pts = Math.max(1, basePoints - gap)

  // Les étapes valent 50% des points
  if (isStage) {
    pts = Math.floor(pts / 2)
  }

  return pts
}

export default async function RankingPage() {
  const supabase = await createSupabaseServerClient()

  const now = new Date()

  const { data: races } = await supabase
    .from('races')
    .select('id, name, pcs_year, pcs_is_stage_race')
    .order('pcs_year', { ascending: false })
    .order('name', { ascending: true })

  const raceById = new Map<string, any>()
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

  const { data: questions } = await supabase
    .from('prediction_questions')
    .select('id, race_id, stage_id, type, label, slots, is_active, created_at, lock_at, locked')
    .eq('is_active', true)

  const { data: entries } = await supabase
    .from('prediction_entries')
    .select('question_id, user_id, rider_id, position')

  const { data: results } = await supabase
    .from('results')
    .select('race_id, stage_id, rider_id, position')

  // -------- Question principale par course (GC / course)
  const mainQuestionByRace = new Map<string, any>()

  for (const q of questions ?? []) {
    const qq = q as any
    if (qq.stage_id) continue

    const prev = mainQuestionByRace.get(qq.race_id)
    if (!prev) {
      mainQuestionByRace.set(qq.race_id, qq)
    } else {
      const prevDate = new Date(prev.created_at ?? 0).getTime()
      const curDate = new Date(qq.created_at ?? 0).getTime()
      if (curDate >= prevDate) mainQuestionByRace.set(qq.race_id, qq)
    }
  }

  // -------- Map des résultats par race/stage/rider
  const resultPosByKey = new Map<string, number>()
  const hasGcResultsByRace = new Set<string>()

  for (const r of results ?? []) {
    const rr = r as any
    const key = `${rr.race_id}:${rr.stage_id ?? 'gc'}:${rr.rider_id}`
    resultPosByKey.set(key, rr.position)

    if (!rr.stage_id && rr.race_id) {
      hasGcResultsByRace.add(rr.race_id)
    }
  }

  // -------- Score global = GC/course + étapes /2
  const qById = new Map<string, any>()
  for (const q of questions ?? []) qById.set((q as any).id, q as any)

  const pointsByUser = new Map<string, number>()
  const pointsByRaceByUser = new Map<string, number>() // raceId:userId

  for (const e of entries ?? []) {
    const ee = e as any
    const q = qById.get(ee.question_id)
    if (!q) continue

    const raceId = q.race_id as string
    const stageId = q.stage_id ?? 'gc'
    const actualPos = resultPosByKey.get(`${raceId}:${stageId}:${ee.rider_id}`) ?? null

    const pts = pointsForPick({
      questionType: q.type as PointsRules,
      actualPos,
      predictedPos: ee.position,
      isStage: !!q.stage_id,
    })

    pointsByUser.set(ee.user_id, (pointsByUser.get(ee.user_id) ?? 0) + pts)

    const raceUserKey = `${raceId}:${ee.user_id}`
    pointsByRaceByUser.set(raceUserKey, (pointsByRaceByUser.get(raceUserKey) ?? 0) + pts)
  }

  const leaderboard = Array.from(pointsByUser.entries())
    .map(([userId, points]) => ({
      userId,
      points,
      label: usernameByUser.get(userId) ?? userId.slice(0, 8),
    }))
    .sort((a, b) => b.points - a.points)

  // -------- Status des courses
  type RaceStatus = 'open' | 'locked' | 'finished'

  function getRaceStatus(raceId: string): RaceStatus {
    const q = mainQuestionByRace.get(raceId)

    const lockedByTime = q?.lock_at ? new Date(q.lock_at) <= now : false
    const lockedManually = !!q?.locked
    const locked = lockedByTime || lockedManually

    const finished = hasGcResultsByRace.has(raceId)

    if (finished) return 'finished'
    if (locked) return 'locked'
    return 'open'
  }

  const openRaces: any[] = []
  const lockedRaces: any[] = []
  const finishedRaces: any[] = []

  for (const race of races ?? []) {
    const rr = race as any
    const status = getRaceStatus(rr.id)

    if (status === 'open') openRaces.push(rr)
    else if (status === 'locked') lockedRaces.push(rr)
    else finishedRaces.push(rr)
  }

  function RaceSection(props: {
    title: string
    races: any[]
    badge: string
  }) {
    const { title, races, badge } = props

    if (!races.length) return null

    return (
      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>

        <div className="space-y-3">
          {races.map((race) => {
            const q = mainQuestionByRace.get(race.id)
            return (
              <details key={race.id} className="border rounded-lg p-3">
                <summary className="cursor-pointer font-semibold flex items-center justify-between gap-4">
                  <span>
                    <Link className="underline" href={`/ranking/${race.id}`}>
                      {race.name} {race.pcs_year ? `(${race.pcs_year})` : ''}
                    </Link>
                    {q ? <span className="opacity-70 text-sm"> — {q.type}</span> : null}
                  </span>

                  <span className="text-xs opacity-70">{badge}</span>
                </summary>

                <div className="mt-3 space-y-1 text-sm">
                  {leaderboard.map((u) => {
                    const k = `${race.id}:${u.userId}`
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
    )
  }

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

      <RaceSection title="🟢 Courses ouvertes" races={openRaces} badge="OPEN" />
      <RaceSection title="🔒 Courses verrouillées / en cours" races={lockedRaces} badge="LOCKED" />
      <RaceSection title="🏁 Courses terminées" races={finishedRaces} badge="FINISHED" />
    </main>
  )
}
