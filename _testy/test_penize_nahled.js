// Klikací test (27. 10. 2026): peníze ve Výkazech jen po „Zobrazit peníze" v nabídce ⋯
// a zrušený přepínač „Zobrazit jako" (role = vždy skutečná role přihlášeného).
//   1) manažer, PC 1280: po načtení žádné Kč / Sazba / Částka; ⋯ vedle filtrů → Zobrazit peníze →
//      sloupce, dlaždice i součet dne; řádkové ⋯ → Skrýt peníze → pryč; formulář dne totéž (CSS)
//   2) manažer, telefon 375: totéž přes ⋯, nic nepřetéká
//   3) zaměstnanec: ⋯ vedle filtrů schované, v řádkovém ⋯ položka není, žádné peníze
//   4) nástěnka: „Zobrazit jako" v DOM není, zápis v sessionStorage se ignoruje a smaže,
//      přepínač Základní / Manažerská funguje na PC (hlavička) i na telefonu (pás)
// Napodobený Firebase z testy\prohlizec (jen čtení, nic se nezapisuje). Vzor: oznameni\test_oznameni.js.
//   node test_penize_nahled.js --repo <kopie webu> [--snimky <složka>]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const PROHLIZEC = 'D:/CLAUDE_PRACOVNI/NASTROJE/web/testy/prohlizec';
const { chromium } = require(PROHLIZEC + '/node_modules/playwright');

const arg = (j) => { const i = process.argv.indexOf('--' + j); return i === -1 ? null : process.argv[i + 1]; };
const REPO = path.resolve(arg('repo') || path.join(__dirname, '..'));
const SNIMKY = path.resolve(arg('snimky') || path.join(__dirname, 'snimky'));
fs.mkdirSync(SNIMKY, { recursive: true });
const MOCK = fs.readFileSync(PROHLIZEC + '/napodobeny_firebase.js', 'utf8');
const P = 'artifacts/firemni-kb-app/';

const DATA = require(PROHLIZEC + '/testovaci_data.js').vytvor(new Date());
const SEED = {};
Object.keys(DATA.dokumenty).forEach((k) => { SEED[P + k] = DATA.dokumenty[k]; });

const LIDE = {
  zam: { uid: 'uid-zamestnanec', email: 'zamestnanec@example.test', jmeno: 'Test Zaměstnanec', role: 'zamestnanec' },
  spr: { uid: 'uid-spravce', email: 'spravce@example.test', jmeno: 'Test Správce', role: 'hlavni-spravce' }
};
const MANAZERSKE = ['wDovolene', 'wRychly', 'wFakturyPlatby', 'wFakturyNove', 'wKontrola', 'wRozpocty', 'wAktivita'];

let vysledky = [], chyby = 0;
const ok = (podminka, popis, detail) => {
  vysledky.push((podminka ? 'OK   ' : 'CHYBA') + ' ' + popis + (detail !== undefined && !podminka ? '  → ' + JSON.stringify(detail).slice(0, 500) : ''));
  if (!podminka) chyby++;
};
const pockej = (t) => new Promise((r) => setTimeout(r, t));

const TYPY = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let cesta;
  try { cesta = path.join(REPO, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); } catch (e) { cesta = ''; }
  if (!cesta || !cesta.startsWith(REPO) || !fs.existsSync(cesta) || fs.statSync(cesta).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': (TYPY[path.extname(cesta)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(cesta).pipe(res);
});

