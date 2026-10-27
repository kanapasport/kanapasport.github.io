// Klikací test Poznámek: otevřená konverzace sjede vždy na poslední zprávu
// (Michal 27. 10. 2026 – „stále musím rolovat") a bublina „Řeší se" je oranžová.
// Napodobený Firebase s přepisem pravidel (testy\prohlizec\konverzace\
// mock_pravidla.js + pravidla_emulace.js), fotky smyšlené jednobarevné PNG.
//   "C:\Program Files\FARO\SCENE\LidarOS\node\node.exe" test_sjeti_dolu.js [--repo <kopie webu>]
// Pokrývá: otevření dlouhé konverzace (i s fotkami, které po načtení mění
// výšku), přepnutí v levém seznamu, vlastní odeslání, nová cizí zpráva při
// odrolování nahoru (pozice zůstane) a u dna (sjede), delší text v poli,
// krok zpět/vpřed, ?konv=, ?pozn= (zvýrazněná má přednost), oranžová bublina
// u stavu 0 (moje i cizí); 1280 a 375 px.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PROHLIZEC = 'D:/CLAUDE_PRACOVNI/NASTROJE/web/testy/prohlizec';
const { chromium } = require(PROHLIZEC + '/node_modules/playwright');

const arg = (j) => { const i = process.argv.indexOf('--' + j); return i === -1 ? null : process.argv[i + 1]; };
const REPO = path.resolve(arg('repo') || process.env.WEB_BASE || path.join(__dirname, '..'));
const SNIMKY = arg('snimky') ? path.resolve(arg('snimky')) : '';
if (SNIMKY) fs.mkdirSync(SNIMKY, { recursive: true });
const MOCK = fs.readFileSync(path.join(PROHLIZEC, 'konverzace', 'mock_pravidla.js'), 'utf8');
const PRAVIDLA = fs.readFileSync(path.join(PROHLIZEC, 'konverzace', 'pravidla_emulace.js'), 'utf8');
const APP = 'firemni-kb-app';
const P = 'artifacts/' + APP + '/osobni/poznamky/';

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

const KDL = 'pzl_dlouha', KDR = 'pzl_druha';
const TED = Date.now();
const LIDE2 = ['uid-zamestnanec', 'uid-spravce'];
const JM = { 'uid-zamestnanec': 'Test Zaměstnanec', 'uid-spravce': 'Test Správce' };

/* Konverzace se zprávami v časové ose: `n` fotek (0 = jen text). Zprávy po
   6 minutách, střídavě od kolegy a ode mě (já = uid-spravce). */
function konverzace(id, nazev, zpravy, zacatek) {
  let posledni = null;
  zpravy.forEach((z, i) => {
    const ms = zacatek + i * 6 * 60e3;
    const uid = z.uid || LIDE2[i % 2];
    const doc = { listId: id, listNazev: nazev, text: z.text, uid: uid, jmeno: JM[uid], sdileni: LIDE2,
      createdMs: ms, ms: ms, nahled: '', obrazku: 0 };
    if (z.stav !== undefined) doc.stav = z.stav;
    if (z.n) {
      doc.obrazku = z.n;
      for (let k = 0; k < z.n; k++) {
        const b = barva();
        SEED[P + 'zaznamy/' + z.id + '/obrazky/img_' + k] = { data: png(1600, 1000, b), ms: ms + k };
        if (k === 0 && !z.bezNahledu) doc.nahled = png(84, 52, b);
      }
    }
    SEED[P + 'zaznamy/' + z.id] = doc;
    posledni = { id: z.id, ms, uid, text: z.text };
  });
  SEED[P + 'listy/' + id] = { nazev: nazev, uid: 'uid-zamestnanec', jmeno: JM['uid-zamestnanec'], sdileni: ['uid-spravce'], ztlumili: [],
    ms: zacatek - 60e3, posledniMs: posledni.ms, posledniUid: posledni.uid, posledniJmeno: JM[posledni.uid],
    posledniText: posledni.text || '📷 Obrázek', posledniId: posledni.id,
    precteno: { 'uid-spravce': posledni.ms, 'uid-zamestnanec': posledni.ms } };
}

