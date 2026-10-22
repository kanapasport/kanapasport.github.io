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
       `absence`, ale přehledy pracují i s holými názvy zakázek. */
    V.ABSENCE = ["Dovolená", "Volno", "Nemoc", "Doktor", "Školení"];
    V.jeAbsence = (nazev) => V.ABSENCE.indexOf(String(nazev || "").trim()) !== -1;

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

        /* Přesčas stejně jako ve Vytížení: odpracováno + absence − fond.
           Absence se počítá jako odpracovaný čas, jinak by týden dovolené
           shodil přesčas o 40 hodin do mínusu.

           Počítají se její SKUTEČNÉ hodiny, ne plná směna. Celodenní
           absence jich stejně nese osm, ale u částečné (návštěva doktora
           ráno a odpoledne práce) se dřív připsalo osm hodin k tomu, co
           člověk ten den odpracoval – a z osmihodinového dne vyšel přesčas
           +6,5 h. Marcela si toho všimla 14. 10. 2026; stejně nafouklý
           přesčas měli i Jakub (+12 h) a Dominik (+5,5 h). */
        const absence = moje.filter(v => v.absence === true);
        const absenceDnu = absence.length;
        const absenceHodin = absence.reduce((n, v) => n + (Number(v.hodiny) || 0), 0);
        const prace = moje.filter(v => v.absence !== true)
            .reduce((n, v) => n + (Number(v.hodiny) || 0), 0);
        const fond = V.fondHodin(od, dnes);
        const prescas = (Number(z.prescasPred) || 0) + prace + absenceHodin - fond;

        /* Kdo za celé období nemá ani jeden zápis, tomu přesčas spočítat
           nejde: vyšel by mínus ve výši celého fondu a vypadalo by to, že
           firmě dluží půl roku. Takový člověk hodiny na web prostě nepíše
           (Michal 8. 10. 2026). */
        const bezZapisu = !moje.length;

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
            bezZapisu: bezZapisu,
            bezPrescasu: z.bezPrescasu === true,
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
        dovolena: "termín v dovolené", volno: "termín ve volnu", nemoc: "v den termínu nepřítomen",
        doktor: "v den termínu nepřítomen", skoleni: "v den termínu na školení"
    };
    const NEPRITOMNOST_DRUH = {
        dovolena: "dovolenou", volno: "volno", nemoc: "nemoc", doktor: "lékaře", skoleni: "školení"
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
            k && k.uid === uid && NEPRITOMNOST_STITEK[k.typ] && k.celyDen !== false &&
            String(k.od || "") <= den && den <= String(k.do || k.od || ""));
        if (!zaznam) return null;
        const kdo = V.clovek(uid);
        const jmeno = (kdo ? V.jmeno(kdo) : "") || zaznam.osoba || "Zpracovatel";
        const rozsah = zaznam.do && zaznam.do !== zaznam.od
            ? V.czDatum(zaznam.od) + " – " + V.czDatum(zaznam.do) : V.czDatum(zaznam.od);
        const nepotvrzena = (zaznam.typ === "dovolena" || zaznam.typ === "volno") && zaznam.potvrzeno !== true;
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
            if (!z || !z.uid || !jeIso(z.datum) || z.datum < od || z.datum > dnes) return;
            const k = z.uid + "|" + z.datum;
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

        const PORADI = { hodiny: 0, prekryv: 1, absence: 2, hotovy: 3, vypomoc: 4 };
        return out.sort((a, b) => b.datum.localeCompare(a.datum) ||
            String(a.uid).localeCompare(String(b.uid)) || PORADI[a.druh] - PORADI[b.druh]);
    };
})();
