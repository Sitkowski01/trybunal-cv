import { z } from "zod";

// Zod sprawdza, czy moze kompilowac walidatory przez Function() — przy CSP bez unsafe-eval kazda proba
// to zgloszone naruszenie. Walidacja bez kompilacji wystarcza z zapasem. Import jako pierwszy w main.tsx:
// moduly domeny tworza i uzywaja schematow juz przy wczytaniu.
z.config({ jitless: true });
