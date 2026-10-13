import { useEffect, useReducer } from "react";
import { type EventSourceFactory, openTrialStream } from "../api/stream.js";
import { apply, type Court, emptyCourt, ended } from "./court.js";
import type { Envelope } from "./envelope.js";

export interface CourtSession {
  readonly court: Court;
  /** Komunikat dla uzytkownika, gdy z polaczeniem cos nie tak; null — wszystko w porzadku. */
  readonly trouble: string | null;
}

type Action =
  | { readonly type: "open" }
  | { readonly type: "envelope"; readonly envelope: Envelope }
  | { readonly type: "end"; readonly reason: "finished" | "interrupted" }
  | { readonly type: "trouble"; readonly kind: "lost" | "reconnecting" | "bad-data"; readonly message: string };

export function reduce(session: CourtSession, action: Action): CourtSession {
  switch (action.type) {
    case "open":
      return { ...session, trouble: null };
    case "envelope":
      return { court: apply(session.court, action.envelope), trouble: null };
    case "end":
      return { ...session, court: ended(session.court) };
    case "trouble":
      // Wznawianie to stan przejsciowy; utrata i zle dane koncza sledzenie rozprawy.
      return {
        court: action.kind === "reconnecting" ? session.court : { ...session.court, status: "lost" },
        trouble: action.message,
      };
  }
}

/** Sala rozpraw na zywo: strumien zdarzen zlozony w stan; zamkniecie strumienia przy odmontowaniu. */
export function useCourt(eventsUrl: string, factory: EventSourceFactory): CourtSession {
  const [session, dispatch] = useReducer(reduce, { court: emptyCourt, trouble: null });
  useEffect(
    () =>
      openTrialStream(
        eventsUrl,
        {
          onOpen: () => {
            dispatch({ type: "open" });
          },
          onEnvelope: (envelope) => {
            dispatch({ type: "envelope", envelope });
          },
          onEnd: (reason) => {
            dispatch({ type: "end", reason });
          },
          onTrouble: (kind, message) => {
            dispatch({ type: "trouble", kind, message });
          },
        },
        factory,
      ),
    [eventsUrl, factory],
  );
  return session;
}
