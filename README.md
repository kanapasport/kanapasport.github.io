# Pasport Kaňa – firemní knowledge base

Statický web na GitHub Pages: <https://kanapasport.github.io/>
Data (návody, obrázky, úkoly) žijí ve Firebase Firestore, projekt `pasportkana`.
Bez buildu – všechno je čisté HTML, CSS a JavaScript, otevře se i dvojklikem.

## Stránky

| Soubor | K čemu je |
|---|---|
| `index.html` | Rozcestník – logo, hledání v celé databázi, dlaždice sekcí |
| `navody.html` | Výpis návodů – vlevo dlaždice, vpravo rovnou náhled (`?kat=…&sub=…&id=…`) |
| `navod.html` | Čtení jednoho návodu (`?id=…`) – sazba A4 + export do PDF |
| `editor.html` | Tvorba a úprava návodu (`?id=…`) – vlevo editor (jde přiblížit), vpravo živý náhled |
| `ukoly.html` | Úkolovník – úkoly seskupené podle zakázek, patra, procenta, poznámky |
| `tabule.html` | Tabule na nápady – nekonečné plátno (`?id=…`), seznam tabulí bez parametru |
| `milniky.html` | Milníky – termíny odevzdání po činnostech, řazené podle data |
| `barvy.html` | Zkoušení odstínů hlavní barvy na živé ukázce (odkaz je v patičce) |
| `vykazy.html` | Výkazy práce – zápis dne po položkách a výpis zápisů (**jen správci**) |
| `vykazy-prehled.html` | Kolik kdo odpracoval a na čem, peníze po částech zpracování (**jen správci**) |

## Sdílené soubory

| Soubor | K čemu je |
|---|---|
| `assets/js/taxonomy.js` | **Struktura webu** – sekce, kategorie, horní navigace, ikony |
| `assets/js/store.js` | Firebase: návody, obrázky, úkoly |
| `assets/js/doc.js` | Sazba A4, stránkování, export PDF, lupa na obrázky |
| `assets/js/ui.js` | Horní lišta, toasty, role, hledání, komprese obrázků, pokyn pro AI |
| `assets/js/vykazy.js` | Výkazy: filtr, součty, pruhy grafu, formát čísel a CSV (sdílí obě stránky výkazů) |
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

### Písmo je v repozitáři, ne z Google Fonts

V `assets/fonts/` leží **Lato 2.015** z originální rodiny (latofonts.com,
licence SIL OFL) převedené z TTF do WOFF:

| Soubor | Váha v CSS | K čemu |
|---|---|---|
| `lato-regular.woff` | 100–500 | odstavce, popisy, **celý tištěný dokument** |
| `lato-semibold.woff` | 600–800 | lišta, tlačítka, štítky, zvýraznění |
| `lato-black.woff` | 900 | nadpisy |
| `lato-italic.woff` | kurzíva | podtitul návodu, popisky obrázků |

Chceš text v rozhraní tučnější? Stačí u prvku napsat `font-weight: 700`
(Semibold), nebo `900` (Black) – žádné dopočítávání, každá úroveň je
samostatný řez.

**Proč ne Google Fonts:** servírují Lato rozsekané na `latin` a `latin-ext`
a ten druhý soubor se nenačítal – `č, ř, ž, ě, ů` se pak kreslily systémovým
písmem a v nadpisech vyčnívaly. Vlastní soubory mají celou diakritiku
v jednom kuse a web navíc nečeká na cizí server.

Převod TTF → WOFF je bezztrátový (stejné tabulky, jen zabalené zlibem);
skript na to je v historii commitů, kdyby bylo potřeba přidat další řez.
Chceš jinou váhu (např. Regular na text v dokumentu)? Přidej soubor do
`assets/fonts/` a `@font-face` na začátku `app.css`.

### Zkoušení jiné červené

Na `barvy.html` se dá barva namíchat posuvníky nebo vybrat z hotových odstínů;
mění se rovnou celá stránka včetně lišty. **Míchání ale platí jen na téhle
stránce a jen do jejího zavření** – firemní červená je daná a nikdo si ji
nemůže přepsat natrvalo ani sobě.

Trvale se barva mění jediným způsobem: přepsat `--accent` v `:root`
v `app.css` a nasadit. Ostatní odstíny (`--accent-dark`, `--accent-lt`,
`--accent-tint`) se z ní dopočítávají v `UI.accentVars()`, takže je stačí
zkopírovat tlačítkem **Zkopírovat CSS**.

