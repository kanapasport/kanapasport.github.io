# Návody k Revitu – připravené k importu

Stejně jako `navody-autocad`: web tyhle soubory nečte sám, jsou to předpřipravené
návody k jednorázovému nahrání do databáze a záloha textu.

## Jak je dostat na web

Nahráno 13. 11. 2026 robotem i s obrázky (nástroj `navody_import/nahraj_navody.py` mimo repo).
Ručně: `editor.html#import` → vlož obsah souboru → **Načíst do editoru** → doplň obrázky a ulož.
Značka `[obr N]` = N-tý obrázek **toho kroku** (ne pořadí v celém návodu).

## Zařazení

| soubor | cat | subcat | téma v liště |
|---|---|---|---|
| `01-mracno-bodu-do-revitu.json` | `programy` | `revit-mracno` | PROGRAMY → Revit → Mračno bodů ze skenu |

Podsekce `revit-mracno` je nová (přidaná v `assets/js/taxonomy.js`). Nasazeno ve v346.

## Obrázky

Screenshoty jsou mimo repo (repo je veřejné a na snímcích je cesta k zakázce):
`D:\PASPORT_DATA\SPORTOVKA\SKENY\_poznatky\obrazky\navod_revit\`

| krok · značka | soubor |
|---|---|
| krok 2 · `[obr 1]` | `obr1_scene_export_scans.png` – kontextové menu Export → Scans → Scans |
| krok 3 · `[obr 1]` | `obr2_scene_nastaveni_exportu.png` – dialog exportu (před importem uprav fajfky podle návodu) |
| krok 4 · `[obr 1]` | `obr3_recap_filtrovani.webp` |
| krok 4 · `[obr 2]` | `obr4_recap_obrazek_e57.png` – na snímku je import obrázku ještě ZAPNUTÝ |
| krok 4 · `[obr 3]` | `obr5_recap_rozsirene.png` |
| krok 5 · `[obr 1]` | `obr6_recap_preskocit_registraci.webp` |
| krok 5 · `[obr 2]` | `obr7_recap_indexace.webp` |
| krok 6 · `[obr 1]` | chybí – vyfotit Revit: Vložit → Propojit → Mračno bodů a okno s Umístěním |
| krok 8 · `[obr 1]` | `obr9_revit_prepsat_grafiku.png` |
