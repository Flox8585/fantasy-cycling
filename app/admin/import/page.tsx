'use client'

import { useEffect, useMemo, useState } from 'react'

function normalizeUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')

  // IMPORTANT:
  // - on garde /gc
  // - on garde /stage-x
  // - on retire juste /result en fin
  url = url.replace(/\/result\/?$/i, '')

  return url
}

export default function AdminImportPage() {
  const [url, setUrl] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [responseText, setResponseText] = useState('')
  const [loadingCourse, setLoadingCourse] = useState(false)
  const [loadingJson, setLoadingJson] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const pcs = params.get('pcs')
    const json = params.get('json')

    if (pcs) {
      setUrl(pcs)
    }

    if (json) {
      try {
        setJsonText(decodeURIComponent(json))
      } catch {
        setJsonText(json)
      }
    }
  }, [])

  const normalizedUrl = useMemo(() => normalizeUrl(url), [url])

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
      setResponseText(JSON.stringify(json, null, 2))
    } catch (e: any) {
      setResponseText(
        JSON.stringify(
          { error: e?.message ?? 'Erreur import course + startlist' },
          null,
          2
        )
      )
    } finally {
      setLoadingCourse(false)
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
        setResponseText(JSON.stringify({ error: 'JSON invalide' }, null, 2))
        return
      }

      const res = await fetch('/api/import/results/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pcsUrl: normalizedUrl,
          results: parsed,
        }),
      })

      const json = await res.json().catch(() => null)
      setResponseText(JSON.stringify(json, null, 2))
    } catch (e: any) {
      setResponseText(
        JSON.stringify(
          { error: e?.message ?? 'Erreur import JSON' },
          null,
          2
        )
      )
    } finally {
      setLoadingJson(false)
    }
  }

  return (
    <main className="p-10 max-w-5xl">
      <h1 className="text-3xl font-bold mb-6">Admin — Import PCS</h1>

      <div className="space-y-6">
        <div className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">URL PCS</h2>

          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.procyclingstats.com/race/paris-nice/2026/gc"
            className="w-full rounded border px-4 py-3 bg-black text-white"
          />

          <div className="mt-2 text-sm opacity-70">
            URL normalisée : {normalizedUrl || '—'}
          </div>

          <div className="mt-4 flex gap-3 flex-wrap">
            <button
              onClick={importCourseAndStartlist}
              disabled={!normalizedUrl || loadingCourse}
              className="px-4 py-2 border rounded disabled:opacity-50"
            >
              {loadingCourse ? 'Import...' : 'Importer course + startlist'}
            </button>
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">Résultats JSON</h2>

          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="w-full min-h-[260px] rounded border px-4 py-3 bg-black text-white font-mono text-sm"
            placeholder={`[
  {
    "position": 1,
    "pcs_url": "https://www.procyclingstats.com/rider/..."
  }
]`}
          />

          <div className="mt-4 flex gap-3 flex-wrap">
            <button
              onClick={importResultsFromJson}
              disabled={!normalizedUrl || !jsonText.trim() || loadingJson}
              className="px-4 py-2 border rounded disabled:opacity-50"
            >
              {loadingJson ? 'Import...' : 'Importer résultats depuis JSON'}
            </button>
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">Réponse</h2>
          <pre className="text-sm whitespace-pre-wrap overflow-x-auto">
            {responseText || 'Pas encore de réponse'}
          </pre>
        </div>
      </div>
    </main>
  )
}
