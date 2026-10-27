// Klikací test zámku citlivých sekcí na stránkách pod PROJEKTY (27. 10. 2026, KBUI.zamekCitlive):
// pět stránek zamčených, špatné a správné heslo, odemčení napříč stránkami (sessionStorage),
// vypršení po třech minutách (podvržený čas), bez založeného hesla (hlavní správce × manažer),
// Nastavení (založení, zamknutí, změna hesla), podlišty PROJEKTY a VÝKAZY, šířky 375 a 1280 px.
// Napodobený Firebase z testy\prohlizec (napodobeny_firebase.js), data z testovaci_data.js,
// na skutečnou databázi nesahá. Testovací heslo je vymyšlené, s ničím skutečným nesouvisí.
//   "C:\Program Files\FARO\SCENE\LidarOS\node\node.exe" _testy\test_zamek_projekty.js [--repo <kopie webu>]
// Snímky: testy\prohlizec\vystup\zamek\ (mimo repozitář).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PROHLIZEC = 'D:/CLAUDE_PRACOVNI/NASTROJE/web/testy/prohlizec';
const { chromium } = require(PROHLIZEC + '/node_modules/playwright');

const arg = (j) => { const i = process.argv.indexOf('--' + j); return i === -1 ? null : process.argv[i + 1]; };
const REPO = path.resolve(arg('repo') || path.join(__dirname, '..'));
const SNIMKY = path.join(PROHLIZEC, 'vystup', 'zamek');
fs.mkdirSync(SNIMKY, { recursive: true });
const MOCK = fs.readFileSync(PROHLIZEC + '/napodobeny_firebase.js', 'utf8');
const APP = 'firemni-kb-app';
const P = (k) => 'artifacts/' + APP + '/' + k;
const DATA = require(PROHLIZEC + '/testovaci_data.js').vytvor(new Date());

/* otisk stejně jako KBUI.hashPassword: SHA-256(salt + ":" + heslo), hex */
const otisk = (heslo, salt) => crypto.createHash('sha256').update(salt + ':' + heslo, 'utf8').digest('hex');
// smyšlené testovací hodnoty; skládají se z částí, ať je hlídač tajemství v gitu nebere za skutečné heslo
const HESLO = ['opona', 'test', '2026'].join('-');
const SALT = ['salt', 'test', 'zamek'].join('-');
const HASH = otisk(HESLO, SALT);
const KLIC = 'company_kb_zamek';
const ZAMEK = P('private/nastaveni/zamek/heslo');

const SEED = {};
Object.keys(DATA.dokumenty).forEach((k) => { SEED[P(k)] = JSON.parse(JSON.stringify(DATA.dokumenty[k])); });
SEED[ZAMEK] = { salt: SALT, hash: HASH, updatedMs: Date.now() - 1000, updatedBy: 'Test Správce' };
// běžný manažer (role spravce): heslo zakládat nesmí, bez něj mu zámek obsah neukáže
SEED[P('public/data/users/uid-manazer')] = Object.assign({}, SEED[P('public/data/users/uid-spravce')],
  { email: 'manazer@example.test', first: 'Test', last: 'Manažer', role: 'spravce' });
const BEZ_HESLA = Object.assign({}, SEED);
delete BEZ_HESLA[ZAMEK];

const LIDE = {
  spr: { uid: 'uid-spravce', email: 'spravce@example.test', jmeno: 'Test Správce', role: 'hlavni-spravce' },
  man: { uid: 'uid-manazer', email: 'manazer@example.test', jmeno: 'Test Manažer', role: 'spravce' },
  zam: { uid: 'uid-zamestnanec', email: 'zamestnanec@example.test', jmeno: 'Test Zaměstnanec', role: 'zamestnanec' }
};
const STRANKY = ['sprava.html', 'gantt.html', 'zamestnanci.html', 'firmy.html', 'vykazy-prehled.html'];
const PODLISTA = ['SPRÁVA PROJEKTŮ', 'PLÁN PROJEKTŮ', 'SPRÁVA ZAMĚSTNANCŮ', 'SPRÁVA FIREM', 'CELKOVÝ PŘEHLED'];
const AKTIVNI = { 'sprava.html': 'SPRÁVA PROJEKTŮ', 'gantt.html': 'PLÁN PROJEKTŮ', 'zamestnanci.html': 'SPRÁVA ZAMĚSTNANCŮ',
  'firmy.html': 'SPRÁVA FIREM', 'vykazy-prehled.html': 'CELKOVÝ PŘEHLED' };

