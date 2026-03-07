import Link from 'next/link'
import { createSupabaseServerClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: races } = await supabase
    .from('races')
    .select('id, name, pcs_year')
    .order('pcs_year', { ascending: false })
    .order('name', { ascending: true })
    .limit(8)

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <p className="mt-3 opacity-80">
        Connecté en tant que <span className="font-medium">{user?.email ?? 'inconnu'}</span>
      </p>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/races" className="border rounded-lg p-4 hover:bg-white/5 transition">
          <div className="font-semibold">Voir les courses</div>
          <div className="text-sm opacity-70 mt-1">Accéder à toutes les courses importées</div>
        </Link>

        <Link href="/ranking" className="border rounded-lg p-4 hover:bg-white/5 transition">
          <div className="font-semibold">Voir le classement</div>
          <div className="text-sm opacity-70 mt-1">Classement global + détail par course</div>
        </Link>

        <Link href="/admin/import" className="border rounded-lg p-4 hover:bg-white/5 transition">
          <div className="font-semibold">Admin import</div>
          <div className="text-sm opacity-70 mt-1">Importer courses, startlists et résultats</div>
        </Link>
      </div>

      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-4">Dernières courses</h2>

        {(!races || races.length === 0) ? (
          <p className="opacity-70">Aucune course importée.</p>
        ) : (
          <div className="space-y-3">
            {races.map((race: any) => (
              <Link
                key={race.id}
                href={`/race/${race.id}`}
                className="block border rounded-lg p-4 hover:bg-white/5 transition"
              >
                {race.name} {race.pcs_year ? `(${race.pcs_year})` : ''}
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}