Stránka hlídá i **kontrast bílého textu** – pod 4,5:1 už je barva na bílé
písmo moc světlá.

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

### Telefon a tablet

Cílová zařízení jsou **iPhone 11 (414 px)** a **iPad Air (820 px na výšku,
1180 px na šířku)** – iPad na šířku má proto ještě plný desktopový vzhled.

Pod 1120 px (nebo na dotykovém displeji):

- navigace **DOMŮ / NÁVODY / ÚKOLOVNÍK je vidět vždycky**, nikdy se neschovává
  pod tlačítko; ustupuje jí hledání, ze kterého zbyde jen lupa a pole vyjede
  přes celou lištu až po ťuknutí,
- v červeném pruhu jde všechno pod sebe, ale drží se u pravého okraje
  (přihlášení, barvy webu i ikony nástrojů), logo zůstává uprostřed,
- roletka NÁVODŮ ukáže jen hlavní sekce a obsah se rozbalí až ťuknutím
  na řádek (`isCompact()` v `ui.js` řídí i CSS pravidla).

Vpravo dole se po odrolování objeví tlačítko **zpátky nahoru**.

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

artifacts/firemni-kb-app/private/vykazy/zaznamy/{id}               ← odpracovaný čas
artifacts/firemni-kb-app/private/vykazy/castky/{id}                ← sazba a částka
artifacts/firemni-kb-app/private/vykazy/ciselniky/nastaveni        ← sazby lidí, rozpočty
```

Větev `private` je oddělená schválně – viz [Výkazy práce](#výkazy-práce).

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

Zakázky mají vlastní číselník ve Firestore
(`artifacts/{APP_ID}/public/data/meta/zakazky`, pole `names`) – u úkolu se
vybírají ze seznamu, takže překlepem nevznikne nová. **+ Nová zakázka**
zakládá jen názvy (klidně víc najednou, jeden na řádek), **+ Nový úkol do …**
zakládá úkol do vybrané zakázky. Zakázka bez úkolů se v seznamu ukáže taky,
aby do ní šlo rovnou přidat první úkol.

### Skupiny uvnitř zakázky

Každá zakázka je rozdělená na **skupiny** – výchozí jsou `ARCGIS`, `SKENY`
a `FOCENÍ`, další se přidávají ve **Správě zakázek** nebo tlačítkem **+ Nová**
přímo u formuláře úkolu. Seznam je společný pro všechny zakázky a leží
v tomtéž dokumentu (`meta/zakazky`, pole `groups`).

Úkol si skupinu nese v poli `skupina`. Úkoly bez ní spadnou do **Nezařazeno**
– nic se nikdy neztratí, ani když se skupina z číselníku odebere. Rozdělení
do skupin je vidět i v dlaždici zakázky na rozcestníku.

### Odpovědní lidé a „Moje úkoly"

U úkolu se odpovědní **vybírají ze seznamu lidí** (pole `owners` – UID),
a může jich být víc najednou. Starší úkoly měly jen volný text v `owner`;
ten se pořád zobrazuje, dokud se úkol nepřepíše, a při otevření úpravy se
podle něj lidé **předzaškrtnou**. Podle příjmení se tipuje jen tehdy, když je
ve firmě jediné – u dvou Pelikánů musí sedět i křestní jméno, jinak by se
zaškrtli oba.

V liště je přepínač **Moje úkoly**. Komu není správce a má přiřazený aspoň
jeden úkol, zapne se mu sám, aby se v cizích zakázkách neztratil; jakmile
s ním jednou pohne, respektuje se jeho volba.

### Sbalování a historie

Úkoly jsou v seznamu **sbalené**; kliknutím na hlavičku vyjedou patra,
poznámky i historie. Stav rozbalení se drží jen v paměti stránky.

**Historie zápisů** (vidí ji správce) ukazuje posun procent, ne jen výslednou
hodnotu: `50 % → 75 %`, kdo a v kolik. Záznamy jsou seskupené po dnech
a řadí se podle času. Doklikání 0 → 100 během chvilky je jeden řádek
„0 → 100"; když se ale stejné patro posouvá s odstupem (pondělí 0 → 50,
středa 50 → 75, za týden 75 → 100), jsou to tři samostatné záznamy.
Slučují se jen zápisy téhož člověka k témuž patru **do deseti minut**
(`LOG_WINDOW` v `ukoly.html`).

## Milníky

`milniky.html` – tabulka termínů odevzdání po činnostech (STAVBA, CHLAD, VZT…).
Sloupce: **činnost · zpracovatel · náplň milníku · datum dodání**.

Řadí se **podle data, nejbližší nahoře**; milníky bez data jdou na konec jako
„bez termínu". Řádek se barví podle toho, jak je termín blízko – po termínu
červeně, dnes a do týdne oranžově.

Zapisovat je **můžou jen správci**; ostatní je vidí, ale needitují. Není to jen
skryté tlačítko: milníky leží v dokumentu `meta/milniky` a do `meta` smí podle
pravidel Firestore zapisovat jedině správce, takže zápis odmítne i databáze.
Díky tomu k nim nebylo potřeba přidávat žádné nové pravidlo.

Milníky jsou v tabulce **rozdělené podle zakázek**; nad tabulkou je filtr
(objeví se, jakmile jsou zakázky aspoň dvě) a tlačítko **Skrýt splněné**.
Zpracovatelé se vybírají ze seznamu lidí stejně jako u úkolů.

Správce má u každého řádku **Splněno** a **Upravit**. Splněný milník
zezelená, připíše se ke komu a kdy, a dá se **Vrátit**. Úprava milníku
značku „splněno" neshodí.

V liště jsou MILNÍKY odsazené doprava vedle hledání (`side: true`
v `KB_NAV`); po najetí vyjede roletka se **třemi nejbližšími termíny**
(činnost, náplň, datum) a pod nimi rozdělení podle zakázek. Do nejbližších
se počítají jen milníky s datem, které ještě nejsou splněné.

## Tabule na nápady

Nekonečné plátno pro myšlenkové mapy, poznámky a náčrtky – něco mezi
OneNote a Miro. Tabulí může být kolik chceš, každý si může založit svou
a všichni mohou psát do jedné (změny se propisují živě).

**Ovládání je převzaté z Mira:**

| | |
|---|---|
| levé tlačítko | výběr – tažením přes plochu rámečkem, tažením za prvek se posouvá (i více najednou, Shift přidává) |
| prostřední tlačítko / mezerník | posun plátna |
| kolečko | přiblížení k místu pod kurzorem |
| dva prsty | posun a přiblížení na dotyku |
| Ctrl+Z / Ctrl+Shift+Z | zpět a znovu, Ctrl+A vybere vše, Ctrl+D duplikuje |

Rastr teček se posouvá a zvětšuje spolu s plátnem – podle něj se pozná,
jestli se hýbe pohled, nebo jen prvek.

**Nástroje:** myšlenková mapa, lepítko, text, tabulka, kreslení, guma,
obdélník, elipsa, šipka, obrázek. Jedenáct barev zvlášť pro výplň a pro
okraj, čtyři tvary buňky, tři tloušťky čáry.

**Myšlenková mapa:** do uzlu se píše hned po umístění, text se zalomí na víc
řádků a pole se mu přizpůsobí. **Enter** uzavře psaní a přidá další uzel na
stejnou úroveň. Vybraný uzel má na stranách tečky – **kliknutím** vznikne
navázané pole tím směrem, **tažením** ho umístíš kam chceš, a když ho pustíš
nad existujícím polem, jen se k němu připojí.

Potomci se rovnoměrně rozprostřou na tu stranu, na které vznikli, a jsou
vystředění na rodiče – s přibývajícími uzly se větev roztahuje nahoru i dolů,
ne jen pod sebe. Strana je uložená u spojnice; **kliknutím na čáru** se
ukážou čtyři tečky, kterými se přehodí, ze které strany vychází.

**Přepojování:** uzel se dá přetáhnout — když ho pustíš **nad jiným polem**
(to se zeleně orámuje), přiváže se k němu; když ho pustíš jinam, jen se
přepočítá, na které straně svého rodiče leží, takže se dá větev přehodit
třeba zespodu doprava. Větev se veze i se všemi svými potomky.

**Tabulka:** tažením určíš počet řádků a sloupců, pak `+` na kterékoliv ze
čtyř stran přidá řádek nebo sloupec právě tam (obsah se posune, ne přepíše).
Do buněk se píše po dvojkliku, první řádek se sází jako hlavička.

**Lepítko vs. text:** lepítko je ohraničené pole pevné velikosti (drží se
tam, kde ho necháš, hodí se na nápady a komentáře), text je volný popisek
bez rámečku, který se sám roztahuje podle množství písmen.

**Guma** funguje jako na papíře – v kresbě ubere jen to, přes co přejede,
a tah se v tom místě rozdělí na dva. Lepítka a tvary maže celé.

**Vlastnosti vybraného prvku** (barvy, tvar, písmo, zarovnání) jsou ve druhé
liště pod nástroji. Když není nic vybráno, nastavuje se tím vzhled nově
vytvářených prvků.

**Šipky** se koncem přichytí k prvku, nad kterým je pustíš, a pak už ho
následují. Prostředním úchytem se z rovné šipky udělá křivka.

**iPad:** jako ve Freeform – **Apple Pencil kreslí i bez přepínání nástroje**,
prst posouvá plátno a vybírá, dva prsty přibližují. Ťuknutí do buňky otevře
klávesnici.

Data: hlavička tabule je `boards/{id}` (název, kdo a kdy), prvky
`boards/{id}/content/data`, obrázky `boards/{id}/images/{imgId}`.
Ukládá se se zpožděním po poslední změně; cizí změny přitečou přes
onSnapshot a nepřepíšou rozepsaný text ani rozdělané tažení.

**Pozor:** Firestore neumí uložit pole v poli, proto jsou body kresby
naplocho `[x1,y1,x2,y2,…]`.

## Výkazy práce

Náhrada excelových výkazů. Cíl není „mít to na webu", ale vědět, **co která
zakázka stojí** – proto se u každého zápisu drží zakázka, komu se fakturuje,
část zpracování a technologie.

`vykazy.html` má dvě stránky, přepínají se ve druhém řádku lišty:

| | |
|---|---|
| **Zápis a záznamy** | formulář dne + výpis zápisů s filtry a exportem do CSV |
| **Přehled lidí a peněz** | součty a pruhy podle částí, technologií, zakázek, firem a lidí |

### Den se zapisuje po položkách

Nahoře **datum a člověk**, pod tím položky. Ráno focení a odpoledne ArcGIS jsou
dva zápisy, ne jeden den – jinak by se nedalo říct, kolik stálo focení.
Tlačítko **+ Další položka dne** přidá další blok a rovnou v něm:

- předvyplní zakázku, firmu, část, technologii a sazbu z předchozí položky,
- začne časem, kterým ta předchozí skončila (16:00 → 16:00).

U položky se počítá **hodiny × sazba** živě, ještě před uložením. Pauza se
zadává v minutách, ťuknutím na 0 / 30 / 45 / 60 nebo ručně. Konec dřív než
začátek se bere jako práce přes půlnoc; nad 16 hodin se ukáže upozornění,
že to bude nejspíš překlep.

### Hodiny a částka se ukládají spočítané

`hodiny` i `castka` leží v databázi vedle časů a sazby. Je to úmyslná
duplicita: **sazby se v čase mění a loňský přehled musí zůstat takový, jaký
byl** – ne přepočítaný dnešními čísly. Změna výchozí sazby proto nikdy
nesáhne na starší zápisy.

Výchozí sazba člověka je jen předvyplnění formuláře; nastavuje se v okně
**Firmy a sazby** spolu se seznamem firem a zakázek. Zakázky jsou týž číselník
jako v úkolovníku (`meta/zakazky`), takže se nikde nezdvojují.

### Zakázka, projekt, rozpočet

Zakázka se dělí na **projekty** (etapy, budovy, části stavby). U zápisu se
projekt nabízí teprve po výběru zakázky – jinak by to byla směsice cizích
etap. Zápis bez projektu patří zakázce jako celku.

U zakázky se zadává **rozpočet v korunách i v hodinách** (stačí jedno).
V přehledu je pak karta *Čerpání rozpočtů* s pruhem: do 75 % zeleně,
do 100 % oranžově, přes 100 % červeně, a k tomu kolik zbývá nebo o kolik
se přečerpalo.

**Čerpání se počítá ze všech zápisů, ne z vybraného období.** Rozpočet se
čerpá po celou dobu zakázky – „spotřebováno 40 000 z 900 000" za jeden měsíc
by říkalo pravý opak toho, co od takového čísla člověk čeká.

Zakázky, projekty a firmy jsou v `meta/zakazky` vedle skupin úkolů, protože
si je u svého výkazu musí umět vybrat i zaměstnanec. Tajné jsou **sazby lidí
a rozpočty zakázek**, ne názvy – ty leží v `private/vykazy/ciselniky`.

### Části zpracování a technologie

Části zpracování jsou `FOCENÍ`, `SKENY`, `TABULKY`, `ARCGIS` – stejný číselník
jako skupiny úkolů, aby se hodiny daly porovnat s tím, jak je práce rozdělená
v úkolovníku. Technologie (`VZT`, `CHL`, `ELE`, …) jsou převzaté ze skriptu
na třídění fotek (`tools/sort_photos/buildings/technologie.json`).

Pruhy v přehledu se měří **proti největší položce výběru**, ne proti součtu –
jinak by drobné položky byly neviditelné. Přepínač Peníze / Hodiny mění, podle
čeho se pruh kreslí; druhé číslo je vždycky vedle.

### Čas a peníze jsou dva dokumenty

Jeden zápis leží ve dvou dokumentech se **stejným `{id}`**:

| Kde | Co v něm je | Kdo ho přečte |
|---|---|---|
| `private/vykazy/zaznamy/{id}` | datum, práce, zakázka, projekt, časy, hodiny | **vlastník** a správci |
| `private/vykazy/castky/{id}` | sazba a částka | **jen správci** |

Důvod: Firestore neumí schovat jednotlivé pole – kdo dokument přečte, přečte
ho celý. Zaměstnanec tak uvidí svoje hodiny, ale ne to, za kolik se jeho
hodina fakturuje klientovi. Při čtení se to spáruje podle `id`; zápis bez
částky se v přehledu ukáže za nula korun, dokud mu správce sazbu nedoplní.

Zaměstnanec si smí svůj zápis založit a opravit (`KB.saveMujVykaz`), ale
nemůže ho přepsat na někoho jiného a mazat smí jen správce.

**Pravidla nejsou filtr.** Kdo nesmí číst cizí zápisy, musí si o svoje říct
dotazem `where("uid","==",…)` – jinak Firestore odmítne celý přenos. Proto
jsou dvě funkce: `KB.watchVykazy()` pro správce a `KB.watchMojeVykazy()`
pro stránku zaměstnance.

### Kdo se k výkazům dostane

- Stránky výkazů v hlavní liště **nejsou** – jediná cesta je ikona hodin nad
  lištou, a ta se vykreslí jen správcům (`need: 'vykaz.view'` v `taxonomy.js`).
- Stránka sama ukáže nesprávci jen krátkou hlášku místo obsahu.
- A hlavně: **data leží mimo `public/data`**, ve větvi
  `artifacts/{APP_ID}/private/vykazy/…`.

Ten poslední bod je ten podstatný. Nad `public/data/**` stojí
`allow read: if clen()`, a **pravidla se sčítají – níž už se to nedá odebrat**.
Kdyby výkazy ležely tam, přečetl by si sazby kdokoliv přihlášený prostě tím,
že by šel na databázi mimo web, kde naše schovaná tlačítka neplatí.

> **Pravidla se nasazují ručně** ve Firebase Console → Firestore Database →
> Rules. Dokud se nová část z [firestore.rules](firestore.rules) nevloží,
> stránka výkazů nic nenačte ani správci a ohlásí to toastem.

### Export do Excelu

Tlačítko **Stáhnout CSV** vysype právě vyfiltrovaný výběr: středník jako
oddělovač, desetinná čárka a BOM na začátku – to je to, co český Excel otevře
správně bez ptaní. Google Sheets si stejný soubor naimportuje přes
*Soubor → Importovat*.

## Účty a role

Lidé, kteří mají na web přístup, jsou v databázi v kolekci `users`; spravuje je
hlavní správce na `uzivatele.html` (ikona **Uživatelé** nad lištou – vidí ji jen
on). Přihlašuje se e-mailem a heslem, role se bere ze seznamu, takže když ji
hlavní správce změní, projeví se to i lidem, kteří jsou zrovna přihlášení.

| Akce | Hlavní správce | Správce | Zaměstnanec | Student |
|---|:--:|:--:|:--:|:--:|
| zakládat úkoly | ✓ | ✓ | ✓ | – |
| zapisovat procenta a poznámky | ✓ | ✓ | ✓ | ✓ |
| mazat úkoly | ✓ | ✓ | – | – |
| spravovat zakázky a skupiny | ✓ | ✓ | – | – |
| vidět historii zápisů | ✓ | ✓ | – | – |
| tvořit návody | ✓ | ✓ | ✓ | ✓ |
| mazat návody | ✓ | ✓ | – | – |
| stahovat návody do PDF | ✓ | ✓ | – | – |
| vidět výkazy práce a peníze | ✓ | ✓ | – | – |
| zapisovat výkazy práce | ✓ | ✓ | – | – |
| spravovat uživatele | ✓ | – | – | – |
| měnit vzhled webu | ✓ | – | – | – |

Pravomoci jsou na jednom místě v `assets/js/ui.js` (`PERMISSIONS`); stránky se
ptají přes `KBUI.can("ukol.create")`. Přidat pravomoc znamená doplnit řádek
tam a použít ho – tabulka na `uzivatele.html` se dopočítá sama.

### Hesla a trezor

Přihlášení se ověřuje proti **otisku SHA-256 se solí** – z otisku heslo přečíst
nejde, to je jeho smysl.

Aby si hlavní správce mohl heslo i **zobrazit**, ukládá se vedle otisku ještě
zašifrovaná podoba (AES-GCM, klíč z hesla k trezoru přes PBKDF2). Heslo
k trezoru nikde uložené není a z prohlížeče neodchází; v databázi leží jen
šifrovaný text. Kdyby se tedy někdo k databázi dostal, hesla lidí z ní nevyčte.

Na `uzivatele.html` je pruh **Trezor na hesla**: odemkne se heslem k trezoru
a pak jde u každého člověka heslo zobrazit, zkopírovat nebo změnit. Zamkne se
tlačítkem nebo zavřením stránky. **Heslo k trezoru se nedá obnovit** – když se
ztratí, hesla lidí se už nezobrazí (dají se ale nastavit nová).

Změna hesla k trezoru přešifruje všechna uložená hesla naráz, takže jde jen
z odemčeného trezoru.

Vygenerovaná hesla jsou i v `Seznam.xlsx` vedle jmen – ten soubor je
v `.gitignore`, protože **repozitář je veřejný**, a nikdy se nesmí commitnout.
Přepsání hesla v Excelu se na web **nepropíše**; mění se na `uzivatele.html`.

### Změna hesla

Hlavní správce může komukoliv heslo přepsat přímo na `uzivatele.html`
tlačítkem **Změnit heslo** – potřebuje k tomu **odemčený trezor**.

Firebase totiž nedovolí měnit cizí heslo „shora"; umí to jen vlastník účtu.
Obchází se to poctivě: trezor zná stávající heslo, takže se web pod tím účtem
v druhé instanci Firebase přihlásí a heslo změní jeho vlastním jménem. Hlavní
přihlášení správce přitom zůstane nedotčené.

Když heslo v trezoru není (nebo už neplatí, protože si ho člověk změnil sám),
nabídne se místo toho **odkaz na e-mail** a heslo si nastaví sám.

### Přístup je hlídaný i v databázi

Přihlašuje se přes **Firebase Auth** (e-mail a heslo) a pravidla Firestore
pouštějí k datům jen člověka, který má **záznam v `users` pod svým UID**
a aktivní účet. Role tedy neřídí jen to, co je vidět, ale i to, co kdo smí
uložit – ověřeno: student zapíše procenta u úkolu, ale do číselníku zakázek
ho databáze nepustí.

Anonymní přihlášení je vypnuté, takže bez účtu se nenačte vůbec nic.
Nepřihlášenému se místo obsahu webu ukáže jen výzva k přihlášení
(`UI.paintGate()` v `ui.js`) – nedá se proklikat ani prázdný výpis.

Platná pravidla jsou v [firestore.rules](firestore.rules). Když se budou
měnit, nasazují se ručně ve Firebase Console → Firestore Database → Rules.

## Co je hotové a co ne

Hotové: rozcestník, tři úrovně kategorií, hledání v liště, sazba A4 = PDF,
obrázky s proklikem, šablony, import od AI, vodoznak, úkolovník po zakázkách,
responzivita pro telefon a tablet, dokumentace ke všem skriptům v toolboxu.

Zatím ne (schválně, až bude obsah): přihlašování účtem a heslem od správce,
přehled přihlášení pro správce, omezení stahování PDF jen na správce.
