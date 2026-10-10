// Projektweite Prüfungen: PWA-Manifest, keine Secrets im Client, keine Echtgeld-Funktionen, Migrationen.
/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('PWA-Manifest', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  it('enthält Name, Kurzname, Farben und Standalone-Modus', () => {
    expect(manifest.name).toBe('Shishabar Online Casino');
    expect(manifest.short_name).toBe('Shishabar');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#0d0f14');
    expect(manifest.theme_color).toBe('#0d0f14');
    expect(manifest.start_url).toBe('/');
  });
  it('enthält normales und maskierbares Icon in 512 px', () => {
    expect(manifest.icons.some((i: { sizes: string; purpose: string }) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
  });
  it('index.html ist iPhone-tauglich (viewport-fit=cover, Apple-Meta-Tags)', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('manifest.webmanifest');
  });
});

describe('Sicherheit im Client-Code', () => {
  const files = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'));
  const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  it('verwendet niemals den Service-Role-Key im Frontend', () => {
    expect(source).not.toMatch(/service_role|SERVICE_ROLE/);
    expect(readFileSync(join(root, '.env.example'), 'utf8')).not.toMatch(/SERVICE_ROLE/);
  });
  it('schreibt niemals direkt in Wallets oder Ledger', () => {
    expect(source).not.toMatch(/from\('wallets'\)\s*\.(insert|update|upsert|delete)/);
    expect(source).not.toMatch(/from\('credit_ledger'\)\s*\.(insert|update|upsert|delete)/);
  });
  it('enthält keine Zahlungs-/Einzahlungsfunktionen', () => {
    expect(source).not.toMatch(/stripe|paypal|checkout\.session|einzahlen\(/i);
  });
  it('rendert keine Benutzereingaben als HTML', () => {
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('Supabase-Migrationen', () => {
  const dir = join(root, 'supabase', 'migrations');
  const sql = readdirSync(dir)
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
  it('aktivieren RLS für alle Tabellen', () => {
    const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThanOrEqual(17);
    for (const t of tables) expect(sql).toContain(`alter table public.${t} enable row level security`);
  });
  it('setzen search_path für alle SECURITY-DEFINER-Funktionen', () => {
    const defs = sql.split(/create or replace function/).slice(1);
    for (const d of defs) {
      const header = d.slice(0, d.indexOf('$$'));
      if (/security definer/.test(header)) expect(header).toMatch(/set search_path = ''/);
    }
  });
  it('erzwingen eindeutige Bonusabholung, Idempotenz und Wochenabschluss', () => {
    expect(sql).toMatch(/unique \(user_id, week_key\)/);
    expect(sql).toMatch(/idempotency_key text unique not null/);
    expect(sql).toMatch(/week_key text unique not null/);
    expect(sql).toMatch(/balance bigint not null default 0 check \(balance >= 0\)/);
  });
});
