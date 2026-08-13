# Předání práce – Pasport Kaňa

Shrnutí stavu k **14. 8. 2026**, aby se dalo plynule pokračovat na jiném
počítači nebo v novém sezení. Poslední commit: `7e7552d`, verze assetů `?v=49`.

- **Živý web:** <https://kanapasport.github.io>
- **Repozitář:** <https://github.com/kanapasport/kanapasport.github.io> (veřejný)
  – pracovní kopie má v `origin` ještě starou adresu `kocismichal/pasportkana_navody`.
  GitHub ji přesměrovává, takže push projde, ale čistší je ji přepsat:
  `git remote set-url origin https://github.com/kanapasport/kanapasport.github.io.git`
- **Data:** Firebase Firestore, projekt `pasportkana`, kolekce pod
  `artifacts/firemni-kb-app/public/data/…`

Technický popis webu je v [README.md](README.md) – tenhle soubor je navíc:
říká, **co se rozhodlo, o co se to opřelo a co ještě zbývá**.

---

## Kde jsme skončili (13. 8. 2026)

Všechno je **zacommitované a nahrané na GitHub**, v pracovní kopii nic
nezůstalo. Doma stačí `git pull` (nebo čerstvý `git clone`) a jede se dál.

### 0. NEJDŘÍV: nasadit pravidla Firestore

**Bez tohohle kroku výkazy nefungují nikomu, ani tobě.** Stránka nic nenačte
a ohlásí to toastem. Pravidla se nasazují ručně:

Firebase Console → projekt `pasportkana` → Firestore Database → **Rules** →
vložit celý obsah [firestore.rules](firestore.rules) → **Publish**.

Přibyla tam větev `private/vykazy/**`. Soubor v repu je jen předloha, sám se
nikam nenasadí.

Po nasazení otevři `vykazy.html`, dej **Firmy a sazby**, doplň firmy, rozpočty
a lidem hodinové sazby, a zkus jeden zápis uložit a zase smazat.
**Data v databázi jsou ostrá** – testuj na tom, co po sobě uklidíš.

### 0a. Dvě věci, které čekají na Michala

1. **Nahrát data do Přehledu BP.** Stránka `vykazy-bp.html` je hotová, ale
   v databázi zatím žádný souhrn není — ukáže jen prázdný importní panel.
   Soubor `prehled-BP.json` má Michal u sebe (mimo repozitář, viz níž);
   nahraje se tlačítkem na téže stránce, jednou za všechny správce.
2. **Vyplnit rozpočet BioPharmy.** Nastavení → Zakázky → rozpočet v Kč
   i hodinách. Bez něj přehled řekne, co zakázka stála, ale ne jestli
   vychází — a přesně kvůli tomu se do toho šlo.

### 0b. Co se stalo naposledy (žádná otevřená nedodělávka)

Od výkazů práce (`70e90b4`) přibylo: přestavba formuláře (`e6068f4`),
Postup práce s příplatky (`e9323bf`), **Přehled BP** ze starých excelů
(`6c19675`, `6006944`), **Nastavení jako vlastní stránka** a prověřená
paleta grafů (`b8bcf28`), **náhled role** pro hlavního správce (`47da901`)
a **opravy z bezpečnostní revize** (`7e7552d`).
Všechno je odzkoušené v prohlížeči a nasazené; nic nezůstalo rozpracované.

Dvě věci, které nikdo nezadal a rozhodly se samy – klidně to změň:

- **Oběd a kilometry leží u času, ne u peněz** (`zaznamy`, ne `castky`).
  Jsou to náhrady tomu, kdo pracoval, tak si na ně musí sáhnout. Korunová
  hodnota se z nich dopočítá až v `castky`, kam vidí jen správce.
- **Průměrná sazba se počítá jen z odpracované práce**, bez paušálů – jinak
  by ji oběd a kilometry nafoukly (`castkaPrace` vedle `castka`).

### 0c. Složka `prozkoumat/`

V projektu leží `prozkoumat/pasportkana_navody` – klon z druhého počítače,
ze kterého se výkazy přenesly. Je **mimo git** a už není k ničemu potřeba,
klidně ji smaž.

