// Gemeinsame Hilfen für Admin-Edge-Functions.
// Der Service-Role-Key wird ausschließlich hier (serverseitig) aus den Function-Secrets gelesen.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SERVER_MISCONFIGURED');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Prüft das JWT des Aufrufers und stellt sicher, dass er der aktive Admin ist. */
export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<string> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'NOT_AUTHENTICATED');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'NOT_AUTHENTICATED');
  const { data: profile } = await admin
    .from('profiles')
    .select('role, status')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'admin' || profile.status !== 'active') {
    throw new HttpError(403, 'FORBIDDEN');
  }
  return data.user.id;
}

/** Einfaches Rate-Limit über das Audit-Log: max. `max` Aktionen pro Stunde. */
export async function rateLimit(admin: SupabaseClient, actor: string, actions: string[], max: number) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', actor)
    .in('action', actions)
    .gte('created_at', since);
  if ((count ?? 0) >= max) throw new HttpError(429, 'RATE_LIMITED');
}

export async function audit(admin: SupabaseClient, actor: string, action: string, target: string | null, metadata: Record<string, unknown>) {
  await admin.rpc('shb_service_audit', { p_actor: actor, p_action: action, p_target: target, p_metadata: metadata });
}

export function appUrl(req: Request): string {
  const configured = Deno.env.get('APP_URL');
  const origin = req.headers.get('origin');
  return (configured || origin || '').replace(/\/$/, '');
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handleError(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  console.error(err);
  return json({ error: 'INTERNAL_ERROR' }, 500);
}
