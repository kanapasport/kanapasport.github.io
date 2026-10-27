// Klikací test stránky Milníky – hustá tabulka (návrh A, 27. 10. 2026) nad
// napodobeným Firebase (testy\prohlizec). Kontroluje zkratky projektů,
// nezveřejněné milníky (ve svém týdnu, bez data a bez štítků – i pro správce),
// Harmonogram bez termínů nezveřejněných, panel Přehled, tlačítko úkolů
// v hlavičce, hustotu řádků na 1920 / 1366, telefon 375 bez přetečení,
// pohled zaměstnance a nabídku ⋯. Snímky do _testy\snimky\ (do gitu ne).
//
// Spuštění:  "C:\Program Files\FARO\SCENE\LidarOS\node\node.exe" _testy\test_milniky_A.js [<kopie webu>]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const PROHLIZEC = 'D:\\CLAUDE_PRACOVNI\\NASTROJE\\web\\testy\\prohlizec';
const { chromium } = require(path.join(PROHLIZEC, 'node_modules', 'playwright'));

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const SNIMKY = path.join(__dirname, 'snimky');
fs.mkdirSync(SNIMKY, { recursive: true });
const STORE = fs.readFileSync(path.join(REPO, 'assets', 'js', 'store.js'), 'utf8');
const APP_ID = (STORE.match(/const APP_ID\s*=\s*["']([^"']+)["']/) || [])[1];
const FB = fs.readFileSync(path.join(PROHLIZEC, 'napodobeny_firebase.js'), 'utf8');

const DATA = require(path.join(PROHLIZEC, 'testovaci_data.js')).vytvor(new Date());
const dnes = new Date(); dnes.setHours(0, 0, 0, 0);
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const den = (n) => { const d = new Date(dnes); d.setDate(d.getDate() + n); return iso(d); };
const ms = (n) => dnes.getTime() + n * 864e5 + 9 * 36e5;
const PA = 'Testovací projekt A';
const PB = 'Testovací projekt B';
const BPH = 'BPH – areál farmacie';          // zkratka z části před pomlčkou
const MPZ = 'Malý projekt Z';                // zkratka z iniciál
const D = DATA.dokumenty;

const zakl = { poznamka: '', projekt: PA, stav: 'planovano', hotovo: false, hotovoKdo: '', hotovoMs: 0, potvrzeno: true, potvrdil: '', potvrzenoMs: 0, updatedMs: ms(-20), updatedBy: 'test' };
const mil = (id, o, t) => {
  D['private/milniky/seznam/' + id] = Object.assign({}, zakl, o, { kdoVidiPostup: o.zpracovatele });
  D['private/milniky/terminy/' + id] = Object.assign({ updatedMs: ms(-20), updatedBy: 'test' }, t);
};
/* Dvojice se stejným termínem a zpracovatelem (den(6) = dovolená zaměstnance
   v testovacích datech): zveřejněný má štítky nový + posunuto + termín
   v dovolené, nezveřejněný nesmí mít ani jeden a místo data „—". */
mil('m-pz', { cinnost: 'SLN', napln: 'Zveřejněný s posunem a dovolenou', skupina: '2. technologický milník', zpracovatele: ['uid-zamestnanec'], zverejneno: true, zverejnenoMs: ms(-1), poradi: 100 },
  { termin: den(6), terminPuvodni: den(3), kdoVidiTermin: ['uid-zamestnanec'] });
mil('m-nz', { cinnost: 'VZT', napln: 'Nezveřejněný se stejným termínem', skupina: '2. technologický milník', zpracovatele: ['uid-zamestnanec'], zverejneno: false, zverejnenoMs: ms(-1), poradi: 101 },
  { termin: den(6), terminPuvodni: den(3), kdoVidiTermin: [] });
// nezveřejněný s prošlým termínem – i ten zůstává v bloku „Po termínu" s „—"
mil('m-np', { cinnost: 'MaR', napln: 'Nezveřejněný po termínu', skupina: '3. technologický milník', projekt: BPH, zpracovatele: ['uid-student'], zverejneno: false, poradi: 102 },
  { termin: den(-3), terminPuvodni: den(-3), kdoVidiTermin: [] });
