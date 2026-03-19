import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import { chromium } from 'playwright'
import { supabaseAdmin } from '../../../../lib/supabase-admin'
import { createSupabaseServerClient } from '../../../../lib/supabase-server'

function normalizeSpace(s: string) {
  return s.replace(/\s+/g, ' ').trim()
}

function absPcsUrl(hrefRaw: string) {
  const href = String(hrefRaw || '').trim()
  if (!href) return null
  if (href.startsWith('http')) return href
  if (href.startsWith('//')) return `https:${href}`
  if (href.startsWith('/')) return `https://www.procyclingstats.com${href}`
  return `https://www.procyclingstats.com/${href.replace(/^\/+/, '')}`
}

function normalizeInputUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')

  // on retire seulement /result éventuel
  // IMPORTANT: on garde /gc et /stage-x
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

async function fetchHtml(url: string) {
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2500)

    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 })
    } catch {}

    await page.waitForTimeout(800)

    const html = await page.content()
    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    const looksBlocked =
      html.includes('Just a moment') ||
      html.toLowerCase().includes('cloudflare') ||
      html.toLowerCase().includes('access denied') ||
      html.toLowerCase().includes('forbidden')

    return {
      html,
      title,
      finalUrl,
      looksBlocked,
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

function findBestResultsTable($: cheerio.CheerioAPI) {
  const candidates: { el: any; riderCount: number }[] = []

  const scopes = [
    $('main').first(),
    $('div.content').first(),
    $('div.container').first(),
    $('body').first(),
  ].filter((x) => x && x.length > 0)

  for (const scope of scopes) {
    scope.find('table').each((_, table) => {
      const links = $(table).find('a[href*="/rider/"]')
      const unique = new Set<string>()

      links.each((__, a) => {
        const href = absPcsUrl($(a).attr('href') || '')
        if (href && href.includes('/rider/')) unique.add(href)
      })

      const riderCount = unique.size
      if (riderCount > 0) {
        candidates.push({ el: table, riderCount })
      }
    })

    if (candidates.length > 0) break
  }

  if (!candidates.length) return null

  candidates.sort((a, b) => b.riderCount - a.riderCount)
  return candidates[0].el
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

    const inputUrl = normalizeInputUrl(pcsUrlRaw)
    const raceBaseUrl = parseRaceBaseUrl(inputUrl)

    if (!raceBaseUrl) {
      return NextResponse.json(
        { error: 'URL PCS invalide. Impossible de reconnaître la course.' },
        { status: 400 }
      )
    }

    const stageNumber = parseStageNumber(inputUrl)
    const gcMode = isGcUrl(inputUrl)

    const { data: raceRow, error: raceLookupErr } = await supabaseAdmin
      .from('races')
      .select('id, pcs_url, name, pcs_is_stage_race')
      .eq('pcs_url', raceBaseUrl)
      .maybeSingle()

    if (raceLookupErr) {
      return NextResponse.json({ error: raceLookupErr.message }, { status: 500 })
    }

    if (!raceRow?.id) {
      return NextResponse.json(
        { error: 'Course introuvable en base. Importe d’abord la course + startlist.' },
        { status: 400 }
      )
    }

    const raceId = raceRow.id as string

    let targetUrl = ''
    let targetStageId: string | null = null
    let targetLabel = ''

    if (stageNumber) {
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
          { error: `Étape ${stageNumber} introuvable en base pour cette course.` },
          { status: 400 }
        )
      }

      targetStageId = stageRow.id
      targetUrl = `${raceBaseUrl}/stage-${stageNumber}/result`
      targetLabel = `stage-${stageNumber}`
    } else if (gcMode) {
      targetStageId = null
      targetUrl = `${raceBaseUrl}/gc`
      targetLabel = 'gc'
    } else {
      targetStageId = null
      targetUrl = `${raceBaseUrl}/result`
      targetLabel = 'result'
    }

    const resp = await fetchHtml(targetUrl)

    if (resp.looksBlocked) {
      return NextResponse.json(
        {
          error: 'PCS blocked (result page).',
          title: resp.title,
          finalUrl: resp.finalUrl,
        },
        { status: 500 }
      )
    }

    const $ = cheerio.load(resp.html)
    const bestTable = findBestResultsTable($)

    let links: cheerio.Cheerio<any>
    if (bestTable) {
      links = $(bestTable).find('a[href*="/rider/"]')
    } else {
      links = $('a[href*="/rider/"]')
    }

    if (targetStageId) {
      await supabaseAdmin
        .from('results')
        .delete()
        .eq('race_id', raceId)
        .eq('stage_id', targetStageId)
    } else {
      await supabaseAdmin
        .from('results')
        .delete()
        .eq('race_id', raceId)
        .is('stage_id', null)
    }

    let imported = 0
    const seen = new Set<string>()
    let firstMissingRider: string | null = null

    for (let i = 0; i < links.length && imported < 50; i++) {
      const a = links.eq(i)
      const pcsRiderUrl = absPcsUrl(String(a.attr('href') || ''))
      if (!pcsRiderUrl) continue
      if (!pcsRiderUrl.includes('/rider/')) continue
      if (seen.has(pcsRiderUrl)) continue
      seen.add(pcsRiderUrl)

      const tr = a.closest('tr')
      let pos: number | null = null

      const tds = tr.find('td,th')
      for (let k = 0; k < tds.length; k++) {
        const t = normalizeSpace($(tds.get(k)).text())
        const m = t.match(/^(\d{1,3})$/)
        if (m) {
          pos = Number(m[1])
          break
        }
      }

      if (!pos) pos = imported + 1

      const { data: rider } = await supabaseAdmin
        .from('riders')
        .select('id')
        .eq('pcs_url', pcsRiderUrl)
        .maybeSingle()

      if (!rider?.id) {
        if (!firstMissingRider) firstMissingRider = pcsRiderUrl
        continue
      }

      const { error: insertErr } = await supabaseAdmin.from('results').insert({
        race_id: raceId,
        stage_id: targetStageId,
        rider_id: rider.id,
        position: pos,
      })

      if (insertErr) {
        return NextResponse.json(
          {
            error: insertErr.message,
            targetLabel,
            targetUrl,
            raceId,
            stageId: targetStageId,
            firstMissingRider,
          },
          { status: 500 }
        )
      }

      imported++
    }

    return NextResponse.json({
      ok: true,
      race: {
        id: raceId,
        name: raceRow.name,
        pcs_url: raceBaseUrl,
      },
      target: {
        mode: targetLabel,
        url: targetUrl,
        stageId: targetStageId,
      },
      imported,
      debug: {
        title: resp.title,
        finalUrl: resp.finalUrl,
        linksFound: links.length,
        uniqueRiderLinks: seen.size,
        firstMissingRider,
        usedBestTable: !!bestTable,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
