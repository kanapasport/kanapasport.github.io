# Předání – nová verze webu Pasport Kaňa

Stav k 17. 8. 2026, větev **`novy-web`**, poslední commit viz git log,
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

**Na jakémkoliv počítači** (i bez Pythonu a Node.js) je přímo v repozitáři
**`SPUSTIT-PREZENTACE.bat`** – najde si sám, čím web pustit (Python z ArcGIS
Pro → Python z PATH → Node.js → vlastní `server.ps1` v PowerShellu, který
nepotřebuje nainstalovat nic) a otevře `http://localhost:5174`.
Postup přenosu na cizí notebook je v **`PREZENTACE-jak-spustit.md`**.

Pozor: `%~dp0` končí zpětným lomítkem a v uvozovkách `"...\"` rozbije
příkazovou řádku – dávkový soubor ho proto usekává.

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

1. **Znovu nasadit `firestore.rules`.** (Nově i kvůli **Správě aut** –
   bez nasazení si zápis o autech nikdo neuloží.) Quick TO-DO se přepsal na společné
   vzkazy (`proUids`), přibyla pravidla pro tabule a **úkoly teď čte každý
   člen** (budget v nich už neleží) – bez nasazení se společné vzkazy ani
   tabule nenačtou a úkoly zůstanou po staru.
1b. **BioPharma:** ve Správě projektů vyplnit Rozpočet (hodin) = 28500
   a v bloku Budovy, patra a technologie kliknout **Předvyplnit podle
   budgetu BioPharm** (doplní G61/G62, 10 pater a 14 technologií) → Uložit.
   Matice plnění, krajíc i „kdo dělá kterou technologii" se kreslí z
   těchhle polí – dokud jsou prázdná, sekce ukazují jen nápovědu.
2. **Přesunout tabule** (Import dat → Přesun tabulí). Pořadí: nejdřív
   nasadit pravidla, pak *Zkopírovat tabule na nové místo*, pak si na
   stránce Tabule ověřit, že jsou i s obsahem, a teprve nakonec
   *Uklidit staré umístění*. Do té doby lidé kromě manažerů žádné
   tabule neuvidí – nová verze se ptá už jen na nové místo.
3. Zbytek z minulého předání, pokud ještě nebyl: nahrát `projekty-import.json`
   a `ukazkove-vykazy.json` (stránka **Import dat**), nový `prehled-BP.json`,
   zvolit heslo k citlivým sekcím.
