#!/bin/bash
# Deploy OFFUSCATO del Palio 3D su Vercel (personale simo18a).
# Pubblica game-3d.js MINIFICATO/illeggibile, poi RIPRISTINA il sorgente leggibile.
# Il sorgente leggibile NON deve mai finire online. Uso: bash deploy-offuscato.sh
set -e
cd "$(dirname "$0")"
BK="/tmp/g3.readable.$$.js"

echo "▸ backup sorgente leggibile…"
cp game-3d.js "$BK"

# Ripristina SEMPRE il sorgente, anche se qualcosa fallisce.
trap 'cp "$BK" game-3d.js; echo "▸ sorgente leggibile ripristinato"; rm -f "$BK"' EXIT

echo "▸ offusco (terser)…"
npx --yes terser game-3d.js --module --compress --mangle -o game-3d.js
node --check game-3d.js

echo "▸ deploy…"
DEP=$(npx vercel --prod --yes 2>&1 | grep -oE "https://fianca-la-mossa-[a-z0-9]+-simo18a\.vercel\.app" | head -1)
echo "  deployment: $DEP"
npx vercel alias set "$DEP" fianca-la-mossa.vercel.app 2>&1 | tail -1
npx vercel alias set "$DEP" fianca-la-mossa-mauve.vercel.app 2>&1 | tail -1

echo "▸ verifica online (0 nomi leggibili = ok):"
curl -s "https://fianca-la-mossa.vercel.app/game-3d.js" | grep -c "function campaignAccordiScreen\|GAME_PASSWORD" || true
echo "✔ fatto. game-3d.js locale torna leggibile fra un istante (trap EXIT)."
