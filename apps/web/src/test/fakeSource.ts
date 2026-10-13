import { CLOSED, type EventSourceLike } from "../api/stream.js";

/** Atrapa EventSource: test sam wysyla zdarzenia i zmienia stan polaczenia. */
export class FakeSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = CLOSED;
  }
  emit(type: string, data = "") {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
  }
  types() {
    return [...this.listeners.keys()];
  }
}
