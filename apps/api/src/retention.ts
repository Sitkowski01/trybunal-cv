/** Jak czesto sprzatac — retencja liczona w dniach, wiec co godzine wystarczy. */
export const RETENTION_EVERY_MS = 60 * 60_000;

export interface RetentionOptions {
  /** Usuwa klucze rozpraw starszych niz podana liczba dni; zwraca, ile usunieto (Journal.expireOlderThan). */
  readonly expire: (days: number) => Promise<number>;
  readonly days: number;
  readonly onExpired?: (count: number) => void;
  readonly onError?: (error: unknown) => void;
  readonly everyMs?: number;
}

/**
 * Retencja kluczy rozpraw: po `days` dniach klucz znika jak przy „Zapomnij rozprawe” — tresc
 * zdarzen staje sie nieczytelna, a koszty zostaja do statystyk. Pierwsze sprzatanie od razu
 * (serwer mogl stac wylaczony), potem cyklicznie; blad jednego przebiegu nie zatrzymuje kolejnych.
 * Zwraca funkcje zatrzymujaca (zamykanie serwera).
 */
export function startRetention(options: RetentionOptions): () => void {
  const run = () => {
    options.expire(options.days).then(
      (count) => {
        if (count > 0) options.onExpired?.(count);
      },
      (error: unknown) => options.onError?.(error),
    );
  };
  run();
  const timer = setInterval(run, options.everyMs ?? RETENTION_EVERY_MS);
  // Sprzatanie nie trzyma procesu przy zyciu.
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
