// =====================================================================
// send-notification
// ---------------------------------------------------------------------
// Sends Web Push notifications to a set of targets. Each target selects
// recipients by role and code(s):
//   { role: 'store', code: 'S001' }            -> one store
//   { role: 'emp',   codes: ['100001', ...] }  -> several employees
// Subscriptions that return 404/410 (expired) are deleted automatically.
//
// Required environment variables:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_SUBJECT (e.g. "mailto:you@example.com"),
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

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

    const { targets, title, body, url } = await req.json()
    if (!targets || !Array.isArray(targets) || !title) {
      return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: corsHeaders })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    )

    // Gather subscriptions for every target.
    const subs: any[] = []
    for (const t of targets) {
      let q = admin.from('push_subscriptions').select('*').eq('user_role', t.role)
      if (t.code) q = q.eq('user_code', t.code)
      if (t.codes && Array.isArray(t.codes)) q = q.in('user_code', t.codes)
      const { data } = await q
      if (data) subs.push(...data)
    }

    // De-duplicate by endpoint.
    const unique = new Map<string, any>()
    for (const s of subs) unique.set(s.endpoint, s)

    const payload = JSON.stringify({ title, body: body || '', url: url || '/' })
    const results: any[] = []
    for (const sub of unique.values()) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        results.push({ ok: true })
      } catch (e: any) {
        results.push({ ok: false, status: e.statusCode })
        // Remove dead subscriptions.
        if (e.statusCode === 410 || e.statusCode === 404) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: results.length, results }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
