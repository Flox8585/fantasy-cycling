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

  // on retire seulement /result éventuel
  // IMPORTANT : on garde /gc et /stage-x
  url = url.replace(/\/result\/?$/i, '')

  return url
}

function parseRaceBaseUrl(url: string) {
  const normalized = normalizeUrl(url)
  const m = normalized.match(/(https:\/\/www\.procyclingstats\.com\/race\/[^/]+\/\d{4})/i)
  return m?.[1] ?? null
}

function parseStageNumber(url: string): number | null {
  const m = url.match(/\/stage-(\d+)(\/|$)/i)
  if (!m) return null
  return Number(m[1])
}

function isGcUrl(url: string) {
  return /\/gc\/?$/i.test(url)
}

function nameFromPcsUrl(pcsUrl: string) {
  const slug = pcsUrl.split('/rider/')[1]?.split('?')[0]?.trim() ?? ''
  if (!slug) return 'Unknown rider'

  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
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
    // ---- Auth
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

    // ---- Body
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
    const raceBaseUrl = parseRaceBaseUrl(pcsUrl)
    const stageNumber = parseStageNumber(pcsUrl)
    const gcMode = isGcUrl(pcsUrl)

    if (!raceBaseUrl) {
      return NextResponse.json(
        {
          error: 'Impossible de reconnaître la course depuis l’URL PCS.',
          pcsUrl,
        },
        { status: 400 }
      )
    }

    // ---- Find race
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

    // ---- Detect target type
    let stageId: string | null = null
    let mode: 'gc' | 'stage' | 'one-day' = 'one-day'

    if (stageNumber) {
      mode = 'stage'

      const { data: stageRow, error: stageErr } = await supabaseAdmin
        .from('stages')
        .select('id, stage_number, name')
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
    } else if (gcMode) {
      mode = 'gc'
      stageId = null
    } else {
      mode = 'one-day'
      stageId = null
    }

    // ---- Clear previous results for this exact target
    if (mode === 'stage' && stageId) {
      const { error: deleteErr } = await supabaseAdmin
        .from('results')
        .delete()
        .eq('race_id', raceId)
        .eq('stage_id', stageId)

      if (deleteErr) {
        return NextResponse.json({ error: deleteErr.message }, { status: 500 })
      }
    } else {
      // GC / one-day => stage_id null
      const { error: deleteErr } = await supabaseAdmin
        .from('results')
        .delete()
        .eq('race_id', raceId)
        .is('stage_id', null)

      if (deleteErr) {
        return NextResponse.json({ error: deleteErr.message }, { status: 500 })
      }
    }

    // ---- Clean rows
    const rows = rowsRaw
      .filter((r) => r && Number.isFinite(Number(r.position)) && String(r.pcs_url || '').trim())
      .map((r) => ({
        position: Number(r.position),
        pcs_url: normalizeUrl(String(r.pcs_url)),
      }))
      .sort((a, b) => a.position - b.position)
      .slice(0, TOP_LIMIT)

    let inserted = 0
    let firstError: string | null = null
    const createdRiders: string[] = []

    for (const row of rows) {
      const pos = row.position
      const pcsRiderUrl = row.pcs_url

      if (!pcsRiderUrl.includes('/rider/')) {
        if (!firstError) firstError = `Invalid rider URL: ${pcsRiderUrl}`
        continue
      }

      let riderId: string | null = null

      const { data: existingRider, error: riderErr } = await supabaseAdmin
        .from('riders')
        .select('id')
        .eq('pcs_url', pcsRiderUrl)
        .maybeSingle()

      if (riderErr) {
        if (!firstError) firstError = riderErr.message
        continue
      }

      if (existingRider?.id) {
        riderId = existingRider.id
      } else {
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
          if (!firstError) {
            firstError = insertRiderErr?.message ?? `Impossible de créer rider ${pcsRiderUrl}`
          }
          continue
        }

        riderId = insertedRider.id
        createdRiders.push(pcsRiderUrl)
      }

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
      race: {
        id: raceId,
        name: raceRow.name,
        pcs_url: raceBaseUrl,
      },
      mode,
      stageId,
      imported: inserted,
      topLimit: TOP_LIMIT,
      createdRidersCount: createdRiders.length,
      createdRiders,
      debug: {
        pcsUrl,
        raceBaseUrl,
        stageNumber,
        gcMode,
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