const vysledky = []; let chyby = 0;
const ok = (podminka, popis, detail) => {
  vysledky.push((podminka ? 'OK   ' : 'CHYBA') + ' ' + popis + (detail !== undefined && !podminka ? '  → ' + JSON.stringify(detail).slice(0, 400) : ''));
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

/** Nové okno (kontext) s přihlášeným člověkem; `sirka` v px (pod 768 = telefon), `session` = co dát do sessionStorage. */
async function okno(prohlizec, port, kdo, stranka, seed, sirka, session) {
  const clovek = LIDE[kdo];
  const telefon = sirka < 768;
  const kontext = await prohlizec.newContext(Object.assign(
    { viewport: { width: sirka, height: telefon ? 812 : 900 }, locale: 'cs-CZ', timezoneId: 'Europe/Prague', serviceWorkers: 'block' },
    telefon ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}));
  await kontext.addInitScript(({ seed, clovek, session }) => {
    window.__TEST_SEED = seed;
    window.__TEST_UZIVATEL = { uid: clovek.uid, email: clovek.email };
    try {
      localStorage.setItem('company_kb_username', clovek.jmeno);
      localStorage.setItem('company_kb_email', clovek.email);
      localStorage.setItem('company_kb_role', clovek.role);
      // jen při prvním načtení – po prokliku na další stránku zůstává, co si web uložil sám
      if (session && !sessionStorage.getItem('__session_dano')) {
        Object.keys(session).forEach((k) => sessionStorage.setItem(k, session[k]));
        sessionStorage.setItem('__session_dano', '1');
      }
    } catch (e) { /* nic */ }
  }, { seed, clovek, session: session || null });
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
  page.on('pageerror', (e) => page.__chyby.push('JS: ' + String(e.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT|favicon/.test(m.text())) page.__chyby.push('KON: ' + m.text().slice(0, 300)); });
  page.on('dialog', (d) => { page.__chyby.push('DIALOG: ' + d.message()); d.dismiss().catch(() => {}); });
  const o = { page, kontext, kdo, port };
  await jdi(o, stranka);
  return o;
}

/** Přechod na stránku ve stejné záložce (sessionStorage zůstává) a čekání, až se zámek rozhodne. */
async function jdi(o, stranka) {
  await o.page.goto('http://127.0.0.1:' + o.port + '/' + stranka, { waitUntil: 'load' });
  await o.page.waitForFunction(() => window.KB && (window.KB.users || []).length > 2, null, { timeout: 10000 });
  // karta zámku existuje na každé stránce s oponou; „Zjišťuji…“ znamená, že se ještě čte databáze
  await o.page.waitForFunction(() => {
    const k = document.querySelector('[data-zamek-karta]');
    return k && !/Zjišťuji/.test((k.querySelector('[data-zamek-popis]') || {}).textContent || '');
  }, null, { timeout: 8000 }).catch(() => {});
  await pockej(400);
}

