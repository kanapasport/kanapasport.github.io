/* ==========================================================================
   Mini okno – rychlý zápis dnešních hodin bez otevírání celé stránky
   výkazů (mini.html). Vzor je mini okno osobní aplikace; tři podoby:

     a) malá stránka mini.html (~360 × 640) – v záložce i na telefonu;
     b) samostatné malé okno – z pásu („Mini okno"), zkratkou Alt+Shift+M
        (ui.js UI.otevriMiniOkno → window.open popup „kb-mini") a zástupcem
        „Mini okno" na ikoně nainstalované aplikace (manifest shortcuts →
        mini.html; okno ze zástupce se samo zmenší);
     c) plovoucí okno vždy navrchu – Document Picture-in-Picture (Chrome
        a Edge 116+). Kořen #mini se do něj PŘESUNE i se svými posluchači
        a po zavření se vrátí. Bez API se tlačítko vůbec neukáže.

   Zápis jde STEJNOU cestou jako formulář ve vykazy.html (ulozDen):
   manažer KB.saveVykaz se sazbou podle V.sazbaProZapis, ostatní
   KB.saveMujVykaz – aktivita, propis do Tabulek i dopočet částek se tak
   chovají stejně. Hlídá se totéž co tam: uzávěrka (KB.uzaverkaOd) pro
   nemanažera, druh vypracování u práce na zakázce a úkol tam, kde má
   člověk na projektu svoje úkoly. Lhůta týdne se neřeší – píše se dnešek.

   Všechno do innerHTML jde přes KBUI.esc. Posluchače visí na kořeni, ne
   na `document` – v plovoucím okně je document jiný.
   ========================================================================== */

