import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import { DateTime } from 'luxon'
import { chromium } from 'playwright'
import { supabaseAdmin } from '../../../../lib/supabase-admin'
import { createSupabaseServerClient } from '../../../../lib/supabase-server'

function normalizeSpace(s: string) {
  return s.replace(/\s+/g, ' ').trim()
}

function parseRaceUrl(url: string) {
  const m = url.match(/procyclingstats\.com\/race\/([^/]+)\/(\d{4})/)
  if (!m) return null
  return { slug: m[1], year: Number(m[2]) }
}

function absPcsUrl(hrefRaw: string) {
  const href = String(hrefRaw || '').trim()
  if (!href) return null
  if (href.startsWith('http')) return href
  if (href.startsWith('//')) return `https:${href}`
  if (href.startsWith('/')) return `https://www.procyclingstats.com${href}`
  // PCS a parfois "rider/xxx" sans slash
  return `https://www.procyclingstats.com/${href.replace(/^\/+/, '')}`
}

function extractTeamFromCardText(cardTextRaw: string): string | null {
  const cardText = normalizeSpace(cardTextRaw)
  if (!cardText) return null

  // Ex: "Alpecin - Deceuninck (WT)1VAN DER POEL Mathieu..."
  const m = cardText.match(/^(.+?)\s*\((WT|PRT|PCT|CT)\)/i)
  if (m?.[1]) {
    const team = normalizeSpace(m[1])
    return team.length >= 2 ? team : null
  }

  // Fallback: avant le premier numéro
  const beforeNumbers = cardText.split(/\b\d{1,3}\b/)[0]
  const team2 = normalizeSpace(beforeNumbers.replace(/\([^)]*\)/g, ''))
  return team2.length >= 2 ? team2 : null
}

function extractTeamUrlFromCard(card: cheerio.Cheerio<any>) {
  const a = card.find('a[href*="/team/"]').first()
  const href = String(a.attr('href') || '').trim()
  return absPcsUrl(href)
}

function extractTeamLogoFromTeamPage(html: string) {
  const $ = cheerio.load(html)

  // PCS varie : on prend un img “raisonnable”
  const src =
    $('img.teamlogo').first().attr('src') ||
    $('img[src*="team"]').first().attr('src') ||
    $('img[src*="teams"]').first().attr('src') ||
    $('img').first().attr('src')

  if (!src) return null
  return absPcsUrl(src)
}

function extractDateTimeFromText(allText: string) {
  const text = normalizeSpace(allText)

  const timeMatch = text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)
  const hhmm = timeMatch ? timeMatch[0] : null

  let yyyy: string | null = null
  let mm: string | null = null
  let dd: string | null = null

  let m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (m) {
    yyyy = m[1]
    mm = m[2]
    dd = m[3]
  }

  if (!yyyy) {
    m = text.match(/\b(\d{2})-(\d{2})-(20\d{2})\b/)
    if (m) {
      dd = m[1]
      mm = m[2]
      yyyy = m[3]
    }
  }

  if (!yyyy) {
    m = text.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/)
    if (m) {
      dd = m[1]
      mm = m[2]
      yyyy = m[3]
    }
  }

  const dateISO = yyyy && mm && dd ? `${yyyy}-${mm}-${dd}` : null
  return { dateISO, hhmm }
}

function toParisTimestamptz(dateISO: string | null, hhmm: string | null) {
  if (!dateISO || !hhmm) return null
  const dt = DateTime.fromISO(`${dateISO}T${hhmm}:00`, { zone: 'Europe/Paris' })
  if (!dt.isValid) return null
  return dt.toUTC().toISO()
}

function extractStageProfileImageFromStagePage(html: string) {
  const $ = cheerio.load(html)

  // On prend l'image de profil d'étape la plus probable
  const candidates = [
    'img[src*="profile"]',
    'img[src*="stage"]',
    'img[src*="route"]',
    'img'
  ]

  for (const selector of candidates) {
    const imgs = $(selector).toArray()

    for (const img of imgs) {
      const src = String($(img).attr('src') || '').trim()
      if (!src) continue

      const abs = absPcsUrl(src)
      if (!abs) continue

      // on évite les mini icônes / logos / drapeaux
      const lower = abs.toLowerCase()
      if (
        lower.includes('flag') ||
        lower.includes('logo') ||
        lower.includes('team') ||
        lower.includes('jersey') ||
        lower.includes('avatar')
      ) {
        continue
      }

      return abs
    }
  }

  return null
}


