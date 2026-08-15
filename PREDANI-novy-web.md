# Předání – nová verze webu Pasport Kaňa

Stav k 15. 8. 2026, větev **`novy-web`**, poslední commit `64db734`,
verze souborů `?v=52`.

---

## Kde co je

| | |
|---|---|
| Repozitář | `C:\Users\Michal\Desktop\claude\pasportkana_navody` (větev `novy-web`) |
| Spuštění webu | `Desktop\claude\SPUSTIT-web.bat` → `http://localhost:4173` |
| Ostrý web | `kanapasport.github.io` – jede z větve `main`, novou verzi nevidí |
| Nástroje na výkazy | `Desktop\claude\vykazy_nastroje\` (mimo repozitář) |
| Import projektů | `Desktop\claude\projekty-import.json` (mimo repozitář) |
| Ukázkové výkazy | `Desktop\claude\ukazkove-vykazy.json` (mimo repozitář) |
| Skilly | `.claude/skills/vykazy/`, `.claude/skills/novy-web/` |

---

## ČEKÁ NA MICHALA

1. **Nasadit `firestore.rules` ve Firebase Console.** Od posledního nasazení
   přibyly: historie aktivit, přítomnost, **Quick TO-DO**. Bez toho tyhle
   části zůstanou prázdné (zbytek webu jede).
2. **Nahrát `projekty-import.json`** v Nastavení → Import (276 neuzavřených
   zakázek, firmy, budget, 6 vzorových úkolů).
3. **Nahrát `ukazkove-vykazy.json`** tamtéž (74 výkazů k BioPharmě za
   3.–14. 8. pro 7 lidí, včetně dovolené a jednoho přesčasu).
4. **Zvolit heslo k citlivým sekcím** (Nastavení → sazby si o něj řeknou).
   Není to heslo k trezoru na stránce Uživatelé – ten šifruje hesla lidí.
5. **Ověřit Quick TO-DO panel ve svém prohlížeči** – v náhledovém prohlížeči
   se nedal zkontrolovat okem (viz Pasti).
6. Na starém webu smazat zakázky, které tam natekly (Moravský Beroun,
   Střížovice) – Správa zakázek. Nová verze už do číselníku nepíše.

---

## Co je hotové

**Rozvržení** – svislý červený pás vlevo (logo = domů, hledání, Stats,
Quick TO-DO, Nový výkaz, Moje úkoly, Nový projekt, Nastavení, jméno + role
+ Odhlásit). Horní lišta: VÝKAZY · PROJEKTY · ÚKOLY · KALENDÁŘ · MILNÍKY ·
NÁVODY · TABULE · REPORTY. Obsah červeného pruhu zarovnaný doprava.

**Stránky** (21 celkem, kontrolní skript v scratchpadu `kontrolaStranek.js`):

- `index.html` – nástěnka 2×3: Zadané úkoly (Moje/Všechny), TO-DO,
  Quick TO-DO, Kalendář, Kdo tu byl, Poslední aktivita. Barvy podle
  rozpracovanosti, červené hlavičky dlaždic, volba Přizpůsobit.
- `projekty.html` + `gantt.html` + `sprava.html` – společná podlišta.
  Správa projektů je jedno místo pro rozpočet, firmu, části, **budovy,
  patra a technologie zvlášť pro každý projekt** a sazbu platnou jen tam.
- `ukoly.html` – TO-DO ve staré podobě (barevné řádky, fajfka, „zapsal
  kdo · kdy", táhlo), přepínač **% podrobně**, Rozbalit vše, jména
  přiřazených. Procenta smí zapisovat i student, jen u svých úkolů.
- `vykazy.html` + `vykazy-prehled.html` + `vytizeni.html` – společná
  podlišta. Výkaz → Záznam 1 → Přidat záznam → Přidat další výkaz.
  Dovolená/Nemoc/Školení s předvyplněným „Dovolená – jméno".
- `kalendar.html` – týden jako výchozí, filtry podle druhu i člověka,
  celodenní absence v pruhu nahoře.
- `milniky.html` – Zobrazit: Nadcházející / Minulý měsíc / Všechny splněné.
- `nastaveni.html` + `uzivatele.html` + `barvy.html` – společná podlišta,
  sazby a hesla za zámkem.
- `reporty.html` – jen historie aktivit a přihlášení.

---

## Pasti, na které jsme narazili

1. **Náhledový prohlížeč vrací zastaralé `getBoundingClientRect` a computed
   style po změně třídy.** Stalo se dvakrát (maketa šablon, Quick TO-DO
   panel). Když měření odporuje kódu, ověř screenshotem nebo nastav hodnotu
   inline – nehledej chybu, která tam není.
2. **Odběry se smí rozšířit, ne zúžit.** Pás si žádá „jen moje"; bez téhle
   pojistky by manažerovi zablokoval plný odběr.
3. **Volání `$("btnNeco")` na smazaný prvek shodí celou inicializaci** a
   stránka zůstane prázdná. Stalo se u milníků po přepsání pohledů.
4. **Verze `?v=NN` musí být stejná ve všech HTML.** Rozešly se a část
   stránek si tahala starý vzhled.
5. **Obě verze webu sdílí databázi.** Zápis z nové verze se objeví na
   ostrém webu (stalo se s číselníkem zakázek).
6. **Quick TO-DO leží mimo `private`** – tam mají manažeři plošné čtení,
   kdežto vzkazy má vidět jen autor a adresát.

---

## Co se odložilo

- **Šablony** (projektů / úkolů / vzhledu) – Michal: „až je budu
  potřebovat, ozvu se".
- **Efektivita** – návrh: budget ÷ skutečnost, počítat až po „hotovo",
  hodnotit průměr za měsíc, ne jednotlivý úkol. Ve výkazu už je vazba
  položky na úkol (`ukolId`), ze které se to spočítá.
- **Rozpočty zakázek** – „momentálně nebudeme řešit".
- **Přesun na Firebase Hosting + vlastní doménu** – schváleno, neprovedeno.
