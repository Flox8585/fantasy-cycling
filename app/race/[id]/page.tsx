import Link from 'next/link'
import { createSupabaseServerClient } from '../../../lib/supabase-server'
import StartlistPicker from './StartlistPicker'
import AdminLockControls from './AdminLockControls'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function RacePage(props: any) {
  const supabase = await createSupabaseServerClient()

  const params = await Promise.resolve(props.params)
  const raceId = params?.id as string | undefined

  if (!raceId) {
    return (
      <main className="p-10">
        <h1 className="text-3xl font-bold">Course</h1>
        <p className="mt-4 text-red-400">Erreur: id manquant dans l’URL.</p>
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

  const { data: race } = await supabase
    .from('races')
    .select('*')
    .eq('id', raceId)
    .single()

  const { data: stages } = await supabase
    .from('stages')
    .select('*')
    .eq('race_id', raceId)
    .order('stage_number')

  // Question principale GC / course
  const { data: question } = await supabase
    .from('prediction_questions')
    .select('*')
    .eq('race_id', raceId)
    .eq('is_active', true)
    .is('stage_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lockedByTime =
    question?.lock_at ? new Date(question.lock_at) <= new Date() : false

  const locked = !!question?.locked || lockedByTime

  // Startlist
  const { data: rr } = await supabase
    .from('race_riders')
    .select('rider_id, riders ( id, name, team )')
    .eq('race_id', raceId)

  // Group riders by team
  const byTeam = new Map<string, { id: string; name: string; team: string }[]>()

  for (const row of rr ?? []) {
    const r = (row as any).riders
    if (!r?.id || !r?.name) continue
    const team = r.team && String(r.team).trim() ? r.team : 'Équipe inconnue'
    if (!byTeam.has(team)) byTeam.set(team, [])
    byTeam.get(team)!.push({ id: r.id, name: r.name, team })
  }

  // Logos équipes (si présents)
  const teamNames = Array.from(byTeam.keys())
  const { data: logosRows } = teamNames.length
    ? await supabase
        .from('team_logos')
        .select('name, logo_url')
        .in('name', teamNames)
    : { data: [] as any[] }

  const logosMap = new Map<string, string>()
  for (const row of (logosRows ?? []) as any[]) {
    if (row?.name && row?.logo_url) logosMap.set(row.name, row.logo_url)
  }

  const teams = Array.from(byTeam.entries())
    .map(([team, riders]) => ({
      team,
      logoUrl: logosMap.get(team) ?? null,
      riders: riders.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.team.localeCompare(b.team))

  const riderCount = rr?.length ?? 0

  // Mes entries pour la question principale
  const { data: myEntries } =
    user && question?.id
      ? await supabase
          .from('prediction_entries')
          .select('rider_id, position, riders ( id, name, team )')
          .eq('question_id', question.id)
          .eq('user_id', user.id)
          .order('position')
      : { data: [] as any[] }

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-bold">
          {race?.name ?? 'Course introuvable'}
        </h1>

        <div className="flex gap-3 text-sm">
          <Link href="/races" className="underline opacity-80">
            ← Toutes les courses
          </Link>
          <Link href="/ranking" className="underline opacity-80">
            Classement
          </Link>
        </div>
      </div>

      <div className="mt-2 opacity-80 text-sm">
        {question ? (
          <span>
            Question: <span className="font-semibold">{question.label}</span> — Choisis {question.slots} coureurs
            {question.lock_at ? (
              <span className="ml-2 opacity-70">
                (lock auto: {new Date(question.lock_at).toLocaleString('fr-FR')})
              </span>
            ) : (
              <span className="ml-2 opacity-70">(pas d’heure auto)</span>
            )}
            {locked ? (
              <span className="ml-3 text-red-300 font-semibold">🔒 Verrouillé</span>
            ) : (
              <span className="ml-3 text-green-300 font-semibold">🟢 Ouvert</span>
            )}
          </span>
        ) : (
          <span className="text-yellow-300">
            Pas de question principale créée pour cette course.
          </span>
        )}
      </div>

      {isAdmin && question?.id ? (
        <AdminLockControls
          questionId={question.id}
          initialLocked={!!question.locked}
          initialLockAt={question.lock_at ?? null}
        />
      ) : null}

      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Étapes</h2>

        {!stages || stages.length === 0 ? (
          <p className="opacity-70">Aucune étape trouvée.</p>
        ) : (
          <div className="space-y-3">
            {stages.map((stage: any) => (
              <Link
                key={stage.id}
                href={`/stage/${stage.id}`}
                className="block p-4 border rounded-lg hover:bg-white/5 transition"
              >
                <div className="font-medium">
                  {stage.name}
                </div>

                <div className="text-sm opacity-70 mt-1">
                  {stage.start_time
                    ? `Départ: ${new Date(stage.start_time).toLocaleString('fr-FR')}`
                    : 'Pas d’heure définie'}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-4">
          Prono général / course
        </h2>

        <div className="text-sm opacity-70 mb-4">
          Startlist ({riderCount})
        </div>

        {!question ? (
          <p className="opacity-70">
            Crée d’abord une question dans <code>prediction_questions</code>.
          </p>
        ) : teams.length === 0 ? (
          <p className="opacity-70">
            Startlist vide (réimporte la course dans /admin/import).
          </p>
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
    </main>
  )
}