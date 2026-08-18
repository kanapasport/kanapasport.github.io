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
    V.lide = () => (window.KB.users || []).filter(u => u.active !== false);
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
     * @param {Object} [techBudgety] – { TER: 1935, … }: celkové hodiny na
     *   technologii. Když jsou předané, přibude vpravo blok Budget /
     *   Ukrojeno / Zbývá – ukrojeno je součet budgetů úkolů té technologie.
     *   `klikaci` z Budgetu udělá editovatelné pole (data-techbud="TER").
     */
    V.maticePlneni = (ukoly, budgety, osy, klikaci, techBudgety) => {
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
                return klikaci
                    ? '<td><button type="button" class="mx__bunka mx__bunka--nic" data-mx="' + klic +
                        '" title="Založit úkol ' + esc(budova + " – " + tech + " – " + patro) + '">+</button></td>'
                    : '<td><span class="mx__bunka mx__bunka--nic">·</span></td>';
            }
            let vaha = 0, soucet = 0;
            moje.forEach(u => {
                const w = Number(((budgety || {})[u.id] || {}).budgetHodin) || 0;
                vaha += w; soucet += V.pctUkolu(u) * w;
            });
            const pct = vaha ? Math.round(soucet / vaha)
                : Math.round(moje.reduce((x, u) => x + V.pctUkolu(u), 0) / moje.length);
            const nazvy = moje.map(u => esc(u.nazev)).join(", ");
            return klikaci
                ? '<td><button type="button" class="mx__bunka mx__bunka--' + uroven(pct) +
                    '" data-mx="' + klic + '" title="' + nazvy +
                    ' – dalším kliknutím založíš další úkol">' + pct + "&nbsp;%</button></td>"
                : '<td><span class="mx__bunka mx__bunka--' + uroven(pct) + '" title="' + nazvy + '">' +
                    pct + "&nbsp;%</span></td>";
        };

        /* pravý blok: hodiny technologie, z nich ukrajují budgety úkolů */
        const ukrojeno = (tech) => ukoly
            .filter(u => u.technologie === tech)
            .reduce((sum, u) => sum + (Number(((budgety || {})[u.id] || {}).budgetHodin) || 0), 0);

        const cislo = (n) => (Math.round(n * 10) / 10).toLocaleString("cs-CZ");

        const budgetBunky = (tech) => {
            if (!sBudgety) return "";
            const celkem = Number(techBudgety[tech]) || 0;
            const ukr = ukrojeno(tech);
            const zbyva = celkem - ukr;
            return '<td class="mx__budget">' +
                (klikaci
                    ? '<input type="number" class="field" min="0" data-techbud="' + esc(tech) +
                        '" value="' + (celkem || "") + '">'
                    : (celkem ? cislo(celkem) : "–")) + "</td>" +
                '<td class="mx__budget">' + (ukr ? cislo(ukr) : "–") + "</td>" +
                '<td class="mx__budget' + (zbyva < 0 ? " mx__budget--minus" : "") + '">' +
                    (celkem || ukr ? cislo(zbyva) : "–") + "</td>";
        };

        return '<div class="mx-wrap"><table class="mx"><thead>' +
            "<tr><th></th>" + budovy.map(b =>
                '<th colspan="' + patra.length + '">' + esc(b) + "</th>").join("") +
            (sBudgety ? '<th colspan="3">Hodiny technologie</th>' : "") + "</tr>" +
            "<tr><th></th>" + budovy.map(() =>
                patra.map(pt => "<th>" + esc(pt) + "</th>").join("")).join("") +
            (sBudgety ? "<th>Budget</th><th>Ukrojeno</th><th>Zbývá</th>" : "") + "</tr>" +
            "</thead><tbody>" +
            technologie.map(tech =>
                '<tr><th style="text-align:left">' + esc(tech) + "</th>" +
                budovy.map(b => patra.map(pt => bunka(b, tech, pt)).join("")).join("") +
                budgetBunky(tech) +
                "</tr>").join("") +
            "</tbody></table></div>";
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

    V.techLabel = (zkratka) => {
        const t = V.technologie().find(x => x.zkratka === zkratka);
        return t ? t.zkratka + " – " + t.nazev : (zkratka || "");
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
        if (filtr.tech && z.technologie !== filtr.tech) return false;

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
