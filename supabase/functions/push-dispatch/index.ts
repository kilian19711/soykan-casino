// push-dispatch: versendet neue Benachrichtigungen als Web-Push an alle Geräte der Empfänger.
// Wird minütlich per pg_cron (public.shb_dispatch_push) mit dem Header x-dispatch-secret aufgerufen.
// VAPID-Schlüssel und Secret liegen in private.config (nicht im Repository).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const secret = req.headers.get('x-dispatch-secret') ?? '';
  if (!secret) return new Response('forbidden', { status: 403 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc('shb_push_batch', { p_secret: secret });
  if (error) return new Response('forbidden', { status: 403 });

  const batch = data as {
    items: { id: string; title: string; message: string; type: string; subs: { endpoint: string; p256dh: string; auth: string }[] }[];
    vapid_public: string | null;
    vapid_private: string | null;
    vapid_subject: string;
  };
  if (!batch.vapid_public || !batch.vapid_private) return Response.json({ sent: 0, reason: 'no_vapid' });
  webpush.setVapidDetails(batch.vapid_subject, batch.vapid_public, batch.vapid_private);

  const gone: string[] = [];
  let sent = 0;
  for (const item of batch.items) {
    const payload = JSON.stringify({ title: item.title, body: item.message, tag: item.type, url: '/' });
    for (const s of item.subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.endpoint);
      }
    }
  }
  if (gone.length) await admin.rpc('shb_push_gone', { p_secret: secret, p_endpoints: gone });
  return Response.json({ sent, removed: gone.length });
});
