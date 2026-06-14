// =====================================================================
// update-employee
// ---------------------------------------------------------------------
// Updates an employee's name, or changes their code. HQ, or the manager
// of that employee's store, may call this.
// A code change rewrites the Auth email and all references in requests
// (by_emp and fills[].by).
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

    const { oldCode, newCode, newName } = await req.json()
    if (!oldCode) return new Response(JSON.stringify({ error: 'missing oldCode' }), { status: 400, headers: corsHeaders })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: emp } = await admin.from('employees').select('*').eq('code', oldCode).maybeSingle()
    if (!emp) return new Response(JSON.stringify({ error: 'employee not found' }), { status: 404, headers: corsHeaders })
    if (!hqRow && storeRow?.code !== emp.store) {
      return new Response(JSON.stringify({ error: 'forbidden: not your store' }), { status: 403, headers: corsHeaders })
    }

    // Name-only change.
    if (newCode === undefined || newCode === null || newCode === oldCode) {
      if (newName !== undefined && newName !== null) {
        const { error } = await admin.from('employees').update({ name: newName }).eq('code', oldCode)
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Code change: ensure the new code is free.
    const { data: existing } = await admin.from('employees').select('code').eq('code', newCode).maybeSingle()
    if (existing) return new Response(JSON.stringify({ error: 'new code already exists' }), { status: 400, headers: corsHeaders })

    // 1) Update the Auth email. 2) Insert the new row. 3) Repoint
    // requests. 4) Rewrite fills[].by. 5) Delete the old row.
    if (emp.auth_id) {
      const newEmail = `${newCode}@emp.shift.local`
      const { error: emailErr } = await admin.auth.admin.updateUserById(emp.auth_id, { email: newEmail })
      if (emailErr) return new Response(JSON.stringify({ error: 'auth email update failed: ' + emailErr.message }), { status: 400, headers: corsHeaders })
    }

    const { error: insertErr } = await admin.from('employees').insert({
      code: newCode,
      auth_id: emp.auth_id,
      store: emp.store,
      name: newName !== undefined && newName !== null ? newName : emp.name,
      // Carry over pw_changed so a code change doesn't force the user
      // back through the initial-password screen.
      pw_changed: emp.pw_changed,
    })
    if (insertErr) return new Response(JSON.stringify({ error: 'insert failed: ' + insertErr.message }), { status: 400, headers: corsHeaders })

    await admin.from('requests').update({ by_emp: newCode }).eq('by_emp', oldCode)

    // Rewrite the "by" field inside each request's fills array.
    const { data: allReqs } = await admin.from('requests').select('id, fills')
    if (allReqs) {
      for (const r of allReqs) {
        const fills = r.fills || []
        let changed = false
        const newFills = fills.map((f: any) => {
          if (f.by === oldCode) { changed = true; return { ...f, by: newCode } }
          return f
        })
        if (changed) await admin.from('requests').update({ fills: newFills }).eq('id', r.id)
      }
    }

    await admin.from('employees').delete().eq('code', oldCode)

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
