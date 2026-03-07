import { createSupabaseServerClient } from '../../lib/supabase-server'
import Link from "next/link"

export default async function RacesPage() {

  const supabase = await createSupabaseServerClient()

  const { data: races } = await supabase
    .from('races')
    .select('*')
    .order('start_date', { ascending: false })

  return (
    <main className="p-10">

      <h1 className="text-3xl font-bold">
        Courses 🚴
      </h1>

      <div className="mt-6 space-y-4">

        {races?.length === 0 && (
          <p>Aucune course pour le moment</p>
        )}

        {races?.map((race) => (

  <Link
    key={race.id}
    href={`/race/${race.id}`}
    className="block p-4 border rounded-lg hover:bg-gray-900"
  >
    <h2 className="text-xl font-semibold">
      {race.name}
    </h2>

    <p className="opacity-70">
      {race.category}
    </p>

  </Link>

))}

      </div>

    </main>
  )
}