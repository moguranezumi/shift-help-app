// =====================================================================
// cleanup-old-requests
// ---------------------------------------------------------------------
// Deletes help requests whose end date is more than 30 days in the
// past. Intended to be called once a day by a scheduled job
// (see .github/workflows/keepalive.yml).
//
// Authenticated by a shared secret in the "x-cron-secret" header,
// compared against the CRON_SECRET environment variable. (This
// function is NOT protected by user login.)
//
// Required environment variables:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const cronSecret = req.headers.get('x-cron-secret')
    const expectedSecret = Deno.env.get('CRON_SECRET')
    if (!expectedSecret || cronSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Cutoff = 30 days ago (YYYY-MM-DD).
    const threshold = new Date(Date.now() - 30 * 86400 * 1000)
    const thresholdStr = threshold.toISOString().substring(0, 10)

    const { error, count } = await admin
      .from('requests')
      .delete({ count: 'exact' })
      .lt('date_end', thresholdStr)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    }

    // Record the cleanup in the audit log.
    await admin.from('audit_logs').insert({
      actor_role: 'system',
      actor_code: 'cron',
      action: 'auto_cleanup_requests',
      detail: { threshold: thresholdStr, deleted: count },
    })

    return new Response(JSON.stringify({ ok: true, deleted: count, threshold: thresholdStr }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