4. Na starém webu smazat zakázky, které tam natekly (Moravský Beroun,
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
- **„Co je nového"** – okno po přihlášení s úkoly a vzkazy od minulé
  návštěvy (laťka v localStorage na člověka; první návštěva nic nevypíše).
  Nový quick to-do při otevřené stránce **pípne** a vyskočí toast.
- **„Upozornění pro kontrolu"** (jen manažeři): přes 14 h za den, zápisy
  přes sebe, práce v den celodenní absence. Prázdná = vše v pořádku.

### Tabule

- **Mazání, přejmenování a viditelnost** jsou v podliště u otevřené tabule.
  Mazání chce opsat název – jde i s obsahem a obrázky, zpátky to nevrátí.
- **„Kdo ji vidí"**: buď všichni, nebo vybraní lidé. Zamčená tabule má
  v liště visací zámek; zakladatel a manažeři ji vidí vždycky.
  **Platí to i v databázi**: tabule se přestěhovaly z `public/data` do
  `private/tabule/seznam`, kde o čtení rozhoduje sama hlavička tabule.
  Seznam se proto skládá ze **tří dotazů** (pro všechny / moje / sdílené
  se mnou) a manažerovi se přidá čtvrtý na celou kolekci – pravidla umí
  dotaz povolit nebo zakázat, ne ho profiltrovat.
- Obrázek se před uložením zmenší (1200 px), a kdyby se do dokumentu
  nevešel, zkusí se ještě dvakrát nahrubo (1000/800 px).

### Budget úkolů a plnění (Správa projektů)

- **Budget a rezerva úkolu (hodiny) leží v `private/ukoly/budgety/{id}`** –
  vedlejší dokument se stejným id jako úkol, čtou ho JEN manažeři (spodní
  pravidlo pro `private`). V dokumentu úkolu být nesmí: úkol čte každý člen
  a pravidla neumí schovat pole. Stejný trik jako výkazy (zaznamy × castky).
- **Krajíc projektu:** Rozpočet (hodin) → Přiděleno úkolům → Rezervy →
  Zbývá rozdělit. Strop je pole Rozpočet (hodin); u projektu jde nastavit
  i **Rezerva peněz (Kč)** (`rozpocty[projekt].rezervaKc`).
- **Matice technologie × patro po budovách:** % vážené budgetem úkolů;
  prázdná buňka = tlačítko + → dialog nového úkolu s předvyplněným názvem
  `G62 – TER – 1PP` (dá se upřesnit), budgetem, rezervou a lidmi.
- **Tabulka úkolů projektu:** hotovo %, odpracováno (z výkazů přes
  `ukolId`), budget a rezerva – ukládá se tlačítkem u řádku, ne velkým
  tlačítkem dole.
- **Kdo dělá kterou technologii** (`projekt.lideTech`: uid → zkratky) –
  na průměrné sazby technologií; není tajné, sazby zůstávají v tajném
  číselníku. Sekce se ukáže, až má projekt vyplněné technologie a lidi.
- **Matice je jedna tabulka jako v excelovém budgetu**: technologie
  v řádku, budovy × patra v malých buňkách (dvouřádková hlavička).
  Kreslí ji `V.maticePlneni` ve vykazy.js – sdílí ji Správa (klikací,
  zakládá úkoly) a stránka **Plnění projektů** (jen na čtení).
- **Správa projektů má nahoře pruh projektů** (přes celou šířku, malé
  dlaždice) a pod ním detail na celou stránku se **záložkami Údaje /
  Spolupracovníci / Plnění projektu** (volba v `kb-sprava-zalozka`).
- **Plnění projektu = dvě dlaždice**: „Plnění po budovách a patrech"
  (krajíc + přehled celých pater + matice technologie × patro)
  a „Úkoly projektu" s filtrem (budova, patro, technologie, stav, text).
- **Přehled pater**: řádek = patro, sloupce Úkolů · Hotovo · Předepsáno ·
  Vykázáno · Zbývá · Vyfakturováno. Klik otevře detail patra s rozpadem
  po technologiích a seznamem úkolů. Peníze jsou z `castka` výkazů.
- **Samostatná stránka `plneni.html` je smazaná** – přesunula se sem.
- **Oblíbené projekty**: hvězdička v seznamu Správy je drží nahoře
  (localStorage `kb-sprava-oblibene`, sdílí ho i Plnění). Poprvé se
  předvyplní BioPharma, C03 a A08 podle čísla/názvu.
- **Sazby na projektu jsou sbalené a až dole** – rozbalí se kliknutím
  na pruh; budgety jsou nadřazené, sazby se řeší jednou za čas.
- **Seznam projektů ukazuje jen oblíbené** + tlačítko Zobrazit všechny;
  hledání prohledává vždycky všechno. Oblíbené jsou první i v roletce
  PROJEKTY v liště, v nabídce projektů výkazu a na Plnění projektů
  (tam s přepínačem Zobrazit i ostatní).
- **Matice má vpravo blok Hodiny technologie**: Budget (editovatelný ve
  Správě, `rozpocty[projekt].techBudgety`, ukládá velké tlačítko) ·
  Ukrojeno (Σ budgetů úkolů té technologie) · Zbývá. Předvyplnit BioPharm
  doplní i hodiny z listu zprac__technologie (STAVBA 2200, SLN/VZT/…
  1935, SLB/MAR 800, HAS 600, HRM 40, ZAR 30).
- **Tabulka úkolů projektu nemá sloupec Kde** (je v názvu úkolu) a lidé
  v „Kdo dělá kterou technologii" jsou po rolích (studenti dole).
- **Každá sekce Správy se sbalí kliknutím na modrý pruh** (volba se
  pamatuje, `kb-sprava-sekce`); nahoře Zobrazit vše / Skrýt vše.
- **Buňka matice s úkoly otevře výběr** (upravit/smazat stávající, nebo
  založit další); rovnou do zakládání jde jen prázdná buňka. Dialog
  úkolu umí i úpravu – při ní se musí znovu poslat todo a stav, jinak
  by je saveUkol smazal. V tabulce úkolů je Uložit · Upravit · Smazat.
- **Matice má přepínač % TO-DO / Zbývá hodin** (budget úkolů buňky minus
  odpracováno; červeně přečerpané). Volba v `kb-sprava-mxrezim`.
- **BioPharma má vestavěné výchozí hodiny technologií**
  (`V.BIOPHARM_TECH_HODINY` ve vykazy.js, z listu zprac__technologie) –
  platí, dokud si projekt neuloží vlastní; tlačítko Předvyplnit je pryč.
- **Smazané jednorázové nástroje:** Převzít starý postup práce (úkoly).
  Zbývají: Import projektů + ukázkové výkazy (Import dat) a Přesun tabulí
  – smazat po dokončení přesunu.
- **Výkaz má Budovu a Patro** (roletky z nastavení projektu; projekty bez
  budov je nemají) – ať se dá sečíst, kolik hodin stálo patro.
- **Výkaz nabízí jen moje úkoly.** Výpomoc na cizím: stránka Úkoly & TO-DO
  (přepínač Všechny je teď pro každého) → tlačítko Zapsat výkaz → cizí
  úkol se do roletky vloží s poznámkou „(výpomoc)".

### Přehled BP – kde se pracovalo

- Nová sekce **patra × druh a technologie × druh** ze sekce `podleMista`
  v prehled-BP.json. Vyrábí ji `PREDANI_WEB/vykazy_rozrazeno/analyza-mista.py`
  (čte ROZŘAZENÉ sešity, z textů úseků tahá patra/technologie/budovy
  a hodiny dělí rovným dílem). Po spuštění nahrát nový JSON na stránce
  Přehled BP.
- **Pokrytí je přiznané v hlavičce**: patro je zmíněno u 19 % hodin,
  technologie u 29 %; focení se psalo většinou bez místa. Každá tabulka
  má řádek „— bez údaje v textu" a „Celkem druhu", ať je porovnání vidět.
- **Sloupce ZAKÁZKA n leží v každém sešitě jinde** (David 17/21/25,
  Kuba 23…51) – extraktor je hledá v hlavičce, pevné indexy by půlku
  hodin minuly.

### Správa aut

- Tlačítko **Správa aut** ve svislém pásu, panel vyjíždí jako Quick TO-DO
  (sdílí třídy `.quickpanel*`; `prepniPanel(id, otevrit)` je obecná
  a otevřený panel ten druhý zavře).
- **Auto Brno**: nejbližších 10 pracovních dnů, pod každým se člověk
  přidá tlačítkem **+** a zase odhlásí. Víkendy se přeskakují.
- **Rezervace**: TOYOTA, ROOMSTER, YETI. Klik na vůz rozevře formulář
  od–do a *kam jedeš*; pod ním visí nadcházející rezervace ve tvaru
  „datum · jméno – kam". Zrušit smí autor a manažer.
- Data: `public/data/auta/{id}`, jedna kolekce, dva druhy podle pole
  `druh` (`brno` / `rezervace`). Schválně veřejné pro celou firmu –
  jinak by se dva domlouvali na tomtéž autě přes hlavu toho druhého.
  Seznam vozů je konstanta `AUTA` v ui.js.

### Provoz

- **Záloha a obnova** na Importu dat: projekty, úkoly, výkazy, kalendář
  a číselníky do JSON a zpátky. Obnova přepisuje dokumenty ze souboru;
  co v souboru není, zůstane. Návody a tabule kryje starý export
  na stránce Uživatelé.
- **Historie aktivit** kryje i mazání výkazů, změny sazeb/rozpočtů
  a kalendář.
- **„Zapsat výkaz z úkolu"** u rozdělaného úkolu – předvyplní projekt,
  úkol, druh i název (`vykazy.html?ukol=ID`).
- **Enter přepíná zaškrtávátka** (dřív jen mezerník).
- **Výchozí barva je petrolejová `#1d556d`** (app.css); červená `#c8102e`
  je předvolba „Pasport červená" na Barvách webu. „Používat tuhle barvu"
  volbu drží v prohlížeči (localStorage `kb-akcent`, aplikuje ui.js hned
  při načtení); vlastní namíchané barvy se ukládají pod jménem.
- **Zámek citlivých sekcí platí 3 minuty od poslední práce** (sazby, hesla,
  Přehled BP), pak se chce heslo znovu. Helpery `KBUI.zamekPamet /
  zamekZapamatuj / zamekObnovujPri` v ui.js.
- **„Zapsat výkaz" je v hlavičce úkolu**, ne až v rozbaleném těle.
- **Ve Správě projektů jsou pod hledáním přepínače Otevřené / Hotové**
  s počty. Svítí vždycky jeden a seznam ukazuje jen jeho – volba zůstává
  v prohlížeči.
- **Kalendář má pole s datem** vedle šipek: skočí na den, jeho týden nebo
  měsíc podle zapnutého pohledu a drží krok se šipkami i s „Dnes".
- **Upozornění pro kontrolu se odškrtávají fajfkou** („je to v pořádku").
  Odbavené se schovají pod odkaz *Zobrazit označené jako v pořádku* a jdou
  vrátit zpět. Seznam klíčů leží v `private/kontrola/seznam/vyrizeno`,
  kam vidí jen manažeři – kontroluje to víc lidí a nikdo nemá procházet
  znovu to, co druhý odklepl.
- **Ve svislém pásu je bez hledání jen jedna čára.** Prázdné místo po poli
  i druhou čáru zhasíná třída `siderail--bezhledani` (nasazuje ji
  `placeSearch`).
- **Hledání v liště je jen na stránkách, kde něco dělá** – seznam
  `STRANKY_S_HLEDANIM` v ui.js. Na návodech našeptává nálezy a klik
  otevře návod; na výkazech filtruje tabulku.
- **Dlaždice kalendáře sází do sloupců** od pátého řádku (nejvýš tři),
  a jen když jsou názvy krátké.

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
16. **Výkaz si příznak „celý den" nenese** – pozná se z časů 00:00–23:59.
    Okno úpravy si ho musí odvodit, jinak počítá 24 h a hlásí překlep.
17. **Dotaz projde jen tehdy, když má člověk právo na KAŽDÝ vrácený
    dokument.** Pravidla nejsou filtr. Proto se tabule i Quick TO-DO
    čtou několika úzkými dotazy a slévají se v paměti podle id.
18. **Co nemá pole, to dotaz na rovnost nenajde.** Tabule bez
    `viditelnost` by v seznamu nebyla vůbec – proto ho zapisuje i
    zakládání nové tabule, i přesun starých.
19. **Chybějící pole v pravidlech není prázdná hodnota, ale chyba** –
    a chyba znamená zamítnuto. Každé pole se nejdřív ověří přes `in`.
20. **`merge: true` slučuje po polích, ne po tom, co je v nich zajímavé.**
    Kdo do zápisu přidá náhradní hodnotu („Bez názvu"), přepíše tím tu
    uloženou. `KB.saveBoardMeta` proto zapisuje jen to, co dostal –
    dřív se uložením viditelnosti tabule přejmenovala a přepsala si
    i zakladatele.
21. **`position: relative` nechává platit `top`/`right` z původního
    pravidla.** Hledání v pásu se tím odsunulo o 20 px doleva a o půl
    výšky dolů. Přepsání na `static` to řeší, ale pak se pod pole nedá
    pověsit nabídka – správně je `position: relative; inset: auto`.
22. **Zvuk jde přehrát až po gestu uživatele** – prohlížeč blokuje audio
    do prvního kliknutí. Pípnutí na nový vzkaz je proto v `try` a po
    přihlášení (což gesto je) už funguje.

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
