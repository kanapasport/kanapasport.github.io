# Předání práce – Pasport Kaňa

Shrnutí stavu k **3. 8. 2026**, aby se dalo plynule pokračovat na jiném počítači
nebo v novém sezení. Poslední commit: `ab5b653`.

- **Živý web:** <https://kocismichal.github.io/pasportkana_navody/>
- **Repozitář:** <https://github.com/kocismichal/pasportkana_navody> (veřejný)
- **Data:** Firebase Firestore, projekt `pasportkana`, kolekce pod
  `artifacts/firemni-kb-app/public/data/…`

Technický popis webu je v [README.md](README.md) – tenhle soubor je navíc:
říká, **co se rozhodlo, o co se to opřelo a co ještě zbývá**.

---

## Jak to rozjet na druhém počítači

```bash
git clone https://github.com/kocismichal/pasportkana_navody.git
```

Web je bez buildu – otevře se i dvojklikem, ale kvůli Firebase je lepší
lokální server:

```bash
npx --yes serve -l 4173 .
```

Otevírej adresy **s koncovkou `.html`** (`http://localhost:4173/index.html`).
Bez ní `serve` při přesměrování zahodí parametry v adrese, takže by nefungovalo
`?kat=…`, `?zak=…` ani `?id=…`.

Na push je potřeba přihlášení k GitHubu – při prvním `git push` vyskočí okno
Windows Credential Manageru. Na starém PC je nainstalované **GitHub CLI**
(`gh` 2.97), ale přihlášené není; k pushování ho není potřeba.

---

## Co je hotové

| Stránka | Stav |
|---|---|
| `index.html` | Rozcestník – červené dlaždice, sekce Návody / Úkolovník / Tabule / Připravujeme |
| `navody.html` | Výpis návodů: vlevo dlaždice, vpravo rovnou náhled A4 |
| `navod.html` | Čtečka návodu + export do PDF |
| `editor.html` | Editor návodu, vlevo úpravy (jde přiblížit), vpravo živý náhled |
| `ukoly.html` | Úkolovník po zakázkách, historie zápisů, „úkol je hotov" |
| `tabule.html` | Tabule na nápady – nekonečné plátno, myšlenkové mapy (nejnovější a nejrozsáhlejší část) |
| `barvy.html` | Hřiště na barvy webu |

Vzhled: písmo **Lato** přímo v repozitáři (`assets/fonts/`), hlavní barva
červená `#c8102e`, hranaté tvary, cílová zařízení **iPhone 11 a iPad Air**.

---

## Data ve Firestore

```
artifacts/firemni-kb-app/public/data/
  guides/{id}                    text návodu (+ podkolekce images/{id})
  tasks/{id}                     úkol: zakazka, subtasks[], notes[], log[], done
  meta/zakazky                   { names: [], closed: [] } – číselník zakázek
  boards/{id}                    hlavička tabule (název, kdo a kdy)
  boards/{id}/content/data       prvky tabule (elements[])
  boards/{id}/images/{id}        obrázky na tabuli
  logs/{id}                      záznamy přihlášení
```

Tabule „**Ukázka – myšlenková mapa**" (`board_1785603626022_719`) obsahuje
rozpracovanou mapu od Michala – **netestovat na ní**, založit si vlastní.

---

## Pasti, na které jsme narazili (ať se neopakují)

1. **Firestore neumí pole v poli.** Body kresby na tabuli jsou proto naplocho
   `[x1,y1,x2,y2,…]`. Jakmile se někde objeví `[[x,y],…]`, uložení spadne na
   `Nested arrays are not supported`.
2. **Jediné `NaN` shodí celou tabuli.** Spojnice mapy nemají vlastní rozměry;
   když se dostaly do výpočtu „vejít se do okna", vyšlo NaN, transformace
   plátna se stala neplatnou a přestalo fungovat posouvání, zoom i psaní.
   Teď to hlídá `bounds()` (vrací `null` pro spojnice), `applyView()`
   a `sanitize()` při načtení i uložení.
3. **Chybějící `box-sizing: border-box`** způsoboval, že pole s odsazením
   vylézala z panelu editoru ven a nesedělo zarovnání zprava.
