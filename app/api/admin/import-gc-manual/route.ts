import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabase-admin'
import { createSupabaseServerClient } from '../../../../lib/supabase-server'

function normalizeUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace(/\/gc\/result\/result\/?$/i, '')
  url = url.replace(/\/gc\/result\/?$/i, '')
  url = url.replace(/\/gc\/?$/i, '')
  url = url.replace(/\/stage-\d+\/result\/?$/i, '')
  url = url.replace(/\/stage-\d+\/?$/i, '')
  url = url.replace(/\/result\/?$/i, '')

  return url
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
    const pcsUrl = normalizeUrl(body?.pcsUrl ?? body?.url ?? '')
    const ranking = Array.isArray(body?.ranking) ? body.ranking : []

    if (!pcsUrl) {
      return NextResponse.json({ error: 'Missing pcsUrl' }, { status: 400 })
    }

    if (!ranking.length) {
      return NextResponse.json({ error: 'Ranking vide' }, { status: 400 })
    }

    const cleaned = ranking
      .map((x: any, idx: number) => ({
        rider_id: String(x?.rider_id ?? '').trim(),
        position: Number(x?.position ?? idx + 1),
      }))
      .filter((x: any) => x.rider_id && Number.isFinite(x.position))
      .sort((a: any, b: any) => a.position - b.position)

    const uniqueIds = new Set(cleaned.map((x: any) => x.rider_id))
    if (uniqueIds.size !== cleaned.length) {
      return NextResponse.json({ error: 'Doublons dans le classement' }, { status: 400 })
    }

    const { data: race, error: raceErr } = await supabaseAdmin
      .from('races')
      .select('id, name, pcs_url')
      .eq('pcs_url', pcsUrl)
      .maybeSingle()

    if (raceErr) {
      return NextResponse.json({ error: raceErr.message }, { status: 500 })
    }

    if (!race?.id) {
      return NextResponse.json(
        { error: 'Course introuvable. Importe d’abord course + startlist.' },
        { status: 400 }
      )
    }

    const raceId = race.id as string

    const { error: deleteErr } = await supabaseAdmin
      .from('results')
      .delete()
      .eq('race_id', raceId)
      .is('stage_id', null)

    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 })
    }

    const payload = cleaned.map((x: any) => ({
      race_id: raceId,
      stage_id: null,
      rider_id: x.rider_id,
      position: x.position,
    }))

    const { error: insertErr } = await supabaseAdmin
      .from('results')
      .insert(payload)

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      race,
      imported: payload.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
