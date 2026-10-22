/* ==========================================================================
   Service worker – instalace webu jako aplikace (Android) a otevření
   terénních stránek bez signálu (rešerše 19. 10. 2026, bod 29).

   ROZHODNUTÍ 2. 9. 2026 PLATÍ DÁL: po nasazení nikdo nesmí koukat na starou
   verzi a nevědět proč. Proto:
   • Stránky (HTML) jdou VŽDY nejdřív ze sítě. Uložená kopie jen když síť
     selže – bez signálu, nebo když do 5 s nepřijde nic (sklep, jedna čárka).
   • Soubory s `?v=NNN` (js, css) a Firebase z gstatic (verze je v cestě) se
     berou z mezipaměti podle CELÉ adresy. Nasazení zvedne ?v=, nová verze
     má jinou adresu – stará se po nasazení nikdy nepoužije. Na pozadí se
     soubor stejně ověří u sítě: kdyby někdo zapomněl ?v= zvednout, srovná se
     to dalším otevřením (bez service workeru to za 10 min srovnal prohlížeč).
   • Písma, obrázky, manifest webu: stejně (z mezipaměti, ověřit na pozadí).
   • Databáze, přihlášení, Apps Script, ntfy, CDN knihoven – sem nesahá, jdou
     rovnou na síť. Data bez signálu drží Firestore sám (store.js).
   Ukládá se jen pět terénních stránek (TERENNI). Po instalaci a po každé
   nové verzi webu se natáhne všech pět (HTML ~80 kB; soubory má většinou
   už stažené stránka, logo a písma jen poprvé) a soubory starých verzí se
   smažou. Ostatní stránky bez signálu ukážou rozcestník na těch pět.

   UPOZORNĚNÍ Z WEBU (22. 10. 2026): tenhle service worker zároveň ukazuje
   upozornění, která posílá Apps Script přes Firebase Cloud Messaging
   (přihlášení zařízení k odběru dělá store.js, KB.pushZapnout).
   • push: VŽDY ukázat upozornění – iPhone odběr zruší, když push nic
     neukáže. Data z FCM: { data: { titulek, text, odkaz, tag } }; pro
     jistotu se bere i notification.title/body a fcmOptions.link.
   • notificationclick: zavřít, najít otevřené okno webu a přepnout ho na
     odkaz (jinak nové okno). Odkaz jen pod adresou webu – cizí adresa nebo
     javascript: z podvržené zprávy otevře úvodní stránku.
   ========================================================================== */

const CACHE = "kb-teren-2";      // zvednout JEN při změně tohoto souboru – staré se smažou
const TERENNI = {
    "index.html": "Nástěnka",
    "plany.html": "Plány",
    "quicktodo.html": "Quick TO-DO",
    "poznamky.html": "Poznámky",
    "ukoly.html": "Úkoly"
};
const CEKAT_NA_SIT_MS = 5000;
const KOREN = self.registration.scope;
const FIREBASE = /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-[a-z-]+\.js$/;

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(srovnej(null));          // natáhnout všech pět; bez signálu nevadí
});

self.addEventListener("activate", (event) => event.waitUntil(
    caches.keys()
        .then(jmena => Promise.all(jmena.filter(j => j.startsWith("kb-") && j !== CACHE).map(j => caches.delete(j))))
        .then(() => self.clients.claim())));

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    const domaci = url.origin === self.location.origin;
    // pojistka: cokoliv by se tu pokazilo (třeba úložiště prohlížeče), jde se prostě na síť
    if (req.mode === "navigate") {
        if (domaci) event.respondWith(stranka(event).catch(() => fetch(req)));
        return;
    }
    if ((domaci && (url.searchParams.has("v") || /^(font|image|manifest)$/.test(req.destination))) ||
        FIREBASE.test(req.url)) {
        event.respondWith(soubor(event).catch(() => fetch(req)));
    }
    // vše ostatní jde rovnou na síť (respondWith se nevolá)
});

const verze = (text) => (String(text).match(/\?v=(\d+)/) || [])[1] || "";
const html = (text) => new Response(text, { headers: { "Content-Type": "text/html; charset=utf-8" } });