const dlouha = [];
for (let i = 0; i < 20; i++) dlouha.push({ id: 'pz_dl_' + String(i).padStart(2, '0'), text: 'Zpráva číslo ' + i + '. ' + 'Delší text, ať je co rolovat. '.repeat(1 + (i % 4)) });
dlouha.push({ id: 'pz_dl_zvyr', text: 'Zvýrazněná zpráva uprostřed konverzace' });
for (let i = 21; i < 30; i++) dlouha.push({ id: 'pz_dl_' + String(i).padStart(2, '0'), text: 'Zpráva číslo ' + i + '. ' + 'Ještě kus textu. '.repeat(1 + (i % 3)) });
dlouha.push({ id: 'pz_dl_resi_cizi', uid: 'uid-zamestnanec', text: 'Tohle teprve řeším (cizí)', stav: 0 });
dlouha.push({ id: 'pz_dl_resi_moje', uid: 'uid-spravce', text: 'Tohle teprve řeším (moje)', stav: 0 });
dlouha.push({ id: 'pz_dl_hotovo', uid: 'uid-zamestnanec', text: 'Hotová věc', stav: 1 });
dlouha.push({ id: 'pz_dl_bez', uid: 'uid-spravce', text: 'Bez štítku' });
// fotky u konce: náhledy 84×52 dorostou po načtení, mřížka (u dna, v dohledu)
// se načítá líně až po otevření, plná fotka (po kliknutí na poslední
// jednotlivou) na 320×200
for (let i = 1; i <= 4; i++) dlouha.push({ id: 'pz_dl_f' + i, uid: LIDE2[i % 2], text: 'Fotka ' + i, n: 1 });
dlouha.push({ id: 'pz_dl_mriz', uid: 'uid-zamestnanec', text: 'Tři fotky', n: 3 });
dlouha.push({ id: 'pz_dl_f5', uid: 'uid-spravce', text: 'Fotka 5', n: 1 });
dlouha.push({ id: 'pz_dl_last', uid: 'uid-zamestnanec', text: 'Poslední zpráva dlouhé konverzace' });
konverzace(KDL, 'Dlouhá konverzace', dlouha, TED - 3 * 864e5);

const druha = [];
for (let i = 0; i < 30; i++) druha.push({ id: 'pz_dr_' + String(i).padStart(2, '0'), text: 'Druhá konverzace, zpráva ' + i + '. ' + 'Text. '.repeat(1 + (i % 5)) });
druha.push({ id: 'pz_dr_last', uid: 'uid-zamestnanec', text: 'Poslední zpráva druhé konverzace' });
konverzace(KDR, 'Druhá konverzace', druha, TED - 2 * 864e5);

const JA = { uid: 'uid-spravce', email: 'spravce@example.test', jmeno: 'Test Správce', role: 'hlavni-spravce' };

