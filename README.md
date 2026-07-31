# Pasport Kaňa – firemní knowledge base

Statický web na GitHub Pages: <https://kocismichal.github.io/pasportkana_navody/>
Data (návody, obrázky, úkoly) žijí ve Firebase Firestore, projekt `pasportkana`.
Bez buildu – všechno je čisté HTML, CSS a JavaScript, otevře se i dvojklikem.

## Stránky

| Soubor | K čemu je |
|---|---|
| `index.html` | Rozcestník – logo, hledání v celé databázi, dlaždice sekcí |
| `navody.html` | Výpis návodů – vlevo dlaždice, vpravo rovnou náhled (`?kat=…&sub=…&id=…`) |
| `navod.html` | Čtení jednoho návodu (`?id=…`) – sazba A4 + export do PDF |
| `editor.html` | Tvorba a úprava návodu (`?id=…`) – vlevo editor, vpravo živý náhled |
| `ukoly.html` | Úkolovník – úkoly seskupené podle zakázek, patra, procenta, poznámky |

## Sdílené soubory

| Soubor | K čemu je |
|---|---|
| `assets/js/taxonomy.js` | **Struktura webu** – sekce, kategorie, horní navigace, ikony |
| `assets/js/store.js` | Firebase: návody, obrázky, úkoly |
| `assets/js/doc.js` | Sazba A4, stránkování, export PDF, lupa na obrázky |
| `assets/js/ui.js` | Horní lišta, toasty, role, hledání, komprese obrázků, pokyn pro AI |
| `assets/css/app.css` | Všechny styly včetně geometrie A4 a responzivity |
| `assets/data/navody-skripty.json` | Záloha textů návodů ke skriptům (jednorázový import) |

**Chceš přidat nebo přejmenovat kategorii?** Stačí upravit `assets/js/taxonomy.js` –
rozcestník, horní lišta i filtry se přizpůsobí samy. Kategorie umí tři úrovně:
kategorie → program/oblast → téma. Skripty jsou rozdělené na
**OBECNÉ / STAVBA / TECHNOLOGIE**; přesunout skript jinam znamená přesunout
jeden řádek v `taxonomy.js`, v databázi se nic měnit nemusí.

Dlaždice na rozcestníku jsou červené a mají dva vystředěné řádky prokliků:
v prvním jsou **čtyři naposledy upravené** podsekce, ve druhém tlačítko, které
rozbalí zbytek. Počty návodů se nikde nevypisují.

### Výpis návodů

Druhý řádek lišty má vlevo barevně označenou **kategorii** a její sekce
(VŠE / OBECNÉ / STAVBA / …), vpravo pokyn pro AI a nový návod. Třetí úroveň
(témata uvnitř programu) se ukáže jen tam, kde na jedno téma připadá víc
návodů – jinak by jen opisovala dlaždice.

Vlevo jsou červené dlaždice návodů (kategorie, název, autor – nic víc),
vpravo se rovnou vykreslí náhled vybraného. Když se kategorie jen rozklikne,
otevře se její **hlavní návod** – ten se určuje klíčem `main` u kategorie
v `taxonomy.js` (u skriptů je to `skript-ai`).

## Vzhled

Světlý šedý motiv, hlavní barva červená, písmo **Lato** (300/400/700/900).
Barvy, písmo i zaoblení rohů jsou na jednom místě v `:root` v `app.css`:

| Proměnná | K čemu je |
|---|---|
| `--font` | písmo celého webu **i tištěného dokumentu** |
| `--accent` | hlavní červená (nadpisy dlaždic, ikony, aktivní prvky) |
| `--radius`, `--radius-lg` | zaoblení – držené nízko, ať jsou tvary obdélníkové |
| `--doc-accent` | barva tištěného dokumentu (PDF zpátky do modré = jeden řádek) |

Písmo se načítá z Google Fonts odkazem v hlavičce každého HTML. Když měníš
`--font`, změň i ten odkaz.

### Hlavička

Na všech stránkách stejná. Nahoře **červený pruh** (v něm bílá varianta loga
`Pasport_Kana_white.png`), pod ním lišta:

1. v pruhu vpravo nahoře **přihlášený uživatel**, odhlášení a pod tím stav
   připojení k databázi,
2. uprostřed pruhu **logo** – zabírá skoro celou jeho výšku, na rozcestníku
   je větší (`mountNav({ big: true })`),
3. vpravo dole v pruhu, tedy **přímo nad lištou**, ikony nástrojů – popis
   vyjede až po najetí myší,
4. **navigační lišta** (DOMŮ, NÁVODY, ÚKOLOVNÍK) vycentrovaná na střed
   stránky a vpravo **hledání**,
