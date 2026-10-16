import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { toSse } from "../test/sse.js";
import { envelopes, trial } from "../test/trials.js";
import { DEMO_CASE } from "./case.js";
import { DemoIntro, REPO_URL } from "./DemoIntro.js";
import { readRecording } from "./recording.js";
import { createReplay } from "./replay.js";

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("DemoIntro", () => {
  it("mowi, ze to nagranie bez serwera, pokazuje CV i oferte, prowadzi do repozytorium", async () => {
    const onOpen = vi.fn();
    render(<DemoIntro onOpen={onOpen} />);
    expect(screen.getByRole("heading", { name: "Demo: nagrana rozprawa" })).toBeInTheDocument();
    expect(screen.getByText(/nie ma serwera ani modelu/u)).toBeInTheDocument();
    expect(screen.getByText(DEMO_CASE.summary)).toBeInTheDocument();
    expect(screen.getByText("CV kandydatki").nextElementSibling).toHaveTextContent(DEMO_CASE.cv.split("\n")[0] ?? "");
    expect(screen.getByText("Ogłoszenie o pracę").nextElementSibling).toHaveTextContent(DEMO_CASE.offer.split("\n")[0] ?? "");
    expect(screen.getByRole("link", { name: "Własne CV: uruchom projekt lokalnie" })).toHaveAttribute("href", REPO_URL);
    await userEvent.click(screen.getByRole("button", { name: "Otwórz rozprawę" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("App w trybie demo", () => {
  it("strona startowa zamiast formularza; rozprawa z nagrania do werdyktu, bez serwera", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, sources } = createReplay(readRecording(toSse(envelopes(trial([7, 6, 5, 7, 3], [[null, null, 6, null, null]]), 1_000_000))));
    render(<App api={api} sources={sources} demo />);
    expect(screen.getByText("Demo — odtwarzanie nagranej rozprawy")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wnieś sprawę" })).toBeNull();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) }).click(screen.getByRole("button", { name: "Otwórz rozprawę" }));
    expect(window.location.search).toBe("?rozprawa=nagranie");
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Werdykt ogłoszony.");
    expect(screen.getByRole("heading", { name: "Zaprosić" })).toBeInTheDocument();
  });

  it("poza demo: formularz i bez znaczka demo", () => {
    const { api, sources } = createReplay(readRecording(toSse(envelopes(trial([5, 5, 5, 5, 5], [])))));
    render(<App api={api} sources={sources} />);
    expect(screen.getByRole("button", { name: "Wnieś sprawę" })).toBeInTheDocument();
    expect(screen.queryByText("Demo — odtwarzanie nagranej rozprawy")).toBeNull();
  });
});
