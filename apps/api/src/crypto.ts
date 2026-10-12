import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Szyfrowanie dziennika (RODO). Kazda rozprawa ma wlasny klucz danych; w bazie lezy on zaszyfrowany
 * kluczem glownym z konfiguracji. Usuniecie klucza rozprawy = "crypto-shredding": tresc CV, ocen
 * i cytatow staje sie nie do odczytania, a metadane (czas, typ zdarzenia, koszt) zostaja do statystyk.
 * AES-256-GCM: bez klucza nie da sie ani odczytac, ani niepostrzezenie zmienic tresci.
 */
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class DecryptionError extends Error {
  override readonly name = "DecryptionError";
}

export function newKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** Klucz glowny z konfiguracji: 32 bajty w base64 (np. `openssl rand -base64 32`). */
export function parseMasterKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`Klucz glowny musi miec ${String(KEY_BYTES)} bajty w base64, ma ${String(key.length)}`);
  }
  return key;
}

/**
 * Szyfruje dane; context (AAD) wiaze szyfrogram z miejscem, np. "rozprawa:numer zdarzenia" —
 * zdarzenia nie da sie przeniesc do innej rozprawy ani zamienic kolejnoscia, bo odszyfrowanie zawiedzie.
 * Wynik: iv | tag | szyfrogram.
 */
export function seal(key: Buffer, plaintext: Buffer, context: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function open(key: Buffer, sealed: Buffer, context: string): Buffer {
  if (sealed.length < IV_BYTES + TAG_BYTES) {
    throw new DecryptionError("Szyfrogram za krotki");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, sealed.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  } catch {
    // Zly klucz, zmieniona tresc albo inny kontekst — z zewnatrz nie rozrozniamy, dlaczego.
    throw new DecryptionError("Nie mozna odszyfrowac: zly klucz albo zmieniona tresc");
  }
}
