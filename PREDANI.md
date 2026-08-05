# Předání práce – Pasport Kaňa

Shrnutí stavu k **5. 8. 2026**, aby se dalo plynule pokračovat na jiném počítači
nebo v novém sezení. Poslední commit: `720ad51`.

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

Na push je potřeba přihlášení k GitHubu. Na starém PC je nainstalované
**GitHub CLI** (`gh` 2.97) a přihlášené jako `kocismichal`; na novém buď
`gh auth login`, nebo při prvním `git push` vyskočí Windows Credential Manager.

### Co si vzít s sebou ručně

`Seznam.xlsx` (lidé + hesla) **není v gitu** – je v `.gitignore`, protože
repozitář je veřejný. Na druhý počítač se musí přenést zvlášť, třeba na flashce.
Bez něj se dá web používat, jen nebudeš mít po ruce hesla lidí.

---

## Co je hotové

| Stránka | Stav |
|---|---|
| `index.html` | Rozcestník – červené dlaždice; zakázky řazené BioPharma → podle termínu → uzavřené, uvnitř rozdělené na skupiny |
| `navody.html` | Výpis návodů: vlevo dlaždice, vpravo rovnou náhled A4 |
| `navod.html` | Čtečka návodu + export do PDF (jen správci) |
| `editor.html` | Editor návodu, vlevo úpravy (jde přiblížit), vpravo živý náhled |
| `ukoly.html` | Úkolovník po zakázkách a skupinách, sbalené úkoly, historie zápisů |
| `tabule.html` | Tabule na nápady – nekonečné plátno, myšlenkové mapy |
| `uzivatele.html` | Správa lidí a rolí – **vidí jen hlavní správce** |
| `barvy.html` | Hřiště na barvy webu – **jen hlavní správce**, změna neplatí trvale |

Vzhled: písmo **Lato** přímo v repozitáři (`assets/fonts/`), hlavní barva
červená `#c8102e`, hranaté tvary, cílová zařízení **iPhone 11 a iPad Air**.

### Účty a role (od 5. 8. 2026)

Čtyři role: **hlavní správce · správce · zaměstnanec · student**. Přihlašuje se
e-mailem a heslem, role se bere ze seznamu v databázi (kolekce `users`), takže
její změna se projeví i tomu, kdo je zrovna přihlášený.

Pravomoci jsou na jednom místě v `assets/js/ui.js` (`PERMISSIONS`), stránky se
ptají přes `KBUI.can("ukol.create")`. Tabulka „co která role smí" na
`uzivatele.html` se z toho dopočítá sama – přidat pravomoc znamená doplnit
jeden řádek.

Ve zkratce: student nezakládá úkoly (jen do nich zapisuje), zakázky a skupiny
řeší správci, historii zápisů vidí jen správci, poznámky vidí všichni, návody
tvoří kdokoliv, ale mazat a stahovat do PDF smí jen správce. Uživatele a barvy
webu má na starost pouze hlavní správce.

**Hesla** jsou v databázi jen jako otisk SHA-256 se solí – zpětně se nepřečtou.
Vygenerovaná hesla jsou v `Seznam.xlsx`. Změna hesla se dělá **na
`uzivatele.html`**, ne v Excelu; přepsání buňky v Excelu se na web nijak
nepropíše (Excel a web spolu spojené nejsou).

### Úkolovník – jak se chová

- Úkoly jsou **sbalené**, rozbalí se kliknutím na hlavičku.
- Zakázka se dělí na **skupiny** (`ARCGIS`, `SKENY`, `FOCENÍ`, `TABULKY`);
  seznam je společný pro všechny zakázky a leží v `meta/zakazky` v poli `groups`.
  Úkol bez skupiny spadne do „Nezařazeno" – nikdy se nic neztratí.
- Nad zakázkou jsou **proklikávací odkazy na skupiny**, kliknutím to sjede dolů.
- Rozpracovanost má kroky **0 / 25 / 50 / 75 / 95 / 100 %** a barevnou stupnici:
  šedá → žlutá → oranžová → slabší zelená → zelená. Stejné odstíny na patře,
  na celkových procentech i na proužku (proměnné `--p0-bg` … `--p100-fg`).
- **Historie zápisů** ukazuje posun (`50 % → 75 %`), kdo a kdy, seskupeně po
  dnech. Zápisy téhož člověka k témuž patru do deseti minut se slučují
  (`LOG_WINDOW`), takže naklikání 0 → 100 je jeden řádek, ale posun po dnech
  jsou samostatné záznamy.

