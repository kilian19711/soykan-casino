import { expect, test } from '@playwright/test';

test.describe('Öffentliche Seiten & Routenschutz', () => {
  test('Login-Seite lädt', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
    await expect(page.getByLabel('E-Mail')).toBeVisible();
  });

  test('Login validiert leere Eingaben', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByText('Bitte gib deine E-Mail-Adresse ein.')).toBeVisible();
  });

  test('falsche Zugangsdaten zeigen eine verständliche Fehlermeldung', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('niemand@example.com');
    await page.getByLabel('Passwort').fill('falschesPasswort1');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByRole('alert')).toContainText(/falsch|Versuche/);
  });

  test('geschützte Seiten leiten ohne Login zur Anmeldung', async ({ page }) => {
    for (const path of ['/', '/casino/roulette', '/wallet']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test('Adminroute ist bei direkter URL-Eingabe ohne Login nicht erreichbar', async ({ page }) => {
    await page.goto('/admin/benutzer');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Benutzerverwaltung')).toHaveCount(0);
  });

  test('ungültiger Einladungslink zeigt Hinweis', async ({ page }) => {
    await page.goto('/einladung#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.getByRole('alert')).toContainText('abgelaufen');
  });

  test('Passwort vergessen ist erreichbar', async ({ page }) => {
    await page.goto('/passwort-vergessen');
    await expect(page.getByRole('button', { name: 'Reset-Link senden' })).toBeVisible();
  });

  test('Alte Hinweisseite leitet weiter', async ({ page }) => {
    await page.goto('/rechtliches');
    await expect(page).not.toHaveURL(/rechtliches/);
  });
});

test.describe('PWA & mobiles Layout', () => {
  test('Manifest und Icons sind erreichbar', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();
    const m = await res.json();
    expect(m.short_name).toBe('Shishabar');
    for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBeTruthy();
    expect((await request.get('/sw.js')).ok()).toBeTruthy();
    expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBeTruthy();
  });

  test('kein horizontaler Überlauf auf der Login-Seite', async ({ page }) => {
    await page.goto('/login');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('Formularfelder sind groß genug für Touch (≥ 44 px)', async ({ page }) => {
    await page.goto('/login');
    const box = await page.getByRole('button', { name: 'Anmelden' }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

// Optionale Flows mit echtem Testkonto (nur wenn Zugangsdaten gesetzt sind)
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
test.describe('Angemeldete Flows', () => {
  test.skip(!email || !password, 'E2E_EMAIL/E2E_PASSWORD nicht gesetzt');
  test('Login, Dashboard und Casino-Lobby', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(email!);
    await page.getByLabel('Passwort').fill(password!);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByText('Kontostand').first()).toBeVisible();
    await page.goto('/casino');
    await expect(page.getByRole('heading', { name: 'Casino-Lobby' })).toBeVisible();
    await expect(page.getByText('In Entwicklung').first()).toBeVisible();
  });
});
