'use client'

import { useEffect, useMemo, useState } from 'react'

function normalizeUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')

  // IMPORTANT: on garde /gc et /stage-x
  url = url.replace(/\/result\/?$/i, '')

  return url
}

export default function AdminImportPage() {
  const [url, setUrl] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [responseText, setResponseText] = useState('')

  const normalizedUrl = useMemo(() => normalizeUrl(url), [url])

  // 🔥 Lecture bookmarklet (SANS useSearchParams)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)

    const pcs = params.get('pcs')
    const json = params.get('json')

    if (pcs) setUrl(pcs)

    if (json) {
      try {
        setJsonText(decodeURIComponent(json))
      } catch {
        setJsonText(json)
      }
    }
  }, [])

  async function importResultsFromJson() {
    try {
      setResponseText('')

      const parsed = JSON.parse(jsonText)

      const res = await fetch('/api/import/results/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pcsUrl: normalizedUrl,
          results: parsed,
        }),
      })

      const json = await res.json()

      setResponseText(JSON.stringify(json, null, 2))
    } catch (e: any) {
      setResponseText(
        JSON.stringify(
          { error: e.message || 'Erreur import JSON' },
          null,
          2
        )
      )
    }
  }

  return (
    <main className="p-10 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Admin — Import PCS</h1>

      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL PCS"
        className="w-full rounded border px-4 py-3 bg-black text-white"
      />

      <div className="mt-2 text-sm opacity-70">
        URL normalisée : {normalizedUrl || '—'}
      </div>

      <textarea
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        className="mt-4 w-full min-h-[250px] rounded border px-4 py-3 bg-black text-white font-mono text-sm"
      />

      <button
        onClick={importResultsFromJson}
        className="mt-4 px-4 py-2 border rounded"
      >
        Importer JSON
      </button>

      <pre className="mt-6 text-sm whitespace-pre-wrap">
        {responseText}
      </pre>
    </main>
  )
}