function extractRaceStartTimeFromHtml(html: string) {
  const $ = cheerio.load(html)
  const allText = $('body').text()
  const { dateISO, hhmm } = extractDateTimeFromText(allText)

  return {
    start_date: dateISO,
    start_time: toParisTimestamptz(dateISO, hhmm),
  }
}

function extractInt(text: string) {
  const m = String(text || '').replace(/\s+/g, '').match(/(\d+)/)
  return m ? Number(m[1]) : null
}

function normalizeStageType(raw: string | null) {
  const s = normalizeSpace(String(raw || '')).toLowerCase()

  if (!s) return null
  if (s.includes('mountain')) return 'mountain'
  if (s.includes('hill')) return 'hilly'
  if (s.includes('flat')) return 'flat'
  if (s.includes('itt') || s.includes('ttt') || s.includes('time trial')) return 'itt'

  return s
}

function extractStageProfilesFromRoutePage(html: string) {
  const $ = cheerio.load(html)

  const out = new Map<
    number,
    {
      stage_type: string | null
      vertical_meters: number | null
      profile_score: number | null
      ps_final_25k: number | null
      profile_image_url: string | null
    }
  >()

  // PCS "route/stage-profiles" : on parse le texte global bloc par bloc
  // et on récupère aussi une image si présente dans le même bloc.
  const bodyText = $('body').text()

  // fallback text parsing bloc par étape
  const re =
    /Stage\s+(\d+)(?:\s*\(ITT\))?[\s\S]*?Vertical meters:\s*([\d\s]+)?[\s\S]*?ProfileScore:\s*([\d\s]+)?[\s\S]*?PS final 25k:\s*([\d\s]+)?/gi

  let m: RegExpExecArray | null
  while ((m = re.exec(bodyText)) !== null) {
    const stageNumber = Number(m[1])
    if (!stageNumber) continue

    const vertical_meters = extractInt(m[2] || '')
    const profile_score = extractInt(m[3] || '')
    const ps_final_25k = extractInt(m[4] || '')

    out.set(stageNumber, {
      stage_type: null,
      vertical_meters,
      profile_score,
      ps_final_25k,
      profile_image_url: null,
    })
  }

  // parse "profile type" filters and stage cards when available
  // on cherche des blocs contenant "Stage X |"
  $('body *').each((_, el) => {
    const txt = normalizeSpace($(el).text())
    const stageMatch = txt.match(/\bStage\s+(\d+)\b/i)
    if (!stageMatch) return

    const stageNumber = Number(stageMatch[1])
    if (!stageNumber) return

    const current = out.get(stageNumber) ?? {
      stage_type: null,
      vertical_meters: null,
      profile_score: null,
      ps_final_25k: null,
      profile_image_url: null,
    }

    // type heuristique à partir du score / texte
    // si l’élément contient "ITT"
    if (!current.stage_type && /\bITT\b/i.test(txt)) {
      current.stage_type = 'itt'
    }

    // image éventuelle
    if (!current.profile_image_url) {
      const img =
        $(el).find('img').first().attr('src') ||
        $(el).closest('div').find('img').first().attr('src')

      if (img) {
        current.profile_image_url = absPcsUrl(img)
      }
    }

    out.set(stageNumber, current)
  })

  return out
}

function inferStageTypeFromMetrics(opts: {
  stageName: string
  verticalMeters: number | null
  profileScore: number | null
}) {
  const { stageName, verticalMeters, profileScore } = opts
  const name = normalizeSpace(stageName).toLowerCase()

  if (name.includes('(itt)') || name.includes('itt') || name.includes('time trial')) {
    return 'itt'
  }

  const vm = verticalMeters ?? 0
  const ps = profileScore ?? 0

  if (ps >= 180 || vm >= 3200) return 'mountain'
  if (ps >= 45 || vm >= 1400) return 'hilly'
  return 'flat'
}