let vysledky = [], chyby = 0;
const ok = (podminka, popis, detail) => {
  vysledky.push((podminka ? 'OK   ' : 'CHYBA') + ' ' + popis + (detail !== undefined && !podminka ? '  → ' + JSON.stringify(detail).slice(0, 300) : ''));
  if (!podminka) chyby++;
};
const pockej = (ms) => new Promise((r) => setTimeout(r, ms));

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
  }, { seed: SEED, clovek: JA });
  await kontext.addInitScript(PRAVIDLA);
  await kontext.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname === 'www.gstatic.com' && /firebase-(app|auth|firestore)\.js$/.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: MOCK });
    }
    if (u.hostname === 'script.google.com') return route.fulfill({ status: 200, body: 'ok' });
    if (/\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '/* náhražka */' });
    return route.abort('blockedbyclient');
  });
  const page = await kontext.newPage();
  page.__chyby = [];
  page.on('pageerror', (e) => page.__chyby.push('JS: ' + String(e.message || e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') page.__chyby.push('KON: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  // fotky zpráv dorazí se zpožděním – jako ze skutečné databáze (mění výšku až po otevření)
  await page.addInitScript(() => {
    window.__nacteno = [];
    const cekej = () => { if (window.KB && window.KB.nactiPoznObrazky) { const puvodni = window.KB.nactiPoznObrazky;
      window.KB.nactiPoznObrazky = (id) => { window.__nacteno.push(id); return new Promise((r) => setTimeout(r, 300)).then(() => puvodni(id)); }; }
      else setTimeout(cekej, 5); };
    cekej();
  });
  await page.goto('http://127.0.0.1:' + port + '/' + stranka, { waitUntil: 'load' });
  await page.waitForFunction(() => window.KB && window.KB.poznNacteno && (window.KB.users || []).length > 2, null, { timeout: 8000 });
  await pockej(300);
  return { page, kontext };
}

const db = (page) => page.evaluate(() => window.__TEST_EXPORT());
const zamitnuto = (page) => page.evaluate(() => (window.__TEST_ZAMITNUTO || []).slice());
const bub = (id) => '#chatZpravy [data-zprava="' + id + '"]';
const snimek = async (page, nazev) => { if (SNIMKY) await page.screenshot({ path: path.join(SNIMKY, nazev + '.png') }); };
/** Kolik px zbývá do konce okna zpráv (0 = úplně dole). */
const vDole = (page) => page.evaluate(() => { const b = document.getElementById('chatZpravy'); return Math.round(b.scrollHeight - b.scrollTop - b.clientHeight); });
const scrollTop = (page) => page.evaluate(() => document.getElementById('chatZpravy').scrollTop);
/** Je zpráva celá vidět v okně zpráv? */
const videt = (page, id) => page.evaluate((id) => {
  const box = document.getElementById('chatZpravy').getBoundingClientRect();
  const el = document.querySelector('#chatZpravy [data-zprava="' + id + '"]');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
}, id);
/** Počkat, až dorazí a vykreslí se všechny obrázky v okně zpráv (náhledy i líně načtené fotky). */
async function cekejKlid(page) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#chatZpravy img')).every((i) => !i.getAttribute('src') || i.complete), null, { timeout: 6000 });
  await pockej(500);      // líné načtení fotek (300 ms) + jejich vykreslení
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#chatZpravy img')).every((i) => !i.getAttribute('src') || i.complete), null, { timeout: 6000 });
  await pockej(150);
}
/** Posun okna zpráv rukou (jako kolečkem) a počkat na událost scroll. */
async function posun(page, kam) {
  await page.evaluate((kam) => { const b = document.getElementById('chatZpravy'); b.scrollTop = kam === 'dolu' ? b.scrollHeight : kam; }, kam);
  await pockej(250);
}
/** Nová zpráva od kolegy – jako by ji právě napsal (přes databázi). */
async function ciziZprava(page, id, text) {
  const stav = await db(page);
  const ms = Date.now();
  stav[P + 'zaznamy/' + id] = { listId: KDL, listNazev: 'Dlouhá konverzace', uid: 'uid-zamestnanec', jmeno: JM['uid-zamestnanec'],
    text: text, sdileni: LIDE2, createdMs: ms, ms: ms, nahled: '', obrazku: 0 };
  await page.evaluate((s) => window.__TEST_IMPORT(s), stav);
  await page.waitForSelector(bub(id), { timeout: 5000 });
  await pockej(300);
}
const barvy = (page, id) => page.evaluate((id) => {
  const e = document.querySelector('#chatZpravy [data-zprava="' + id + '"] .kz__bublina');
  const s = getComputedStyle(e);
  return { bg: s.backgroundColor, okraj: s.borderTopColor, stitek: (e.querySelector('.kz__stitek') || {}).textContent || '',
    text: s.color, moje: e.closest('.kz').classList.contains('kz--moje') };
}, id);
const ORANZ = 'rgb(255, 243, 214)', OKRAJ_O = 'rgb(180, 83, 9)';   // --warn-tint, --warn
const ZELENA = 'rgb(230, 245, 237)', OKRAJ_Z = 'rgb(22, 121, 74)'; // --ok-tint, --ok

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const prohlizec = await chromium.launch({ channel: 'chrome', headless: true });
  const stranky = [];
  try {
    /* ============================================== 1) PC 1280: otevření ===== */
    const A = await okno(prohlizec, port, 'poznamky.html', false);
    stranky.push(['PC', A.page]);
    await A.page.click('[data-konv="' + KDL + '"] .kdl__nazev');
    await A.page.waitForSelector(bub('pz_dl_last'));
    await cekejKlid(A.page);
    const nac = await A.page.evaluate(() => window.__nacteno.slice());
    ok(nac.includes('pz_dl_mriz'), 'fotky zprávy u konce se líně načetly (mění výšku po otevření)', nac);
    ok(await vDole(A.page) < 2 && await videt(A.page, 'pz_dl_last'), 'po otevření dlouhé konverzace je okno dole, poslední zpráva vidět (i po dorazení fotek)', await vDole(A.page));
    await snimek(A.page, 'A_otevreno_pc');

    // plná fotka místo náhledu (po kliknutí) bublinu zvětší – okno zůstane dole
    ok(await videt(A.page, 'pz_dl_f5'), 'kontrola: fotka u konce je vidět (klik ji nemusí rolovat)');
    await A.page.click(bub('pz_dl_f5') + ' .kz__foto');
    await A.page.waitForSelector('#kbLightbox.is-open img');
    await A.page.keyboard.press('Escape');
    await A.page.waitForFunction(() => { const i = document.querySelector('#chatZpravy [data-zprava="pz_dl_f5"] .kz__foto img'); return i && i.complete && i.getBoundingClientRect().height > 150; }, null, { timeout: 5000 });
    await pockej(200);
    ok(await vDole(A.page) < 2, 'po dosazení plné fotky (bublina vyšší) je okno pořád dole', await vDole(A.page));

    /* ---------------------------------------------- přepnutí v seznamu ----- */
    await A.page.click('#chatSeznam [data-konv="' + KDR + '"]');
    await A.page.waitForSelector(bub('pz_dr_last'));
    await pockej(300);
    ok(await vDole(A.page) < 2 && await videt(A.page, 'pz_dr_last'), 'po přepnutí na druhou konverzaci je okno dole', await vDole(A.page));
    await A.page.click('#chatSeznam [data-konv="' + KDL + '"]');
    await A.page.waitForSelector(bub('pz_dl_last'));
    await cekejKlid(A.page);
    ok(await vDole(A.page) < 2 && await videt(A.page, 'pz_dl_last'), 'po přepnutí zpět je okno dole', await vDole(A.page));

    /* ---------------------------------------------- vlastní odeslání ------- */
    await posun(A.page, 0);
    ok(await scrollTop(A.page) === 0, 'kontrola: odrolováno nahoru');
    await A.page.fill('#psaniText', 'Moje nová zpráva');
    await A.page.keyboard.press('Enter');
    await A.page.waitForFunction(() => Array.from(document.querySelectorAll('#chatZpravy .kz--moje .kz__text')).some((e) => e.textContent === 'Moje nová zpráva'), null, { timeout: 5000 });
    await pockej(300);
    const mojeId = await A.page.evaluate(() => { const e = Array.from(document.querySelectorAll('#chatZpravy .kz--moje')).pop(); return e.getAttribute('data-zprava'); });
    ok(await vDole(A.page) < 2 && await videt(A.page, mojeId), 'po odeslání vlastní zprávy okno sjede dolů, i když jsem četl starší', await vDole(A.page));

    // delší text v poli (pole roste, okno zpráv se zmenší) – poslední zpráva zůstane vidět
    await A.page.fill('#psaniText', 'řádek 1\nřádek 2\nřádek 3\nřádek 4\nřádek 5');
    await pockej(250);
    ok(await vDole(A.page) < 2 && await videt(A.page, mojeId), 'víceřádkový text v poli: okno zpráv se zmenšilo a zůstalo dole', await vDole(A.page));
    await A.page.fill('#psaniText', '');
    await pockej(250);
    ok(await vDole(A.page) < 2, 'po smazání textu (pole se zmenšilo) pořád dole', await vDole(A.page));

    /* ---------------------------------------------- cizí zpráva ------------ */
    await posun(A.page, 0);
    await posun(A.page, 400);
    const pred = await scrollTop(A.page);
    await ciziZprava(A.page, 'pz_dl_cizi_1', 'Nová zpráva od kolegy, když čtu starší');
    ok(Math.abs(await scrollTop(A.page) - pred) < 3 && !(await videt(A.page, 'pz_dl_cizi_1')), 'nová cizí zpráva při odrolování nahoru: pozice zůstane (čtu dál, kde jsem byl)', { pred, po: await scrollTop(A.page) });
    await posun(A.page, 'dolu');
    ok(await vDole(A.page) < 2, 'kontrola: rukou dole');
    await ciziZprava(A.page, 'pz_dl_cizi_2', 'Další zpráva od kolegy, když jsem dole');
    ok(await vDole(A.page) < 2 && await videt(A.page, 'pz_dl_cizi_2'), 'nová cizí zpráva, když jsem u dna: sjede na ni', await vDole(A.page));

    /* ---------------------------------------------- oranžová bublina ------- */
    const bC = await barvy(A.page, 'pz_dl_resi_cizi'), bM = await barvy(A.page, 'pz_dl_resi_moje'), bH = await barvy(A.page, 'pz_dl_hotovo'), bB = await barvy(A.page, 'pz_dl_bez');
    ok(bC.bg === ORANZ && bC.okraj === OKRAJ_O && /Řeší se/.test(bC.stitek) && !bC.moje, 'Řeší se: cizí bublina celá oranžová (--warn-tint, okraj --warn) se štítkem', bC);
    ok(bM.bg === ORANZ && bM.okraj === OKRAJ_O && /Řeší se/.test(bM.stitek) && bM.moje, 'Řeší se: moje bublina taky oranžová (přebije barvu mých zpráv)', bM);
    ok(bC.text === bM.text && bC.text === bB.text, 'text v oranžové bublině má stejnou (tmavou) barvu jako jinde – čitelný', [bC.text, bB.text]);
    ok(bH.bg === ZELENA && bH.okraj === OKRAJ_Z, 'Splněno zůstává zelené', bH);
    ok(bB.bg !== ORANZ && bB.bg !== ZELENA && !bB.stitek, 'bez štítku beze změny', bB);
    await A.page.$eval(bub('pz_dl_resi_moje'), (e) => e.scrollIntoView({ block: 'center' }));
    await pockej(200);
    await snimek(A.page, 'A_resi_pc');

    /* ---------------------------------------------- zpět / vpřed ----------- */
    await A.page.goBack();
    await A.page.waitForSelector('#prehled:not([hidden])');
    ok(await A.page.$eval('#chatObal', (e) => e.hidden), 'krok zpět vrátí dlaždice');
    await A.page.goForward();
    await A.page.waitForSelector('#chatObal:not([hidden]) ' + bub('pz_dl_cizi_2'));
    await cekejKlid(A.page);
    ok(await vDole(A.page) < 2 && await videt(A.page, 'pz_dl_cizi_2'), 'krok vpřed (návrat do konverzace) sjede dolů', await vDole(A.page));
    ok(await A.page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)) <= 1280, '1280 px: nic nepřetéká do šířky');

    /* ============================================== 2) ?konv= a ?pozn= ====== */
    const K = await okno(prohlizec, port, 'poznamky.html?konv=' + KDL, false);
    stranky.push(['PC ?konv=', K.page]);
    await K.page.waitForSelector('#chatObal:not([hidden]) ' + bub('pz_dl_last'));
    await cekejKlid(K.page);
    ok(await vDole(K.page) < 2 && await videt(K.page, 'pz_dl_last'), 'otevření přes ?konv= (odkaz z upozornění) sjede dolů', await vDole(K.page));

    const Z = await okno(prohlizec, port, 'poznamky.html?pozn=pz_dl_zvyr', false);
    stranky.push(['PC ?pozn=', Z.page]);
    await Z.page.waitForSelector('#chatObal:not([hidden]) .kz--zvyraznena');
    await cekejKlid(Z.page);
    const zv = await Z.page.evaluate(() => {
      const box = document.getElementById('chatZpravy').getBoundingClientRect();
      const r = document.querySelector('#chatZpravy .kz--zvyraznena').getBoundingClientRect();
      return { id: document.querySelector('#chatZpravy .kz--zvyraznena').getAttribute('data-zprava'), vOkne: r.top >= box.top && r.bottom <= box.bottom,
        stred: Math.abs((r.top + r.bottom) / 2 - (box.top + box.bottom) / 2) };
    });
    ok(zv.id === 'pz_dl_zvyr' && zv.vOkne && zv.stred < 120 && await vDole(Z.page) > 200, 'otevření přes ?pozn= má přednost: zvýrazněná zpráva uprostřed, ne dole', { zv, dole: await vDole(Z.page) });
    await snimek(Z.page, 'Z_zvyraznena_pc');

    /* ============================================== 3) telefon 375 px ======= */
    const T = await okno(prohlizec, port, 'poznamky.html', true);
    stranky.push(['telefon', T.page]);
    await T.page.tap('[data-konv="' + KDL + '"] .kdl__nazev');
    await T.page.waitForSelector('#chatObal:not([hidden]) ' + bub('pz_dl_last'));
    await cekejKlid(T.page);
    ok(await vDole(T.page) < 2 && await videt(T.page, 'pz_dl_last'), 'telefon: po otevření je okno dole, poslední zpráva vidět', await vDole(T.page));
    await snimek(T.page, 'T_otevreno');
    const bT = await barvy(T.page, 'pz_dl_resi_moje');
    ok(bT.bg === ORANZ && bT.okraj === OKRAJ_O, 'telefon: Řeší se oranžové', bT);
    await posun(T.page, 0);
    await T.page.fill('#psaniText', 'Z telefonu');
    await T.page.tap('#btnOdeslat');
    await T.page.waitForFunction(() => Array.from(document.querySelectorAll('#chatZpravy .kz--moje .kz__text')).some((e) => e.textContent === 'Z telefonu'), null, { timeout: 5000 });
    await pockej(300);
    ok(await vDole(T.page) < 2, 'telefon: po odeslání dole', await vDole(T.page));
    await T.page.tap('#btnZpet');
    await T.page.waitForSelector('#prehled:not([hidden])');
    await T.page.tap('[data-konv="' + KDR + '"] .kdl__nazev');
    await T.page.waitForSelector('#chatObal:not([hidden]) ' + bub('pz_dr_last'));
    await pockej(300);
    ok(await vDole(T.page) < 2 && await videt(T.page, 'pz_dr_last'), 'telefon: zpět a otevření jiné konverzace – dole', await vDole(T.page));
    ok(await T.page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)) <= 375, '375 px: nic nepřetéká do šířky');

    for (const [jmeno, page] of stranky) {
      ok(page.__chyby.length === 0, 'bez chyb JS a console.error (' + jmeno + ')', page.__chyby);
      const zam = await zamitnuto(page);
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
