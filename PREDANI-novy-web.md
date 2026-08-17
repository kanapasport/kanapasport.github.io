# Předání – nová verze webu Pasport Kaňa

Stav k 17. 8. 2026, větev **`novy-web`**, poslední commit `4d30b5d`,
verze souborů `?v=71`.

---

## Rozjetí na druhém počítači

```bash
git clone https://github.com/kanapasport/kanapasport.github.io.git
cd kanapasport.github.io
git checkout novy-web
```

Když už repozitář na tom počítači je, stačí `git checkout novy-web` a `git pull`.

**Na počítači s Node.js:** `npx serve -l 4173 pasportkana_navody` → `http://localhost:4173`
(nebo `SPUSTIT-web.bat` v `Desktop\claude\`).

**Na počítači bez Node.js** (třeba ten domácí) je připravený
`PREDANI_WEB\SPUSTIT-novy-web.bat` – jede na Pythonu z ArcGIS Pro a otevře
`http://localhost:5174`. Nepoužívá `serve.json`, ale nevadí to: všechny
odkazy na webu jsou s koncovkou `.html`, takže se `?parametry` neztrácejí.

**Co v repozitáři NENÍ** (je veřejný) a co si musíš přenést sám:

| Soubor | K čemu |
|---|---|
| `Desktop\claude\projekty-import.json` | import 276 zakázek do databáze |
| `Desktop\claude\ukazkove-vykazy.json` | 74 ukázkových výkazů |
| `Desktop\claude\vykazy_rozrazeno\prehled-BP.json` | data pro stránku Přehled BP |
| `Desktop\claude\vykazy_nastroje\` | nástroje na rozbor výkazů |
| `Desktop\claude\vykazy\`, `vykazy_rozrazeno\` | excelové výkazy lidí |

---

## ČEKÁ NA MICHALA

1. **Znovu nasadit `firestore.rules`.** Quick TO-DO se přepsal na společné
   vzkazy (`proUids`) – bez nasazení se **společné vzkazy vůbec nenačtou**.
2. Zbytek z minulého předání, pokud ještě nebyl: nahrát `projekty-import.json`
   a `ukazkove-vykazy.json` (stránka **Import dat**), nový `prehled-BP.json`,
   zvolit heslo k citlivým sekcím.
3. Na starém webu smazat zakázky, které tam natekly (Moravský Beroun,
   Střížovice) – nová verze už do číselníku nepíše.

---

## Co se udělalo naposledy (17. 8.)

Všechno je odzkoušené v prohlížeči, nasazené na větev, konzole čistá,
všech 18 stránek vrací 200.

### Kalendář

- V pruhu nahoře jsou **jen celodenní** věci. Půldenní dovolená (7–13) patří
  do mřížky na svoje hodiny – jinak by z ní nešlo poznat, kdy člověk byl
  a kdy nebyl.
- Celý den se ukládá jako **00:00–23:59**, do fondu se ale počítá jedna
  směna (`hodinyPevne`), jinak by týden dovolené udělal 120 hodin.
- Souběžné události si **rozdělí šířku dne na sloupce** (`rozvrhni`).
- V mřížce stojí jen **druh a jméno**; vlastní popis je vidět v detailu.
- Klik = detail, dvojklik = otevře výkaz k opravě.
- Záznam **bez vazby na výkaz** (starší nebo osiřelý) se opraví i smaže
  rovnou v detailu – jinak by tam visel napořád.

### Výkazy

- Stránka je primárně **moje výkazy**, i manažerovi; cizí si nafiltruje.
- Pod souhrnem je **mřížka vytížení** toho, čí výkazy jsou vidět.
- **Peníze jsou schované za „zobrazit"** v rohu dlaždice (odkryje i sloupec
  v tabulce). Pořadí: Odpracováno · Odpracovaných dní · Průměrná sazba ·
  Fakturováno.
- Nabídka časů jen **6:00–18:00**; mimo to se čas napíše ručně.
- Sazba je **jen ke čtení** – platí ta z projektu.
- Stálý projekt **Administrativa**, firma se k němu doplní z `firmaMap`.
- Absence umí **rozsah dnů** (rozpadne se na pracovní dny).
- Student smí zapisovat výkazy.

### Projekty a firmy

- **`projekty.html` je smazaná.** Byla zdvojená se Správou projektů.
  PROJEKTY v liště vedou do `sprava.html`.
- Ve Správě projektů jsou teď i **údaje projektu** (číslo, název, priorita,
  začátek, konec, poznámka, „projekt je hotov"), **manažeři** a **přiřazení
  lidé**. Sazby se nabízejí **jen u přiřazených**.
- **Správa firem** je vlastní stránka v podliště: IČO, DIČ, adresa, kontakt,
  e-mail, telefon, poznámka a seznam projektů firmy. Podrobnosti leží
  v `firmyDetail` vedle prostého seznamu `firmy`, takže roletky po webu
  čtou dál to staré pole.

### Quick TO-DO

- **Jeden vzkaz pro víc lidí** = jeden dokument (`proUids`). V přehledu stojí
  jednou; kdo ho odškrtne, odškrtne ho všem a připíše se, kdo to byl.
- Výběr lidí: **manažeři → zaměstnanci → studenti**, tři jména vedle sebe,
  sebe si zadavatel nezaškrtává.
- **Oblíbené party** lidí (localStorage) – odkaz *uložit jako oblíbené*
  vpravo u nadpisu KOMU.
- **„Udělej co nejdříve"** bez termínu, řadí se první.
- Historie splněných s datem odškrtnutí.

### Nástěnka

- Dlaždice **Milníky** (nejbližší termíny, prošlé červeně nahoře).
- TO-DO má **posuvník** v obou stylech zapisování procent.
- Splněné Quick TO-DO **zezelená** místo přeškrtnutí.

---

## Pasti, na které jsme narazili

1. **Místní server zahazoval `?parametry`.** `npx serve` v režimu hezkých
   adres přesměroval `tabule.html?id=X` na `/tabule`. Řeší to `serve.json`
   (`cleanUrls:false`) a adresa tabule v podobě `#deska=ID`.
2. **Přihlášení odkrývá všechny `<main>` naráz** – prvek, který si o svém
   zobrazení rozhoduje sám, nesmí být `<main>`.
3. **Náhledový prohlížeč vrací zastaralé `getBoundingClientRect`** po změně
   třídy. Když měření odporuje kódu, ověř screenshotem.
4. **Odběry se smí rozšířit, ne zúžit** (`moje` → `vše`).
5. **Volání `$("btnNeco")` na smazaný prvek shodí celou inicializaci** a
   stránka zůstane prázdná. Stalo se po odstranění bloku firem ze Správy.
6. **Verze `?v=NN` musí být stejná ve všech HTML.**
7. **Obě verze webu sdílí databázi.** Zápis z nové verze uvidí ostrý web.
8. **Quick TO-DO leží mimo `private`** – tam mají manažeři plošné čtení,
   kdežto vzkazy má vidět jen autor a adresát.
9. **`.card` nemá vnitřní odsazení.**
10. **Náhled „prohlížím web jako zaměstnanec" mění jen vykreslení.** Data
    chodí podle skutečného účtu, takže hlavnímu správci zůstávaly v paměti
    cizí výkazy a stránka je v náhledu ukazovala. Kde má někdo vidět jen
    svoje, musí se to filtrovat i v kódu.
11. **`.linkbtn` je kreslený pro červený pruh (bílé písmo).** Tmavou podobu
    dostával jen uvnitř `main`; panel Quick TO-DO visí na `body`, takže
    tlačítka byla **bílá na bílém** a nešla najít.
12. **Prohlížeč si obsah `<datalist>` zamkne při `mousedown`**, ne při
    `focusin`. Pole se proto musí vyprázdnit už při stisku, jinak se nabídka
    napoprvé ukáže zúžená na už vybranou hodnotu.
13. **Oddělovač ` · ` patří jen MEZI kusy.** Když první kus vypadne, řádek
    začne osamocenou tečkou.
14. **Kalendářová událost musí jít dohledat i bez `vykazId`.** Události
    zapsané dřív ho nemají – bez záložního hledání (zdroj z výkazu, týž
    člověk, původní den) se při úpravě zakládala druhá a stará zůstala viset.
15. **Zaškrtávátko čtené přes špatný selektor tiše vrací `false`.**
    „Celý den" se hledal přes `data-zapni` (příplatky), ale je to `data-f`.

---

## Co se odložilo

- **Šablony** (projektů / úkolů / vzhledu) – „až je budu potřebovat, ozvu se".
- **Efektivita** – budget ÷ skutečnost, počítat až po „hotovo". Ve výkazu už
  je vazba položky na úkol (`ukolId`), ze které se to spočítá.
- **Rozpočty zakázek** – „momentálně nebudeme řešit".
- **Přesun na Firebase Hosting + vlastní doménu** – schváleno, neprovedeno.
- **Jméno klienta ve zdrojích webu** – repozitář je veřejný a na pár místech
  to jméno pořád je (texty, klíč `biopharma` v databázi). Klíč přejmenovat
  nejde bez ztráty dat, texty ano.
- **Sloučení `novy-web` do `main`** – ostrý web pořád jede starou verzi.
  Až se bude slučovat, počítej s tím, že se lidem změní celý web naráz.
