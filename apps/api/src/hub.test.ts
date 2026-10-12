import { describe, expect, it } from "vitest";
import { TrialHub } from "./hub.js";
import type { EventEnvelope } from "./journal.js";

const envelope = (trialId: string, seq: number): EventEnvelope => ({
  trialId, seq, occurredAt: "2026-10-12T10:00:00.000Z", schemaVersion: 1, event: { type: "TrialAborted", reason: "x" }, calls: [],
});

describe("TrialHub", () => {
  it("dostarcza zdarzenie tylko sluchaczom tej rozprawy", () => {
    const hub = new TrialHub();
    const a: number[] = [];
    const b: number[] = [];
    hub.subscribe("t-1", (e) => a.push(e.seq));
    hub.subscribe("t-2", (e) => b.push(e.seq));
    hub.publish(envelope("t-1", 1));
    hub.publish(envelope("t-3", 9));
    expect([a, b]).toEqual([[1], []]);
  });

  it("wypisanie jednego sluchacza nie rusza drugiego; ostatni sprzata rozprawe", () => {
    const hub = new TrialHub();
    const heard: string[] = [];
    const first = hub.subscribe("t", () => heard.push("1"));
    const second = hub.subscribe("t", () => heard.push("2"));
    first();
    hub.publish(envelope("t", 1));
    expect([heard, hub.listenerCount("t")]).toEqual([["2"], 1]);
    second();
    expect(hub.listenerCount("t")).toBe(0);
    // Ostatni wypisany sprzata wpis rozprawy — dlugo dzialajacy serwer nie trzyma pustych zbiorow.
    expect(hub.activeTrials).toBe(0);
  });

  it("sluchacz wypisujacy sie w trakcie rozglaszania nie gubi pozostalych", () => {
    const hub = new TrialHub();
    const heard: string[] = [];
    const off = hub.subscribe("t", () => { heard.push("1"); off(); });
    hub.subscribe("t", () => heard.push("2"));
    hub.publish(envelope("t", 1));
    expect(heard).toEqual(["1", "2"]);
  });
});

describe("TrialHub — bledy i koniec", () => {
  it("wyjatek sluchacza trafia do onListenerError, pozostali dostaja zdarzenie", () => {
    const errors: unknown[] = [];
    const hub = new TrialHub((e) => errors.push(e));
    const heard: number[] = [];
    hub.subscribe("t", () => { throw new Error("zerwany strumien"); });
    hub.subscribe("t", (e) => heard.push(e.seq));
    hub.publish(envelope("t", 1));
    expect([errors, heard]).toEqual([[new Error("zerwany strumien")], [1]]);
  });

  it("stop powiadamia sluchaczy tej rozprawy; bez onStop nic sie nie dzieje", () => {
    const hub = new TrialHub();
    const stopped: string[] = [];
    hub.subscribe("t", () => undefined, () => stopped.push("t"));
    hub.subscribe("t", () => undefined);
    hub.subscribe("inna", () => undefined, () => stopped.push("inna"));
    hub.stop("t");
    expect(stopped).toEqual(["t"]);
  });

  it("domyslnie bledy sluchaczy sa ignorowane, nie wychodza do rozprawy", () => {
    const hub = new TrialHub();
    hub.subscribe("t", () => { throw new Error("x"); }, () => { throw new Error("y"); });
    expect(() => { hub.publish(envelope("t", 1)); hub.stop("t"); }).not.toThrow();
  });
});
