#!/usr/bin/env bash
# Test dymny docker compose: cala aplikacja wstaje, rozprawa przez nginx dochodzi do werdyktu,
# a po restarcie API dziennik z Postgresa nadal sie odszyfrowuje (klucz z wolumenu).
set -euo pipefail
cd "$(dirname "$0")/.."
web="http://localhost:${WEB_PORT:-8080}"

# Odpowiedz najpierw do zmiennej: grep -q konczy sie przy pierwszym trafieniu, a przy pipefail
# przerwany curl (SIGPIPE) wywrocilby test, choc wszystko dziala.
verdict_in_stream() {
  local events
  events=$(curl -fsS -N --max-time "$2" "$web/api/trials/$1/events")
  grep -q "event: VerdictAnnounced" <<<"$events"
}

wait_for() {
  for _ in $(seq 1 60); do
    if curl -fsS "$1" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "Nie odpowiada: $1" >&2
  docker compose logs
  return 1
}

# Proba generalna wymuszona: docker compose czyta .env, a tam moze byc klucz i TRYBUNAL_REHEARSAL=0 —
# test nie moze wydawac pieniedzy na prawdziwy model. Zmienne z powloki maja pierwszenstwo przed .env.
# Przerwa 300 ms: strumien otwiera sie w trakcie rozprawy, wiec zdarzenia ida na zywo (miedzy instancjami).
TRYBUNAL_REHEARSAL=1 ANTHROPIC_API_KEY_FILE= TRYBUNAL_REHEARSAL_DELAY_MS=300 docker compose up --build --detach
wait_for "$web/api/health"
page=$(curl -fsS "$web/")
grep -q '<div id="root">' <<<"$page"
# Naglowki bezpieczenstwa na stronie i na plikach z /assets/ (add_header w location kasuje odziedziczone).
asset=$(grep -oE '/assets/[^"]+.js' <<<"$page" | head -n 1)
for url in "$web/" "$web$asset"; do
  headers=$(curl -fsSI "$url")
  grep -qi "^content-security-policy: default-src 'self'" <<<"$headers"
  grep -qi "^referrer-policy: no-referrer" <<<"$headers"
  grep -qi "^x-content-type-options: nosniff" <<<"$headers"
done

filed=$(curl -fsS -X POST "$web/api/trials" -F "cvText=<examples/cv-anna-nowak.md" -F "jobOffer=<examples/oferta-junior-backend.md" -F debateRounds=1)
id=$(echo "$filed" | sed -E 's/.*"trialId":"([^"]+)".*/\1/')
echo "Rozprawa $id"
verdict_in_stream "$id" 60

# Id rozprawy to klucz do jej odczytu i usuniecia — nie moze lezec w logach nginx ani API.
if docker compose logs web api 2>&1 | grep -qF "$id"; then
  echo "Id rozprawy trafilo do logow" >&2
  exit 1
fi

docker compose restart api
wait_for "$web/api/health"
verdict_in_stream "$id" 10
echo "OK: werdykt przez nginx i po restarcie API"
