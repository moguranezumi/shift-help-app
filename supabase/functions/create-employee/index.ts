// =====================================================================
// create-employee
// ---------------------------------------------------------------------
// Creates a new employee account. HQ, or the store manager of the
// target store, may call this.
// Creates an Auth user (virtual email) and a matching `employees` row.
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

    const { data: hqRow } = await anonClient.from('hq').select('id').eq('auth_id', user.id).maybeSingle()
    const { data: storeRow } = await anonClient.from('stores').select('code').eq('auth_id', user.id).maybeSingle()
    if (!hqRow && !storeRow) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: corsHeaders })

    const { code, name, pw, store } = await req.json()
    if (!code || !pw || !store) return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: corsHeaders })

    // A store manager may only add employees to their own store.
    if (storeRow && !hqRow && storeRow.code !== store) {
      return new Response(JSON.stringify({ error: 'forbidden: not your store' }), { status: 403, headers: corsHeaders })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const email = `${code}@emp.shift.local`
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: pw,
      email_confirm: true,
    })
    if (createErr) return new Response(JSON.stringify({ error: createErr.message }), { status: 400, headers: corsHeaders })

    const { error: insertErr } = await admin.from('employees').insert({
      code,
      auth_id: newUser.user.id,
      store,
      name: name || '',
      pw_changed: false,
    })
    if (insertErr) {
      await admin.auth.admin.deleteUser(newUser.user.id)
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: true, code }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
