// =====================================================================
// create-store
// ---------------------------------------------------------------------
// Creates a new store account. HQ only.
// Creates an Auth user (virtual email) and a matching `stores` row.
//
// Required environment variables:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders })

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders })

    // HQ only.
    const { data: hqRow } = await anonClient.from('hq').select('id').eq('auth_id', user.id).maybeSingle()
    if (!hqRow) return new Response(JSON.stringify({ error: 'forbidden: hq only' }), { status: 403, headers: corsHeaders })

    const { code, name, pw } = await req.json()
    if (!code || !pw) return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: corsHeaders })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const upper = code.toUpperCase()
    const email = `${upper}@store.shift.local`

    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: pw,
      email_confirm: true,
    })
    if (createErr) return new Response(JSON.stringify({ error: createErr.message }), { status: 400, headers: corsHeaders })

    const { error: insertErr } = await admin.from('stores').insert({
      code: upper,
      auth_id: newUser.user.id,
      name: name || '',
      targets: [upper],
      nearby: [upper],
      in_area: [upper],
      pw_changed: false,
    })
    if (insertErr) {
      // Roll back the Auth user if the row insert fails.
      await admin.auth.admin.deleteUser(newUser.user.id)
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: true, code: upper }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
