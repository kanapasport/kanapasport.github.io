# Předání práce – Pasport Kaňa

Shrnutí stavu k **6. 8. 2026**, aby se dalo plynule pokračovat na jiném počítači
nebo v novém sezení. Poslední commit: `41fa176`.

- **Živý web:** <https://kanapasport.github.io>
- **Repozitář:** <https://github.com/kanapasport/kanapasport.github.io> (veřejný)
- **Data:** Firebase Firestore, projekt `pasportkana`, kolekce pod
  `artifacts/firemni-kb-app/public/data/…`

Technický popis webu je v [README.md](README.md) – tenhle soubor je navíc:
říká, **co se rozhodlo, o co se to opřelo a co ještě zbývá**.

---

## Kde jsme skončili (6. 8. 2026, odpoledne)

Všechno je **zacommitované a nahrané na GitHub**, v pracovní kopii nic nezůstalo.
Doma stačí `git pull` (nebo čerstvý `git clone`) a jede se dál.

### 1. Nasazení Pages vázne – zkontrolovat jako první

Web pořád servíruje **starou verzi `?v=37`**, i když v repu je už `?v=38`.
Není to chyba v kódu: krok `build` projde za 22 s, padá až `deploy`.
Na GitHubu se zasekla fronta nasazení – pokusy končily buď
`Timeout reached, aborting!` ve stavu `deployment_queued`, nebo
`Deployment cancelled.`

Co už jsem zkusil:

1. zrušil zaseknuté nasazení přes API (`pages/deployments/{sha}/cancel`) – fronta se uvolnila,
2. poslal prázdný commit `4313bb9`, aby se spustil čerstvý build – ten **na rozdíl od
   předchozích nezůstal viset ve frontě a rozjel se**. Jak dopadl, jsem už nestihl ověřit.

Doma:

```bash
gh run list -L 3
curl -s https://kanapasport.github.io/index.html | grep -o "app.css?v=[0-9]*"
```

Až se objeví `app.css?v=38`, je hotovo – lišta bude zarovnaná **zleva** a roletka
milníků ukáže rovnou nejbližší termíny bez zanořené tabulky.

Kdyby to pořád padalo, nejsilnější páka je v repu **Settings → Pages**: přepnout
zdroj na jinou větev, uložit, přepnout zpět na `main`, uložit. Tím se stav
nasazení resetuje úplně.

**Nastavení jsem prošel a nikde není chyba** – Actions zapnuté a plně povolené,
prostředí `github-pages` má povolenou větev `main` bez schvalovatele, zdroj Pages
je `main` / kořen, vlastní doména prázdná, HTTPS vynucené, GitHub Status bez
výpadku. Není tedy co přenastavovat.

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
| `ukoly.html` | Úkolovník po zakázkách a skupinách, sbalené úkoly, historie zápisů |
| `milniky.html` | Milníky – termíny odevzdání po činnostech, rozdělené podle zakázek |
| `tabule.html` | Tabule na nápady – nekonečné plátno, myšlenkové mapy |
| `uzivatele.html` | Lidé, role, trezor na hesla, záloha – **jen hlavní správce** |
| `barvy.html` | Hřiště na barvy webu – **jen hlavní správce**, změna neplatí trvale |

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
  meta/zakazky                   { names: [], closed: [], groups: [] }
  meta/milniky                   { items: [] } – všechny milníky v jednom poli
  meta/vault                     { salt, check } – nastavení trezoru
  boards/{id}                    hlavička tabule (název, kdo a kdy)
  boards/{id}/content/data       prvky tabule (elements[])
  boards/{id}/images/{id}        obrázky na tabuli
  logs/{id}                      záznamy přihlášení
```

Platná pravidla jsou v [firestore.rules](firestore.rules). **Nasazují se ručně**
ve Firebase Console → Firestore Database → Rules; soubor v repu je jen předloha.

Tabule „**Ukázka – myšlenková mapa**" (`board_1785603626022_719`) obsahuje
rozpracovanou mapu od Michala – **netestovat na ní**, založit si vlastní.

---

## Úkolovník a milníky – jak se chovají

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
   (teď `?v=38`), jinak lidé uvidí starou verzi kvůli cache GitHub Pages.
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

---

## Co zbývá

### 1. Zálohy

Tlačítko **Stáhnout zálohu** na `uzivatele.html` vysype návody, úkoly, lidi
i tabule do JSON. **Obnova z něj ale zatím není** – zpátky by se to muselo
nahrát ručně. Stálo by za to doplnit import.

### 2. Drobnosti

- `assets/data/navody-skripty.json` (41 kB textů) je ve veřejném repu; data
  jsou stejně ve Firestore, klidně smazat.
- Chybí `noindex`, web se může objevit ve vyhledávačích.
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
