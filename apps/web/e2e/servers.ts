/** Porty serwerow e2e: szybka proba generalna dla calej aplikacji, wolna dla sali 3D. */
export const WEB = { api: 3199, web: 4199, delayMs: 300 } as const;
// Sala 3D: WebGL liczony przez procesor (CI) rysuje klatke ok. 1,1 s i przez ten czas strona stoi. Przy odpowiedziach
// co 1,5 s dwie wypowiedzi wpadaly do jednego odswiezenia i dymek jednego mowcy nie pojawial sie wcale — stad 3 s.
export const SCENE = { api: 3198, web: 4198, delayMs: 3000 } as const;
/** Demo bez serwera: sama statyczna paczka pod podsciezka, jak na stronie portfolio. */
export const DEMO = { web: 4197, path: "/trybunal/" } as const;
