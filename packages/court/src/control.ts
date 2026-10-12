/** Mechanika przebiegu rozprawy, ktora nie zalezy od tego, co mowia krytycy. */

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Rownolegle zadania: jesli jedno zawiedzie, pozostale sa anulowane, a blad wychodzi dopiero,
 * gdy wszystkie sie zakoncza — zadne nie dopisze zdarzenia po przerwaniu rozprawy.
 * Anulowanie z zewnatrz (outer) tez dociera do kazdego zadania.
 */
export async function allOrNothing<T>(
  items: readonly T[],
  run: (item: T, signal: AbortSignal) => Promise<void>,
  outer?: AbortSignal,
): Promise<void> {
  const local = new AbortController();
  const signal = outer === undefined ? local.signal : AbortSignal.any([outer, local.signal]);
  // Pierwszy blad w czasie, nie w kolejnosci zadan: pozostale padna juz tylko od anulowania.
  let cause: { readonly error: unknown } | undefined;
  await Promise.allSettled(
    items.map((item) =>
      run(item, signal).catch((error: unknown) => {
        cause ??= { error };
        local.abort();
        throw error;
      }),
    ),
  );
  if (cause !== undefined) {
    throw cause.error;
  }
}

/** Zdarzenie TrialAborted ma limit 500 znakow. */
export const MAX_REASON = 500;

/** Powod przerwania do zdarzenia: anulowanie z zewnatrz ma pierwszenstwo przed bledem, ktory wywolalo. */
export function abortReason(error: unknown, signal?: AbortSignal): string {
  const reason = signal?.aborted === true ? "Rozprawa anulowana" : error instanceof Error ? error.message : String(error);
  return reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON - 3)}...` : reason;
}