(function () {
    "use strict";

    /* Okno mini si zkratku Alt+Shift+M vyřídí samo (zpátky na celý web);
       ui.js ji tady proto neotvírá znovu. */
    window.KB_MINI = true;

    /* =================================================== ČISTÁ LOGIKA ====
       Bez DOM a bez databáze – ověřuje se v Node. */

    const HODIN_ZA_DEN = 8;
    const ZACATEK_DNE = "07:00";     // jako vykazy.html, když z historie nic nevyjde
    const DNI_ZPET = 14;             // „na co jsem psal" – tolik dní dozadu
    const DNI_OBVYKLE = 30;          // obvyklý začátek – stejně jako týdenní zápis ve výkazech
    /* Režie se fakturuje vlastní firmě – stejná hodnota jako ve vykazy.html. */
    const REZIE_FIRMA = "Pasport Kaňa s.r.o.";

    const pad = (n) => String(n).padStart(2, "0");

    /** „08:30" → 510; nesmysl → null. */
    function minuty(cas) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(cas || "").trim());
        if (!m) return null;
        const h = Number(m[1]), min = Number(m[2]);
        return (h > 23 || min > 59) ? null : h * 60 + min;
    }

    const casZMinut = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);

    /** Čas na nejbližší čtvrthodinu – 10:07 → 10:00, 10:08 → 10:15, 23:53 → 23:45. */
    function zaokrouhliCas(datum) {
        let m = Math.round((datum.getHours() * 60 + datum.getMinutes() + datum.getSeconds() / 60) / 15) * 15;
        if (m >= 24 * 60) m = 24 * 60 - 15;
        return casZMinut(m);
    }

    const isoDne = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

    function posunDny(iso, dny) {
        const d = new Date(iso + "T00:00:00");
        d.setDate(d.getDate() + dny);
        return isoDne(d);
    }

    const fold = (text) => String(text || "").toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "");

    /** Celodenní absence stojí v časech 00:00–23:59 – do navazování nepatří. */
    const celodenni = (z) => z.od === "00:00" && z.do === "23:59";

    /** Zápis s použitelným časem od–do (bez práce přes půlnoc a celého dne). */
    function rozsah(z) {
        if (!z || celodenni(z)) return null;
        const a = minuty(z.od), b = minuty(z.do);
        return (a === null || b === null || b <= a) ? null : { od: a, do: b };
    }

    /** Konec posledního dnešního zápisu („14:30"), nebo "". */
    function konecDne(zapisy) {
        let nej = -1;
        (zapisy || []).forEach(z => {
            const r = rozsah(z);
            if (r && r.do > nej) nej = r.do;
        });
        return nej < 0 ? "" : casZMinut(nej);
    }

    /**
     * Obvyklý začátek práce – stejné pravidlo jako týdenní zápis ve
     * výkazech: medián prvních časů dne za posledních DNI_OBVYKLE dní
     * (bez absencí), u sudého počtu dřívější z prostředních. Bez historie
     * firemní 07:00.
     */
    function obvyklyZacatek(zapisy, dnes, jeAbsence) {
        const od = posunDny(dnes, -DNI_OBVYKLE);
        const prvni = {};
        (zapisy || []).forEach(z => {
            if (!z.datum || z.datum < od || z.datum > dnes) return;
            if (z.absence === true || celodenni(z) || (jeAbsence && jeAbsence(z.zakazka))) return;
            const m = minuty(z.od);
            if (m === null) return;
            if (prvni[z.datum] === undefined || m < prvni[z.datum]) prvni[z.datum] = m;
        });
        const casy = Object.keys(prvni).map(k => prvni[k]).sort((a, b) => a - b);
        return casy.length ? casZMinut(casy[Math.floor((casy.length - 1) / 2)]) : ZACATEK_DNE;
    }

    /** Má člověk na den nahlášený home office (kalendář, typ „homeoffice")? Jako výkazy. */
    const hoNahlaseno = (kalendar, uid, datum) => (kalendar || []).some(k =>
        k.typ === "homeoffice" && k.uid === uid && (k.od || "") <= datum && datum <= (k.do || k.od || ""));

    /** Nahlášená dovolená nebo volno na den – výkazy na to upozorňují červeně. */
    const volnoNahlaseno = (kalendar, uid, datum) => (kalendar || []).find(k =>
        (k.typ === "dovolena" || k.typ === "volno") && k.uid === uid &&
        (k.od || "") <= datum && datum <= (k.do || k.od || "")) || null;

    /**
     * Předvyplnění času: od = konec posledního dnešního zápisu, jinak
     * obvyklý začátek; do = teď na čtvrthodinu. Když by „do" nebylo po „od",
     * zůstane prázdné – nulový zápis nikomu nepomůže.
     */
    function predvyplnCasy(dnesniZapisy, ted, obvykly) {
        const od = konecDne(dnesniZapisy) || obvykly || ZACATEK_DNE;
        let doCas = zaokrouhliCas(ted);
        if (minuty(doCas) <= minuty(od)) doCas = "";
        return { od: od, do: doCas };
    }

    /** Dnešní zápisy, se kterými se rozsah od–do překrývá. */
    function prekryvy(od, doCas, zapisy) {
        const a = minuty(od), b = minuty(doCas);
        if (a === null || b === null || b <= a) return [];
        return (zapisy || []).filter(z => {
            const r = rozsah(z);
            return r && a < r.do && b > r.od;
        });
    }

    const mistoText = (d) => [d.budova, d.patro, d.technologie].filter(Boolean).join(" · ");

    /**
     * Volby rychlého zápisu – co se dá vybrat jedním klepnutím:
     *   1. „naposledy": na co jsem psal posledních DNI_ZPET dní, nejnovější
     *      první – úkol i s místem (budova, patro, technologie), zakázka bez
     *      úkolu i režie;
     *   2. „moje": moje otevřené úkoly, na které jsem zatím nepsal;
     *   3. „rezie": Administrativa, Porada (a Web jen hlavnímu správci).
     * Zakázka bez úkolu se nenabízí tam, kde mám na projektu otevřené úkoly –
     * výkaz by ji neuložil („zápis se váže k úkolu"). Zavřený úkol taky ne.
     *
     * v = { uid, dnes, ukoly, vykazy, rezieNabidka, jeRezie, jeAbsence }
     */
    function sestavVolby(v) {
        const uid = v.uid;
        const ukoly = v.ukoly || [];
        const jeRezie = v.jeRezie || (() => false);
        const jeAbsence = v.jeAbsence || (() => false);
        const rezieNabidka = v.rezieNabidka || [];
        const odDne = posunDny(v.dnes, -DNI_ZPET);

        const podleId = {};
        ukoly.forEach(u => { if (u && u.id) podleId[u.id] = u; });
        const otevreny = (u) => !!u && u.stav !== "hotovo";
        const muj = (u) => (u.prirazeni || []).indexOf(uid) !== -1;
        const mamUkolyProjektu = (zakazka) =>
            ukoly.some(u => u.projekt === zakazka && otevreny(u) && muj(u));

        function volbaUkolu(u, z) {
            /* Co úkol určuje, platí vždycky (ve výkazu se to zamkne). Zbytek
               místa se vezme ze zápisu, kterým na úkol psal naposledy. */
            const d = {
                zakazka: u.projekt || "",
                ukolId: u.id,
                cinnost: (z && z.cinnost) || u.druh || "",
                technologie: u.technologie || (z && z.technologie) || "",
                podilTech: u.technologie ? "" : ((z && z.podilTech) || ""),
                budova: u.budova || (z && z.budova) || "",
                patro: u.patro || (z && z.patro) || "",
                podilPatra: u.patro ? "" : ((z && z.podilPatra) || "")
            };
            return {
                klic: "u:" + u.id + "|" + d.budova + "|" + d.patro + "|" + d.technologie,
                typ: "ukol",
                nazev: u.nazev || "Úkol bez názvu",
                popis: [d.zakazka, mistoText(d)].filter(Boolean).join(" · "),
                cizi: !muj(u),
                data: d
            };
        }

        function volbaZapisu(z) {
            const d = {
                zakazka: z.zakazka || "", ukolId: "",
                cinnost: z.cinnost || "",
                technologie: z.technologie || "", podilTech: z.podilTech || "",
                budova: z.budova || "", patro: z.patro || "", podilPatra: z.podilPatra || "",
                firma: z.firma || ""
            };
            return {
                klic: "z:" + [d.zakazka, d.budova, d.patro, d.technologie].join("|"),
                typ: "zakazka",
                nazev: d.zakazka,
                popis: [d.cinnost, mistoText(d)].filter(Boolean).join(" · ") || "bez úkolu",
                cizi: false,
                data: d
            };
        }

        const volbaRezie = (nazev) => ({
            klic: "r:" + nazev, typ: "rezie", nazev: nazev, popis: "režie", cizi: false,
            data: { zakazka: nazev, ukolId: "", cinnost: "", technologie: "", podilTech: "",
                    budova: "", patro: "", podilPatra: "" }
        });

        const volby = [];
        const znam = {};
        const pridej = (volba, skupina, posledne) => {
            if (!volba || znam[volba.klic]) return;
            znam[volba.klic] = true;
            volba.skupina = skupina;
            volba.naposledy = posledne || "";
            volby.push(volba);
        };

        (v.vykazy || [])
            .filter(z => z && z.uid === uid && z.datum >= odDne && z.datum <= v.dnes &&
                z.absence !== true && !jeAbsence(z.zakazka))
            .sort((a, b) => (b.datum || "").localeCompare(a.datum || "") ||
                (b.od || "").localeCompare(a.od || "") ||
                (Number(b.createdMs) || 0) - (Number(a.createdMs) || 0))
            .forEach(z => {
                if (z.ukolId) {
                    const u = podleId[z.ukolId];
                    if (otevreny(u)) pridej(volbaUkolu(u, z), "naposledy", z.datum);
                } else if (jeRezie(z.zakazka)) {
                    if (rezieNabidka.indexOf(z.zakazka) !== -1) {
                        pridej(volbaRezie(z.zakazka), "naposledy", z.datum);
                    }
                } else if (z.zakazka && !mamUkolyProjektu(z.zakazka)) {
                    pridej(volbaZapisu(z), "naposledy", z.datum);
                }
            });

        ukoly.filter(u => otevreny(u) && muj(u))
            .sort((a, b) => ((a.termin || "9999") > (b.termin || "9999") ? 1 :
                             (a.termin || "9999") < (b.termin || "9999") ? -1 : 0) ||
                String(a.nazev || "").localeCompare(String(b.nazev || ""), "cs"))
            .forEach(u => {
                /* Úkol, na který už psal, je nahoře i s místem – druhou
                   (holou) volbou by se seznam jen zdvojoval. */
                const uzJe = volby.some(x => x.typ === "ukol" && x.data.ukolId === u.id);
                if (!uzJe) pridej(volbaUkolu(u, null), "moje");
            });

        rezieNabidka.forEach(nazev => pridej(volbaRezie(nazev), "rezie"));
        return volby;
    }

    /** Hledání po slovech bez diakritiky – každé slovo musí sedět (jako našeptávač webu). */
    function filtrujVolby(volby, dotaz) {
        const slova = fold(dotaz).trim().split(/\s+/).filter(Boolean);
        if (!slova.length) return volby;
        return volby.filter(x => {
            const seno = fold([x.nazev, x.popis, x.data.zakazka].join(" "));
            return slova.every(s => seno.indexOf(s) !== -1);
        });
    }

    /**
     * Zápis z vybrané volby v podobě, jakou skládá ulozDen() ve výkazech
     * (pole zná zaznamPayload ve store.js). Popis práce = patra · technologie,
     * jinak název úkolu, u režie její název – jako predvyplnMisto/srovnejRezii.
     */
    function zapisZVolby(volba, z) {
        const d = volba.data;
        const rezie = volba.typ === "rezie";
        /* Podíly srovná stránka přes V.podily (jako ctiOsu ve výkazech –
           jedna hodnota i žádná = „100"); bez ní se nechají, jak jsou. */
        const podily = typeof z.podily === "function" ? z.podily : (text) => text || "";
        const auto = rezie ? "" :
            ([d.patro, d.technologie].filter(Boolean).join(" · ") ||
             (volba.typ === "ukol" ? volba.nazev : ""));
        return {
            uid: z.uid,
            osoba: z.osoba || "",
            datum: z.datum,
            nazev: rezie ? d.zakazka : auto,
            nazevAuto: !rezie && !!auto,
            zakazka: d.zakazka,
            projekt: "",
            firma: rezie ? REZIE_FIRMA : (z.firma || ""),
            cinnost: rezie ? "" : (z.cinnost || ""),
            technologie: rezie ? "" : d.technologie,
            podilTech: rezie ? "" : podily(d.podilTech, d.technologie),
            ukolId: rezie ? "" : d.ukolId,
            budova: rezie ? "" : d.budova,
            patro: rezie ? "" : d.patro,
            podilPatra: rezie ? "" : podily(d.podilPatra, d.patro),
            od: z.od,
            do: z.do,
            pauza: 0,
            obed: false,
            km: 0,
            ho: z.ho === true,
            absence: false,
            absencePlacena: false,
            zdroj: "",
            poznamka: String(z.poznamka || "").trim()
        };
    }

    /**
     * Co by zápis neuložilo – stejné podmínky jako ulozDen() ve výkazech.
     * k = { manazer, uzaverkaOd, rezie, mamUkolyProjektu }. Vrací "" nebo hlášku.
     */
    function kontrolaZapisu(p, k) {
        if (!p.zakazka) return "Vyber úkol nebo zakázku.";
        const a = minuty(p.od), b = minuty(p.do);
        if (a === null || b === null) return "Doplň čas od–do (třeba 8 nebo 8:30).";
        if (b <= a) return "Konec musí být po začátku – práci přes půlnoc zapiš ve výkazech.";
        if (!k.manazer && k.uzaverkaOd && String(p.datum) < k.uzaverkaOd) {
            return "Měsíc je uzavřený – oprava přes Nahlásit chybu.";
        }
        if (!k.rezie && !p.cinnost) return "Vyber druh vypracování.";
        if (!k.rezie && !p.ukolId && k.mamUkolyProjektu) {
            return "Vyber úkol – na tomhle projektu se zápis váže k úkolu.";
        }
        return "";
    }

    window.KBMINI = {
        HODIN_ZA_DEN, ZACATEK_DNE, DNI_ZPET, REZIE_FIRMA,
        minuty, zaokrouhliCas, posunDny, konecDne, obvyklyZacatek, predvyplnCasy,
        prekryvy, sestavVolby, filtrujVolby, zapisZVolby, kontrolaZapisu,
        hoNahlaseno, volnoNahlaseno
    };

    if (typeof document === "undefined" || !document.getElementById) return;   // Node

    /* ======================================================== OKNO ====== */

    const KANAL_OKNO = "kb-mini";
    const VELKE_OKNO = "kb-mini-velke-okno";

    const s = {
        koren: null,
        zastup: null,
        rezim: "",
        pip: null,
        odbery: "",               // "" | "moje" | "vse"
        ukolyPrisly: false,
        volby: [],
        vybrana: null,            // vybraná volba (objekt), drží se i přes překreslení
        vybranoRucne: false,
        vyberOtevren: false,
        aktivni: 0,               // zvýrazněný řádek nabídky (klávesnice)
        dotknuto: { od: false, do: false, druh: false, ho: false },
        dnes: "",
        minuta: "",
        ukladam: false,
        zmenseno: false,
        casovac: 0
    };

    const KB = () => window.KB;
    const UI = () => window.KBUI;
    const V = () => window.KBVYK;
    const esc = (v) => window.KBUI.esc(v);
    const $ = (sel) => s.koren.querySelector(sel);
    const absolutni = (cesta) => new URL(cesta, document.baseURI).href;

    const umiPlovouci = () => !!(window.documentPictureInPicture &&
        typeof window.documentPictureInPicture.requestWindow === "function");

    const mojeUid = () => (KB() && KB().currentUid && KB().currentUid()) || "";

    /** Mini běží v okně vedle hlavního (popup, aplikace, plovoucí) – ne v obyčejné záložce. */
    function samostatne() {
        let standalone = false;
        try {
            standalone = window.matchMedia("(display-mode: standalone)").matches ||
                window.matchMedia("(display-mode: minimal-ui)").matches;
        } catch (err) { /* starší prohlížeč */ }
        return !!s.pip || !!window.opener || window.name === KANAL_OKNO || standalone;
    }

    /** Hlavní okno webu, ze kterého se mini otevřelo (stejný původ, otevřené). */
    function hlavniOkno() {
        try {
            const o = window.opener;
            if (o && !o.closed && o.location.origin === location.origin) return o;
        } catch (err) { /* jiný původ */ }
        return null;
    }

    /**
     * Stránku webu otevře v hlavním okně, ne v mini. Okno otevřené z webu
     * má hlavní okno jako `opener` – když už na té stránce je, jen se vytáhne
     * dopředu; jinak jde stránka do nové záložky (hlavní okno může mít
     * rozepsaný formulář, ten se přepisovat nesmí). Obyčejná záložka mini
     * se prostě přepne na celou stránku.
     */
    function otevriVHlavnim(stranka) {
        const o = hlavniOkno();
        const jmeno = stranka.split(/[?#]/)[0];
        if (o) {
            try {
                if (o.location.pathname.split("/").pop() === jmeno) { o.focus(); return; }
            } catch (err) { /* nic */ }
        }
        if (samostatne()) {
            const w = window.open(absolutni(stranka), "_blank");
            if (w) { try { w.focus(); } catch (err) { /* nic */ } return; }
        }
        location.href = absolutni(stranka);
    }

    /** „Celý web": hlavní okno dopředu, a když žádné není, otevřít nástěnku. */
    function celyWeb() {
        const o = hlavniOkno();
        if (o) { try { o.focus(); return; } catch (err) { /* nic */ } }
        otevriVHlavnim("index.html");
    }

    /* Zástupce na ikoně otevře okno aplikace ve velikosti posledního okna –
       zmenšit na mini. Velikost hlavního okna se zapamatuje a při zavření
       mini se zkusí vrátit, ať ji Chrome (pamatuje jednu velikost na
       aplikaci) nepřenese na příští otevření webu. Jen nejlepší snaha. */
    function zmensiOknoZeZastupce() {
        try {
            if (!window.matchMedia("(display-mode: standalone)").matches) return;
            if (window.opener || window.outerWidth <= 520) return;
            localStorage.setItem(VELKE_OKNO, JSON.stringify({ w: window.outerWidth, h: window.outerHeight }));
            window.resizeTo(400, 720);
            s.zmenseno = true;
        } catch (err) { /* prohlížeč změnu velikosti nedovolil */ }
    }
    window.addEventListener("pagehide", () => {
        if (!s.zmenseno) return;
        try {
            const v = JSON.parse(localStorage.getItem(VELKE_OKNO) || "null");
            if (v && v.w >= 600 && v.h >= 400) window.resizeTo(v.w, v.h);
        } catch (err) { /* nic */ }
    });

    /* ---------------------------------------------------- hláška ---- */

    function hlaska(text, ton) {
        const el = $("[data-mini-hlaska]");
        if (!el) return;
        el.textContent = text || "";
        el.className = "mini__hlaska" + (ton ? " mini__hlaska--" + ton : "");
    }

    /* ------------------------------------------------- odběry dat ---- */

    /** Data si mini řekne samo (nemá lištu ani pás) – stejně jako vykazy.html. */
    function spustOdbery() {
        const kb = KB(), ui = UI();
        if (!mojeUid() || !(kb.users || []).length) return;
        const tise = (slib) => Promise.resolve(slib).catch(err => console.warn("Mini okno:", err));
        if (!s.odbery) {
            s.odbery = "zaklad";
            tise(kb.watchQuickTodo());
        }
        if (!ui.can("vykaz.otevrit")) return;
        const chci = ui.can("vykaz.view") ? "vse" : "moje";
        if (s.odbery === chci || s.odbery === "vse") return;
        s.odbery = chci;
        tise(kb.watchMojeSazba());
        if (chci === "vse") {
            tise(kb.watchVykazy());
            tise(kb.watchProjekty());
        } else {
            tise(kb.watchMojeVykazy());
            tise(kb.watchMojeProjekty());
        }
        // úkoly všechny – výpomoc na cizím úkolu musí jít vybrat i tady
        tise(kb.watchUkoly());
    }

    /* ------------------------------------------------- data dne ---- */

    function mojeZapisy() {
        const uid = mojeUid();
        return (KB().vykazy || []).filter(z => z.uid === uid);
    }

    const dnesniZapisy = () => mojeZapisy().filter(z => z.datum === s.dnes)
        .sort((a, b) => (a.od || "").localeCompare(b.od || ""));

    function rezieNabidka() {
        // práci na webu vykazuje jen hlavní správce (jako vykazy.html)
        return ["Administrativa", "Porada"].concat(UI().role() === "hlavni-spravce" ? ["Web"] : []);
    }

    function mamUkolyProjektu(zakazka) {
        const uid = mojeUid();
        return (KB().ukoly || []).some(u => u.projekt === zakazka && u.stav !== "hotovo" &&
            (u.prirazeni || []).indexOf(uid) !== -1);
    }

    /** Firma k zakázce – jako doplnFirmu() ve výkazech, navíc z mého posledního zápisu. */
    function firmaZakazky(volba) {
        const zak = volba.data.zakazka;
        const doc = (KB().projektyDocs || []).find(p => (p.nazev || "") === zak);
        const zMapy = (KB().firmaMap || {})[zak] || (doc && doc.firma) || "";
        if (zMapy) return zMapy;
        if (volba.data.firma) return volba.data.firma;
        const posledni = mojeZapisy().filter(z => z.zakazka === zak && z.firma)
            .sort((a, b) => (b.datum || "").localeCompare(a.datum || ""))[0];
        return posledni ? posledni.firma : "";
    }

    /* ------------------------------------------------- vykreslení ---- */

    function zjistiRezim() {
        const kb = KB();
        if (!kb || !kb.on) return "chyba";
        if (!mojeUid()) return kb.status === "connecting" ? "pripojuji" : "prihlaseni";
        if (!(kb.users || []).length) return "nacitam";
        if (!UI().can("vykaz.otevrit")) return "bezvykazu";
        return "zapis";
    }

    const zprava = (text, tlacitko) =>
        '<section class="mini__karta mini__zprava"><p>' + esc(text) + "</p>" + (tlacitko || "") + "</section>";

    function postavTelo(rezim) {
        const telo = $("[data-mini-telo]");
        if (rezim === "chyba") {
            telo.innerHTML = zprava("Web se nespojil s databází. Zkus okno obnovit.");
        } else if (rezim === "pripojuji") {
            telo.innerHTML = zprava("Připojuji…");
        } else if (rezim === "prihlaseni") {
            telo.innerHTML = zprava("Pro rychlý zápis hodin se přihlas.",
                '<button type="button" class="btn btn--primary mini__plne" data-mini-login>Přihlásit</button>');
        } else if (rezim === "nacitam") {
            telo.innerHTML = zprava("Načítám…");
        } else if (rezim === "bezvykazu") {
            telo.innerHTML = zprava("Výkazy u tvého účtu zapnuté nejsou.") +
                '<section class="mini__karta mini__quick" data-mini-quick></section>';
        } else {
            telo.innerHTML =
                '<section class="mini__karta mini__den" data-mini-den></section>' +
                '<section class="mini__karta mini__zapis">' +
                    '<h2 class="mini__nadpis">Rychlý zápis</h2>' +
                    '<div class="mini__pole">' +
                        '<span class="label">Úkol / zakázka</span>' +
                        '<button type="button" class="mini__vybrano" data-mini-zmenit></button>' +
                        '<div class="mini__vyber" data-mini-vyber hidden>' +
                            '<input type="search" class="field mini__hledej" data-mini-hledej ' +
                                'placeholder="Hledej úkol nebo zakázku…" autocomplete="off" ' +
                                'aria-label="Hledat úkol nebo zakázku">' +
                            '<div class="mini__volby" data-mini-volby role="listbox"></div>' +
                        "</div>" +
                    "</div>" +
                    '<div class="mini__pole" data-mini-druhbox>' +
                        '<label class="label" for="miniDruh">Druh vypracování</label>' +
                        '<select id="miniDruh" class="field" data-mini-druh></select>' +
                    "</div>" +
                    '<div class="mini__casy">' +
                        '<div><label class="label" for="miniOd">Od</label>' +
                            '<input id="miniOd" class="field mini__cas" data-mini-od list="' +
                            esc(V().CAS_LIST_ID) + '" autocomplete="off" inputmode="numeric"></div>' +
                        '<div><label class="label" for="miniDo">Do</label>' +
                            '<input id="miniDo" class="field mini__cas" data-mini-do list="' +
                            esc(V().CAS_LIST_ID) + '" autocomplete="off" inputmode="numeric"></div>' +
                        '<div class="mini__hod" data-mini-hod aria-live="polite"></div>' +
                    "</div>" +
                    '<p class="mini__varovani" data-mini-varovani hidden></p>' +
                    '<div class="mini__pole">' +
                        '<label class="label" for="miniPozn">Poznámka <span class="mini__nepov">nepovinná</span></label>' +
                        '<input id="miniPozn" class="field" data-mini-pozn maxlength="500" autocomplete="off">' +
                    "</div>" +
                    /* home office – předvyplní se z nahlášeného HO jako ve výkazech */
                    '<label class="mini__ho"><input type="checkbox" data-mini-ho> Home office</label>' +
                    '<button type="button" class="btn btn--primary mini__plne" data-mini-uloz>Uložit</button>' +
                    '<p class="mini__hlaska" data-mini-hlaska role="status" aria-live="polite"></p>' +
                    V().casDatalist() +
                "</section>" +
                '<section class="mini__karta mini__quick" data-mini-quick></section>' +
                '<div class="mini__pata">' +
                    '<button type="button" class="btn btn--ghost btn--sm" data-mini-vykazy>Otevřít výkazy</button>' +
                "</div>";
            s.dotknuto = { od: false, do: false, druh: false, ho: false };
            s.minuta = "";
            nastavCasy(true);
        }
    }

    /** Home office podle kalendáře – dokud ho člověk sám nepřepne. */
    function nastavHo() {
        const pole = $("[data-mini-ho]");
        if (pole && !s.dotknuto.ho) pole.checked = hoNahlaseno(KB().kalendar, mojeUid(), s.dnes);
    }

    function kresliHlavicku() {
        const prihlasen = !!mojeUid();
        const pip = $("[data-mini-plovouci]");
        const zpet = $("[data-mini-vratit]");
        if (pip) pip.hidden = !umiPlovouci() || !prihlasen || !!s.pip;
        if (zpet) zpet.hidden = !s.pip;
    }

    function kresliDen() {
        const box = $("[data-mini-den]");
        if (!box) return;
        const v = V();
        const zapisy = dnesniZapisy();
        let prace = 0, absence = 0;
        zapisy.forEach(z => {
            const h = Number(z.hodiny) || 0;
            if (z.absence === true || v.jeAbsence(z.zakazka)) absence += h; else prace += h;
        });
        const celkem = prace + absence;
        const procent = Math.max(0, Math.min(100, Math.round(celkem / HODIN_ZA_DEN * 100)));
        const ukoly = KB().ukoly || [];

        const radky = zapisy.map(z => {
            const u = z.ukolId ? ukoly.find(x => x.id === z.ukolId) : null;
            const co = (u && u.nazev) || z.nazev || z.zakazka || "—";
            const kde = co === z.zakazka ? "" : (z.zakazka || "");
            const cas = celodenni(z) ? "celý den" : (z.od || "") + "–" + (z.do || "");
            return '<li class="mini__zaznam' + (z.absence === true ? " mini__zaznam--absence" : "") + '">' +
                '<span class="mini__zcas">' + esc(cas) + "</span>" +
                '<span class="mini__zco"><b>' + esc(co) + "</b>" +
                    (kde ? "<small>" + esc(kde) + "</small>" : "") + "</span>" +
                '<span class="mini__zhod">' + esc(v.hod(z.hodiny)) + "</span></li>";
        }).join("");

        const volno = volnoNahlaseno(KB().kalendar, mojeUid(), s.dnes);

        box.innerHTML =
            (volno ? '<p class="mini__volno">' + esc(volno.typ === "volno"
                ? "Pozor: na dnešek máš nahlášené volno."
                : "Pozor: na dnešek máš nahlášenou dovolenou.") + "</p>" : "") +
            '<div class="mini__denhlava">' +
                '<h2 class="mini__nadpis">Dnes <span>' + esc(v.denVTydnu(s.dnes) + " " + v.czDatum(s.dnes)) + "</span></h2>" +
                '<span class="mini__soucet' + (celkem >= HODIN_ZA_DEN ? " mini__soucet--plno" : "") + '"><b>' +
                    esc(v.hod(celkem)) + "</b> z " + esc(HODIN_ZA_DEN) + " h</span>" +
            "</div>" +
            '<div class="mini__pruh' + (celkem >= HODIN_ZA_DEN ? " mini__pruh--plno" : "") + '">' +
                '<i style="width:' + Number(procent) + '%"></i></div>' +
            (absence ? '<p class="mini__pozn">z toho absence ' + esc(v.hod(absence)) + "</p>" : "") +
            (radky ? '<ul class="mini__zaznamy">' + radky + "</ul>"
                   : '<p class="mini__prazdne">Dnes zatím žádný zápis.</p>');
    }

    function prepocitejVolby() {
        s.volby = sestavVolby({
            uid: mojeUid(),
            dnes: s.dnes,
            ukoly: KB().ukoly || [],
            vykazy: mojeZapisy(),
            rezieNabidka: rezieNabidka(),
            jeRezie: V().jeRezie,
            jeAbsence: V().jeAbsence
        });
        if (s.vybrana) {
            const nova = s.volby.find(x => x.klic === s.vybrana.klic);
            if (nova) s.vybrana = nova;
        }
        /* Výchozí volba = to, na co se psalo naposledy – jen dokud si člověk
           nevybral sám, a až když dorazily zápisy i úkoly. */
        if (!s.vybranoRucne && KB().vykazyPrisly && s.ukolyPrisly) {
            const prvni = s.volby.find(x => x.skupina === "naposledy");
            if (prvni && (!s.vybrana || s.vybrana.klic !== prvni.klic)) vyberVolbu(prvni, false);
        }
    }

    const NADPISY_SKUPIN = { naposledy: "Naposledy (14 dní)", moje: "Moje úkoly", rezie: "Režie" };

    function kresliVolby() {
        const box = $("[data-mini-volby]");
        if (!box || !s.vyberOtevren) return;
        const dotaz = ($("[data-mini-hledej]") || {}).value || "";
        const vybrane = filtrujVolby(s.volby, dotaz);
        if (s.aktivni >= vybrane.length) s.aktivni = Math.max(0, vybrane.length - 1);
        let skupina = "";
        const html = vybrane.map((x, i) => {
            let h = "";
            if (x.skupina !== skupina) {
                skupina = x.skupina;
                h += '<div class="mini__skupina">' + esc(NADPISY_SKUPIN[skupina] || "") + "</div>";
            }
            const vybrana = s.vybrana && s.vybrana.klic === x.klic;
            return h + '<button type="button" class="mini__volba' +
                (i === s.aktivni ? " mini__volba--akt" : "") +
                (vybrana ? " mini__volba--vybrana" : "") +
                (x.cizi ? " mini__volba--cizi" : "") +
                '" role="option" aria-selected="' + (vybrana ? "true" : "false") +
                '" data-mini-volba="' + esc(x.klic) + '">' +
                "<b>" + esc(x.nazev) + "</b>" +
                "<small>" + esc(x.popis + (x.cizi ? " · výpomoc" : "")) + "</small></button>";
        }).join("");
        box.innerHTML = html || '<p class="mini__prazdne">' +
            (s.volby.length ? "Nic nesedí – zkus jen část slova." : "Zatím nemáš žádný úkol ani nedávný zápis.") + "</p>";
    }

    function kresliVybrano() {
        const el = $("[data-mini-zmenit]");
        if (!el) return;
        const x = s.vybrana;
        el.innerHTML = x
            ? '<span class="mini__vybranotext"><b>' + esc(x.nazev) + "</b><small>" +
                esc(x.popis + (x.cizi ? " · výpomoc" : "")) + "</small></span>" +
                '<span class="mini__zmenit">Změnit</span>'
            : '<span class="mini__vybranotext"><b>Vyber úkol nebo zakázku</b>' +
                "<small>moje úkoly a na co jsem psal posledních 14 dní</small></span>" +
                '<span class="mini__zmenit">Vybrat</span>';
        el.classList.toggle("mini__vybrano--nic", !x);
        el.hidden = s.vyberOtevren && !x;
        const druhBox = $("[data-mini-druhbox]");
        if (druhBox) druhBox.hidden = !!x && x.typ === "rezie";
    }

    /** Roletka druhu vypracování; `chci` = hodnota, která se má vybrat. */
    function kresliDruh(chci) {
        const sel = $("[data-mini-druh]");
        if (!sel) return;
        const drzena = chci !== undefined ? chci
            : (sel.value || (s.vybrana ? s.vybrana.data.cinnost : "") || "");
        const volby = V().cinnosti().slice();
        if (drzena && volby.indexOf(drzena) === -1) volby.unshift(drzena);
        const html = V().options(volby, drzena, "— vyber —");
        if (sel.dataset.otisk !== html) {
            sel.innerHTML = html;
            sel.dataset.otisk = html;
        }
        sel.value = drzena;
    }

    function kresliHodiny() {
        const el = $("[data-mini-hod]");
        if (!el) return;
        const od = $("[data-mini-od]").value, doCas = $("[data-mini-do]").value;
        const a = minuty(od), b = minuty(doCas);
        el.textContent = (a !== null && b !== null && b > a) ? "= " + V().hod(KB().spocitejHodiny(od, doCas, 0)) : "";
        const varovani = $("[data-mini-varovani]");
        const kolize = prekryvy(od, doCas, dnesniZapisy());
        let text = "";
        if (a !== null && b !== null && b <= a) text = "Konec je před začátkem.";
        else if (kolize.length) {
            text = "Překrývá se s dnešním zápisem " + kolize.map(z => z.od + "–" + z.do).join(", ") + ".";
        }
        varovani.textContent = text;
        varovani.hidden = !text;
    }

    function kresliQuick() {
        const box = $("[data-mini-quick]");
        if (!box) return;
        const uid = mojeUid();
        const ui = UI();
        const kolik = (KB().quicktodo || []).filter(q => ui.quickAdresati(q).indexOf(uid) !== -1 &&
            !ui.quickHotovoPro(q, uid) && !ui.quickVzal(q, uid)).length;
        box.innerHTML = '<button type="button" class="mini__quickbtn" data-mini-quick-otevri>' +
            "<span>Quick TO-DO</span>" +
            '<b class="mini__odznak' + (kolik ? "" : " mini__odznak--nula") + '">' + esc(kolik) + "</b>" +
            "<small>" + esc(kolik ? "nevyřízené" : "nic nečeká") + " →</small></button>";
    }

    /** Předvyplní od–do; ruční úpravu nepřepisuje (do uložení nebo nového dne). */
    function nastavCasy(vynutit) {
        const od = $("[data-mini-od]"), doPole = $("[data-mini-do]");
        if (!od || !doPole) return;
        const ted = new Date();
        const navrh = predvyplnCasy(dnesniZapisy(), ted,
            obvyklyZacatek(mojeZapisy(), s.dnes, V().jeAbsence));
        if (vynutit || !s.dotknuto.od) od.value = navrh.od;
        if (vynutit || !s.dotknuto.do) {
            // „do" se srovnává s tím „od", které v poli opravdu je (mohl ho přepsat)
            const a = minuty(od.value);
            const doCas = zaokrouhliCas(ted);
            doPole.value = (a === null || minuty(doCas) > a) ? doCas : "";
        }
        kresliHodiny();
    }

    function vykresli() {
        if (!s.koren) return;
        const dnes = V() ? V().dnesISO() : "";
        if (dnes !== s.dnes) {          // přes půlnoc: nový den, nové časy
            s.dnes = dnes;
            if (s.rezim === "zapis") { s.dotknuto = { od: false, do: false, druh: s.dotknuto.druh, ho: false }; }
        }
        const rezim = zjistiRezim();
        if (rezim !== s.rezim) {
            s.rezim = rezim;
            postavTelo(rezim);
        }
        if (rezim === "zapis" || rezim === "bezvykazu") spustOdbery();
        kresliHlavicku();
        if (rezim === "bezvykazu") kresliQuick();
        if (rezim !== "zapis") return;

        prepocitejVolby();
        if (!s.vybrana && !s.vyberOtevren && s.volby.length && KB().vykazyPrisly && s.ukolyPrisly) {
            // nic se nedalo předvybrat – rovnou nabídnout výběr
            otevriVyber(false);
        }
        kresliDen();
        kresliVybrano();
        kresliVolby();
        kresliDruh();
        nastavCasy(false);
        nastavHo();
        kresliQuick();
    }

    let naplanovano = 0;
    function naplanuj() {
        clearTimeout(naplanovano);
        naplanovano = setTimeout(vykresli, 30);
    }

    /* ---------------------------------------------------- výběr ---- */

    function otevriVyber(soustredit) {
        s.vyberOtevren = true;
        s.aktivni = 0;
        const box = $("[data-mini-vyber]");
        if (box) box.hidden = false;
        const pole = $("[data-mini-hledej]");
        if (pole) pole.value = "";
        kresliVybrano();
        kresliVolby();
        if (soustredit && pole) pole.focus();
    }

    function zavriVyber() {
        if (!s.vybrana) return;          // bez výběru nemá smysl zavírat
        s.vyberOtevren = false;
        const box = $("[data-mini-vyber]");
        if (box) box.hidden = true;
        kresliVybrano();
    }

    function vyberVolbu(volba, rucne) {
        if (!volba) return;
        s.vybrana = volba;
        if (rucne) s.vybranoRucne = true;
        // druh se předvyplní z volby; ručně vybraný druh přepíše jen ruční výběr úkolu
        if (rucne || !s.dotknuto.druh) {
            kresliDruh(volba.data.cinnost || "");
            s.dotknuto.druh = false;
        }
        if (rucne) zavriVyber();
        kresliVybrano();
    }

    /* ---------------------------------------------------- uložení ---- */

    async function uloz() {
        if (s.ukladam) return;
        const kb = KB(), ui = UI(), v = V();
        const odPole = $("[data-mini-od]"), doPole = $("[data-mini-do]");
        const od = v.normalizujCas(odPole.value), doCas = v.normalizujCas(doPole.value);
        if (od) odPole.value = od;
        if (doCas) doPole.value = doCas;
        kresliHodiny();

        const volba = s.vybrana;
        if (!volba) { otevriVyber(true); return hlaska("Vyber úkol nebo zakázku.", "warn"); }

        const uid = mojeUid();
        const ja = v.clovek(uid);
        const p = zapisZVolby(volba, {
            uid: uid,
            osoba: ja ? v.jmeno(ja) : (window.KB_USER || ""),
            datum: s.dnes,
            firma: volba.typ === "rezie" ? "" : firmaZakazky(volba),
            cinnost: ($("[data-mini-druh]") || {}).value || "",
            od: od, do: doCas,
            ho: !!($("[data-mini-ho]") || {}).checked,
            poznamka: $("[data-mini-pozn]").value,
            podily: (text, hodnoty) => v.podily(text, Math.max(1, v.casti(hodnoty).length)).join(",")
        });
        const manazer = ui.can("vykaz.view");
        const chyba = kontrolaZapisu(p, {
            manazer: manazer,
            uzaverkaOd: /^\d{4}-\d{2}-\d{2}$/.test(String(kb.uzaverkaOd || "")) ? kb.uzaverkaOd : "",
            rezie: volba.typ === "rezie",
            mamUkolyProjektu: mamUkolyProjektu(p.zakazka)
        });
        if (chyba) return hlaska(chyba, "warn");

        s.ukladam = true;
        const tlacitko = $("[data-mini-uloz]");
        tlacitko.disabled = true;
        hlaska("Ukládám…");
        try {
            const id = kb.newVykazId();
            /* Manažer ukládá i s penězi (jako výkazy). Dokud číselník sazeb
               nedorazil, nebo sazbu nemá, uloží se jen čas – částku pak
               dopočítá KB.doplnCastky podle sazby člověka, místo aby se
               zapsala nula natrvalo. */
            const sazba = manazer && kb.sazbyPrisly ? v.sazbaProZapis(uid, p.zakazka) : 0;
            if (manazer && sazba > 0) await kb.saveVykaz(id, Object.assign({}, p, { sazba: sazba }));
            else await kb.saveMujVykaz(id, p);
            hlaska("Uloženo " + p.od + "–" + p.do + " (" + v.hod(kb.spocitejHodiny(p.od, p.do, 0)) + ").", "ok");
            $("[data-mini-pozn]").value = "";
            s.dotknuto = { od: false, do: false, druh: false, ho: s.dotknuto.ho };
            odPole.value = p.do;                 // další práce navazuje na tuhle
            const dalsiDo = zaokrouhliCas(new Date());
            doPole.value = minuty(dalsiDo) > minuty(p.do) ? dalsiDo : "";
            kresliHodiny();
            naplanuj();
        } catch (err) {
            console.error(err);
            hlaska("Uložení selhalo – zkus to prosím znovu.", "error");
        } finally {
            s.ukladam = false;
            tlacitko.disabled = false;
        }
    }

    /* ------------------------------------------- plovoucí okno ---- */

    async function plovouci() {
        if (s.pip && !s.pip.closed) { try { s.pip.focus(); } catch (err) { /* nic */ } return; }
        if (!umiPlovouci()) return hlaska("Plovoucí okno tenhle prohlížeč neumí (Chrome nebo Edge 116+).", "warn");
        let w;
        try {
            w = await window.documentPictureInPicture.requestWindow({ width: 380, height: 640 });
        } catch (err) {
            console.warn(err);
            return hlaska("Plovoucí okno se neotevřelo.", "error");
        }
        const d = w.document;
        d.documentElement.lang = "cs";
        // barva webu (UI.applyAccent) sedí v proměnných na <html>
        const styl = document.documentElement.getAttribute("style");
        if (styl) d.documentElement.setAttribute("style", styl);
        d.title = "Mini okno – Pasport Kaňa";
        Array.from(document.styleSheets).forEach(sh => {
            if (sh.href) {
                const l = d.createElement("link");
                l.rel = "stylesheet";
                l.href = sh.href;           // celá adresa – písma se načtou relativně k ní
                d.head.appendChild(l);
                return;
            }
            try {
                const st = d.createElement("style");
                st.textContent = Array.from(sh.cssRules).map(r => r.cssText).join("\n");
                d.head.appendChild(st);
            } catch (err) { /* cizí styl – přeskočit */ }
        });
        d.body.className = "mini-telo mini-telo--plovouci";
        s.koren.classList.add("mini--plovouci");
        d.body.appendChild(s.koren);
        // klávesy mimo kořen (zaměřené tělo okna) – z kořene je chytá jeho vlastní posluchač
        d.addEventListener("keydown", (event) => { if (!s.koren.contains(event.target)) klavesy(event); });
        s.zastup.hidden = false;
        s.pip = w;
        w.addEventListener("pagehide", () => {
            s.koren.classList.remove("mini--plovouci");
            document.body.insertBefore(s.koren, s.zastup);
            s.zastup.hidden = true;
            s.pip = null;
            kresliHlavicku();
        });
        kresliHlavicku();
    }

    function vratZPlovouciho() {
        if (s.pip) { try { s.pip.close(); } catch (err) { /* nic */ } }
    }

    /* --------------------------------------------------- ovládání ---- */

    function klik(event) {
        const el = event.target.closest && event.target.closest(
            "[data-mini-plovouci],[data-mini-vratit],[data-mini-cely],[data-mini-login]," +
            "[data-mini-zmenit],[data-mini-volba],[data-mini-uloz],[data-mini-vykazy],[data-mini-quick-otevri]");
        if (!el) return;
        if (el.hasAttribute("data-mini-plovouci")) return void plovouci();
        if (el.hasAttribute("data-mini-vratit")) return vratZPlovouciho();
        if (el.hasAttribute("data-mini-cely")) return celyWeb();
        if (el.hasAttribute("data-mini-login")) {
            // přihlašovací okno je v hlavním dokumentu mini stránky
            if (s.pip) { vratZPlovouciho(); try { window.focus(); } catch (err) { /* nic */ } }
            return UI().openLogin();
        }
        if (el.hasAttribute("data-mini-zmenit")) {
            if (s.vyberOtevren) zavriVyber(); else otevriVyber(true);
            return;
        }
        if (el.hasAttribute("data-mini-volba")) {
            const volba = s.volby.find(x => x.klic === el.dataset.miniVolba);
            if (volba) vyberVolbu(volba, true);
            // časy bývají předvyplněné – další krok je skoro vždycky Uložit
            const dal = $("[data-mini-uloz]");
            if (dal) dal.focus();
            return;
        }
        if (el.hasAttribute("data-mini-uloz")) return void uloz();
        if (el.hasAttribute("data-mini-vykazy")) return otevriVHlavnim("vykazy.html");
        if (el.hasAttribute("data-mini-quick-otevri")) return otevriVHlavnim("quicktodo.html");
    }

    function klavesy(event) {
        // Alt+Shift+M – zpátky na celý web (ve webu tatáž zkratka otevírá mini)
        if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyM") {
            event.preventDefault();
            return celyWeb();
        }
        const t = event.target;
        if (!t || !t.matches) return;
        if (t.matches("[data-mini-hledej]")) {
            const radky = Array.from(s.koren.querySelectorAll("[data-mini-volba]"));
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!radky.length) return;
                s.aktivni = event.key === "ArrowDown"
                    ? Math.min(radky.length - 1, s.aktivni + 1) : Math.max(0, s.aktivni - 1);
                kresliVolby();
                const akt = s.koren.querySelector(".mini__volba--akt");
                if (akt) akt.scrollIntoView({ block: "nearest" });
            } else if (event.key === "Enter") {
                event.preventDefault();
                const akt = radky[s.aktivni];
                if (akt) akt.click();
            } else if (event.key === "Escape" && s.vybrana) {
                event.preventDefault();
                zavriVyber();
            }
            return;
        }
        // Enter v časech nebo v poznámce uloží (jako odeslání formuláře)
        if (event.key === "Enter" && t.matches("[data-mini-od],[data-mini-do],[data-mini-pozn]")) {
            event.preventDefault();
            uloz();
        }
    }

    function zmena(event) {
        const t = event.target;
        if (!t || !t.matches) return;
        if (t.matches("[data-mini-hledej]")) { s.aktivni = 0; return kresliVolby(); }
        if (t.matches("[data-mini-od]")) s.dotknuto.od = true;
        if (t.matches("[data-mini-do]")) s.dotknuto.do = true;
        if (t.matches("[data-mini-druh]")) s.dotknuto.druh = true;
        if (t.matches("[data-mini-ho]")) s.dotknuto.ho = true;
        if (t.matches("[data-mini-od],[data-mini-do]")) kresliHodiny();
    }

    /** Odchod z pole času srovná zápis „8" / „830" na 08:00 / 08:30 (V.normalizujCas). */
    function srovnejCas(event) {
        const t = event.target;
        if (!t || !t.matches || !t.matches("[data-mini-od],[data-mini-do]")) return;
        const cas = V().normalizujCas(t.value);
        if (cas) t.value = cas;
        kresliHodiny();
    }

    /* ------------------------------------------------------ start ---- */

    function start() {
        s.koren = document.getElementById("mini");
        s.zastup = document.getElementById("miniZastup");
        if (!s.koren) return;

        const logo = s.koren.querySelector("[data-mini-logo]");
        if (logo) logo.src = absolutni("Pasport_Kana_white.png");   // i v plovoucím okně

        s.koren.addEventListener("click", klik);
        s.koren.addEventListener("keydown", klavesy);
        s.koren.addEventListener("input", zmena);
        s.koren.addEventListener("change", zmena);
        s.koren.addEventListener("focusout", srovnejCas);
        document.addEventListener("keydown", (event) => {
            if (!s.koren.contains(event.target)) klavesy(event);
        });
        if (s.zastup) {
            s.zastup.addEventListener("click", (event) => {
                if (event.target.closest("[data-mini-vratit]")) vratZPlovouciho();
            });
        }

        if (!window.KB || !window.KB.on || !window.KBVYK) {
            s.rezim = "chyba";
            s.koren.querySelector("[data-mini-telo]").innerHTML =
                zprava("Web se nespojil s databází. Zkus okno obnovit.");
            return;
        }
        s.dnes = V().dnesISO();
        zmensiOknoZeZastupce();

        ["vykazy", "ukoly", "projekty-docs", "quicktodo", "users", "uzaverka",
         "vykazy-meta", "status", "moje-sazba", "kalendar"].forEach(udalost => KB().on(udalost, naplanuj));
        KB().on("ukoly", () => { s.ukolyPrisly = true; });
        document.addEventListener("kb-role", naplanuj);

        // čas běží: „do" se posouvá s hodinami, o půlnoci nastane nový den
        s.casovac = setInterval(() => {
            const ted = zaokrouhliCas(new Date()) + V().dnesISO();
            if (ted === s.minuta) return;
            s.minuta = ted;
            vykresli();
        }, 20000);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) naplanuj(); });

        vykresli();
    }

    document.addEventListener("DOMContentLoaded", start);
})();
