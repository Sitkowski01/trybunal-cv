import { describe, expect, it } from "vitest";
import { LocalBus } from "./bus.js";
import { TrialHub } from "./hub.js";
import type { EventEnvelope } from "./journal.js";

const envelope = { trialId: "t-1", seq: 1 } as EventEnvelope;

describe("LocalBus", () => {
  it("zdarzenie i koniec trafiaja do strumieni tej instancji; anulowanie do zgloszonej obslugi", () => {
    const hub = new TrialHub();
    const bus = new LocalBus(hub);
    const heard: string[] = [];
    hub.subscribe(
      "t-1",
      (e) => heard.push(`event:${String(e.seq)}`),
      () => heard.push("stop"),
    );
    bus.published(envelope);
    bus.stopped("t-1");
    // Przed zgloszeniem obslugi anulowanie nic nie robi.
    bus.cancelRequested("t-1");
    bus.onCancel((trialId) => heard.push(`cancel:${trialId}`));
    bus.cancelRequested("t-1");
    expect(heard).toEqual(["event:1", "stop", "cancel:t-1"]);
  });
});