// splněný a potvrzený – do sbaleného bloku „Splněné", s přepínačem do týdne
mil('m-h', { cinnost: 'STAVBA', napln: 'Hotový potvrzený', skupina: '1. stavební milník', zpracovatele: ['uid-zamestnanec'], zverejneno: true, poradi: 103, hotovo: true, hotovoKdo: 'test', hotovoMs: ms(-2), potvrzeno: true, potvrdil: 'test', potvrzenoMs: ms(-2) },
  { termin: den(-2), terminPuvodni: den(-2), kdoVidiTermin: ['uid-zamestnanec'] });
// hromada zveřejněných na tento a příští týden – kvůli hustotě řádků
const projekty = [BPH, PA, PB, MPZ];
const lide = [['uid-zamestnanec'], ['uid-student'], ['uid-spravce', 'uid-zamestnanec']];
const techy = ['SLN', 'VZT', 'STAVBA', 'MaR', 'ZTI', 'TER'];
for (let i = 0; i < 24; i++) {
  const posun = i < 12 ? i % 6 : 7 + (i % 6);
  mil('m-r' + i, { cinnost: techy[i % techy.length], napln: 'Řádek ' + (i + 1) + ' – náplň milníku dost dlouhá na to, aby se zkrátila trojtečkou', skupina: (1 + (i % 3)) + (i % 2 ? '. technologický milník' : '. stavební milník'), projekt: projekty[i % projekty.length], zpracovatele: lide[i % lide.length], zverejneno: true, poradi: 200 + i },
    { termin: den(posun), terminPuvodni: den(posun), kdoVidiTermin: lide[i % lide.length] });
}

const SEED = {};
Object.keys(D).forEach((k) => { SEED['artifacts/' + APP_ID + '/' + k] = D[k]; });

const TYPY = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let cesta;
  try { cesta = path.join(REPO, decodeURIComponent(req.url.split('?')[0])); } catch (e) { cesta = ''; }
  if (!cesta || !cesta.startsWith(REPO) || !fs.existsSync(cesta) || fs.statSync(cesta).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': (TYPY[path.extname(cesta)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(cesta).pipe(res);
});

let chyb = 0;
const ok = (podminka, popis) => { console.log((podminka ? 'OK   ' : 'CHYBA') + ' ' + popis); if (!podminka) chyb++; };

async function kontext(prohlizec, port, roleId, viewport, telefon) {
  const clovek = DATA.lide[roleId];
  const k = await prohlizec.newContext({ viewport: viewport, isMobile: !!telefon, hasTouch: !!telefon, deviceScaleFactor: 1,
    serviceWorkers: 'block', locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
  await k.addInitScript(({ seed, clovek }) => {
    window.__TEST_SEED = seed;
    window.__TEST_UZIVATEL = { uid: clovek.uid, email: clovek.email };
    try { localStorage.setItem('company_kb_username', clovek.jmeno); localStorage.setItem('company_kb_email', clovek.email); localStorage.setItem('company_kb_role', clovek.role); } catch (e) { /* */ }
  }, { seed: SEED, clovek });
  await k.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' && String(u.port) === String(port)) return route.continue();
    if (u.hostname === 'www.gstatic.com' && /firebase-(app|auth|firestore)\.js$/.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: FB });
    }
    return route.abort('blockedbyclient');
  });
  return k;
}

