/* ==========================================================================
   Výkazy práce – společné počítání a sazba čísel.

   Stránky `vykazy.html` (zápis a záznamy) a `vykazy-prehled.html` (přehled
   lidí a peněz) sdílí filtr, součty i formát čísel. Kdyby si to každá počítala
   po svém, dřív nebo později by ukazovaly jiné částky – a to je u peněz to
   poslední, co chceme.

   Vykresluje se tu jen to, co je na obou stránkách stejné (dlaždice součtů
   a vodorovné pruhy). Zbytek si každá stránka kreslí sama.
   ========================================================================== */

(function () {
    "use strict";

    const V = {};
    window.KBVYK = V;

    const esc = (value) => window.KBUI.esc(value);

    /* ------------------------------------------------------------- čísla */

    V.cislo = (value, des) => Number(value || 0).toLocaleString("cs-CZ", {
        minimumFractionDigits: des || 0,
        maximumFractionDigits: des === undefined ? 0 : des
    });

    /** Koruny se zaokrouhlují na celé – haléře nikoho nezajímají. */
    V.kc = (value) => V.cislo(Math.round(Number(value) || 0)) + " Kč";

    V.hod = (value) => Number(value || 0).toLocaleString("cs-CZ",
        { maximumFractionDigits: 2 }) + " h";

    /**
     * České skloňování počtu: 1 den · 2 dny · 5 dní.
     * Bez toho by v přehledu svítilo „1 dní", což vypadá jako chyba v součtu.
     */
    V.pocet = (n, tvary) => {
        const cislo = Math.abs(Number(n) || 0);
        const tvar = cislo === 1 ? tvary[0]
                   : (cislo >= 2 && cislo <= 4 && cislo % 1 === 0) ? tvary[1]
                   : tvary[2];
        return V.cislo(n) + " " + tvar;
    };

    V.czDatum = (iso) => {
        if (!iso) return "";
        const [y, m, d] = iso.split("-");
        return Number(d) + ". " + Number(m) + ". " + y;
    };

    const DNY = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
    V.denVTydnu = (iso) => iso ? DNY[new Date(iso + "T00:00:00").getDay()] : "";

    V.dnesISO = () => {
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
               "-" + String(d.getDate()).padStart(2, "0");
    };

    /* --------------------------------------------------------------- čas --
       Zapisuje se po čtvrthodinách – přesnější údaj nikdo nezná a při zpětném
       vyplňování se stejně zaokrouhluje. Nabídka je proto pevná: 00:00–23:45
       po 15 minutách, jedna pro celou stránku (odkazuje se na ni `list=`). */

    /* Nabízí se jen pracovní část dne (6:00–18:00). Mimo ni se pracuje
       výjimečně a kdo potřebuje, čas si napíše – zápis se pak srovná stejně
       jako vybraný. Kratší seznam se dá projet očima. */
    V.CASY = (() => {
        const out = [];
        for (let m = 6 * 60; m <= 18 * 60; m += 15) {
            out.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" +
                     String(m % 60).padStart(2, "0"));
        }
        return out;
    })();

    V.CAS_LIST_ID = "casy15";

    V.casDatalist = () => '<datalist id="' + V.CAS_LIST_ID + '">' +
        V.CASY.map(c => '<option value="' + c + '">').join("") + "</datalist>";

    /**
     * Srovná napsaný čas na nejbližší čtvrthodinu.
     * Lidi píšou zkratkovitě, tak to bereme, jak to přijde:
     *   "8" → 08:00 · "830" nebo "8:3" → 08:30 · "8:07" → 08:00 · "1745" → 17:45
     * Vrací "" u nesmyslu, ať se nezapíše rozbitý čas.
     */
    V.normalizujCas = (text) => {
        const t = String(text || "").trim().replace(/\s|\./g, ":");
        if (!t) return "";

        let h, m;
        if (t.indexOf(":") !== -1) {
            const [a, b] = t.split(":");
            h = Number(a);
            // "8:3" znamená 8:30, ne 8:03 – tak to člověk píše
            m = b === undefined || b === "" ? 0 : Number(b.length === 1 ? b + "0" : b.slice(0, 2));
        } else if (/^\d{1,2}$/.test(t)) {
            h = Number(t); m = 0;
        } else if (/^\d{3,4}$/.test(t)) {
            h = Number(t.slice(0, t.length - 2));
            m = Number(t.slice(-2));
        } else {
            return "";
        }
        if (!isFinite(h) || !isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return "";

        // na nejbližší čtvrthodinu; 23:53 → 23:45, ne přes půlnoc
        let celkem = Math.round((h * 60 + m) / 15) * 15;
        if (celkem >= 24 * 60) celkem = 24 * 60 - 15;
        return String(Math.floor(celkem / 60)).padStart(2, "0") + ":" +
               String(celkem % 60).padStart(2, "0");
    };

    /* -------------------------------------------------------------- lidé */

    V.jmeno = (user) => ((user.first || "") + " " + (user.last || "")).trim() || user.email || "";
    /**
     * Lidé, mezi které se rozděluje práce. Služební účty (zápis do Tabulek
     * Google) sem nepatří – k projektu se nepřiřazují a sazbu nemají;
     * ve správě uživatelů zůstávají, ta čte `KB.users` přímo.
     *
     * Pořadí: zaměstnanci a OSVČ napřed, studenti za nimi, v rámci skupiny
     * podle příjmení.
     */
    V.lide = () => (window.KB.users || [])
        .filter(u => u.active !== false && !window.KBUI.jeSluzebni(u))
        .sort((a, b) => {
            const pa = window.KBUI.PORADI_TYPU[window.KBUI.typUvazku(a)];
            const pb = window.KBUI.PORADI_TYPU[window.KBUI.typUvazku(b)];
            return (pa === undefined ? 9 : pa) - (pb === undefined ? 9 : pb) ||
                (a.last || "").localeCompare(b.last || "", "cs") ||
                (a.first || "").localeCompare(b.first || "", "cs");
        });
    V.clovek = (uid) => (window.KB.users || []).find(u => u.id === uid) || null;

    /** Jméno u zápisu. Uložené jméno platí i pro člověka, který už ve firmě není. */
    V.osobaText = (zaznam) => {
        const u = V.clovek(zaznam.uid);
        return u ? V.jmeno(u) : (zaznam.osoba || "—");
    };

    /* --------------------------------------------------------- číselníky */

    V.cinnosti    = () => (window.KB.cinnosti || []);
    V.technologie = () => (window.KB.technologie || []);
    V.firmy       = () => (window.KB.firmy || []);
    V.zakazky     = () => (window.KB.zakazky || []);

    /* ---------------------------------------------- zůstatky člověka ----
       Kolik zbývá dovolené a kolik je naběháno přesčasů. Počítá se od data,
       které je u člověka nastavené (Nastavení → Dovolená a přesčasy) –
       před ním web historii nemá a musí se do něj vstoupit s ručně zadanou
       hodnotou, jinak by všichni začali na nule. */

    /** Fond pracovních hodin mezi dvěma dny – bez víkendů a svátků. */
    V.fondHodin = (odIso, doIso) => {
        if (!odIso || !doIso || odIso > doIso) return 0;
        const d = new Date(odIso + "T00:00:00");
        const konec = new Date(doIso + "T00:00:00");
        let dnu = 0, pojistka = 0;
        while (d <= konec && pojistka++ < 4000) {
            const den = d.getDay();
            if (den !== 0 && den !== 6) {
                const iso = d.getFullYear() + "-" +
                    String(d.getMonth() + 1).padStart(2, "0") + "-" +
                    String(d.getDate()).padStart(2, "0");
                if (!(window.KBUI.svatek && window.KBUI.svatek(iso))) dnu++;
            }
            d.setDate(d.getDate() + 1);
        }
        return dnu * 8;
    };

    V.zustatek = (uid) => {
        const z = (window.KB.zustatky || {})[uid] || {};
        const od = z.odIso || "";
        const dnes = V.dnesISO();
        const nastaveno = !!od;

        const moje = (window.KB.vykazy || []).filter(v =>
            v.uid === uid && v.datum && v.datum >= od && v.datum <= dnes);

        /* Dovolená se ukládá rozepsaná po pracovních dnech, takže jeden
           zápis = jeden den. Volno a nemoc se do nároku nepočítají. */
        const dovolenaDnu = moje.filter(v => v.zakazka === "Dovolená").length;
        const narok = Number(z.narok) || 0;
        const cerpano = (Number(z.cerpanoPred) || 0) + dovolenaDnu;

        /* Přesčas stejně jako ve Vytížení: odpracováno + absence po osmi
           hodinách − fond. Absence se počítá jako odpracovaná směna, jinak
           by týden dovolené shodil přesčas o 40 hodin do mínusu. */
        const absenceDnu = moje.filter(v => v.absence === true).length;
        const prace = moje.filter(v => v.absence !== true)
            .reduce((n, v) => n + (Number(v.hodiny) || 0), 0);
        const fond = V.fondHodin(od, dnes);
        const prescas = (Number(z.prescasPred) || 0) + prace + absenceDnu * 8 - fond;

        /* Manažer poslouchá výkazy jen v okně několika měsíců – když je
           začátek počítání starší, chybí mu data a číslo by bylo mimo. */
        const okno = window.KB.vykazyOknoOd || "";
        return {
            nastaveno: nastaveno,
            od: od,
            narok: narok,
            cerpano: cerpano,
            zbyva: narok - cerpano,
            dovolenaDnu: dovolenaDnu,
            prescas: Math.round(prescas * 10) / 10,
            fond: fond,
            prace: Math.round(prace * 10) / 10,
            neuplne: nastaveno && !!okno && od < okno
        };
    };

    /** Projekty uvnitř zakázky. Bez zakázky nemá smysl nabízet nic. */
    V.projekty = (zakazka) => {
        const mapa = window.KB.projekty || {};
        return Array.isArray(mapa[zakazka]) ? mapa[zakazka] : [];
    };

    /** Plnění úkolu v procentech – průměr TO-DO položek. */
    V.pctUkolu = (u) => {
        const todo = u.todo || [];
        if (!todo.length) return u.stav === "hotovo" ? 100 : 0;
        return Math.round(todo.reduce((sum, t) => sum + (Number(t.pct) || 0), 0) / todo.length);
    };

    /**
     * Matice plnění: jedna tabulka jako v excelovém budgetu – řádek je
     * technologie a vedle ní malé buňky po budovách a patrech (hlavička
     * má dvě patra: budova nahoře, její patra pod ní). Procento buňky je
     * vážené budgetem úkolů; úkoly bez budgetu se průměrují prostě.
     * `klikaci: true` udělá z buněk tlačítka s data-mx="budova|tech|patro"
     * (prázdná buňka zakládá úkol) – bez toho je matice jen na čtení.
     */
    /**
     * @param {Object} [techBudgety] – { TER: 250000, … }: budget technologie
     *   v PENĚZÍCH (Kč). Vpravo přibude blok Budget Kč / Hodin / Vyfakturováno /
     *   Zbývá – hodiny se dopočítají průměrnou hodinovkou lidí přiřazených
     *   k technologii (volby.sazbaTech), vyfakturováno jsou skutečné peníze
     *   z výkazů přes vazbu na úkoly technologie (volby.cerpani).
     *   `klikaci` z Budgetu udělá editovatelné pole (data-techbud="TER").
     * @param {Object} [volby] – { rezim: "pct"|"zbyva", odpracovano: fn(id)→h }.
     *   „zbyva" místo % TO-DO ukáže v buňce zbývající hodiny (budget úkolů
     *   buňky − odpracováno z výkazů) – červeně, když je buňka přes.
     *   `cerpaniBunky(budova, patro, tech)` a `cerpaniTech(tech)` berou peníze
     *   z ROZPADU VÝKAZŮ (V.rozpadProjektu) – zápis na dvě patra se tak dělí.
     *   Bez nich se počítá postaru přes vazbu na úkoly (volby.cerpani).
     */
    V.maticePlneni = (ukoly, budgety, osy, klikaci, techBudgety, volby) => {
        const esc = window.KBUI.esc;
        const budovy = osy.budovy || [], patra = osy.patra || [], technologie = osy.technologie || [];
        if (!budovy.length || !patra.length || !technologie.length) return "";
        const sBudgety = techBudgety !== undefined && techBudgety !== null;

        const uroven = (pct) => pct >= 100 ? "p100" : pct >= 95 ? "p95"
            : pct >= 75 ? "p75" : pct >= 50 ? "p50" : "p0";

        const bunka = (budova, tech, patro) => {
            const moje = ukoly.filter(u =>
                u.budova === budova && u.patro === patro && u.technologie === tech);
            const klic = esc(budova) + "|" + esc(tech) + "|" + esc(patro);
            if (!moje.length) {
                /* Buňka bez úkolu může mít odvedenou práci: zápis na dvě
                   patra spadne i tam, kde úkol nikdo nezaložil. Ať to není
                   vidět jako prázdno – peníze se ukážou i tak. */
                const kde = esc(budova + " – " + tech + " – " + patro);
                /* Koruny se ukážou jen v režimu „Zbývá peněz" – vedle procent
                   TO-DO by míchaly dvě různé veličiny do jedné tabulky. */
                const bez = (volby && volby.rezim === "zbyva" && volby.cerpaniBunky)
                    ? volby.cerpaniBunky(budova, patro, tech).castka : 0;
                const popisek = bez
                    ? Math.round(bez).toLocaleString("cs-CZ") + "&nbsp;Kč"
                    : (klikaci ? "+" : "·");
                const titulek = bez
                    ? "Vykázáno bez úkolu – " + kde +
                        (klikaci ? " · klikni a úkol založ" : "")
                    : (klikaci ? "Založit úkol " + kde : kde);
                return klikaci
                    ? '<td><button type="button" class="mx__bunka mx__bunka--nic" data-mx="' + klic +
                        '" title="' + titulek + '">' + popisek + "</button></td>"
                    : '<td><span class="mx__bunka mx__bunka--nic">' + popisek + "</span></td>";
            }
            let vaha = 0, soucet = 0;
            moje.forEach(u => {
                const w = Number(((budgety || {})[u.id] || {}).budgetKc) || 0;
                vaha += w; soucet += V.pctUkolu(u) * w;
            });
            const pct = vaha ? Math.round(soucet / vaha)
                : Math.round(moje.reduce((x, u) => x + V.pctUkolu(u), 0) / moje.length);
            const nazvy = moje.map(u => esc(u.nazev)).join(", ");

            let obsah, trida;
            if ((volby || {}).rezim === "zbyva") {
                /* zbývající PENÍZE buňky: budget úkolů − vyfakturováno
                   z výkazů (částky přes vazbu na úkol) */
                const budget = moje.reduce((x, u) =>
                    x + (Number(((budgety || {})[u.id] || {}).budgetKc) || 0), 0);
                const cerpano = volby.cerpaniBunky
                    ? volby.cerpaniBunky(budova, patro, tech).castka
                    : (volby.cerpani ? moje.reduce((x, u) => x + volby.cerpani(u.id), 0) : 0);
                const zbyva = budget - cerpano;
                obsah = Math.round(zbyva).toLocaleString("cs-CZ") + "&nbsp;Kč";
                trida = zbyva < 0 ? "mx__bunka--pres" : "mx__bunka--" + uroven(pct);
            } else {
                obsah = pct + "&nbsp;%";
                trida = "mx__bunka--" + uroven(pct);
            }
            return klikaci
                ? '<td><button type="button" class="mx__bunka ' + trida +
                    '" data-mx="' + klic + '" title="' + nazvy + '">' + obsah + "</button></td>"
                : '<td><span class="mx__bunka ' + trida + '" title="' + nazvy + '">' +
                    obsah + "</span></td>";
        };

        /* pravý blok: vyfakturováno = skutečné peníze z výkazů (vazba
           záznamů na úkoly technologie) – stejná veličina jako v buňkách
           režimu „Zbývá peněz". Rozdělené budgety úkolů (dřívější
           „ukrojeno") ukazuje tabulka Vyčleněno níž. */
        const vyfakturovano = (tech) => {
            if (volby && volby.cerpaniTech) return volby.cerpaniTech(tech).castka;
            return (volby && volby.cerpani)
                ? ukoly.filter(u => u.technologie === tech)
                    .reduce((sum, u) => sum + (Number(volby.cerpani(u.id)) || 0), 0)
                : 0;
        };

        const cislo = (n) => (Math.round(n * 10) / 10).toLocaleString("cs-CZ");

        const budgetBunky = (tech) => {
            if (!sBudgety) return "";
            const kc = Number(techBudgety[tech]) || 0;
            const sazba = (volby && volby.sazbaTech) ? volby.sazbaTech(tech) : 0;
            /* peníze → hodiny přes průměrnou hodinovku lidí té technologie;
               bez přiřazených lidí není čím dělit a hodiny se nedopočítají.
               Vyfakturováno i Zbývá jsou v Kč. */
            const hodinCelkem = (kc && sazba) ? kc / sazba : 0;
            const vyf = vyfakturovano(tech);
            const zbyva = kc - vyf;
            return '<td class="mx__budget">' +
                (klikaci
                    ? '<input type="text" class="field" inputmode="numeric" data-penize' +
                        ' data-techbud="' + esc(tech) + '" value="' +
                        (kc ? window.KBUI.penizeText(kc) : "") + '">'
                    : (kc ? cislo(kc) : "–")) + "</td>" +
                '<td class="mx__budget"' + (sazba
                    ? ' title="při průměrné sazbě ' + cislo(sazba) + ' Kč/h"'
                    : (kc ? ' title="přiřaď lidi k technologii (Spolupracovníci), jinak není čím dělit"' : "")) + ">" +
                    (hodinCelkem ? cislo(Math.round(hodinCelkem)) : (kc ? "?" : "–")) + "</td>" +
                '<td class="mx__budget">' + (vyf ? cislo(vyf) : "–") + "</td>" +
                '<td class="mx__budget' + (zbyva < 0 && kc ? " mx__budget--minus" : "") + '">' +
                    (kc ? cislo(Math.round(zbyva)) : "–") + "</td>";
        };

        return '<div class="mx-wrap"><table class="mx"><thead>' +
            "<tr><th></th>" + budovy.map(b =>
                '<th colspan="' + patra.length + '">' + esc(b) + "</th>").join("") +
            (sBudgety ? '<th colspan="4">Budget technologie</th>' : "") + "</tr>" +
            "<tr><th></th>" + budovy.map(() =>
                patra.map(pt => "<th>" + esc(pt) + "</th>").join("")).join("") +
            (sBudgety ? "<th>Kč</th><th>Hodin</th><th>Vyfakturováno Kč</th><th>Zbývá Kč</th>" : "") + "</tr>" +
            "</thead><tbody>" +
            technologie.map(tech =>
                '<tr><th style="text-align:left">' + esc(tech) + "</th>" +
                budovy.map(b => patra.map(pt => bunka(b, tech, pt)).join("")).join("") +
                budgetBunky(tech) +
                "</tr>").join("") +
            "</tbody></table></div>";
    };

    /**
     * Sazba pro zápis: platí ta, kterou má člověk v Nastavení — a když má
     * projekt nastavenou vlastní sazbu pro toho člověka, vyhrává ta.
     * Dřív se brala jen obecná a sazby na projektu (Správa → Rozpočet)
     * nikdo nepoužil (Michal 2. 9. 2026).
     */
    V.sazbaProZapis = (uid, zakazka) => {
        if (!uid) return 0;
        const proj = ((window.KB.rozpocty || {})[zakazka] || {}).sazby || {};
        return Number(proj[uid]) || Number((window.KB.sazby || {})[uid]) || 0;
    };

    V.rozpocet = (zakazka) => {
        const r = (window.KB.rozpocty || {})[zakazka] || {};
        return { kc: Number(r.kc) || 0, hodiny: Number(r.hodiny) || 0 };
    };

    /**
     * Čerpání rozpočtu. Barva se řídí tím, jak blízko je dno:
     * do 75 % zeleně, do 100 % oranžově, přes 100 % červeně.
     */
    V.cerpani = (spotrebovano, rozpocet) => {
        if (!rozpocet) return null;
        const pct = spotrebovano / rozpocet * 100;
        return {
            pct: pct,
            sirka: Math.min(100, Math.max(1, Math.round(pct))),
            zbyva: rozpocet - spotrebovano,
            barva: pct > 100 ? "#b91c1c" : pct > 75 ? "#b45309" : "#16794a"
        };
    };

    /* Zápis může mít až tři technologie – kdo na jednom patře kreslí
       kanalizaci a vodu zároveň, nemá to psát na dva výkazy. V databázi
       leží spojené do „KAN, VOD, SLB" (tak to jde i do Tabulek Google);
       kde se s nimi pracuje po jedné, se rozdělí tímhle. */
    V.techCasti = (hodnota) => String(hodnota || "").split(",")
        .map(kus => kus.trim()).filter(Boolean);

    const techPopis = (zkratka) => {
        const t = V.technologie().find(x => x.zkratka === zkratka);
        // u zkratky bez celého názvu nemá smysl psát „SLN – "
        return t && t.nazev ? t.zkratka + " – " + t.nazev : (zkratka || "");
    };

    V.techLabel = (hodnota) => V.techCasti(hodnota).map(techPopis).join(" · ") ||
        String(hodnota || "");

    /* ----------------------------------------------- patra a podíly ----

       Od 4. 9. 2026 se stejně jako technologie dělí i PATRA: kdo za den
       obejde dvě patra, nemá to psát na dva výkazy (přání Michala).
       Ukládá se to stejně – spojené do „1PP, 2PP“ – a k tomu podíly
       práce v procentech jako text „50,50“.

       Proč procenta a ne hodiny: nikdo si nepamatuje, kolik minut strávil
       na kterém patře. Odhad po desítkách se dá vyklikat a sečte se do sta. */

    /** Jedna hodnota, nebo víc spojených čárkou – stejně pro patra i technologie. */
    V.casti = V.techCasti;

    /** Podíly se klikají po desetinách – jemnější dělení je stejně odhad. */
    V.PODIL_KROK = 10;

    /** Rozdělí `co` procent na `kolik` dílů po desítkách; zbytek dostanou první. */
    function rozdel(co, kolik) {
        if (kolik <= 0) return [];
        const kroku = Math.max(0, Math.round(co / V.PODIL_KROK));
        const zaklad = Math.floor(kroku / kolik);
        const navic = kroku - zaklad * kolik;
        const out = [];
        for (let j = 0; j < kolik; j++) {
            out.push((zaklad + (j < navic ? 1 : 0)) * V.PODIL_KROK);
        }
        return out;
    }

    /** Rovným dílem: 1 → [100], 2 → [50, 50], 3 → [40, 30, 30]. */
    V.podilyRovnym = (pocet) => rozdel(100, pocet);

    /**
     * Podíly ze zápisu. Když uložený text nesedí na počet vybraných pater
     * (někdo patro přidal nebo ubral) nebo se nesečte do sta, platí rovný díl –
     * lepší rovnoměrně než podle nastavení pro jiný počet pater.
     */
    V.podily = (text, pocet) => {
        if (!pocet || pocet < 1) return [];
        const kusy = String(text || "").split(",")
            .map(x => Math.round(Number(String(x).trim())))
            .filter(x => Number.isFinite(x));
        if (kusy.length !== pocet) return V.podilyRovnym(pocet);
        if (kusy.some(x => x <= 0)) return V.podilyRovnym(pocet);
        if (kusy.reduce((a, b) => a + b, 0) !== 100) return V.podilyRovnym(pocet);
        return kusy;
    };

    /**
     * Klik na podíl: tomu vyklikanému přidá deset procent, zbytek si rozdělí
     * ostatní rovným dílem. Za maximem se začíná znovu od deseti – jedním
     * tlačítkem se tak dá projet celá škála tam i zpět.
     *
     * `zamky` je pole true/false. Zamčená hodnota se nesahá a dělí se jen
     * to, co po ní zbylo. Bez zámků se u tří technologií nedalo nastavit
     * 60/30/10: klik na druhou hodnotu srovnal tu první zpátky na rovný díl
     * (Michal 4. 9. 2026).
     */
    V.podilKlik = (podily, index, zamky) => {
        const n = podily.length;
        if (n < 2) return podily.slice();
        const zamceno = (j) => !!(zamky && zamky[j]);
        if (zamceno(index)) return podily.slice();

        const volne = [];
        for (let j = 0; j < n; j++) if (j !== index && !zamceno(j)) volne.push(j);
        // všechno ostatní je zamčené – není z čeho ubrat, hodnota je daná
        if (!volne.length) return podily.slice();

        let bazen = 100;
        for (let j = 0; j < n; j++) if (zamceno(j)) bazen -= podily[j];
        const min = V.PODIL_KROK;
        const max = bazen - min * volne.length;
        if (max < min) return podily.slice();

        let v = podily[index] + V.PODIL_KROK;
        if (v > max) v = min;
        const zbylo = rozdel(bazen - v, volne.length);
        const out = podily.slice();
        out[index] = v;
        volne.forEach((j, k) => { out[j] = zbylo[k]; });
        return out;
    };

    /**
     * Rozpad jednoho zápisu na buňky budova × patro × technologie.
     * `dil` je zlomek částky: podíl patra × podíl technologie. Dvě patra
     * a dvě technologie po padesáti procentech tak dají čtyři čtvrtiny.
     *
     * Co zápis nemá vlastní, doplní úkol – starší zápisy patro ani
     * technologii nenesou a bez toho by z matice plnění vypadly.
     */
    V.rozpadZapisu = (z, ukol) => {
        const patra = V.casti(z.patro);
        const techy = V.casti(z.technologie);
        const p = patra.length ? patra : [(ukol && ukol.patro) || ""];
        const t = techy.length ? techy : [(ukol && ukol.technologie) || ""];
        const pp = V.podily(z.podilPatra, p.length);
        const tp = V.podily(z.podilTech, t.length);
        const budova = z.budova || (ukol && ukol.budova) || "";
        const out = [];
        p.forEach((patro, i) => t.forEach((tech, j) => {
            out.push({ budova: budova, patro: patro, tech: tech,
                       dil: (pp[i] / 100) * (tp[j] / 100) });
        }));
        return out;
    };

    /**
     * Peníze a hodiny z výkazů projektu rozpuštěné do pater a technologií.
     * Používá to matice plnění i přehled pater – do 4. 9. 2026 se četly
     * jen přes vazbu na úkol, takže zápis na dvě patra spadl celý na jedno.
     */
    V.rozpadProjektu = (nazev) => {
        const ukoly = new Map();
        (window.KB.ukoly || []).forEach(u => ukoly.set(u.id, u));
        const bunky = new Map(), patra = new Map(), techy = new Map();
        let celkem = 0, hodinCelkem = 0;

        const pricti = (mapa, klic, castka, hodiny) => {
            const o = mapa.get(klic) || { castka: 0, hodiny: 0 };
            o.castka += castka; o.hodiny += hodiny;
            mapa.set(klic, o);
        };

        (window.KB.vykazy || []).forEach(z => {
            if (z.absence === true) return;
            if ((z.zakazka || "") !== nazev && (z.projekt || "") !== nazev) return;
            const castka = Number(z.castka) || 0;
            const hodiny = Number(z.hodiny) || 0;
            celkem += castka; hodinCelkem += hodiny;
            V.rozpadZapisu(z, ukoly.get(z.ukolId)).forEach(d => {
                pricti(bunky, d.budova + "|" + d.patro + "|" + d.tech,
                       castka * d.dil, hodiny * d.dil);
                pricti(patra, d.budova + "|" + d.patro, castka * d.dil, hodiny * d.dil);
                pricti(techy, d.tech, castka * d.dil, hodiny * d.dil);
            });
        });

        const cti = (mapa, klic) => mapa.get(klic) || { castka: 0, hodiny: 0 };
        return {
            bunka: (budova, patro, tech) => cti(bunky, budova + "|" + patro + "|" + tech),
            patro: (budova, patro) => cti(patra, budova + "|" + patro),
            tech: (tech) => cti(techy, tech),
            celkem: celkem,
            hodiny: hodinCelkem
        };
    };

    /** Volby do roletky; `prazdne` je popisek nevyplněné položky. */
    V.options = (hodnoty, vybrano, prazdne) =>
        (prazdne ? '<option value="">' + esc(prazdne) + "</option>" : "") +
        (hodnoty || []).map(h => {
            const value = typeof h === "string" ? h : h.value;
            const label = typeof h === "string" ? h : h.label;
            return '<option value="' + esc(value) + '"' +
                (value === vybrano ? " selected" : "") + ">" + esc(label) + "</option>";
        }).join("");

    /* Barvy pruhů. Přiřazují se podle pořadí v číselníku, ne podle názvu –
       přejmenovaná činnost tak nezmění barvu celého grafu. */
    /* Šest barev, ne víc. Prošly kontrolou na barvosleposti (protanopie,
       deuteranopie, tritanopie), na kontrast vůči bílému podkladu i na to,
       aby žádná nečetla jako šedá. Sedmou a osmou už se to samé udělat
       nepodařilo – proto se zbytek slévá do „Ostatní" v šedé.
       Pořadí je závazné: zelená nesmí sousedit s červenou ani oranžovou,
       to je pro barvoslepé ta nejhorší dvojice. */
    const BARVY = ["#c8102e", "#0f62c4", "#0d7d3f", "#8a2be2", "#c26a00", "#b3006b"];
    const SEDA = "#8b9298";

    V.SEDA = SEDA;
    V.POCET_BAREV = BARVY.length;
    /** Nezařazené a „Ostatní" jsou vždycky šedé, ať jsou na první pohled vidět. */
    V.barva = (index, nazev) => {
        if (nazev && /nerozřazeno|neurčeno|ostatní|nezařazeno/i.test(nazev)) return SEDA;
        return index >= 0 && index < BARVY.length ? BARVY[index] : SEDA;
    };

    /* ------------------------------------------------------------ období */

    /** Hranice období pro filtr: "mesic" | "minuly" | "rok" | "vse". */
    V.obdobi = (druh) => {
        const d = new Date();
        const iso = (rok, mesic, den) => rok + "-" + String(mesic).padStart(2, "0") +
            "-" + String(den).padStart(2, "0");

        if (druh === "vse") return { od: "", do: "" };
        if (druh === "rok") {
            return { od: iso(d.getFullYear(), 1, 1), do: iso(d.getFullYear(), 12, 31) };
        }
        // nultý den následujícího měsíce = poslední den toho hledaného
        const posun = druh === "minuly" ? -1 : 0;
        const zac = new Date(d.getFullYear(), d.getMonth() + posun, 1);
        const kon = new Date(d.getFullYear(), d.getMonth() + posun + 1, 0);
        return {
            od: iso(zac.getFullYear(), zac.getMonth() + 1, 1),
            do: iso(kon.getFullYear(), kon.getMonth() + 1, kon.getDate())
        };
    };

    /* ------------------------------------------------------------- výběr */

    /** Filtr: { od, do, uid, zakazka, firma, cinnost, tech, text } */
    V.vyber = (zaznamy, filtr) => (zaznamy || []).filter(z => {
        if (filtr.od && (z.datum || "") < filtr.od) return false;
        if (filtr.do && (z.datum || "") > filtr.do) return false;
        if (filtr.uid && z.uid !== filtr.uid) return false;
        if (filtr.zakazka && z.zakazka !== filtr.zakazka) return false;
        if (filtr.projekt && z.projekt !== filtr.projekt) return false;
        if (filtr.firma && z.firma !== filtr.firma) return false;
        if (filtr.cinnost && z.cinnost !== filtr.cinnost) return false;
        // zápis se dvěma technologiemi musí projít filtrem na kteroukoliv z nich
        if (filtr.tech && V.techCasti(z.technologie).indexOf(filtr.tech) === -1) return false;
        // výkazy jednoho úkolu – „Zobrazit výkazy" z Úkolů i ze Správy
        if (filtr.ukolId && z.ukolId !== filtr.ukolId) return false;

        if (filtr.text) {
            const kupka = window.KBUI.fold([z.nazev, z.zakazka, z.projekt, z.firma,
                V.osobaText(z), z.poznamka].join(" "));
            if (!window.KBUI.fold(filtr.text).split(/\s+/).every(w => kupka.includes(w))) return false;
        }
        return true;
    });

    /* ------------------------------------------------------------ součty */

    V.soucty = (zaznamy) => {
        /* Dovolená, nemoc a školení jsou evidence, ne odpracovaný čas –
           ze součtů hodin, peněz i dní se vynechávají (rozhodnutí Michala). */
        zaznamy = (zaznamy || []).filter(z => !z.absence);
        const sec = (klic) => zaznamy.reduce((s, z) => s + (Number(z[klic]) || 0), 0);
        const hodiny = sec("hodiny");
        const castka = sec("castka");
        /* Průměrná sazba se počítá jen z odpracované práce – paušály za oběd
           a kilometry by ji nafoukly a číslo by přestalo něco znamenat.
           U starších zápisů bez `castkaPrace` bereme celou částku. */
        const prace = zaznamy.reduce((s, z) => s +
            (z.castkaPrace === undefined ? (Number(z.castka) || 0) : (Number(z.castkaPrace) || 0)), 0);

        return {
            pocet: zaznamy.length,
            hodiny: hodiny,
            castka: castka,
            prace: prace,
            obedKc: sec("obedKc"),
            dopravaKc: sec("dopravaKc"),
            km: sec("km"),
            // jeden den jednoho člověka = jeden odpracovaný den, i když má víc položek
            dny: new Set(zaznamy.map(z => z.datum + "|" + z.uid)).size,
            sazba: hodiny ? prace / hodiny : 0
        };
    };

    /**
     * Sečte zápisy podle jednoho pole (cinnost, technologie, zakazka, firma, uid).
     * `poradi` drží barvy stabilní – je to seznam hodnot z číselníku.
     * Nevyplněné se schovají pod „Nezařazeno", ať se peníze nikde neztratí.
     */
    V.podle = (zaznamy, klic, poradi) => {
        const mapa = new Map();
        zaznamy.forEach(z => {
            const hodnota = (z[klic] || "").trim() || "Nezařazeno";
            if (!mapa.has(hodnota)) mapa.set(hodnota, { klic: hodnota, hodiny: 0, castka: 0, pocet: 0 });
            const radek = mapa.get(hodnota);
            radek.hodiny += Number(z.hodiny) || 0;
            radek.castka += Number(z.castka) || 0;
            radek.pocet += 1;
        });

        const index = (hodnota) => {
            const i = (poradi || []).indexOf(hodnota);
            return i === -1 ? -1 : i;
        };
        return Array.from(mapa.values())
            .map(radek => Object.assign(radek, { barva: V.barva(index(radek.klic), radek.klic) }))
            .sort((a, b) => b.castka - a.castka || b.hodiny - a.hodiny);
    };

    /**
     * Nejsilnějších N položek zvlášť, zbytek do „Ostatní".
     * Barev máme šest a devátá se vymyslet nedá tak, aby ji od ostatních
     * rozeznal i barvoslepý – proto se chvost slévá, ne že by se dobarvoval.
     */
    V.sesypZbytek = (polozky, kolik) => {
        const limit = kolik || V.POCET_BAREV;
        if (polozky.length <= limit + 1) return polozky;

        const hlavni = polozky.slice(0, limit).map((p, i) =>
            Object.assign({}, p, { barva: V.barva(i, p.klic) }));
        const zbytek = polozky.slice(limit);
        return hlavni.concat([{
            klic: "Ostatní (" + zbytek.length + ")",
            hodiny: zbytek.reduce((s, p) => s + p.hodiny, 0),
            castka: zbytek.reduce((s, p) => s + p.castka, 0),
            pocet: zbytek.reduce((s, p) => s + p.pocet, 0),
            barva: V.SEDA
        }]);
    };

    /* --------------------------------------------------------- vykreslení */

    V.dlazdice = (label, value, note, money) =>
        '<div class="card vyktile' + (money ? " vyktile--money" : "") + '">' +
            '<div class="vyktile__label">' + esc(label) + "</div>" +
            '<div class="vyktile__value">' + value + "</div>" +
            (note ? '<div class="vyktile__note">' + esc(note) + "</div>" : "") +
        "</div>";

    /**
     * Vodorovné pruhy. `metrika` je "kc" nebo "hod" – pruh se měří vždycky
     * proti největší položce výběru, ne proti součtu, aby byly vidět i drobné.
     */
    V.pruhy = (polozky, metrika, popisek) => {
        if (!polozky.length) return '<div class="tiny muted">Žádná data.</div>';

        const hodnota = (p) => metrika === "hod" ? p.hodiny : p.castka;
        const max = Math.max.apply(null, polozky.map(hodnota)) || 1;

        return polozky.map(p => {
            const sirka = Math.max(1, Math.round(hodnota(p) / max * 100));
            const hlavni = metrika === "hod" ? V.hod(p.hodiny) : V.kc(p.castka);
            const vedlejsi = metrika === "hod" ? V.kc(p.castka) : V.hod(p.hodiny);
            const nazev = popisek ? popisek(p.klic) : p.klic;

            /* Seřazený žebříček je o velikosti, ne o totožnosti – každý pruh má
               vlastní popisek, takže barva nic nerozlišuje a všechny jsou stejné.
               Vlastní barvu si pruh nese jen tam, kde něco znamená (čerpání
               rozpočtu zeleně/oranžově/červeně). */
            return '<div class="vykbar">' +
                '<div class="vykbar__name" title="' + esc(nazev) + '">' + esc(nazev) + "</div>" +
                '<div class="vykbar__track">' +
                    '<div class="vykbar__fill" style="width:' + sirka + "%" +
                        (p.vlastniBarva ? ";background:" + p.barva : "") + '"></div>' +
                "</div>" +
                '<div class="vykbar__val">' + hlavni + " <span>· " + vedlejsi + "</span></div>" +
            "</div>";
        }).join("");
    };

    /**
     * Kruhový graf. Kreslí se čárkovaným obvodem kružnice – žádné počítání
     * oblouků a žádná knihovna. Mezi výsečemi je mezera v barvě podkladu,
     * aby na sebe dvě barvy nikde přímo nenavazovaly.
     *
     * Legenda je vždycky – barva sama o sobě nesmí být jediné vodítko,
     * protože ji každý nevidí stejně.
     */
    V.kolac = (polozky, metrika, popisek) => {
        const hodnota = (p) => metrika === "hod" ? p.hodiny : p.castka;
        const celek = polozky.reduce((s, p) => s + hodnota(p), 0);
        if (!celek) return '<div class="tiny muted">Žádná data.</div>';

        const R = 68, STRED = 90, OBVOD = 2 * Math.PI * R, MEZERA = 2;
        let posun = 0;

        const vysece = polozky.map(p => {
            const delka = Math.max(0, hodnota(p) / celek * OBVOD - MEZERA);
            const kruh = '<circle cx="' + STRED + '" cy="' + STRED + '" r="' + R + '" fill="none" ' +
                'stroke="' + p.barva + '" stroke-width="32" stroke-dasharray="' +
                delka.toFixed(2) + " " + (OBVOD - delka).toFixed(2) + '" stroke-dashoffset="' +
                (-posun).toFixed(2) + '"><title>' + esc(popisek ? popisek(p.klic) : p.klic) + ": " +
                (metrika === "hod" ? V.hod(p.hodiny) : V.kc(p.castka)) + "</title></circle>";
            posun += hodnota(p) / celek * OBVOD;
            return kruh;
        }).join("");

        const stred = metrika === "hod" ? V.hod(celek) : V.kc(celek);
        const legenda = polozky.map(p => {
            const nazev = popisek ? popisek(p.klic) : p.klic;
            return '<li class="bpleg__radek">' +
                '<span class="bpleg__tecka" style="background:' + p.barva + '"></span>' +
                '<span class="bpleg__nazev" title="' + esc(nazev) + '">' + esc(nazev) + "</span>" +
                '<span class="bpleg__cislo">' +
                    (metrika === "hod" ? V.hod(p.hodiny) : V.kc(p.castka)) + "</span>" +
                '<span class="bpleg__pct">' + Math.round(hodnota(p) / celek * 100) + " %</span>" +
            "</li>";
        }).join("");

        return '<div class="bpkolac">' +
            '<svg viewBox="0 0 180 180" class="bpsvg" role="img">' +
                '<g transform="rotate(-90 90 90)">' + vysece + "</g>" +
                '<text x="90" y="86" text-anchor="middle" class="bpsvg__cislo">' +
                    esc(stred.split(" ")[0]) + "</text>" +
                '<text x="90" y="102" text-anchor="middle" class="bpsvg__popis">' +
                    esc(stred.split(" ").slice(1).join(" ")) + "</text>" +
            "</svg>" +
            '<ul class="bpleg">' + legenda + "</ul>" +
        "</div>";
    };

    /* ----------------------------------------------------------------- CSV
       Pro český Excel: středník jako oddělovač, desetinná čárka a BOM na
       začátku. Bez BOM se rozsype diakritika, bez čárky čísla. */

    V.csv = (zaznamy) => {
        const bunka = (value) => {
            const text = String(value == null ? "" : value);
            return /[";\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        };
        const des = (value) => String(Number(value) || 0).replace(".", ",");

        const hlavicka = ["Datum", "Kdo", "Úkol", "Projekt", "Část", "Firma",
            "Druh vypracování", "Technologie", "Od", "Do", "Pauza (min)",
            "Hodin", "Sazba", "Za práci", "Oběd", "Km", "Cestovné", "Celkem", "Poznámka"];

        return "﻿" + [hlavicka.map(bunka).join(";")].concat(
            zaznamy.map(z => [
                z.datum, V.osobaText(z), z.nazev, z.zakazka, z.projekt || "", z.firma,
                z.cinnost, z.technologie, z.od, z.do, Number(z.pauza) || 0,
                des(z.hodiny), des(z.sazba),
                des(z.castkaPrace === undefined ? z.castka : z.castkaPrace),
                des(z.obedKc), Number(z.km) || 0, des(z.dopravaKc),
                des(z.castka), z.poznamka || ""
            ].map(bunka).join(";"))).join("\r\n");
    };

    /** Stáhne text jako soubor – prohlížeč to jinak neumí. */
    V.stahni = (text, nazevSouboru, typ) => {
        const odkaz = document.createElement("a");
        const url = URL.createObjectURL(new Blob([text], { type: typ || "text/csv;charset=utf-8" }));
        odkaz.href = url;
        odkaz.download = nazevSouboru;
        odkaz.click();
        URL.revokeObjectURL(url);
    };
})();