/** Co je zrovna vidět: karta zámku, pole s heslem, obsah stránky. */
const stav = (page, obsahId) => page.evaluate((obsahId) => {
  const videt = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  const k = document.querySelector('[data-zamek-karta]');
  const obsah = document.getElementById(obsahId || 'obsah');
  return {
    karta: videt(k), form: videt(k && k.querySelector('[data-zamek-form]')),
    nadpis: (k && k.querySelector('[data-zamek-nadpis]').textContent) || '',
    popis: (k && k.querySelector('[data-zamek-popis]').textContent) || '',
    obsah: videt(obsah), zamceno: !!(obsah && obsah.hasAttribute('data-zamceno')),
    stop: videt(document.getElementById('stop') || document.getElementById('bezPrav')),
    session: sessionStorage.getItem('company_kb_zamek') || ''
  };
}, obsahId || 'obsah');
const podlista = (page) => page.$$eval('#appSubbar .subbar__cat', els => ({
  polozky: els.filter(e => !e.hidden).map(e => e.textContent.trim()),
  aktivni: els.filter(e => e.tagName === 'SPAN' && !e.hidden).map(e => e.textContent.trim()),
  zamky: els.filter(e => !e.hidden && e.querySelector('svg.subbar__zamek') && /heslem/.test(e.title)).length
}));
const horniAktivni = (page) => page.$$eval('.appbar__nav .navbtn--active', els => els.map(e => e.textContent.trim().replace(/\s+/g, ' ')));
const toast = (page) => page.evaluate(() => (document.getElementById('kbToast') || {}).textContent || '');
const sirkaDok = (page) => page.evaluate(() => document.documentElement.scrollWidth);
const dbZamek = (page) => page.evaluate((c) => window.__TEST_FB.docs.get(c) || null, ZAMEK);
async function odemkni(page, heslo) {
  await page.fill('[data-zamek-karta] [data-zamek-heslo]', heslo);
  await page.click('[data-zamek-karta] [data-zamek-odemknout]');
  await pockej(500);
}
async function konec(o, popis) {
  ok(o.page.__chyby.length === 0, popis + ': bez chyb JS a console.error', o.page.__chyby);
  await o.kontext.close();
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const prohlizec = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    /* ===== 1) hlavní správce, 1280 px: pět stránek zamčených, podlišty ======== */
    for (const stranka of STRANKY) {
      const o = await okno(prohlizec, port, 'spr', stranka, SEED, 1280);
      const s = await stav(o.page);
      ok(s.karta && s.form && !s.obsah && s.zamceno && !s.stop && /Zamčeno – zadej heslo/.test(s.nadpis),
        stranka + ': zamčeno – karta s heslem, obsah schovaný', s);
      const p = await podlista(o.page);
      ok(JSON.stringify(p.polozky) === JSON.stringify(PODLISTA) && p.aktivni.join() === AKTIVNI[stranka] && p.zamky === 5,
        stranka + ': podlišta PROJEKTY s Celkovým přehledem na konci, aktivní položka sedí, zámky s nápovědou', p);
      const nav = await horniAktivni(o.page);
      ok(nav.some(t => /PROJEKTY/.test(t)), stranka + ': v horní liště svítí PROJEKTY', nav);
      ok(await sirkaDok(o.page) <= 1280, stranka + ' 1280 px: nic nepřetéká', await sirkaDok(o.page));
      if (stranka === 'sprava.html') await o.page.screenshot({ path: path.join(SNIMKY, 'PC1_sprava_zamceno.png'), fullPage: true });
      await konec(o, stranka + ' zamčeno');
    }

    /* ===== 2) špatné heslo, správné heslo, odemčení napříč stránkami ========== */
    const A = await okno(prohlizec, port, 'spr', 'sprava.html', SEED, 1280);
    await odemkni(A.page, 'spatne-heslo');
    let s = await stav(A.page);
    ok(/Nesprávné heslo/.test(await toast(A.page)) && s.karta && !s.obsah && !s.session, 'špatné heslo: hláška, dál zamčeno, nic v sessionStorage', s);
    await A.page.fill('[data-zamek-karta] [data-zamek-heslo]', HESLO);
    await A.page.press('[data-zamek-karta] [data-zamek-heslo]', 'Enter');
    await pockej(500);
    s = await stav(A.page);
    let ses = {}; try { ses = JSON.parse(s.session); } catch (e) { /* nic */ }
    ok(!s.karta && s.obsah && !s.zamceno && ses.v === HASH && Math.abs(Date.now() - ses.ms) < 60000 && /Odemčeno/.test(await toast(A.page)),
      'správné heslo (Enter): obsah vidět, karta pryč, otisk v sessionStorage s časem', s);
    ok(await A.page.isVisible('#seznamVypis'), 'Správa: seznam projektů vykreslený');
    await A.page.screenshot({ path: path.join(SNIMKY, 'PC2_sprava_odemceno.png'), fullPage: true });
    for (const stranka of STRANKY.slice(1)) {
      await jdi(A, stranka);
      s = await stav(A.page);
      ok(!s.karta && s.obsah && !s.zamceno, stranka + ': po odemčení Správy otevřeno bez hesla', s);
    }
    await jdi(A, 'nastaveni.html');
    s = await stav(A.page, 'sekce-sazby');
    const nast = await A.page.evaluate(() => ({ akce: !document.getElementById('zamekAkce').hidden, zmenit: !document.getElementById('btnZmenit').hidden,
      sazeb: document.querySelectorAll('#sazby [data-sazba]').length, karta: !document.getElementById('zamek').hidden }));
    ok(!s.karta && s.obsah && nast.akce && nast.zmenit && nast.sazeb > 0 && !nast.karta, 'Nastavení: sazby odemčené stejným odemčením, Zamknout + Změnit heslo', { s, nast });

    /* ===== 3) vypršení po třech minutách (podvržený čas) ====================== */
    await jdi(A, 'gantt.html');
    ok((await stav(A.page)).obsah, 'Plán před vypršením odemčený');
    await A.page.evaluate(() => { const p = Date.now; Date.now = () => p() + 3 * 60 * 1000 + 5000; });
    await A.page.waitForFunction(() => { const k = document.querySelector('[data-zamek-karta]'); return k && !k.hidden; }, null, { timeout: 25000 }).catch(() => {});
    s = await stav(A.page);
    ok(s.karta && s.form && !s.obsah && s.zamceno && !s.session, 'po 3 minutách bez práce: obsah zase schovaný, heslo se chce znovu, sessionStorage prázdné', s);
    await konec(A, 'odemčení a vypršení');
    // zapamatované odemčení staré víc než 3 minuty = při načtení stránky zamčeno
    const B = await okno(prohlizec, port, 'spr', 'firmy.html', SEED, 1280, { [KLIC]: JSON.stringify({ v: HASH, ms: Date.now() - 4 * 60 * 1000 }) });
    s = await stav(B.page);
    ok(s.karta && !s.obsah && !s.session, 'staré odemčení (4 min) při načtení neplatí', s);
    await konec(B, 'staré odemčení');
    // čerstvé zapamatované odemčení (jako po přechodu z jiné stránky) = otevřeno
    const C = await okno(prohlizec, port, 'man', 'vykazy-prehled.html', SEED, 1280, { [KLIC]: JSON.stringify({ v: HASH, ms: Date.now() }) });
    s = await stav(C.page);
    ok(!s.karta && s.obsah, 'manažer s čerstvým odemčením: Celkový přehled otevřený', s);
    await konec(C, 'manažer odemčeno');

    /* ===== 4) bez založeného hesla ============================================ */
    const D = await okno(prohlizec, port, 'spr', 'sprava.html', BEZ_HESLA, 1280);
    s = await stav(D.page);
    ok(s.karta && !s.form && s.obsah && /zatím nikdo nenastavil/.test(s.popis) && /hlavní správce v Nastavení/.test(s.popis),
      'bez hesla – hlavní správce: obsah odemčený, karta jen s textem, bez pole', s);
    await D.page.screenshot({ path: path.join(SNIMKY, 'PC3_bez_hesla_spravce.png'), fullPage: true });
    await konec(D, 'bez hesla – hlavní správce');
    const E = await okno(prohlizec, port, 'man', 'sprava.html', BEZ_HESLA, 1280);
    s = await stav(E.page);
    ok(s.karta && !s.form && !s.obsah && s.zamceno && /nastaví ho hlavní správce v Nastavení/.test(s.popis),
      'bez hesla – manažer: zamčeno, text o hlavním správci, bez pole', s);
    await konec(E, 'bez hesla – manažer');
    const F = await okno(prohlizec, port, 'zam', 'sprava.html', SEED, 1280);
    s = await stav(F.page);
    ok(!s.karta && !s.obsah && s.stop, 'zaměstnanec: žádná karta zámku, jen „nemáš právo“', s);
    await konec(F, 'zaměstnanec');

    /* ===== 5) Nastavení: založení hesla, zamknutí, odemknutí, změna =========== */
    const N = await okno(prohlizec, port, 'spr', 'nastaveni.html', BEZ_HESLA, 1280);
    s = await stav(N.page, 'sekce-sazby');
    let n = await N.page.evaluate(() => ({ karta: !document.getElementById('zamek').hidden, uloz: document.getElementById('btnZmenaUloz').textContent,
      stare: !document.getElementById('zStareBox').hidden, akce: !document.getElementById('zamekAkce').hidden, sazeb: document.querySelectorAll('#sazby [data-sazba]').length }));
    ok(s.karta && !s.form && s.obsah && n.karta && n.uloz === 'Nastavit heslo' && !n.stare && !n.akce && n.sazeb > 0,
      'Nastavení bez hesla: sazby vidět, karta Založení hesla (bez stávajícího), bez Zamknout', { s, n });
    await N.page.fill('#zNove', 'abc');
    await N.page.fill('#zNove2', 'abc');
    await N.page.click('#btnZmenaUloz');
    await pockej(300);
    ok(/aspoň 6 znaků/.test(await toast(N.page)) && !(await dbZamek(N.page)), 'krátké heslo se neuloží', await toast(N.page));
    const NOVE = ['nove', 'test', '1'].join('-');   // opět smyšlené, skládané kvůli hlídači tajemství
    await N.page.fill('#zNove', NOVE);
    await N.page.fill('#zNove2', NOVE);
    await N.page.click('#btnZmenaUloz');
    await pockej(500);
    let d = await dbZamek(N.page);
    s = await stav(N.page, 'sekce-sazby');
    try { ses = JSON.parse(s.session); } catch (e) { ses = {}; }
    n = await N.page.evaluate(() => ({ karta: !document.getElementById('zamek').hidden, akce: !document.getElementById('zamekAkce').hidden }));
    ok(d && d.salt && d.hash === otisk(NOVE, d.salt) && ses.v === d.hash && !s.karta && s.obsah && !n.karta && n.akce,
      'založení hesla: otisk se solí v databázi, odemčeno a zapamatováno, karta pryč, Zamknout vidět', { d: d && Object.keys(d), s, n });
    await N.page.screenshot({ path: path.join(SNIMKY, 'PC4_nastaveni_odemceno.png'), fullPage: true });
    await N.page.click('#btnZamknout');
    await pockej(400);
    s = await stav(N.page, 'sekce-sazby');
    n = await N.page.evaluate(() => ({ sazeb: document.querySelectorAll('#sazby [data-sazba]').length, akce: !document.getElementById('zamekAkce').hidden }));
    ok(s.karta && s.form && !s.obsah && !s.session && n.sazeb === 0 && !n.akce && /Hodinové sazby jsou zamčené/.test(s.nadpis),
      'Zamknout: sazby pryč ze stránky, karta s heslem, odemčení zapomenuto', { s, n });
    await N.page.screenshot({ path: path.join(SNIMKY, 'PC5_nastaveni_zamceno.png'), fullPage: true });
    await odemkni(N.page, NOVE);
    s = await stav(N.page, 'sekce-sazby');
    n = await N.page.evaluate(() => ({ sazeb: document.querySelectorAll('#sazby [data-sazba]').length }));
    ok(!s.karta && s.obsah && n.sazeb > 0, 'odemknutí novým heslem: sazby zpátky', { s, n });
    // změna hesla: špatné stávající, pak správné
    await N.page.click('#btnZmenit');
    await pockej(200);
    n = await N.page.evaluate(() => ({ karta: !document.getElementById('zamek').hidden, stare: !document.getElementById('zStareBox').hidden,
      uloz: document.getElementById('btnZmenaUloz').textContent, zrus: !document.getElementById('btnZmenaZrus').hidden }));
    ok(n.karta && n.stare && n.uloz === 'Uložit nové heslo' && n.zrus, 'Změnit heslo: karta se stávajícím heslem a Zrušit', n);
    await N.page.fill('#zStare', 'uplne-jine');
    await N.page.fill('#zNove', HESLO);
    await N.page.fill('#zNove2', HESLO);
    await N.page.click('#btnZmenaUloz');
    await pockej(300);
    ok(/Stávající heslo nesedí/.test(await toast(N.page)) && (await dbZamek(N.page)).hash === d.hash, 'špatné stávající heslo: nic se nezměnilo', await toast(N.page));
    await N.page.fill('#zStare', NOVE);
    await N.page.click('#btnZmenaUloz');
    await pockej(500);
    const d2 = await dbZamek(N.page);
    s = await stav(N.page, 'sekce-sazby');
    try { ses = JSON.parse(s.session); } catch (e) { ses = {}; }
    ok(d2.hash === otisk(HESLO, d2.salt) && d2.salt !== d.salt && ses.v === d2.hash && s.obsah && !s.karta,
      'změna hesla: nový otisk i sůl, odemčení přepsané na nový otisk', { s });
    await konec(N, 'Nastavení');
    // manažer v Nastavení: odemkne, ale heslo měnit nemůže
    const M = await okno(prohlizec, port, 'man', 'nastaveni.html', SEED, 1280);
    s = await stav(M.page, 'sekce-sazby');
    ok(s.karta && s.form && !s.obsah, 'manažer v Nastavení: zamčeno', s);
    await odemkni(M.page, HESLO);
    s = await stav(M.page, 'sekce-sazby');
    n = await M.page.evaluate(() => ({ zmenit: !document.getElementById('btnZmenit').hidden, akce: !document.getElementById('zamekAkce').hidden, karta: !document.getElementById('zamek').hidden }));
    ok(s.obsah && !s.karta && n.akce && !n.zmenit && !n.karta, 'manažer odemkl: sazby vidět, Zamknout ano, Změnit heslo ne', { s, n });
    await konec(M, 'manažer v Nastavení');

    /* ===== 6) podlišta VÝKAZY bez Celkového přehledu ========================= */
    for (const stranka of ['vykazy.html', 'vytizeni.html']) {
      const o = await okno(prohlizec, port, 'spr', stranka, SEED, 1280);
      const p = await o.page.$$eval('#appSubbar .subbar__cat', els => els.filter(e => !e.hidden).map(e => e.textContent.trim()));
      ok(p.indexOf('CELKOVÝ PŘEHLED') === -1 && p.indexOf('PŘEHLED VÝKAZŮ') !== -1 && p.indexOf('VYTÍŽENÍ TÝMU') !== -1,
        stranka + ': podlišta Výkazů = Přehled výkazů + Vytížení týmu, bez Celkového přehledu', p);
      ok(!(await o.page.$('[data-zamek-karta]')), stranka + ': bez karty zámku');
      await konec(o, stranka);
    }

    /* ===== 7) telefon 375 px ================================================= */
    const T = await okno(prohlizec, port, 'spr', 'sprava.html', SEED, 375);
    s = await stav(T.page);
    ok(s.karta && s.form && !s.obsah, '375 px Správa: zamčeno s kartou', s);
    ok(await sirkaDok(T.page) <= 375, '375 px Správa zamčeno: nic nepřetéká', await sirkaDok(T.page));
    await T.page.screenshot({ path: path.join(SNIMKY, 'TEL1_sprava_zamceno.png'), fullPage: true });
    await odemkni(T.page, HESLO);
    s = await stav(T.page);
    ok(!s.karta && s.obsah, '375 px Správa: odemčeno ťuknutím', s);
    await jdi(T, 'vykazy-prehled.html');
    s = await stav(T.page);
    ok(!s.karta && s.obsah, '375 px Celkový přehled: odemčení přeneseno', s);
    await T.page.screenshot({ path: path.join(SNIMKY, 'TEL2_prehled_odemceno.png'), fullPage: true });
    await konec(T, 'telefon');
    const T2 = await okno(prohlizec, port, 'spr', 'vykazy-prehled.html', SEED, 375);
    ok(await sirkaDok(T2.page) <= 375, '375 px Celkový přehled zamčeno: nic nepřetéká', await sirkaDok(T2.page));
    await konec(T2, 'telefon přehled');
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
