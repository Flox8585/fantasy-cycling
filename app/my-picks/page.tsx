import { createSupabaseServerClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PointsRules =
  | 'final_top3'
  | 'stage_top3'
  | 'final_top5'
  | 'gc_top5'
  | 'gc_top10'

function topSizeFromQuestionType(type: PointsRules) {
  if (type === 'stage_top3' || type === 'final_top3') return 3
  if (type === 'final_top5' || type === 'gc_top5') return 5
  if (type === 'gc_top10') return 10
  return 0
}

function computePoints(
  type: PointsRules,
  actual: number | null,
  predicted: number,
  isStage: boolean
) {
  if (!actual) return 0

  const size = topSizeFromQuestionType(type)
  if (!size) return 0
  if (actual > size) return 0

  const base = size - actual + 1
  const gap = Math.abs(predicted - actual)

  let pts = Math.max(1, base - gap)

  // Les étapes valent 50 % des points
  if (isStage) pts = Math.floor(pts / 2)

  return pts
}

type EntryRow = {
  position: number
  rider_id: string
  question_id: string
  riders:
    | {
        name: string | null
        team: string | null
      }
    | null
  prediction_questions:
    | {
        id: string
        race_id: string
        stage_id: string | null
        type: PointsRules
        label: string | null
      }
    | {
        id: string
        race_id: string
        stage_id: string | null
        type: PointsRules
        label: string | null
      }[]
    | null
}

type RaceRow = {
  id: string
  name: string | null
  pcs_year: number | null
}

type StageRow = {
  id: string
  race_id: string
  stage_number: number | null
  name: string | null
}

type ResultRow = {
  race_id: string
  stage_id: string | null
  rider_id: string
  position: number
}

type PickDisplay = {
  questionId: string
  riderId: string
  riderName: string
  team: string
  predicted: number
  actual: number | null
  points: number
  type: PointsRules
  label: string
  isStage: boolean
}

export default async function MyPicksPage() {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main className="p-10">
        <h1 className="text-3xl font-bold">Mes pronos</h1>
        <p className="mt-4 opacity-70">Connecte-toi pour voir tes pronostics.</p>
      </main>
    )
  }

  const { data: entriesRaw } = await supabase
    .from('prediction_entries')
    .select(`
      position,
      rider_id,
      question_id,
      riders ( name, team ),
      prediction_questions (
        id,
        race_id,
        stage_id,
        type,
        label
      )
    `)
    .eq('user_id', user.id)

  const { data: racesRaw } = await supabase
    .from('races')
    .select('id, name, pcs_year')
    .order('pcs_year', { ascending: false })
    .order('name', { ascending: true })

  const { data: stagesRaw } = await supabase
    .from('stages')
    .select('id, race_id, stage_number, name')
    .order('stage_number', { ascending: true })

  const { data: resultsRaw } = await supabase
    .from('results')
    .select('race_id, stage_id, rider_id, position')

  const entries = (entriesRaw ?? []) as EntryRow[]
  const races = (racesRaw ?? []) as RaceRow[]
  const stages = (stagesRaw ?? []) as StageRow[]
  const results = (resultsRaw ?? []) as ResultRow[]

  const raceMap = new Map<string, RaceRow>()
  const stageMap = new Map<string, StageRow>()

  for (const r of races) raceMap.set(r.id, r)
  for (const s of stages) stageMap.set(s.id, s)

  const resultMap = new Map<string, number>()
  for (const r of results) {
    const key = `${r.race_id}:${r.stage_id ?? 'gc'}:${r.rider_id}`
    resultMap.set(key, r.position)
  }

  // raceId -> stageId/gc -> picks[]
  const byRace = new Map<string, Map<string, PickDisplay[]>>()

  for (const e of entries) {
    const q = Array.isArray(e.prediction_questions)
      ? e.prediction_questions[0]
      : e.prediction_questions

    if (!q) continue

    const raceId = q.race_id
    const stageId = q.stage_id ?? 'gc'
    const isStage = stageId !== 'gc'

    const actual =
      resultMap.get(`${raceId}:${stageId}:${e.rider_id}`) ?? null

    const points = computePoints(
      q.type,
      actual,
      e.position,
      isStage
    )

    const pick: PickDisplay = {
      questionId: e.question_id,
      riderId: e.rider_id,
      riderName: e.riders?.name ?? '—',
      team: e.riders?.team ?? '',
      predicted: e.position,
      actual,
      points,
      type: q.type,
      label: q.label ?? '',
      isStage,
    }

    if (!byRace.has(raceId)) {
      byRace.set(raceId, new Map<string, PickDisplay[]>())
    }

    const stagesMap = byRace.get(raceId)!
    if (!stagesMap.has(stageId)) {
      stagesMap.set(stageId, [])
    }

    stagesMap.get(stageId)!.push(pick)
  }

  const sortedRaceEntries = Array.from(byRace.entries()).sort(([raceIdA], [raceIdB]) => {
    const a = raceMap.get(raceIdA)
    const b = raceMap.get(raceIdB)

    const yearA = a?.pcs_year ?? 0
    const yearB = b?.pcs_year ?? 0

    if (yearA !== yearB) return yearB - yearA
    return (a?.name ?? '').localeCompare(b?.name ?? '')
  })

  return (
    <main className="p-10 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Mes pronostics</h1>

      {sortedRaceEntries.length === 0 ? (
        <p className="opacity-70">Aucun prono enregistré pour l’instant.</p>
      ) : (
        <div className="space-y-4">
          {sortedRaceEntries.map(([raceId, stagesMap]) => {
            const race = raceMap.get(raceId)

            // on trie : GC d’abord, puis étapes par numéro
            const sortedStageEntries = Array.from(stagesMap.entries()).sort(([aId], [bId]) => {
              if (aId === 'gc') return -1
              if (bId === 'gc') return 1

              const stageA = stageMap.get(aId)
              const stageB = stageMap.get(bId)

              const nA = stageA?.stage_number ?? 999
              const nB = stageB?.stage_number ?? 999
              return nA - nB
            })

            const raceTotal = sortedStageEntries.reduce((sum, [, picks]) => {
              return sum + picks.reduce((s, p) => s + p.points, 0)
            }, 0)

            return (
              <details key={raceId} className="border rounded-lg p-4" open>
                <summary className="cursor-pointer font-semibold text-lg flex items-center justify-between gap-4">
                  <span>
                    {race?.name ?? 'Course'} {race?.pcs_year ? `(${race.pcs_year})` : ''}
                  </span>
                  <span className="text-sm opacity-80">{raceTotal} pts</span>
                </summary>

                <div className="mt-4 space-y-4">
                  {sortedStageEntries.map(([stageId, picks]) => {
                    const stage = stageId === 'gc' ? null : stageMap.get(stageId)

                    const title =
                      stageId === 'gc'
                        ? 'Classement général'
                        : stage?.name ?? 'Étape'

                    const sectionTotal = picks.reduce((s, p) => s + p.points, 0)

                    return (
                      <details key={stageId} className="border rounded p-3" open={stageId === 'gc'}>
                        <summary className="cursor-pointer font-semibold flex items-center justify-between gap-4">
                          <span>{title}</span>
                          <span className="text-sm opacity-80">{sectionTotal} pts</span>
                        </summary>

                        <div className="mt-3 space-y-2">
                          {picks
                            .sort((a, b) => a.predicted - b.predicted)
                            .map((p) => (
                              <div
                                key={`${p.questionId}-${p.riderId}`}
                                className="flex items-center justify-between gap-4 text-sm border-t border-white/10 pt-2"
                              >
                                <div className="min-w-0">
                                  <div>
                                    #{p.predicted} — {p.riderName}
                                  </div>
                                  <div className="opacity-60 truncate">{p.team}</div>
                                </div>

                                <div className="flex items-center gap-4 shrink-0">
                                  <span className="opacity-80">
                                    réel {p.actual ? `#${p.actual}` : '-'}
                                  </span>

                                  <span className="font-semibold">
                                    +{p.points} pts
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </details>
                    )
                  })}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </main>
  )
}
