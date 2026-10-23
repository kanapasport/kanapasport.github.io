// Klikací test fotek v Poznámkách a prohlížeče obrázků (KBDoc.openImage) nad
// napodobeným Firebase s přepisem pravidel (konverzace\mock_pravidla.js +
// pravidla_emulace.js). Fotky jsou smyšlené jednobarevné PNG.
//   node test_fotky.js --repo <kopie webu>        (nebo set WEB_BASE=<kopie webu>)
// Pokrývá: mřížku 1, 3, 4, 5 a 9 fotek (+N), líné načtení jen viditelných zpráv,
// prohlížeč (šipky, klávesy, přejetí, počitadlo, kolečko, posun, dvojklik, 1:1,
// dva prsty, dvojí ťuknutí, Esc), staré volání openImage(src, popisek) v návodu
// a editoru; 1280 a 375 px.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PROHLIZEC = 'D:/CLAUDE_PRACOVNI/NASTROJE/web/testy/prohlizec';
const { chromium } = require(PROHLIZEC + '/node_modules/playwright');

const arg = (j) => { const i = process.argv.indexOf('--' + j); return i === -1 ? null : process.argv[i + 1]; };
const REPO = path.resolve(arg('repo') || process.env.WEB_BASE || 'D:/CLAUDE_PRACOVNI/NASTROJE/web/WEB_pasportkana_2.0');
const SNIMKY = path.join(__dirname, 'snimky');
fs.mkdirSync(SNIMKY, { recursive: true });
const MOCK = fs.readFileSync(path.join(PROHLIZEC, 'konverzace', 'mock_pravidla.js'), 'utf8');
const PRAVIDLA = fs.readFileSync(path.join(PROHLIZEC, 'konverzace', 'pravidla_emulace.js'), 'utf8');
const APP = 'firemni-kb-app';

/* ---------------------------------------------- smyšlené fotky (PNG) --- */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function kus(typ, data) {
  const delka = Buffer.alloc(4); delka.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(typ), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([delka, td, crc]);
}
function png(w, h, rgb) {
  const hlava = Buffer.alloc(13);
  hlava.writeUInt32BE(w, 0); hlava.writeUInt32BE(h, 4); hlava[8] = 8; hlava[9] = 2;
  const radek = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { radek[1 + x * 3] = rgb[0]; radek[2 + x * 3] = rgb[1]; radek[3 + x * 3] = rgb[2]; }
  const syrove = Buffer.concat(Array.from({ length: h }, () => radek));
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    kus('IHDR', hlava), kus('IDAT', zlib.deflateSync(syrove)), kus('IEND', Buffer.alloc(0))]).toString('base64');
}
let citac = 0;
const barva = () => { const c = citac++; return [(c * 53) % 256, (c * 97 + 40) % 256, (c * 29 + 80) % 256]; };

/* --------------------------------------------------------------- data --- */
const DATA = require(PROHLIZEC + '/testovaci_data.js').vytvor(new Date());
const SEED = {};
Object.keys(DATA.dokumenty).forEach((k) => { SEED['artifacts/' + APP + '/' + k] = DATA.dokumenty[k]; });
SEED['artifacts/' + APP + '/public/data/meta/gsync'] = { url: 'https://script.google.com/macros/s/TEST/exec' };
const PNG_NAVOD = DATA.dokumenty['public/data/guides/guide_test_1/images/img_test_1'].data;

