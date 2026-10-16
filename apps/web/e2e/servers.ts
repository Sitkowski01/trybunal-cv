/** Porty serwerow e2e: szybka proba generalna dla calej aplikacji, wolna dla sali 3D. */
export const WEB = { api: 3199, web: 4199, delayMs: 300 } as const;
export const SCENE = { api: 3198, web: 4198, delayMs: 1500 } as const;
/** Demo bez serwera: sama statyczna paczka pod podsciezka, jak na stronie portfolio. */
export const DEMO = { web: 4197, path: "/trybunal/" } as const;