### 1. Nasazení Pages – workflow padá, buildí se přes API

**Workflow *pages build and deployment* v Actions nefunguje.** Krok `build`
projde za 22 s, ale `deploy` skončí na `Timeout reached, aborting!` ve stavu
`deployment_queued` (nebo `Deployment cancelled.`). Není to chyba v kódu ani
v nastavení – Actions jsou zapnuté a plně povolené, prostředí `github-pages`
má povolenou větev `main` bez schvalovatele, zdroj Pages je `main` / kořen,
vlastní doména prázdná, GitHub Status bez výpadku.

**Řešení:** repozitář má režim Pages `legacy`, takže se dá build vyžádat
rovnou přes API, mimo tu zaseknutou frontu. Po každém pushi tedy spusť:

```bash
gh api --method POST repos/kanapasport/kanapasport.github.io/pages/builds
```

Proběhne za necelou minutu. Ověření, co je opravdu venku:

```bash
curl -s https://kanapasport.github.io/index.html | grep -o "app.css?v=[0-9]*"
```

Kdyby ani to nešlo, poslední páka je v repu **Settings → Pages**: přepnout
zdroj na jinou větev, uložit, přepnout zpět na `main`, uložit.

**Pozor na vlastní pushe.** Pages mají skupinu souběžnosti – nový push zabije
rozdělaný běh. Když čekáš na nasazení, nepushuj mezitím dál, jinak si ho sám
shodíš a vypadá to jako porucha GitHubu.

### 2. E-maily s přístupy – rozpracované

Na `uzivatele.html` je u každého člověka tlačítko **Poslat údaje**. Otevře
připravený text e-mailu (odkaz na web, přihlašovací jméno, heslo z trezoru)
k zkopírování do vlastní schránky. **Text jsi zatím neviděl a neodzkoušel.**

Postup doma:

1. odemknout trezor heslem `Trezor-Kana-2026`,
2. u **sebe** dát *Poslat údaje*, text zkopírovat a poslat si ho z Vedosu **na sebe**,
3. ověřit, že odkaz i heslo fungují, a případně říct, co ve znění změnit,
4. teprve pak rozeslat ostatním – po jednom, ne hromadně přes kopii.

Odeslat je za tebe nedokážu: do tvé schránky se nepřihlašuji a heslo k poště
znát nemám. Text připravím, odeslání zůstává na tobě.

### 2b. Úvodní leták k webu

`uvod.html` je jednorázová tištěná stránka, která se přikládá k rozesílaným
heslům – popisuje prokliky v liště, ikony nad ní, Postup práce, milníky,
tabuli a přihlašování. Není v navigaci webu, otevírá se přímo. Hotové PDF
leží v repu jako `Pasport_Kana_uvod.pdf`; po úpravě `uvod.html` se přegeneruje:

```bash
chrome --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=Pasport_Kana_uvod.pdf uvod.html
```

Zlomy stran jsou ruční (`.strana2`, `.strana3`), aby každá strana měla
uzavřené téma a vlastní patičku. Na A4 se vejde 267 mm obsahu na stranu –
po přidání textu to překontroluj, jinak se leták rozjede na čtyři strany.
Změřit se to dá v prohlížeči: `document.body.style.width = "180mm"` a odečíst
`offsetTop` u `.strana2` / `.strana3`.

**Leták je zdroj pravdy pro lidi, ne pro kód** – když se něco přejmenuje na
webu (jako úkolovník → Postup práce), musí se přepsat i tady a PDF
přegenerovat. Naposledy se to udělalo 13. 8. 2026.

### 3. Ostatní drobnosti, které čekají

