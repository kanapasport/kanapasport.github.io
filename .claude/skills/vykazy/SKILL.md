---
name: vykazy
description: Práce s výkazy práce Pasport Kaňa - rozbor excelových výkazů, přiřazování hodin k zakázkám a druhům práce, přehledy hodin a peněz, stránky vykazy.html / vykazy-prehled.html / vykazy-bp.html / nastaveni.html a pravidla Firestore nad nimi. Použij, když se řeší výkazy, odpracované hodiny, sazby, rozpočty zakázek, čerpání, nebo import starých excelů.
---

# Výkazy práce – Pasport Kaňa

Než na výkazy sáhneš, přečti si v repozitáři `PREDANI.md`, sekce **Výkazy
práce** a **Pasti, na které jsme narazili**. Tenhle soubor je jen zkratka
k tomu, co se snadno přehlédne.

## Dvě věci, které platí vždycky

**Repozitář je veřejný.** `kanapasport.github.io` si přečte kdokoliv. Do
souborů webu nesmí ani jedno číslo o penězích, ani jedno jméno v souvislosti
s hodinami — a to ani do vysvětlujícího textu, nejen do dat. Souhrny patří do
Firestore pod `private/…`, kam pouštějí pravidla jen správce.

**Do `innerHTML` jde všechno přes `KBUI.esc()`, i čísla.** Tyhle stránky
skládají HTML řetězci. Hodnoty, které smí zapsat někdo s nižšími právy
(vlastní zápis zaměstnance, jméno člověka, název zakázky, nahraný JSON),
se pak vykreslují správci — bez ošetření je to cesta, jak mu podstrčit skript.

## Kdo co smí

| | hlavní správce | správce | zaměstnanec | student |
|---|:--:|:--:|:--:|:--:|
| otevřít výkazy (`vykaz.otevrit`) | ✓ | ✓ | ✓ | – |
| vidět cizí zápisy a peníze (`vykaz.view`) | ✓ | ✓ | – | – |
| zapisovat za kohokoliv (`vykaz.edit`) | ✓ | ✓ | – | – |

Skutečnou hranicí je `firestore.rules`, ne `KBUI.can()`. Každý přihlášený si
může zavolat Firestore z konzole vlastními údaji — pravidla musí obstát proti
tomuhle, ne proti tomu, co ukazuje rozhraní.

## Data ve Firestore

```
artifacts/firemni-kb-app/private/vykazy/
  zaznamy/{id}      čas: uid, datum, nazev, zakazka, projekt, firma,
                    cinnost, technologie, od, do, pauza, hodiny, obed, km
                    → čte vlastník i správce
  castky/{id}       peníze: sazba, castkaPrace, obedKc, dopravaKc, castka
                    → čte JEN správce
  ciselniky/nastaveni   sazby lidí, rozpočty zakázek → jen správce
  prehledy/{id}     hotové souhrny ze starých excelů → jen správce
```

Čas a peníze jsou **dva dokumenty se stejným `{id}`**, protože Firestore neumí
schovat jednotlivé pole — kdo dokument přečte, přečte ho celý. Zaměstnanec tak
vidí svoje hodiny, ale ne za kolik se fakturují.

Netajné číselníky (názvy zakázek, projekty, firmy) jsou naopak v
`public/data/meta/zakazky`, aby si je zaměstnanec mohl u svého výkazu vybrat.

**Pravidla nejsou filtr.** Kdo smí číst jen svoje, musí si o to říct dotazem
`where("uid","==",…)` — proto jsou dvě funkce, `KB.watchVykazy()` pro správce
a `KB.watchMojeVykazy()` pro zaměstnance.

## Peníze

Sčítá se **den po dni: hodiny toho dne × sazba zapsaná u toho dne.** Nikdy
průměrem. Sazby v čase rostou a loňský přehled musí zůstat takový, jaký byl —
proto se `hodiny` i `castka` ukládají dopočítané a změna sazby v nastavení
nikdy nesahá na starší zápisy.

V tabulkách ukazuj **sazbu teď** (z posledního zápisu člověka), ne vážený
průměr — průměr přes víceletou zakázku nesedí ani na jedno a plete.

## Rozbor starých excelů

Nástroje jsou **mimo repozitář** v `Desktop\claude\vykazy_nastroje\`, návod
v `JAK-NA-TO.md`. Čistý Node.js, žádné knihovny — `.xlsx` se čte jako ZIP
s XML. Nejdřív si přečti ten návod, hlavně tabulku pojistek: každá vznikla
po chybě, která dávala nesmyslná čísla.

Nejčastější past: čtečka musí **přeskočit samouzavírací `<c .../>`**, jinak
spolkne sousední buňky a všechno se posune o sloupec.

## Grafy

Paleta je **šest barev prověřených validátorem** na barvosleposti a kontrast
(`dataviz` skill, `scripts/validate_palette.js`). Pořadí je závazné — zelená
nesmí sousedit s červenou ani oranžovou. Sedmá barva, která by prošla,
neexistuje, takže se od sedmé položky slévá do „Ostatní" v šedé; nikdy
nedogenerovávej další odstín.

Kruh na rozdělení celku na pár dílů, vodorovné pruhy na seřazený žebříček —
a ty jsou jednobarevné, protože každý pruh má vlastní popisek a barva by
nerozlišovala nic.
