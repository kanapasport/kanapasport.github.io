# Pasport Kaňa – firemní knowledge base

Statický web na GitHub Pages: <https://kocismichal.github.io/pasportkana_navody/>
Data (návody, obrázky, úkoly) žijí ve Firebase Firestore, projekt `pasportkana`.
Bez buildu – všechno je čisté HTML, CSS a JavaScript, otevře se i dvojklikem.

## Stránky

| Soubor | K čemu je |
|---|---|
| `index.html` | Rozcestník – logo, hledání v celé databázi, dlaždice sekcí |
| `navody.html` | Přehled návodů, filtr kategorie → program → téma (`?kat=…&sub=…`) |
| `navod.html` | Čtení jednoho návodu (`?id=…`) – sazba A4 + export do PDF |
| `editor.html` | Tvorba a úprava návodu (`?id=…`), obrázky, živý náhled |
| `ukoly.html` | Úkolovník – zakázky, patra, procenta hotovo, poznámky |

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
kategorie → program/oblast → téma.

## Vzhled

Světlý šedý motiv, hlavní barva červená. Barvy jsou na jednom místě v `:root`
v `app.css`. Tištěný dokument má vlastní proměnnou `--doc-accent` – když chceš
PDF zpátky do modré, změní se jen ten jeden řádek.

Web je navržený pro PC, iPad i iPhone: pod 1024 px se horní lišta sbalí pod
tlačítko, dlaždice jdou do jednoho sloupce a ovládací prvky mají minimálně
44 px pro pohodlné ťuknutí prstem.

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
verze v odkazech ve všech HTML (`?v=2` → `?v=3`), jinak lidé uvidí starou verzi.

## Role – dočasné řešení

Úkolovník rozlišuje **správce** (zakládá a maže úkoly) a **zaměstnance**
(zaškrtává hotovo a píše poznámky). Role se zatím jen přepíná tlačítkem
v pravém horním rohu a drží se v prohlížeči – **není to zabezpečení**.
Skutečné oddělení práv přijde s přihlašováním účtem a heslem.

## Co je hotové a co ne

Hotové: rozcestník, tři úrovně kategorií, hledání, sazba A4 = PDF, obrázky
s proklikem, šablony, import od AI, vodoznak, úkolovník, responzivita pro
telefon a tablet, dokumentace ke všem skriptům v toolboxu.

Zatím ne (schválně, až bude obsah): přihlašování účtem a heslem od správce,
přehled přihlášení pro správce, omezení stahování PDF jen na správce.
