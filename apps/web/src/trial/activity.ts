import { type Court, phaseOf } from "./court.js";
import { nextUp, type Seat, speaker } from "./seats.js";

/** Co robi krytyk teraz — scena i karty pokazuja to samo. */
export type Activity = "thinking" | "assessed" | "speaking" | "preparing" | "listening" | "idle";

export function activity(court: Court, seat: Seat): Activity {
  if (court.status !== "live") return seat.assessment === null ? "idle" : "assessed";
  switch (phaseOf(court)) {
    case "assessing":
      return seat.assessment === null ? "thinking" : "assessed";
    case "debate":
      return speaker(court) === seat.criticId ? "speaking" : nextUp(court) === seat.criticId ? "preparing" : "listening";
    default:
      return "assessed";
  }
}