- změnit heslo k trezoru z `Trezor-Kana-2026` na vlastní,
- doplnit odpovědné u dvou úkolů – *Zpracování tabulek místností* („Ondra, Amálka")
  a *Focení – světla, nouzáky, zásuvky* („Elda Kaňa"),
- ověřit, že milníky sedí pod správné zakázky (teď jsou všechny pod BioPharma).

---

## Jak to rozjet na druhém počítači

```bash
git clone https://github.com/kanapasport/kanapasport.github.io.git
```

Web je bez buildu – otevře se i dvojklikem, ale kvůli Firebase je lepší
lokální server:

```bash
npx --yes serve -l 4173 .
```

Otevírej adresy **s koncovkou `.html`** (`http://localhost:4173/index.html`).
Bez ní `serve` při přesměrování zahodí parametry v adrese, takže by nefungovalo
`?kat=…`, `?zak=…` ani `?id=…`.

Na push je potřeba přihlášení k GitHubu (Windows Credential Manager nebo
`gh auth login`). Repozitář vlastní **organizace `kanapasport`**, ve které je
Michal (`kocismichal`) vlastníkem.

### Co si vzít s sebou ručně

Dvě věci, které v gitu **nejsou** a být nesmí – repozitář je veřejný:

| Co | Kde | Proč je potřeba |
|---|---|---|
| `Seznam.xlsx` | složka webu, v `.gitignore` | lidé, role a jejich hesla |
| heslo k trezoru | nikde, jen v hlavě | bez něj se hesla lidí nezobrazí |

**Heslo k trezoru je `Trezor-Kana-2026`**, pokud si ho Michal zatím nezměnil.
Nastavil ho Claude při prvním importu hesel; v databázi leží jen kontrolní
blok, ze kterého se zpětně přečíst nedá.

---

## Co je hotové

| Stránka | Stav |
|---|---|
| `index.html` | Rozcestník – červené dlaždice; pořadí SKRIPTY → PASPORTIZAČNÍ POSTUPY → PROGRAMY → SKENOVÁNÍ → PASPORTIZACE DOMŮ, pak zakázky (BioPharma první) |
| `navody.html` | Výpis návodů: vlevo dlaždice, vpravo rovnou náhled A4 |
| `navod.html` | Čtečka návodu + export do PDF (jen správci) |
| `editor.html` | Editor návodu, vlevo úpravy (jde přiblížit), vpravo živý náhled |
| `ukoly.html` | **Postup práce** (dřív úkolovník) po zakázkách a skupinách, sbalené úkoly, historie zápisů |
| `historie.html` | Zápisy postupu ze všech zakázek na jednom místě – **jen správci**, tlačítko je na Postupu práce |
| `milniky.html` | Milníky – termíny odevzdání po činnostech, rozdělené podle zakázek |
| `tabule.html` | Tabule na nápady – nekonečné plátno, myšlenkové mapy |
| `vykazy.html` | Výkazy práce – zápis a záznamy; správce vidí všechny a peníze, zaměstnanec jen svoje |
| `vykazy-prehled.html` | Kolik kdo odpracoval a co to stálo – **jen správci**; kruhové grafy a čerpání rozpočtů |
| `vykazy-bp.html` | Přehled BioPharmy ze starých excelů – **jen správci, ještě za heslem, a v liště schválně NENÍ** (otevírá se přímým odkazem) |
| `nastaveni.html` | Firmy, sazby, rozpočty a projekty zakázek – **jen správci**; sem přibude zbytek nastavení webu |
| `uzivatele.html` | Lidé, role, trezor na hesla, záloha – **jen hlavní správce** |
| `barvy.html` | Hřiště na barvy webu – **jen hlavní správce**, změna neplatí trvale |
| `uvod.html` | Tištěný leták k rozesílaným heslům, není v navigaci (viz níž) |

V liště jsou **DOMŮ · NÁVODY · POSTUP PRÁCE · MILNÍKY · TABULE**. Nad ní jsou
ikony: nový návod, dva pokyny pro AI (návod / skript), import od AI, a podle
práv výkazy, nastavení, uživatelé a barvy. **Přehled BP mezi nimi není
schválně** – ať na něj nikdo nenarazí náhodou.

Vlevo nahoře v červeném pruhu má hlavní správce **přepínač „Zobrazit jako"**
(správce / zaměstnance / studenta). Ukáže, co komu na webu vyskočí, bez
hledání druhého účtu. Zapnutý náhled hlásí oranžový pruh pod hlavičkou.
Je to **náhled toho, co se vykreslí** – data z databáze chodí pořád podle
skutečného účtu, protože pravidla Firestore čtou UID. Na ověření zabezpečení
to tedy nestačí, na to je potřeba druhý účet.

Vzhled: písmo **Lato** přímo v repozitáři (`assets/fonts/`), hlavní barva
červená `#c8102e`, hranaté tvary, cílová zařízení **iPhone 11 a iPad Air**.
Lišta je zarovnaná **zleva**, hledání vpravo.

---

## Přihlašování a role

Přihlašuje se **Firebase Auth** (e-mail + heslo). Anonymní přihlášení je
vypnuté, pravidla Firestore nasazená – **bez přihlášení databáze nevydá nic**
a nepřihlášenému se místo webu ukáže jen výzva k přihlášení (`UI.paintGate()`).

Čtyři role: **hlavní správce · správce · zaměstnanec · student**. Záznam
člověka leží v `users/{uid}`, kde uid je UID účtu ve Firebase – jen podle cesty
si ho umí přečíst i pravidla. Role se bere z databáze, ne z prohlížeče.

Pravomoci jsou na jednom místě v `assets/js/ui.js` (`PERMISSIONS`), stránky se
ptají přes `KBUI.can("ukol.create")`. Tabulka „co která role smí" na
`uzivatele.html` se z toho dopočítá sama.

**Pravomoc sama o sobě nic nechrání** – je to jen o tom, co se vykreslí.
Co je opravdu tajné (hesla, sazby, cizí výkazy), hlídá `firestore.rules`.
Když přibude nová pravomoc, patří k ní i pravidlo.

Ve firmě je **21 účtů** (1 hlavní správce, 4 správci, 11 zaměstnanců,
5 studentů) – všechny založené s hesly ze `Seznam.xlsx`.

### Trezor na hesla

Heslo se ukládá dvakrát: jako **otisk** (ověření přihlášení, nedá se přečíst)
a jako **zašifrovaná podoba** (AES-GCM, klíč z hesla k trezoru přes PBKDF2).
Po odemčení trezoru na `uzivatele.html` jde u každého heslo **zobrazit,
zkopírovat a přepsat**.

Změna cizího hesla funguje takhle: Firebase nedovolí přepsat cizí heslo
„shora", ale trezor zná to stávající, takže se web pod tím účtem v druhé
instanci Firebase přihlásí a heslo změní jeho jménem. Přihlášení správce
zůstane nedotčené. Bez hesla v trezoru zbývá **Odkaz e-mailem**.

**Poslat údaje** připraví hotový text e-mailu (odkaz, jméno, heslo z trezoru);
odeslat ho musí správce sám ze své schránky.

---

## Data ve Firestore

```
artifacts/firemni-kb-app/public/data/
  guides/{id}                    text návodu (+ podkolekce images/{id})
  tasks/{id}                     úkol: zakazka, skupina, owners[], subtasks[], notes[], log[], done
  users/{uid}                    člověk: email, first, last, role, active, salt, hash, enc
  meta/zakazky                   { names: [], closed: [], groups: [], projekty: {}, firmy: [] }
  meta/milniky                   { items: [] } – všechny milníky v jednom poli
  meta/vault                     { salt, check } – nastavení trezoru
  boards/{id}                    hlavička tabule (název, kdo a kdy)
  boards/{id}/content/data       prvky tabule (elements[])
  boards/{id}/images/{id}        obrázky na tabuli
  logs/{id}                      záznamy přihlášení

artifacts/firemni-kb-app/private/vykazy/
  zaznamy/{id}                   čas: uid, datum, nazev, zakazka, projekt, firma,
                                 cinnost, technologie, od, do, pauza, hodiny, obed, km
  castky/{id}                    peníze: sazba, castkaPrace, obedKc, dopravaKc, castka
  ciselniky/nastaveni            sazby lidí, rozpočty zakázek
```

Názvy zakázek, projektů a firem jsou schválně v `meta/zakazky` mezi veřejnými
daty – zaměstnanec si je u svého výkazu musí umět vybrat. Tajné jsou **sazby
a rozpočty**, ne názvy.

Platná pravidla jsou v [firestore.rules](firestore.rules). **Nasazují se ručně**
ve Firebase Console → Firestore Database → Rules; soubor v repu je jen předloha.

Tabule „**Ukázka – myšlenková mapa**" (`board_1785603626022_719`) obsahuje
rozpracovanou mapu od Michala – **netestovat na ní**, založit si vlastní.

---

## Postup práce a milníky – jak se chovají

**Úkoly** jsou sbalené, rozbalí se kliknutím na hlavičku. Zakázka se dělí na
skupiny (`ARCGIS`, `SKENY`, `FOCENÍ`, `TABULKY`) ze společného číselníku
v `meta/zakazky`. Úkol bez skupiny spadne do „Nezařazeno".

Rozpracovanost má kroky **0 / 25 / 50 / 75 / 95 / 100 %** – klikáním na číslo
nebo posuvníkem vedle. Barvy: šedá → žlutá → oranžová → limetková → zelená
(`--p0-bg` … `--p100-fg`). Stejná stupnice na patře, na celkových procentech
i na proužku.

**Odpovědní** se vybírají ze seznamu lidí (pole `owners` s UID), může jich být
víc. V liště je přepínač **Moje úkoly**; komu není správce a má něco
přiřazeného, zapne se sám.

**Historie zápisů** (vidí správci) ukazuje posun `50 % → 75 %`, kdo a kdy,
seskupeně po dnech. Zápisy téhož člověka k témuž patru do deseti minut se
slučují (`LOG_WINDOW`).

**Milníky** se řadí podle data (nejbližší nahoře, bez data na konec) a jsou
rozdělené podle zakázek. Správce má u řádku **Splněno** (zezelená, zapíše kdo
a kdy) a **Upravit**. Roletka v liště ukazuje šest nejbližších termínů.

---

## Pasti, na které jsme narazili (ať se neopakují)

1. **Firestore neumí pole v poli.** Body kresby na tabuli jsou proto naplocho
   `[x1,y1,x2,y2,…]`; `[[x,y],…]` skončí na `Nested arrays are not supported`.
2. **Jediné `NaN` shodí celou tabuli** – hlídá to `bounds()`, `applyView()`
   a `sanitize()`.
3. **Chybějící `box-sizing: border-box`** vytlačoval pole z panelu editoru ven.
4. **Pořadí CSS u editoru:** `.editor-panel { width: 100% }` musí zůstat *před*
   media query, jinak se náhled srazí na nulu.
5. **Google Fonts servírují Lato rozsekané** – proto vlastní WOFF v repu.
6. **`serve` zahazuje parametry** při přesměrování z `/x.html` na `/x`.
7. **Verze assetů:** po každé změně v `assets/…` zvýšit `?v=N` ve všech HTML
   (teď `?v=45`), jinak lidé uvidí starou verzi kvůli cache GitHub Pages.
   Jedním vrzem: `sed -i 's/?v=45/?v=46/g' *.html`
8. **`saveTask` a `saveUser` zapisují pole natvrdo, ne přírůstkově.** Formulář
   úkolu se skládal znovu bez `log` a `done` a každá úprava smazala historii.
   Když se přidá další pole, musí se přenést taky.
9. **Uložený číselník přebíjí výchozí hodnoty v kódu.** Přidání `TABULKY` do
   `DEFAULT_SKUPINY` se neprojevilo, dokud se nedopsalo i do databáze.
10. **Komentář na stejném řádku v `.gitignore` nefunguje** (`~$*  # komentář`).
11. **`.xlsx` se nedá číst heredocem do Pythonu** – skript uložit do souboru
    a spustit; Python je jen ten z ArcGIS Pro
    (`C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe`).
12. **Role se nesmí brát z prohlížeče.** Držela se v localStorage a stránky jí
    věřily – šlo mít práva správce bez záznamu v databázi. Teď `UI.role()`
    čte ze seznamu podle UID a uložená hodnota jen překlene načítání.
13. **`syncRole` nesmí odhlašovat, dokud nedorazí seznam lidí** – jinak se
    člověk odhlásí sám při každém načtení stránky.
14. **Trezor: než se prohlásí za nenastavený, musí se ověřit v databázi.**
    Odemknutí ho jinak přepsalo novým klíčem a hesla se přestala dát číst.
15. **Authorized domains ve Firebase se netýkají přihlášení e-mailem a heslem.**
    Claude tvrdil, že bez přidání domény login přestane fungovat – nepřestal.
    Seznam hlídá OAuth (Google apod.) a odkazy v e-mailech.
16. **GitHub Pages staví několik minut.** „Oprava se neprojevila" bývá jen
    nedokončený build – ověřit `gh api repos/…/pages/builds/latest` nebo
    verzi assetu ve zdroji stránky.
17. **Pravidla Firestore nejsou filtr.** Kdo smí číst jen svoje, musí si o to
    říct dotazem `where("uid","==",…)`; na celou kolekci databáze odpoví
    odmítnutím celého přenosu, ne prázdným výsledkem.
18. **Pravidla se sčítají a níž se nedají odebrat.** Proto leží výkazy mimo
    `public/data`, nad kterým stojí `allow read: if clen()`.
19. **Firestore neumí schovat jednotlivé pole** – kdo dokument přečte, přečte
    ho celý. Proto je čas a peníze rozdělený na dva dokumenty se stejným `{id}`.
20. **Schované tlačítko není zabezpečení.** `KBUI.can()` řídí jen to, co se
    vykreslí; skutečnou hranicí je `firestore.rules`. K nové pravomoci nad
    citlivými daty patří vždycky i pravidlo.
21. **Uložené hodiny a částky se nikdy nepřepočítávají zpětně.** Sazby se
    v čase mění a loňský přehled musí zůstat takový, jaký byl. Změna výchozí
    sazby proto nesahá na starší zápisy.
22. **`git add *.html` spadne na ignorovaném souboru.** V kořeni leží
    `Caflou-dotaznik.html`, který je v `.gitignore`; git kvůli němu vrátí
    chybu a zbytek sice přidá, ale příkaz skončí nenulově.
23. **Repozitář je veřejný, takže data nesmí do souborů webu – ani do textu.**
    Souhrn Přehledu BP proto leží ve Firestore a stránka si ho tahá odtud.
    Přesto se do vysvětlivek na téže stránce dostala konkrétní hodinová sazba
    a jmenovitě čí hodiny – četl to kdokoliv bez přihlášení. Když se píše
    text na stránku, platí totéž co pro data.
24. **Do `innerHTML` patří všechno přes `KBUI.esc()`, i čísla.** Do dlaždic
    Přehledu BP se vkládala procenta z nahraného JSONu bez ošetření. Nahrát
    ho smí správce, čte ho hlavní správce – dala se tudy podstrčit skript
    a sáhnout si na správu uživatelů a trezor hesel. Totéž platilo pro názvy
    zakázek v roletce lišty, které smí přejmenovat kdokoliv přihlášený.
25. **Náhled role se nesmí míchat se skutečnou rolí.** `UI.skutecnaRole()`
    čte výhradně z databáze, `UI.role()` vrací náhled. Náhled se uzná jen
    hlavnímu správci a jde vždycky jen dolů – kdyby to bylo obráceně, byla
    by z toho past 12 znovu.
26. **Sloupce do cizího sešitu se přidávají až za jeho vlastní data.**
    Ne natvrdo od `O`: Kuba má v O–R boční tabulku malých akcí a přepsal
    jsem mu ji.

---

## Výkazy práce (13. 8. 2026)

Náhrada excelových výkazů: `vykazy.html` (zápis a záznamy) a
`vykazy-prehled.html` (kolik kdo odpracoval a co to stálo). Jak to funguje
je v [README.md](README.md#výkazy-práce), tady je jen to, co ještě není
hotové a proč se to udělalo takhle.

### Kdo co vidí

| | Správce | Zaměstnanec |
|---|---|---|
| ikona hodin nad lištou | ✓ | ✓ (`vykaz.otevrit`) |
| cizí zápisy, filtr *Všichni lidé* | ✓ | – |
| sazby, částky, dlaždice *Vyfakturováno* | ✓ | – |
| *Stáhnout CSV*, *Firmy a sazby*, Přehled peněz | ✓ | – |
| zapisovat za kohokoliv | ✓ | jen za sebe |

Zaměstnanci to **není jen schované** – databáze mu cizí zápisy ani sazby
nevydá. Musí si o svoje říct dotazem `where("uid","==",…)`
(`KB.watchMojeVykazy()`), protože **pravidla nejsou filtr**: na celou kolekci
by Firestore odpověděl odmítnutím.

### Proč je to rozdělené na dva dokumenty

Jeden zápis leží ve dvou dokumentech se stejným `{id}`: čas v `zaznamy`
(vidí vlastník i správce), peníze v `castky` (jen správce). Firestore neumí
schovat jednotlivé pole – kdo dokument přečte, přečte ho celý.

A celá větev `private/vykazy/**` je **mimo `public/data`** schválně: nad
`public/data/**` stojí `allow read: if clen()` a pravidla se sčítají, takže
by se to níž už nedalo odebrat.

### Historické výkazy z excelů – co se s nimi udělalo (14. 8. 2026)

Čtrnáct lidí, devět let, **39 081 hodin za 8,8 milionu**. Data přišla jako
stažené `.xlsx` z Google Sheets; **živý přenos z Google Sheets nejde** –
sdílení je omezené a `…/export?format=csv` vrací HTTP 401.

**Nástroje leží mimo repozitář** v `Desktop\claude\vykazy_nastroje\` a mají
vlastní návod `JAK-NA-TO.md`. Do gitu nepatří: pracuje se v nich se sazbami
a výdělky jmenovitě, a tenhle repozitář je veřejný. Je to čistý Node.js bez
knihoven – `.xlsx` se čte přímo jako ZIP s XML.

Co z toho vzešlo:

| | |
|---|---|
| **rozřazené sešity** | `Desktop\claude\vykazy_rozrazeno\` – u každého člověka přibyly sloupce ZAKÁZKA / DRUH / hodin / co to bylo, s roletkami |
| **`prehled-BP.json`** | souhrn BioPharmy pro stránku Přehled BP |
| **`ZBYVA-doplnit.csv`** | co se nepodařilo zařadit, seřazené podle hodin |

Zařazeno je **86 % hodin**, z toho pětina odhadem podle okolních dnů.
BioPharma vyšla na **10 399 h za 2 776 tisíc**, druhá je hromada drobných
pasportů RD, pak C03, SIMU a RECETOX D30.

**Pravidla, podle kterých se to zařazuje, jsou v `matcher.js`** a stojí za
přečtení, než se do nich sáhne – každá pojistka v nich vznikla po konkrétní
chybě, která dávala nesmyslná čísla (holé číslo v textu čtené jako hodiny,
dělení popisu na pomlčce, obecné slovo použité jako vodítko, hodiny
připsané zakázce, která tehdy ještě neexistovala). Popis je v `JAK-NA-TO.md`.

Sloupce se v každém sešitu zapisují **až za poslední vlastní data toho
člověka**, ne natvrdo od `O` – Kuba si vpravo vede boční tabulku malých
akcí ve sloupcích O–R a jednou už jsem mu ji přepsal.

### Co ještě není

- **Import do databáze.** Rozřazení zatím žije v excelech a v souhrnu na
  Přehledu BP; jednotlivé zápisy se do Firestore nenahrávaly. Až to bude
  potřeba, jde o měsíční souhrny (měsíc × zakázka × druh × člověk), ne
  o sedm tisíc jednotlivých řádků.
- **Zbylých 14 % hodin.** Jsou to zápisy, kde člověk napsal, co dělal, ale
  ne kde (`GIS`, `voda`, `Brno`). Z textu to nikdo nevytáhne – buď se to
  projde s lidmi, nebo zůstane nezařazené.
- **Šest zakázek chybí v evidenci** a vedou se pod vlastním názvem:
  OHL ŽS SIMU (2 932 h), CETOCOEN Block (1 360 h), DLH/DHL schema,
  BD Neumanova, Hotel Voroněž, AXA.
- **Starší zápisy mají druh vypracování velkými písmeny** (`ARCGIS`), nový
  číselník je `ArcGIS / Focení / Skeny / Tabulky / Administrativa`. Reálná
  data zatím žádná nejsou; kdyby vznikla dřív, chce to převod.
- **Schvalování výkazů** (kdo a kdy zápis potvrdil) není – nevíme, jestli se
  má schvalovat. U Cafly to byla jedna z otázek v dotazníku.
- **Sazba u zápisu je fakturační**, ne mzdová. Kdyby se měly sledovat i
  náklady (mzda × hodiny) a z toho zisk zakázky, přibude druhé číslo.
- **Oběd (200 Kč) a kilometr (5 Kč) jsou natvrdo v kódu** (`OBED_KC`,
  `KM_KC` v `store.js`). Až se změní, patří to do číselníku, ne do konstant.
- **Zpětný zápis do Google Sheets nejde napřímo** – tentýž problém jako
  u Cafly: statický web na Pages nemá kam schovat klíč. Cesta je export CSV
  (hotovo) nebo Apps Script na straně tabulky.

## Co zbývá

### 1. Zálohy

Tlačítko **Stáhnout zálohu** na `uzivatele.html` vysype návody, úkoly, lidi
i tabule do JSON. **Obnova z něj ale zatím není** – zpátky by se to muselo
nahrát ručně. Stálo by za to doplnit import.

### 2. Drobnosti

- `assets/data/navody-skripty.json` (41 kB textů) je ve veřejném repu; data
  jsou stejně ve Firestore, klidně smazat.
- **`noindex` má jen `vykazy.html`** – ostatní stránky se můžou objevit ve
  vyhledávačích. Obsah je za přihlášením, takže se vyzradí leda názvy.
- Složku `prozkoumat/` (klon z druhého počítače) je možné smazat.
- Šedé logo (vodoznak v PDF) má jen 600 px, pro tisk by chtělo ~1200 px.
- Písma váží 1,4 MB; WOFF2 by to srazil na ~400 kB.
- Načítání všech návodů najednou řešit až kolem 100–150 návodů.
- Dva úkoly nemají přiřazené lidi, protože v textu byli dva nebo přezdívka
  bez příjmení: **Zpracování tabulek místností** („Ondra, Amálka") a
  **Focení – světla, nouzáky, zásuvky** („Elda Kaňa").
- Milníky jsou všechny pod zakázkou **BioPharma** – Claude to odhadl podle
  rozdělané zakázky, v předané tabulce zakázka nebyla.

### 3. Tabule – co jsme probírali a ještě není

- **sbalování větví** myšlenkové mapy
- formátování **jednotlivé buňky** tabulky
- hledání v obsahu tabule
- export tabule do PNG/PDF
- rámečky/sekce na plátně

### 4. Zamítnuté nebo nemožné

- **Poklepání na Apple Pencil** – Safari to webovým stránkám nehlásí.
- **Velká klávesnice na iPadu** – nastavení systému, web s tím nic neudělá.
- **Propojení s Caflou** – API mají jen vyšší tarify a klíč by nesměl být ve
  webu. Reálná cesta je serverová funkce nebo import zakázek z CSV.
- **Odeslání e-mailů za Michala** – Claude se nepřihlašuje do cizí schránky
  a nemá znát heslo k poště. Připraví text, odeslání zůstává na správci.

---

## Jak se pracuje

- Commituje a pushuje se rovnou na `main`, web se sám nasadí na GitHub Pages
  (build trvá pár minut).
- Zprávy commitů česky, popisují **proč**, ne jen co.
- Kód je komentovaný česky, styl: žádné frameworky, čisté HTML/CSS/JS.
- Po každé změně assetů zvýšit `?v=N` ve všech HTML naráz:
  `sed -i 's/?v=38/?v=39/g' *.html`
- Ověřovat v prohlížeči, ne jen „mělo by to jít“. **Data v databázi jsou
  ostrá** – testovat na dočasném záznamu nebo účtu a po sobě uklidit.
- **Nikdy necommitovat `Seznam.xlsx`** ani nic s hesly; repozitář je veřejný.