/** Klíč terénní stránky v mezipaměti (bez ?parametrů, kořen = index.html), jinak "". */
function klicStranky(adresa) {
    const cesta = adresa.split(/[?#]/)[0].slice(KOREN.length) || "index.html";
    return TERENNI[cesta] ? KOREN + cesta : "";
}

/** HTML: síť; uložená kopie jen když síť selže nebo mlčí déle než CEKAT_NA_SIT_MS. */
async function stranka(event) {
    const klic = klicStranky(event.request.url);
    const sit = fetch(event.request);
    if (!klic) return sit.catch(() => bezSignalu());
    // kopie se bere hned (před předáním stránce) a uloží se, i když už stránka jela z mezipaměti
    event.waitUntil(sit.then(odp => (odp.ok && odp.type === "basic") ? ulozStranku(klic, odp.clone()) : null)
        .catch(() => {}));
    let casovac = null;
    const prvni = await Promise.race([
        sit.then(odp => odp, () => null),
        new Promise(hotovo => { casovac = setTimeout(() => hotovo(null), CEKAT_NA_SIT_MS); })
    ]);
    clearTimeout(casovac);
    if (prvni) return prvni;
    const ulozena = await (await caches.open(CACHE)).match(klic);
    return ulozena || sit.catch(() => bezSignalu());
}

async function ulozStranku(klic, odp) {
    const text = await odp.text();
    const cache = await caches.open(CACHE);
    const stara = await cache.match(klic);
    const staraVerze = stara ? verze(await stara.text()) : null;
    await cache.put(klic, html(text));
    if (verze(text) !== staraVerze) await srovnej(verze(text));   // nová verze webu → dorovnat ostatní
}

/** Soubory: z mezipaměti podle celé adresy, na pozadí ověřit u sítě (ETag). */
async function soubor(event) {
    const cache = await caches.open(CACHE);
    const ulozena = await cache.match(event.request, { ignoreVary: true });
    const sit = fetch(event.request).then(odp => {
        const etag = odp.headers.get("etag");
        if (odp.status === 200 && (!ulozena || !etag || etag !== ulozena.headers.get("etag"))) {
            event.waitUntil(cache.put(event.request, odp.clone()).catch(() => {}));
        }
        return odp;
    });
    if (!ulozena) return sit;
    event.waitUntil(sit.catch(() => {}));
    return ulozena;
}

/* Srovnání běží po jednom (dvě navigace naráz by si mazaly pod rukama). */
let fronta = Promise.resolve();
function srovnej(v) {
    fronta = fronta.then(() => srovnejTed(v)).catch(() => {});
    return fronta;
}

/** Dotáhne terénní stránky, které nemají verzi `v` (null = všechny), jejich
    soubory a Firebase; pak smaže soubory, které žádná uložená stránka nepotřebuje. */
async function srovnejTed(v) {
    const cache = await caches.open(CACHE);
    const potreba = new Set();
    for (const s of Object.keys(TERENNI)) {
        const klic = KOREN + s;
        const ulozena = await cache.match(klic);
        let text = ulozena ? await ulozena.text() : "";
        if (v === null || verze(text) !== v) {
            try {
                const odp = await fetch(klic, { cache: "no-cache" });
                if (odp.ok && !odp.redirected) { text = await odp.text(); await cache.put(klic, html(text)); }
            } catch (err) { /* bez signálu zůstane, co je */ }
        }
        if (!text) continue;
        potreba.add(klic);
        for (const m of text.matchAll(/(?:src|href)="([^"?#]+\?v=\d+)"/g)) {
            await pridej(cache, new URL(m[1], klic).href, potreba);
        }
    }
    // písma a obrázky (bez ?v=) zůstávají, staré verze souborů a Firebase pryč
    for (const req of await cache.keys()) {
        if (!potreba.has(req.url) && (/[?&]v=\d/.test(req.url) || FIREBASE.test(req.url))) await cache.delete(req);
    }
}

/** Uloží soubor (když ještě není) a s ním, co sám načítá: skript Firebase moduly
    a logo webu (obrázky v ui.js), styl písma woff2. */
async function pridej(cache, url, potreba) {
    if (potreba.has(url)) return;
    potreba.add(url);
    let odp = await cache.match(url, { ignoreVary: true });
    if (!odp) {
        try { odp = await fetch(url); } catch (err) { return; }
        if (odp.status !== 200) return;
        await cache.put(url, odp.clone());
    }
    const css = /\.css(\?|$)/.test(url);
    if (!css && !/\.js(\?|$)/.test(url)) return;
    const text = await odp.text();
    const vzor = css ? /url\("?([^"')?]+\.woff2)/g
        : /(https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-[a-z-]+\.js)|(?:src|srcset)="([\w./-]+\.png)"/g;
    for (const m of text.matchAll(vzor)) await pridej(cache, new URL(m[1] || m[2], css ? url : KOREN).href, potreba);
}

/** Stránka, která uložená není, bez signálu: rozcestník na terénní stránky. */
function bezSignalu() {
    const odkazy = Object.keys(TERENNI).map(s => '<li><a href="' + s + '">' + TERENNI[s] + "</a></li>").join("");
    return html('<!doctype html><html lang="cs"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Bez signálu – Pasport Kaňa</title>' +
        "<style>:root{--fs-3:14px;--fs-4:16px;--fs-5:20px}" +
        "body{margin:0;padding:24px 16px;font:var(--fs-4)/1.5 system-ui,sans-serif;background:#eef0f3;color:#1f2933}" +
        "main{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:20px}" +
        "h1{font-size:var(--fs-5);margin:0 0 8px}p{margin:0 0 12px;font-size:var(--fs-3)}" +
        "ul{padding-left:20px;margin:0 0 16px}li{margin:6px 0}a{color:#1d556d;font-weight:700}" +
        "button{font:inherit;font-size:var(--fs-3);padding:8px 14px;border-radius:8px;border:1px solid #1d556d;background:#1d556d;color:#fff}</style>" +
        "</head><body><main><h1>Bez signálu</h1>" +
        "<p>Tahle stránka se bez připojení neotevře. Bez signálu jdou (s tím, co bylo naposledy načtené):</p>" +
        "<ul>" + odkazy + '</ul><button type="button" onclick="location.reload()">Zkusit znovu</button>' +
        "</main></body></html>");
}

/* ------------------------------------------------------- upozornění ---- */

const IKONA = KOREN + "ikona-192.png";

self.addEventListener("push", (event) => {
    event.waitUntil(ukazUpozorneni(event.data));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const odkaz = adresaWebu((event.notification.data || {}).odkaz);
    event.waitUntil(otevriOdkaz(odkaz));
});

/** Odkaz jen na tenhle web (pod `scope`), jinak úvodní stránka. */
function adresaWebu(adresa) {
    try {
        const url = new URL(String(adresa || ""), KOREN);
        if (url.href.startsWith(KOREN)) return url.href;
    } catch (err) { /* nesmysl v adrese – úvodní stránka */ }
    return KOREN;
}

/** Co z pushe ukázat. Chybějící nebo rozbitá data nevadí – upozornění se ukáže vždy. */
function obsahPushe(data) {
    let json = null;
    try { json = data ? data.json() : null; } catch (err) {
        try { json = { data: { text: data.text() } }; } catch (e) { json = null; }
    }
    const obj = (x) => (x && typeof x === "object") ? x : {};
    const d = obj(json && json.data);
    const n = obj(json && json.notification);
    const f = obj(json && json.fcmOptions);
    return {
        titulek: String(d.titulek || n.title || "Pasport Kaňa").slice(0, 120),
        text: String(d.text || n.body || "").slice(0, 500),
        odkaz: adresaWebu(d.odkaz || f.link || ""),
        tag: String(d.tag || "").slice(0, 64)
    };
}

function ukazUpozorneni(data) {
    let o;
    try { o = obsahPushe(data); } catch (err) { o = { titulek: "Pasport Kaňa", text: "", odkaz: KOREN, tag: "" }; }
    const volby = { body: o.text, icon: IKONA, lang: "cs", data: { odkaz: o.odkaz } };
    // stejný tag = nové upozornění nahradí staré (další zpráva v téže konverzaci); renotify, ať znovu pípne
    if (o.tag) { volby.tag = o.tag; volby.renotify = true; }
    return self.registration.showNotification(o.titulek, volby);
}

/** Otevřené okno webu přepnout na odkaz; když žádné není (nebo nejde přepnout), nové okno. */
async function otevriOdkaz(odkaz) {
    const okna = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const okno = okna.find(c => c.url === odkaz) || okna.find(c => c.url.startsWith(KOREN));
    if (okno) {
        try {
            const zamerene = (await okno.focus()) || okno;
            if (zamerene.url !== odkaz) await zamerene.navigate(odkaz);
            return;
        } catch (err) { /* okno neřídí tenhle service worker nebo nejde zaměřit – nové okno */ }
    }
    if (self.clients.openWindow) await self.clients.openWindow(odkaz);
}
