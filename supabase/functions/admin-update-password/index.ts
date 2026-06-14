// =====================================================================
// admin-update-password
// ---------------------------------------------------------------------
// Resets a store's or employee's password.
//   - Store reset: HQ only.
//   - Employee reset: HQ, or the manager of that employee's store.
// Also sets pw_changed = false so the user is forced to change the
// password on next login.
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

    const { targetType, targetCode, newPassword } = await req.json()
    if (!targetType || !targetCode || !newPassword) {
      return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: corsHeaders })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let targetAuthId: string | null = null

    if (targetType === 'store') {
      if (!hqRow) return new Response(JSON.stringify({ error: 'forbidden: hq only' }), { status: 403, headers: corsHeaders })
      const { data } = await admin.from('stores').select('auth_id').eq('code', targetCode).maybeSingle()
      targetAuthId = data?.auth_id || null
      await admin.from('stores').update({ pw_changed: false }).eq('code', targetCode)
    } else if (targetType === 'employee') {
      const { data: emp } = await admin.from('employees').select('auth_id, store').eq('code', targetCode).maybeSingle()
      if (!emp) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: corsHeaders })
      if (!hqRow && storeRow?.code !== emp.store) {
        return new Response(JSON.stringify({ error: 'forbidden: not your store' }), { status: 403, headers: corsHeaders })
      }
      targetAuthId = emp.auth_id
      await admin.from('employees').update({ pw_changed: false }).eq('code', targetCode)
    } else {
      return new Response(JSON.stringify({ error: 'invalid targetType' }), { status: 400, headers: corsHeaders })
    }

    if (!targetAuthId) return new Response(JSON.stringify({ error: 'target not linked to auth' }), { status: 400, headers: corsHeaders })

    const { error } = await admin.auth.admin.updateUserById(targetAuthId, { password: newPassword })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
