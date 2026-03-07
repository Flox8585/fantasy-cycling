import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../../lib/supabase-admin'
import { createSupabaseServerClient } from '../../../../../lib/supabase-server'

function normalizeRaceUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')

  // étape -> course
  // ex: /race/paris-nice/2025/stage-1/result => /race/paris-nice/2025
  url = url.replace(/\/stage-[^/]+\/result$/i, '')
  url = url.replace(/\/stage-[^/]+$/i, '')

  // suffixes classiques
  url = url.replace(/\/(result|startlist|stages|overview|gc)(\/)?$/i, '')

  return url
}

function extractStageNumber(input: string) {
  const m = String(input || '').match(/\/stage-(\d+)(?:\/result)?$/i)
  return m ? Number(m[1]) : null
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

    const body = await req.json().catch(() => ({}))
    const pcsUrlRaw = String(body?.pcsUrl ?? '').trim()
    const rows = Array.isArray(body?.rows) ? body.rows : []

    if (!pcsUrlRaw) {
      return NextResponse.json({ error: 'Missing pcsUrl' }, { status: 400 })
    }

    if (!rows.length) {
      return NextResponse.json({ error: 'Missing rows[]' }, { status: 400 })
    }

    // 1) retrouver l'URL course de base
    const raceUrl = normalizeRaceUrl(pcsUrlRaw)

    // 2) retrouver si c'est une étape
    const stageNumber = extractStageNumber(pcsUrlRaw)

    // 3) lookup course
    const { data: raceRow, error: raceErr } = await supabaseAdmin
      .from('races')
      .select('id, pcs_url, name')
      .eq('pcs_url', raceUrl)
      .maybeSingle()

    if (raceErr) {
      return NextResponse.json({ error: raceErr.message }, { status: 500 })
    }

    if (!raceRow?.id) {
      return NextResponse.json(
        {
          error: `Course introuvable en base pour ${raceUrl}. Importe d’abord la course.`,
        },
        { status: 400 }
      )
    }

    const raceId = raceRow.id as string

    // 4) lookup stage si besoin
    let stageId: string | null = null

    if (stageNumber !== null) {
      const { data: stageRow, error: stageErr } = await supabaseAdmin
        .from('stages')
        .select('id, stage_number')
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

    // 5) remplacer les anciens résultats
    if (stageId) {
      await supabaseAdmin.from('results').delete().eq('stage_id', stageId)
    } else {
      await supabaseAdmin
        .from('results')
        .delete()
        .eq('race_id', raceId)
        .is('stage_id', null)
    }

    let inserted = 0
    let missingRiders = 0

    for (const r of rows) {
      const pcs_url = String(r?.pcs_url ?? '').trim()
      const position = Number(r?.position ?? 0)

      if (!pcs_url || !position) continue

      const { data: rider } = await supabaseAdmin
        .from('riders')
        .select('id')
        .eq('pcs_url', pcs_url)
        .maybeSingle()

      if (!rider?.id) {
        missingRiders++
        continue
      }

      const { error } = await supabaseAdmin.from('results').insert({
        race_id: raceId,
        stage_id: stageId,
        rider_id: rider.id,
        position,
      })

      if (!error) inserted++
    }

    return NextResponse.json({
      ok: true,
      race: {
        id: raceId,
        name: raceRow.name,
        pcs_url: raceUrl,
      },
      stageNumber,
      stageId,
      inserted,
      missingRiders,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}