4. **Pořadí CSS pravidel u editoru:** `.editor-panel { width: 100% }` musí
   zůstat *před* media query, jinak přebije šířku panelu a náhled se srazí
   na nulu (přesně tohle způsobilo „nevidím náhled").
5. **Google Fonts servírují Lato rozsekané** na `latin` a `latin-ext`; druhý
   soubor se nenačítal, takže se `č, ř, ž, ě, ů` kreslily systémovým písmem.
   Proto máme vlastní WOFF v repu (převod skriptem `assets/fonts/ttf2woff.js`,
   zdrojové TTF jsou na starém PC v `Desktop/PRACE/CAD/_Standardizace/FONTY`).
6. **`serve` zahazuje parametry** při přesměrování z `/x.html` na `/x`.
7. **Verze assetů:** při každé změně v `assets/…` je potřeba zvýšit `?v=N`
   ve všech HTML (teď `?v=25`), jinak lidé uvidí starou verzi kvůli cache
   GitHub Pages.

---

## Co zbývá – seřazeno podle důležitosti

### 1. Bezpečnost (jediné, co je opravdu vážné)

Databáze je otevřená komukoliv: web se přihlašuje anonymně a Firestore
pravidla to pouští. Kdokoliv, kdo zná adresu, může návody i úkoly **číst,
přepsat a smazat**. Ověřeno prakticky – zápis prošel z čistého anonymního
sezení.

Kroky: (a) omezit Firestore Rules, (b) přihlašování e-mailem a heslem přes
Firebase Auth, vypnout anonymní přihlášení, (c) role správce navázat na účet
místo dnešního přepínače v prohlížeči (ten není zabezpečení).

### 2. Zálohy

Firestore na free tarifu nezálohuje. Chybí tlačítko „Stáhnout zálohu", které
vysype návody, úkoly i tabule do jednoho JSON souboru. Malá práce, velký
užitek.

### 3. Drobnosti k dodělání

- `assets/data/navody-skripty.json` (41 kB textů návodů) je ve veřejném repu –
  data jsou stejně ve Firestore, klidně to smazat.
- Chybí `noindex`, web se může objevit ve vyhledávačích.
- Šedé logo (vodoznak v PDF) má jen 600 px, pro tisk by chtělo ~1200 px.
- Písma váží 1,4 MB; převod do WOFF2 by to srazil na ~400 kB (potřeba
  nástroj z npm).
- Načítání všech návodů najednou je dnes 60 kB, řešit až kolem 100–150 návodů
  (rozdělit na lehkou hlavičku a tělo zvlášť).

### 4. Tabule – co jsme probírali a ještě není

- **sbalování větví** myšlenkové mapy (kolečko `−`, které schová podstrom)
- formátování **jednotlivé buňky** tabulky (teď se styl nastavuje celé tabulce)
- hledání v obsahu tabule
- export tabule do PNG/PDF
- rámečky/sekce na plátně

### 5. Zamítnuté nebo nemožné

- **Poklepání na Apple Pencil** – Safari to webovým stránkám nehlásí, žádné
  API neexistuje. Jde jen v nativních aplikacích.
- **Velká klávesnice na iPadu** – plovoucí klávesnice je nastavení systému;
  zvětší se roztažením dvou prstů na ní, web s tím nic neudělá.
- **Propojení s Caflou** – API mají jen vyšší tarify, statický web na něj
  nemůže sahat přímo (CORS) a klíč by nesměl být ve webu. Reálná cesta je
  serverová funkce, nebo jednorázový import zakázek z CSV.

---

## Jak se pracuje

- Commituje a pushuje se rovnou na `main`, web se sám nasadí na GitHub Pages
  (chvíli trvá, než se projeví).
- Zprávy commitů česky, popisují **proč**, ne jen co.
- Kód je komentovaný česky, styl: žádné frameworky, čisté HTML/CSS/JS.
- Po každé změně asstů zvýšit `?v=N` ve všech HTML naráz:
  `sed -i 's/?v=25/?v=26/g' *.html`
- Ověřovat v prohlížeči (náhled na `localhost:4173`), ne jen „mělo by to jít".
