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

function normalizeRaceUrl(input: string) {
  let url = String(input || '').trim()
  if (!url) return ''

  url = url.replace('http://', 'https://')
  url = url.replace('https://procyclingstats.com', 'https://www.procyclingstats.com')
  url = url.replace('http://www.procyclingstats.com', 'https://www.procyclingstats.com')

  // Si on colle une étape /result -> on remonte à la course de base
  // ex: /race/paris-nice/2026/stage-3/result -> /race/paris-nice/2026
  url = url.replace(/\/stage-[^/]+\/result$/i, '')
  url = url.replace(/\/(result|startlist|stages|overview|gc)(\/)?$/i, '')

  return url
}
async function fetchHtml(url: string) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2500)
    try {
      await page.waitForLoadState('networkidle', { timeout: 20000 })
    } catch {}
    await page.waitForTimeout(800)

    const html = await page.content()
    const title = await page.title().catch(() => '')
    const looksBlocked =
      html.includes('Just a moment') ||
      html.toLowerCase().includes('cloudflare') ||
      html.toLowerCase().includes('forbidden') ||
      html.toLowerCase().includes('access denied')

    return { html, title, looksBlocked, finalUrl: page.url() }
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function POST(req: Request) {
  try {
    // ---- Auth + admin allowlist ----
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const admins = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)

    if (admins.length > 0 && !admins.includes(user.email.toLowerCase())) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }

    // ---- Input ----
    const body = await req.json().catch(() => ({}))
    const pcsUrlRaw = String(body?.pcsUrl ?? '').trim()
    if (!pcsUrlRaw) return NextResponse.json({ error: 'Missing pcsUrl' }, { status: 400 })

    const raceUrl = normalizeRaceUrl(pcsUrlRaw)
    if (!raceUrl.includes('/race/')) {
      return NextResponse.json({ error: 'pcsUrl must be a PCS race url' }, { status: 400 })
    }

    // ---- Find race in DB (must be imported first) ----
    const { data: raceRow, error: raceLookupErr } = await supabaseAdmin
      .from('races')
      .select('id, pcs_url, name')
      .eq('pcs_url', raceUrl)
      .maybeSingle()

    if (raceLookupErr) {
      return NextResponse.json({ error: raceLookupErr.message }, { status: 500 })
    }

    if (!raceRow?.id) {
      return NextResponse.json(
        { error: 'Course introuvable en base. Importe d’abord la course (Importer course + startlist).' },
        { status: 400 }
      )
    }

    const raceId = raceRow.id as string

// Détecter si on importe un résultat d'étape
const stageMatch = pcsUrlRaw.match(/\/stage-(\d+)\//i)
let stageId: string | null = null
let resultUrl = `${raceUrl}/result`

if (stageMatch) {
  const stageNumber = Number(stageMatch[1])

  const { data: stageRow } = await supabaseAdmin
    .from('stages')
    .select('id, pcs_url, stage_number')
    .eq('race_id', raceId)
    .eq('stage_number', stageNumber)
    .maybeSingle()

  if (stageRow?.id) {
    stageId = stageRow.id
    // on garde bien l'url étape/result
    resultUrl = `${raceUrl}/stage-${stageNumber}/result`
  }
}

    // ---- Fetch result page ----
    const resp = await fetchHtml(resultUrl)
    if (resp.looksBlocked) {
      return NextResponse.json(
        { error: 'PCS blocked (result page).', title: resp.title, finalUrl: resp.finalUrl },
        { status: 500 }
      )
    }

    const $ = cheerio.load(resp.html)

    // Try to scope to a likely results table first
    let table = $('table.basic').first()
    if (!table.length) table = $('table').first()

    let links = table.find('a[href*="/rider/"]')
    if (!links.length) links = $('a[href*="/rider/"]')

    // ---- Replace old results ----
if (stageId) {
  await supabaseAdmin.from('results').delete().eq('stage_id', stageId)
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

    // Top 50 max
    for (let i = 0; i < links.length && imported < 50; i++) {
      const a = links.eq(i)
      const pcsRiderUrl = absPcsUrl(String(a.attr('href') || ''))
      if (!pcsRiderUrl) continue
      if (!pcsRiderUrl.includes('/rider/')) continue
      if (seen.has(pcsRiderUrl)) continue
      seen.add(pcsRiderUrl)

      // Find position from row cells (numeric td)
      const tr = a.closest('tr')
      let pos: number | null = null

      const tds = tr.find('td')
      for (let k = 0; k < tds.length; k++) {
        const t = normalizeSpace($(tds.get(k)).text())
        const m = t.match(/^(\d{1,3})$/)
        if (m) {
          pos = Number(m[1])
          break
        }
      }
      if (!pos) pos = imported + 1

      // Find rider in DB by pcs_url
      const { data: rider } = await supabaseAdmin
        .from('riders')
        .select('id')
        .eq('pcs_url', pcsRiderUrl)
        .maybeSingle()

      if (!rider?.id) {
        if (!firstMissingRider) firstMissingRider = pcsRiderUrl
        continue
      }

      await supabaseAdmin.from('results').insert({
  race_id: raceId,
  stage_id: stageId,
  rider_id: rider.id,
  position: pos,
})

      imported++
    }

    return NextResponse.json({
      ok: true,
      race: { id: raceId, name: raceRow.name, pcs_url: raceUrl },
stageId,
      resultUrl,
      imported,
      debug: {
        title: resp.title,
        finalUrl: resp.finalUrl,
        linksFound: links.length,
        uniqueRiderLinks: seen.size,
        firstMissingRider,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}