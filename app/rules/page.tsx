import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function RulesPage() {
  return (
    <main className="p-10 max-w-4xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-bold">Règles</h1>
        <Link href="/dashboard" className="underline opacity-80 text-sm">
          Retour dashboard
        </Link>
      </div>

      <div className="mt-8 space-y-8">
        <section className="border rounded-lg p-5">
          <h2 className="text-xl font-semibold">Principe général</h2>
          <p className="mt-3 opacity-80">
            Chaque question demande de pronostiquer un top : Top 3, Top 5 ou Top 10 selon la course.
            Plus un coureur finit haut, plus il rapporte. Si ton prono est proche de sa place réelle,
            tu conserves davantage de points.
          </p>
        </section>

        <section className="border rounded-lg p-5">
          <h2 className="text-xl font-semibold">Barème de base</h2>

          <div className="mt-4 space-y-5">
            <div>
              <h3 className="font-semibold">Top 3</h3>
              <ul className="mt-2 opacity-80 space-y-1">
                <li>1er = 3 pts</li>
                <li>2e = 2 pts</li>
                <li>3e = 1 pt</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold">Top 5</h3>
              <ul className="mt-2 opacity-80 space-y-1">
                <li>1er = 5 pts</li>
                <li>2e = 4 pts</li>
                <li>3e = 3 pts</li>
                <li>4e = 2 pts</li>
                <li>5e = 1 pt</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold">Top 10</h3>
              <ul className="mt-2 opacity-80 space-y-1">
                <li>1er = 10 pts</li>
                <li>2e = 9 pts</li>
                <li>3e = 8 pts</li>
                <li>…</li>
                <li>10e = 1 pt</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="border rounded-lg p-5">
          <h2 className="text-xl font-semibold">Calcul des points</h2>
          <p className="mt-3 opacity-80">
            Si un coureur termine dans le top demandé, il rapporte au moins 1 point.
            Le calcul est :
          </p>

          <div className="mt-4 rounded-lg border p-4 font-mono text-sm overflow-x-auto">
            points = max(1, points_de_base - |place pronostiquée - place réelle|)
          </div>

          <p className="mt-4 opacity-80">
            Si le coureur termine hors du top demandé, il rapporte 0 point.
          </p>
        </section>

        <section className="border rounded-lg p-5">
          <h2 className="text-xl font-semibold">Exemples</h2>

          <div className="mt-4 space-y-4 opacity-80">
            <div>
              <p className="font-semibold">Exemple 1 — Top 5</p>
              <p>Tu mets un coureur 4e, il finit 3e.</p>
              <p>Base du 3e = 3 points, écart = 1 → score = 2 points.</p>
            </div>

            <div>
              <p className="font-semibold">Exemple 2 — Top 10</p>
              <p>Tu mets un coureur 3e, il finit 8e.</p>
              <p>Base du 8e = 3 points, écart = 5 → score minimum = 1 point.</p>
            </div>

            <div>
              <p className="font-semibold">Exemple 3 — Hors top</p>
              <p>Tu mets un coureur 2e, il finit 12e sur un Top 10.</p>
              <p>Il est hors top 10 → 0 point.</p>
            </div>
          </div>
        </section>

        <section className="border rounded-lg p-5">
          <h2 className="text-xl font-semibold">Types de pronostics</h2>
          <ul className="mt-3 opacity-80 space-y-1">
            <li>Courses d’un jour / étapes : généralement Top 3</li>
            <li>Monuments / certaines grandes classiques : Top 5</li>
            <li>Classement général de courses à étapes : Top 5</li>
            <li>Classement général des Grands Tours : Top 10</li>
          </ul>
        </section>
      </div>
    </main>
  )
}
