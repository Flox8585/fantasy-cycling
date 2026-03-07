import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '../../../lib/supabase-server'
import { supabaseAdmin } from '../../../lib/supabase-admin'

function generateUsername(email: string) {
  const base = email.split('@')[0]
  return base.replace(/[^a-zA-Z0-9_.-]/g, '')
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url)

  const code = requestUrl.searchParams.get('code')

  const supabase = await createSupabaseServerClient()

  if (code) {
    await supabase.auth.exchangeCodeForSession(code)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user?.id && user?.email) {
    const username = generateUsername(user.email)

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (!existing) {
      await supabaseAdmin.from('profiles').insert({
        id: user.id,
        email: user.email,
        username: username,
      })
    }
  }

  return NextResponse.redirect(new URL('/dashboard', requestUrl.origin))
}