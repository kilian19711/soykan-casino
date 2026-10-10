// admin-invite-user: lädt einen Benutzer per Supabase-Einladungslink ein (oder sendet die Einladung erneut).
// Body: { email: string, username: string, display_name: string, resend?: boolean }
import { appUrl, audit, corsHeaders, handleError, HttpError, json, rateLimit, requireAdmin, serviceClient } from '../_shared/admin.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[A-Za-z0-9_.-]{2,24}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const admin = serviceClient();
    const actor = await requireAdmin(req, admin);
    await rateLimit(admin, actor, ['user_invite', 'user_invite_resend'], 30);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const username = String(body.username ?? '').trim();
    const displayName = String(body.display_name ?? '').trim();
    const resend = body.resend === true;

    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'INVALID_EMAIL');
    if (!resend) {
      if (!USERNAME_RE.test(username)) throw new HttpError(400, 'INVALID_USERNAME');
      if (displayName.length < 1 || displayName.length > 40) throw new HttpError(400, 'INVALID_DISPLAY_NAME');
      const { data: taken } = await admin.from('profiles').select('id').ilike('username', username).maybeSingle();
      if (taken) throw new HttpError(409, 'USERNAME_TAKEN');
    }

    const redirectTo = `${appUrl(req)}/einladung`;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: resend ? undefined : { username, display_name: displayName },
      redirectTo,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already') && msg.includes('registered')) throw new HttpError(409, 'USER_ALREADY_REGISTERED');
      if (msg.includes('rate')) throw new HttpError(429, 'EMAIL_RATE_LIMITED');
      console.error('invite error', error.message);
      throw new HttpError(400, 'INVITE_FAILED');
    }

    const userId = data.user?.id ?? null;
    await audit(admin, actor, resend ? 'user_invite_resend' : 'user_invite', userId, {
      username: resend ? undefined : username,
      display_name: resend ? undefined : displayName,
    });
    return json({ ok: true, user_id: userId });
  } catch (err) {
    return handleError(err);
  }
});
