---
name: novy-web
description: Práce na nové verzi webu Pasport Kaňa ve větvi novy-web - svislý pás, projekty, úkoly s TO-DO, Quick TO-DO, kalendář, milníky, správa projektů, nástěnka. Použij, když se upravuje kterákoliv stránka téhle větve, přidává se nová, nebo se řeší vzhled, zarovnání a role.
---

# Nová verze webu – větev `novy-web`

Ostrý web je na `main` a jede přes GitHub Pages. Nová verze žije ve větvi
`novy-web`; na ostrý web se nedostane, dokud se nesloučí. **Obě verze ale
sdílí jednu databázi** – co nová verze zapíše, uvidí i ostrý web.

## Než něco uděláš

1. Zkontroluj větev: `git branch --show-current` musí být `novy-web`.
2. Web se pouští `Desktop\claude\SPUSTIT-web.bat` → `http://localhost:4173`.
3. Po zásahu do `assets/` **zvedni `?v=NN` ve všech HTML naráz**
   (`sed -i 's/?v=52/?v=53/g' *.html`) – jinak si část stránek tahá starý
   soubor z mezipaměti a chová se jinak než zbytek.

## Co Michal opakovaně chce (a co zamítl)

| Platí | Vysvětlení |
|---|---|
| Formuláře na sdílené třídě **`.fmr`** | Vzor je zápis výkazu: kompaktní pole ~220 px skládaná auto-fitem. Tři obří sloupce přes širokou stránku zamítl. |
| **Tlačítka akcí vpravo** od nadpisu (`.spread`) | Pokus dát je vedle nadpisu zamítl. |
| Dlaždice **stejně velké**, 2 vedle sebe | Pevná výška, rolování uvnitř karty. |
| **Barvy podle rozpracovanosti** | Stupnice `--p0`…`--p100`, stejná jako na starém webu. Nemíchat vlastní. |
| Web **široký** (`--sirka-stranky`) | Ne úzký sloupec uprostřed. |
| Pás **nesmí opisovat lištu** | Zamítl. Nese osobní věci: Stats, Quick TO-DO, rychlé akce, jméno + role + Odhlásit. |
| Nastavení **u toho, čeho se týká** | Číselníky projektu ve `sprava.html`, ne v Nastavení. |
| **Šablony neřešit** | „Až je budu potřebovat, ozvu se." |

## Rozvržení

- `assets/js/ui.js` – hlavička, lišta, svislý pás, Quick TO-DO panel,
  `UI.paintSubbar(polozky, aktivni)` na druhý řádek lišty.
- Stránky, které patří k sobě, mají **stejnou podlištu** a liší se jen
  zvýrazněnou položkou: výkazy/přehled/vytížení, projekty/gantt/správa,
  nastavení/uživatelé/barvy.

## Data (`assets/js/store.js`)

```
private/projekty/seznam/{id}     hlavička projektu (čte přiřazený i manažer)
private/projekty/finance/{id}    peníze projektu (jen manažer)
private/ukoly/seznam/{id}        úkol s TO-DO (čte přiřazený i manažer)
private/aktivity/seznam/{id}     historie kroků (píše každý, čte manažer)
private/nastaveni/zamek/heslo    otisk hesla k citlivým sekcím
osobni/quicktodo/seznam/{id}     rychlé vzkazy – JEN autor a adresát
public/data/kalendar/{id}        události, dovolené (vidí všichni)
public/data/pritomnost/{uid}     kdo je na webu (otisk po 5 minutách)
```

**Odběry se smí rozšířit, ne zúžit** (`moje` → `vše`). Pás si na každé
stránce vyžádá „jen moje"; kdyby to šlo zúžit, manažerovi by zablokoval
plný odběr, o který si dál řekne stránka.

## Pasti

- **Pravidla nejsou filtr.** Kdo smí číst jen svoje, musí se ptát dotazem
  (`where`), jinak Firestore odmítne celý přenos.
- **Do `innerHTML` všechno přes `KBUI.esc()`**, i čísla.
- **Repozitář je veřejný** – žádná jména klientů, sazby ani částky.
- **Náhledový prohlížeč vrací zastaralé `getBoundingClientRect` a computed
  style po změně třídy.** Když měření nesedí s očekáváním, ověř screenshotem
  nebo nastav hodnotu inline; nehoň se za neexistující chybou.
- Po přejmenování zkontroluj, že nezůstal kód volající smazané prvky –
  `$("btnNeco").addEventListener` na neexistující prvek shodí celou
  inicializaci stránky a ta zůstane prázdná.
- **Místní server (`npx serve`) s hezkými adresami zahazoval `?query`:**
  `tabule.html?id=X` → 301 na `/tabule` bez id, stránka se přesměrovala
  dokola („problikává a načítá se furt"). `serve.json` má proto
  `cleanUrls:false` + přepis `/:stranka` → `/:stranka.html` (přepis
  přežije i 301, které si prohlížeče pamatují napořád). Identita tabule
  jede v `#deska=ID` – hash serveru nikdy nedojde, tak ho nemůže ztratit.
  Když stránka po prokliku „neví", ověř nejdřív `location.search` naživo.
- **Memoizace prvního vykreslení:** otisk inicializuj `null`, ne `""` –
  prázdný stav má taky otisk `""` a první malování by se přeskočilo.
