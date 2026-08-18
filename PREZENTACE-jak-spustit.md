# Pasport Kaňa 2.0 – jak web rozjet na jiném počítači

Návod na přenos webu na notebook do zasedačky. Nic se neinstaluje.

---

## 1. Dostat web na notebook

**Když je na notebooku Git** (nejrychlejší, jde i aktualizovat):

```
git clone https://github.com/kanapasport/kanapasport.github.io.git
cd kanapasport.github.io
git checkout novy-web
```

**Když Git není:** zkopíruj na flashku celou složku

```
D:\CLAUDE_PRISTUP\PREDANI_WEB\pasportkana_navody
```

(má necelých 8 MB) a na notebooku ji dej třeba na plochu. Nic víc není potřeba –
`vykazy`, `vykazy_rozrazeno` ani ostatní složky vedle ní web nepotřebuje.

---

## 2. Spustit

Ve složce dvojklik na **`SPUSTIT-PREZENTACE.bat`**.

Otevře se černé okno a v prohlížeči web na `http://localhost:5174/index.html`.
**Okno nechej otevřené** – zavřením se web vypne.

Dávkový soubor si sám najde, čím web pustit, a zkouší popořadě:

1. Python z ArcGIS Pro (na našich GIS strojích je vždycky),
2. Python z PATH,
3. Node.js,
4. vlastní server v PowerShellu (`server.ps1`) – **tenhle nepotřebuje
   nainstalovat vůbec nic** a funguje na každém Windows.

Když port 5174 hlásí, že je obsazený, běží web už v jiném okně – buď ho použij,
nebo to druhé okno zavři.

> **Proč to nejde dvojklikem na `index.html`:** stránky načítají skripty jako
> moduly a prohlížeč je z adresy `file://` odmítne. Web musí jet přes
> `http://localhost`, což ten dávkový soubor zařídí.

---

## 3. Co udělat DNES VEČER, ne až ráno

- [ ] **Internet v zasedačce.** Data jsou ve Firebase, bez internetu se
      nenačte nic – ani přihlášení. Ověř, že se notebook připojí na firemní
      wifi a že web po přihlášení ukáže data.
- [ ] **Přihlásit se na notebooku** a projít Výkazy, Úkoly, Správu projektů
      a Kalendář. Přihlášení funguje na `localhost` bez dalšího nastavení.
- [ ] **Tabule** – ukážou se prázdné, dokud neproběhne přesun (viz níž).
- [ ] Nabíječka, HDMI/adaptér, a v prohlížeči **Ctrl+F5** (ať nedrží starou
      verzi souborů).

### Tabule: než je budeš ukazovat

Tabule se přestěhovaly do soukromé části databáze. Než je ukážeš, spusť
na **Import dat → Přesun tabulí → Zkopírovat tabule na nové místo**
(stačí jednou, odkudkoliv, jsi u toho přihlášený jako hlavní správce).
Staré umístění se tím nemaže.

Aby tabule viděli i ostatní (ne jen manažeři), musí být ve Firebase Console
nasazená nová `firestore.rules`. Na předvedení z tvého účtu to nutné není.

---

## 4. Co se na novém počítači nastaví samo a co ne

Web si část voleb pamatuje v prohlížeči, takže na notebooku začnou od začátku.
Nic z toho není chyba a nic se tím neztratí – data jsou v databázi.

| Věc | Na notebooku |
|---|---|
| Oblíbené projekty (hvězdičky) | **nastaví se samy** – BioPharma, C03, A08 a tři nejnovější pasporty |
| Barva webu | výchozí petrolejová |
| Rozbalené sekce a záložka projektu | výchozí stav |
| Přepínač matice (% TO-DO / Zbývá hodin) | % TO-DO |
| Heslo k citlivým sekcím (sazby, hesla, Přehled BP) | **bude se ptát znovu** – měj ho po ruce |
| Okno „Co je nového" | při první návštěvě nevyskočí |
| Projekty, úkoly, výkazy, budgety, kalendář | **beze změny, jsou v databázi** |

---

## 5. Kdyby něco nefungovalo

| Co se stane | Co s tím |
|---|---|
| Okno bliklo a zmizelo | Spusť `SPUSTIT-PREZENTACE.bat` znovu a nech okno otevřené; napíše, kde skončil |
| Prohlížeč hlásí, že se nelze připojit | Web ještě nabíhá – dej v prohlížeči F5 |
| Stránky bez barev a bez funkcí | Špatná adresa: musí být `http://localhost:5174/…`, ne `file:///…` |
| Web jede, ale nikde nejsou data | Nejsi přihlášený, nebo není internet |
| Tabule jsou prázdné | Neproběhl přesun tabulí (bod 3) |
| Stará podoba stránky | **Ctrl+F5** |

Nouzová varianta: **`kanapasport.github.io`** jede pořád ve staré verzi 1.0 –
kdyby notebook úplně zlobil, dá se ukázat aspoň ta.
