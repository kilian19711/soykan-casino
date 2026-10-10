// admin-send-password-reset: löst für einen Benutzer eine Passwort-Reset-E-Mail aus.
// Body: { user_id: string }
import { appUrl, audit, corsHeaders, handleError, HttpError, json, rateLimit, requireAdmin, serviceClient } from '../_shared/admin.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const admin = serviceClient();
    const actor = await requireAdmin(req, admin);
    await rateLimit(admin, actor, ['password_reset_sent'], 30);

    const body = await req.json().catch(() => ({}));
    const userId = String(body.user_id ?? '');
    if (!UUID_RE.test(userId)) throw new HttpError(400, 'INVALID_USER');

    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user?.email) throw new HttpError(404, 'USER_NOT_FOUND');

    const { error: resetError } = await admin.auth.resetPasswordForEmail(data.user.email, {
      redirectTo: `${appUrl(req)}/passwort-zuruecksetzen`,
    });
    if (resetError) {
      console.error('reset error', resetError.message);
      throw new HttpError(resetError.message.toLowerCase().includes('rate') ? 429 : 400, 'RESET_FAILED');
    }

    await audit(admin, actor, 'password_reset_sent', userId, {});
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
});