5. na výpisu návodů a v úkolovníku ještě **druhý řádek lišty** s filtry
   (`mountNav({ subbar: true })` vyrobí prázdný `#appSubbar`, stránka si ho
   naplní sama).

Roletka u ÚKOLOVNÍKU se plní **zakázkami z databáze** – jakmile někdo založí
novou, objeví se v liště sama (`taskMenu()` v `ui.js`).

Při odrolování zůstává viset jen spodní část lišty – hlavička se posune nahoru
přesně o výšku toho, co je nad ní (`stickyOffset()` v `ui.js`).

Roletka u NÁVODŮ je svislý seznam kategorií; najetím myší na řádek vyjede
obsah kategorie **vpravo vedle seznamu**, kliknutím se přejde na danou sekci.

Pole hledání v liště obsluhuje stránka sama přes `KBUI.onSearch(handler)`.
Kde handler není, odešle Enter dotaz na `navody.html?q=…`.

Web je navržený pro PC, iPad i iPhone: pod 1024 px se lišta sbalí pod
tlačítko, pod 820 px jdou ikony nástrojů pod logo, dlaždice jdou do jednoho
sloupce a ovládací prvky mají minimálně 44 px pro pohodlné ťuknutí prstem.

## Jak vypadá dokument

Náhled na stránce **není** generovaný zvlášť od PDF. Obsah se rozstránkuje do
skutečných A4 elementů (210 × 297 mm) a PDF vznikne přesně z nich
(html2canvas → jsPDF). Co je vidět na obrazovce, to vypadne do PDF – včetně
diakritiky, zápatí i vodoznaku. Text v PDF je obrázkový, takže se z něj nedá
kopírovat (drobná ochrana obsahu navíc k vodoznaku).

### Formátování v textu kroku

- `**tučně**`, `` `kód` ``
- řádek začínající `- ` je odrážka
- `[obr 1]` odkáže na 1. obrázek daného kroku, `[obr 2.1]` na 1. obrázek 2. kroku –
  v návodu i v PDF z toho bude proklik, který obrázek zvětší

## Data ve Firestore

```
artifacts/firemni-kb-app/public/data/guides/{guideId}              ← text návodu
artifacts/firemni-kb-app/public/data/guides/{guideId}/images/{id}  ← obrázek (base64 JPEG)
artifacts/firemni-kb-app/public/data/tasks/{taskId}                ← úkol ze zakázky
artifacts/firemni-kb-app/public/data/logs/{autoId}                 ← záznamy přihlášení
```

Obrázky jsou v podkolekci, aby hlavní dokument návodu zůstal malý a seznam se
načítal rychle. Před uložením se screenshot zmenší na max. 1400 px a
zkomprimuje do JPEG (typicky 50–250 kB).

## Po úpravě sdílených souborů

GitHub Pages cachuje assety cca 10 minut. Když měníš `assets/…`, zvyš číslo
verze v odkazech ve všech HTML (`?v=5` → `?v=6`), jinak lidé uvidí starou verzi.

## Náhled na svém počítači

```
npx --yes serve -l 4173 .
```

Otevři `http://localhost:4173/index.html` (s koncovkou `.html`, jinak `serve`
při přesměrování zahodí parametry v adrese).

## Úkolovník

Úkoly jsou seskupené podle **zakázky** (BioPharma, C03, A08, Pasport Vrbice…).
Zakázka se vybírá v roletce ÚKOLOVNÍKU nebo ve druhém řádku lišty
(`ukoly.html?zak=nazev-zakazky`); na rozcestníku má každá svou dlaždici se
seznamem úkolů a procenty.

Ve vybrané zakázce má správce vpravo v liště **+ Nová zakázka** a
**+ Nový úkol do …** (druhé rovnou předvyplní zakázku). Když je seznam
prázdný, nabídne se tlačítko na založení vzorových zakázek.

## Role – dočasné řešení

Úkolovník rozlišuje **správce** (zakládá a maže úkoly) a **zaměstnance**
(zaškrtává hotovo a píše poznámky). Role se přepíná tlačítkem nad seznamem
úkolů a drží se v prohlížeči – **není to zabezpečení**. V hlavičce je proto
jen „Přihlášen jako …"; skutečné oddělení práv přijde s přihlašováním účtem
a heslem.

## Co je hotové a co ne

Hotové: rozcestník, tři úrovně kategorií, hledání v liště, sazba A4 = PDF,
obrázky s proklikem, šablony, import od AI, vodoznak, úkolovník po zakázkách,
responzivita pro telefon a tablet, dokumentace ke všem skriptům v toolboxu.

Zatím ne (schválně, až bude obsah): přihlašování účtem a heslem od správce,
přehled přihlášení pro správce, omezení stahování PDF jen na správce.
