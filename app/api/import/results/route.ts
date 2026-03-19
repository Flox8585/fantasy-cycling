import { NextResponse } from 'next/server'
import { chromium } from 'playwright'
import { supabaseAdmin } from '../../../../lib/supabase-admin'
import { createSupabaseServerClient } from '../../../../lib/supabase-server'

function normalizeUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace(/\/result\/?$/i, '')

  return url
}

function parseRaceBaseUrl(url: string) {
  const m = url.match(/(https:\/\/www\.procyclingstats\.com\/race\/[^/]+\/\d{4})/i)
  return m?.[1] ?? null
}

function parseStageNumber(url: string) {
  const m = url.match(/\/stage-(\d+)(\/|$)/i)
  return m ? Number(m[1]) : null
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
    const pcsUrlRaw = String(body?.pcsUrl ?? body?.url ?? '').trim()

    if (!pcsUrlRaw) {
      return NextResponse.json({ error: 'Missing pcsUrl' }, { status: 400 })
    }

    const inputUrl = normalizeUrl(pcsUrlRaw)
    const raceBaseUrl = parseRaceBaseUrl(inputUrl)

    if (!raceBaseUrl) {
      return NextResponse.json(
        { error: 'URL PCS invalide. Impossible de reconnaître la course.' },
        { status: 400 }
      )
    }

    const stageNumber = parseStageNumber(inputUrl)
    const gcMode = isGcUrl(inputUrl)

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
        { error: 'Course introuvable en base. Importe d’abord la course + startlist.' },
        { status: 400 }
      )
    }

    const raceId = raceRow.id as string

    let targetUrl = ''
    let stageId: string | null = null
    let mode: 'stage' | 'gc' | 'one-day' = 'one-day'

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
          { error: `Étape ${stageNumber} introuvable pour cette course.` },
          { status: 400 }
        )
      }

      stageId = stageRow.id
      targetUrl = `${raceBaseUrl}/stage-${stageNumber}/result`
    } else if (gcMode) {
      mode = 'gc'
      stageId = null
      targetUrl = `${raceBaseUrl}/gc`
    } else {
      mode = 'one-day'
      stageId = null
      targetUrl = `${raceBaseUrl}/result`
    }

    const browser = await chromium.launch({ headless: true })

    try {
      const page = await browser.newPage()
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(2500)

      try {
        await page.waitForLoadState('networkidle', { timeout: 15000 })
      } catch {}

      await page.waitForTimeout(1000)

      const title = await page.title().catch(() => '')
      const finalUrl = page.url()
      const html = await page.content()

      const looksBlocked =
        html.includes('Just a moment') ||
        html.toLowerCase().includes('cloudflare') ||
        html.toLowerCase().includes('access denied') ||
        html.toLowerCase().includes('forbidden')

      if (looksBlocked) {
        return NextResponse.json(
          {
            error: 'PCS blocked (result page).',
            title,
            finalUrl,
          },
          { status: 500 }
        )
      }

      const extracted = await page.evaluate(() => {
        function clean(s: string) {
          return String(s || '').replace(/\s+/g, ' ').trim()
        }

        function abs(href: string | null) {
          if (!href) return null
          if (href.startsWith('http')) return href
          if (href.startsWith('//')) return `https:${href}`
          if (href.startsWith('/')) return `https://www.procyclingstats.com${href}`
          return `https://www.procyclingstats.com/${href.replace(/^\/+/, '')}`
        }

        const rows = Array.from(document.querySelectorAll('table tr'))
        const out: { position: number; pcs_url: string; rider_name: string }[] = []
        const seen = new Set<string>()

        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td,th'))
          if (!cells.length) continue

          let pos: number | null = null
          for (const cell of cells) {
            const txt = clean((cell as HTMLElement).innerText)
            if (/^\d{1,3}$/.test(txt)) {
              const n = Number(txt)
              if (n >= 1 && n <= 50) {
                pos = n
                break
              }
            }
          }

          if (!pos) continue

          const riderLink = row.querySelector('a[href*="/rider/"]') as HTMLAnchorElement | null
          if (!riderLink) continue

          const pcs_url = abs(riderLink.getAttribute('href'))
          const rider_name = clean(riderLink.innerText)

          if (!pcs_url || !rider_name) continue
          if (seen.has(pcs_url)) continue
          seen.add(pcs_url)

          out.push({ position: pos, pcs_url, rider_name })
        }

        out.sort((a, b) => a.position - b.position)
        return out.slice(0, 50)
      })

      if (!extracted.length) {
        return NextResponse.json(
          {
            error: 'Aucun coureur trouvé sur la page rendue PCS.',
            title,
            finalUrl,
            targetUrl,
          },
          { status: 500 }
        )
      }

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
        const { error: deleteErr } = await supabaseAdmin
          .from('results')
          .delete()
          .eq('race_id', raceId)
          .is('stage_id', null)

        if (deleteErr) {
          return NextResponse.json({ error: deleteErr.message }, { status: 500 })
        }
      }

      let inserted = 0
      let firstError: string | null = null

      for (const row of extracted) {
        let riderId: string | null = null

        const { data: existing } = await supabaseAdmin
          .from('riders')
          .select('id')
          .eq('pcs_url', row.pcs_url)
          .maybeSingle()

        if (existing?.id) {
          riderId = existing.id
        } else {
          const { data: created, error: createErr } = await supabaseAdmin
            .from('riders')
            .insert({
              pcs_url: row.pcs_url,
              name: row.rider_name || nameFromPcsUrl(row.pcs_url),
              team: null,
            })
            .select('id')
            .single()

          if (createErr || !created?.id) {
            if (!firstError) {
              firstError = createErr?.message ?? `Impossible de créer rider ${row.rider_name}`
            }
            continue
          }

          riderId = created.id
        }

        const { error: insertErr } = await supabaseAdmin
          .from('results')
          .insert({
            race_id: raceId,
            stage_id: stageId,
            rider_id: riderId,
            position: row.position,
          })

        if (insertErr) {
          if (!firstError) firstError = insertErr.message
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
        target: {
          mode,
          url: targetUrl,
          stageId,
        },
        imported: inserted,
        debug: {
          title,
          finalUrl,
          extracted: extracted.length,
          firstError,
        },
      })
    } finally {
      await browser.close().catch(() => {})
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
