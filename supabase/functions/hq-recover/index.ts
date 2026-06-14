// =====================================================================
// hq-recover
// ---------------------------------------------------------------------
// Resets the HQ (headquarters) password using a recovery code.
// This function is intentionally callable WITHOUT being logged in,
// because it handles the "I forgot the HQ password" scenario.
// Identity is verified by the recovery code instead of a session.
//
// Two kinds of codes are accepted:
//   1. The current recovery code stored in the `hq` table.
//   2. A "hidden" emergency code, configured via the HQ_HIDDEN_CODE
//      environment variable (each deployment sets its own).
//
// Required environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   HQ_HIDDEN_CODE            e.g. "1234-5678-9012" (keep it secret!)
//   HQ_DEFAULT_RECOVERY       recovery code to restore after the hidden
//                             code is used, e.g. "ABCD-EFGH-JKLM"
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
    const { recoveryCode, newPassword } = await req.json()
    if (!recoveryCode || !newPassword) {
      return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: corsHeaders })
    }
    if (newPassword.length < 8) {
      return new Response(JSON.stringify({ error: 'password too short' }), { status: 400, headers: corsHeaders })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: hqRow, error: hqErr } = await admin.from('hq').select('*').eq('id', 1).maybeSingle()
    if (hqErr || !hqRow) {
      return new Response(JSON.stringify({ error: 'hq not found' }), { status: 500, headers: corsHeaders })
    }

    const input = recoveryCode.trim().toUpperCase()
    const hiddenCode = (Deno.env.get('HQ_HIDDEN_CODE') || '').trim().toUpperCase()

    const isHidden = hiddenCode !== '' && input === hiddenCode
    const isValid = input === (hqRow.recovery || '').toUpperCase()
    if (!isHidden && !isValid) {
      return new Response(JSON.stringify({ error: 'invalid recovery code' }), { status: 403, headers: corsHeaders })
    }

    if (!hqRow.auth_id) {
      return new Response(JSON.stringify({ error: 'hq not linked to auth user' }), { status: 500, headers: corsHeaders })
    }

    // Update the Auth password.
    const { error: updErr } = await admin.auth.admin.updateUserById(hqRow.auth_id, { password: newPassword })
    if (updErr) return new Response(JSON.stringify({ error: updErr.message }), { status: 400, headers: corsHeaders })

    // Rotate the recovery code.
    let newRecovery: string
    if (isHidden) {
      // Hidden code used: restore the configured default recovery code.
      newRecovery = Deno.env.get('HQ_DEFAULT_RECOVERY') || generateRecoveryCode()
    } else {
      // Regular recovery code used: issue a fresh single-use code.
      newRecovery = generateRecoveryCode()
    }
    await admin.from('hq').update({ recovery: newRecovery }).eq('id', 1)

    return new Response(
      JSON.stringify({
        ok: true,
        // When the hidden code is used we don't reveal the restored code.
        newRecovery: isHidden ? null : newRecovery,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})

// Generates a code like "ABCD-EFGH-JKLM" (no easily confused chars).
function generateRecoveryCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += '-'
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}
