# Pasport Kaňa – firemní knowledge base

Statický web na GitHub Pages: <https://kocismichal.github.io/pasportkana_navody/>
Data (návody i obrázky) žijí ve Firebase Firestore, projekt `pasportkana`.

## Stránky

| Soubor | K čemu je |
|---|---|
| `index.html` | Rozcestník – logo, hledání v celé databázi, dlaždice sekcí |
| `navody.html` | Přehled návodů, filtr podle kategorie / podkategorie (`?kat=…&sub=…`) |
| `navod.html` | Čtení jednoho návodu (`?id=…`) – sazba A4 + export do PDF |
| `editor.html` | Tvorba a úprava návodu (`?id=…` pro editaci), obrázky, živý náhled |

## Sdílené soubory

| Soubor | K čemu je |
|---|---|
| `assets/js/taxonomy.js` | **Struktura webu** – sekce, kategorie, podkategorie, ikony |
| `assets/js/store.js` | Firebase: čtení/zápis návodů a obrázků |
| `assets/js/doc.js` | Sazba A4, stránkování, export PDF, lupa na obrázky |
| `assets/js/ui.js` | Hlavička, toasty, hledání, komprese obrázků, pokyn pro AI |
| `assets/css/app.css` | Všechny styly včetně geometrie A4 |

**Chceš přidat nebo přejmenovat kategorii?** Stačí upravit `assets/js/taxonomy.js` –
rozcestník, filtry i editor se přizpůsobí samy.

## Jak vypadá dokument

Náhled na stránce **není** generovaný zvlášť od PDF. Obsah se rozstránkuje do
skutečných A4 elementů (210 × 297 mm) a PDF vznikne přesně z nich
(html2canvas → jsPDF). Co je vidět na obrazovce, to vypadne do PDF – včetně
diakritiky, zápatí i vodoznaku. Text v PDF je obrázkový, takže se z něj nedá
kopírovat (drobná ochrana obsahu navíc k vodoznaku).

Geometrie stránky je na jednom místě v `app.css` (`--a4-*`) a v `doc.js` (`MM`).

### Formátování v textu kroku

- `**tučně**`, `` `kód` ``
- řádek začínající `- ` je odrážka
- `[obr 1]` odkáže na 1. obrázek daného kroku, `[obr 2.1]` na 1. obrázek 2. kroku –
  v návodu i v PDF z toho bude proklik, který obrázek zvětší

## Data ve Firestore

```
artifacts/firemni-kb-app/public/data/guides/{guideId}              ← text návodu
artifacts/firemni-kb-app/public/data/guides/{guideId}/images/{id}  ← obrázek (base64 JPEG)
artifacts/firemni-kb-app/public/data/logs/{autoId}                 ← záznamy přihlášení
```

Obrázky jsou v podkolekci, aby hlavní dokument návodu zůstal malý a seznam se
načítal rychle. Před uložením se screenshot zmenší na max. 1400 px a
zkomprimuje do JPEG (typicky 50–250 kB).

## Po úpravě sdílených souborů

GitHub Pages cachuje assety cca 10 minut. Když měníš `assets/…`, zvyš číslo
verze v odkazech ve všech čtyřech HTML (`?v=1` → `?v=2`), jinak lidé uvidí
starou verzi.

## Co je hotové a co ne

Hotové: rozcestník, kategorie, hledání, sazba A4 = PDF, obrázky s proklikem,
šablony, import od AI, vodoznak na každé straně.

Zatím ne (schválně, až bude obsah): opravdové přihlašování účtem a heslem od
správce, přehled přihlášení pro správce, omezení stahování PDF jen na správce.
Teď se u návodu jen podepisuje jméno uložené v prohlížeči.
