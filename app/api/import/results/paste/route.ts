import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../../lib/supabase-admin'
import { createSupabaseServerClient } from '../../../../../lib/supabase-server'

const TOP_LIMIT = 20

function normalizeUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')

  // on retire les suffixes les plus fréquents
  url = url.replace(/\/(result|results|startlist|stages|overview|gc)(\/)?$/i, '')

  return url
}

function nameFromPcsUrl(pcsUrl: string) {
  const slug = pcsUrl.split('/rider/')[1]?.split('?')[0]?.trim() ?? ''
  if (!slug) return 'Unknown rider'

  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function parseStageNumberFromUrl(url: string): number | null {
  const m = url.match(/\/stage-(\d+)(\/|$)/i)
  if (!m) return null
  return Number(m[1])
}

function parseRaceBaseUrl(url: string) {
  const normalized = normalizeUrl(url)
  const m = normalized.match(/(https:\/\/www\.procyclingstats\.com\/race\/[^/]+\/\d{4})/i)
  return m?.[1] ?? null
}

function extractRowsFromBody(body: any): Array<{ position: number; pcs_url: string }> {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.rows)) return body.rows
  if (Array.isArray(body?.results)) return body.results
  if (Array.isArray(body?.json)) return body.json
  return []
}

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const admins = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)

    if (admins.length > 0 && !admins.includes(user.email.toLowerCase())) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const pcsUrlRaw = String(body?.pcsUrl ?? body?.url ?? '').trim()
    const rowsRaw = extractRowsFromBody(body)

    if (!pcsUrlRaw) {
      return NextResponse.json({ error: 'Missing pcsUrl/url' }, { status: 400 })
    }

    if (!rowsRaw.length) {
      return NextResponse.json({ error: 'No results rows found in JSON' }, { status: 400 })
    }

    const pcsUrl = normalizeUrl(pcsUrlRaw)
    const stageNumber = parseStageNumberFromUrl(pcsUrl)
    const raceBaseUrl = parseRaceBaseUrl(pcsUrl)

    if (!raceBaseUrl) {
      return NextResponse.json({ error: 'Impossible de reconnaître la course depuis l’URL PCS.' }, { status: 400 })
    }

    // 1) retrouver la course
    const { data: raceRow, error: raceErr } = await supabaseAdmin
      .from('races')
      .select('id, name, pcs_url')
      .eq('pcs_url', raceBaseUrl)
      .maybeSingle()

    if (raceErr) {
      return NextResponse.json({ error: raceErr.message }, { status: 500 })
    }

    if (!raceRow?.id) {
      return NextResponse.json(
        {
          error: 'Course introuvable en base. Importe d’abord la course/startlist.',
          raceBaseUrl,
        },
        { status: 400 }
      )
    }

    const raceId = raceRow.id as string

    // 2) si étape, retrouver l’étape
    let stageId: string | null = null

    if (stageNumber) {
      const { data: stageRow, error: stageErr } = await supabaseAdmin
        .from('stages')
        .select('id, stage_number, pcs_url')
        .eq('race_id', raceId)
        .eq('stage_number', stageNumber)
        .maybeSingle()

      if (stageErr) {
        return NextResponse.json({ error: stageErr.message }, { status: 500 })
      }

      if (!stageRow?.id) {
        return NextResponse.json(
          {
            error: `Étape ${stageNumber} introuvable pour cette course.`,
            raceId,
          },
          { status: 400 }
        )
      }

      stageId = stageRow.id
    }

    // 3) nettoyer les anciennes lignes de résultats
    if (stageId) {
      const { error: deleteErr } = await supabaseAdmin
        .from('results')
        .delete()
        .eq('race_id', raceId)
        .eq('stage_id', stageId)

      if (deleteErr) {
        return NextResponse.json({ error: deleteErr.message }, { status: 500 })
      }
    } else {
      const { error: deleteErr } = await supabaseAdmin
        .from('results')
        .delete()
        .eq('race_id', raceId)
        .is('stage_id', null)

      if (deleteErr) {
        return NextResponse.json({ error: deleteErr.message }, { status: 500 })
      }
    }

    // 4) on prend UNIQUEMENT les 20 premières lignes du JSON
    const rows = rowsRaw
      .filter((r) => r && Number.isFinite(Number(r.position)) && String(r.pcs_url || '').trim())
      .sort((a, b) => Number(a.position) - Number(b.position))
      .slice(0, TOP_LIMIT)

    let inserted = 0
    const createdRiders: string[] = []
    let firstError: string | null = null

    for (const row of rows) {
      const pos = Number(row.position)
      const pcsRiderUrl = normalizeUrl(String(row.pcs_url || '').trim())

      if (!pcsRiderUrl.includes('/rider/')) {
        if (!firstError) firstError = `Invalid rider url: ${pcsRiderUrl}`
        continue
      }

      let riderId: string | null = null

      // cherche le rider
      const { data: existingRider, error: existingErr } = await supabaseAdmin
        .from('riders')
        .select('id')
        .eq('pcs_url', pcsRiderUrl)
        .maybeSingle()

      if (existingErr) {
        if (!firstError) firstError = existingErr.message
        continue
      }

      if (existingRider?.id) {
        riderId = existingRider.id
      } else {
        // le créer automatiquement si absent
        const generatedName = nameFromPcsUrl(pcsRiderUrl)

        const { data: insertedRider, error: insertRiderErr } = await supabaseAdmin
          .from('riders')
          .insert({
            pcs_url: pcsRiderUrl,
            name: generatedName,
            team: null,
          })
          .select('id')
          .single()

        if (insertRiderErr || !insertedRider?.id) {
          if (!firstError) firstError = insertRiderErr?.message ?? `Impossible de créer rider ${pcsRiderUrl}`
          continue
        }

        riderId = insertedRider.id
        createdRiders.push(pcsRiderUrl)
      }

      // insérer le résultat
      const { error: insertResultErr } = await supabaseAdmin
        .from('results')
        .insert({
          race_id: raceId,
          stage_id: stageId,
          rider_id: riderId,
          position: pos,
        })

      if (insertResultErr) {
        if (!firstError) firstError = insertResultErr.message
        continue
      }

      inserted++
    }

    return NextResponse.json({
      ok: true,
      raceId,
      stageId,
      imported: inserted,
      topLimit: TOP_LIMIT,
      createdRidersCount: createdRiders.length,
      createdRiders,
      debug: {
        raceBaseUrl,
        stageNumber,
        rowsReceived: rowsRaw.length,
        rowsProcessed: rows.length,
        firstError,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message ?? 'Unknown error',
      },
      { status: 500 }
    )
  }
}
