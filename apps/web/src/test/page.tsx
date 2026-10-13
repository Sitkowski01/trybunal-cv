import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { TrialApi } from "../api/client.js";
import { TrialPage } from "../trial/TrialPage.js";
import { fakeSources } from "./sources.js";
import { envelopes, trial } from "./trials.js";

/** Sala z atrapa API i strumienia — wspolne dla testow strony rozprawy. */
export const fakeApi = (overrides: Partial<TrialApi> = {}): TrialApi => ({
  file: vi.fn(),
  cancel: vi.fn(() => Promise.resolve()),
  forget: vi.fn(() => Promise.resolve()),
  eventsUrl: (id) => `/api/trials/${id}/events`,
  ...overrides,
});

export const full = envelopes(
  trial([7, 6, 5, 7, 3], [[null, null, 6, null, null]], false, {
    techLead: { concerns: [{ quote: "Pisalem testy", issue: "Jakie testy?", severity: "low" }, { quote: "Spring Boot", issue: "Bez projektu", severity: "high" }] },
    hiringManager: { rewrites: [{ original: "Pisalem testy.", proposed: "Pisalem testy, pokrycie 90%.", reason: "Liczby" }], strengths: ["Java"] },
  }),
  2_500_000,
);

export function setupPage(api = fakeApi(), anonymized: string | null = null) {
  const sources = fakeSources();
  const onClose = vi.fn();
  const { unmount } = render(<TrialPage trialId="t-1" api={api} sources={sources.factory} anonymized={anonymized} onClose={onClose} />);
  return { ...sources, api, onClose, unmount, user: userEvent.setup({ delay: null }) };
}

export const status = () => screen.getByRole("status");
