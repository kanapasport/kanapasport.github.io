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

    V.CASY = (() => {
        const out = [];
        for (let m = 0; m < 24 * 60; m += 15) {
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
    const BARVY = ["#c8102e", "#1f6f8b", "#b45309", "#16794a", "#6d28d9",
                   "#0f766e", "#a16207", "#9d174d", "#374151"];
    V.barva = (index) => BARVY[((index % BARVY.length) + BARVY.length) % BARVY.length];

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
            return i === -1 ? (poradi || []).length : i;
        };
        return Array.from(mapa.values())
            .map(radek => Object.assign(radek, { barva: V.barva(index(radek.klic)) }))
            .sort((a, b) => b.castka - a.castka || b.hodiny - a.hodiny);
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

            return '<div class="vykbar">' +
                '<div class="vykbar__name" title="' + esc(nazev) + '">' + esc(nazev) + "</div>" +
                '<div class="vykbar__track">' +
                    '<div class="vykbar__fill" style="width:' + sirka + "%;background:" + p.barva + '"></div>' +
                "</div>" +
                '<div class="vykbar__val">' + hlavni + " <span>· " + vedlejsi + "</span></div>" +
            "</div>";
        }).join("");
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

        const hlavicka = ["Datum", "Kdo", "Úkol", "Zakázka", "Projekt", "Firma",
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