async function otevri(prohlizec, port, kdo, stranka, telefon, cekej) {
  const clovek = LIDE[kdo];
  const kontext = await prohlizec.newContext(telefon
    ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'cs-CZ', timezoneId: 'Europe/Prague', serviceWorkers: 'block' }
    : { viewport: { width: 1280, height: 900 }, locale: 'cs-CZ', timezoneId: 'Europe/Prague', serviceWorkers: 'block' });
  await kontext.addInitScript(({ seed, clovek }) => {
    window.__TEST_SEED = seed;
    window.__TEST_UZIVATEL = { uid: clovek.uid, email: clovek.email };
    try {
      localStorage.setItem('company_kb_username', clovek.jmeno);
      localStorage.setItem('company_kb_email', clovek.email);
      localStorage.setItem('company_kb_role', clovek.role);
      // pozůstatek zrušeného náhledu „Zobrazit jako" – web ho musí ignorovat a uklidit
      sessionStorage.setItem('company_kb_nahled', 'zamestnanec');
    } catch (e) { /* nic */ }
  }, { seed: SEED, clovek });
  await kontext.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname === 'www.gstatic.com' && /firebase-(app|auth|firestore)\.js$/.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: MOCK });
    }
    return route.abort('blockedbyclient');
  });
  const page = await kontext.newPage();
  page.__chyby = [];
  page.on('pageerror', (e) => page.__chyby.push('JS: ' + String(e.message || e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.__chyby.push('KON: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => { page.__chyby.push('DIALOG: ' + d.message()); d.dismiss().catch(() => {}); });
  await page.goto('http://127.0.0.1:' + port + '/' + stranka, { waitUntil: 'load' });
  await page.waitForSelector(cekej, { timeout: 10000 });
  await pockej(700);
  return { page, kontext, kdo };
}

// viditelný text hlavního obsahu (innerText vynechá hidden i display:none; POZOR: nese
// i text-transform, takže hlavičky tabulky a popisky dlaždic přijdou VELKÝMI – porovnává se bez ohledu na velikost)
const textMain = (page) => page.evaluate(() => Array.from(document.querySelectorAll('main')).map((m) => m.innerText || '').join(' '));
const sirka = (page) => page.evaluate(() => document.documentElement.scrollWidth);
const penizeVidet = async (page) => {
  const t = await textMain(page);
  const hlava = await page.$eval('#tabulka thead', (e) => e.innerText).catch(() => '');
  return { kc: /Kč/.test(t), sazba: /sazba/i.test(t), castka: /částka/i.test(t), hlavaSazba: /sazba/i.test(hlava) && /částka/i.test(hlava),
    dlazdice: /fakturováno/i.test(t) && /průměrná sazba/i.test(t), telo: await page.evaluate(() => document.body.classList.contains('penize-videt')) };
};
const polozkyNabidky = async (page, tlacitko) => {
  await page.click(tlacitko);
  await page.waitForSelector('.nabidka', { timeout: 4000 });
  const p = await page.$$eval('.nabidka .nabidka__polozka', (els) => els.map((e) => e.textContent.trim()));
  return p;
};
const nahledVDom = (page) => page.evaluate(() => ({
  prepinac: !!document.querySelector('[data-nahled], [data-nahled-box], [data-nahled-konec], #kbNahledPruh'),
  text: /Zobrazit jako|Prohlížíš web jako/.test(document.body.innerText || ''),
  role: window.KBUI.role(), skutecna: window.KBUI.skutecnaRole(),
  klic: (() => { try { return sessionStorage.getItem('company_kb_nahled'); } catch (e) { return 'chyba'; } })()
}));
async function konec(o, popis) {
  ok(o.page.__chyby.length === 0, popis + ': bez chyb JS a console.error', o.page.__chyby);
  await o.kontext.close();
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const prohlizec = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    /* ===== 1) manažer, PC: peníze až po ⋯ ================================= */
    const A = await otevri(prohlizec, port, 'spr', 'vykazy.html', false, '#tabulka tr[data-zid]');
    let n = await nahledVDom(A.page);
    ok(!n.prepinac && !n.text && n.role === 'hlavni-spravce' && n.skutecna === 'hlavni-spravce' && n.klic === null,
      'manažer: „Zobrazit jako" v DOM není, zápis v sessionStorage se ignoroval a smazal, role = hlavní správce', n);
    let v = await penizeVidet(A.page);
    ok(!v.kc && !v.sazba && !v.castka && !v.hlavaSazba && !v.dlazdice && !v.telo, 'manažer po načtení: žádné Kč, Sazba, Částka ani dlaždice s penězi', v);
    const akce = await A.page.$eval('#souhrnAkce', (e) => ({ hidden: e.hidden, tl: !!e.querySelector('[data-nabidka-vic]'), viditelne: e.getBoundingClientRect().width > 0 }));
    ok(!akce.hidden && akce.tl && akce.viditelne, 'manažer: ⋯ vedle filtrů je vidět a má tlačítko z KBNabidka', akce);
    ok(await A.page.$eval('#btnCsv', (e) => !e.hidden), 'manažer: Stáhnout CSV zůstalo (manažerské prvky podle skutečné role)');
    await A.page.screenshot({ path: path.join(SNIMKY, 'PC1_vykazy_bez_penez.png'), fullPage: true });
    let pol = await polozkyNabidky(A.page, '#souhrnAkce [data-nabidka-vic]');
    ok(pol.length === 1 && pol[0] === 'Zobrazit peníze (sazby a částky)', 'nabídka ⋯ vedle filtrů: jediná položka „Zobrazit peníze (sazby a částky)"', pol);
    await A.page.click('.nabidka .nabidka__polozka');
    await pockej(400);
    v = await penizeVidet(A.page);
    ok(v.kc && v.hlavaSazba && v.dlazdice && v.telo, 'po „Zobrazit peníze": sloupce Sazba a Částka, dlaždice Průměrná sazba a Fakturováno, body.penize-videt', v);
    const den = await A.page.$eval('#tabulka tr.vyk__den', (e) => e.innerText);
    const bunka = await A.page.$eval('#tabulka tr[data-zid] td[data-l="Částka"]', (e) => e.innerText);
    ok(/Kč/.test(den) && /Kč/.test(bunka) && !/•••/.test(den + bunka), 'součet dne i buňka Částka mají Kč, bez zástupných teček', { den, bunka });
    await A.page.screenshot({ path: path.join(SNIMKY, 'PC2_vykazy_s_penezi.png'), fullPage: true });
    // řádkové ⋯: Skrýt peníze mezi ostatními akcemi
    pol = await polozkyNabidky(A.page, '#tabulka tr[data-zid] [data-nabidka-vic]');
    ok(pol.indexOf('Skrýt peníze') !== -1 && pol.indexOf('Zobrazit peníze (sazby a částky)') === -1 && pol.length > 1,
      'řádkové ⋯ při zapnutých penězích: „Skrýt peníze" vedle ostatních akcí', pol);
    await A.page.keyboard.press('Escape');
    await pockej(200);
    // formulář dne: sazba a částka jdou s přepínačem (CSS), skryté pole sazby zůstává v DOM
    await A.page.click('#btnZapis');
    await A.page.waitForSelector('#zapis:not([hidden]) [data-polozka]', { timeout: 5000 });
    const form = (page) => page.evaluate(() => {
      const viditelny = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
      const blok = document.querySelector('#zapis .jen-penize');
      return { sazbaBlok: viditelny(blok), kc: viditelny(document.querySelector('#zapis [data-vysledek-kc]')),
        pole: !!document.querySelector('#zapis [data-f="sazba"]'), text: document.getElementById('zapis').innerText };
    });
    let f = await form(A.page);
    ok(f.sazbaBlok && f.kc && f.pole && /sazba \(kč\/h\)/i.test(f.text), 'formulář při zapnutých penězích: Sazba (Kč/h) i částka vidět', { sazbaBlok: f.sazbaBlok, kc: f.kc, pole: f.pole, text: f.text.slice(0, 300) });
    pol = await polozkyNabidky(A.page, '#souhrnAkce [data-nabidka-vic]');
    ok(pol.length === 1 && pol[0] === 'Skrýt peníze', 'nabídka ⋯ vedle filtrů při zapnutých penězích: „Skrýt peníze"', pol);
    await A.page.click('.nabidka .nabidka__polozka');
    await pockej(400);
    v = await penizeVidet(A.page);
    f = await form(A.page);
    ok(!v.kc && !v.sazba && !v.castka && !v.hlavaSazba && !v.dlazdice && !v.telo, 'po „Skrýt peníze": tabulka i dlaždice zase bez peněz (i s otevřeným formulářem)', v);
    ok(!f.sazbaBlok && !f.kc && f.pole && !/Kč/.test(f.text), 'formulář po skrytí: sazba a částka schované, skryté pole sazby v DOM zůstalo', { sazbaBlok: f.sazbaBlok, kc: f.kc, pole: f.pole });
    pol = await polozkyNabidky(A.page, '#tabulka tr[data-zid] [data-nabidka-vic]');
    ok(pol.indexOf('Zobrazit peníze (sazby a částky)') !== -1 && pol.indexOf('Skrýt peníze') === -1, 'řádkové ⋯ po skrytí: zase „Zobrazit peníze"', pol);
    await A.page.keyboard.press('Escape');
    ok(await sirka(A.page) <= 1280, 'PC: nic nepřetéká', await sirka(A.page));
    await konec(A, 'manažer PC');

    /* ===== 2) manažer, telefon 375 ======================================= */
    const T = await otevri(prohlizec, port, 'spr', 'vykazy.html', true, '#tabulka tr[data-zid]');
    v = await penizeVidet(T.page);
    ok(!v.kc && !v.sazba && !v.castka, 'telefon po načtení: žádné peníze', v);
    pol = await polozkyNabidky(T.page, '#souhrnAkce [data-nabidka-vic]');
    ok(pol[0] === 'Zobrazit peníze (sazby a částky)', 'telefon: ⋯ vedle filtrů nabízí Zobrazit peníze', pol);
    await T.page.click('.nabidka .nabidka__polozka');
    await pockej(400);
    v = await penizeVidet(T.page);
    ok(v.kc && v.hlavaSazba && v.dlazdice, 'telefon po zapnutí: sloupce i dlaždice s penězi', v);
    ok(await sirka(T.page) <= 375, 'telefon se zapnutými penězi: nic nepřetéká (375 px)', await sirka(T.page));
    await T.page.screenshot({ path: path.join(SNIMKY, 'TEL1_vykazy_s_penezi.png'), fullPage: true });
    n = await nahledVDom(T.page);
    ok(!n.prepinac && !n.text && n.klic === null, 'telefon: „Zobrazit jako" nikde', n);
    await konec(T, 'manažer telefon');

    /* ===== 3) zaměstnanec: položku nemá =================================== */
    const Z = await otevri(prohlizec, port, 'zam', 'vykazy.html', false, '#tabulka tr[data-zid]');
    v = await penizeVidet(Z.page);
    ok(!v.kc && !v.sazba && !v.castka && !v.dlazdice, 'zaměstnanec: žádné peníze', v);
    ok(await Z.page.$eval('#souhrnAkce', (e) => e.hidden), 'zaměstnanec: ⋯ vedle filtrů schované');
    pol = await polozkyNabidky(Z.page, '#tabulka tr[data-zid] [data-nabidka-vic]');
    ok(pol.length > 0 && !pol.some((p) => /peníze/i.test(p)), 'zaměstnanec: řádkové ⋯ bez položky o penězích', pol);
    await Z.page.keyboard.press('Escape');
    n = await nahledVDom(Z.page);
    ok(n.role === 'zamestnanec' && !n.prepinac && n.klic === null, 'zaměstnanec: role zaměstnanec, bez přepínače', n);
    await konec(Z, 'zaměstnanec');

    /* ===== 4) nástěnka: Základní / Manažerská bez „Zobrazit jako" ========== */
    const rezimy = (page) => page.evaluate((MAN) => {
      const box = document.getElementById('rezimBox');
      const karty = Array.from(document.querySelectorAll('.nastenka > .nastenka__karta'));
      const videt = (k) => k.style.display !== 'none' && !k.hidden;
      return { je: !!box, hidden: box ? box.hidden : null, rodic: box && box.parentElement ? (box.parentElement.getAttribute('data-nahled-slot') !== null ? 'slot' : box.parentElement.tagName) : '',
        vPasu: !!(box && box.closest('[data-rail-nahled]')), vHlavicce: !!(box && box.closest('.appbar__bandin')),
        vlevo: box ? Math.round(box.getBoundingClientRect().left) : -1,
        manazerskeVidet: karty.filter((k) => MAN.indexOf(k.id) !== -1 && videt(k)).length,
        zakladniVidet: karty.filter((k) => MAN.indexOf(k.id) === -1 && videt(k)).length,
        aktivni: (document.querySelector('[data-rezim].chip--active') || {}).dataset ? document.querySelector('[data-rezim].chip--active').dataset.rezim : '' };
    }, MANAZERSKE);
    const N = await otevri(prohlizec, port, 'spr', 'index.html', false, '#rezimBox');
    let r = await rezimy(N.page);
    ok(r.je && !r.hidden && r.rodic === 'slot' && r.vHlavicce && r.vlevo < 500, 'PC: přepínač Základní/Manažerská ve slotu hlavičky vlevo', r);
    ok(r.aktivni === 'zakladni' && r.manazerskeVidet === 0 && r.zakladniVidet > 0, 'PC: výchozí Základní – manažerské dlaždice schované', r);
    await N.page.click('[data-rezim="manazerska"]');
    await pockej(300);
    r = await rezimy(N.page);
    ok(r.aktivni === 'manazerska' && r.manazerskeVidet > 0 && r.zakladniVidet === 0, 'PC: Manažerská ukáže manažerské dlaždice, základní schová', r);
    await N.page.screenshot({ path: path.join(SNIMKY, 'PC3_nastenka_manazerska.png') });
    await N.page.click('[data-rezim="zakladni"]');
    await pockej(300);
    r = await rezimy(N.page);
    ok(r.aktivni === 'zakladni' && r.manazerskeVidet === 0, 'PC: zpět na Základní', r);
    n = await nahledVDom(N.page);
    ok(!n.prepinac && !n.text && n.klic === null && n.role === 'hlavni-spravce', 'nástěnka: „Zobrazit jako" v DOM není, role skutečná', n);
    await konec(N, 'nástěnka PC');

    const NT = await otevri(prohlizec, port, 'spr', 'index.html', true, '#rezimBox');
    r = await rezimy(NT.page);
    ok(r.je && !r.hidden && r.rodic === 'slot' && r.vPasu, 'telefon: přepínač ve slotu přestěhovaném do pásu', r);
    // pás je na telefonu za okrajem – klepne se programově, ověřuje se logika přepnutí
    await NT.page.evaluate(() => document.querySelector('[data-rezim="manazerska"]').click());
    await pockej(300);
    r = await rezimy(NT.page);
    ok(r.aktivni === 'manazerska' && r.manazerskeVidet > 0 && r.zakladniVidet === 0, 'telefon: Manažerská funguje', r);
    await NT.page.evaluate(() => document.querySelector('[data-rezim="zakladni"]').click());
    await pockej(300);
    r = await rezimy(NT.page);
    ok(r.aktivni === 'zakladni' && r.manazerskeVidet === 0, 'telefon: zpět na Základní', r);
    ok(await sirka(NT.page) <= 375, 'telefon nástěnka: nic nepřetéká', await sirka(NT.page));
    await NT.page.screenshot({ path: path.join(SNIMKY, 'TEL2_nastenka.png') });
    await konec(NT, 'nástěnka telefon');

    const NZ = await otevri(prohlizec, port, 'zam', 'index.html', false, '#quickSeznam');
    r = await rezimy(NZ.page);
    ok(!r.je || r.hidden, 'zaměstnanec: přepínač Základní/Manažerská nevidí', r);
    ok(r.manazerskeVidet === 0, 'zaměstnanec: manažerské dlaždice schované', r);
    await konec(NZ, 'nástěnka zaměstnanec');
  } catch (e) {
    ok(false, 'test spadl: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | '));
  } finally {
    await prohlizec.close();
    server.close();
  }
  console.log(vysledky.join('\n'));
  console.log('\n' + (vysledky.length - chyby) + ' / ' + vysledky.length + ' OK · snímky: ' + SNIMKY);
  process.exit(chyby ? 1 : 0);
})();
