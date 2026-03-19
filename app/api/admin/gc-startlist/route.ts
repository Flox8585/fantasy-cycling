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

    if (!pcsUrl) {
      return NextResponse.json({ error: 'Missing pcsUrl' }, { status: 400 })
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

    const { data: riders, error: ridersErr } = await supabaseAdmin
      .from('race_riders')
      .select(`
        rider_id,
        riders (
          id,
          name,
          team,
          pcs_url
        )
      `)
      .eq('race_id', race.id)

    if (ridersErr) {
      return NextResponse.json({ error: ridersErr.message }, { status: 500 })
    }

    const startlist = (riders ?? [])
      .map((x: any) => x.riders)
      .filter(Boolean)
      .sort((a: any, b: any) => String(a.name ?? '').localeCompare(String(b.name ?? '')))

    return NextResponse.json({
      ok: true,
      race,
      startlist,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
