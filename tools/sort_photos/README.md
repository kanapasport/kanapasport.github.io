# Třídění fotek z pasportizace

Nástroj automaticky roztřídí fotky z pasportizace do složek podle **budovy**, **místnosti** a **technologie**.

Výsledná struktura:

```
D:\Pasport\
    G62\
        GS642\
            VZT\        <- vzduchotechnika
                IMG_0123.jpg
                IMG_0124.jpg
            HAS\        <- hasicí přístroje
                IMG_0510.jpg
        GS643\
            VZT\
                ...
    G61\
        ...
    _PREHLED_pasportizace.xlsx    <- souhrn všech běhů
    report_20260806_143000.xlsx   <- detailní report jednoho běhu
    _behy\                        <- logy pro případné vrácení zpět
```

---

## 1. Instalace (jednou na každém počítači)

### Krok 1 — Python

Stáhnout z <https://www.python.org/downloads/>
**Při instalaci zaškrtnout „Add python.exe to PATH"** (jinak nic nepojede).

Ověření — v PowerShellu:

```
python --version
```

### Krok 2 — Tesseract OCR

Stáhnout Windows instalátor z <https://github.com/UB-Mannheim/tesseract/wiki>

Při instalaci **přidat český jazyk** (v seznamu „Additional language data" zaškrtnout Czech).
Zapamatovat si cestu, obvykle: `C:\Program Files\Tesseract-OCR\tesseract.exe`

### Krok 3 — knihovny

V PowerShellu ve složce s tímto souborem:

```
pip install -r requirements.txt
```

---

## 2. Nastavení budov (důležité — tohle rozhoduje o přesnosti)

Ve složce `buildings\` musí být pro každou budovu jeden JSON soubor se **seznamem
skutečných kódů místností**. Podle vzoru `G62.example.json` vytvořte:

- `buildings\G61.json`
- `buildings\G62.json`
- … a další budovy

**Proč je to nejdůležitější krok:** skript nehádá, co OCR přečetlo — porovnává to
proti seznamu skutečných místností. Když OCR přečte `G5642` místo `GS642`, seznam
to opraví. Bez seznamu je přesnost výrazně nižší a je mnohem větší šance, že bude
potřeba placené vision API.

Skript si načte **všechny** budovy najednou a podle kódu místnosti sám pozná,
do které budovy fotka patří (proto se G61 a G62 nemusí řešit zvlášť).

---

## 3. Běžné použití

### Příprava fotek

Do inbox složky nahrajte fotky **rozdělené podle technologie** — název podsložky
je zkratka technologie:

```
D:\Inbox\
    VZT\        <- sem fotky vzduchotechniky
    HAS\        <- sem fotky hasicích přístrojů
```

Číselník zkratek je v `buildings\technologie.json` (dá se doplnit).

### Krok 1 — zkouška nanečisto (VŽDY nejdřív tohle)

Nic nepřesouvá, jen spočítá a vypíše, co by se stalo:

```
python sort_photos.py --dest "D:\Pasport" --inbox "D:\Inbox" --tesseract "C:\Program Files\Tesseract-OCR\tesseract.exe" --dry-run
```

Otevřít vzniklý `report_*.xlsx`, list **„Ke kontrole"** — tam je vidět, co se
nepovedlo rozpoznat.

### Krok 2 — ostrý běh

```
python sort_photos.py --dest "D:\Pasport" --inbox "D:\Inbox" --tesseract "C:\Program Files\Tesseract-OCR\tesseract.exe" --move
```

Bez `--move` se fotky kopírují (originály zůstanou v inboxu) — bezpečnější,
ale zabere to místo na disku.

### Krok 3 — ruční doladění a učení

1. V cílové složce najít složky `Neznama_mistnost_1`, `Neznama_mistnost_2`…
2. Podívat se dovnitř na fotku tabletu a **složku přejmenovat** na správný kód místnosti.
3. Spustit učení:

```
python sort_photos.py --mode learn --dest "D:\Pasport"
```

Skript si nové kódy doplní do `buildings\*.json` a **příště je už pozná sám**.
S každým takovým kolem přesnost roste a ruční práce ubývá.

---

## 4. Když se něco pokazí

### Vrácení celého běhu zpět

Run ID najdete v názvu reportu nebo ve složce `_behy\`:

```
python sort_photos.py --mode undo --dest "D:\Pasport" --run-id 20260806_143000
```

Pak spustit třídění znovu s `--reprocess`.

### Opakované spuštění nic nedělá

Skript si pamatuje, které fotky už zpracoval (soubor `_zpracovane_fotky.json`),
takže je znovu nepřehazuje. Pokud to chcete přesto, přidejte `--reprocess`.

---

## 5. Placené vision API (volitelné, jen když lokální OCR nestačí)

Pokud i po naplnění seznamu místností zůstává hodně `Neznama_mistnost_*`:

```
pip install anthropic
$env:ANTHROPIC_API_KEY = "sk-ant-..."
python sort_photos.py --dest "D:\Pasport" --inbox "D:\Inbox" --tesseract "..." --move --vision-fallback
```

Volá se **jen na fotky, které lokální OCR nezvládlo** — typicky jednotky až desítky
fotek z tisíce. Výsledky se cachují, takže stejná fotka se neplatí dvakrát.

---

## 6. Užitečné přepínače

| Přepínač | Co dělá |
|---|---|
| `--dry-run` | Nic nepřesune, jen spočítá a vytvoří report |
| `--move` | Přesune fotky (výchozí je kopírovat) |
| `--workers 8` | Počet paralelních procesů (výchozí = počet jader − 1) |
| `--reprocess` | Zpracuje i fotky, které už byly zpracované dřív |
| `--no-screen-crop` | Vypne detekci displeje tabletu (když by dělala problémy) |
| `--technology VZT` | Určí technologii ručně (když nejde z názvu složky) |
| `--source "..."` | Jedna složka místo inboxu |

---

## 7. Co je v reportu

**`report_<run_id>.xlsx`** — jeden běh:

| List | Obsah |
|---|---|
| Souhrn | Kolik fotek, kolik místností, kontrola integrity, doba běhu |
| Ke kontrole | **Nejdůležitější list** — co je potřeba ručně dodělat |
| Místnosti | Přehled místností s počty fotek a stavem |
| Fotky | Detail každé fotky — co OCR přečetlo a kam fotka šla |
| Technologie | Kolik fotek na kterou technologii |

**`_PREHLED_pasportizace.xlsx`** — historie všech běhů, jeden řádek na běh.

---

## 8. Známá omezení

- Skript zatím **nebyl otestován na reálných datech** — první ostrý běh dělejte
  vždy s `--dry-run` a na malém vzorku.
- Fotky bez EXIF času se řadí podle názvu souboru — ověřte, že názvy odpovídají
  pořadí focení.
- Pokud fotka tabletu chybí nebo je nečitelná, celá série skončí v `Neznama_mistnost_*`
  — to je záměr, ne chyba.