const KONV = 'pzl_foto';
const TED = Date.now();
const P = 'artifacts/' + APP + '/osobni/poznamky/';
SEED[P + 'listy/' + KONV] = { nazev: 'Fotky ze stavby', sdileni: ['uid-spravce'], uid: 'uid-zamestnanec', jmeno: 'Test Zaměstnanec', ms: TED - 5 * 864e5 };
const OBR = {}, NAHLED = {};
const STARYCH = 24;
const zpravy = [];
for (let k = 0; k < STARYCH; k++) zpravy.push({ id: 'pf_old_' + String(k).padStart(2, '0'), n: 2, text: 'Starší fotky ' + k, ms: TED - 3 * 864e5 + k * 6e4 });
[1, 3, 4, 5, 9].forEach((n, j) => zpravy.push({ id: 'pf_' + n, n, text: n + ' – popisek pod fotkami', ms: TED - 36e5 + j * 6e5 }));
// stará zpráva s 1 fotkou bez náhledu – šedá dlaždice, fotka se načte sama
zpravy.push({ id: 'pf_1b', n: 1, text: 'Fotka bez náhledu', ms: TED - 36e5 + 3e5, bezNahledu: true });
zpravy.sort((a, b) => a.ms - b.ms);
zpravy.forEach((z) => {
  OBR[z.id] = [];
  for (let i = 0; i < z.n; i++) {
    const b = barva();
    OBR[z.id].push(png(1600, 1000, b));
    if (i === 0) NAHLED[z.id] = png(84, 52, b);
    SEED[P + 'zaznamy/' + z.id + '/obrazky/img_' + i] = { data: OBR[z.id][i], ms: z.ms + i };
  }
  SEED[P + 'zaznamy/' + z.id] = { listId: KONV, listNazev: 'Fotky ze stavby', text: z.text, uid: 'uid-zamestnanec', jmeno: 'Test Zaměstnanec',
    sdileni: ['uid-spravce'], createdMs: z.ms, ms: z.ms, nahled: z.bezNahledu ? '' : NAHLED[z.id], obrazku: z.n, komentare: [] };
});

const LIDE = {
  spr: { uid: 'uid-spravce', email: 'spravce@example.test', jmeno: 'Test Správce', role: 'hlavni-spravce' }
};

let vysledky = [], chyby = 0;
const ok = (podminka, popis, detail) => {
  vysledky.push((podminka ? 'OK   ' : 'CHYBA') + ' ' + popis + (detail !== undefined && !podminka ? '  → ' + JSON.stringify(detail).slice(0, 300) : ''));
  if (!podminka) chyby++;
};
const pockej = (ms) => new Promise((r) => setTimeout(r, ms));
const blizko = (a, b, tol) => Math.abs(a - b) <= tol;

const TYPY = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let cesta;
  try { cesta = path.join(REPO, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); } catch (e) { cesta = ''; }
  if (!cesta || !cesta.startsWith(REPO) || !fs.existsSync(cesta) || fs.statSync(cesta).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': (TYPY[path.extname(cesta)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(cesta).pipe(res);
});

