# Návody k AutoCADu – připravené k importu

Tyhle soubory **nečte web sám od sebe** – jsou to předpřipravené návody
k jednorázovému nahrání do databáze (stejně jako `navody-skripty.json`
u sekce SKRIPTY). V repu zůstávají jako záloha textu.

## Jak je dostat na web

1. Otevři `editor.html#import` (nebo NÁVODY → **+ Nový návod** → ikona
   **Import od AI** v hlavičce).
2. Zkopíruj **obsah jednoho souboru** a vlož do okna importu → **Načíst do editoru**.
   Okno bere vždy jeden návod, takže se to opakuje pro každý soubor.
3. Zkontroluj text, doplň obrázky na místa `[obr 1]`, `[obr 2]` a ulož.
4. Autor se doplní podle přihlášeného člověka, nevyplňuje se v JSONu.

Pořadí importu podle čísel v názvu = pořadí, v jakém na sebe návody odkazují.

## Zařazení

Všechny míří do sekce `autocad` (lišta **AUTOCAD**), podsekce podle
`subcat` – definice je v `assets/js/taxonomy.js`:

| soubor | subcat | téma v liště |
|---|---|---|
| `01-instalace.json` | `autocad-instalace` | Nastavení stanice → Instalace a licence |
| `02-balicek-nastaveni.json` | `autocad-balicek` | Nastavení stanice → Balíček nastavení |
| `03-pracovni-prostor.json` | `autocad-prostor` | Nastavení stanice → Pracovní prostor a palety |
| `04-mys-prave-tlacitko.json` | `autocad-mys` | Nastavení stanice → Myš a pravé tlačítko |
| `05-zkratky.json` | `autocad-zkratky` | Ovládání → Klávesové zkratky |
| `06-lispy.json` | `autocad-lispy` | Ovládání → LISPy a doplňky |

`autocad-balicek` je zároveň `main` sekce – ten návod se otevře, když se
lišta AUTOCAD jen rozklikne.

Prázdné zatím zůstávají `autocad-xref` (Externí reference) a
`autocad-priprava` (Příprava dat pro ArcGIS).

## Zdroj obsahu

Postupy odpovídají nastavení na Michalově stanici (AutoCAD 2025, česká
verze, pracovní prostor `MK_PsprtKana`) a balíčku `D:\CAD_MK\BALICEK_AUTOCAD`.
Když se změní zkratky, přegeneruj krok „Celý blok zkratek" v `05-zkratky.json`
z aktuálního `acad.pgp` – blok se do návodu vkládá doslova.