async function otevri(k, port, chyby) {
  const page = await k.newPage();
  page.on('pageerror', (e) => chyby.push('JS: ' + String(e.message || e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) chyby.push('KON: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => { chyby.push('DIALOG ' + d.type() + ': ' + d.message().slice(0, 120)); d.dismiss().catch(() => {}); });
  await page.goto('http://127.0.0.1:' + port + '/milniky.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.KB && window.KB.milniky && window.KB.milniky.length > 0, null, { timeout: 8000 });
  await page.waitForTimeout(900);
  return page;
}

const mids = (page, sel) => page.$$eval(sel, (r) => r.map((x) => x.dataset.mid));
const blokRadku = (page, id) => page.$eval('#vypis tr[data-mid="' + id + '"]', (e) => { const b = e.closest('.mblok'); return b ? b.id + ' | ' + b.querySelector('.mblok__hlava b').textContent : ''; });
const stitky = (page, id) => page.$eval('#vypis tr[data-mid="' + id + '"]', (e) => Array.from(e.querySelectorAll('.milpil')).map((s) => Array.from(s.classList).find((c) => c.indexOf('milpil--') === 0) || 'milpil'));
const viditelneRadky = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#vypis tr[data-mid]')).filter((tr) => { const r = tr.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }).length);

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const prohlizec = await chromium.launch({ channel: 'chrome', headless: true });

  /* ===================== SPRÁVCE 1920×1080 ===================== */
  const chybyS = [];
  const ks = await kontext(prohlizec, port, 'spravce', { width: 1920, height: 1080 });
  let page = await otevri(ks, port, chybyS);
  console.log('--- správce, 1920×1080');
  ok(await page.isVisible('#vypis') && await page.$eval('#vypis', (e) => e.classList.contains('mvyp')), 'výchozí záložka je výpis jako tabulka (.mvyp)');
  ok(await page.$$eval('#vypis table.mt', (t) => t.length) >= 3, 'výpis = tabulky po blocích');
  ok(await page.isVisible('#vypis .mt--hlava') && (await page.$$eval('#vypis .mt--hlava th', (th) => th.map((x) => x.textContent.trim()).filter(Boolean))).join('|') === 'Termín|Projekt|Technologie|Typ|Skupina|Náplň milníku|Zpracovatel|Zveřejněno',
    'nalepená hlavička sloupců: Termín · Projekt · Technologie · Typ · Skupina · Náplň · Zpracovatel · Zveřejněno');
  ok(await page.$eval('#vypis .mt--hlava', (e) => getComputedStyle(e).position === 'sticky'), 'hlavička sloupců je sticky');

  // zkratky projektů
  const chip = async (id) => page.$eval('#vypis tr[data-mid="' + id + '"] .mproj', (e) => ({ text: e.textContent, title: e.title, barva: getComputedStyle(e).color }));
  const cBph = await chip('m-np'), cPa = await chip('m-pz'), cMpz = await chip('m-r3');
  ok(cBph.text === 'BPH' && cBph.title === BPH, 'zkratka z názvu „' + BPH + '" → BPH, celý název v title');
  ok(cPa.text === 'TPA' && cPa.title === PA, 'zkratka z iniciál „' + PA + '" → TPA');
  ok(cMpz.text === 'MPZ', 'zkratka z iniciál „' + MPZ + '" → MPZ');
  ok(cBph.barva !== cPa.barva, 'projekty mají různé stálé barvy (' + cBph.barva + ' / ' + cPa.barva + ')');
  const barvyBph = await page.$$eval('#vypis .mproj', (ch) => Array.from(new Set(ch.filter((c) => c.textContent === 'BPH').map((c) => getComputedStyle(c).color))));
  ok(barvyBph.length === 1, 'stejný projekt má všude stejnou barvu');

  // nezveřejněné: ve svém týdnu, bez data, bez štítků – i pro správce
  const blokPz = await blokRadku(page, 'm-pz'), blokNz = await blokRadku(page, 'm-nz');
  console.log('     blok zveřejněného: ' + blokPz + ' · nezveřejněného: ' + blokNz);
  ok(blokPz === blokNz && !/Bez termínu|Splněné/.test(blokNz), 'nezveřejněný je ve stejném týdenním bloku jako zveřejněný se stejným termínem');
  ok(await page.$eval('#vypis tr[data-mid="m-nz"] .mdatum', (e) => e.textContent.trim()) === '—', 'nezveřejněný: místo data „—" (i pro hlavního správce)');
  ok(await page.$eval('#vypis tr[data-mid="m-nz"] .mdatum', (e) => /okně úpravy/.test(e.title)), 'nezveřejněný: bublina „termín uvidíš v okně úpravy"');
  ok(await page.$eval('#vypis tr[data-mid="m-nz"] .mt__kdy', (e) => e.textContent.trim() === ''), 'nezveřejněný: bez „za N dní"');
  ok(await page.$eval('#vypis tr[data-mid="m-pz"] .mdatum', (e) => /\d/.test(e.textContent)), 'zveřejněný: datum vidět');
  const stPz = await stitky(page, 'm-pz'), stNz = await stitky(page, 'm-nz');
  console.log('     štítky zveřejněného: ' + stPz.join(', ') + ' · nezveřejněného: ' + stNz.join(', '));
  ok(stPz.includes('milpil--novy') && stPz.includes('milpil--posun') && stPz.includes('milpil--dovolena'), 'zveřejněný má nový + posunuto + termín v dovolené');
  ok(!stNz.some((s) => /novy|posun|dovolena/.test(s)) && stNz.includes('milpil--skryty'), 'nezveřejněný: žádný z nich, jen „nezveřejněno"');
  ok(await page.$eval('#vypis tr[data-mid="m-pz"] .milpil--posun', (e) => /původní termín/.test(e.title)), 'posunuto: původní termín v bublině');
  ok(await page.$eval('#vypis tr[data-mid="m-nz"] .mt__zver', (e) => e.textContent.trim() === '—') && await page.$eval('#vypis tr[data-mid="m-pz"] .mt__zver', (e) => /\d/.test(e.textContent)), 'sloupec Zveřejněno: datum u zveřejněného, „—" u nezveřejněného');
  ok(/Po termínu/.test(await blokRadku(page, 'm-np')) && await page.$eval('#vypis tr[data-mid="m-np"] .mdatum', (e) => e.textContent.trim()) === '—', 'nezveřejněný s prošlým termínem: v „Po termínu", ale s „—"');
  ok(/termín uvidíš až po zveřejnění/.test(await page.textContent('#legenda')) && await page.isVisible('#legenda .milpil--posun'), 'legenda: pomlčka + posunuto');

  // Přehled: tlačítko s čísly, panel, zavření
  ok(await page.isVisible('#btnPrehled') && /Přehled/.test(await page.textContent('#btnPrehled')), 'tlačítko Přehled v hlavičce');
  ok(await page.$eval('#souhrnPanel', (e) => e.hidden), 'panel je zavřený');
  await page.click('#btnPrehled');
  ok(!(await page.$eval('#souhrnPanel', (e) => e.hidden)) && await page.$eval('#btnPrehled', (e) => e.getAttribute('aria-expanded')) === 'true', 'klik otevře panel s dlaždicemi');
  const dlazdice = await page.$$eval('#souhrn .msouhrn__d', (d) => d.map((x) => x.querySelector('b').textContent + ' ' + x.querySelector('span').textContent));
  console.log('     dlaždice: ' + dlazdice.join(' | '));
  const vTlacitku = await page.$$eval('#btnPrehled .mprehled__c b', (b) => b.map((x) => x.textContent));
  ok(dlazdice.length === 5 && vTlacitku.length >= 4 && dlazdice.slice(0, 3).every((d, i) => d.split(' ')[0] === vTlacitku[i]), 'čísla v tlačítku = čísla na dlaždicích');
  const nTento = Number(dlazdice[1].split(' ')[0]);
  const vBloku = await page.$$eval('#mblok-tento tr[data-mid]', (r) => r.length);
  ok(nTento === vBloku, 'dlaždice „tento týden" (' + nTento + ') = řádků v bloku Tento týden (' + vBloku + ') – nezveřejněné se počítají');
  await page.screenshot({ path: path.join(SNIMKY, 'pc1920_prehled.png') });
  await page.keyboard.press('Escape');
  ok(await page.$eval('#souhrnPanel', (e) => e.hidden), 'Esc panel zavře');
  await page.click('#btnPrehled');
  await page.click('#pageTitle');
  ok(await page.$eval('#souhrnPanel', (e) => e.hidden), 'klik mimo panel zavře');
  await page.click('#btnPrehled');
  await page.click('#souhrn [data-skok="pristi"]');
  await page.waitForTimeout(300);
  ok(await page.$eval('#souhrnPanel', (e) => e.hidden) && !!(await page.$('#mblok-pristi')), 'klik na dlaždici skočí na blok a panel zavře');
  await page.click('#btnPrehled');
  await page.click('#souhrn [data-skok="skryte"]');
  await page.waitForTimeout(300);
  let v = await mids(page, '#vypis tr[data-mid]');
  ok(v.length && v.every((id) => /^m-n/.test(id) || id === 'mil-2') && await page.$eval('[data-prep="skryte"]', (e) => e.getAttribute('aria-pressed') === 'true'), 'dlaždice „nezveřejněné" přepne filtr: ' + v.join(','));
  await page.click('#btnFiltrPryc');
  await page.waitForTimeout(200);

  // tlačítko úkolů v hlavičce vedle + Nový milník
  ok(await page.isVisible('#btnUkolyZMilniku') && await page.$eval('#btnUkolyZMilniku', (e) => !!e.closest('.spread') && e.nextElementSibling && e.nextElementSibling.id === 'btnNew') && /Udělat úkoly z milníků \(\d+\)/.test(await page.textContent('#btnUkolyZMilniku')),
    '„Udělat úkoly z milníků (N)" je v hlavičce před „+ Nový milník": ' + await page.textContent('#btnUkolyZMilniku'));

  // hustota: výška řádku a počet řádků vidět
  const vyskaRadku = await page.$eval('#vypis tr[data-mid="m-r0"]', (e) => e.getBoundingClientRect().height);
  ok(vyskaRadku <= 30, 'výška řádku ' + vyskaRadku.toFixed(1) + ' px ≤ 30');
  await page.evaluate(() => window.scrollTo(0, 0));
  const videt1920 = await viditelneRadky(page);
  ok(videt1920 >= 18, 'na 1920×1080 je vidět ' + videt1920 + ' řádků (≥ 18)');
  ok(await page.$eval('#vypis tr[data-mid="m-r0"] .mnapln', (e) => e.scrollWidth >= e.clientWidth && getComputedStyle(e).textOverflow === 'ellipsis' && e.title.length > 20), 'náplň zkrácená trojtečkou, celá v bublině');
  const sirkaTab = await page.$eval('#vypis table.mt:not(.mt--hlava)', (t) => ({ tab: t.getBoundingClientRect().width, vypis: t.closest('#vypis').getBoundingClientRect().width, filtr: document.getElementById('filtrRow').getBoundingClientRect().width }));
  ok(sirkaTab.tab >= sirkaTab.vypis - 2 && sirkaTab.tab >= sirkaTab.filtr - 2, 'tabulka využívá celou šířku obsahu (' + Math.round(sirkaTab.tab) + ' / výpis ' + Math.round(sirkaTab.vypis) + ' / filtr ' + Math.round(sirkaTab.filtr) + ')');
  await page.screenshot({ path: path.join(SNIMKY, 'pc1920_cela.png'), fullPage: true });

  // Zobrazit splněné: sbalený blok → ve svém týdnu ztlumený
  ok(!(await page.$('#vypis tr[data-mid="m-h"]')) && !!(await page.$('details[data-blok="hotove"]')), 'splněný je ve sbaleném bloku Splněné');
  await page.click('#splneneRow');
  await page.waitForTimeout(300);
  ok(await page.$eval('#vypis tr[data-mid="m-h"]', (e) => e.classList.contains('mr--ztlumeny') && /potvrzeno/.test(e.textContent) && /týden/i.test(e.closest('.mblok').querySelector('.mblok__hlava b').textContent)), 'Zobrazit splněné: splněný ve svém týdnu, ztlumený, „potvrzeno"');
  await page.click('#splneneRow');
  await page.waitForTimeout(300);

  // nabídka ⋯ – všechny akce
  await page.click('#vypis tr[data-mid="m-pz"] [data-nabidka-vic]');
  await page.waitForSelector('.nabidka [data-nabidka-i]', { timeout: 3000 });
  let polozky = await page.$$eval('.nabidka [data-nabidka-i]', (x) => x.map((y) => y.textContent.trim()));
  console.log('     ⋯ zveřejněný: ' + polozky.join(' | '));
  ok(['Splněno', 'Skrýt zaměstnancům', 'Změnit termín…', 'Upravit…', 'Udělat úkol z milníku', 'Jen technologie SLN', 'Smazat milník…'].every((t) => polozky.includes(t)), 'nabídka ⋯ zveřejněného: Splněno, Skrýt, Změnit termín, Upravit, Udělat úkol, Jen technologie, Smazat');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('#vypis tr[data-mid="m-nz"] [data-nabidka-vic]');
  await page.waitForSelector('.nabidka [data-nabidka-i]', { timeout: 3000 });
  polozky = await page.$$eval('.nabidka [data-nabidka-i]', (x) => x.map((y) => y.textContent.trim()));
  console.log('     ⋯ nezveřejněný: ' + polozky.join(' | '));
  ok(polozky.includes('Zveřejnit') && polozky.includes('Zveřejnit s termínem…') && polozky.includes('Změnit termín…'), 'nabídka ⋯ nezveřejněného: Zveřejnit, Zveřejnit s termínem, Změnit termín');
  await page.locator('.nabidka [data-nabidka-i]', { hasText: 'Změnit termín' }).first().click();
  await page.waitForTimeout(300);
  ok(await page.isVisible('#terminOverlay') && await page.$eval('#tDatum', (e) => e.value) === den(6), 'Změnit termín… u nezveřejněného: v okně je skutečný termín ' + den(6));
  await page.click('#tZrusit');
  // hromadný výběr a lišta; „vybrat vše" v hlavičce
  await page.click('#vypis tr[data-mid="m-pz"] .vyber-box');
  await page.click('#vypis tr[data-mid="m-nz"] .vyber-box');
  await page.waitForSelector('.vyber-lista:not([hidden])', { timeout: 3000 });
  ok(/Vybráno 2/.test(await page.textContent('.vyber-lista__pocet')), 'hromadný výběr: lišta „Vybráno 2"');
  const akceListy = await page.$$eval('.vyber-lista [data-vyber-akce]', (b) => b.map((x) => x.textContent.trim()));
  ok(akceListy.some((a) => /Změnit termín/.test(a)) && akceListy.some((a) => /Zveřejnit s termínem/.test(a)) && akceListy.some((a) => /Smazat/.test(a)), 'lišta: Změnit termín, Zveřejnit s termínem, Smazat');
  await page.screenshot({ path: path.join(SNIMKY, 'pc1920_vyber.png') });
  await page.click('#vypis .mt--hlava [data-vyber-vse]');
  await page.waitForTimeout(200);
  const vybrano = await page.$$eval('#vypis .vyber-box[data-vyber]:checked', (b) => b.length);
  ok(vybrano >= 20 && vybrano === (await page.$$eval('#vypis .vyber-box[data-vyber]', (b) => b.length)), '„vybrat vše" v hlavičce zaškrtne všechno vypsané (' + vybrano + ')');
  await page.click('.vyber-lista [data-vyber-zrus]');
  await page.waitForTimeout(200);

  // Harmonogram: nezveřejněný bez data a bez „za N dní"
  await page.click('[data-zalozka="harmonogram"]');
  await page.waitForTimeout(300);
  ok(await page.isVisible('#table tbody tr') && await page.$eval('#vypis', (e) => e.hidden), 'Harmonogram vykreslený, výpis schovaný');
  ok(await page.$eval('#table tr[data-mid="m-nz"] .milniky__datum', (e) => !!e.querySelector('.mildash') && !e.querySelector('.milniky__pozn') && !/\d/.test(e.textContent)), 'Harmonogram: nezveřejněný má „—" bez „za N dní"');
  ok(await page.$eval('#table tr[data-mid="m-pz"] .milniky__datum', (e) => /\d/.test(e.textContent) && !!e.querySelector('.milniky__pozn')), 'Harmonogram: zveřejněný má datum a „za N dní"');
  ok(await page.$eval('#table tr[data-mid="m-nz"]', (e) => !e.querySelector('.milpil--novy, .milpil--dovolena')), 'Harmonogram: nezveřejněný bez štítků nový / dovolená');
  await page.screenshot({ path: path.join(SNIMKY, 'pc1920_harmonogram.png'), fullPage: true });
  await page.click('[data-zalozka="vypis"]');
  await page.waitForTimeout(200);
  ok(chybyS.length === 0, 'správce 1920: bez chyb JS/konzole ' + chybyS.join(' ; '));
  await page.close();

  /* ===================== SPRÁVCE 1366×768 ===================== */
  console.log('--- správce, 1366×768');
  const k1366 = await kontext(prohlizec, port, 'spravce', { width: 1366, height: 768 });
  page = await otevri(k1366, port, chybyS);
  const videt1366 = await viditelneRadky(page);
  ok(videt1366 >= 6, 'na 1366×768 je vidět ' + videt1366 + ' řádků (≥ 6)');
  const pret1366 = await page.evaluate(() => ({ dok: document.documentElement.scrollWidth, okno: document.documentElement.clientWidth }));
  ok(pret1366.dok <= pret1366.okno + 1, '1366: bez vodorovného přetečení (' + pret1366.dok + ' / ' + pret1366.okno + ')');
  ok(!(await page.isVisible('#vypis td.mt__skup')) && await page.isVisible('#vypis td.mt__napln'), '1366: sloupec Skupina schovaný, náplň má místo');
  await page.screenshot({ path: path.join(SNIMKY, 'pc1366_cela.png'), fullPage: true });
  await page.close();
  await k1366.close();
  await ks.close();

  /* ===================== ZAMĚSTNANEC ===================== */
  console.log('--- zaměstnanec, 1440×900');
  const chybyZ = [];
  const kz = await kontext(prohlizec, port, 'zamestnanec', { width: 1440, height: 900 });
  page = await otevri(kz, port, chybyZ);
  v = await mids(page, '#vypis tr[data-mid]');
  console.log('     zaměstnanec vidí: ' + v.join(','));
  ok(v.includes('m-pz') && !v.includes('m-nz') && !v.includes('m-np') && !v.includes('mil-2'), 'zaměstnanec: zveřejněné ano, nezveřejněné ne');
  ok(await page.$$eval('#vypis .vyber-box', (b) => b.length) === 0 && await page.$eval('#vypis', (e) => e.classList.contains('mvyp--bez-vyberu')), 'zaměstnanec: bez zaškrtávátek');
  ok(await page.$$eval('#vypis .mt__zver, #vypis th.mt__zver', (b) => b.length) === 0, 'zaměstnanec: bez sloupce Zveřejněno');
  ok(await page.$eval('#vypis tr[data-mid="m-pz"] .mdatum', (e) => /\d/.test(e.textContent)) && (await stitky(page, 'm-pz')).includes('milpil--posun'), 'zaměstnanec: svůj termín vidí, včetně „posunuto"');
  ok(!(await page.$('#vypis tr[data-mid="m-r1"]')) && !!(await page.$('details[data-blok="bez"]')), 'kolegův milník je ve sbaleném „Bez termínu nebo s termínem kolegy"');
  await page.click('details[data-blok="bez"] > summary');
  await page.waitForTimeout(200);
  ok(await page.$eval('#vypis tr[data-mid="m-r1"] .mdatum', (e) => e.textContent.trim()) === '—', 'kolegův termín = „—"');
  ok(!(await page.$eval('#vypis tr[data-mid="m-pz"]', (e) => /nezveřejněno|zveřejněno/.test(e.textContent))), 'zaměstnanec nevidí stav zveřejnění');
  ok(await page.isVisible('#btnPrehled') && !(await page.isVisible('#btnUkolyZMilniku')) && !(await page.isVisible('#btnNew')), 'zaměstnanec: Přehled ano, úkoly a Nový milník ne');
  await page.click('#btnPrehled');
  ok(await page.$$eval('#souhrn .msouhrn__d', (d) => d.length) <= 4 && !(await page.$('#souhrn [data-skok="skryte"]')), 'zaměstnanec: v Přehledu není dlaždice nezveřejněných');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(SNIMKY, 'pc_zamestnanec.png'), fullPage: true });
  ok(chybyZ.length === 0, 'zaměstnanec: bez chyb ' + chybyZ.join(' ; '));
  await page.close();
  await kz.close();

  /* ===================== TELEFON 375 ===================== */
  console.log('--- správce, telefon 375×812');
  const chybyT = [];
  const kt = await kontext(prohlizec, port, 'spravce', { width: 375, height: 812 }, true);
  page = await otevri(kt, port, chybyT);
  const sirka = await page.evaluate(() => ({ dok: document.documentElement.scrollWidth, okno: document.documentElement.clientWidth }));
  ok(sirka.dok <= sirka.okno + 1, 'telefon: bez vodorovného přetečení (' + sirka.dok + ' / ' + sirka.okno + ')');
  const karta = await page.$eval('#vypis tr[data-mid="m-r0"]', (e) => ({ display: getComputedStyle(e).display, smer: getComputedStyle(e).flexDirection, vyska: e.getBoundingClientRect().height, hlava: (document.querySelector('#vypis .mt--hlava') || {}).offsetParent !== null }));
  console.log('     karta: ' + JSON.stringify(karta));
  ok(karta.display === 'flex' && karta.smer === 'row' && !karta.hlava, 'telefon: řádky jako karty (flex, chipy v řadě), hlavička sloupců pryč');
  // dlouhá náplň se na 375 px zalomí na tři řádky – i tak karta pod 150 px; krátká pod 100 px
  const kartaKratka = await page.$eval('#vypis tr[data-mid="m-r2"]', (e) => e.getBoundingClientRect().height);
  ok(karta.vyska < 150 && kartaKratka < 150, 'telefon: karta kompaktní (' + Math.round(karta.vyska) + ' px dlouhá / ' + Math.round(kartaKratka) + ' px kratší náplň)');
  ok(await page.isVisible('#vypis .mvyp__lista [data-vyber-vse]'), 'telefon: „vybrat všechno vypsané" nad výpisem');
  await page.click('#btnPrehled');
  await page.waitForTimeout(200);
  const sirkaP = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(!(await page.$eval('#souhrnPanel', (e) => e.hidden)) && sirkaP <= 376, 'telefon: panel Přehled otevřený bez přetečení');
  await page.screenshot({ path: path.join(SNIMKY, 'tel375_prehled.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(SNIMKY, 'tel375_cela.png'), fullPage: true });
  await page.evaluate(() => document.getElementById('mblok-tento').scrollIntoView());
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SNIMKY, 'tel375_karty.png') });
  await page.click('#vypis tr[data-mid="m-pz"] [data-nabidka-vic]');
  await page.waitForSelector('.nabidka [data-nabidka-i]', { timeout: 3000 });
  ok((await page.$$eval('.nabidka [data-nabidka-i]', (x) => x.length)) >= 5, 'telefon: nabídka ⋯ se otevře');
  await page.keyboard.press('Escape');
  ok(chybyT.length === 0, 'telefon: bez chyb ' + chybyT.join(' ; '));
  await page.close();
  await kt.close();

  await prohlizec.close();
  server.close();
  console.log('\n' + (chyb ? chyb + ' CHYB' : 'vše prošlo') + ' · snímky: ' + SNIMKY);
  process.exit(chyb ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(2); });
