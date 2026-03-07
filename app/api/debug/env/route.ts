import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '../../../../lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  return NextResponse.json({
    userEmail: user?.email ?? null,
    adminEmails: process.env.ADMIN_EMAILS ?? null,
    hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  })
}