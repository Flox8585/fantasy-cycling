'use client'

import { useMemo, useState } from 'react'

function normalizeDisplayUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')

  // IMPORTANT :
  // on ne retire PAS /gc
  // on ne retire PAS /stage-x
  // on retire seulement /result en fin
  url = url.replace(/\/result\/?$/i, '')

  return url
}

export default function AdminImportPage() {
  const [url, setUrl] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [responseText, setResponseText] = useState('')
  const [loadingCourse, setLoadingCourse] = useState(false)
  const [loadingResult, setLoadingResult] = useState(false)
  const [loadingJson, setLoadingJson] = useState(false)

  const normalizedUrl = useMemo(() => normalizeDisplayUrl(url), [url])

  async function importCourseAndStartlist() {
    try {
      setLoadingCourse(true)
      setResponseText('')

      const res = await fetch('/api/import/pcs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl }),
      })

      const json = await res.json().catch(() => null)

      setResponseText(
        JSON.stringify(
          {
            status: res.status,
            json,
          },
          null,
          2
        )
      )
    } catch (e: any) {
      setResponseText(
        JSON.stringify(
          {
            error: e?.message ?? 'Unknown error',
          },
          null,
          2
        )
      )
    } finally {
      setLoadingCourse(false)
    }
  }

  async function importResultsFromLink() {
    try {
      setLoadingResult(true)
      setResponseText('')

      const res = await fetch('/api/import/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcsUrl: normalizedUrl }),
      })

      const json = await res.json().catch(() => null)

      setResponseText(
        JSON.stringify(
          {
            status: res.status,
            json,
          },
          null,
          2
        )
      )
    } catch (e: any) {
      setResponseText(
        JSON.stringify(
          {
            error: e?.message ?? 'Unknown error',
          },
          null,
          2
        )
      )
    } finally {
      setLoadingResult(false)
    }
  }

  async function importResultsFromJson() {
    try {
      setLoadingJson(true)
      setResponseText('')

      let parsed: any
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        setResponseText(
          JSON.stringify(
            {
              error: 'JSON invalide',
            },
            null,
            2
          )
        )
        return
      }

      const res = await fetch('/api/import/results/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pcsUrl: normalizedUrl, // ← très important : on envoie la vraie URL brute normalisée
          results: parsed,
        }),
      })

      const json = await res.json().catch(() => null)

      setResponseText(
        JSON.stringify(
          {
            status: res.status,
            json,
          },
          null,
          2
        )
      )
    } catch (e: any) {
      setResponseText(
        JSON.stringify(
          {
            error: e?.message ?? 'Unknown error',
          },
          null,
          2
        )
      )
    } finally {
      setLoadingJson(false)
    }
  }

  return (
    <main className="p-10 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Admin — Import PCS</h1>

      <div className="space-y-6">
        <div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.procyclingstats.com/race/paris-nice/2026/gc"
            className="w-full rounded border px-4 py-3 bg-black text-white"
          />

          <div className="mt-2 text-sm opacity-80">
            URL normalisée : {normalizedUrl || '—'}
          </div>

          <div className="mt-4 flex gap-3 flex-wrap">
            <button
              onClick={importCourseAndStartlist}
              disabled={!normalizedUrl || loadingCourse}
              className="rounded border px-4 py-2 disabled:opacity-50"
            >
              {loadingCourse ? 'Import...' : 'Importer course + startlist'}
            </button>

            <button
              onClick={importResultsFromLink}
              disabled={!normalizedUrl || loadingResult}
              className="rounded border px-4 py-2 disabled:opacity-50"
            >
              {loadingResult ? 'Import...' : 'Importer résultats (lien)'}
            </button>
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <h2 className="text-2xl font-semibold">Importer résultats (JSON)</h2>
          <p className="mt-2 opacity-80">
            Si l’import par lien bloque, colle ici le JSON extrait depuis PCS.
          </p>

          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="mt-4 w-full min-h-[240px] rounded border px-4 py-3 bg-black text-white font-mono text-sm"
            placeholder={`[
  {
    "position": 1,
    "pcs_url": "https://www.procyclingstats.com/rider/..."
  }
]`}
          />

          <button
            onClick={importResultsFromJson}
            disabled={!normalizedUrl || !jsonText.trim() || loadingJson}
            className="mt-4 rounded border px-4 py-2 disabled:opacity-50"
          >
            {loadingJson ? 'Import...' : 'Importer résultats depuis JSON'}
          </button>
        </div>

        <pre className="border rounded-lg p-4 text-sm overflow-x-auto whitespace-pre-wrap">
          {responseText || 'Pas encore de réponse'}
        </pre>

        <div className="text-sm opacity-70">
          Workflow conseillé : importer course + startlist, puis importer résultats.
        </div>
      </div>
    </main>
  )
}
