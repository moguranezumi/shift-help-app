// =====================================================================
// delete-user
// ---------------------------------------------------------------------
// Deletes a store or employee, including its Auth user.
//   - Store delete: HQ only (also deletes all of the store's employees).
//   - Employee delete: HQ, or the manager of that employee's store.
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

    const { targetType, targetCode } = await req.json()
    if (!targetType || !targetCode) {
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
      // Delete the Auth users of all employees of this store.
      const { data: emps } = await admin.from('employees').select('auth_id').eq('store', targetCode)
      if (emps) for (const e of emps) if (e.auth_id) await admin.auth.admin.deleteUser(e.auth_id)
      // Deleting the store row cascades to related rows.
      await admin.from('stores').delete().eq('code', targetCode)
    } else if (targetType === 'employee') {
      const { data: emp } = await admin.from('employees').select('auth_id, store').eq('code', targetCode).maybeSingle()
      if (!emp) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: corsHeaders })
      if (!hqRow && storeRow?.code !== emp.store) {
        return new Response(JSON.stringify({ error: 'forbidden: not your store' }), { status: 403, headers: corsHeaders })
      }
      targetAuthId = emp.auth_id
      await admin.from('employees').delete().eq('code', targetCode)
    } else {
      return new Response(JSON.stringify({ error: 'invalid targetType' }), { status: 400, headers: corsHeaders })
    }

    if (targetAuthId) await admin.auth.admin.deleteUser(targetAuthId)

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
