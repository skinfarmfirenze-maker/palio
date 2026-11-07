// ══════════════════════════════════════════════════════════════════════════════
// AREA CREATOR — /creator si apre solo con la password
// ──────────────────────────────────────────────────────────────────────────────
// Routing Middleware di Vercel: gira PRIMA della cache e solo sui percorsi del
// `matcher`, quindi il gioco non lo vede mai.
//
// La password NON sta nel codice (il repo è pubblico): sta nella variabile
// d'ambiente CREATOR_PASSWORD del progetto Vercel. Se manca, /creator resta
// chiuso a tutti. Il cookie di accesso è un HMAC della password: senza
// conoscerla non si può fabbricare, e cambiando la password i vecchi accessi
// scadono da soli.
// ══════════════════════════════════════════════════════════════════════════════
export const config = { matcher: ["/creator", "/creator/:path*"] };

const COOKIE = "creator_ok";
const DURATA = 60 * 60 * 24 * 30;   // 30 giorni

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (t) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
async function gettone(password) {
  const chiave = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", chiave, new TextEncoder().encode("creator-sessione-v1")));
}
function uguali(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function leggiCookie(request, nome) {
  for (const parte of (request.headers.get("cookie") || "").split(/;\s*/)) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i) === nome) return decodeURIComponent(parte.slice(i + 1));
  }
  return null;
}

function paginaAccesso({ errore = false, chiuso = false } = {}) {
  const msg = chiuso
    ? `<p class="err">Area chiusa: la password non è ancora impostata sul server.</p>`
    : errore ? `<p class="err">Password sbagliata.</p>` : "";
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Creator · Palio</title>
<style>
:root{color-scheme:dark;--fondo:#15110e;--carta:#1f1914;--riga:#392f27;--testo:#efe6d8;--tenue:#a7988a;--tufo:#e2c079;--rosso:#ff6352}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--fondo);color:var(--testo);font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;padding:16px}
form{width:min(340px,100%);background:var(--carta);border:1px solid var(--riga);border-radius:8px;padding:22px;display:flex;flex-direction:column;gap:12px}
h1{margin:0;font-size:22px;letter-spacing:.06em;text-transform:uppercase}h1 span{color:var(--tufo)}
label{font-size:14px;color:var(--tenue)}
input{font:inherit;color:inherit;background:var(--fondo);border:1px solid var(--riga);border-radius:6px;padding:10px 12px}
input:focus-visible,button:focus-visible{outline:2px solid var(--tufo);outline-offset:2px}
button{font:inherit;font-weight:600;cursor:pointer;background:var(--tufo);color:#241a0c;border:0;border-radius:6px;padding:10px 12px}
.err{margin:0;color:var(--rosso);font-size:14px}
</style></head><body>
<form method="post" action="/creator/">
<h1>Creator <span>Palio</span></h1>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
${msg}
<button type="submit">Entra</button>
</form></body></html>`;
  return new Response(html, {
    status: chiuso ? 503 : 401,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export default async function middleware(request) {
  const password = (typeof process !== "undefined" && process.env && process.env.CREATOR_PASSWORD) || "";
  if (!password) return paginaAccesso({ chiuso: true });
  const atteso = await gettone(password);
  const url = new URL(request.url);

  if (request.method === "POST" && (url.pathname === "/creator" || url.pathname === "/creator/")) {
    let data = "";
    try { data = String((await request.formData()).get("password") || ""); } catch { data = ""; }
    if (uguali(await sha256(data), await sha256(password))) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/creator/",
          "Set-Cookie": `${COOKIE}=${atteso}; Path=/creator; Max-Age=${DURATA}; HttpOnly; Secure; SameSite=Lax`,
          "Cache-Control": "no-store",
        },
      });
    }
    return paginaAccesso({ errore: true });
  }

  if (uguali(leggiCookie(request, COOKIE), atteso)) return;   // nessuna risposta = Vercel serve il file statico
  return paginaAccesso();
}