async function fetchHtml(url: string): Promise<{
  html: string
  looksBlocked: boolean
  status: number | null
  finalUrl: string
  title: string
}> {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'fr-FR',
    })
    const page = await context.newPage()

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2500)

    // parfois PCS charge après
    try {
      await page.waitForLoadState('networkidle', { timeout: 20000 })
    } catch {}
    await page.waitForTimeout(1200)

    const html = await page.content()
    const title = await page.title().catch(() => '')
    const finalUrl = page.url()
    const status = resp?.status() ?? null

    const looksBlocked =
      html.includes('Just a moment') ||
      html.toLowerCase().includes('cloudflare') ||
      html.toLowerCase().includes('access denied') ||
      html.toLowerCase().includes('forbidden')

    return { html, looksBlocked, status, finalUrl, title }
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function POST(req: Request) {
  try {
    // ---- Auth ----
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    // Admin allowlist (optionnel)
    const admins = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)

    if (admins.length > 0 && !admins.includes(user.email.toLowerCase())) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const inputUrl = String(body?.url ?? '').trim()
    if (!inputUrl) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

    const parsed = parseRaceUrl(inputUrl)
    if (!parsed) {
      return NextResponse.json(
        { error: 'URL must look like https://www.procyclingstats.com/race/<slug>/<year>' },
        { status: 400 }
      )
    }

    const raceUrl = `https://www.procyclingstats.com/race/${parsed.slug}/${parsed.year}`
    const startlistUrl = `${raceUrl}/startlist`

    // ---- Fetch race page ----
    const raceResp = await fetchHtml(raceUrl)
    if (raceResp.looksBlocked) {
      return NextResponse.json({ error: 'PCS blocked on race page.' }, { status: 500 })
    }

    const $ = cheerio.load(raceResp.html)
    const title = normalizeSpace($('title').first().text() || `${parsed.slug} ${parsed.year}`)
    const raceName =
      normalizeSpace(
        title.replace(/\s*\|\s*ProCyclingStats.*/i, '').replace(new RegExp(`${parsed.year}.*$`), '')
      ) || parsed.slug

    // detect stage race by stage links
const stageLinks = new Set<string>()

function collectStageLinks($root: cheerio.CheerioAPI) {
  $root('a[href]').each((_, a) => {
    const href = String($root(a).attr('href') || '').trim()
    if (!href) return

    const abs = absPcsUrl(href)
    if (!abs) return

    // accepte plus de variantes PCS
    const isSameRace = parsed
  ? abs.includes(`/race/${parsed.slug}/${parsed.year}`)
  : false

    const looksLikeStage =
      /stage-\d+/i.test(abs) ||
      /prologue/i.test(abs) ||
      /stage-[a-z]/i.test(abs)

    if (isSameRace && looksLikeStage) {
      stageLinks.add(abs)
    }
  })
}

collectStageLinks($)

// fallback : certaines courses listent mieux les étapes sur /stages
if (stageLinks.size === 0) {
  try {
    const stagesPageResp = await fetchHtml(`${raceUrl}/stages`)
    if (!stagesPageResp.looksBlocked) {
      const $$$ = cheerio.load(stagesPageResp.html)
      collectStageLinks($$$)
    }
  } catch {
    // ignore
  }
}

const isStageRace = stageLinks.size > 0
// ---- Fetch route/stage-profiles page (best effort) ----
    let stageProfilesMap = new Map<
      number,
      {
        stage_type: string | null
        vertical_meters: number | null
        profile_score: number | null
        ps_final_25k: number | null
        profile_image_url: string | null
      }
    >()

    if (isStageRace) {
      try {
        const routeProfilesResp = await fetchHtml(`${raceUrl}/route/stage-profiles`)
        if (!routeProfilesResp.looksBlocked) {
          stageProfilesMap = extractStageProfilesFromRoutePage(routeProfilesResp.html)
        }
      } catch {
        // ignore
      }
    }

    // ---- Extract race date/time from PCS (semi-auto) ----
    const raceTimes = extractRaceStartTimeFromHtml(raceResp.html)

    // ---- Upsert race ----
    const { data: raceRow, error: raceErr } = await supabaseAdmin
      .from('races')
      .upsert(
                {
          name: raceName,
          pcs_url: raceUrl,
          pcs_slug: parsed.slug,
          pcs_year: parsed.year,
          pcs_is_stage_race: isStageRace,
          category: null,
          start_date: raceTimes.start_date ?? null,
          start_time: raceTimes.start_time ?? null,
          end_date: null,
        },
        { onConflict: 'pcs_url' }
      )
      .select('id')
      .single()

    if (raceErr || !raceRow?.id) {
      return NextResponse.json({ error: raceErr?.message ?? 'Race upsert failed' }, { status: 500 })
    }
    const raceId = raceRow.id as string

    // ✅ SYNC: reset links for this race so reimport = replace
    const { error: resetErr } = await supabaseAdmin.from('race_riders').delete().eq('race_id', raceId)
    if (resetErr) {
      return NextResponse.json({ error: `Reset race_riders failed: ${resetErr.message}` }, { status: 500 })
    }

    // ---- Build stages ----
    const stagesToCreate: { stage_number: number; name: string; pcs_url: string }[] = !isStageRace
      ? [{ stage_number: 1, name: `${raceName} (One-day)`, pcs_url: `${raceUrl}/result` }]
      : Array.from(stageLinks)
          .filter(Boolean)
          .sort((a, b) => {
            const na = Number(a.match(/stage-(\d+)/)?.[1] ?? 999)
            const nb = Number(b.match(/stage-(\d+)/)?.[1] ?? 999)
            return na - nb
          })
          .map((u) => {
            const n = Number(u.match(/stage-(\d+)/)?.[1] ?? 0)
            return { stage_number: n, name: `Stage ${n}`, pcs_url: u }
          })
          .filter((s) => s.stage_number > 0)

    const createdStages: { id: string; stage_number: number }[] = []

for (const st of stagesToCreate) {
  const profileData = stageProfilesMap.get(st.stage_number)

const vertical_meters = profileData?.vertical_meters ?? null
const profile_score = profileData?.profile_score ?? null
const ps_final_25k = profileData?.ps_final_25k ?? null

const inferredStageType =
  profileData?.stage_type ??
  inferStageTypeFromMetrics({
    stageName: st.name,
    verticalMeters: vertical_meters,
    profileScore: profile_score,
  })

// ✅ image propre par étape depuis /info/profiles
let stageProfileImageUrl: string | null = null

try {
  const stageInfoProfilesUrl = `${raceUrl}/stage-${st.stage_number}/info/profiles`
  const stageInfoResp = await fetchHtml(stageInfoProfilesUrl)

  if (!stageInfoResp.looksBlocked) {
    stageProfileImageUrl = extractStageProfileImageFromStagePage(stageInfoResp.html)
  }
} catch {
  // ignore
}

// fallback éventuel vers l'image récupérée sur la page globale
if (!stageProfileImageUrl) {
  stageProfileImageUrl = profileData?.profile_image_url ?? null
}

const { data: stageRow } = await supabaseAdmin
  .from('stages')
  .upsert(
    {
      race_id: raceId,
      stage_number: st.stage_number,
      name: st.name,
      start_time: null,
      pcs_url: st.pcs_url,
      pcs_date: null,
      stage_type: inferredStageType,
      vertical_meters,
      profile_score,
      ps_final_25k,
      profile_image_url: stageProfileImageUrl,
    },
    { onConflict: 'pcs_url' }
  )
  .select('id, stage_number')
  .single()

  if (stageRow?.id) {
    createdStages.push(stageRow)
  }
}


// ---- AUTO CREATE QUESTIONS ----

// GC question (general classification)
await supabaseAdmin
  .from('prediction_questions')
  .upsert(
    {
      race_id: raceId,
      stage_id: null,
      type: 'gc_top5',
      slots: 5,
      label: `${raceName} ${parsed.year} — GC Top 5`,
      lock_at: null,
      is_active: true,
    },
    { onConflict: 'race_id,stage_id,type' }
  )

// Stage questions
for (const st of createdStages) {
  await supabaseAdmin
    .from('prediction_questions')
    .upsert(
      {
        race_id: raceId,
        stage_id: st.id,
        type: 'stage_top3',
        slots: 3,
        label: `${raceName} ${parsed.year} — Stage ${st.stage_number} Top 3`,
        lock_at: null,
        is_active: true,
      },
      { onConflict: 'race_id,stage_id,type' }
    )
}

    // ---- AUTO CREATE MAIN QUESTION (MVP) ----
    // Règle MVP:
    // - stage race => gc_top5 (slots 5)
    // - one-day => final_top5 (slots 5)
    // (tu as déjà une logique plus fine monuments/GT ailleurs si tu veux la réinjecter plus tard)
    const { data: stage1 } = await supabaseAdmin
      .from('stages')
      .select('start_time')
      .eq('race_id', raceId)
      .eq('stage_number', 1)
      .maybeSingle()

        const lockAt = stage1?.start_time ?? raceTimes.start_time ?? null
    const qType = isStageRace ? 'gc_top5' : 'final_top5'
    const qSlots = 5
    const qLabel = isStageRace
      ? `${raceName} ${parsed.year} — GC Top 5`
      : `${raceName} ${parsed.year} — Top 5`

        // nécessite un unique index sur (race_id, stage_id, type)

    // 1) désactiver les anciennes questions principales de la course
    await supabaseAdmin
      .from('prediction_questions')
      .update({ is_active: false })
      .eq('race_id', raceId)
      .is('stage_id', null)

    // 2) créer / mettre à jour la question principale
    await supabaseAdmin
      .from('prediction_questions')
      .upsert(
        {
          race_id: raceId,
          stage_id: null,
          type: qType,
          slots: qSlots,
          label: qLabel,
          lock_at: lockAt,
          is_active: true,
        },
        { onConflict: 'race_id,stage_id,type' }
      )

    // ---- Fetch startlist ----
    const startResp = await fetchHtml(startlistUrl)
    if (startResp.looksBlocked) {
      return NextResponse.json({ error: 'PCS blocked on startlist page.' }, { status: 500 })
    }

    const rawRiderOcc = (startResp.html.match(/rider\//g) || []).length

    const $$ = cheerio.load(startResp.html)

    // scope main/container/body and remove footer-like zones
    const scope =
      $$('main').first().length
        ? $$('main').first()
        : $$('div.container').first().length
          ? $$('div.container').first()
          : $$('body')

    scope.find('footer').remove()
    scope.find('#footer').remove()
    scope.find('.footer').remove()

    const links = scope.find('a[href*="rider/"]')
    const riderLinksFound = links.length

    // debug sample
    const firstLink = links.first()
    const sample = {
      firstHref: String(firstLink.attr('href') || ''),
      firstName: normalizeSpace(firstLink.text()),
      firstParent: normalizeSpace(firstLink.parent().text()).slice(0, 200),
      firstClosestDiv: normalizeSpace(firstLink.closest('div').text()).slice(0, 220),
    }

    const seen = new Set<string>()
    let ridersImported = 0
    let firstError: string | null = null

    const teamsToFetch = new Map<string, string>() // teamName -> teamUrl

    for (let i = 0; i < links.length; i++) {
      const a = links.eq(i)

      const pcsUrl = absPcsUrl(String(a.attr('href') || ''))
      const name = normalizeSpace(a.text())
      if (!pcsUrl || !name) continue
      if (!pcsUrl.includes('/rider/')) continue
      if (seen.has(pcsUrl)) continue
      seen.add(pcsUrl)

      // climb to card that contains "team statistics" (PCS team block)
      let card = a.parent()
      for (let k = 0; k < 12; k++) {
        const txt = normalizeSpace(card.text()).toLowerCase()
        if (txt.includes('team statistics')) break
        const p = card.parent()
        if (!p || p.length === 0) break
        card = p
      }

      const team = extractTeamFromCardText(card.text())
      const teamUrl = extractTeamUrlFromCard(card)
      if (team && teamUrl) teamsToFetch.set(team, teamUrl)

      // SAFE write rider: update if exists else insert (and keep existing team if we couldn't parse)
      const existing = await supabaseAdmin
        .from('riders')
        .select('id, team')
        .eq('pcs_url', pcsUrl)
        .maybeSingle()

      let riderId: string | null = null

      if (existing.data?.id) {
        const nextTeam = team ?? existing.data.team
        const upd = await supabaseAdmin
          .from('riders')
          .update({ name, team: nextTeam })
          .eq('id', existing.data.id)
          .select('id')
          .single()

        if (upd.error) {
          if (!firstError) firstError = upd.error.message
          continue
        }
        riderId = upd.data.id
      } else {
        const ins = await supabaseAdmin
          .from('riders')
          .insert({ pcs_url: pcsUrl, name, team })
          .select('id')
          .single()

        if (ins.error) {
          if (!firstError) firstError = ins.error.message
          continue
        }
        riderId = ins.data.id
      }

      if (!riderId) continue

      const { error: linkErr } = await supabaseAdmin
        .from('race_riders')
        .upsert({ race_id: raceId, rider_id: riderId }, { onConflict: 'race_id,rider_id' })

      if (linkErr) {
        if (!firstError) firstError = linkErr.message
        continue
      }

      ridersImported++
    }

    // ---- Fetch & store team logos (best effort) ----
    let teamsLogosStored = 0

    for (const [teamName, teamPcsUrl] of teamsToFetch.entries()) {
      try {
        const teamResp = await fetchHtml(teamPcsUrl)
        if (teamResp.looksBlocked) continue

        const logoUrl = extractTeamLogoFromTeamPage(teamResp.html)
        if (!logoUrl) continue

        await supabaseAdmin
          .from('team_logos')
          .upsert(
            {
              name: teamName,
              pcs_url: teamPcsUrl,
              logo_url: logoUrl,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'name' }
          )

        teamsLogosStored++
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      ok: true,
      race: { id: raceId, name: raceName, pcs_url: raceUrl, isStageRace },
      stagesImported: stagesToCreate.length,
      ridersImported,
      teamsLogosStored,
      debug: {
        startlistStatus: startResp.status,
        startlistTitle: startResp.title,
        riderLinksFound,
        importedUnique: seen.size,
        rawRiderOcc,
        firstError,
        sample,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}