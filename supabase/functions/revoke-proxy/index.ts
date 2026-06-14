// =====================================================================
// revoke-proxy
// ---------------------------------------------------------------------
// Lets a store that has been GRANTED proxy rights remove itself from
// the granting store's `proxy` list. (The grantee revokes its own
// received proxy.) Runs with service role so it can edit another
// store's row.
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

    // Identify the calling store (the grantee).
    const { data: storeRow } = await anonClient.from('stores').select('code').eq('auth_id', user.id).maybeSingle()
    if (!storeRow) return new Response(JSON.stringify({ error: 'forbidden: store only' }), { status: 403, headers: corsHeaders })

    const { grantorCode } = await req.json()
    if (!grantorCode) return new Response(JSON.stringify({ error: 'missing grantorCode' }), { status: 400, headers: corsHeaders })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Remove the grantee's code from the grantor's proxy array.
    const { data: grantor } = await admin.from('stores').select('proxy').eq('code', grantorCode).maybeSingle()
    if (!grantor) return new Response(JSON.stringify({ error: 'grantor not found' }), { status: 404, headers: corsHeaders })

    const newProxy = (grantor.proxy || []).filter((c: string) => c !== storeRow.code)
    await admin.from('stores').update({ proxy: newProxy }).eq('code', grantorCode)

    return new Response(JSON.stringify({ ok: true, granteeCode: storeRow.code }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
