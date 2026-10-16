/**
 * Tekst strumienia SSE (np. zapisany przez curl -N .../events) -> zdarzenia. Ten sam format,
 * ktory przegladarka dostaje od serwera, wiec nagranie odtwarza dokladnie to, co wyslalo API.
 * Wedlug specyfikacji: pole "nazwa: wartosc" (jedna spacja po dwukropku odpada), linia od ":"
 * to komentarz (heartbeat), pusta linia konczy zdarzenie, kilka linii data laczy "\n".
 */
export interface SseFrame {
  readonly id: string | null;
  readonly type: string;
  readonly data: string;
}

export function parseSse(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  let id: string | null = null;
  let type = "message";
  let data: string[] = [];

  const dispatch = () => {
    // Zdarzenie bez linii data przegladarka pomija.
    if (data.length > 0) frames.push({ id, type, data: data.join("\n") });
    id = null;
    type = "message";
    data = [];
  };

  for (const line of text.split(/\r\n|\r|\n/u)) {
    if (line === "") {
      dispatch();
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const raw = colon < 0 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "data") data.push(value);
    else if (field === "event") type = value;
    else if (field === "id") id = value;
  }
  // Ostatnie zdarzenie bez pustej linii na koncu jest niedokonczone — przegladarka by je odrzucila.
  return frames;
}
