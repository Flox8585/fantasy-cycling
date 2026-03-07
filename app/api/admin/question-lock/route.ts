import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '../../../../lib/supabase-server'
import { supabaseAdmin } from '../../../../lib/supabase-admin'

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

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
    const questionId = String(body?.questionId ?? '').trim()
    const locked = body?.locked
    const lockAt = body?.lockAt ?? null

    if (!questionId) {
      return NextResponse.json({ error: 'Missing questionId' }, { status: 400 })
    }

    const payload: Record<string, any> = {}

    if (typeof locked === 'boolean') {
      payload.locked = locked
    }

    if (lockAt !== undefined) {
      payload.lock_at = lockAt || null
    }

    const { data, error } = await supabaseAdmin
      .from('prediction_questions')
      .update(payload)
      .eq('id', questionId)
      .select('id, locked, lock_at')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, question: data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}