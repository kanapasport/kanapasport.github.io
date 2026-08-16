# Předání – nová verze webu Pasport Kaňa

Stav k 16. 8. 2026, větev **`novy-web`**, poslední commit `e34efd8`,
verze souborů `?v=60`.

---

## Rozjetí na druhém počítači

```bash
git clone https://github.com/kanapasport/kanapasport.github.io.git
cd kanapasport.github.io
git checkout novy-web
```

Když už repozitář na tom počítači je, stačí `git checkout novy-web` a `git pull`.
Web se pouští `SPUSTIT-web.bat` (leží o složku výš, `Desktop\claude\`) nebo
ručně `npx serve -l 4173 pasportkana_navody` → `http://localhost:4173`.
Potřeba je jen **Node.js** a **Git**.

**Co v repozitáři NENÍ** (schválně – je veřejný) a co si musíš na druhý
počítač přenést sám, jestli to tam budeš potřebovat:

| Soubor | K čemu |
|---|---|
| `Desktop\claude\projekty-import.json` | import 276 zakázek do databáze |
| `Desktop\claude\ukazkove-vykazy.json` | 74 ukázkových výkazů |
| `Desktop\claude\vykazy_rozrazeno\prehled-BP.json` | data pro stránku Přehled BP |
| `Desktop\claude\vykazy_nastroje\` | nástroje na rozbor výkazů (dataBP.js aj.) |
| `Desktop\claude\vykazy\`, `vykazy_rozrazeno\` | excelové výkazy lidí |

Na prohlížení webu nic z toho nepotřebuješ – data jsou v databázi, stačí
se přihlásit. Přenášej jen když budeš znovu importovat nebo přepočítávat.

---

## Kde co je

| | |
|---|---|
| Repozitář | `C:\Users\Michal\Desktop\claude\pasportkana_navody` (větev `novy-web`) |
| Spuštění webu | `Desktop\claude\SPUSTIT-web.bat` → `http://localhost:4173` |
| Ostrý web | `kanapasport.github.io` – jede z větve `main`, novou verzi nevidí |
| Nastavení místního serveru | `pasportkana_navody\serve.json` (**neměnit** – viz Pasti) |
| Skilly | `.claude/skills/vykazy/`, `.claude/skills/novy-web/` |

---

## ČEKÁ NA MICHALA

1. **Nasadit `firestore.rules` ve Firebase Console.** Od posledního nasazení
   přibyly: historie aktivit, přítomnost, **Quick TO-DO**. Bez toho tyhle
   části zůstanou prázdné (zbytek webu jede).
2. **Nahrát `projekty-import.json`** – nově na vlastní stránce
   **Import dat** (podlišta Nastavení). 276 neuzavřených zakázek, firmy,
   budget, 6 vzorových úkolů.
3. **Nahrát `ukazkove-vykazy.json`** tamtéž (74 výkazů za 3.–14. 8. pro
   7 lidí, včetně dovolené a jednoho přesčasu).
4. **Nahrát nový `prehled-BP.json`** na stránce Přehled BP tlačítkem
   „Nahrát nová data". Bez toho se u lidí nerozbalí rozpad po letech –
   starý uložený přehled ta data ještě nemá.
5. **Zvolit heslo k citlivým sekcím** (Nastavení → sazby si o něj řeknou).
   Není to heslo k trezoru na stránce Uživatelé – ten šifruje hesla lidí.
6. Na starém webu smazat zakázky, které tam natekly (Moravský Beroun,
   Střížovice) – Správa zakázek. Nová verze už do číselníku nepíše.

---

## Co je hotové

**Rozvržení** – svislý červený pás vlevo (logo = domů, hledání, Stats,
Quick TO-DO, Nový výkaz, Moje úkoly, Nový projekt, Nastavení, jméno + role
+ Odhlásit). Horní lišta: VÝKAZY · PROJEKTY · ÚKOLY · KALENDÁŘ · MILNÍKY ·
NÁVODY · TABULE · REPORT.

**Stránky** (23 celkem, kontrolní skript v scratchpadu `kontrolaStranek.js`):

- `index.html` – nástěnka 2×3: Zadané úkoly (Moje/Všechny), TO-DO,
  Quick TO-DO, Kalendář, Kdo tu byl, Poslední aktivita. Kalendářová
  dlaždice ukazuje i milníky. Klik na červenou hlavičku otevře stránku.
- `projekty.html` + `gantt.html` + `sprava.html` – společná podlišta.
  Správa projektů je jedno místo pro rozpočet, firmu, části, **budovy,
  patra a technologie zvlášť pro každý projekt** a sazbu platnou jen tam.
- `ukoly.html` – TO-DO ve staré podobě (barevné řádky, fajfka, „zapsal
  kdo · kdy", táhlo), přepínač **styl %**, Rozbalit vše, jména
  přiřazených. Procenta smí zapisovat i student, jen u svých úkolů.
- `vykazy.html` + `vykazy-prehled.html` + `vytizeni.html` + `vykazy-bp.html`
  – společná podlišta, Přehled BP za svislou čárkou (jen manažeři).
  Výkaz → Záznam 1 → Přidat záznam → Přidat další výkaz.
- `vykazy-bp.html` – přehled odvedené práce z minula: koláče s přepínačem
  **Hodiny / Peníze**, klik na člověka rozbalí jeho **roky** (hodiny, Kč,
  průměrná sazba roku), vlastní heslo navíc.
- `kalendar.html` – týden jako výchozí, filtry podle druhu i člověka,
  celodenní absence v pruhu nahoře.
- `milniky.html` – Zobrazit: Nadcházející / Minulý měsíc / Všechny splněné.
- `tabule.html` – podlišta se seznamem tabulí, kreslení, zvětšení přes
  celou obrazovku rohovým tlačítkem.
- `nastaveni.html` + `uzivatele.html` + `barvy.html` + `import.html` –
  společná podlišta, sazby a hesla za zámkem, import dat samostatně.
- `reporty.html` – Report: historie aktivit a poslední přihlášení
  ve výkazových blocích.

**Quick TO-DO** – rychlý vzkaz komu / do kdy / **k jakému projektu**,
tlačítko „Zadat quick to-do", Splněno jedním klikem, splněné se schovávají.
Vidí ho jen autor a adresát.

---

## Pasti, na které jsme narazili

1. **Místní server zahazoval `?parametry`.** `npx serve` v režimu hezkých
   adres přesměroval `tabule.html?id=X` na `/tabule` a id ztratil – stránka
   se pak přesměrovávala pořád dokola („problikává a načítá se furt").
   Řeší to `serve.json` (`cleanUrls:false` + přepis `/:stranka`) a adresa
   tabule v podobě `#deska=ID`. **Kdyby se to vrátilo, nehledej chybu ve
   stránce – zkontroluj `location.search` naživo v prohlížeči.**
2. **Přihlášení odkrývá všechny `<main>` na stránce naráz.** Prvek, který
   si o svém zobrazení rozhoduje sám, nesmí být `<main>` – jinak vyskočí
   tam, kam nepatří (stalo se u výzvy „zatím tu není žádná tabule").
3. **Náhledový prohlížeč vrací zastaralé `getBoundingClientRect` a computed
   style po změně třídy.** Když měření odporuje kódu, ověř screenshotem
   nebo nastav hodnotu inline – nehledej chybu, která tam není.
4. **Odběry se smí rozšířit, ne zúžit.** Pás si žádá „jen moje"; bez téhle
   pojistky by manažerovi zablokoval plný odběr.
5. **Volání `$("btnNeco")` na smazaný prvek shodí celou inicializaci** a
   stránka zůstane prázdná. Stalo se u milníků po přepsání pohledů.
6. **Verze `?v=NN` musí být stejná ve všech HTML.** Rozešly se a část
   stránek si tahala starý vzhled.
7. **Obě verze webu sdílí databázi.** Zápis z nové verze se objeví na
   ostrém webu (stalo se s číselníkem zakázek).
8. **Quick TO-DO leží mimo `private`** – tam mají manažeři plošné čtení,
   kdežto vzkazy má vidět jen autor a adresát.
9. **`.card` nemá vnitřní odsazení.** Nadpis v kartě bez `padding` nelícuje
   s poli pod sebou – tohle byla ta opakovaná „špatné zarovnání" ve Správě.

---

## Co se odložilo

- **Šablony** (projektů / úkolů / vzhledu) – Michal: „až je budu
  potřebovat, ozvu se".
- **Efektivita** – návrh: budget ÷ skutečnost, počítat až po „hotovo",
  hodnotit průměr za měsíc, ne jednotlivý úkol. Ve výkazu už je vazba
  položky na úkol (`ukolId`), ze které se to spočítá.
- **Rozpočty zakázek** – „momentálně nebudeme řešit".
- **Přesun na Firebase Hosting + vlastní doménu** – schváleno, neprovedeno.
- **Jméno klienta ve zdrojích webu** – repozitář je veřejný, a na pár
  místech (texty, ukázky, klíč `biopharma` v databázi) to jméno pořád je.
  Klíč přejmenovat nejde bez ztráty dat, texty ano.
