// =====================================================================
// update-store
// ---------------------------------------------------------------------
// Updates a store's name/pref/area, or changes its code. HQ only.
// A code change rewrites the Auth email and every reference to the old
// code: the store's own scope arrays, employees.store, requests.store,
// and other stores' targets/in_area/nearby arrays.
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

    const { oldCode, newCode, newName, newPref, newArea } = await req.json()
    if (!oldCode) return new Response(JSON.stringify({ error: 'missing oldCode' }), { status: 400, headers: corsHeaders })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: store } = await admin.from('stores').select('*').eq('code', oldCode).maybeSingle()
    if (!store) return new Response(JSON.stringify({ error: 'store not found' }), { status: 404, headers: corsHeaders })

    // No code change: update name/pref/area only.
    if (newCode === undefined || newCode === null || newCode === oldCode) {
      const updates: any = {}
      if (newName !== undefined && newName !== null) updates.name = newName
      if (newPref !== undefined && newPref !== null) updates.pref = newPref
      if (newArea !== undefined && newArea !== null) updates.area = newArea
      if (Object.keys(updates).length > 0) {
        const { error } = await admin.from('stores').update(updates).eq('code', oldCode)
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Code change: ensure the new code is free.
    const upperNewCode = newCode.toUpperCase()
    const { data: existing } = await admin.from('stores').select('code').eq('code', upperNewCode).maybeSingle()
    if (existing) return new Response(JSON.stringify({ error: 'new code already exists' }), { status: 400, headers: corsHeaders })

    // 1) Update the Auth email.
    if (store.auth_id) {
      const newEmail = `${upperNewCode}@store.shift.local`
      const { error: emailErr } = await admin.auth.admin.updateUserById(store.auth_id, { email: newEmail })
      if (emailErr) return new Response(JSON.stringify({ error: 'auth email update failed: ' + emailErr.message }), { status: 400, headers: corsHeaders })
    }

    // 2) Insert the new row (with the old code replaced in its own arrays).
    const replaceInArr = (arr: string[]) => (arr || []).map((c) => (c === oldCode ? upperNewCode : c))
    const { error: insertErr } = await admin.from('stores').insert({
      code: upperNewCode,
      auth_id: store.auth_id,
      name: newName !== undefined && newName !== null ? newName : store.name,
      pref: newPref !== undefined && newPref !== null ? newPref : store.pref,
      area: newArea !== undefined && newArea !== null ? newArea : store.area,
      targets: replaceInArr(store.targets),
      in_area: replaceInArr(store.in_area),
      nearby: replaceInArr(store.nearby),
      proxy: replaceInArr(store.proxy),
      // Carry over the rest of the store's settings so a code change
      // doesn't silently reset them.
      pw_changed: store.pw_changed,
      apply_scope: store.apply_scope,
      default_min_apply: store.default_min_apply,
      default_min_apply_emp: store.default_min_apply_emp,
    })
    if (insertErr) return new Response(JSON.stringify({ error: 'insert failed: ' + insertErr.message }), { status: 400, headers: corsHeaders })

    // 3) Repoint child rows.
    await admin.from('employees').update({ store: upperNewCode }).eq('store', oldCode)
    await admin.from('requests').update({ store: upperNewCode }).eq('store', oldCode)

    // 4) Rewrite the old code inside every other store's arrays.
    const { data: allStores } = await admin.from('stores').select('code, targets, in_area, nearby, proxy')
    if (allStores) {
      for (const st of allStores) {
        if (st.code === upperNewCode) continue
        let changed = false
        const updates: any = {}
        for (const col of ['targets', 'in_area', 'nearby', 'proxy'] as const) {
          const arr = (st as any)[col] || []
          if (arr.includes(oldCode)) {
            updates[col] = arr.map((c: string) => (c === oldCode ? upperNewCode : c))
            changed = true
          }
        }
        if (changed) await admin.from('stores').update(updates).eq('code', st.code)
      }
    }

    // 5) Delete the old store row.
    await admin.from('stores').delete().eq('code', oldCode)

    return new Response(JSON.stringify({ ok: true, newCode: upperNewCode }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
