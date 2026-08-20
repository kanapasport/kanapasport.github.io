# PŘEDÁNÍ — WEB 2.0

Nová verze firemního webu **Pasport Kaňa**. Větev **`novy-web`**, verze
souborů **`?v=87`**. Ostrý web (`kanapasport.github.io`) pořád jede verzi 1.0
z větve `main` — 2.0 se na něj dostane až sloučením.

**Obě verze sdílí jednu databázi.** Co zapíše 2.0, uvidí i ostrý web.

---

## Obsah

1. [Co je 2.0 zač](#1-co-je-20-zač)
2. [Čeká na Michala](#2-čeká-na-michala)
3. [Jak web spustit](#3-jak-web-spustit)
4. [Mapa webu](#4-mapa-webu)
5. [Kdo co smí](#5-kdo-co-smí)
6. [Kde leží data](#6-kde-leží-data)
7. [Co drží prohlížeč](#7-co-drží-prohlížeč)
8. [Pravidla, která platí vždycky](#8-pravidla-která-platí-vždycky)
9. [Pasti](#9-pasti)
10. [Co se odložilo](#10-co-se-odložilo)

---

## 1. Co je 2.0 zač

Verze 1.0 byla databáze návodů. **2.0 je nástroj na řízení firmy**:

| Oblast | Co umí |
|---|---|
| **Výkazy práce** | zápis dne po blocích, absence, oběd a kilometry, přehledy hodin a peněz, mřížka vytížení |
| **Projekty** | údaje, rozpočet, budovy/patra/technologie, lidé a sazby, **budget úkolů a matice plnění** |
| **Úkoly & TO-DO** | rozpad úkolu na kroky s procenty, zápis výkazu rovnou z řádku |
| **Kalendář** | dovolené, nemoci, školení, termíny úkolů a milníky celé firmy |
| **Nástěnka** | moje úkoly, Quick TO-DO, nejbližší termíny, upozornění pro kontrolu |
| **Tabule** | nekonečné plátno na náčrtky a myšlenkové mapy, sdílené i soukromé |
| **Návody** | to, co uměla 1.0 — plus hledání s našeptávačem |
| **Provoz** | Quick TO-DO, Správa aut, historie aktivit, záloha a obnova |

Web je **statický** (žádný build), data drží **Firebase Firestore**,
přihlášení **Firebase Auth**.

---

## 2. Čeká na Michala

| # | Co | Kde | Stav |
|---|---|---|---|
| 1 | **Nasadit `firestore.rules`** | Firebase Console → Firestore → Rules | ✅ hotovo 18. 8. |
| 2 | **Přesunout tabule** | Import dat → *Zkopírovat tabule na nové místo* | ⬜ čeká |
| 3 | **Nahrát nový `prehled-BP.json`** (17 lidí, 11 073 h) | Přehled BP → import | ⬜ čeká |
| 4 | **Vyplnit BioPharmu** — rozpočet 28 500 h, budovy, patra, technologie | Správa projektů → Údaje | ⬜ čeká |
| 5 | Uklidit staré umístění tabulí — **až po ověření** bodu 2 | Import dat | ⬜ čeká |
| 6 | Na ostrém webu smazat zakázky, co tam natekly (Moravský Beroun, Střížovice) | starý web | ⬜ čeká |

> **Pořadí u tabulí:** pravidla → zkopírovat → ověřit na stránce Tabule →
> teprve pak uklidit staré. Dokud přesun neproběhne, tabule vidí jen manažeři.

---

## 3. Jak web spustit

**Na tomhle i cizím počítači:** dvojklik na **`SPUSTIT-PREZENTACE.bat`**
ve složce webu → `http://localhost:5174/index.html`. Okno nechat otevřené.

Dávkový soubor si sám najde, čím web pustit: Python z ArcGIS Pro → Python
z PATH → Node.js → vlastní `server.ps1` v PowerShellu (ten **nepotřebuje
nainstalovat nic**).

**Dvojklik na `index.html` nestačí** — stránky načítají skripty jako moduly
a prohlížeč je z adresy `file://` odmítne.

Přenos na jiný počítač popisuje **`PREZENTACE-jak-spustit.md`**.

**Aktualizace z Gitu:**

```bash
git checkout novy-web
git pull
```

---

## 4. Mapa webu

### Lišta

**VÝKAZY · PROJEKTY · ÚKOLY & TO-DO · KALENDÁŘ · MILNÍKY · NÁVODY**

Stránky, které patří k sobě, mají **stejnou podlištu** a liší se jen
zvýrazněnou položkou:

| Podlišta | Stránky |
|---|---|
| Výkazy | `vykazy.html` · `vykazy-prehled.html` · `vytizeni.html` |
| Projekty | `sprava.html` · `gantt.html` · `firmy.html` |
| Nastavení | `nastaveni.html` · `uzivatele.html` · `barvy.html` · `import.html` |

### Svislý pás vlevo

Osobní věci, ne kopie lišty: **Stats (Můj den) · Quick TO-DO · Správa aut ·
Nový výkaz · Moje úkoly · Nový projekt · Nastavení**, dole jméno, role
a odhlášení. **Nepřihlášený nevidí nic z toho** — jen přihlašovací tlačítko.

### Stránky

| Stránka | K čemu |
|---|---|
| `index.html` | nástěnka: moje úkoly, Quick TO-DO, kalendář, milníky, upozornění pro kontrolu |
| `vykazy.html` | zápis výkazu, filtry, souhrn (peníze za „zobrazit") |
| `vykazy-prehled.html` | přehled výkazů po lidech s mřížkou vytížení |
| `vytizeni.html` | vytížení celého týmu |
| `vykazy-bp.html` | přehled zakázky BioPharm ze starých excelů (jen manažeři, na heslo) |
| `sprava.html` | **hlavní stránka projektů** — 3 záložky: Údaje · Spolupracovníci · Plnění |
| `gantt.html` | plán projektů v čase |
| `firmy.html` | správa firem (IČO, adresa, kontakt) |
| `ukoly.html` | úkoly s TO-DO rozpadem |
| `kalendar.html` | kalendář firmy, skok na datum |
| `milniky.html` | termíny odevzdání |
| `tabule.html` | kreslicí plátna |
| `navody.html`, `navod.html`, `editor.html`, `uvod.html` | návody |
| `nastaveni.html`, `uzivatele.html`, `barvy.html`, `import.html` | nastavení, lidé a hesla, barvy webu, import a zálohy |
| `historie.html`, `reporty.html` | historie aktivit a reporty |

### Správa projektů podrobněji

Nahoře **pruh projektů** (jen oblíbené + *Zobrazit všechny*), pod ním detail
na celou šířku ve třech záložkách:

- **Údaje** — číslo, název, firma, termíny, priorita, rozpočet (Kč i hodiny),
  rezerva peněz, části, budovy / patra / technologie
- **Spolupracovníci** — kdo na projektu dělá, kdo dělá kterou technologii,
  sazby na projektu (sbalené)
- **Plnění projektu** — dvě dlaždice:
  - *Plnění po budovách a patrech*: krajíc hodin, přehled celých pater
    (klik = detail patra s rozpadem po technologiích) a **matice**
    technologie × patra s přepínačem **% TO-DO / Zbývá hodin**
  - *Úkoly projektu*: tabulka s filtrem (budova, patro, technologie, stav,
    text) a s Uložit · Upravit · Smazat

---

## 5. Kdo co smí

| | hlavní správce | manažer | zaměstnanec | student |
|---|:--:|:--:|:--:|:--:|
| otevřít výkazy a zapisovat svoje | ✓ | ✓ | ✓ | ✓ |
| vidět cizí výkazy a peníze | ✓ | ✓ | – | – |
| zakládat a mazat úkoly | ✓ | ✓ | – | – |
| spravovat projekty a rozpočty | ✓ | ✓ | – | – |
| **vidět budgety úkolů** | ✓ | ✓ | – | – |
| spravovat uživatele a hesla | ✓ | – | – | – |
| měnit vzhled webu | ✓ | – | – | – |

Skutečnou hranicí je **`firestore.rules`**, ne schované tlačítko. Náhled
„prohlížím web jako zaměstnanec" mění **jen vykreslení** — data chodí pořád
podle skutečného účtu.

---

## 6. Kde leží data

```
public/data/          čte každý přihlášený
  guides/             návody
  kalendar/           dovolené, nemoci, školení
  auta/               Auto Brno + rezervace vozů
  users/              lidé a role (píše jen hlavní správce)
  meta/zakazky        číselník projektů, firem, budov a pater
  pritomnost/         kdo je právě na webu

private/              čte jen manažer, pokud pravidlo neřekne jinak
  vykazy/zaznamy/     čas: kdo, kdy, co  → svoje vidí každý
  vykazy/castky/      peníze k témuž {id} → JEN manažer
  vykazy/ciselniky/   sazby lidí, rozpočty projektů
  vykazy/prehledy/    hotové přehledy ze starých excelů (Přehled BP)
  projekty/seznam/    hlavičky projektů → přiřazený vidí svoje
  projekty/finance/   peníze projektů
  ukoly/seznam/       úkoly s TO-DO → čte každý člen
  ukoly/budgety/      budget a rezerva úkolu → JEN manažer
  tabule/seznam/      tabule; o čtení rozhoduje hlavička tabule
  kontrola/seznam/    odbavená upozornění na nástěnce
  aktivity/seznam/    historie kroků (píše každý, čte manažer)

osobni/quicktodo/     rychlé vzkazy — jen autor a adresát, ani manažer
```

**Proč jsou čas a peníze dva dokumenty:** Firestore neumí schovat jednotlivé
pole — kdo dokument přečte, přečte ho celý. Zaměstnanec tak vidí svoje
hodiny, ale ne sazbu. Stejný trik má úkol × budget úkolu.

---

## 7. Co drží prohlížeč

Tohle se **nepřenáší** na jiný počítač (a nic se tím neztratí):

| Klíč | Co |
|---|---|
| `kb-akcent`, `kb-barvy-vlastni` | barva webu a uložené palety |
| `kb-sprava-oblibene` | oblíbené projekty (hvězdičky) |
| `kb-sprava-zalozka`, `kb-sprava-sekce`, `kb-sprava-mxrezim` | co je ve Správě rozbalené |
| `kb-quick-oblibene` | oblíbené party lidí v Quick TO-DO |
| `kb-tabule-zvetseno` | zvětšení tabule |
| zámek citlivých sekcí | v `sessionStorage`, platí **3 minuty** od poslední práce |

Oblíbené projekty se na novém počítači **nastaví samy** (BioPharma, C03, A08
a tři nejnovější pasporty). Heslo k citlivým sekcím se vyžádá znovu.

---

## 8. Pravidla, která platí vždycky

1. **Repozitář je veřejný.** Žádná jména klientů, sazby ani částky ve zdrojích.
2. **Do `innerHTML` všechno přes `KBUI.esc()`**, i čísla.
3. **Po zásahu do `assets/` zvednout `?v=NN` ve všech HTML naráz:**
   `sed -i 's/?v=87/?v=88/g' *.html`
4. **Odběry se smí rozšířit, ne zúžit** (`moje` → `vše`).
5. **Pravidla nejsou filtr** — kdo smí číst jen svoje, musí se ptát dotazem
   `where(...)`, jinak Firestore odmítne celý přenos.
6. **Nesloučit `novy-web` do `main`**, dokud Michal neřekne.

---

## 9. Pasti

Každá vznikla po konkrétní chybě. Nerušit bez rozmyslu.

**Jazyk a nástroje**

- **Česká uvozovka `"` uvnitř `"…"` utrhne JS.** Stalo se dvakrát; v `ui.js`
  tím zmizelo celé `window.KBUI`. Psát `“` nebo uvozovky vynechat.
- **`%~dp0` končí zpětným lomítkem** a v uvozovkách rozbije příkazovou řádku.
- **PowerShell 5.1 čte `.ps1` jako ANSI** — česká jména souborů se rozsypou.
  Na práci se soubory používat Python.
- **Verze `?v=NN` musí být stejná ve všech HTML.**

**Firestore**

- **Dotaz projde jen tehdy, když má člověk právo na KAŽDÝ vrácený dokument.**
  Proto se tabule i Quick TO-DO čtou několika úzkými dotazy a slévají podle id.
- **Co nemá pole, to dotaz na rovnost nenajde** (tabule bez `viditelnost`).
- **Chybějící pole v pravidlech není prázdná hodnota, ale chyba** = zamítnuto.
  Ověřovat přes `in`.
- **`merge: true` slučuje po polích.** Náhradní hodnota v zápisu přepíše tu
  uloženou — `saveBoardMeta` proto zapisuje jen to, co dostala.
- **Obě verze webu sdílí databázi.**

**Rozhraní**

- **Přihlášení odkrývá všechny `<main>` naráz** — prvek, který si o zobrazení
  rozhoduje sám, nesmí být `<main>`.
- **Volání `$("btnNeco")` na smazaný prvek shodí celou inicializaci stránky.**
- **`.linkbtn` je kreslený pro červený pruh** (bílé písmo) — mimo `main` je
  bílý na bílém.
- **`position: relative` nechává platit `top`/`right`** z původního pravidla;
  správně je `position: relative; inset: auto`.
- **`.card` nemá vnitřní odsazení.**
- **Prohlížeč si obsah `<datalist>` zamkne při `mousedown`**, ne při `focusin`.
- **Zvuk jde přehrát až po gestu uživatele.**
- **Oddělovač ` · ` patří jen MEZI kusy** — jinak řádek začne tečkou.
- **Náhledový prohlížeč vrací zastaralé `getBoundingClientRect`** po změně
  třídy. Když měření odporuje kódu, ověřit screenshotem.

**Data výkazů**

- **Náhled role mění jen vykreslení** — data chodí podle skutečného účtu.
- **Zaškrtávátko čtené přes špatný selektor tiše vrací `false`.**
- **Výkaz si příznak „celý den" nenese** — pozná se z časů 00:00–23:59.
- **Kalendářová událost musí jít dohledat i bez `vykazId`** (starší záznamy).
- **Sloupce v excelových výkazech leží v každém sešitě jinde** — hledat podle
  hlavičky, ne podle pevného indexu. A práh „kolik hodnot stačí" musí být
  absolutní: brigádník má předvyplněný celý rok, ale odpracovaných dnů pár.

---

## Rozpracovaná dávka (zadáno 19. 8.)

Stav se odškrtává průběžně – podle tohohle seznamu se pokračuje i po
předání kontextu.

- [x] 1. Auta: změna „Od" posune „Do", když by bylo dřív
- [x] 2. Zrušit „části projektu" (Správa) i „Část" ve výkazu
- [x] 3. Budget technologií v PENĚZÍCH; vedle Kč vypsat hodiny podle
      průměrné hodinovky lidí přiřazených k technologii (lideTech + sazby)
- [x] 4. Dialog nového úkolu z matice: předzaškrtnout lidi té technologie,
      pole na TO-DO (řádek = položka), popisek „Primární druh práce"
- [x] 5. Firma ve výkazu jen ke čtení, když ji projekt má nastavenou
- [ ] 6. Výkaz – nové pořadí: budova → patro → technologie; výběr úkolu
      podle nich (nebo rovnou úkol → zamkne budovu/patro/technologii
      a předvyplní druh); popis práce NEPOVINNÝ vedle povinného druhu;
      sazba za „⋯ zobrazit"
- [ ] 7. Upozornění pro kontrolu: zápis hodin na cizí úkol (výpomoc) –
      manažer potvrzuje fajfkou; označení i ve výkazech
- [ ] 8. Úkol „hotovo" od zaměstnance čeká na POTVRZENÍ manažera
      (přes upozornění pro kontrolu)
- [ ] 9. Dovolené: potvrzování manažerem, v kalendáři „Nepotvrzená
      dovolená", nová dlaždice „Potvrzení dovolených"
- [ ] 10. Reporty: záložky QUICK TODO / TODO / Výkazy; u TODO z kolika
      na kolik procent (logovat do aktivit i do úkolu)
- [ ] 11. Úkoly: tlačítko Historie u rozbaleného úkolu (kdo kdy kolik %)
- [ ] 12. Quick TODO jako samostatná stránka (lišta + proklik z dlaždice);
      panel v pásu zůstává jen na tvorbu
- [x] 13. Zrušit „Přizpůsobit" na nástěnce

---

## 10. Co se odložilo

- **Efektivita** (budget ÷ skutečnost) — probrané tři scénáře, čeká se na
  výběr. Vazba výkazu na úkol (`ukolId`) i budgety už existují.
- **Šablony** projektů, úkolů a vzhledu — „až je budu potřebovat, ozvu se".
- **Přesun na Firebase Hosting + vlastní doménu** — schváleno, neprovedeno.
- **Jméno klienta ve zdrojích** — na pár místech pořád je (texty, klíč
  `biopharma` v databázi). Klíč přejmenovat nejde bez ztráty dat, texty ano.
- **Apps Script — denní e-mailový souhrn** — probráno, nerozhodnuto.
- **Sloučení `novy-web` do `main`.** Až se bude slučovat, počítej s tím, že
  se lidem změní celý web naráz.

---

## Kde je co mimo repozitář

Repozitář je veřejný, tyhle věci v něm nejsou:

| Soubor | K čemu |
|---|---|
| `PREDANI_WEB\vykazy\` | excelové výkazy lidí a evidence zakázek |
| `PREDANI_WEB\vykazy_rozrazeno\` | rozřazené výkazy, `prehled-BP.json`, `analyza-mista.py` |
| `PREDANI_WEB\vykazy_nastroje\` | nástroje na rozbor výkazů + `JAK-NA-TO.md` |
| `PREDANI_WEB\projekty-import.json` | import zakázek do databáze |
| `PREDANI_WEB\NA-NOTEBOOK\` | připravená kopie webu na přenos |
