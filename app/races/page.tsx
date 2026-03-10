import Link from 'next/link'
import { createSupabaseServerClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type RaceStatus = 'open' | 'in_progress' | 'finished'

export default async function RacesPage() {
  const supabase = await createSupabaseServerClient()
  const now = new Date()

  const { data: races } = await supabase
    .from('races')
    .select('id, name, pcs_year, pcs_is_stage_race')
    .order('pcs_year', { ascending: false })
    .order('name', { ascending: true })

  const { data: questions } = await supabase
    .from('prediction_questions')
    .select('id, race_id, stage_id, lock_at, locked, is_active, created_at')
    .eq('is_active', true)

  const { data: results } = await supabase
    .from('results')
    .select('race_id, stage_id')

  const mainQuestionByRace = new Map<string, any>()
  const stageQuestionsByRace = new Map<string, any[]>()

  for (const q of questions ?? []) {
    const qq = q as any

    if (qq.stage_id === null) {
      const prev = mainQuestionByRace.get(qq.race_id)
      if (!prev) {
        mainQuestionByRace.set(qq.race_id, qq)
      } else {
        const prevDate = new Date(prev.created_at ?? 0).getTime()
        const curDate = new Date(qq.created_at ?? 0).getTime()
        if (curDate >= prevDate) mainQuestionByRace.set(qq.race_id, qq)
      }
    } else {
      if (!stageQuestionsByRace.has(qq.race_id)) stageQuestionsByRace.set(qq.race_id, [])
      stageQuestionsByRace.get(qq.race_id)!.push(qq)
    }
  }

  const hasGcResultsByRace = new Set<string>()
  const hasStageResultsByRace = new Set<string>()

  for (const r of results ?? []) {
    const rr = r as any
    if (!rr.stage_id && rr.race_id) hasGcResultsByRace.add(rr.race_id)
    if (rr.stage_id && rr.race_id) hasStageResultsByRace.add(rr.race_id)
  }

  function isQuestionLocked(q: any) {
    const lockedByTime = q?.lock_at ? new Date(q.lock_at) <= now : false
    return !!q?.locked || lockedByTime
  }

  function getRaceStatusInfo(race: any) {
    const mainQ = mainQuestionByRace.get(race.id)
    const stageQs = stageQuestionsByRace.get(race.id) ?? []

    const hasGcResults = hasGcResultsByRace.has(race.id)
    const hasStageResults = hasStageResultsByRace.has(race.id)

    const mainLocked = mainQ ? isQuestionLocked(mainQ) : false
    const hasOpenStageQuestions = stageQs.some((q) => !isQuestionLocked(q))

    let status: RaceStatus = 'open'
    let detail = 'Pronostics ouverts'

    if (hasGcResults) {
      status = 'finished'
      detail = 'Classement général importé'
    } else if (hasStageResults || mainLocked) {
      status = 'in_progress'

      if (race.pcs_is_stage_race) {
        if (hasOpenStageQuestions) {
          detail = 'Général verrouillé • étapes ouvertes'
        } else {
          detail = 'Général verrouillé • course en cours'
        }
      } else {
        detail = 'Course en cours'
      }
    }

    return { status, detail }
  }

  const open: any[] = []
  const inProgress: any[] = []
  const finished: any[] = []

  for (const race of races ?? []) {
    const rr = race as any
    const info = getRaceStatusInfo(rr)

    const item = {
      ...rr,
      status: info.status,
      statusLabel: info.detail,
    }

    if (info.status === 'open') open.push(item)
    else if (info.status === 'in_progress') inProgress.push(item)
    else finished.push(item)
  }

  function Section({
    title,
    races,
    badge,
  }: {
    title: string
    races: any[]
    badge: string
  }) {
    if (!races.length) return null

    return (
      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>

        <div className="space-y-3">
          {races.map((race) => (
            <Link
              key={race.id}
              href={`/race/${race.id}`}
              className="block border rounded-lg p-4 hover:bg-white/5 transition"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">
                    {race.name} {race.pcs_year ? `(${race.pcs_year})` : ''}
                  </div>
                  <div className="text-sm opacity-70 mt-1">{race.statusLabel}</div>
                </div>

                <div className="text-xs opacity-70">{badge}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  return (
    <main className="p-10 max-w-4xl">
      <h1 className="text-3xl font-bold">Courses</h1>

      <Section title="🟢 Pronostics ouverts" races={open} badge="OPEN" />
      <Section title="🟡 Courses en cours" races={inProgress} badge="IN PROGRESS" />
      <Section title="🏁 Courses terminées" races={finished} badge="FINISHED" />
    </main>
  )
}