---

## Data ve Firestore

```
artifacts/firemni-kb-app/public/data/
  guides/{id}                    text návodu (+ podkolekce images/{id})
  tasks/{id}                     úkol: zakazka, skupina, subtasks[], notes[], log[], done
  users/{id}                     člověk: email, first, last, role, active, salt, hash
  meta/zakazky                   { names: [], closed: [], groups: [] }
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
   Proto máme vlastní WOFF v repu.
6. **`serve` zahazuje parametry** při přesměrování z `/x.html` na `/x`.
7. **Verze assetů:** při každé změně v `assets/…` je potřeba zvýšit `?v=N`
   ve všech HTML (teď `?v=27`), jinak lidé uvidí starou verzi kvůli cache
   GitHub Pages.
8. **`saveTask` zapisuje pole natvrdo, ne přírůstkově.** Formulář úpravy úkolu
   skládal úkol znovu bez `log` a `done`, takže každá úprava smazala historii
   i potvrzení „hotovo". Opraveno – když se přidá další pole, musí se přenést
   taky.
9. **Uložený číselník přebíjí výchozí hodnoty v kódu.** Přidání `TABULKY` do
   `DEFAULT_SKUPINY` se na webu neprojevilo, protože v `meta/zakazky` už byl
   uložený vlastní seznam. Muselo se dopsat i do databáze.
10. **Komentář na stejném řádku v `.gitignore` nefunguje** – `~$*  # komentář`
    se nebere jako vzor. Málem se tím commitnul zámkový soubor Excelu.
11. **`.xlsx` se nedá číst heredocem do Pythonu** v tomhle prostředí; skript se
    musí uložit do souboru a spustit. Python je jen ten z ArcGIS Pro:
    `C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe`.

---

## Co zbývá – seřazeno podle důležitosti

### 1. Bezpečnost (jediné, co je opravdu vážné)

Přihlašování na webu **řídí jen to, co je vidět a co jde odkliknout**. Neřídí
přístup k datům: web se pořád hlásí k Firebase **anonymně** a pravidla
Firestore jsou otevřená, takže kdokoliv, kdo zná adresu, si data přečte
i přepíše mimo web. Ověřeno prakticky – zápis prošel z čistého anonymního
sezení. Přihlašovací okno je zámek na skleněných dveřích.

Hotová předloha pravidel je v [firestore.rules](firestore.rules) i s postupem.
Nasadit je má smysl **až po** přechodu na Firebase Auth, jinak zamknou i vlastní
lidi (všichni dnes jedou pod anonymním účtem). Kroky:

1. Firebase Console → Authentication → povolit **Email/Password**.
2. Založit účty (e-maily ze `Seznam.xlsx`, hesla tamtéž).
3. Ke každému účtu dokument `users/{uid}` s polem `role` (uid je Firebase UID).
4. V `assets/js/store.js` přepnout `signInAnonymously` na
   `signInWithEmailAndPassword` a `UI.login` v `assets/js/ui.js` napojit na
   Firebase Auth místo porovnávání otisků.
5. Teprve pak vložit `firestore.rules`.

### 2. Zálohy

Firestore na free tarifu nezálohuje. Chybí tlačítko „Stáhnout zálohu", které
vysype návody, úkoly, uživatele i tabule do jednoho JSON souboru. Malá práce,
velký užitek.

### 3. Drobnosti k dodělání

- `assets/data/navody-skripty.json` (41 kB textů návodů) je ve veřejném repu –
  data jsou stejně ve Firestore, klidně to smazat.
- Chybí `noindex`, web se může objevit ve vyhledávačích.
- Šedé logo (vodoznak v PDF) má jen 600 px, pro tisk by chtělo ~1200 px.
- Písma váží 1,4 MB; převod do WOFF2 by to srazil na ~400 kB.
- Načítání všech návodů najednou je dnes 60 kB, řešit až kolem 100–150 návodů.
- **Mazání úkolů** je zatím u správců (nevratná akce) – nebylo výslovně zadané,
  případně změnit v `PERMISSIONS`.

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
- Po každé změně assetů zvýšit `?v=N` ve všech HTML naráz:
  `sed -i 's/?v=27/?v=28/g' *.html`
- Ověřovat v prohlížeči, ne jen „mělo by to jít“. Data v databázi jsou ostrá –
  testovat na dočasném záznamu a po sobě uklidit.
- **Nikdy necommitovat `Seznam.xlsx`** ani nic s hesly; repozitář je veřejný.
