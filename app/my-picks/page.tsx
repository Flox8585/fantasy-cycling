import Link from 'next/link'
import { createSupabaseServerClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function MyPicksPage() {

  const supabase = await createSupabaseServerClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main className="p-10">
        <h1 className="text-3xl font-bold">Mes pronos</h1>
        <p className="mt-4 opacity-70">Connecte-toi pour voir tes pronostics.</p>
      </main>
    )
  }

  const { data: entries } = await supabase
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
        label,
        type
      )
    `)
    .eq('user_id', user.id)
    .order('position')

  const { data: races } = await supabase
    .from('races')
    .select('*')

  const { data: stages } = await supabase
    .from('stages')
    .select('*')

  const raceMap = new Map()
  const stageMap = new Map()

  for (const r of races ?? []) raceMap.set(r.id, r)
  for (const s of stages ?? []) stageMap.set(s.id, s)

  // group by race
  const byRace = new Map()

  for (const e of entries ?? []) {

    const q = Array.isArray(e.prediction_questions)
  ? e.prediction_questions[0]
  : e.prediction_questions

    if (!q) continue

    const raceId = q.race_id
    const stageId = q.stage_id ?? 'gc'

    if (!byRace.has(raceId)) byRace.set(raceId, new Map())

    const raceMapEntries = byRace.get(raceId)

    if (!raceMapEntries.has(stageId)) raceMapEntries.set(stageId, [])

    raceMapEntries.get(stageId).push(e)
  }

  return (
    <main className="p-10 max-w-4xl">

      <h1 className="text-3xl font-bold mb-6">
        Mes pronostics
      </h1>

      {Array.from(byRace.entries()).map(([raceId, stagesMap]) => {

        const race = raceMap.get(raceId)

        return (

          <details key={raceId} className="border rounded-lg p-4 mb-4">

            <summary className="cursor-pointer font-semibold text-lg">
              {race?.name ?? 'Course'}
            </summary>

            <div className="mt-4 space-y-4">

              {Array.from(stagesMap.entries()).map(([stageId, picks]) => {

                const stage = stageMap.get(stageId)

                const title =
                  stageId === 'gc'
                    ? 'Classement général'
                    : stage?.name ?? 'Étape'

                return (

                  <div key={stageId} className="border rounded p-3">

                    <h3 className="font-semibold mb-2">
                      {title}
                    </h3>

                    <div className="space-y-1">

                      {picks
                        .sort((a, b) => a.position - b.position)
                        .map((p) => (

                          <div
                            key={`${p.question_id}-${p.rider_id}`}
                            className="flex justify-between text-sm"
                          >

                            <div>
                              #{p.position} — {p.riders?.name}
                            </div>

                            <div className="opacity-60">
                              {p.riders?.team}
                            </div>

                          </div>

                        ))}

                    </div>

                  </div>

                )

              })}

            </div>

          </details>

        )

      })}

    </main>
  )
}
