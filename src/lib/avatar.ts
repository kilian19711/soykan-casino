// Profilbilder: verkleinern (max. 256×256, JPEG ~20–40 KB), hochladen, öffentliche URL bilden.
import { supabase } from './supabase';

const SIZE = 256;

export function avatarImageUrl(seed: string | null | undefined): string | null {
  if (!seed?.startsWith('img:')) return null;
  return supabase.storage.from('avatars').getPublicUrl(seed.slice(4)).data.publicUrl;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // erst nach dem Zeichnen freigeben wäre nötig, decode() hat die Pixel aber bereits geladen
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Schneidet quadratisch mittig zu und verkleinert auf 256×256. */
export async function resizeAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Bitte wähle ein Bild aus.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Das Bild ist zu groß (max. 25 MB).');
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Bild konnte nicht verarbeitet werden.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Bild konnte nicht verarbeitet werden.');
  return blob;
}

/** Lädt das Bild hoch, setzt es als Profilbild und räumt alte Bilder des Benutzers auf. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const blob = await resizeAvatar(file);
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (error) throw new Error('Hochladen fehlgeschlagen. Bitte versuche es erneut.');
  const { data: seed, error: rpcError } = await supabase.rpc('set_my_avatar', { p_path: path });
  if (rpcError) throw new Error('Profilbild konnte nicht gespeichert werden.');
  await removeOldAvatars(userId, path);
  return String(seed);
}

export async function removeAvatar(userId: string): Promise<void> {
  const { error } = await supabase.rpc('set_my_avatar', { p_path: null });
  if (error) throw new Error('Profilbild konnte nicht entfernt werden.');
  await removeOldAvatars(userId, null);
}

async function removeOldAvatars(userId: string, keep: string | null) {
  const { data } = await supabase.storage.from('avatars').list(userId, { limit: 100 });
  const old = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
  if (old.length) await supabase.storage.from('avatars').remove(old);
}
