import Link from 'next/link'
import { createSupabaseServerClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function RacesPage() {
  const supabase = await createSupabaseServerClient()

  const now = new Date()

  const { data: races } = await supabase
    .from('races')
    .select('*')
    .order('name')

  const { data: questions } = await supabase
    .from('prediction_questions')
    .select('id, race_id, stage_id, lock_at, locked, is_active')

  const { data: results } = await supabase
    .from('results')
    .select('race_id')

  const resultsByRace = new Set<string>()
  for (const r of results ?? []) {
    if ((r as any).race_id) {
      resultsByRace.add((r as any).race_id)
    }
  }

  const open: any[] = []
  const locked: any[] = []
  const finished: any[] = []

  for (const race of races ?? []) {
    const q = questions?.find((qq: any) => qq.race_id === race.id && qq.stage_id === null)

    const hasResults = resultsByRace.has(race.id)

    if (hasResults) {
      finished.push(race)
      continue
    }

    if (!q) {
      open.push(race)
      continue
    }

    const lockAt = q.lock_at ? new Date(q.lock_at) : null

    if (q.locked || (lockAt && lockAt <= now)) {
      locked.push(race)
    } else {
      open.push(race)
    }
  }

  function Section({ title, races, badge }: any) {
    if (!races.length) return null

    return (
      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>

        <div className="space-y-3">
          {races.map((race: any) => (
            <Link
              key={race.id}
              href={`/race/${race.id}`}
              className="block border rounded-lg p-4 hover:bg-white/5 transition"
            >
              <div className="flex items-center justify-between">

                <div className="font-medium">
                  {race.name} {race.pcs_year ? `(${race.pcs_year})` : ''}
                </div>

                <div className="text-sm opacity-70">
                  {badge}
                </div>

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

      <Section
        title="🟢 Pronostics ouverts"
        races={open}
        badge="OPEN"
      />

      <Section
        title="🔒 Pronostics verrouillés"
        races={locked}
        badge="LOCKED"
      />

      <Section
        title="🏁 Courses terminées"
        races={finished}
        badge="FINISHED"
      />

    </main>
  )
}