async function okno(prohlizec, port, stranka, telefon) {
  const clovek = LIDE.spr;
  const kontext = await prohlizec.newContext(telefon
    ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'cs-CZ', timezoneId: 'Europe/Prague', serviceWorkers: 'block' }
    : { viewport: { width: 1280, height: 800 }, locale: 'cs-CZ', timezoneId: 'Europe/Prague', serviceWorkers: 'block' });
  await kontext.addInitScript(({ seed, clovek }) => {
    window.__TEST_SEED = seed;
    window.__TEST_UZIVATEL = { uid: clovek.uid, email: clovek.email };
    try {
      localStorage.setItem('company_kb_username', clovek.jmeno);
      localStorage.setItem('company_kb_email', clovek.email);
      localStorage.setItem('company_kb_role', clovek.role);
    } catch (e) { /* nic */ }
  }, { seed: SEED, clovek });
  await kontext.addInitScript(PRAVIDLA);
  await kontext.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname === 'www.gstatic.com' && /firebase-(app|auth|firestore)\.js$/.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: MOCK });
    }
    if (u.hostname === 'script.google.com') return route.fulfill({ status: 200, body: 'ok' });
    // knihovny z CDN (html2canvas, jsPDF…) – prázdná náhražka, test je nepotřebuje
    if (/\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '/* náhražka */' });
    return route.abort('blockedbyclient');
  });
  const page = await kontext.newPage();
  page.__chyby = [];
  page.on('pageerror', (e) => page.__chyby.push('JS: ' + String(e.message || e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') page.__chyby.push('KON: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto('http://127.0.0.1:' + port + '/' + stranka, { waitUntil: 'load' });
  await page.waitForFunction(() => window.KB && (window.KB.users || []).length > 2, null, { timeout: 8000 });
  await pockej(300);
  return { page, kontext };
}

/* Načítání fotek zprávy se zpozdí a zapisuje – test pak vidí šedé dlaždice
   i to, které zprávy se načetly. */
const sledujNacitani = (page, zpozdeni) => page.evaluate((zpozdeni) => {
  const puvodni = window.KB.nactiPoznObrazky;
  window.__nacteno = [];
  window.KB.nactiPoznObrazky = (id) => { window.__nacteno.push(id); return new Promise((r) => setTimeout(r, zpozdeni)).then(() => puvodni(id)); };
}, zpozdeni);
const nacteno = (page) => page.evaluate(() => window.__nacteno.slice());

const lupa = (page) => page.evaluate(() => {
  const b = document.getElementById('kbLightbox');
  if (!b) return { otevreno: false };
  const img = b.querySelector('img');
  const r = img.getBoundingClientRect();
  const tr = img.style.transform || '';
  const m = /scale\(([\d.]+)\)/.exec(tr);
  const t = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(tr);
  const vidim = (s) => { const e = b.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
  return { otevreno: b.classList.contains('is-open'), src: img.getAttribute('src'), pocet: b.querySelector('.lightbox__pocet').textContent,
    popisek: b.querySelector('.lightbox__cap').textContent, s: m ? Number(m[1]) : 1, x: t ? Number(t[1]) : 0, y: t ? Number(t[2]) : 0,
    r: { l: r.left, t: r.top, w: r.width, h: r.height }, sipky: vidim('.lightbox__sipka--p'), pocetVidet: vidim('.lightbox__pocet'),
    dalsiOff: b.querySelector('[data-krok="1"]').disabled, jedna: b.querySelector('[data-lupa="1"]').textContent,
    jednaOff: b.querySelector('[data-lupa="1"]').disabled };
});
const mrizka = (page, id) => page.evaluate((id) => {
  const z = document.querySelector('#chatZpravy [data-zprava="' + id + '"]');
  if (!z) return null;
  const m = z.querySelector('.kz__mriz');
  const text = z.querySelector('.kz__text');
  return {
    foto: !!z.querySelector('.kz__foto'), fotoSrc: (z.querySelector('.kz__foto img') || {}).src || '',
    mriz: m ? m.className : '', dlazdic: z.querySelectorAll('.kz__dl').length,
    zbyva: Array.from(z.querySelectorAll('.kz__zbyva')).map((e) => e.textContent),
    zbyvaV: Array.from(z.querySelectorAll('.kz__dl')).findIndex((d) => d.querySelector('.kz__zbyva')),
    srcs: Array.from(z.querySelectorAll('.kz__dl img')).map((i) => i.getAttribute('src')),
    textPod: !!(m && text && (m.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING)),
    nacti: !!z.querySelector('[data-nacti-fotky]'),
    rozmery: Array.from(z.querySelectorAll('.kz__dl')).map((d) => { const r = d.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
    uvnitr: (() => { if (!m) return true; const a = m.getBoundingClientRect(), b = z.querySelector('.kz__bublina').getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5; })()
  };
}, id);
const vDole = (page) => page.evaluate(() => { const b = document.getElementById('chatZpravy'); return b.scrollHeight - b.scrollTop - b.clientHeight; });

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const prohlizec = await chromium.launch({ channel: 'chrome', headless: true });
  const stranky = [];
  try {
    /* ============================================ 1) PC 1280: mřížka ===== */
    const A = await okno(prohlizec, port, 'poznamky.html', false);
    stranky.push(['PC poznámky', A.page]);
    await sledujNacitani(A.page, 800);
    await A.page.click('[data-konv="' + KONV + '"] .kdl__nazev');
    await A.page.waitForSelector('#chatZpravy [data-zprava="pf_9"] .kz__mriz');

    const m9a = await mrizka(A.page, 'pf_9');
    ok(m9a.srcs[0] === NAHLED.pf_9 && m9a.srcs.slice(1).every((s) => s === null), 'než fotky dorazí: náhled první + šedé dlaždice', m9a.srcs.map((s) => s && s.slice(0, 30)));
    // výška až po vykreslení náhledů (jedna fotka nemá pevný tvar dlaždice)
    await A.page.waitForFunction(() => Array.from(document.querySelectorAll('#chatZpravy img[src]')).every((i) => i.complete));
    const vyskaPred = await A.page.$eval('#chatZpravy', (b) => b.scrollHeight);

    const m1 = await mrizka(A.page, 'pf_1');
    ok(m1.foto && !m1.mriz && m1.fotoSrc === NAHLED.pf_1 && !m1.nacti, '1 fotka: větší náhled jako dřív, bez mřížky a bez samočinného načítání', m1);
    const m3 = await mrizka(A.page, 'pf_3');
    ok(/kz__mriz--3/.test(m3.mriz) && m3.dlazdic === 3 && !m3.zbyva.length, '3 fotky: mřížka 3 dlaždic bez +N', m3);
    ok(m3.rozmery[0][0] > m3.rozmery[1][0] * 1.8 && blizko(m3.rozmery[1][0], m3.rozmery[2][0], 1), '3 fotky: první široká, dvě pod ní', m3.rozmery);
    const m4 = await mrizka(A.page, 'pf_4');
    ok(/kz__mriz--4/.test(m4.mriz) && m4.dlazdic === 4 && !m4.zbyva.length, '4 fotky: mřížka 2×2 bez +N', m4);
    ok(m4.rozmery.every((r) => blizko(r[0], r[1], 1) && r[0] >= 120), '4 fotky: čtvercové dlaždice', m4.rozmery);
    const m5 = await mrizka(A.page, 'pf_5');
    ok(m5.dlazdic === 4 && m5.zbyva.join() === '+2' && m5.zbyvaV === 3, '5 fotek: tři + čtvrtá dlaždice „+2“', m5);
    ok(m9a.dlazdic === 4 && m9a.zbyva.join() === '+6' && m9a.zbyvaV === 3, '9 fotek: tři + čtvrtá dlaždice „+6“', m9a);
    ok([m3, m4, m5, m9a].every((m) => m.textPod), 'text zprávy je pod fotkami (popisek)');
    ok([m3, m4, m5, m9a].every((m) => m.uvnitr), 'mřížka se vejde do bubliny');

    /* --- líné načtení ---------------------------------------------------- */
    await A.page.waitForFunction(() => {
      const i = document.querySelector('#chatZpravy [data-zprava="pf_9"] .kz__dl:nth-child(2) img');
      return i && i.getAttribute('src');
    }, null, { timeout: 6000 });
    const m9 = await mrizka(A.page, 'pf_9');
    ok(m9.srcs.every((s, i) => s === OBR.pf_9[i]), 'viditelná zpráva si plné fotky načetla sama (bez kliknutí)');
    ok(await A.page.$eval('#chatZpravy', (b) => b.scrollHeight) === vyskaPred && await vDole(A.page) < 2, 'po dorazení fotek se okno zpráv nepohnulo (pořád dole)');
    let nac = await nacteno(A.page);
    ok(nac.includes('pf_9') && nac.includes('pf_5'), 'načteny zprávy dole na obrazovce', nac);
    ok(!nac.some((id) => /^pf_old_(0\d|1\d)$/.test(id)), 'starší zprávy mimo obrazovku se nenačítají', nac);
    ok(!nac.includes('pf_1'), 'zpráva s 1 fotkou se sama nenačítá (stačí náhled)', nac);
    ok(new Set(nac).size === nac.length, 'každá zpráva se načítala jednou', nac);
    await A.page.$eval('#chatZpravy', (b) => { b.scrollTop = 0; });
    await A.page.waitForFunction(() => window.__nacteno.includes('pf_old_00'), null, { timeout: 4000 }).catch(() => {});
    await pockej(1200);
    nac = await nacteno(A.page);
    ok(nac.includes('pf_old_00') && nac.includes('pf_old_01'), 'po odrolování nahoru se načetly horní zprávy', nac);
    ok(!nac.includes('pf_old_12') && nac.length < zpravy.length - 1, 'prostřední zprávy (nebyly vidět) se nenačetly', nac);
    const m00 = await mrizka(A.page, 'pf_old_00');
    ok(m00.srcs.every((s, i) => s === OBR.pf_old_00[i]) && /kz__mriz--2/.test(m00.mriz), '2 fotky: dvě dlaždice vedle sebe s plnými fotkami', m00.mriz);
    await A.page.screenshot({ path: path.join(SNIMKY, 'fotky_pc_nahore.png') });
    await A.page.$eval('#chatZpravy', (b) => { b.scrollTop = b.scrollHeight; });
    await pockej(400);
    await A.page.screenshot({ path: path.join(SNIMKY, 'fotky_pc.png') });

    /* ============================================ 2) prohlížeč na PC ===== */
    await A.page.click('#chatZpravy [data-zprava="pf_5"] .kz__dl:nth-child(2)');
    await A.page.waitForSelector('#kbLightbox.is-open');
    let L = await lupa(A.page);
    ok(L.src === OBR.pf_5[1] && L.pocet === '2 / 5' && L.sipky && L.pocetVidet, 'klik na 2. dlaždici: galerie na 2. fotce, počitadlo 2 / 5', { p: L.pocet, s: L.sipky });
    ok(L.popisek === '5 – popisek pod fotkami', 'popisek = text zprávy', L.popisek);
    await A.page.click('#kbLightbox .lightbox__sipka--p');
    L = await lupa(A.page);
    ok(L.src === OBR.pf_5[2] && L.pocet === '3 / 5', 'šipka vpravo na obrazovce → 3 / 5', L.pocet);
    await A.page.click('#kbLightbox .lightbox__sipka--l');
    await A.page.keyboard.press('ArrowRight');
    await A.page.keyboard.press('ArrowRight');
    L = await lupa(A.page);
    ok(L.src === OBR.pf_5[3] && L.pocet === '4 / 5', 'šipka vlevo a klávesa → dvakrát: 4 / 5', L.pocet);
    await A.page.keyboard.press('ArrowLeft');
    ok((await lupa(A.page)).pocet === '3 / 5', 'klávesa ← vrátí o fotku');
    for (let i = 0; i < 4; i++) await A.page.keyboard.press('ArrowRight');
    L = await lupa(A.page);
    ok(L.pocet === '5 / 5' && L.dalsiOff && L.src === OBR.pf_5[4], 'na konci zůstane na poslední, šipka dál je vypnutá', L.pocet);
    ok(await A.page.$eval('#psaniText', (t) => t.value) === '', 'šipky se nepropsaly do pole zprávy');

    // přiblížení kolečkem k bodu kurzoru
    L = await lupa(A.page);
    ok(L.s === 1 && !L.jednaOff && L.jedna === '1:1', 'celý obrázek, 1:1 jde (fotka je větší než okno)', L);
    const bod = { x: L.r.l + 0.3 * L.r.w, y: L.r.t + 0.4 * L.r.h };
    await A.page.mouse.move(bod.x, bod.y);
    await A.page.mouse.wheel(0, -300);
    await pockej(150);
    const L2 = await lupa(A.page);
    const fx = (bod.x - L2.r.l) / L2.r.w, fy = (bod.y - L2.r.t) / L2.r.h;
    ok(L2.s > 1.5 && blizko(fx, 0.3, 0.01) && blizko(fy, 0.4, 0.01), 'kolečko přiblíží k bodu pod kurzorem', { s: L2.s, fx, fy });
    ok(L2.jedna === 'Celý', 'přiblíženo: tlačítko „Celý“ místo 1:1', L2.jedna);
    // posun tažením
    await A.page.mouse.move(640, 400);
    await A.page.mouse.down();
    await A.page.mouse.move(580, 375, { steps: 4 });
    await A.page.mouse.move(520, 350, { steps: 4 });
    await A.page.mouse.up();
    await pockej(100);
    const L3 = await lupa(A.page);
    ok(blizko(L3.r.l - L2.r.l, -120, 1) && blizko(L3.r.t - L2.r.t, -50, 1) && L3.otevreno, 'přiblížený obrázek jde posouvat tažením (a tažení prohlížeč nezavře)', { dx: L3.r.l - L2.r.l, dy: L3.r.t - L2.r.t });
    await A.page.mouse.move(700, 400);
    await A.page.mouse.down();
    await A.page.mouse.move(450, 400, { steps: 8 });
    await A.page.mouse.up();
    await pockej(100);
    L = await lupa(A.page);
    ok(L.pocet === '5 / 5' && L.s > 1.5 && L.otevreno, 'přiblížený: vodorovné tažení je posun, ne další fotka', { p: L.pocet, s: L.s });
    await A.page.click('#kbLightbox [data-lupa="1"]');
    L = await lupa(A.page);
    ok(L.s === 1 && L.x === 0 && L.y === 0 && L.jedna === '1:1', 'tlačítko „Celý“ vrátí celý obrázek', L);
    await A.page.click('#kbLightbox [data-lupa="1"]');
    L = await lupa(A.page);
    const skutecna = await A.page.$eval('#kbLightbox img', (i) => i.naturalWidth / i.offsetWidth);
    ok(blizko(L.s, skutecna, 0.01) && blizko(L.r.w, 1600, 2), '1:1 = skutečná velikost fotky', { s: L.s, w: L.r.w });
    await A.page.click('#kbLightbox [data-lupa="1"]');
    await A.page.click('#kbLightbox [data-lupa="+"]');
    ok(blizko((await lupa(A.page)).s, 1.5, 0.01), 'tlačítko + přiblíží');
    await A.page.click('#kbLightbox [data-lupa="-"]');
    ok((await lupa(A.page)).s === 1, 'tlačítko − oddálí');
    // dvojklik
    L = await lupa(A.page);
    await A.page.mouse.dblclick(L.r.l + L.r.w * 0.7, L.r.t + L.r.h * 0.6);
    await pockej(100);
    ok(blizko((await lupa(A.page)).s, 2.5, 0.01) && (await lupa(A.page)).otevreno, 'dvojklik přiblíží (prohlížeč zůstane otevřený)', await lupa(A.page));
    await A.page.mouse.dblclick(L.r.l + L.r.w * 0.5, L.r.t + L.r.h * 0.5);
    await pockej(100);
    ok((await lupa(A.page)).s === 1, 'druhý dvojklik vrátí celý obrázek');
    // přejetí (celý obrázek) = další / předchozí
    await A.page.mouse.move(500, 400);
    await A.page.mouse.down();
    await A.page.mouse.move(750, 410, { steps: 8 });
    await A.page.mouse.up();
    await pockej(100);
    L = await lupa(A.page);
    ok(L.pocet === '4 / 5' && L.src === OBR.pf_5[3] && L.otevreno, 'přejetí doprava = předchozí fotka', L.pocet);
    await A.page.keyboard.press('Escape');
    ok(!(await lupa(A.page)).otevreno, 'Esc zavře prohlížeč');
    // +N dlaždice
    await A.page.click('#chatZpravy [data-zprava="pf_9"] .kz__dl:nth-child(4)');
    await A.page.waitForSelector('#kbLightbox.is-open');
    L = await lupa(A.page);
    ok(L.pocet === '4 / 9' && L.src === OBR.pf_9[3], 'klik na „+6“ otevře prohlížeč na 4. fotce z 9', L.pocet);
    await A.page.mouse.click(30, 200);
    ok(!(await lupa(A.page)).otevreno, 'klik vedle obrázku zavře prohlížeč');
    // 1 fotka: plná se načte na klik, bez galerie
    await A.page.$eval('#chatZpravy [data-zprava="pf_1"]', (e) => e.scrollIntoView({ block: 'center' }));
    await pockej(900);
    ok(!(await nacteno(A.page)).includes('pf_1'), 'zpráva s 1 fotkou na obrazovce se sama nenačetla');
    const m1b = await mrizka(A.page, 'pf_1b');
    ok(/kz__mriz--1/.test(m1b.mriz) && m1b.dlazdic === 1 && m1b.srcs[0] === OBR.pf_1b[0] && (await nacteno(A.page)).includes('pf_1b'),
      '1 fotka bez náhledu: šedá dlaždice, plná fotka se načetla sama', m1b);
    await A.page.click('#chatZpravy [data-zprava="pf_1"] .kz__foto');
    await A.page.waitForSelector('#kbLightbox.is-open');
    L = await lupa(A.page);
    ok(L.src === OBR.pf_1[0] && !L.sipky && !L.pocetVidet, '1 fotka: plná fotka, bez šipek a počitadla', { s: L.sipky, p: L.pocetVidet });
    await A.page.keyboard.press('Escape');
    ok((await mrizka(A.page, 'pf_1')).fotoSrc === OBR.pf_1[0], 'po načtení ukazuje bublina plnou fotku místo náhledu');
    // staré volání openImage(src, popisek)
    await A.page.evaluate((src) => window.KBDoc.openImage(src, 'Starý popisek'), PNG_NAVOD);
    L = await lupa(A.page);
    ok(L.otevreno && L.src === PNG_NAVOD && L.popisek === 'Starý popisek' && !L.sipky && !L.pocetVidet && L.s === 1, 'staré volání openImage(src, popisek) = jeden obrázek', L);
    await A.page.keyboard.press('Escape');

    /* ============================================ 3) telefon 375 px ===== */
    const T = await okno(prohlizec, port, 'poznamky.html', true);
    stranky.push(['telefon poznámky', T.page]);
    await sledujNacitani(T.page, 0);
    await T.page.tap('[data-konv="' + KONV + '"] .kdl__nazev');
    await T.page.waitForSelector('#chatObal:not([hidden]) [data-zprava="pf_9"] .kz__mriz');
    await T.page.waitForFunction(() => { const i = document.querySelector('#chatZpravy [data-zprava="pf_9"] .kz__dl:nth-child(2) img'); return i && i.getAttribute('src'); }, null, { timeout: 5000 });
    await pockej(300);
    const sirky = await T.page.evaluate(() => {
      const b = document.getElementById('chatZpravy');
      return { stranka: document.documentElement.scrollWidth, zpravy: b.scrollWidth, zpravyVidet: b.clientWidth };
    });
    ok(sirky.stranka <= 375 && sirky.zpravy <= sirky.zpravyVidet, 'telefon: nic nepřetéká do šířky', sirky);
    const t9 = await mrizka(T.page, 'pf_9'), t5 = await mrizka(T.page, 'pf_5');
    ok(t9.uvnitr && t5.uvnitr && t9.rozmery.every((r) => r[0] >= 100 && r[0] <= 140), 'telefon: mřížka v bublině, dlaždice 100–140 px', t9.rozmery);
    await T.page.screenshot({ path: path.join(SNIMKY, 'fotky_telefon.png') });
    await T.page.tap('#chatZpravy [data-zprava="pf_9"] .kz__dl:nth-child(1)');
    await T.page.waitForSelector('#kbLightbox.is-open');
    L = await lupa(T.page);
    ok(L.pocet === '1 / 9' && L.src === OBR.pf_9[0], 'telefon: ťuknutí otevře galerii 1 / 9', L.pocet);
    const ovl = await T.page.evaluate(() => {
      const r = (s) => document.querySelector('#kbLightbox ' + s).getBoundingClientRect();
      const a = r('.lightbox__lupa'), z = r('.lightbox__close'), p = r('.lightbox__pocet');
      return { prekryv: a.right > z.left || a.left < p.right, vejde: a.left >= 0 && z.right <= 375 };
    });
    ok(!ovl.prekryv && ovl.vejde, 'telefon: ovládání prohlížeče se vejde a nepřekrývá', ovl);
    await T.page.screenshot({ path: path.join(SNIMKY, 'prohlizec_telefon.png') });
    const cdp = await T.kontext.newCDPSession(T.page);
    const dotek = (type, body) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: body.map((b, i) => ({ x: b[0], y: b[1], id: i })) });
    async function prejed(x1, x2, y) {
      await dotek('touchStart', [[x1, y]]);
      for (let k = 1; k <= 6; k++) await dotek('touchMove', [[x1 + (x2 - x1) * k / 6, y]]);
      await dotek('touchEnd', []);
      await pockej(150);
    }
    await prejed(300, 80, 400);
    ok((await lupa(T.page)).pocet === '2 / 9', 'telefon: přejetí prstem doleva = další fotka');
    await prejed(80, 300, 400);
    ok((await lupa(T.page)).pocet === '1 / 9', 'telefon: přejetí doprava = předchozí');
    // dva prsty
    await dotek('touchStart', [[150, 400], [225, 400]]);
    for (let k = 1; k <= 6; k++) await dotek('touchMove', [[150 - 12 * k, 400], [225 + 12 * k, 400]]);
    await dotek('touchEnd', []);
    await pockej(150);
    L = await lupa(T.page);
    ok(L.s > 1.8 && L.pocet === '1 / 9', 'telefon: roztažení dvěma prsty přiblíží', { s: L.s });
    await prejed(300, 80, 400);
    L = await lupa(T.page);
    ok(L.pocet === '1 / 9' && L.s > 1.8, 'telefon: přiblížený – přejetí posouvá, nepřepne fotku', { p: L.pocet, s: L.s });
    // dvojí ťuknutí doprostřed obrazovky (tam je obrázek přiblížený i celý)
    const stredObr = [187, 406];
    await dotek('touchStart', [stredObr]); await dotek('touchEnd', []);
    await pockej(80);
    await dotek('touchStart', [stredObr]); await dotek('touchEnd', []);
    await pockej(150);
    L = await lupa(T.page);
    ok(L.s === 1 && L.otevreno, 'telefon: dvojí ťuknutí vrátí celý obrázek', { s: L.s, o: L.otevreno });
    await pockej(400);
    await dotek('touchStart', [stredObr]); await dotek('touchEnd', []);
    await pockej(80);
    await dotek('touchStart', [stredObr]); await dotek('touchEnd', []);
    await pockej(150);
    L = await lupa(T.page);
    ok(blizko(L.s, 2.5, 0.01) && L.otevreno, 'telefon: dvojí ťuknutí přiblíží', { s: L.s });
    const sirkaLupa = await T.page.evaluate(() => document.documentElement.scrollWidth);
    ok(sirkaLupa <= 375, 'telefon: přiblížený obrázek nerozšíří stránku', sirkaLupa);
    await T.page.tap('#kbLightbox .lightbox__close');
    ok(!(await lupa(T.page)).otevreno, 'telefon: × zavře prohlížeč');

    /* ======================== 4) návod a editor: staré volání openImage ===== */
    const N = await okno(prohlizec, port, 'navod.html?id=guide_test_1', false);
    stranky.push(['návod', N.page]);
    await N.page.waitForSelector('.doc-fig img', { timeout: 6000 });
    await N.page.$eval('.doc-fig img', (i) => i.click());
    await N.page.waitForSelector('#kbLightbox.is-open', { timeout: 3000 });
    L = await lupa(N.page);
    ok(L.src === PNG_NAVOD && /obr\. 1\.1/.test(L.popisek) && !L.sipky && !L.pocetVidet, 'návod: klik na obrázek ho zvětší (jeden, s popiskem)', { p: L.popisek, s: L.sipky });
    ok(L.jednaOff, 'návod: malý obrázek – 1:1 vypnuté (už je ve skutečné velikosti)');
    await N.page.keyboard.press('Escape');
    ok(!(await lupa(N.page)).otevreno, 'návod: Esc zavře');

    const E = await okno(prohlizec, port, 'editor.html?id=guide_test_1', false);
    stranky.push(['editor', E.page]);
    await E.page.waitForSelector('[data-zoom]', { timeout: 6000 });
    await E.page.click('[data-zoom]');
    await E.page.waitForSelector('#kbLightbox.is-open', { timeout: 3000 });
    L = await lupa(E.page);
    ok(L.src === PNG_NAVOD && L.popisek === 'Náhled obrázku' && !L.sipky, 'editor: náhled obrázku se otevře postaru', L.popisek);
    await E.page.keyboard.press('Escape');
    ok(!(await lupa(E.page)).otevreno, 'editor: Esc zavře');

    for (const [jmeno, page] of stranky) ok(page.__chyby.length === 0, 'bez chyb JS a console.error (' + jmeno + ')', page.__chyby);
    for (const [jmeno, page] of stranky.slice(0, 2)) {
      const zam = await page.evaluate(() => (window.__TEST_ZAMITNUTO || []).slice());
      ok(zam.length === 0, 'web nečetl ani nezapsal nic, co by pravidla zamítla (' + jmeno + ')', zam);
    }
  } catch (e) {
    ok(false, 'test spadl: ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | '));
  } finally {
    await prohlizec.close();
    server.close();
  }
  console.log(vysledky.join('\n'));
  console.log('\n' + (vysledky.length - chyby) + ' / ' + vysledky.length + ' OK');
  process.exit(chyby ? 1 : 0);
})();
