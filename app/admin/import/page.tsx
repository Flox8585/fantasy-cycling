'use client'

import { useEffect, useMemo, useState } from 'react'

function normalizePcsRaceUrl(input: string) {
  let url = input.trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')

  // si on colle /result, /startlist, etc. on remonte à la course
  url = url.replace(/\/(result|startlist|stages|overview|gc)(\/)?$/i, '')
  return url
}

export default function AdminImportPage() {
  const [url, setUrl] = useState('')
  const [loadingRace, setLoadingRace] = useState(false)
  const [loadingResultsLink, setLoadingResultsLink] = useState(false)
  const [loadingPaste, setLoadingPaste] = useState(false)
  const [out, setOut] = useState<any>(null)

  // import résultats “via JSON”
  const [resultsJson, setResultsJson] = useState('')

  const raceUrl = useMemo(() => normalizePcsRaceUrl(url), [url])
    useEffect(() => {
    try {
      // Exemple: /admin/import#pcs=BASE64....
      const hash = window.location.hash || ''
      if (!hash.startsWith('#pcs=')) return

      const b64 = hash.slice('#pcs='.length)

      // decode base64 -> json string
      const jsonStr = decodeURIComponent(
        Array.prototype.map
          .call(atob(b64), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )

      const payload = JSON.parse(jsonStr)
      if (payload?.pcsUrl) setUrl(payload.pcsUrl)
      if (payload?.rows) setResultsJson(JSON.stringify(payload.rows, null, 2))

      // Nettoie l'URL (enlève le hash) pour pas que ça reste
      history.replaceState(null, '', window.location.pathname)
    } catch (e) {
      console.log('Failed to decode hash payload', e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function importRace() {
    setLoadingRace(true)
    setOut(null)
    try {
      const res = await fetch('/api/import/pcs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: raceUrl }),
      })
      const json = await res.json().catch(() => ({}))
      setOut({ status: res.status, json })
    } catch (e: any) {
      setOut({ status: 0, json: { error: e?.message ?? 'network error' } })
    } finally {
      setLoadingRace(false)
    }
  }

  async function importResultsByLink() {
    // tente /api/import/results (risque 403 cloudflare)
    setLoadingResultsLink(true)
    setOut(null)
    try {
      const res = await fetch('/api/import/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcsUrl: raceUrl }),
      })
      const json = await res.json().catch(() => ({}))
      setOut({ status: res.status, json })
    } catch (e: any) {
      setOut({ status: 0, json: { error: e?.message ?? 'network error' } })
    } finally {
      setLoadingResultsLink(false)
    }
  }

  async function importResultsFromJson() {
    setLoadingPaste(true)
    setOut(null)
    try {
      const parsed = JSON.parse(resultsJson || '[]')
      const rows = Array.isArray(parsed) ? parsed : parsed.rows

      const res = await fetch('/api/import/results/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pcsUrl: raceUrl, rows }),
      })

      const json = await res.json().catch(() => ({}))
      setOut({ status: res.status, json })
    } catch (e: any) {
      setOut({ status: 0, json: { error: e?.message ?? 'invalid json' } })
    } finally {
      setLoadingPaste(false)
    }
  }

  return (
    <main className="p-10 max-w-3xl">
      <h1 className="text-3xl font-bold">Admin — Import PCS</h1>

      <div className="mt-6 space-y-3">
        <input
          className="w-full rounded-md border px-3 py-2 text-black"
          placeholder="https://www.procyclingstats.com/race/paris-roubaix/2025 (ou /result)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />

        <div className="text-sm opacity-70">
          URL normalisée : <span className="opacity-100">{raceUrl || '—'}</span>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button
            className="rounded-md bg-white text-black px-4 py-2 font-semibold disabled:opacity-50"
            disabled={!raceUrl || loadingRace || loadingResultsLink || loadingPaste}
            onClick={importRace}
          >
            {loadingRace ? 'Import course...' : 'Importer course + startlist'}
          </button>

          <button
            className="rounded-md border border-white/30 px-4 py-2 font-semibold disabled:opacity-50"
            disabled={!raceUrl || loadingRace || loadingResultsLink || loadingPaste}
            onClick={importResultsByLink}
            title="Tente d'importer /result via serveur (peut être bloqué par Cloudflare)"
          >
            {loadingResultsLink ? 'Import results...' : 'Importer résultats (lien)'}
          </button>
        </div>
      </div>

      {/* Import JSON fallback */}
      <div className="mt-10 border rounded-lg p-4">
        <h2 className="text-xl font-semibold">Importer résultats (JSON)</h2>
        <p className="text-sm opacity-70 mt-1">
          Si “Importer résultats (lien)” est bloqué, colle ici le JSON extrait depuis la console PCS.
        </p>

        <div className="mt-4 space-y-3">
          <textarea
            className="w-full rounded-md border px-3 py-2 text-black min-h-[160px]"
            placeholder='Colle ici un JSON: [ { "position": 1, "pcs_url": "https://www.procyclingstats.com/rider/..." }, ... ]'
            value={resultsJson}
            onChange={(e) => setResultsJson(e.target.value)}
          />

          <button
            className="rounded-md bg-white text-black px-4 py-2 font-semibold disabled:opacity-50"
            disabled={!raceUrl || !resultsJson.trim() || loadingRace || loadingResultsLink || loadingPaste}
            onClick={importResultsFromJson}
          >
            {loadingPaste ? 'Import...' : 'Importer résultats depuis JSON'}
          </button>
        </div>
      </div>

      {/* Output */}
      <div className="mt-6 border rounded-lg p-4">
        <pre className="text-xs whitespace-pre-wrap">
          {out ? JSON.stringify(out, null, 2) : 'Résultat ici...'}
        </pre>
      </div>

      <div className="mt-6 text-sm opacity-70 space-y-2">
        <p>
          Workflow conseillé : <b>Importer course + startlist</b> → puis <b>Importer résultats</b>.
        </p>
        <p>
          Ensuite va sur <b>/ranking</b> ou <b>/ranking/&lt;raceId&gt;</b>.
        </p>
      </div>
    </main>
  )
}