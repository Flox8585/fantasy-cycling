'use client'

import { useEffect, useMemo, useState } from 'react'

function normalizeUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')

  // garde les liens saisis mais normalise l'affichage course de base
  url = url.replace(/\/gc\/result\/result\/?$/i, '')
  url = url.replace(/\/gc\/result\/?$/i, '')
  url = url.replace(/\/gc\/?$/i, '')
  url = url.replace(/\/stage-\d+\/result\/?$/i, '')
  url = url.replace(/\/stage-\d+\/?$/i, '')
  url = url.replace(/\/result\/?$/i, '')

  return url
}

type RiderItem = {
  id: string
  name: string
  team: string | null
  pcs_url: string | null
}

export default function AdminImportPage() {
  const [url, setUrl] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [responseText, setResponseText] = useState('')
  const [loadingCourse, setLoadingCourse] = useState(false)
  const [loadingJson, setLoadingJson] = useState(false)
  const [loadingGc, setLoadingGc] = useState(false)
  const [savingGc, setSavingGc] = useState(false)

  const [gcRaceName, setGcRaceName] = useState('')
  const [gcStartlist, setGcStartlist] = useState<RiderItem[]>([])
  const [gcRanking, setGcRanking] = useState<RiderItem[]>([])
  const [gcSearch, setGcSearch] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const pcsParam = params.get('pcs') ?? ''
    const jsonParam = params.get('json') ?? ''

    if (pcsParam) {
      setUrl(decodeURIComponent(pcsParam))
    }

    if (jsonParam) {
      try {
        const decoded = decodeURIComponent(jsonParam)
        const parsed = JSON.parse(decoded)
        setJsonText(JSON.stringify(parsed, null, 2))
      } catch {}
    }
  }, [])

  const normalizedUrl = useMemo(() => normalizeUrl(url), [url])

  const filteredStartlist = useMemo(() => {
    const q = gcSearch.trim().toLowerCase()
    if (!q) return gcStartlist

    return gcStartlist.filter((r) => {
      const name = String(r.name ?? '').toLowerCase()
      const team = String(r.team ?? '').toLowerCase()
      return name.includes(q) || team.includes(q)
    })
  }, [gcSearch, gcStartlist])

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
      setResponseText(JSON.stringify({ status: res.status, json }, null, 2))
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
      setResponseText(JSON.stringify({ status: res.status, json }, null, 2))
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

  async function loadGcStartlist() {
    try {
      setLoadingGc(true)
      setResponseText('')

      const res = await fetch('/api/admin/gc-startlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcsUrl: normalizedUrl }),
      })

      const json = await res.json().catch(() => null)

      if (!res.ok || !json?.ok) {
        setResponseText(JSON.stringify({ status: res.status, json }, null, 2))
        return
      }

      setGcRaceName(json.race?.name ?? '')
      setGcStartlist(json.startlist ?? [])
      setGcRanking([])
      setGcSearch('')
      setResponseText(JSON.stringify({ status: res.status, json: { ok: true, race: json.race, startlistCount: json.startlist?.length ?? 0 } }, null, 2))
    } catch (e: any) {
      setResponseText(
        JSON.stringify(
          { error: e?.message ?? 'Erreur chargement startlist GC' },
          null,
          2
        )
      )
    } finally {
      setLoadingGc(false)
    }
  }

  function addToGcRanking(rider: RiderItem) {
    if (gcRanking.find((x) => x.id === rider.id)) return
    setGcRanking((prev) => [...prev, rider])
  }

  function removeFromGcRanking(riderId: string) {
    setGcRanking((prev) => prev.filter((x) => x.id !== riderId))
  }

  function moveGcRanking(riderId: string, direction: -1 | 1) {
    setGcRanking((prev) => {
      const idx = prev.findIndex((x) => x.id === riderId)
      if (idx < 0) return prev

      const nextIdx = idx + direction
      if (nextIdx < 0 || nextIdx >= prev.length) return prev

      const arr = [...prev]
      const tmp = arr[idx]
      arr[idx] = arr[nextIdx]
      arr[nextIdx] = tmp
      return arr
    })
  }

  async function saveManualGc() {
    try {
      setSavingGc(true)
      setResponseText('')

      if (!gcRanking.length) {
        setResponseText(JSON.stringify({ error: 'Classement GC vide' }, null, 2))
        return
      }

      const ranking = gcRanking.map((r, idx) => ({
        rider_id: r.id,
        position: idx + 1,
      }))

      const res = await fetch('/api/admin/import-gc-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pcsUrl: normalizedUrl,
          ranking,
        }),
      })

      const json = await res.json().catch(() => null)
      setResponseText(JSON.stringify({ status: res.status, json }, null, 2))
    } catch (e: any) {
      setResponseText(
        JSON.stringify(
          { error: e?.message ?? 'Erreur sauvegarde GC manuel' },
          null,
          2
        )
      )
    } finally {
      setSavingGc(false)
    }
  }

  return (
    <main className="p-10 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">Admin — Import PCS</h1>

      <div className="space-y-6">
        <div className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">URL PCS</h2>

          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.procyclingstats.com/race/tirreno-adriatico/2026"
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

            <button
              onClick={loadGcStartlist}
              disabled={!normalizedUrl || loadingGc}
              className="px-4 py-2 border rounded disabled:opacity-50"
            >
              {loadingGc ? 'Chargement...' : 'Importer général (manuel)'}
            </button>
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">Résultats JSON</h2>

          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="w-full min-h-[260px] rounded border px-4 py-3 bg-black text-white font-mono text-sm"
            placeholder=""
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

        {gcStartlist.length > 0 ? (
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-semibold">Classement général manuel</h2>
                <div className="text-sm opacity-70 mt-1">
                  {gcRaceName || 'Course'} — sélectionne les coureurs dans l’ordre final.
                </div>
              </div>

              <button
                onClick={saveManualGc}
                disabled={!gcRanking.length || savingGc}
                className="px-4 py-2 border rounded disabled:opacity-50"
              >
                {savingGc ? 'Sauvegarde...' : 'Valider le général'}
              </button>
            </div>

            <div className="mt-4">
              <input
                value={gcSearch}
                onChange={(e) => setGcSearch(e.target.value)}
                placeholder="Rechercher un coureur ou une équipe"
                className="w-full rounded border px-4 py-3 bg-black text-white"
              />
            </div>

            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-3">Startlist</h3>
                <div className="border rounded-lg p-3 max-h-[500px] overflow-auto space-y-2">
                  {filteredStartlist.map((rider) => {
                    const alreadyPicked = gcRanking.some((x) => x.id === rider.id)

                    return (
                      <button
                        key={rider.id}
                        type="button"
                        disabled={alreadyPicked}
                        onClick={() => addToGcRanking(rider)}
                        className="w-full text-left border rounded p-3 disabled:opacity-40"
                      >
                        <div className="font-medium">{rider.name}</div>
                        {rider.team ? <div className="text-sm opacity-70">{rider.team}</div> : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-3">Classement GC choisi</h3>
                <div className="border rounded-lg p-3 max-h-[500px] overflow-auto space-y-2">
                  {gcRanking.length === 0 ? (
                    <div className="text-sm opacity-70">Aucun coureur sélectionné.</div>
                  ) : (
                    gcRanking.map((rider, idx) => (
                      <div key={rider.id} className="border rounded p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">#{idx + 1} — {rider.name}</div>
                            {rider.team ? <div className="text-sm opacity-70">{rider.team}</div> : null}
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => moveGcRanking(rider.id, -1)}
                              className="px-2 py-1 border rounded"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveGcRanking(rider.id, 1)}
                              className="px-2 py-1 border rounded"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFromGcRanking(rider.id)}
                              className="px-2 py-1 border rounded"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

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
