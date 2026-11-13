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
            /* Kdo momentálně nepracuje, padá na konec každé nabídky. Nemizí
               – přihlásit se může a ve starých zápisech zůstává – jen nikomu
               neleze pod ruku (Michal 16. 9. 2026). */
            return (a.nepracuje === true ? 1 : 0) - (b.nepracuje === true ? 1 : 0) ||
                (pa === undefined ? 9 : pa) - (pb === undefined ? 9 : pb) ||
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

    /* Režie: placený čas bez zakázky. V zápisu se příznak neukládá (počítá
       se z názvu při psaní), takže přehledy, které zápisy jen čtou, musí
       režii poznat podle jména – proto je seznam tady, ne jen ve formuláři
       (Michal 25. 9. 2026). */
    V.REZIE = ["Administrativa", "Porada", "Web"];
    V.jeRezie = (nazev) => V.REZIE.indexOf(String(nazev || "").trim()) !== -1;

    /* Absence – stejný důvod jako u režie: v zápisu je sice příznak
       `absence`, ale přehledy pracují i s holými názvy zakázek.
       „Neplacené volno" přibylo 2. 11. 2026 (Michal) – viz „absence proti
       fondu" níž, čím se liší od Volna. */
    V.ABSENCE = ["Dovolená", "Volno", "Neplacené volno", "Nemoc", "Doktor", "Školení"];
    V.jeAbsence = (nazev) => V.ABSENCE.indexOf(String(nazev || "").trim()) !== -1;

    /* --------------------------------- výpis pro mzdovou účetní ----
       Michal 3. 11. 2026 (Iris): majitelé jednou měsíčně posílají mzdové
       účetní, kdo ze ZAMĚSTNANCŮ (HPP) byl kdy pryč – přehled člověk × druh
       s výčtem dnů k tisku / PDF (stránka mzdy-vypis.html), žádné CSV.
         • jen typ „zamestnanec“ (chybějící typ = zaměstnanec, pokud role
           není student) – OSVČ, studenti, DPP/DPČ a služební účty ne,
         • jen pracovní dny (V.pracovniDnyIso) – absence na svátek nebo
           víkend nic nečerpá; home office ani dny bez zápisu se nevypisují,
         • souvislé pracovní dny (i přes víkend nebo svátek) se slučují:
           tři a víc do rozsahu „10.–12. 11.“, dva zůstanou „3., 4. 11.“,
         • částečný den (doktor na dvě hodiny) jde zvlášť a s hodinami,
         • dovolená, náhradní volno a neplacené volno bez potvrzení manažera
           (událost kalendáře `potvrzeno`, jako nástěnka) jdou do řádku
           „(nepotvrzeno)“; placené školení (`absencePlacena`) do řádku
           „Školení (placené)“.
       Bez peněz, sazeb a hodin práce. Čistá funkce bez KB a DOM – hlídá ji
       NASTROJE\web\testy\test_vypis_nepritomnosti.js. */

    /* Druh výkazu → typ události v kalendáři (stejné jako TYP_ABSENCE ve vykazy.html). */
    const MZDY_TYP_KALENDARE = { "Dovolená": "dovolena", "Volno": "volno", "Neplacené volno": "neplacene",
        "Nemoc": "nemoc", "Doktor": "doktor", "Školení": "skoleni" };
    /* Které druhy potvrzuje manažer – stejně jako nástěnka (POTVRZOVANE v index.html). */
    const MZDY_POTVRZUJE = { dovolena: true, volno: true, neplacene: true };
    /* Potvrzený je den, který leží v potvrzené události téhož člověka a druhu.
       Zamítnutá žádost (stav, který se chystá) nepotvrzuje nic. Sdílí výpis
       pro mzdovou i uzávěrka měsíce. */
    const denPotvrzen = (kalendar, uid, typ, datum) => (kalendar || []).some(k => k && k.uid === uid &&
        k.typ === typ && k.potvrzeno === true && k.stav !== "zamitnuto" && k.zamitnuto !== true &&
        String(k.od || "") <= datum && datum <= String(k.do || k.od || ""));
    const MZDY_VARIANTY = ["", "placene", "nepotvrzeno"];
    const MZDY_VARIANTA_TEXT = { placene: " (placené)", nepotvrzeno: " (nepotvrzeno)" };
    const MESICE_NAZEV = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec",
        "srpen", "září", "říjen", "listopad", "prosinec"];

    /** „2026-11“ → „listopad 2026“; nesmysl = "". */
    V.mesicText = (mesic) => {
        const m = /^(\d{4})-(\d{2})$/.exec(String(mesic || ""));
        const i = m ? Number(m[2]) - 1 : -1;
        return i >= 0 && i < 12 ? MESICE_NAZEV[i] + " " + m[1] : "";
    };

    /** Zaměstnanec na HPP? Chybějící typ = zaměstnanec, pokud role není student (jako UI.typUvazku). */
    V.jeZamestnanecHpp = (u) => !!u && (u.typ ? u.typ === "zamestnanec" : u.role !== "student");

    /**
     * Nepřítomnosti zaměstnanců za měsíc pro mzdovou účetní.
     * @param {Object[]} zaznamy  výkazy (KB.vykazy) – stačí uid, datum, zakazka, od, do,
     *                            hodiny / hodinyPevne, celyden, absencePlacena
     * @param {{mesic: string, lide: Object[], kalendar: Object[]}} volby
     *        mesic „RRRR-MM“, lide = KB.users, kalendar = KB.kalendar (potvrzení)
     * @returns {{mesic, nazev, od, do, lide: {uid, jmeno, radky, celkemDni, celkemHodin, celkemText}[],
     *            bez: {uid, jmeno}[]}}
     *          řádek: { druh, varianta (""|placene|nepotvrzeno), popisek, castecny, dny, pocetDni,
     *                   hodiny, zbytek, text: "Dovolená: 3., 4., 7. 11. (3 dny)" }
     */
    V.vypisNepritomnosti = (zaznamy, volby) => {
        const o = volby || {};
        const mesic = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(o.mesic || "")) ? String(o.mesic) : "";
        const vysledek = { mesic: mesic, nazev: V.mesicText(mesic), od: "", do: "", lide: [], bez: [] };
        if (!mesic) return vysledek;
        const posledni = new Date(Number(mesic.slice(0, 4)), Number(mesic.slice(5, 7)), 0).getDate();
        vysledek.od = mesic + "-01";
        vysledek.do = mesic + "-" + String(posledni).padStart(2, "0");

        // pořadí pracovního dne v měsíci – sousední pracovní dny jdou do jedné řady i přes víkend
        const poradi = {};
        V.pracovniDnyIso(vysledek.od, vysledek.do).forEach((d, i) => { poradi[d] = i; });

        const zamestnanci = new Map();
        (o.lide || []).forEach(u => { if (u && u.id && V.jeZamestnanecHpp(u)) zamestnanci.set(u.id, u); });
        const kalendar = (o.kalendar || []).filter(k => k && zamestnanci.has(k.uid));
        const potvrzeny = (uid, typ, datum) => denPotvrzen(kalendar, uid, typ, datum);

        // uid → (druh|varianta) → { druh, varianta, cele: Set(iso), castecne: { iso: hodiny } }
        const sber = new Map();
        (zaznamy || []).forEach(z => {
            if (!z || !zamestnanci.has(z.uid)) return;
            const datum = String(z.datum || "");
            if (!(datum in poradi)) return;                    // mimo měsíc, víkend, svátek
            const druh = String(z.zakazka || "").trim();
            const typ = MZDY_TYP_KALENDARE[druh];
            if (!typ) return;                                  // práce, home office, režie
            const varianta = druh === "Školení" ? (z.absencePlacena === true ? "placene" : "")
                : (MZDY_POTVRZUJE[typ] && !potvrzeny(z.uid, typ, datum) ? "nepotvrzeno" : "");
            const h = Number(z.hodiny) || Number(z.hodinyPevne) || 0;
            const cely = z.celyden === true || (z.od === "00:00" && z.do === "23:59") || !(h > 0) || h >= 8;
            if (!sber.has(z.uid)) sber.set(z.uid, new Map());
            const radky = sber.get(z.uid);
            const klic = druh + "|" + varianta;
            if (!radky.has(klic)) radky.set(klic, { druh: druh, varianta: varianta, cele: new Set(), castecne: {} });
            const r = radky.get(klic);
            if (cely) r.cele.add(datum);
            else r.castecne[datum] = (r.castecne[datum] || 0) + h;
        });

        const cisloDne = (iso) => Number(iso.slice(8, 10)) + ".";
        const denMesic = (iso) => cisloDne(iso) + " " + Number(iso.slice(5, 7)) + ".";
        /* „3., 4., 7. 11.“ – měsíc jednou na konci; tři a víc sousedních
           pracovních dnů jako rozsah „10.–12. 11.“. */
        const dnyText = (dny) => {
            const rady = [];
            dny.forEach(d => {
                const r = rady[rady.length - 1];
                if (r && poradi[d] === poradi[r[r.length - 1]] + 1) r.push(d);
                else rady.push([d]);
            });
            const kusy = [];
            rady.forEach(r => {
                if (r.length >= 3) kusy.push(cisloDne(r[0]) + "–" + cisloDne(r[r.length - 1]));
                else r.forEach(d => kusy.push(cisloDne(d)));
            });
            return kusy.join(", ") + " " + Number(dny[0].slice(5, 7)) + ".";
        };
        const tvaryDne = ["den", "dny", "dní"];

        zamestnanci.forEach((u, uid) => {
            const jmeno = V.jmeno(u);
            const skupiny = Array.from((sber.get(uid) || new Map()).values()).sort((a, b) =>
                V.ABSENCE.indexOf(a.druh) - V.ABSENCE.indexOf(b.druh) ||
                MZDY_VARIANTY.indexOf(a.varianta) - MZDY_VARIANTY.indexOf(b.varianta));
            if (!skupiny.length) {
                // kdo v seznamu už není nebo momentálně nepracuje, do věty „bez nepřítomnosti“ nepatří
                if (u.active !== false && u.nepracuje !== true) vysledek.bez.push({ uid: uid, jmeno: jmeno });
                return;
            }
            const radky = [];
            const celeDny = new Set();
            let celkemHodin = 0;
            skupiny.forEach(s => {
                const popisek = V.nazevAbsence(s.druh) + (MZDY_VARIANTA_TEXT[s.varianta] || "");
                const cele = Array.from(s.cele).sort();
                if (cele.length) {
                    cele.forEach(d => celeDny.add(d));
                    const zbytek = dnyText(cele) + " (" + V.pocet(cele.length, tvaryDne) + ")";
                    radky.push({ druh: s.druh, varianta: s.varianta, popisek: popisek, castecny: false,
                        dny: cele, pocetDni: cele.length, hodiny: 0, zbytek: zbytek, text: popisek + ": " + zbytek });
                }
                // částečný den, který má tentýž druh i celý, se nepočítá dvakrát
                const castecne = Object.keys(s.castecne).filter(d => !s.cele.has(d)).sort();
                if (castecne.length) {
                    const hodiny = castecne.reduce((sum, d) => sum + s.castecne[d], 0);
                    celkemHodin += hodiny;
                    const zbytek = castecne.map(d => denMesic(d) + " (" + V.hod(s.castecne[d]) + ")").join(", ") +
                        (castecne.length > 1 ? ", celkem " + V.hod(hodiny) : "");
                    radky.push({ druh: s.druh, varianta: s.varianta, popisek: popisek, castecny: true,
                        dny: castecne, pocetDni: 0, hodiny: hodiny, zbytek: zbytek, text: popisek + ": " + zbytek });
                }
            });
            const casti = [];
            if (celeDny.size) casti.push(V.pocet(celeDny.size, tvaryDne));
            if (celkemHodin) casti.push(V.hod(celkemHodin));
            vysledek.lide.push({ uid: uid, jmeno: jmeno, radky: radky, celkemDni: celeDny.size,
                celkemHodin: celkemHodin, celkemText: "Celkem " + casti.join(" + ") });
        });

        const podleJmena = (a, b) => {
            const ua = zamestnanci.get(a.uid), ub = zamestnanci.get(b.uid);
            return (ua.last || "").localeCompare(ub.last || "", "cs") ||
                (ua.first || "").localeCompare(ub.first || "", "cs") || a.jmeno.localeCompare(b.jmeno, "cs");
        };
        vysledek.lide.sort(podleJmena);
        vysledek.bez.sort(podleJmena);
        return vysledek;
    };

    /* ----------------------------------------------- duplicity firem ----
       Po importu adresáře z Pohody (19. 10. 2026) se ukázalo, jak snadno
       je jedna firma v číselníku dvakrát: jednou „X, s.r.o.", podruhé
       „X s. r. o.", u lidí obrácené pořadí jména a příjmení. Dvě firmy
       jsou proto nejspíš jedna, když mají
         • stejné IČO – porovnávají se jen číslice („CZ 012 345 67" je
           totéž co „01234567") a bez úvodních nul (staré IČO se psalo
           bez nich),
         • stejný název po očištění – bez diakritiky, mezer, interpunkce,
           velikosti písmen a právní formy na konci (s.r.o., spol. s r.o.,
           a.s., v.o.s., k.s., z.s., z.ú., o.p.s., s.p., a spol.); platí
           i stejná slova v jiném pořadí.
       Funkce jsou čisté (bez KB a DOM), hlídá je
       NASTROJE\web\testy\test_firmy_duplicity.js. Slučovat firmy web
       neumí – na název je navázaný `firmaMap`, projekty i výkazy. */

    /* Právní formy jako slova po rozsekání názvu. Odebírají se jen z konce
       a nikdy celý název – „Atlas" ani „AS" o nic nepřijdou. Delší tvary
       první, ať „spol s r o" nezůstane jako „spol". */
    const PRAVNI_FORMY = [
        "spolecnost s rucenim omezenym", "verejna obchodni spolecnost",
        "komanditni spolecnost", "akciova spolecnost",
        "spol s r o", "spol s ro", "spol sro", "a spol",
        "s r o", "s ro", "sr o", "sro", "spol",
        "o p s", "ops", "v o s", "vos",
        "a s", "as", "k s", "z s", "z u", "s p"
    ].map(f => f.split(" "));

    /** IČO jen z číslic a bez úvodních nul; "" = žádné (prázdné se s ničím neshoduje). */
    V.klicIco = (ico) => String(ico == null ? "" : ico).replace(/\D+/g, "").replace(/^0+/, "");

    /** Slova názvu: malá písmena bez diakritiky, bez interpunkce a právní formy na konci. */
    V.slovaFirmy = (nazev) => {
        const slova = String(nazev == null ? "" : nazev).toLowerCase()
            .normalize("NFD").replace(/[̀-ͯ]/g, "")
            .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        let odebrano = true;
        while (odebrano) {
            odebrano = false;
            for (const forma of PRAVNI_FORMY) {
                const n = forma.length;
                const konec = slova.length - n;
                if (konec > 0 && forma.every((slovo, i) => slova[konec + i] === slovo)) {
                    slova.splice(konec, n);
                    odebrano = true;
                    break;
                }
            }
        }
        return slova;
    };

    /** Název po očištění, slova slitá dohromady („AB Stav" = „ABStav"); "" = nic k porovnání. */
    V.normalizujNazevFirmy = (nazev) => V.slovaFirmy(nazev).join("");

    /* Druhý klíč: slova seřazená („Novák Jan" = „Jan Novák"). Jednoslovný
       název ho nepotřebuje – stačí mu první klíč. */
    const klicSlov = (slova) => (slova.length > 1 ? slova.slice().sort().join(" ") : "");

    const klicFirmy = (nazev, detail) => {
        const slova = V.slovaFirmy(nazev);
        return { ico: V.klicIco(detail && detail.ico), nazev: slova.join(""), slova: klicSlov(slova) };
    };
    const podobnyNazev = (a, b) => (!!a.nazev && a.nazev === b.nazev) || (!!a.slova && a.slova === b.slova);

    /**
     * Které JINÉ firmy z číselníku vypadají jako ta ve formuláři.
     * @param {{nazev: string, ico: string}} firma  co je zrovna napsané
     * @param {string[]} firmy    názvy v číselníku (V.firmy())
     * @param {Object} detaily    název → { ico, … } (KB.firmyDetail)
     * @param {string} [krome]    vlastní název upravované firmy – sama se sebou se neporovnává
     * @returns {{ico: string[], nazev: string[]}} stejné IČO / podobný název
     *          (firma se stejným IČO už mezi podobnými názvy není)
     */
    V.podobneFirmy = (firma, firmy, detaily, krome) => {
        const ja = klicFirmy(firma && firma.nazev, { ico: firma && firma.ico });
        const vysledek = { ico: [], nazev: [] };
        const videno = new Set();
        (firmy || []).forEach(jmeno => {
            if (!jmeno || jmeno === krome || videno.has(jmeno)) return;
            videno.add(jmeno);
            const ona = klicFirmy(jmeno, (detaily || {})[jmeno]);
            if (ja.ico && ja.ico === ona.ico) vysledek.ico.push(jmeno);
            else if (podobnyNazev(ja, ona)) vysledek.nazev.push(jmeno);
        });
        return vysledek;
    };

    /**
     * Možné duplicity v celém číselníku – pro přehled manažera. Firmy
     * spojené stejným IČO nebo podobným názvem tvoří jednu skupinu, i přes
     * prostředníka (A ~ B názvem, B ~ C IČO → A, B, C).
     * @returns {Array<{firmy: string[], ico: string[], nazev: boolean}>}
     *   ico = IČO (jen číslice), která ve skupině mají aspoň dvě firmy;
     *   nazev = aspoň dvě firmy pojí podobný název.
     *   Skupiny se shodným IČO jsou první, pak podle abecedy.
     */
    V.skupinyDuplicitFirem = (firmy, detaily) => {
        const jmena = Array.from(new Set((firmy || []).filter(Boolean)));
        const klice = jmena.map(j => klicFirmy(j, (detaily || {})[j]));
        const rodic = jmena.map((_, i) => i);
        const koren = (i) => { while (rodic[i] !== i) { rodic[i] = rodic[rodic[i]]; i = rodic[i]; } return i; };
        const spoj = (a, b) => { rodic[koren(a)] = koren(b); };

        // po skupinách stejného klíče, ne každý s každým
        const podle = (vlastnost) => {
            const mapa = new Map();
            klice.forEach((k, i) => {
                if (!k[vlastnost]) return;
                if (!mapa.has(k[vlastnost])) mapa.set(k[vlastnost], []);
                mapa.get(k[vlastnost]).push(i);
            });
            return Array.from(mapa.entries()).filter(([, ii]) => ii.length > 1);
        };
        const icoSkupiny = podle("ico");
        const nazevSkupiny = podle("nazev").concat(podle("slova"));
        icoSkupiny.concat(nazevSkupiny).forEach(([, ii]) => ii.slice(1).forEach(i => spoj(ii[0], i)));

        const skupiny = new Map();
        const skupina = (i) => {
            const k = koren(i);
            if (!skupiny.has(k)) skupiny.set(k, { firmy: [], ico: [], nazev: false });
            return skupiny.get(k);
        };
        jmena.forEach((j, i) => skupina(i).firmy.push(j));      // samotáři vypadnou ve filtru níž
        icoSkupiny.forEach(([ico, ii]) => skupina(ii[0]).ico.push(ico));
        nazevSkupiny.forEach(([, ii]) => { skupina(ii[0]).nazev = true; });

        const abc = (a, b) => a.localeCompare(b, "cs");
        return Array.from(skupiny.values())
            .filter(s => s.firmy.length > 1)
            .map(s => ({ firmy: s.firmy.sort(abc), ico: s.ico.sort(), nazev: s.nazev }))
            .sort((a, b) => (b.ico.length ? 1 : 0) - (a.ico.length ? 1 : 0) || abc(a.firmy[0], b.firmy[0]));
    };

    /* ---------------------------------------------- zůstatky člověka ----
       Kolik zbývá dovolené a kolik je naběháno přesčasů. Počítá se od data,
       které je u člověka nastavené (Nastavení → Dovolená a přesčasy) –
       před ním web historii nemá a musí se do něj vstoupit s ručně zadanou
       hodnotou, jinak by všichni začali na nule.

       POZOR na význam toho data: je to den, od kterého má web hodiny toho
       člověka, NE začátek dovolenkového roku. Fond se z něj počítá den po
       dni, takže datum o půl roku zpátky znamená půl roku směn, ke kterým
       web nemá jediný zápis – a přesčas spadne o celý ten fond do mínusu
       (−1312 h a podobně, Michal 8. 10. 2026). Na dovolenou to vliv nemá:
       ta stojí na `cerpanoPred` a na zapsaných dnech. */

    /** Státní svátek podle ui.js; bez něj (test, samostatný skript) nic. */
    const svatek = (iso) => !!(window.KBUI && window.KBUI.svatek && window.KBUI.svatek(iso));

    /**
     * Pracovní dny od–do včetně jako ISO data – bez víkendů a státních
     * svátků. Jediné místo, které říká, co je pracovní den: fond, chybějící
     * zápisy i rozpad absence ve formuláři stojí na něm, ať se neliší.
     */
    V.pracovniDnyIso = (odIso, doIso) => {
        const dny = [];
        if (!odIso || !doIso || odIso > doIso) return dny;
        const d = new Date(odIso + "T00:00:00");
        const konec = new Date(doIso + "T00:00:00");
        let pojistka = 0;
        while (d <= konec && pojistka++ < 4000) {
            const den = d.getDay();
            if (den !== 0 && den !== 6) {
                const iso = d.getFullYear() + "-" +
                    String(d.getMonth() + 1).padStart(2, "0") + "-" +
                    String(d.getDate()).padStart(2, "0");
                if (!svatek(iso)) dny.push(iso);
            }
            d.setDate(d.getDate() + 1);
        }
        return dny;
    };

    /** Fond pracovních hodin mezi dvěma dny – bez víkendů a svátků. */
    V.fondHodin = (odIso, doIso) => V.pracovniDnyIso(odIso, doIso).length * 8;

    /* ------------------------------------------- absence proti fondu ----
       Michal 26. 10. 2026 rozhodl dvě výjimky z pravidla „absence se počítá
       jako odpracovaný čas":
         • Volno = NÁHRADNÍ volno. Člověk si vybírá naběhaný přesčas, takže
           se jeho hodiny k fondu nepřičítají – den volna je −8 h (čerpá
           přesčas). Zápis zůstává absence (0 Kč, potvrzuje manažer).
         • Neplacené volno (Michal 2. 11. 2026) výjimku NEMÁ: nese své hodiny
           k fondu jako dovolená, den je tedy pro přesčas neutrální (člověk
           nepracuje, nic se mu neodečítá ani nepřičítá). Od dovolené se liší
           jen tím, že nečerpá nárok (do nároku jde jen „Dovolená",
           V.zustatek); neplatí se jako každá absence, potvrzuje manažer.
         • Absence na státní svátek se nepočítá vůbec: fond je ten den nula,
           tak nemá co nahrazovat (0 h, dovolenou nečerpá). Zapsat už nejde
           (formulář svátky přeskočí, Rychlý zápis ji odmítne); staré zápisy
           hlásí manažerovi kontrola podezřelých zápisů.
       Jeden pomocník pro zůstatek, Vytížení i mini okno – ať to není
       třikrát a nerozejde se to. */

    /** Náhradní volno – jediná absence, která čerpá přesčas. */
    V.NAHRADNI_VOLNO = "Volno";
    /* Popisek pro lidi (Michal 9. 11. 2026): uložená hodnota zůstává „Volno“
       (zápisy, kalendář `volno`, Apps Script), jen se všude ukazuje s dovětkem,
       ať je jasné, že den volna ubírá z přesčasu. */
    /* Od 13. 11. 2026 jedna mapa pro celý web v ui.js (běží na každé stránce):
       V.nazevAbsence(zakázka) a V.nazevTypuUdalosti(typ kalendáře) ji jen vystavují. */
    V.NAZEV_ABSENCE = window.KBUI.NAZEV_ABSENCE || {};
    V.nazevAbsence = (x) => window.KBUI.nazevAbsence ? window.KBUI.nazevAbsence(x) : x;
    V.nazevTypuUdalosti = (typ, zaloha) => window.KBUI.nazevTypuUdalosti
        ? window.KBUI.nazevTypuUdalosti(typ, zaloha) : (zaloha === undefined ? typ : zaloha);

    /* Absence v mřížkách (Vytížení, měsíc ve Výkazech) ne jako „A", ale písmeno
       druhu + hodiny: „6" práce a vedle štítek „V 2" = volno (čerpání přesčasu)
       2 h; celý den bez práce jen písmeno s bublinou (Michal 13. 11. 2026).
       Jedno místo pro obě stránky. */
    V.PISMENO_ABSENCE = { "Volno": "V", "Doktor": "L", "Dovolená": "D", "Nemoc": "N",
        "Neplacené volno": "NV", "Školení": "Š" };
    V.pismenoAbsence = (druh) => V.PISMENO_ABSENCE[druh] || String(druh || "A").charAt(0).toUpperCase();
    /* Barva podle druhu (Michal 13. 11. 2026: jedna modrá nebyla vidět, volno
       a dovolená mají být různě, nemoc a spol. fialově). Tady jen přípona
       třídy – buňka `vt--abs vt--abs-<přípona>`, štítek `vt-a vt-a--<přípona>`,
       barvy jsou v app.css. Druh mimo slovník dostane „jine" (výchozí šeď),
       nikdy nespadne. */
    V.TRIDA_ABSENCE = { "Volno": "volno", "Dovolená": "dovolena", "Nemoc": "nemoc",
        "Doktor": "doktor", "Neplacené volno": "neplacene", "Školení": "skoleni" };
    V.tridaAbsence = (druh) => V.TRIDA_ABSENCE[String(druh || "").trim()] || "jine";
    /** Třídy buňky celodenní absence jednoho druhu: „vt--abs vt--abs-<přípona>" (buňka i vzorek v legendě). */
    V.tridyAbsence = (druh) => "vt--abs vt--abs-" + V.tridaAbsence(druh);
    /** Druh s nejvíc hodinami ze { druh: hodiny } (shoda → pořadí V.ABSENCE); prázdné → undefined. */
    V.hlavniAbsence = (druhy) => Object.keys(druhy || {}).sort((a, b) =>
        ((Number(druhy[b]) || 0) - (Number(druhy[a]) || 0)) || (V.ABSENCE.indexOf(a) - V.ABSENCE.indexOf(b)))[0];
    /** Třídy buňky dne s absencí a bez práce – barvu určí druh s nejvíc hodinami; Vytížení i měsíc ve Výkazech. */
    V.tridyBunkyAbsence = (druhy) => V.tridyAbsence(V.hlavniAbsence(druhy));
    /** HTML štítků absencí jednoho dne / týdne: druhy = { druh: hodiny }; sHodinami = vždy s hodinami. */
    V.stitkyAbsenceHtml = (druhy, sHodinami) => {
        const esc = (s) => (window.KBUI && window.KBUI.esc) ? window.KBUI.esc(s) : String(s);
        const txt = (h) => Number(h).toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
        return Object.keys(druhy || {}).sort((a, b) => V.ABSENCE.indexOf(a) - V.ABSENCE.indexOf(b)).map(druh => {
            const h = druhy[druh];
            const celeDny = h > 0 && h % 8 === 0;
            return '<span class="vt-a vt-a--' + V.tridaAbsence(druh) + '" title="' +
                esc(V.nazevAbsence(druh) + " " + txt(h) + " h") + '">' +
                esc(V.pismenoAbsence(druh) + (sHodinami || !celeDny ? " " + txt(h) : "")) + "</span>";
        }).join("");
    };
    /** Legenda druhů absence pod mřížkou: vzorek barvy s písmenem + název, pro každý druh z V.ABSENCE
     *  (písmeno V.pismenoAbsence, název V.nazevAbsence) – jedno místo, ať se Vytížení a Výkazy neliší. */
    V.legendaAbsenciHtml = () => {
        const esc = (s) => (window.KBUI && window.KBUI.esc) ? window.KBUI.esc(s) : String(s);
        const priklad = {};
        priklad[V.NAHRADNI_VOLNO] = 2;
        return "<span>Absence (celý den barva buňky, u hodin štítek, např. " +
            V.stitkyAbsenceHtml(priklad, true) + "):</span>" +
            V.ABSENCE.map(druh => '<span><span class="vt-leg-x ' + V.tridyAbsence(druh) + '">' +
                esc(V.pismenoAbsence(druh)) + "</span> " + esc(V.nazevAbsence(druh)) + "</span>").join("");
    };

    /* Kdo vůbec fond hodin má. OSVČ a student ne – přesčas ani dovolená
       se jim nikde neukazují a nic se u nich nenastavuje (Michal 26. 10.
       2026). Jedna odpověď pro dlaždice, Vytížení, mini okno, Nastavení
       i mřížku týdne. Bez člověka (seznam lidí ještě nedorazil) = ne. */
    V.maFond = (u) => !!u && !!window.KBUI && window.KBUI.typUvazku(u) === "zamestnanec";

    /** Vede se člověku přesčas? Zaměstnanec, kterému ho Nastavení nevypnulo. */
    V.prescasVeden = (uid) => V.maFond(V.clovek(uid)) &&
        (((window.KB.zustatky || {})[uid] || {}).bezPrescasu !== true);

    /** Je zápis absence (podle příznaku nebo názvu)? */
    const zapisAbsence = (z) => !!z && (z.absence === true || V.jeAbsence(z.zakazka));

    /** Absence zapsaná na státní svátek – do ničeho se nepočítá. */
    V.absenceNaSvatek = (z) => zapisAbsence(z) && svatek(z.datum);

    /**
     * Hodiny zápisu, které se počítají proti fondu (do přesčasu):
     * práce celá, absence taky – kromě náhradního volna (0, čerpá přesčas)
     * a absence na svátek (0, fond je nula).
     */
    V.hodinyKFondu = (z) => {
        if (!z) return 0;
        const h = Number(z.hodiny) || 0;
        if (!zapisAbsence(z)) return h;
        if (String(z.zakazka || "").trim() === V.NAHRADNI_VOLNO) return 0;
        if (svatek(z.datum)) return 0;
        return h;
    };

    /**
     * Pracovní dny člověka bez jakéhokoliv zápisu (práce ani absence) od
     * začátku počítání (`odIso` ze zůstatku, nebo zadané `od`, platí
     * pozdější z obou) do `doIso` včetně. Fond za ně běží dál (−8 h za den)
     * – pomocník jen říká, KTERÉ dny to jsou, ať je to vidět v dlaždici
     * Přesčas, v mřížce týdne, v mini okně i v uzávěrce (jedna logika).
     * Bez data začátku nic: web historii toho člověka nevede.
     * @returns {string[]} ISO data vzestupně
     */
    V.chybejiciDny = (uid, doIso, od) => {
        const z = (window.KB.zustatky || {})[uid] || {};
        const odZust = /^\d{4}-\d{2}-\d{2}$/.test(String(z.odIso || "")) ? z.odIso : "";
        const zacatek = od && od > odZust ? od : odZust;
        if (!uid || !zacatek || !doIso || zacatek > doIso) return [];
        const ma = {};
        (window.KB.vykazy || []).forEach(v => {
            if (v && v.uid === uid && v.datum) ma[v.datum] = true;
        });
        return V.pracovniDnyIso(zacatek, doIso).filter(d => !ma[d]);
    };

    /**
     * Krátké dny člověka – pracovní dny od–do včetně (bez víkendů a svátků),
     * kdy MÁ zápis, ale všech hodin dne (práce + absence včetně Volna) je
     * pod 8. Michal 12. 11. 2026: jedna logika pro hlídku krátkých dnů
     * (ui.js, Quick TO-DO) i uzávěrku měsíce. Začátek počítání (`odIso`
     * zůstatku) si hlídá volající. Čte window.KB.vykazy.
     * @returns {{datum: string, hodiny: number, chybi: number}[]} vzestupně
     */
    V.kratkeDnyCloveka = (uid, odIso, doIso) => {
        if (!uid || !odIso || !doIso || odIso > doIso) return [];
        const den = {};
        (window.KB.vykazy || []).forEach(z => {
            const d = z && z.uid === uid ? String(z.datum || "") : "";
            if (d && d >= odIso && d <= doIso) den[d] = (den[d] || 0) + (Number(z.hodiny) || 0);
        });
        return V.pracovniDnyIso(odIso, doIso).filter(iso => iso in den && na2(den[iso]) < 8)
            .map(iso => ({ datum: iso, hodiny: na2(den[iso]), chybi: na2(8 - den[iso]) }));
    };

    /* `doIso` (nepovinné): stav k tomu dni VČETNĚ – zápisy i fond do něj.
       Uzávěrka měsíce potřebuje přesčas k poslednímu dni měsíce, ne k dnešku
       (Michal 12. 11. 2026, Iris). Bez něj jako dřív. */
    V.zustatek = (uid, doIso) => {
        const z = (window.KB.zustatky || {})[uid] || {};
        const od = z.odIso || "";
        const k = /^\d{4}-\d{2}-\d{2}$/.test(String(doIso || "")) ? String(doIso) : "";
        const dnes = k || V.dnesISO();
        const nastaveno = !!od;

        const moje = (window.KB.vykazy || []).filter(v =>
            v.uid === uid && v.datum && v.datum >= od && v.datum <= dnes);

        /* Dovolená se ukládá rozepsaná po pracovních dnech, takže jeden
           zápis = jeden den. Volno, neplacené volno a nemoc se do nároku
           nepočítají.
           Dovolená omylem zapsaná na svátek nárok nečerpá. */
        const dovolenaDnu = moje.filter(v => v.zakazka === "Dovolená" && !V.absenceNaSvatek(v)).length;
        const narok = Number(z.narok) || 0;
        const cerpano = (Number(z.cerpanoPred) || 0) + dovolenaDnu;

        /* Přesčas stejně jako ve Vytížení: odpracováno + absence − fond.
           Absence se počítá jako odpracovaný čas, jinak by týden dovolené
           shodil přesčas o 40 hodin do mínusu.

           Počítají se její SKUTEČNÉ hodiny, ne plná směna. Celodenní
           absence jich stejně nese osm, ale u částečné (návštěva doktora
           ráno a odpoledne práce) se dřív připsalo osm hodin k tomu, co
           člověk ten den odpracoval – a z osmihodinového dne vyšel přesčas
           +6,5 h. Kolegyně si toho všimla 14. 10. 2026; stejně nafouklý
           přesčas měli i další dva kolegové.

           Které hodiny absence k fondu jdou, říká `V.hodinyKFondu`:
           náhradní volno a absence na svátek nesou nulu (viz výš). */
        const absence = moje.filter(v => v.absence === true);
        const absenceDnu = absence.length;
        const absenceHodin = absence.reduce((n, v) => n + V.hodinyKFondu(v), 0);
        const prace = moje.filter(v => v.absence !== true)
            .reduce((n, v) => n + (Number(v.hodiny) || 0), 0);
        /* Fond běží jen do včerejška – dnešní den se do fondu přičte až zítra,
           dnešní zápisy se ale počítají hned. Jinak každé ráno svítilo o 8 h
           méně, dokud člověk den nezapsal (Michal 9. 11. 2026). */
        const fond = V.fondHodin(od, k || V.posunIso(dnes, -1));
        const prescas = (Number(z.prescasPred) || 0) + prace + absenceHodin - fond;

        /* Kdo za celé období nemá ani jeden zápis, tomu přesčas spočítat
           nejde: vyšel by mínus ve výši celého fondu a vypadalo by to, že
           firmě dluží půl roku. Takový člověk hodiny na web prostě nepíše
           (Michal 8. 10. 2026). */
        const bezZapisu = !moje.length;

        /* Manažer poslouchá výkazy jen v okně několika měsíců – když je
           začátek počítání starší, chybí mu data a číslo by bylo mimo. */
        const okno = window.KB.vykazyOknoOd || "";

        /* Nezapsané pracovní dny do včerejška (dnešek se ještě dopisuje).
           Fond za ně stejně běží; tady se jen vyjmenují, ať člověk vidí,
           proč je v mínusu, a dopíše je (Michal 26. 10. 2026). Před oknem
           dat manažera by každý den vypadal prázdný – ty se nehlásí. */
        const chybi = nastaveno && z.bezPrescasu !== true
            ? V.chybejiciDny(uid, k || V.posunIso(dnes, -1), okno > od ? okno : "")
            : [];
        return {
            nastaveno: nastaveno,
            od: od,
            narok: narok,
            cerpano: cerpano,
            zbyva: narok - cerpano,
            dovolenaDnu: dovolenaDnu,
            prescas: Math.round(prescas * 10) / 10,
            bezZapisu: bezZapisu,
            bezPrescasu: z.bezPrescasu === true,
            fond: fond,
            prace: Math.round(prace * 10) / 10,
            absenceHodin: Math.round(absenceHodin * 10) / 10,
            neuplne: nastaveno && !!okno && od < okno,
            chybi: chybi
        };
    };

    /* ================================================== VÝPLATY ========
       DPP, DPČ, OSVČ a student (Michal 3. 11. 2026, Iris): kolik komu za
       měsíc vychází, kolik se mu proplatilo a kolik zbývá – s přenosem do
       dalšího měsíce (i přes Nový rok). Zaměstnanec sem nepatří, má
       domluvenou měsíční výplatu. Stránka vyplaty.html, dokument měsíce
       private/vyplaty/mesice/{uid}_{RRRR-MM} (tvar u KB.ulozVyplatu ve
       store.js) nese ULOŽENÝ výpočet: po proplacení se měsíc zamkne a čísla
       se pak nesmí hýbat s tím, jak se mění výkazy.

         nárok     = práce (hodiny × sazba dne = castkaPrace) + obědy (obedKc)
                     + cestovné (dopravaKc) + placené školení + bonusy
         k výplatě = nárok + z minula (zbývá předchozího měsíce)
         zbývá     = k výplatě − proplaceno

       Placené školení je absence s `absencePlacena` a jejím castkaPrace.
       V.soucty schválně vynechává VŠECHNY absence, i tuhle – proto tu je
       vlastní součet. Neplacené absence (dovolená, nemoc, volno…) nenesou nic.
       Hodiny = práce + placené školení (obojí se platí od hodiny; z nich
       se počítá i limit DPP). Čisté funkce bez DOM a databáze – hlídá je
       NASTROJE\web\testy\test_vyplaty.js. */

    const na2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
    const jeMesic = (m) => /^\d{4}-\d{2}$/.test(String(m || ""));

    /** Komu se výplata počítá (dohoda, OSVČ, student) – seznam je v ui.js. */
    V.jeVyplatnyTyp = (u) => !!u && !!window.KBUI &&
        (window.KBUI.VYPLATNE_TYPY || []).indexOf(window.KBUI.typUvazku(u)) !== -1;

    /* Mzdy a výplaty (Michal 12. 11. 2026, Iris): výpis pro mzdovou = zaměstnanci,
       dohodáři a studenti; stránka Výplaty = jen OSVČ (fakturují si). */
    V.MZDOVE_TYPY = ["zamestnanec", "dpp", "dpc", "student"];
    /** Patří do výpisu pro mzdovou (HPP, DPP, DPČ, student)? */
    V.jeMzdovyTyp = (u) => !!u && !!window.KBUI && V.MZDOVE_TYPY.indexOf(window.KBUI.typUvazku(u)) !== -1;
    /** OSVČ – tabulka měsíce na stránce Výplaty a výzva k faktuře. */
    V.jeOsvc = (u) => !!u && !!window.KBUI && window.KBUI.typUvazku(u) === "osvc";

    /**
     * Mzda zaměstnance platná v měsíci: poslední položka historie s od <= mesic.
     * @param {Object} doc private/mzdy/lide/{uid} = { historie: [{ od: "RRRR-MM", kc, ms, kdo }] }
     * @returns {{kc: number, od: string}|null}
     */
    V.mzdaProMesic = (doc, mesic) => {
        if (!jeMesic(mesic)) return null;
        const h = (doc && Array.isArray(doc.historie) ? doc.historie : [])
            .filter(x => x && jeMesic(x.od) && x.od <= mesic && x.kc !== null && x.kc !== "" && isFinite(Number(x.kc)))
            .sort((a, b) => a.od < b.od ? -1 : a.od > b.od ? 1 : 0);
        const p = h[h.length - 1];
        return p ? { kc: na2(p.kc), od: p.od } : null;
    };

    /** "RRRR-MM" posunutý o n měsíců (i přes rok); "" pro nesmysl. */
    V.posunMesic = (mesic, n) => {
        if (!jeMesic(mesic)) return "";
        const d = new Date(Number(mesic.slice(0, 4)), Number(mesic.slice(5, 7)) - 1 + (Number(n) || 0), 1);
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    };

    /** První a poslední den měsíce: "2026-02" → { od: "2026-02-01", do: "2026-02-28" }. */
    V.mesicRozsah = (mesic) => {
        if (!jeMesic(mesic)) return { od: "", do: "" };
        const posledni = new Date(Number(mesic.slice(0, 4)), Number(mesic.slice(5, 7)), 0).getDate();
        return { od: mesic + "-01", do: mesic + "-" + String(posledni).padStart(2, "0") };
    };

    /** Nese zápis peníze do výplaty? Práce ano, placené školení ano, ostatní absence ne. */
    const doVyplaty = (z) => !!z && (!zapisAbsence(z) || z.absencePlacena === true);

    /**
     * Co měsíc nese z výkazů (zápisy jednoho člověka v jednom měsíci, už
     * spárované s částkami – KB.vykazy). Den po dni z uložených částek,
     * nikdy průměrem. `bezSazby` = zápisy s hodinami, ale bez sazby
     * (částku ještě nikdo nedopočítal) – stránka na ně upozorní.
     */
    V.vyplataZVykazu = (zaznamy, uid, mesic) => {
        const o = { hodiny: 0, prace: 0, obedy: 0, km: 0, skoleniPlacene: 0, zapisu: 0, bezSazby: 0 };
        (zaznamy || []).forEach(z => {
            if (!z || z.uid !== uid || String(z.datum || "").slice(0, 7) !== mesic || !doVyplaty(z)) return;
            const obed = Number(z.obedKc) || 0;
            const doprava = Number(z.dopravaKc) || 0;
            // starší zápis bez castkaPrace: celá částka bez paušálů (jako V.soucty)
            const prace = z.castkaPrace === undefined
                ? (Number(z.castka) || 0) - obed - doprava : (Number(z.castkaPrace) || 0);
            const h = Number(z.hodiny) || 0;
            o.zapisu++;
            if (h > 0 && !(Number(z.sazba) > 0)) o.bezSazby++;
            o.hodiny += h;
            if (zapisAbsence(z)) o.skoleniPlacene += prace; else o.prace += prace;
            o.obedy += obed;
            o.km += doprava;
        });
        ["hodiny", "prace", "obedy", "km", "skoleniPlacene"].forEach(k => { o[k] = na2(o[k]); });
        return o;
    };

    /** Hodiny do výplaty za kalendářní rok (limit DPP): práce + placené školení. */
    V.hodinyRoku = (zaznamy, uid, rok) => na2((zaznamy || []).reduce((s, z) =>
        s + ((z && z.uid === uid && String(z.datum || "").slice(0, 4) === String(rok) && doVyplaty(z))
            ? (Number(z.hodiny) || 0) : 0), 0));

    /** Dokument měsíce z pole dokumentů (id = uid_RRRR-MM), nebo null. */
    V.vyplataDokument = (dokumenty, uid, mesic) => (dokumenty || []).find(d => d &&
        (d.id === uid + "_" + mesic || (d.uid === uid && d.mesic === mesic))) || null;

    /** Z minula = `zbyva` dokumentu předchozího měsíce; bez dokumentu 0 („bez přenosu“). */
    V.vyplataPrenos = (dokumenty, uid, mesic) => {
        const d = V.vyplataDokument(dokumenty, uid, V.posunMesic(mesic, -1));
        return d ? { prenos: na2(d.zbyva), zDokumentu: true } : { prenos: 0, zDokumentu: false };
    };

    /** Bonusy a proplacení – jen položky s číslem, Kč na haléře. */
    const polozkyKc = (pole) => (Array.isArray(pole) ? pole : [])
        .filter(x => x && typeof x === "object" && isFinite(Number(x.kc)) && Number(x.kc) !== 0);

    /** Součty dokumentu ze základu z výkazů, přenosu, bonusů a proplacení. */
    V.vyplataSoucty = (zaklad, prenos, bonusy, proplaceno) => {
        const z = zaklad || {};
        const bonusCelkem = na2(polozkyKc(bonusy).reduce((s, x) => s + Number(x.kc), 0));
        const narok = na2((Number(z.prace) || 0) + (Number(z.obedy) || 0) + (Number(z.km) || 0) +
            (Number(z.skoleniPlacene) || 0) + bonusCelkem);
        const kVyplate = na2(narok + na2(prenos));
        const proplacenoCelkem = na2(polozkyKc(proplaceno).reduce((s, x) => s + Number(x.kc), 0));
        return { bonusCelkem: bonusCelkem, narok: narok, prenos: na2(prenos), kVyplate: kVyplate,
            proplacenoCelkem: proplacenoCelkem, zbyva: na2(kVyplate - proplacenoCelkem) };
    };

    /**
     * Číselný obsah dokumentu měsíce (bez razítek výpočtu a uzavření).
     * volby: { uid, mesic, typ, zaklad | zaznamy, prenos | dokumenty, bonusy, proplaceno }
     *   zaklad   – hotový základ (uzavřený měsíc se nepřepočítává z výkazů)
     *   prenos   – číslo; jinak se vezme z `dokumenty` (V.vyplataPrenos)
     *   typ "zamestnanec" (12. 11. 2026): mzda (Kč) + mzdaOd, jinak z KB.mzdy
     *     (V.mzdaProMesic); nárok = mzda + bonusy, hodiny = odpracované
     *     (bez absencí), prace/obedy/km/skoleniPlacene = 0 – HPP nemá sazbu
     */
    V.vyplataMesice = (volby) => {
        const v = volby || {};
        const zam = v.typ === "zamestnanec";
        let mzda = null;
        if (zam) {
            mzda = (v.mzda !== undefined && v.mzda !== null)
                ? { kc: na2(v.mzda), od: String(v.mzdaOd || "") }
                : (V.mzdaProMesic(((window.KB || {}).mzdy || {})[v.uid], v.mesic) || { kc: 0, od: "" });
        }
        const zaklad = zam
            ? { hodiny: v.zaklad ? na2(v.zaklad.hodiny) : na2((v.zaznamy || []).reduce((s, z) =>
                s + ((z && z.uid === v.uid && String(z.datum || "").slice(0, 7) === v.mesic && !zapisAbsence(z))
                    ? (Number(z.hodiny) || 0) : 0), 0)), prace: 0, obedy: 0, km: 0, skoleniPlacene: 0 }
            : (v.zaklad || V.vyplataZVykazu(v.zaznamy, v.uid, v.mesic));
        const prenos = v.prenos !== undefined ? na2(v.prenos) : V.vyplataPrenos(v.dokumenty, v.uid, v.mesic).prenos;
        const bonusy = polozkyKc(v.bonusy);
        const proplaceno = polozkyKc(v.proplaceno);
        // mzda jde do součtu místo práce – narok = mzda + bonusy (V.vyplataSoucty beze změny)
        const s = V.vyplataSoucty(zam ? { prace: mzda.kc } : zaklad, prenos, bonusy, proplaceno);
        const o = {
            uid: v.uid || "", mesic: v.mesic || "", typ: v.typ || "",
            hodiny: na2(zaklad.hodiny), prace: na2(zaklad.prace), obedy: na2(zaklad.obedy),
            km: na2(zaklad.km), skoleniPlacene: na2(zaklad.skoleniPlacene),
            bonusy: bonusy, bonusCelkem: s.bonusCelkem,
            narok: s.narok, prenos: s.prenos, kVyplate: s.kVyplate,
            proplaceno: proplaceno, proplacenoCelkem: s.proplacenoCelkem, zbyva: s.zbyva
        };
        if (zam) { o.mzda = mzda.kc; o.mzdaOd = mzda.od; }
        return o;
    };

    /* Výzva OSVČ k faktuře (Michal 12. 11. 2026, Iris). Text upravuje finance
       na webu (ciselniky/nastaveni.vyzvaFaktura), posílá Apps Script (Kod.gs,
       akce vyzvaFaktura) – symboly dosazuje STEJNĚ jako tady: jen čísla bez
       jednotek (tisíce mezerou, čárka jen u necelých, na 2 místa), {do} = 10. den
       následujícího měsíce, jméno s „@“ = prázdno. Neznámé symboly zůstanou,
       chybějící čísla = 0. */
    V.VYZVA_VYCHOZI = {
        predmet: "Faktura za {měsíc} – Pasport Kaňa",
        text: "Ahoj {jméno},\nza {měsíc} ti podle výkazů na webu vychází {částka} Kč ({hodiny} h, z toho obědy" +
            " a cestovné {obědy+cestovné} Kč; bonus {bonus} Kč).\nPošli prosím fakturu na isu@pasport.eu nejpozději" +
            " do {do}. Podklady k fakturaci najdeš na webu v Moje výplaty.\n\nDíky, ISU - Pasport Kaňa"
    };
    // „40 125“, „1 234,5“ – tisíce mezerou, desetinná čárka jen když nejsou celé (jako Kod.gs)
    const vyzvaKc = (x) => {
        const c = String(na2(x)).split(".");
        return c[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (c[1] ? "," + c[1] : "");
    };
    /**
     * @param {Object} sablona { predmet, text } – prázdné pole = výchozí (V.VYZVA_VYCHOZI)
     * @param {Object} data dokument výplaty měsíce (mesic, kVyplate, hodiny, obedy, km, bonusCelkem) + jmeno (křestní)
     * @returns {{predmet: string, text: string}}
     */
    V.vyzvaText = (sablona, data) => {
        const s = sablona || {}, d = data || {};
        const mesic = String(d.mesic || "");
        const dalsi = V.posunMesic(mesic, 1);
        // místo jména e-mail (nebo nic) = prázdno a „Ahoj {jméno},“ → „Ahoj,“
        const jmeno = String(d.jmeno || "").trim();
        const symboly = {
            "{jméno}": jmeno.indexOf("@") === -1 ? jmeno : "",
            "{měsíc}": V.mesicText(mesic),
            "{částka}": vyzvaKc(d.kVyplate),
            "{hodiny}": vyzvaKc(d.hodiny),
            "{obědy+cestovné}": vyzvaKc((Number(d.obedy) || 0) + (Number(d.km) || 0)),
            "{bonus}": vyzvaKc(d.bonusCelkem),
            "{do}": dalsi ? "10. " + Number(dalsi.slice(5, 7)) + ". " + dalsi.slice(0, 4) : ""
        };
        const dosad = (t) => Object.keys(symboly).reduce((a, k) => a.split(k).join(symboly[k]),
            symboly["{jméno}"] ? String(t) : String(t).split(" {jméno}").join(""));
        return {
            predmet: dosad(String(s.predmet || "").trim() ? s.predmet : V.VYZVA_VYCHOZI.predmet),
            text: dosad(String(s.text || "").trim() ? s.text : V.VYZVA_VYCHOZI.text)
        };
    };

    /* Limit DPP: 300 h za kalendářní rok (zákon) a měsíční hranice příjmu,
       od které se platí odvody – částku nastaví finance na stránce Výplaty
       (`ciselniky/nastaveni.dpp`), dokud není, hlídají se jen hodiny.
       Do hranice se počítá odměna (práce, placené školení, bonusy), ne
       náhrady – obědy a cestovné příjmem nejsou. */
    V.DPP_LIMIT_HODIN = 300;
    V.dppKcMesice = (d) => na2((Number(d && d.prace) || 0) + (Number(d && d.skoleniPlacene) || 0) +
        (Number(d && d.bonusCelkem) || 0));
    const urovenPct = (pct) => pct === null ? "" : pct >= 100 ? "danger" : pct >= 80 ? "warn" : "";
    /** { limitHodin, hodiny, pctHodin, hranice|null, kc, pctKc|null, uroven: "" | "warn" (≥ 80 %) | "danger" (≥ 100 %) } */
    V.limitDpp = (hodinyRok, kcMesic, nastaveni) => {
        const n = nastaveni || {};
        const limit = Number(n.limitHodinRok) > 0 ? Number(n.limitHodinRok) : V.DPP_LIMIT_HODIN;
        const hranice = Number(n.hraniceKcMesic) > 0 ? Number(n.hraniceKcMesic) : null;
        // úroveň z nezaokrouhleného procenta – 299,9 h nesmí vyjít jako 100 %
        const hod = (Number(hodinyRok) || 0) / limit * 100;
        const kc = hranice ? (Number(kcMesic) || 0) / hranice * 100 : null;
        // zobrazení dolů na desetiny – 79,99 % se neukáže jako 80 %
        const na1 = (x) => x === null ? null : Math.floor(x * 10 + 1e-9) / 10;
        return {
            limitHodin: limit, hodiny: na2(hodinyRok), pctHodin: na1(hod), hodinyUroven: urovenPct(hod),
            hranice: hranice, kc: na2(kcMesic), pctKc: na1(kc), kcUroven: urovenPct(kc),
            uroven: urovenPct(Math.max(hod, kc || 0))
        };
    };

    /** Projekty uvnitř zakázky. Bez zakázky nemá smysl nabízet nic. */
    V.projekty = (zakazka) => {
        const mapa = window.KB.projekty || {};
        return Array.isArray(mapa[zakazka]) ? mapa[zakazka] : [];
    };

    /** Plnění úkolu v procentech – průměr TO-DO položek. */
    /**
     * TO-DO, které se u úkolu počítají. Položku jde vypnout (`vypnuto: true`),
     * když na tom místě nedává smysl – patro třeba rozvaděč vůbec nemá.
     * Vypnutá se nepočítá do procent ani do „hotovo" (Michal 14. 9. 2026).
     */
    V.todoAktivni = (u) => ((u && u.todo) || []).filter(t => t && t.vypnuto !== true);

    V.pctUkolu = (u) => {
        const todo = V.todoAktivni(u);
        if (!todo.length) return u.stav === "hotovo" ? 100 : 0;
        return Math.round(todo.reduce((sum, t) => sum + (Number(t.pct) || 0), 0) / todo.length);
    };

    /* ------------------------------------------- termín v nepřítomnosti ---
       Štítek u úkolu a milníku, když JEDINÝ zpracovatel má v den termínu
       celodenní nepřítomnost (rešerše 19. 10. 2026, nápad 9). Nepřítomnost
       se bere z kalendáře (`public/data/kalendar`) – tam končí dovolená
       a volno z Rychlého zápisu i absence zapsaná ve výkazu (zdroj „vykaz").
       Kalendář čte každý člen, takže štítek uvidí každý, kdo vidí úkol;
       u milníku jen ten, kdo vidí termín (bez termínu není štítek).
       Částečná absence (lékař na dvě hodiny) termín nepřekazí – nepočítá se. */
    const NEPRITOMNOST_STITEK = {
        dovolena: "termín v dovolené", volno: "termín ve volnu (čerpání přesčasu)",
        neplacene: "termín v neplaceném volnu", nemoc: "v den termínu nepřítomen",
        doktor: "v den termínu nepřítomen", skoleni: "v den termínu na školení"
    };
    const NEPRITOMNOST_DRUH = {
        dovolena: "dovolenou", volno: V.nazevAbsence("Volno").toLowerCase(),
        neplacene: "neplacené volno", nemoc: "nemoc", doktor: "lékaře", skoleni: "školení"
    };

    /**
     * Má jediný zpracovatel v den termínu celodenní nepřítomnost?
     * `kalendar` je nepovinný (jinak KB.kalendar).
     * @returns {null | {typ, uid, stitek, popis}}
     */
    V.nepritomnostVTermin = (zpracovatele, termin, kalendar) => {
        const lide = (Array.isArray(zpracovatele) ? zpracovatele : []).filter(Boolean);
        const den = String(termin || "");
        if (lide.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(den)) return null;
        const uid = lide[0];
        const zaznam = (kalendar || (window.KB && window.KB.kalendar) || []).find(k =>
            k && k.uid === uid && NEPRITOMNOST_STITEK[k.typ] && k.celyDen !== false && k.zamitnuto !== true &&
            String(k.od || "") <= den && den <= String(k.do || k.od || ""));
        if (!zaznam) return null;
        const kdo = V.clovek(uid);
        const jmeno = (kdo ? V.jmeno(kdo) : "") || zaznam.osoba || "Zpracovatel";
        const rozsah = zaznam.do && zaznam.do !== zaznam.od
            ? V.czDatum(zaznam.od) + " – " + V.czDatum(zaznam.do) : V.czDatum(zaznam.od);
        // potvrzuje manažer: dovolená, volno i neplacené volno
        const nepotvrzena = (zaznam.typ === "dovolena" || zaznam.typ === "volno" ||
            zaznam.typ === "neplacene") && zaznam.potvrzeno !== true;
        return {
            typ: zaznam.typ,
            uid: uid,
            stitek: NEPRITOMNOST_STITEK[zaznam.typ],
            popis: jmeno + " má v den termínu " + NEPRITOMNOST_DRUH[zaznam.typ] +
                " (" + rozsah + (nepotvrzena ? ", ještě nepotvrzeno" : "") + ")."
        };
    };

    /* Nově zveřejněný milník má sedm dní štítek „nový" – na stránce Milníky,
       v dlaždici na nástěnce i v kalendáři (jedno pravidlo pro všechny).
       Razítko `zverejnenoMs` píše KB.nastavMilniky; starší zveřejnění ho nemají. */
    V.MILNIK_NOVY_DNI = 7;
    V.milnikNovy = (m, ted) => !!m && m.zverejneno !== false && Number(m.zverejnenoMs) > 0 &&
        (ted || Date.now()) - Number(m.zverejnenoMs) < V.MILNIK_NOVY_DNI * 86400000;

    /**
     * Patří patro do budovy? Číselník projektu může mít `patraBudov`,
     * třeba { "Datový sál": ["G62"] }. Patro, které v mapě není, platí ve
     * všech budovách – starší projekty se tím nijak nemění
     * (Michal 14. 9. 2026).
     */
    V.patroVBudove = (patraBudov, budova, patro) => {
        const kde = (patraBudov || {})[patro];
        if (!Array.isArray(kde) || !kde.length || !budova) return true;
        return kde.indexOf(budova) !== -1;
    };

    /**
     * Budovy, patra (+ omezení pater na budovy) a technologie projektu
     * z nastavení projektu – číselník `budget` v meta/zakazky pod NÁZVEM
     * projektu. Dřív žila jen ve Správě; od 29. 10. 2026 ji potřebuje
     * i Vyhodnocení milníků (z pater a budov skládá párování), proto je
     * tady, ať se dvě kopie nerozejdou.
     * `rozepsane` = co je právě vyplněné ve formuláři Údajů ve Správě
     * ({ budovy: [], patra: { patra: [], patraBudov: {} }, technologie: [] }):
     * neuložená změna má přednost, aby matice a okno úkolu viděly, co člověk
     * zrovna píše. Prázdné pole formuláře = platí číselník.
     */
    V.osyProjektu = (p, rozepsane) => {
        const b = ((window.KB && window.KB.budgetCiselnik) || {})[(p && p.nazev) || ""] || {};
        const r = rozepsane || {};
        const pole = (x) => (Array.isArray(x) ? x : []);
        const zPatra = r.patra || {};
        const patraZPole = pole(zPatra.patra).length > 0;
        return {
            budovy: pole(r.budovy).length ? r.budovy : pole(b.budovy),
            patra: patraZPole ? zPatra.patra : pole(b.patra),
            patraBudov: patraZPole ? (zPatra.patraBudov || {}) : (b.patraBudov || {}),
            technologie: pole(r.technologie).length ? r.technologie : pole(b.technologie)
        };
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
            /* Patro, které v téhle budově není (Datový sál jen v G62),
               nemá co nabízet – ani „+" na založení úkolu. */
            if (!V.patroVBudove(osy.patraBudov, budova, patro)) {
                return '<td><span class="mx__bunka mx__bunka--mimo" title="' +
                    esc(patro + " v budově " + budova + " není") + '"></span></td>';
            }
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
        const zCiselniku = Number(proj[uid]) || Number((window.KB.sazby || {})[uid]) || 0;
        if (zCiselniku) return zCiselniku;
        /* Číselník sazeb vidí jen manažer. Kdo si fakturuje sám, má zrcadlo
           své vlastní sazby – platí tedy jen sám na sebe, na cizí uid se
           z něj nic brát nesmí (Michal 13. 10. 2026). */
        const moje = window.KB.mojeSazba;
        const ja = window.KB.currentUid ? window.KB.currentUid() : "";
        if (!moje || !ja || uid !== ja) return 0;
        return Number((moje.projekty || {})[zakazka]) || Number(moje.zakladni) || 0;
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

    /* ------------------------------------------- ekonomika zakázky ------
       Jeden výpočet pro kartu Ekonomika ve Správě i pro upozornění na
       manažerské nástěnce – kdyby si to každá stránka počítala po svém,
       ukazovaly by brzy jiná procenta (Michal 21. 10. 2026).

       Jak se počítá (stejně to musí zopakovat Apps Script, až bude posílat
       upozornění e-mailem):

       • rozpočet   = KB.rozpocty[název zakázky].kc (Kč bez DPH); stránka
                      smí podstrčit rozepsanou hodnotu z pole (volby.rozpocet)
       • práce      = součet uložené `castka` všech zápisů zakázky
                      (zakazka NEBO projekt = název), bez absencí; den po dni
                      z uložených částek, nikdy hodiny × průměrná sazba.
                      Hodiny stejně (`hodiny`).
       • externí    = ruční externí náklady projektu (finance.naklady[].castka)
                      + přijaté faktury s tímto projektem (jen když je stránka
                      dostala – vidí je jen finance; volby.faktury, jinak se
                      nepočítají vůbec), viz V.fakturaNaklad
       • čerpáno    = zaokrouhlená práce + zaokrouhlené externí náklady
       • zbývá      = rozpočet − čerpáno
       • čerpání %  = čerpáno / rozpočet × 100 (bez rozpočtu žádné)
       • hotovo %   = plnění úkolů zakázky (V.hotovoUkolu): % TO-DO úkolu
                      (V.pctUkolu) vážené budgetem úkolu (budgetKc); úkoly
                      bez budgetu váhu nemají. Když budget nemá žádný úkol,
                      je to prostý průměr. Stejně jako buňka matice plnění.
       • předbíhá   = čerpání % − hotovo % (obojí zaokrouhlené na celá
                      procenta, jak se ukazují); varuje se nad 20 bodů
       • tempo      = práce ze zápisů s datem v posledních 28 dnech včetně
                      dneška ÷ 28 = Kč za den. Externí náklady se do tempa
                      nepočítají – jsou jednorázové a prognózu by rozhodily.
       • prognóza   = dnes + ⌈zbývá ÷ tempo⌉ dní, jen když tempo > 0
                      a něco zbývá; tempo 0 = „při dnešním tempu nedojde“.
       • úroveň     = čerpání ≥ 100 % „pres“, ≥ 80 % „pozor“, jinak „ok“.

       Výnosy (vydané faktury) a marže tu schválně nejsou – vydané faktury
       zatím na webu nežijí (rozhodnutí 21. 10. 2026). */

    V.PRAH_POZOR = 80;        // % čerpání – oranžově
    V.PRAH_PRES = 100;        // % čerpání – červeně
    V.PRAH_PREDBIHA = 20;     // procentní body, o které čerpání předbíhá hotovost
    V.TEMPO_DNI = 28;         // okno tempa čerpání (4 týdny)
    V.PRAH_ZNOVU = 10;        // procentní body nad schváleným čerpáním, kdy se hlásí znovu

    /* ------------------------------------- schválené čerpání rozpočtu ----
       Čerpání od 80 % se hlásí na nástěnce, v Celkovém přehledu i v týdenním
       souhrnu vedení (Apps Script). Manažer ho může „vzít na vědomí“ – u
       rozpočtu pak leží
         rozpocty[název zakázky].schvaleno = { pct, kc, ms, kdo }
       (pct = čerpání v %, kc = čerpáno Kč v tu chvíli, kdo = jméno).
       Schválení hlášení zklidní, dokud čerpání nevyroste o dalších
       V.PRAH_ZNOVU bodů nebo nepřekročí 100 % („když to jednou schválím, ať
       se to nepíše každý týden znovu“, Michal 3. 11. 2026). Stejné pravidlo
       má Apps Script (Upozorneni.gs, rozpocetHlasit_) – když se mění tady,
       musí se změnit i tam. Procento musí být spočítané stejně jako tam
       (V.ekonomikaZakazky: práce + ruční externí náklady), jinak by
       schválení z webu e-mail nezklidnilo.
       Test: NASTROJE\web\testy\test_rozpocet_schvaleni.js */

    /** Schválené procento z rozpočtu; null = neschváleno (nebo nesmysl v datech). */
    const schvalenoPct = (rozpocet) => {
        const s = rozpocet && rozpocet.schvaleno;
        if (!s || typeof s !== "object" || s.pct === null || s.pct === "" || typeof s.pct === "boolean") return null;
        const n = Number(s.pct);
        return isFinite(n) ? n : null;
    };

    /**
     * Hlásit čerpání rozpočtu? true, když pct >= 80 a zároveň: neschváleno,
     * nebo pct >= schválené + 10, nebo (pct >= 100 a schválené < 100).
     * `pct` je čerpání v % (V.ekonomikaZakazky().cerpaniPct), nezaokrouhlené.
     */
    V.rozpocetHlasit = (rozpocet, pct) => {
        if (pct === null || pct === undefined || pct === "") return false;
        const p = Number(pct);
        if (!isFinite(p) || p < V.PRAH_POZOR) return false;
        const s = schvalenoPct(rozpocet);
        if (s === null) return true;
        return p >= s + V.PRAH_ZNOVU || (p >= V.PRAH_PRES && s < V.PRAH_PRES);
    };

    /** Text štítku „Schváleno 85 % · 3. 11. · Jméno“; "" = neschváleno.
        Holý text – do HTML jen přes esc(). Peníze (kc) v něm schválně nejsou. */
    V.rozpocetSchvaleno = (rozpocet) => {
        const s = schvalenoPct(rozpocet);
        if (s === null) return "";
        const kusy = ["Schváleno " + Math.round(s) + " %"];
        const ms = Number(rozpocet.schvaleno.ms);
        if (ms > 0) {
            const d = new Date(ms);
            if (!isNaN(d.getTime())) kusy.push(d.getDate() + ". " + (d.getMonth() + 1) + ".");
        }
        const kdo = String(rozpocet.schvaleno.kdo || "").trim();
        if (kdo) kusy.push(kdo);
        return kusy.join(" · ");
    };

    /** Posun data ISO o celé dny (bez starostí o letní čas – počítá se v poledne). */
    V.posunIso = (iso, dni) => {
        const d = new Date(iso + "T12:00:00");
        d.setDate(d.getDate() + dni);
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
               "-" + String(d.getDate()).padStart(2, "0");
    };

    /** Patří zápis k zakázce? Podle názvu zakázky nebo části – stejně jako rozpad. */
    V.zapisZakazky = (z, nazev) => !!nazev && !!z &&
        ((z.zakazka || "") === nazev || (z.projekt || "") === nazev);

    /** Úkoly zakázky – podle id projektu, starší podle názvu. */
    V.ukolyZakazky = (nazev, projektId, ukoly) =>
        (ukoly || window.KB.ukoly || []).filter(u =>
            (projektId && u.projektId === projektId) || (nazev && u.projekt === nazev));

    /** Budget úkolu v Kč z tajné kolekce budgetů (jen manažeři). */
    V.budgetUkolu = (u, budgety) =>
        Number(((budgety || window.KB.ukolBudgety || {})[u && u.id] || {}).budgetKc) || 0;

    /** Sleduje se u úkolu plnění? Jen když má TO-DO položky nebo je hotový –
        úkol bez TO-DO by jinak vypadal jako „hotovo 0 %“ a každá zakázka, kde
        nikdo neklikal procenta, by hlásila „čerpání předbíhá hotovost“
        (ověřeno na živých datech 21. 10. 2026). */
    V.sledujePlneni = (u) => !!u && ((Array.isArray(u.todo) && u.todo.length > 0) || u.stav === "hotovo");

    /**
     * Hotovo skupiny úkolů v %: % TO-DO vážená budgetem úkolu; když budget
     * nemá žádný z nich, prostý průměr. Počítají se jen úkoly, u kterých se
     * plnění sleduje (V.sledujePlneni); bez nich null – hotovost neznáme.
     */
    V.hotovoUkolu = (ukoly, budgety) => {
        const seznam = (ukoly || []).filter(V.sledujePlneni);
        if (!seznam.length) return null;
        let vaha = 0, soucet = 0;
        seznam.forEach(u => {
            const w = V.budgetUkolu(u, budgety);
            vaha += w;
            soucet += V.pctUkolu(u) * w;
        });
        return Math.round(vaha ? soucet / vaha
            : seznam.reduce((x, u) => x + V.pctUkolu(u), 0) / seznam.length);
    };

    /**
     * Přijatá faktura jako náklad zakázky v Kč bez DPH; null = nepočítá se.
     * Základ (castkaBez, u rozpisu součet základů) + poplatky mimo DPH, cizí
     * měna jen s kurzem. Dobropis odečítá. Vynechá se vydaná faktura,
     * nezkontrolovaný koncept z inboxu a zálohová faktura (náklad nese až
     * vyúčtování, jinak by se počítal dvakrát).
     */
    V.fakturaNaklad = (f) => {
        if (!f || f.typ !== "prijata") return null;
        if (f.zdroj === "inbox" && (f.stav || "nova") === "nova") return null;
        if (f.druhDokladu === "zalohova") return null;
        let zaklad = Number(f.castkaBez) || 0;
        if (!zaklad && Array.isArray(f.rozpisDph)) {
            zaklad = f.rozpisDph.reduce((x, r) => x + (Number(r && r.zaklad) || 0), 0);
        }
        zaklad += Number(f.poplatky) || 0;
        const kc = (!f.mena || f.mena === "CZK") ? zaklad : zaklad * (Number(f.kurz) || 0);
        return f.druhDokladu === "dobropis" ? -Math.abs(kc) : kc;
    };

    /** Procento s ochranou proti dělení nulou; null = nejde spočítat. */
    const procento = (cast, celek) => celek > 0 ? cast / celek * 100 : null;
    const celaPct = (pct) => pct === null || pct === undefined ? null : Math.round(pct);
    const uroven = (pct) => pct === null ? "" :
        pct >= V.PRAH_PRES ? "pres" : pct >= V.PRAH_POZOR ? "pozor" : "ok";

    /**
     * Ekonomika jedné zakázky. Volby (všechny nepovinné):
     *   rozpocet   – Kč; jinak V.rozpocet(nazev).kc
     *   projektId  – id projektu (úkoly se hledají podle id i názvu)
     *   naklady    – ruční externí náklady [{ castka }]
     *   faktury    – seznam faktur, které stránka smí ukázat; null = nepočítat
     *   vykazy, ukoly, budgety – jinak z KB (stránka může podat předtříděné)
     *   dnes       – ISO datum (testy); konec – konec zakázky pro prognózu
     *   zacatek    – začátek zakázky: starší než okno výkazů = neúplné
     */
    V.ekonomikaZakazky = (nazev, volby) => {
        volby = volby || {};
        const KB = window.KB || {};
        const dnes = volby.dnes || V.dnesISO();
        const rozpocet = volby.rozpocet !== undefined && volby.rozpocet !== null
            ? Math.max(0, Number(volby.rozpocet) || 0)
            : V.rozpocet(nazev).kc;
        const budgety = volby.budgety || KB.ukolBudgety || {};
        const ukoly = V.ukolyZakazky(nazev, volby.projektId, volby.ukoly || KB.ukoly || []);
        const ukolMapa = new Map(ukoly.map(u => [u.id, u]));
        const vsechnyUkoly = new Map((volby.ukoly || KB.ukoly || []).map(u => [u.id, u]));

        /* ---- práce z výkazů: uložené částky, den po dni ---- */
        const tempoOd = V.posunIso(dnes, -(V.TEMPO_DNI - 1));
        let praceKc = 0, praceHod = 0, tempoKc = 0;
        const techPrace = new Map();
        (volby.vykazy || KB.vykazy || []).forEach(z => {
            if (z.absence === true || !V.zapisZakazky(z, nazev)) return;
            const kc = Number(z.castka) || 0;
            const h = Number(z.hodiny) || 0;
            praceKc += kc;
            praceHod += h;
            if (z.datum && z.datum >= tempoOd && z.datum <= dnes) tempoKc += kc;
            // rozpuštění do technologií stejně jako matice plnění
            V.rozpadZapisu(z, ukolMapa.get(z.ukolId) || vsechnyUkoly.get(z.ukolId)).forEach(d => {
                if (!d.tech) return;
                const o = techPrace.get(d.tech) || { castka: 0, hodiny: 0 };
                o.castka += kc * d.dil;
                o.hodiny += h * d.dil;
                techPrace.set(d.tech, o);
            });
        });

        /* ---- externí náklady: ruční řádky + přijaté faktury s projektem ---- */
        const nakladyRucne = (volby.naklady || []).reduce((x, n) => x + (Number(n && n.castka) || 0), 0);
        const fakturyZapocteny = Array.isArray(volby.faktury);
        let nakladyFaktury = 0, fakturPocet = 0;
        if (fakturyZapocteny) {
            volby.faktury.forEach(f => {
                if (!f || (f.projekt || "") !== nazev) return;
                const kc = V.fakturaNaklad(f);
                if (kc === null) return;
                nakladyFaktury += kc;
                fakturPocet++;
            });
        }

        /* Zaokrouhluje se PŘED sčítáním – dlaždice vedle sebe musí sedět
           na korunu (stejně jako krajíc rozpočtu). */
        const prace = Math.round(praceKc);
        const externi = Math.round(nakladyRucne) + Math.round(nakladyFaktury);
        const cerpano = prace + externi;
        const zbyva = rozpocet - cerpano;
        const cerpaniPct = procento(cerpano, rozpocet);
        const hotovoPct = V.hotovoUkolu(ukoly, budgety);
        const predbiha = (cerpaniPct === null || hotovoPct === null) ? null
            : celaPct(cerpaniPct) - hotovoPct;

        /* ---- tempo a prognóza ---- */
        const tempoDen = tempoKc / V.TEMPO_DNI;
        let prognoza;
        if (!rozpocet) prognoza = { stav: "bez-rozpoctu" };
        else if (zbyva <= 0) prognoza = { stav: "vycerpano" };
        else if (tempoDen <= 0) prognoza = { stav: "nedojde" };
        else {
            const dni = Math.ceil(zbyva / tempoDen);
            prognoza = dni > 3650 ? { stav: "nedojde", dni: dni }
                : { stav: "datum", dni: dni, datum: V.posunIso(dnes, dni) };
            if (prognoza.datum && volby.konec) prognoza.predKoncem = prognoza.datum < volby.konec;
        }

        /* ---- rozpad po technologiích: kde je budget technologie nebo
           úkoly s budgetem. Budget = rozpočet technologie (Správa → matice),
           když není, součet budgetů úkolů té technologie. ---- */
        const techRozpocty = ((KB.rozpocty || {})[nazev] || {}).techBudgetyKc || {};
        const techy = [];
        ukoly.forEach(u => { if (u.technologie && techy.indexOf(u.technologie) === -1) techy.push(u.technologie); });
        Object.keys(techRozpocty).forEach(t => { if (t && techy.indexOf(t) === -1) techy.push(t); });
        const technologie = techy.map(t => {
            const jejich = ukoly.filter(u => u.technologie === t);
            const zUkolu = jejich.reduce((x, u) => x + V.budgetUkolu(u, budgety), 0);
            const budget = Number(techRozpocty[t]) || zUkolu;
            const p = techPrace.get(t) || { castka: 0, hodiny: 0 };
            const kc = Math.round(p.castka);
            const pct = procento(kc, budget);
            const hotovo = V.hotovoUkolu(jejich, budgety);
            return {
                tech: t, budget: budget, zdrojBudgetu: Number(techRozpocty[t]) ? "technologie" : "ukoly",
                cerpano: kc, hodiny: Math.round(p.hodiny * 10) / 10,
                cerpaniPct: pct, hotovoPct: hotovo, ukolu: jejich.length,
                predbiha: (pct === null || hotovo === null) ? null : celaPct(pct) - hotovo,
                uroven: uroven(pct)
            };
        }).filter(r => r.budget > 0)
          .sort((a, b) => (b.cerpaniPct || 0) - (a.cerpaniPct || 0) || a.tech.localeCompare(b.tech, "cs"));

        const okno = KB.vykazyOknoOd || "";
        return {
            nazev: nazev,
            rozpocet: rozpocet,
            prace: prace,
            praceHodiny: Math.round(praceHod * 10) / 10,
            nakladyRucne: Math.round(nakladyRucne),
            nakladyFaktury: Math.round(nakladyFaktury),
            fakturPocet: fakturPocet,
            fakturyZapocteny: fakturyZapocteny,
            externi: externi,
            cerpano: cerpano,
            zbyva: zbyva,
            cerpaniPct: cerpaniPct,
            hotovoPct: hotovoPct,
            ukolu: ukoly.length,
            predbiha: predbiha,
            predbihaVarovani: predbiha !== null && predbiha > V.PRAH_PREDBIHA,
            uroven: uroven(cerpaniPct),
            tempoOd: tempoOd,
            tempo28: Math.round(tempoKc),
            tempoDen: tempoDen,
            prognoza: prognoza,
            technologie: technologie,
            oknoOd: okno,
            neuplne: !!okno && !!volby.zacatek && volby.zacatek < okno
        };
    };

    /**
     * Čerpání jednoho úkolu: budget úkolu (Kč) proti uloženým částkám zápisů
     * s jeho `ukolId` (bez absencí) – stejně jako sloupec Vyfakturováno ve
     * Správě. Hotovo = % TO-DO úkolu.
     */
    V.cerpaniUkolu = (u, volby) => {
        volby = volby || {};
        const budget = V.budgetUkolu(u, volby.budgety);
        let kc = 0, h = 0;
        (volby.vykazy || window.KB.vykazy || []).forEach(z => {
            if (z.absence === true || !u || z.ukolId !== u.id) return;
            kc += Number(z.castka) || 0;
            h += Number(z.hodiny) || 0;
        });
        const cerpano = Math.round(kc);
        const pct = procento(cerpano, budget);
        const hotovo = V.sledujePlneni(u) ? V.pctUkolu(u) : null;
        const predbiha = (pct === null || hotovo === null) ? null : celaPct(pct) - hotovo;
        return {
            budget: budget, cerpano: cerpano, hodiny: Math.round(h * 10) / 10,
            cerpaniPct: pct, hotovoPct: hotovo, predbiha: predbiha,
            predbihaVarovani: predbiha !== null && predbiha > V.PRAH_PREDBIHA,
            uroven: uroven(pct)
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

    /**
     * Rozdělí `co` procent na `kolik` dílů. Dělí se po desítkách, ať se dá
     * všechno vyklikat; co po desítkách nevyjde, přilepí se k prvnímu dílu.
     * Součet vždycky sedí přesně na `co` – jinak by se procenta rozešla se
     * stem a zápis by rozdělil víc peněz, než kolik stál.
     */
    function rozdel(co, kolik) {
        if (kolik <= 0) return [];
        const krok = V.PODIL_KROK;
        const zaklad = Math.max(0, Math.floor(co / kolik / krok) * krok);
        const out = new Array(kolik).fill(zaklad);
        let zbytek = co - zaklad * kolik;
        for (let j = 0; zbytek >= krok; j = (j + 1) % kolik) {
            out[j] += krok;
            zbytek -= krok;
        }
        if (zbytek) out[0] += zbytek;
        return out;
    }

    /**
     * Rovným dílem: 1 → [100], 2 → [50, 50], 3 → [40, 30, 30],
     * 4 → [25, 25, 25, 25]. Kde to vyjde beze zbytku, dělí se přesně –
     * čtyři patra po třiceti a dvaceti by vypadala jako omyl.
     */
    V.podilyRovnym = (pocet) => {
        if (pocet <= 0) return [];
        if (100 % pocet === 0) return new Array(pocet).fill(100 / pocet);
        return rozdel(100, pocet);
    };

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
            if (!V.zapisZakazky(z, nazev)) return;
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

    /* ------------------------------------- párování milníků s úkoly ----

       Milník (harmonogram ze smlouvy) nemá budovu ani patro – jen volný text
       náplně („A1 - 1.NP zásuvky; A2 - 1.NP", „Rozvaděče – 3.PP; 2.PP
       a 1.NP"). Úkoly se ale dělí po budovách a patrech a výkazy se píšou
       na úkoly. Aby šlo říct, kolik hodin a peněz stál který milník, musí
       se milník s úkoly spárovat – stroj to navrhne z technologie a z budov
       a pater, které v náplni najde, a manažer návrh potvrdí (stránka
       Vyhodnocení milníků, Michal 29. 10. 2026). Budovy a patra se berou
       z nastavení projektu, nic z nich není v kódu – stejně to musí běžet
       na jiném projektu s jinými budovami. */

    const bezDiakritiky = (text) => String(text == null ? "" : text)
        .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const proRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // jen pro porovnání: „1.NP", „1 NP" i „1np" je totéž patro
    const klicOsy = (text) => String(text == null ? "" : text).toUpperCase().replace(/[\s.]+/g, "");
    const unikatni = (pole) => pole.filter((x, i) => x && pole.indexOf(x) === i);

    /**
     * Technologie jako množina zkratek. Milníky a úkoly je píšou jinak
     * („MaR" × „MAR", „SHZ" × „HAS/SHZ", společný milník „STAVBA + SLN"),
     * proto se rozdělí na `/`, `+` a `,` a srovnají velikostí písmen;
     * shoda = aspoň jedna společná zkratka.
     */
    V.techTokeny = (text) => unikatni(String(text == null ? "" : text).toUpperCase()
        .split(/[\/+,]/).map(x => x.trim()));

    const sdiliTech = (tokeny, technologie) => {
        const jeho = V.techTokeny(technologie);
        return tokeny.some(t => jeho.indexOf(t) !== -1);
    };

    /* Rozpoznávače budov a pater se skládají z os projektu; projekt má
       stovky milníků se stejnými osami, tak se nestaví pro každý znovu. */
    const rozpoznavace = new Map();

    function rozpoznavac(osy, ukoly) {
        /* Patro nebo budova úkolu, které v osách chybí (osy se po založení
           úkolů změnily), se pozná taky – úkol by jinak nešlo spárovat. */
        const budovy = unikatni([].concat((osy && osy.budovy) || [], (ukoly || []).map(u => u && u.budova))
            .map(x => String(x == null ? "" : x).trim()));
        const patra = unikatni([].concat((osy && osy.patra) || [], (ukoly || []).map(u => u && u.patro))
            .map(x => String(x == null ? "" : x).trim()));
        const klic = JSON.stringify([budovy, patra]);
        if (rozpoznavace.has(klic)) return rozpoznavace.get(klic);

        /* Hranice slova přes \p{L}\p{N} (u-flag), ne přes \b – to zná jen
           anglická písmena. Lookbehind schválně ne: starší Safari ho neumí
           a celý skript by spadl; levá hranice je proto skupina (?:^|…). */
        const PRED = "(?:^|[^\\p{L}\\p{N}])";
        const ZA = "(?![\\p{L}\\p{N}])";
        const r = {
            /* Budova s hranicí slova, ale NE kód místnosti: „A1-2S15" je
               místnost 2S15 v budově A1, ne budova A1 a patro 2S. Mezera
               kolem pomlčky („A1 - 1.NP") je naopak budova a patro. */
            budovy: budovy.map(b => ({ nazev: b,
                re: new RegExp(PRED + proRegex(b) + ZA + "(?!-\\d)", "iu") })),
            /* „3PP" najde „3PP", „3.PP" i „3. PP", ale ne „13PP" ani „3PP1".
               Jednopísmenné podlaží („1S", „3Z") jen velkými písmeny – malé
               „1 s" nebo „1 z 3" je v češtině předložka, ne patro.
               Textová patra (Datový sál, Střechy, Venek) podřetězcem bez
               ohledu na velikost písmen a diakritiku. */
            patra: patra.map(p => {
                const c = /^(\d+)\s*\.?\s*(\p{L}+)$/u.exec(p);
                if (!c) return { nazev: p, text: bezDiakritiky(p) };
                const jednoPismeno = c[2].length === 1;
                return { nazev: p, re: new RegExp(PRED + c[1] + "\\s*\\.?\\s*" +
                    proRegex(jednoPismeno ? c[2].toUpperCase() : c[2]) + ZA, jednoPismeno ? "u" : "iu") };
            })
        };
        if (rozpoznavace.size > 30) rozpoznavace.clear();
        rozpoznavace.set(klic, r);
        return r;
    }

    /**
     * Rozbor náplně milníku: segmenty po středníku (a řádku), v každém
     * budovy a patra z os projektu. Segment bez patra se vynechá – budova
     * sama nic nespáruje. Segment s patrem a bez budovy platí pro všechny
     * budovy („Celé 2.PP bez strojoven A1-2S15" → 2PP v obou budovách).
     * @returns {Array<{budova: string, patra: string[]}>}
     */
    V.rozeberNapln = (napln, osy, ukoly) => {
        const r = rozpoznavac(osy || {}, ukoly || []);
        const out = [];
        String(napln == null ? "" : napln).split(/[;\n]/).forEach(seg => {
            const sloz = bezDiakritiky(seg);
            const patra = r.patra.filter(p => (p.re ? p.re.test(seg) : (!!p.text && sloz.indexOf(p.text) !== -1)))
                .map(p => p.nazev);
            if (!patra.length) return;
            const budovy = r.budovy.filter(b => b.re.test(seg)).map(b => b.nazev);
            if (budovy.length) budovy.forEach(b => out.push({ budova: b, patra: patra.slice() }));
            else out.push({ budova: "", patra: patra });
        });
        return out;
    };

    const stejnaMnozina = (a, b) => {
        const x = unikatni((a || []).map(String)).sort(), y = unikatni((b || []).map(String)).sort();
        return x.length === y.length && x.every((v, i) => v === y[i]);
    };

    /* ------------------------------ párování až na položky TO-DO ----

       Úkol BPH je „technologie – budova – patro“ a v něm položky TO-DO
       (SLB – G61 – 3PP: EPS, EZS, CCTV…), milník bývá jen jeden prvek
       („EPS tlačítka – všechna patra“). Výkazy nesou jen úkol, ne položku –
       k milníku se proto bere poměrná část úkolu: vybrané aktivní položky /
       všechny aktivní (Michal, Iris 3. 11. 2026). Uložené v párování jako
       `polozky: { ukolId: [todoId…] }`; úkol bez klíče = celý úkol. */

    /** Klíč položky: její id; položka bez id (starší data) jde vybrat jen s celým úkolem. */
    const klicPolozky = (t, i) => (t && t.id != null && String(t.id) !== "") ? String(t.id) : "#" + i;

    /** Aktivní položky úkolu s klíčem. Úkol bez položek = jedna „celá“ položka "*". */
    function aktivniPolozky(u) {
        return ((u && u.todo) || []).map((t, i) => ({ t: t, k: klicPolozky(t, i) }))
            .filter(x => x.t && x.t.vypnuto !== true);
    }

    /** Aktivní položky TO-DO, které jde k milníku vybrat (mají id). */
    V.polozkyUkolu = (u) => aktivniPolozky(u).filter(x => x.k.charAt(0) !== "#").map(x => x.t);

    /**
     * Jakou část úkolu milník bere.
     *   vybrane  pole todoId z párování, nebo null / chybí = celý úkol
     * @returns {{ cely, vybrano, aktivnich, podil, klice, polozky, pct, chybi }}
     *   podil = vybrané aktivní / aktivní (vypnuté se nepočítají), klice =
     *   vybrané položky (u úkolu bez položek "*"), pct = průměr vybraných
     *   položek, chybi = vybrané položky už u úkolu nejsou (smazané, vypnuté)
     */
    V.castUkolu = (u, vybrane) => {
        const aktivni = aktivniPolozky(u);
        const hotovo = !!u && u.stav === "hotovo";
        const prumer = (seznam) => seznam.length
            ? Math.round(seznam.reduce((s, x) => s + (Number(x.t.pct) || 0), 0) / seznam.length)
            : (hotovo ? 100 : 0);
        if (!aktivni.length) {
            return { cely: true, vybrano: 0, aktivnich: 0, podil: 1, klice: ["*"], polozky: [], pct: hotovo ? 100 : 0, chybi: false };
        }
        if (!Array.isArray(vybrane)) {
            return { cely: true, vybrano: aktivni.length, aktivnich: aktivni.length, podil: 1,
                     klice: aktivni.map(x => x.k), polozky: aktivni.map(x => x.t), pct: prumer(aktivni), chybi: false };
        }
        const chci = new Set(vybrane.map(String));
        const sel = aktivni.filter(x => x.k.charAt(0) !== "#" && chci.has(x.k));
        return {
            cely: sel.length === aktivni.length,
            vybrano: sel.length,
            aktivnich: aktivni.length,
            podil: sel.length / aktivni.length,
            klice: sel.map(x => x.k),
            polozky: sel.map(x => x.t),
            pct: prumer(sel),
            chybi: !sel.length
        };
    };

    /* Slova, která říkají „kde“ nebo „jak moc“, ne „co“ – podle nich se
       položka nepozná (bez diakritiky, malými písmeny). */
    const SLOVA_BEZ_VYZNAMU = new Set(("vsechna vsechny vsech vse vsechno cele cely cela celkem patra patro pater " +
        "podlazi podlazich budova budovy budov objekt objektu bez pro nad pod pri koordinace dokonceni odevzdani " +
        "pasport pasportu pasportizace milnik milniku cast casti dalsi ostatni vcetne zbytek zbyvajici").split(" "));

    /** Slova textu pro porovnání: bez diakritiky, aspoň 3 písmena, bez čísel (kódy budov a pater). */
    const vyznamovaSlova = (text) => bezDiakritiky(text).split(/[^\p{L}\p{N}]+/u)
        .filter(w => w.length >= 3 && !/\d/.test(w) && !SLOVA_BEZ_VYZNAMU.has(w));

    /* Stejné slovo v jiném tvaru: „hydrant“ × „hydranty“, „spalinové“ ×
       „spalinová“, „EPS“ × „EPS“. Krátké slovo se musí shodovat celé (jako
       začátek delšího), u delšího stačí společný začátek bez koncovky –
       „hydrant“ ale nesedí na „hydraulika“. */
    function podobnaSlova(a, b) {
        const min = Math.min(a.length, b.length);
        let spolecne = 0;
        while (spolecne < min && a.charAt(spolecne) === b.charAt(spolecne)) spolecne++;
        const treba = min <= 4 ? min : (min <= 7 ? min - 1 : min - 2);
        return spolecne >= Math.max(3, treba);
    }

    /**
     * Návrh položek TO-DO úkolu k milníku podle náplně: slova náplně
     * a zkratky technologie milníku (V.techTokeny – „EPS“, „hydrant“,
     * „spalinové“) proti textu položek. Čistá funkce (testy\test_parovani_milniku.js).
     *   m     milník { cinnost, napln }
     *   ukol  úkol s `todo`
     * @returns {string[]|null} id navržených položek; null = celý úkol
     *   (nic nesedí, sedí všechno, nebo úkol nemá aspoň dvě položky)
     */
    V.navrhPolozek = (m, ukol) => {
        const aktivni = aktivniPolozky(ukol);
        if (aktivni.length < 2) return null;
        // zkratka technologie úkolu (SLB u úkolu SLB) by seděla na všechno nebo na nic
        const vlastni = V.techTokeny(ukol && ukol.technologie).map(bezDiakritiky);
        const slova = unikatni([].concat(
            V.techTokeny(m && m.cinnost).map(bezDiakritiky).filter(t => t.length >= 3 && !SLOVA_BEZ_VYZNAMU.has(t)),
            vyznamovaSlova(m && m.napln)))
            .filter(t => vlastni.indexOf(t) === -1);
        if (!slova.length) return null;
        const sedi = aktivni.filter(x => x.k.charAt(0) !== "#" && x.t.celkem !== true &&
            vyznamovaSlova(x.t.text).some(w => slova.some(s => podobnaSlova(w, s))));
        if (!sedi.length || sedi.length === aktivni.length) return null;
        return sedi.map(x => x.k);
    };

    /** Výběr položek z databáze jen v povoleném tvaru a jen u úkolů párování. */
    function cistePolozky(polozky, ids) {
        const out = {};
        if (!polozky || typeof polozky !== "object") return out;
        (ids || []).forEach(id => {
            const p = polozky[id];
            if (Array.isArray(p)) out[id] = unikatni(p.map(x => String(x == null ? "" : x)));
        });
        return out;
    }

    /**
     * Které milníky berou kterou položku úkolu – z toho se pozná sdílení
     * (úkol na dvou milnících, ale každý s jinou položkou, sdílený není)
     * a dělí hodiny v režimech `rovnym-dilem` a `hlavni`.
     *   seznam  [{ id: milnikId, ukoly: [úkol], polozky }] v pořadí milníků
     * @returns {Object<string, Object<string, string[]>>} ukolId → klíč položky → [milnikId…]
     */
    V.sdileniParovani = (seznam) => {
        const out = {};
        (seznam || []).forEach(r => {
            if (!r || !r.id) return;
            (r.ukoly || []).forEach(u => {
                if (!u || !u.id) return;
                const cast = V.castUkolu(u, (r.polozky || {})[u.id]);
                const mapa = out[u.id] || (out[u.id] = {});
                cast.klice.forEach(k => {
                    const kdo = mapa[k] || (mapa[k] = []);
                    if (kdo.indexOf(r.id) === -1) kdo.push(r.id);
                });
            });
        });
        return out;
    };

    /**
     * Quick TO-DO k odevzdanému milníku (Michal, Iris 3. 11. 2026: hotový
     * milník má mít hotové úkoly). Nehotové jsou spárované úkoly, které
     * nemají stav hotovo (celý úkol), nebo mají vybrané položky pod 100 %
     * (část úkolu). Adresáti: zpracovatelé milníku (všechny nehotové úkoly)
     * a přiřazení lidé těch úkolů (jen jejich úkoly), každý jednou.
     *   m        milník { id, cinnost, napln, owners | zpracovatele }
     *   ukoly    spárované úkoly
     *   polozky  výběr položek z párování (ukolId → [todoId])
     * @returns {{ nehotove: [{u, cast}], vzkazy: [{ uid, text, odkazy, ukoly }] }}
     */
    V.milnikTodoPlan = (m, ukoly, polozky) => {
        const vyber = polozky || {};
        const nehotove = (ukoly || []).filter(u => u && u.id).map(u => {
            const castecne = Array.isArray(vyber[u.id]);
            return { u: u, cast: V.castUkolu(u, castecne ? vyber[u.id] : null), castecne: castecne };
        }).filter(x => x.castecne && !x.cast.cely ? x.cast.pct < 100 : x.u.stav !== "hotovo");
        const komu = new Map();
        const pridej = (uid, x) => {
            if (!uid) return;
            if (!komu.has(uid)) komu.set(uid, []);
            if (x && komu.get(uid).indexOf(x) === -1) komu.get(uid).push(x);
        };
        if (nehotove.length) {
            const zprac = (m && (Array.isArray(m.owners) ? m.owners : m.zpracovatele)) || [];
            zprac.map(String).forEach(uid => nehotove.forEach(x => pridej(uid, x)));
            nehotove.forEach(x => (Array.isArray(x.u.prirazeni) ? x.u.prirazeni : []).map(String).forEach(uid => pridej(uid, x)));
        }
        const napln = String((m && m.napln) || "").replace(/\s+/g, " ").trim();
        const popis = [String((m && m.cinnost) || "").trim(), napln.length > 60 ? napln.slice(0, 59).trim() + "…" : napln]
            .filter(Boolean).join(" – ") || "bez názvu";
        const vzkazy = Array.from(komu, ([uid, seznam]) => {
            const zacatek = "Milník " + popis + " je odevzdaný: aktualizuj TO-DO u " + (seznam.length === 1 ? "úkolu " : "úkolů ");
            const kusy = seznam.map(x => {
                const n = String(x.u.nazev || x.u.id).replace(/\s+/g, " ").trim().slice(0, 120);
                const jen = x.castecne && !x.cast.cely && x.cast.polozky.length
                    ? "jen " + x.cast.polozky.map(t => String(t.text || "").trim()).filter(Boolean).slice(0, 3).join(", ") +
                      (x.cast.vybrano > 3 ? " a další" : "") + ", " : "";
                return { n: n, id: x.u.id, text: "#" + n + " (" + jen + "postup " + x.cast.pct + " %)" };
            });
            // text vzkazu unese 300 znaků – co se nevejde, je „a další N“
            let text = zacatek, vzato = 0;
            for (let i = 0; i < kusy.length; i++) {
                const kus = (i ? ", " : "") + kusy[i].text;
                const zbude = kusy.length - i - 1;
                if (i && (text + kus).length > 300 - (zbude ? 16 : 0)) break;
                text += kus;
                vzato++;
            }
            if (vzato < kusy.length) text += " a další " + (kusy.length - vzato);
            return {
                uid: uid,
                text: text.slice(0, 300),
                odkazy: kusy.slice(0, Math.min(vzato, 20)).map(k => ({ t: "u", id: String(k.id), n: k.n })),
                ukoly: seznam.map(x => x.u.id)
            };
        });
        return { nehotove: nehotove, vzkazy: vzkazy };
    };

    /**
     * Které úkoly patří k milníku. Čistá funkce (žádný DOM ani databáze),
     * ať jde ověřit v Node (testy\test_parovani_milniku.js).
     *   m      milník { id, cinnost, napln }
     *   ukoly  úkoly TOHO projektu { id, technologie, budova, patro, milnikId }
     *   osy    V.osyProjektu(p) – { budovy, patra }
     *   volby.potvrzene  uložené potvrzení (private/milniky/parovani/{id}) nebo null
     * Položky TO-DO (3. 11. 2026): `polozky` = výběr položek z potvrzení
     * (ukolId → [todoId]; úkol bez klíče = celý úkol), návrh je vždy celý
     * úkol. `navrhPolozky` = co by šlo podle náplně vybrat (V.navrhPolozek)
     * – stránka to jen nabídne, samo se to nepoužije.
     * Pořadí, kdo má přednost:
     *   1. potvrzené manažerem – platí, jak je, návrh se už nepřepočítává
     *      (jen se hlásí, že by dnes vyšel jinak: `navrhJinak`),
     *   2. „milnikId" – úkol vznikl z milníku tlačítkem „Udělat úkoly
     *      z milníků" (VZT), vazba je jistá,
     *   3. „budova" – v náplni je budova i patro: úkoly se stejnou technologií,
     *      budovou a patrem,
     *   4. „patro" – patro bez budovy: úkoly všech budov (úkol tak může sedět
     *      na dva milníky),
     *   5. „chybi" – patro v náplni je, takový úkol u projektu není,
     *   6. „bez" – v náplni není patro, spárovat jde jen ručně.
     * Úkol s `milnikId` jiného milníku se po patrech nepáruje – patří tam.
     * @returns {{ zpusob, ukoly, ids, potvrzeno, potvrdil, potvrzenoMs,
     *   chybejiciIds, navrh: {zpusob, ids}, navrhJinak, segmenty, budovy, patra, tech,
     *   polozky, navrhPolozky }}
     */
    V.parovaniMilniku = (m, ukoly, osy, volby) => {
        const v = volby || {};
        const seznam = (ukoly || []).filter(u => u && u.id);
        const tech = V.techTokeny(m && m.cinnost);
        const segmenty = V.rozeberNapln(m && m.napln, osy, seznam);

        let navrhZpusob = "bez", navrhUkoly = [];
        const primo = seznam.filter(u => !!u.milnikId && !!m && u.milnikId === m.id);
        if (primo.length) {
            navrhZpusob = "milnikId";
            navrhUkoly = primo;
        } else if (segmenty.length) {
            segmenty.forEach(s => {
                const patra = s.patra.map(klicOsy);
                seznam.forEach(u => {
                    if (u.milnikId || navrhUkoly.indexOf(u) !== -1) return;
                    if (!sdiliTech(tech, u.technologie)) return;
                    if (s.budova && klicOsy(u.budova) !== klicOsy(s.budova)) return;
                    if (patra.indexOf(klicOsy(u.patro)) === -1) return;
                    navrhUkoly.push(u);
                });
            });
            navrhZpusob = !navrhUkoly.length ? "chybi"
                : (segmenty.every(s => s.budova) ? "budova" : "patro");
        }
        const navrh = { zpusob: navrhZpusob, ids: navrhUkoly.map(u => u.id) };
        const zaklad = {
            navrh: navrh, segmenty: segmenty, tech: tech,
            budovy: unikatni(segmenty.map(s => s.budova)),
            patra: unikatni([].concat.apply([], segmenty.map(s => s.patra)))
        };

        const navrhPolozkyPro = (vybrane) => {
            const out = {};
            vybrane.forEach(u => { const n = V.navrhPolozek(m, u); if (n) out[u.id] = n; });
            return out;
        };

        const p = v.potvrzene;
        if (p && Array.isArray(p.ukoly)) {
            const podleId = new Map(seznam.map(u => [u.id, u]));
            const ids = unikatni(p.ukoly.map(String));
            const ukolyP = ids.map(id => podleId.get(id)).filter(Boolean);
            return Object.assign(zaklad, {
                zpusob: String(p.zpusob || "rucne"),
                ukoly: ukolyP,
                polozky: cistePolozky(p.polozky, ids),
                navrhPolozky: navrhPolozkyPro(ukolyP),
                ids: ids,
                // úkol mezitím smazaný – v potvrzení zůstal, stránka ho ukáže
                chybejiciIds: ids.filter(id => !podleId.has(id)),
                potvrzeno: true,
                potvrdil: String(p.potvrdil || ""),
                potvrzenoMs: Number(p.potvrzenoMs) || 0,
                navrhJinak: !stejnaMnozina(navrh.ids, p.navrh)
            });
        }
        return Object.assign(zaklad, {
            zpusob: navrhZpusob, ukoly: navrhUkoly, ids: navrh.ids, chybejiciIds: [],
            potvrzeno: false, potvrdil: "", potvrzenoMs: 0, navrhJinak: false,
            polozky: {}, navrhPolozky: navrhPolozkyPro(navrhUkoly)
        });
    };

    /**
     * Hodiny, peníze a lidé milníku z výkazů na jeho spárovaných úkolech
     * (bez absencí) + budget těch úkolů. Peníze jsou uložené částky
     * zápisů (`castka`), nikdy hodiny × dnešní sazba – stejně jako všude
     * ve výkazech. Funguje nad jakoukoli skupinou úkolů, takže stránka jím
     * sčítá i technologii nebo celý projekt (každý úkol jednou).
     *   m             milník (jeho `id` potřebují jen režimy sdílení);
     *                 null = souhrn skupiny, každá položka jednou
     *   data.ukoly    spárované úkoly (objekty)
     *   data.vykazy   výkazy (stačí ty s ukolId těch úkolů)
     *   data.budgety  KB.ukolBudgety (id → { budgetKc })
     *   data.polozky  výběr položek TO-DO (ukolId → [todoId]); úkol bez
     *                 klíče = celý. Hodiny, Kč i budget úkolu se násobí
     *                 podílem vybraných aktivních položek (3. 11. 2026).
     *   data.sdileni  V.sdileniParovani(…) – který milník bere kterou položku
     *   data.rezimSdileni  co s položkou, kterou bere víc milníků:
     *                 "cely" (výchozí – každý milník ji počítá celou),
     *                 "rovnym-dilem" (dělí se počtem těch milníků),
     *                 "hlavni" (celá jen prvnímu milníku v pořadí, ostatním 0).
     *                 O dělení Michal teprve rozhodne – stránka zatím „cely“.
     * @returns {{ ukolu, hotovych, hotovoPct, hodiny, kc, lide, lideUid, zapisu,
     *   od, do, budget, rozdil, rozpis: [{ id, nazev, cely, vybrano, aktivnich,
     *   podil, polozky, pct, chybi, sdilenoS, hodiny, kc }] }}
     */
    V.vyhodnoceniMilniku = (m, data) => {
        const d = data || {};
        const ukoly = (d.ukoly || []).filter(u => u && u.id);
        const budgety = d.budgety || {};
        const vyber = d.polozky || {};
        const sdileni = d.sdileni || {};
        const rezim = d.rezimSdileni === "rovnym-dilem" || d.rezimSdileni === "hlavni" ? d.rezimSdileni : "cely";
        const mid = (m && m.id) || "";

        const rozpis = ukoly.map(u => {
            const cast = V.castUkolu(u, vyber[u.id]);
            const mapa = sdileni[u.id] || {};
            const jine = new Set();
            let vaha = 0;
            cast.klice.forEach(k => {
                const kdo = mid ? (mapa[k] || [mid]) : [];
                kdo.forEach(x => { if (x !== mid) jine.add(x); });
                // souhrn skupiny (bez milníku) bere každou položku jednou celou
                vaha += !mid || rezim === "cely" ? 1
                    : rezim === "rovnym-dilem" ? 1 / Math.max(1, kdo.length)
                    : ((kdo[0] || mid) === mid ? 1 : 0);
            });
            return {
                id: u.id, nazev: u.nazev || u.id, u: u, cely: cast.cely, vybrano: cast.vybrano,
                aktivnich: cast.aktivnich, polozky: cast.polozky.map(t => String(t.text || "")),
                pct: cast.pct, chybi: cast.chybi, sdilenoS: jine.size,
                podil: vaha / Math.max(1, cast.aktivnich), hodiny: 0, kc: 0
            };
        });
        const podleId = new Map(rozpis.map(r => [r.id, r]));

        let h = 0, kc = 0, zapisu = 0, od = "", doKdy = "";
        const lide = new Set();
        (d.vykazy || []).forEach(z => {
            const r = z && z.ukolId ? podleId.get(z.ukolId) : null;
            if (!r || z.absence === true || !r.podil) return;
            const hz = (Number(z.hodiny) || 0) * r.podil, kz = (Number(z.castka) || 0) * r.podil;
            h += hz; kc += kz; r.hodiny += hz; r.kc += kz;
            zapisu += 1;
            const kdo = z.uid || z.osoba || "";
            if (kdo) lide.add(kdo);
            const den = String(z.datum || "");
            if (den && (!od || den < od)) od = den;
            if (den && (!doKdy || den > doKdy)) doKdy = den;
        });

        // hotovo vážené budgetem jako V.hotovoUkolu – jen z vybraných položek a podílu budgetu
        let budget = 0, vahaPct = 0, soucetPct = 0;
        const sleduje = rozpis.filter(r => V.sledujePlneni(r.u));
        rozpis.forEach(r => {
            const b = V.budgetUkolu(r.u, budgety) * r.podil;
            budget += b;
            if (sleduje.indexOf(r) !== -1) { vahaPct += b; soucetPct += r.pct * b; }
        });
        const hotovoPct = !sleduje.length ? null : Math.round(vahaPct ? soucetPct / vahaPct
            : sleduje.reduce((x, r) => x + r.pct, 0) / sleduje.length);
        const zaokr = (x) => Math.round(x * 100) / 100;

        return {
            ukolu: ukoly.length,
            hotovych: rozpis.filter(r => r.u.stav === "hotovo" || (!r.cely && r.vybrano > 0 && r.pct >= 100)).length,
            hotovoPct: hotovoPct,
            hodiny: zaokr(h),
            kc: Math.round(kc),
            lide: lide.size,
            lideUid: Array.from(lide),
            zapisu: zapisu,
            od: od,
            do: doKdy,
            budget: Math.round(budget),
            rozdil: Math.round(budget - kc),
            rozpis: rozpis.map(r => ({ id: r.id, nazev: r.nazev, cely: r.cely, vybrano: r.vybrano, aktivnich: r.aktivnich,
                podil: r.podil, polozky: r.polozky, pct: r.pct, chybi: r.chybi, sdilenoS: r.sdilenoS,
                hodiny: zaokr(r.hodiny), kc: Math.round(r.kc) }))
        };
    };

    /** Volby do roletky; `prazdne` je popisek nevyplněné položky. */
    V.options = (hodnoty, vybrano, prazdne) =>
        (prazdne ? '<option value="">' + esc(prazdne) + "</option>" : "") +
        (hodnoty || []).map(h => {
            const value = typeof h === "string" ? h : h.value;
            const label = typeof h === "string" ? V.nazevAbsence(h) : h.label;
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
    /* Položka mimo číselník měla dosud šedou – a protože číselník zakázek
       je starý a neúplný, byly šedé skoro všechny grafy. Barva se proto
       odvodí z názvu: je stálá (stejná zakázka má stejnou barvu ve všech
       grafech i po překreslení) a šedá zůstává tomu, čemu patří – „Ostatním"
       a nezařazenému (Michal 25. 9. 2026). */
    const barvaZNazvu = (nazev) => {
        let soucet = 0;
        for (let i = 0; i < nazev.length; i++) soucet = (soucet * 31 + nazev.charCodeAt(i)) % 100003;
        return BARVY[soucet % BARVY.length];
    };

    /** Nezařazené a „Ostatní" jsou vždycky šedé, ať jsou na první pohled vidět. */
    V.barva = (index, nazev) => {
        if (nazev && /nerozřazeno|neurčeno|ostatní|nezařazeno/i.test(nazev)) return SEDA;
        if (index >= 0 && index < BARVY.length) return BARVY[index];
        return nazev ? barvaZNazvu(String(nazev)) : SEDA;
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

        return dobarvi(mapa, poradi);
    };

    /** Společný závěr obou součtů: barvy podle číselníku a řazení podle peněz. */
    function dobarvi(mapa, poradi) {
        const index = (hodnota) => {
            const i = (poradi || []).indexOf(hodnota);
            return i === -1 ? -1 : i;
        };
        return Array.from(mapa.values())
            .map(radek => Object.assign(radek, { barva: V.barva(index(radek.klic), radek.klic) }))
            .sort((a, b) => b.castka - a.castka || b.hodiny - a.hodiny);
    }

    /**
     * Jako `V.podle`, ale pro pole, které nese víc hodnot naráz („TER, VODA").
     * Zápis se mezi ně rozdělí podle podílů práce. Bez toho by v přehledu
     * stál pruh „TER, VODA" vedle pruhů „TER" a „VODA" a nic by se nesečetlo
     * (Michal 4. 9. 2026).
     */
    V.podleCasti = (zaznamy, klic, podilKlic, poradi) => {
        const mapa = new Map();
        (zaznamy || []).forEach(z => {
            const casti = V.casti(z[klic]);
            const kusy = casti.length ? casti : ["Nezařazeno"];
            const podily = V.podily(z[podilKlic], kusy.length);
            kusy.forEach((hodnota, i) => {
                const dil = (podily[i] || 0) / 100;
                if (!mapa.has(hodnota)) {
                    mapa.set(hodnota, { klic: hodnota, hodiny: 0, castka: 0, pocet: 0 });
                }
                const radek = mapa.get(hodnota);
                radek.hodiny += (Number(z.hodiny) || 0) * dil;
                radek.castka += (Number(z.castka) || 0) * dil;
                // počet zápisů, kterých se technologie týkala – ne zlomek zápisu
                radek.pocet += 1;
            });
        });
        return dobarvi(mapa, poradi);
    };

    /**
     * Nejsilnějších N položek zvlášť, zbytek do „Ostatní".
     * Barev máme šest a devátá se vymyslet nedá tak, aby ji od ostatních
     * rozeznal i barvoslepý – proto se chvost slévá, ne že by se dobarvoval.
     */
    V.sesypZbytek = (polozky, kolik) => {
        const limit = kolik || V.POCET_BAREV;
        /* I krátký seznam dostane barvy z palety po pořadí. Barva odvozená
           z názvu (viz V.barva) se dvěma položkám může potkat a v kruhu by
           pak dvě výseče splynuly (Michal 25. 9. 2026). */
        if (polozky.length <= limit + 1) {
            return polozky.map((p, i) => Object.assign({}, p, { barva: V.barva(i, p.klic) }));
        }

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

    /** `extra` = hotové HTML pod poznámkou (řádek „chybí zápis" u přesčasu). */
    V.dlazdice = (label, value, note, money, extra) =>
        '<div class="card vyktile' + (money ? " vyktile--money" : "") + '">' +
            '<div class="vyktile__label">' + esc(label) + "</div>" +
            '<div class="vyktile__value">' + value + "</div>" +
            (note ? '<div class="vyktile__note">' + esc(note) + "</div>" : "") +
            (extra || "") +
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
            const nazev = popisek ? popisek(p.klic) : V.nazevAbsence(p.klic);

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
            const nazev = popisek ? popisek(p.klic) : V.nazevAbsence(p.klic);
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

    /** Buňka CSV, kterou Excel nespustí jako vzorec: text začínající
        = + - @ (nebo tabulátorem či koncem řádku) dostane apostrof.
        Čistá čísla zůstanou – „-3,5" je záporné číslo, ne vzorec. */
    V.bezVzorce = (value) => {
        const text = String(value == null ? "" : value);
        return /^[=+\-@\t\r]/.test(text) && !/^-?\d+(?:[.,]\d+)?$/.test(text) ? "'" + text : text;
    };

    V.csv = (zaznamy) => {
        const bunka = (value) => {
            const text = V.bezVzorce(value);
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

    /* ================================================== TÝDNY A DNY ====
       Čisté funkce bez DOM – testuje je NASTROJE\web\testy\ (Node).
       Počítá se v poledne, ať změna času nikdy neposune den. */

    const jeIso = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ""));
    const isoZData = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0");

    /** Pondělí týdne, do kterého den patří („2026-10-22" → „2026-10-19"). */
    V.pondeli = (iso) => {
        const d = new Date(iso + "T12:00:00");
        d.setDate(d.getDate() - (d.getDay() + 6) % 7);
        return isoZData(d);
    };

    /**
     * Týden podle ISO 8601 („2026-W43"): týden začíná pondělím a patří do
     * roku, ve kterém leží jeho čtvrtek – 1. 1. 2027 (pátek) je ještě
     * „2026-W53". Klíč týdne u kontroly výkazů.
     */
    V.isoTyden = (iso) => {
        const d = new Date(iso + "T12:00:00");
        d.setDate(d.getDate() - (d.getDay() + 6) % 7 + 3);          // čtvrtek týdne
        const rok = d.getFullYear();
        const ctvrty = new Date(rok, 0, 4, 12);                      // 4. 1. je vždy v 1. týdnu
        const tyden = 1 + Math.round(((d - ctvrty) / 864e5 - 3 + (ctvrty.getDay() + 6) % 7) / 7);
        return rok + "-W" + String(tyden).padStart(2, "0");
    };

    /** „13.–19. 10." – týden lidsky, bez roku. */
    V.tydenText = (pondeli) => {
        const ne = V.posunIso(pondeli, 6);
        const [, m1, d1] = pondeli.split("-").map(Number);
        const [, m2, d2] = ne.split("-").map(Number);
        return m1 === m2 ? d1 + ".–" + d2 + ". " + m2 + "."
                         : d1 + ". " + m1 + ". – " + d2 + ". " + m2 + ".";
    };

    /* ------------------------------------------------- kontrola týdne ----
       Značka „zkontrolováno" u týdne člověka (store.js: KB.kontrolaTydne,
       KB.ulozKontroluTydne). Dává ji manažer ve Výkazech a ve Vytížení
       týmu (Týdny); nic nezamyká. */

    /** Značka týdne, do kterého patří den `iso`, nebo null. */
    V.kontrolaTydne = (uid, iso) => (uid && jeIso(iso) && window.KB && window.KB.kontrolaTydne)
        ? window.KB.kontrolaTydne(uid, V.isoTyden(iso)) : null;

    /** „Zkontrolováno – Jméno, 21. 10. 2026" do bubliny. */
    V.kontrolaTitulek = (z) => {
        if (!z) return "";
        const d = new Date(Number(z.ms) || 0);
        return "Zkontrolováno" + (z.kdo ? " – " + z.kdo : "") +
            (Number(z.ms) > 0 ? ", " + d.getDate() + ". " + (d.getMonth() + 1) + ". " + d.getFullYear() : "");
    };

    /**
     * Přepne značku týdne (manažer). Hláška s „Zpět". Vrací true/false.
     * `pondeli` = pondělí týdne, `jmeno` jen do hlášky a do aktivit.
     */
    V.prepniKontroluTydne = async (uid, pondeli, jmeno) => {
        const KB = window.KB, UI = window.KBUI;
        if (!uid || !jeIso(pondeli) || !KB || !KB.ulozKontroluTydne || !UI.can("vykaz.view")) return false;
        const tyden = V.isoTyden(pondeli);
        const bylo = !!V.kontrolaTydne(uid, pondeli);
        const zmen = (ano) => KB.ulozKontroluTydne(uid, pondeli, tyden, ano, jmeno || "");
        try {
            await zmen(!bylo);
            UI.toast((bylo ? "Značka zrušena: " : "Týden zkontrolován: ") +
                (jmeno ? jmeno + ", " : "") + V.tydenText(pondeli), undefined, { zpet: () => zmen(bylo) });
            return true;
        } catch (err) {
            console.error(err);
            UI.toast("Uložení se nepovedlo.", "error");
            return false;
        }
    };

    /** Odpracovaná práce, ne absence (dovolená, nemoc, doktor…). */
    const jePrace = (z) => !!z && z.absence !== true && !V.jeAbsence(z.zakazka);

    /** „08:30" → 510; cokoliv jiného → null. */
    const minutyCasu = (cas) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(cas || "").trim());
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };

    /* ======================================== NÁVRHY ZÁPISU (jako minule) ==
       Rešerše 19. 10. 2026 (Michal schválil 21. 10. 2026): kdo dělá týden na
       jednom patře, píše každý den totéž. Web proto nabídne poslední den
       se zápisem jako NÁVRH – uložit ho musí člověk sám. */

    /**
     * Poslední den PŘED `den`, kdy člověk `uid` zapsal nějakou práci
     * (absence se nepočítá – po dovolené se navrhne poslední pracovní den),
     * a jeho pracovní zápisy toho dne seřazené podle začátku.
     * @returns {{den: string, zapisy: Array}|null}
     */
    V.navrhJakoMinule = (zaznamy, uid, den) => {
        if (!uid || !jeIso(den)) return null;
        let zdroj = "";
        (zaznamy || []).forEach(z => {
            if (!jePrace(z) || z.uid !== uid || !jeIso(z.datum) || z.datum >= den) return;
            if (z.datum > zdroj) zdroj = z.datum;
        });
        if (!zdroj) return null;
        const zapisy = (zaznamy || []).filter(z => jePrace(z) && z.uid === uid && z.datum === zdroj)
            .sort((a, b) => String(a.od || "").localeCompare(String(b.od || "")));
        return { den: zdroj, zapisy: zapisy };
    };

    /**
     * Úkoly k rychlému přidání: na čem člověk `uid` pracoval od pondělí
     * minulého týdne do dne před `den`. Hotové úkoly ne (hodiny na hotový
     * úkol hlásí kontrola podezřelých zápisů) a úkol musí mít projekt.
     * Seřazené podle odpracovaných hodin, nejvýš `kolik` (8).
     * @returns {Array<{ukol: Object, hodin: number, dni: number, posledni: string}>}
     */
    V.navrhyUkolu = (zaznamy, uid, den, ukoly, kolik) => {
        if (!uid || !jeIso(den)) return [];
        const od = V.posunIso(V.pondeli(den), -7);
        const mapa = {};
        (zaznamy || []).forEach(z => {
            if (!jePrace(z) || z.uid !== uid || !z.ukolId || !jeIso(z.datum)) return;
            if (z.datum < od || z.datum >= den) return;
            const m = mapa[z.ukolId] || (mapa[z.ukolId] = { hodin: 0, dny: {}, posledni: "" });
            m.hodin += Number(z.hodiny) || 0;
            m.dny[z.datum] = true;
            if (z.datum > m.posledni) m.posledni = z.datum;
        });
        const podleId = {};
        (ukoly || []).forEach(u => { if (u && u.id) podleId[u.id] = u; });
        return Object.keys(mapa)
            .map(id => ({ ukol: podleId[id], hodin: Math.round(mapa[id].hodin * 100) / 100,
                          dni: Object.keys(mapa[id].dny).length, posledni: mapa[id].posledni }))
            .filter(x => x.ukol && x.ukol.stav !== "hotovo" && x.ukol.projekt)
            .sort((a, b) => b.hodin - a.hodin || b.posledni.localeCompare(a.posledni) ||
                String(a.ukol.nazev || "").localeCompare(String(b.ukol.nazev || ""), "cs"))
            .slice(0, Number(kolik) > 0 ? Number(kolik) : 8);
    };

    /* ================================================ PODEZŘELÉ ZÁPISY ====
       Seznam k odkliknutí pro manažera – dlaždice Upozornění pro kontrolu
       na nástěnce (rešerše 19. 10. 2026, bod 5). Bere jen posledních
       14 dní: starší věci řeší uzávěrka měsíce, ne denní kontrola.

         hodiny   den nad 10 h práce (absence se nepočítá)
         prekryv  dva zápisy téhož člověka v jednom dni přes sebe
         absence  práce v den celodenní absence
         hotovy   hodiny na úkol, který byl ten den už hotový
         vypomoc  zápis na cizí úkol (výpomoc) bez vlastní poznámky
         svatek   absence zapsaná na státní svátek – do přesčasu ani dovolené
                  se nepočítá (Michal 26. 10. 2026) a nově ani nejde zapsat;
                  staré zápisy má manažer vidět a smazat. Proto BEZ okna
                  14 dní: bere se všechno, co je načtené, do dneška.

       Klíč položky (`klic`) si pamatuje odkliknutí „V pořádku" – u starších
       druhů je stejný jako dřív, ať odkliknuté nevyskočí znovu. */

    V.PRAH_DEN_HODIN = 10;
    V.PODEZRELE_DNI = 14;

    /**
     * Den, od kterého byl úkol JISTĚ hotový: den poslední změny hotového
     * úkolu. Kdy přesně hotovo vzniklo, úkol nenese (zaměstnanec smí zapsat
     * jen todo/stav/historii) – ale od poslední změny se nic nestalo, takže
     * v ten den už hotový byl. Kontrola pak hlásí jen zápisy na dny PO něm:
     * spíš něco nenahlásí, než aby hlásila falešně. Úkol, který není
     * hotový, nebo nemá čas změny → "".
     */
    V.ukolHotovyOd = (u) => {
        if (!u || u.stav !== "hotovo" || !(Number(u.updatedMs) > 0)) return "";
        return isoZData(new Date(Number(u.updatedMs)));
    };

    /** Napsal člověk k zápisu něco svého? Poznámka nebo popis práce, který
        nedoplnil web sám (místo, název úkolu). */
    const vlastniText = (z, u) => {
        if (String(z.poznamka || "").trim()) return true;
        const t = String(z.nazev || "").trim();
        if (!t || z.nazevAuto === true) return false;
        return t !== String((u && u.nazev) || "").trim();
    };

    /**
     * Podezřelé zápisy za posledních `dni` dní (včetně `dnes`).
     * @param {Array} zaznamy  výkazy (KB.vykazy)
     * @param {Object} [volby] { dnes, dni, prah, ukoly }
     * @returns {Array<{klic, druh, uid, datum, zapis, duvod, hodiny?, ukolId?}>}
     *   seřazené od nejnovějšího dne; jména doplní stránka
     */
    V.podezreleZapisy = (zaznamy, volby) => {
        const v = volby || {};
        const dnes = jeIso(v.dnes) ? v.dnes : V.dnesISO();
        const dni = Number(v.dni) > 0 ? Number(v.dni) : V.PODEZRELE_DNI;
        const prah = Number(v.prah) > 0 ? Number(v.prah) : V.PRAH_DEN_HODIN;
        const ukoly = v.ukoly || (window.KB && window.KB.ukoly) || [];
        const od = V.posunIso(dnes, -(dni - 1));
        const podleId = {};
        ukoly.forEach(u => { if (u && u.id) podleId[u.id] = u; });

        const out = [];
        const uz = {};
        const pridej = (p) => { if (!uz[p.klic]) { uz[p.klic] = true; out.push(p); } };
        const dny = {};

        (zaznamy || []).forEach(z => {
            if (!z || !z.uid || !jeIso(z.datum) || z.datum > dnes) return;
            const k = z.uid + "|" + z.datum;
            /* Absence na svátek – kdykoliv v načtených datech, jednou za den
               a člověka (týden dovolené přes 28. 10. je jedno hlášení). Jen
               u zaměstnance: OSVČ a student si volno na svátek píšou schválně,
               aby bylo vidět, že nepracovali (Michal 30. 10. 2026). */
            if (V.absenceNaSvatek(z) && V.maFond(V.clovek(z.uid))) {
                pridej({ klic: k + "|svatek", druh: "svatek", uid: z.uid, datum: z.datum,
                    zapis: z.id || "",
                    duvod: "absence zapsaná na státní svátek (" + V.czDatum(z.datum) + " – " +
                        (window.KBUI.svatek(z.datum) || "svátek") + "), do přesčasu ani dovolené se nepočítá" });
            }
            if (z.datum < od) return;
            const den = dny[k] || (dny[k] = { uid: z.uid, datum: z.datum, prace: [], absenceCely: false, hodiny: 0 });
            if (!jePrace(z)) {
                if (z.od === "00:00" && z.do === "23:59") den.absenceCely = true;
                return;
            }
            den.prace.push(z);
            den.hodiny += Number(z.hodiny) || 0;

            const u = z.ukolId ? podleId[z.ukolId] : null;
            if (!u) return;
            const hotovyOd = V.ukolHotovyOd(u);
            if (hotovyOd && z.datum > hotovyOd) {
                pridej({ klic: k + "|hotovy|" + u.id, druh: "hotovy", uid: z.uid, datum: z.datum,
                    zapis: z.id || "", ukolId: u.id,
                    duvod: "hodiny na úkol „" + (u.nazev || "?") + "“, který už byl hotový" +
                        " (nejpozději od " + V.czDatum(hotovyOd) + ")" });
            }
            if ((u.prirazeni || []).indexOf(z.uid) === -1 && !vlastniText(z, u)) {
                pridej({ klic: "vypomoc|" + (z.id || k), druh: "vypomoc", uid: z.uid, datum: z.datum,
                    zapis: z.id || "", ukolId: u.id,
                    duvod: "výpomoc na cizí úkol „" + (u.nazev || "?") + "“ bez poznámky" });
            }
        });

        /* Částka nesedí k hodinám × sazbě: dopočet ručně nastavené částky
           nepřepisuje (Michal 9. 11. 2026), takže když zaměstnanec potom změní
           hodiny, musí si toho všimnout manažer tady. Jen tam, kde peníze vidí
           (sazba > 0 a částka načtená). */
        (zaznamy || []).forEach(z => {
            if (!z || !z.uid || !jeIso(z.datum)) return;
            if (!(Number(z.sazba) > 0) || z.castkaPrace === undefined || z.castkaPrace === null) return;
            if (z.absence === true && z.absencePlacena !== true) return;
            const ma = Math.round((Number(z.hodiny) || 0) * Number(z.sazba) * 100) / 100;
            if (Math.abs(ma - (Number(z.castkaPrace) || 0)) <= 1) return;
            pridej({ klic: z.uid + "|" + z.datum + "|castka|" + (z.id || ""), druh: "castka", uid: z.uid, datum: z.datum,
                zapis: z.id || "",
                duvod: "částka neodpovídá hodinám × sazbě (" + String(Number(z.hodiny) || 0).replace(".", ",") +
                    " h × sazba) – zápis se změnil po ručním nastavení částky, zkontroluj a ulož znovu" });
        });

        Object.keys(dny).forEach(k => {
            const den = dny[k];
            /* Odkaz míří na konkrétní zápis. U nálezu přes celý den stačí
               kterýkoliv, výkazy ukážou celý den (i sousední zápis). */
            const prvni = den.prace[0] || {};
            const hodiny = Math.round(den.hodiny * 100) / 100;
            if (hodiny > prah) {
                pridej({ klic: k + "|hodiny", druh: "hodiny", uid: den.uid, datum: den.datum,
                    zapis: prvni.id || "", hodiny: hodiny,
                    duvod: String(hodiny).replace(".", ",") + " h za jeden den (víc než " + prah + " h)" });
            }
            if (den.absenceCely && den.prace.length) {
                pridej({ klic: k + "|absence", druh: "absence", uid: den.uid, datum: den.datum,
                    zapis: prvni.id || "", duvod: "výkaz práce v den celodenní absence" });
            }
            /* Překryv: podle začátku, a s tím, co ZATÍM končí nejpozději –
               jen se sousedem by 8–16 a 15–17 za kratším 9–10 prošlo. Práce
               přes půlnoc zabírá den do konce. Jeden den = jedno hlášení. */
            const sCasy = den.prace
                .map(z => ({ z: z, a: minutyCasu(z.od), b: minutyCasu(z.do) }))
                .filter(x => x.a !== null && x.b !== null && x.a !== x.b)
                .map(x => ({ z: x.z, a: x.a, b: x.b > x.a ? x.b : 24 * 60 }))
                .sort((p, q) => p.a - q.a || p.b - q.b);
            let nejdel = null;
            for (let i = 0; i < sCasy.length; i++) {
                const x = sCasy[i];
                if (nejdel && x.a < nejdel.b) {
                    pridej({ klic: k + "|prekryv", druh: "prekryv", uid: den.uid, datum: den.datum,
                        zapis: x.z.id || "",
                        duvod: "dva zápisy přes sebe (" + nejdel.z.od + "–" + nejdel.z.do + " a " +
                            x.z.od + "–" + x.z.do + ")" });
                    break;
                }
                if (!nejdel || x.b > nejdel.b) nejdel = x;
            }
        });

        const PORADI = { hodiny: 0, prekryv: 1, svatek: 2, absence: 3, hotovy: 4, vypomoc: 5 };
        return out.sort((a, b) => b.datum.localeCompare(a.datum) ||
            String(a.uid).localeCompare(String(b.uid)) || PORADI[a.druh] - PORADI[b.druh]);
    };

    /* ============================================ UZÁVĚRKA MĚSÍCE ======
       Michal 12. 11. 2026 (Iris): před uzavřením měsíce si finance připraví
       výpis – snímek měsíce (stránka uzaverka.html, dokument
       private/uzaverky/mesice/{RRRR-MM}): hodiny po lidech a zakázkách,
       nepřítomnosti a co z nich není potvrzené, přesčas zaměstnanců
       k poslednímu dni měsíce, chybějící a krátké dny, podezřelé zápisy i
       s tím, kdo je odklikl, výplaty dohod / OSVČ / studentů a čerpání
       rozpočtů. Po uzavření se živá data porovnávají se snímkem
       (V.uzaverkaRozdily). Počítá se ze stejných V.* jako zbytek webu, ať
       čísla sedí s Výkazy, Výplatami i nástěnkou. Hlídá
       NASTROJE\web\testy\test_uzaverka.js. */

    const na1 = (x) => Math.round((Number(x) || 0) * 10) / 10;

    /**
     * Snímek měsíce podle datového modelu uzávěrky (bez stav, kontrola,
     * uzavreno, odemknul, sesity a updated* – ty píše stránka a store).
     * @param {string} mesic "RRRR-MM"
     * @param {Object} d { zaznamy (KB.vykazy), lide (KB.users), zustatky (KB.zustatky),
     *   kalendar (KB.kalendar), vyplaty (KB.vyplaty), kontrolaOk (KB.kontrolaOk),
     *   nastaveni: { rozpocty (KB.rozpocty), dpp (KB.dppNastaveni) }, dnes (ISO, nepovinné),
     *   vytvoril, vytvorilUid, ms (nepovinné) } – co chybí, bere se z window.KB
     * @returns {Object|null} null pro nesmyslný měsíc
     */
    V.uzaverkaMesice = (mesic, d) => {
        const r = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mesic || "")) ? V.mesicRozsah(mesic) : { od: "" };
        if (!r.od) return null;
        const o = d || {};
        const n = o.nastaveni || {};
        /* Zůstatek, chybějící dny, lidé i podezřelé zápisy čtou window.KB.
           Na dobu výpočtu (synchronní, nic jiného mezitím neběží) se jim
           podstrčí data z `d`, ať snímek stojí jen na tom, co stránka předala;
           zbytek KB (úkoly, okno výkazů) zůstává vidět. */
        const puvodni = window.KB || {};
        const kb = Object.create(puvodni);
        const podstrc = { vykazy: o.zaznamy, users: o.lide, zustatky: o.zustatky, kalendar: o.kalendar,
            vyplaty: o.vyplaty, kontrolaOk: o.kontrolaOk, rozpocty: n.rozpocty, dppNastaveni: n.dpp };
        Object.keys(podstrc).forEach(k => { if (podstrc[k] !== undefined) kb[k] = podstrc[k]; });
        window.KB = kb;
        try { return snimekMesice(mesic, r, o, kb); } finally { window.KB = puvodni; }
    };

    function snimekMesice(mesic, r, o, KB) {
        const dnes = jeIso(o.dnes) ? o.dnes : V.dnesISO();
        // běžící měsíc jen do včerejška – dnešek se ještě dopisuje (jako fond u přesčasu)
        const konec = r.do < dnes ? r.do : V.posunIso(dnes, -1);
        const vsechny = KB.vykazy || [];
        const vMesici = vsechny.filter(z => z && z.uid && String(z.datum || "") >= r.od && String(z.datum || "") <= r.do);
        const doKonceMesice = vsechny.filter(z => z && String(z.datum || "") <= r.do);
        const ok = KB.kontrolaOk || {};
        const podezrele = V.podezreleZapisy(vsechny, { dnes: r.do, dni: Number(r.do.slice(8, 10)) })
            .filter(p => p.datum >= r.od && p.datum <= r.do);

        // kdo už ve firmě není, ale v měsíci pracoval, do uzávěrky patří
        const lide = V.lide();
        const sZapisem = new Set(vMesici.map(z => z.uid));
        (KB.users || []).forEach(u => {
            if (u && u.active === false && sZapisem.has(u.id) && !window.KBUI.jeSluzebni(u)) lide.push(u);
        });

        const vysledek = lide.map(u => {
            const uid = u.id;
            const typ = window.KBUI.typUvazku(u);
            const moje = vMesici.filter(z => z.uid === uid);
            const prace = moje.filter(jePrace);

            const zak = new Map();
            prace.forEach(z => {
                const k = String(z.zakazka || "").trim() || "Nezařazeno";
                zak.set(k, (zak.get(k) || 0) + (Number(z.hodiny) || 0));
            });
            const zakazky = Array.from(zak, ([nazev, h]) => ({ nazev: nazev, hodiny: na1(h) }))
                .sort((a, b) => b.hodiny - a.hodiny || a.nazev.localeCompare(b.nazev, "cs"));

            // nepotvrzené = stejně jako výpis pro mzdovou (dovolená, volno, neplacené volno)
            const abs = new Map();
            moje.filter(zapisAbsence).forEach(z => {
                const druh = String(z.zakazka || "").trim();
                const a = abs.get(druh) || { druh: druh, dny: new Set(), hodiny: 0, nepotvrzeno: new Set() };
                a.dny.add(z.datum);
                a.hodiny += Number(z.hodiny) || 0;
                const typK = MZDY_TYP_KALENDARE[druh];
                if (typK && MZDY_POTVRZUJE[typK] && !denPotvrzen(KB.kalendar, uid, typK, z.datum)) a.nepotvrzeno.add(z.datum);
                abs.set(druh, a);
            });
            const absence = Array.from(abs.values())
                .sort((a, b) => V.ABSENCE.indexOf(a.druh) - V.ABSENCE.indexOf(b.druh))
                .map(a => ({ druh: a.druh, dny: Array.from(a.dny).sort(), hodiny: na1(a.hodiny),
                    nepotvrzeno: Array.from(a.nepotvrzeno).sort() }));

            const zu = (KB.zustatky || {})[uid] || {};
            let prescas = null;
            if (V.prescasVeden(uid) && jeIso(zu.odIso) && zu.odIso <= konec) {
                const s = V.zustatek(uid, konec);
                // bez jediného zápisu by vyšel mínus celého fondu (jako pomlčka v dlaždici)
                if (!s.bezZapisu) prescas = { konec: s.prescas, fond: s.fond, prace: s.prace,
                    absence: s.absenceHodin, pred: Number(zu.prescasPred) || 0 };
            }

            /* Chybějící a krátké dny jen tomu, koho hlídá i Apps Script
               (zaměstnanec s přesčasem a začátkem počítání, ne „nepracuje“ ani
               odešlý; V.chybejiciDny se zadaným `od` začátek počítání nehlídá).
               Do krátkého dne se počítají všechny hodiny dne včetně Volna –
               celý den náhradního volna není krátký den, jen čerpá přesčas. */
            const hlidany = V.maFond(u) && jeIso(zu.odIso) && zu.bezPrescasu !== true &&
                u.nepracuje !== true && u.active !== false;
            const chybi = hlidany ? V.chybejiciDny(uid, konec, r.od) : [];
            // jedna logika s hlídkou krátkých dnů (V.kratkeDnyCloveka, Michal 12. 11. 2026)
            const kratke = hlidany
                ? V.kratkeDnyCloveka(uid, zu.odIso > r.od ? zu.odIso : r.od, konec)
                    .map(k => ({ datum: k.datum, hodiny: na1(k.hodiny) }))
                : [];

            // starší odkliknutí bez jména (společný dokument) nese "?"
            const mojePodezrele = podezrele.filter(p => p.uid === uid).map(p => ({
                klic: p.klic, datum: p.datum, druh: p.druh, text: p.duvod,
                ok: ok[p.klic] ? (ok[p.klic].length ? ok[p.klic].slice() : ["?"]) : [] }));

            let vyplata = null, bezDokumentu = false;
            // zaměstnanec (mzda, 12. 11. 2026) jen když dokument měsíce existuje – bez něj „bezDokumentu“ nehlásí
            if (V.jeVyplatnyTyp(u) || typ === "zamestnanec") {
                // uložený dokument měsíce – po proplacení se čísla nehýbou s výkazy
                const dok = V.vyplataDokument(KB.vyplaty, uid, mesic);
                if (!dok) bezDokumentu = V.jeVyplatnyTyp(u);
                else vyplata = { narok: na2(dok.narok), prenos: na2(dok.prenos), kVyplate: na2(dok.kVyplate),
                    proplacenoCelkem: na2(dok.proplacenoCelkem), zbyva: na2(dok.zbyva), uzavreno: !!dok.uzavreno,
                    limit: (dok.typ || typ) === "dpp"
                        ? V.limitDpp(V.hodinyRoku(doKonceMesice, uid, mesic.slice(0, 4)), V.dppKcMesice(dok), KB.dppNastaveni)
                        : null };
            }

            const c = { uid: uid, jmeno: V.jmeno(u), typ: typ,
                hodiny: na1(prace.reduce((s, z) => s + (Number(z.hodiny) || 0), 0)),
                zakazky: zakazky, absence: absence, prescas: prescas, chybi: chybi, kratke: kratke,
                podezrele: mojePodezrele, vyplata: vyplata };
            if (bezDokumentu) c.bezDokumentu = true;
            if (u.nepracuje === true) c.nepracuje = true;
            return c;
        });

        /* Rozpočty: zakázky s prací v měsíci; čerpání celkem ke konci měsíce
           stejným výpočtem jako Ekonomika (V.ekonomikaZakazky) – jen práce,
           bez externích nákladů a faktur (ty se tu nenačítají). */
        const zakMesic = new Map();
        vMesici.filter(jePrace).forEach(z => {
            const k = String(z.zakazka || "").trim();
            if (!k) return;
            const a = zakMesic.get(k) || { h: 0, kc: 0 };
            a.h += Number(z.hodiny) || 0;
            a.kc += Number(z.castka) || 0;
            zakMesic.set(k, a);
        });
        const rozpocty = Array.from(zakMesic, ([zakazka, a]) => {
            const e = V.ekonomikaZakazky(zakazka, { vykazy: doKonceMesice, faktury: null, dnes: r.do });
            return { zakazka: zakazka, hodiny: na1(a.h), kc: Math.round(a.kc), rozpocetKc: e.rozpocet,
                pct: e.cerpaniPct === null ? null : na1(e.cerpaniPct) };
        }).sort((a, b) => b.hodiny - a.hodiny || a.zakazka.localeCompare(b.zakazka, "cs"));

        const soucet = (f) => vysledek.reduce((s, c) => s + f(c), 0);
        return {
            mesic: mesic, od: r.od, do: r.do,
            vytvorenoMs: Number(o.ms) || Date.now(), vytvoril: String(o.vytvoril || ""),
            vytvorilUid: String(o.vytvorilUid || ""),
            lide: vysledek,
            rozpocty: rozpocty,
            souhrn: {
                lidi: vysledek.length,
                hodiny: na1(soucet(c => c.hodiny)),
                chybiCelkem: soucet(c => c.chybi.length),
                nepotvrzenoCelkem: soucet(c => c.absence.reduce((s, a) => s + a.nepotvrzeno.length, 0)),
                podezrelychCelkem: soucet(c => c.podezrele.length),
                kratkychCelkem: soucet(c => c.kratke.length)
            }
        };
    }

    /**
     * Co se změnilo po uzávěrce: snímek × nový V.uzaverkaMesice z živých dat.
     * Hodiny práce, dny absencí, chybějící dny, výplata „zbývá“, nové podezřelé.
     * @returns {{uid, jmeno, text}[]} jedna položka = jedna změna; prázdné = nic
     */
    V.uzaverkaRozdily = (snimek, zivy) => {
        const out = [];
        const pred = new Map(((snimek && snimek.lide) || []).map(c => [c.uid, c]));
        const ted = new Map(((zivy && zivy.lide) || []).map(c => [c.uid, c]));
        const nekdo = (c) => !!c && (c.hodiny > 0 || (c.absence || []).length > 0);
        const dnyText = (dny) => dny.map(d => Number(d.slice(8, 10)) + ". " + Number(d.slice(5, 7)) + ".").join(", ");
        const zmenaDnu = (pred, ted) => {
            const p = new Set(pred), t = new Set(ted);
            const plus = Array.from(t).filter(x => !p.has(x)).sort();
            const minus = Array.from(p).filter(x => !t.has(x)).sort();
            const casti = [];
            if (plus.length) casti.push("přibylo " + dnyText(plus));
            if (minus.length) casti.push("ubylo " + dnyText(minus));
            return casti.join(", ");
        };
        const dnyDruhu = (c) => {
            const m = new Map();
            (c.absence || []).forEach(a => m.set(a.druh, new Set(a.dny || [])));
            return m;
        };
        new Set([...pred.keys(), ...ted.keys()]).forEach(uid => {
            const s = pred.get(uid), z = ted.get(uid);
            const pridej = (text) => out.push({ uid: uid, jmeno: (z || s).jmeno || uid, text: text });
            // nový člověk bez práce ani odešlý bez zápisů nejsou změna měsíce
            if (!s) { if (nekdo(z)) pridej("nově v měsíci: " + V.hod(z.hodiny) + " práce"); return; }
            if (!z) { if (nekdo(s)) pridej("zápisy měsíce zmizely (bylo " + V.hod(s.hodiny) + " práce)"); return; }

            if (na1(s.hodiny) !== na1(z.hodiny)) pridej("hodiny práce " + V.hod(s.hodiny) + " → " + V.hod(z.hodiny));

            const ap = dnyDruhu(s), az = dnyDruhu(z);
            new Set([...ap.keys(), ...az.keys()]).forEach(druh => {
                const text = zmenaDnu(ap.get(druh) || [], az.get(druh) || []);
                if (text) pridej(V.nazevAbsence(druh) + ": " + text);
            });

            const chybi = zmenaDnu(s.chybi || [], z.chybi || []);
            if (chybi) pridej("dny bez výkazu: " + chybi);

            const zb1 = s.vyplata ? na2(s.vyplata.zbyva) : null, zb2 = z.vyplata ? na2(z.vyplata.zbyva) : null;
            if (zb1 !== zb2) pridej("výplata zbývá " + (zb1 === null ? "—" : V.kc(zb1)) + " → " + (zb2 === null ? "—" : V.kc(zb2)));

            const znam = new Set((s.podezrele || []).map(p => p.klic));
            (z.podezrele || []).filter(p => !znam.has(p.klic)).forEach(p =>
                pridej("nový podezřelý zápis " + V.czDatum(p.datum) + ": " + p.text));
        });
        return out;
    };

    /** „Jan Novák“ → „J. Novák“ (příjmení celé, křestní zkráceně). */
    const kratkeJmeno = (jmeno) => {
        const casti = String(jmeno || "").trim().split(/\s+/);
        return casti.length > 1 ? casti[0].charAt(0) + ". " + casti.slice(1).join(" ") : casti.join(" ");
    };
    const NEPOTVRZENO_TEXT = { "Dovolená": "nepotvrzená dovolená", "Volno": "nepotvrzené " + V.nazevAbsence("Volno").toLowerCase(),
        "Neplacené volno": "nepotvrzené neplacené volno" };
    const UZAVERKA_TEXT_MAX = 300;

    /**
     * Text Quick TO-DO „komu co chybí“ (hlídka 3. v měsíci) – nejvýš 300 znaků;
     * kdo se nevejde, schová se do „a další N“. Kdo nic nemá, v textu není.
     */
    V.uzaverkaChybiText = (snimek) => {
        const s = snimek || {};
        const zacatek = "Uzávěrka za " + (V.mesicText(s.mesic) || s.mesic || "?");
        const tvaryDne = ["den", "dny", "dní"];
        const polozky = [];
        (s.lide || []).forEach(c => {
            const co = [];
            if ((c.chybi || []).length) co.push(V.pocet(c.chybi.length, tvaryDne) + " bez výkazu");
            if ((c.kratke || []).length) co.push(V.pocet(c.kratke.length, tvaryDne) + " pod 8 h");
            (c.absence || []).forEach(a => {
                const n = (a.nepotvrzeno || []).length;
                if (n) co.push((NEPOTVRZENO_TEXT[a.druh] || "nepotvrzeno: " + a.druh) + " (" + V.pocet(n, tvaryDne) + ")");
            });
            if (co.length) polozky.push(kratkeJmeno(c.jmeno) + " " + co.join(", "));
        });
        if (!polozky.length) return zacatek + ": výkazy kompletní, nic nechybí.";
        let text = zacatek + " – komu co chybí: " + polozky[0];
        for (let i = 1; i < polozky.length; i++) {
            const zbyva = polozky.length - i - 1;
            const dalsi = text + "; " + polozky[i];
            // místo na „; a další N“ musí zbýt, dokud ještě někdo zbývá
            if ((dalsi + (zbyva ? "; a další " + zbyva : "")).length > UZAVERKA_TEXT_MAX) {
                return (text + "; a další " + (polozky.length - i)).slice(0, UZAVERKA_TEXT_MAX);
            }
            text = dalsi;
        }
        return text.slice(0, UZAVERKA_TEXT_MAX);
    };
})();
