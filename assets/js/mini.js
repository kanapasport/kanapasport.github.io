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

   Nahoře dvě záložky: Zápis (rychlý zápis hodin) a Přehled (moje
   nevyřízené Quick TO-DO s odškrtnutím, hodiny dnes a v týdnu proti
   fondu, moje úkoly s termínem do 7 dní, nejbližší milníky).

   Sbalení k okraji (Michal: „jako když na iPhonu odsunu video mimo
   obrazovku a zůstane tam šipka"): okno b) a c) se zmenší na proužek se
   šipkou ‹, počtem Quick TO-DO a dnešními hodinami; šipka ho vytáhne zpět.
   Co prohlížeč dovolí (Chrome 155, ověřeno 20. 10. 2026):
     – plovoucí okno: resizeTo jen s gestem uživatele (klik v okně),
       nejmenší vnitřek 240 × 58 px (při otevření 240 × 52); moveTo jím
       nepohne – k okraji si ho člověk přetáhne sám. Chrome si poslední
       velikost i místo pamatuje a příště ho tak otevře.
     – samostatné okno (popup i okno aplikace): resizeTo i moveTo bez
       gesta, nejmenší vnitřek 162 × 26 px – proužek se sám posune
       k pravému okraji obrazovky.
   Okno Windows k okraji plochy „přilepit" web neumí.

   Zápis jde STEJNOU cestou jako formulář ve vykazy.html (ulozDen):
   manažer KB.saveVykaz se sazbou podle V.sazbaProZapis, ostatní
   KB.saveMujVykaz – aktivita, propis do Tabulek i dopočet částek se tak
   chovají stejně. Hlídá se totéž co tam: uzávěrka (KB.uzaverkaOd) pro
   nemanažera, druh vypracování u práce na zakázce a úkol tam, kde má
   člověk na projektu svoje úkoly. Lhůta týdne se neřeší – píše se dnešek.
   Oběd je stejný příplatek jako „Vložit placený oběd" ve výkazech
   (pole `obed`, paušál KB.OBED_KC dopočítá KB.spocitejCastky).

   Stránky webu („Otevřít výkazy", „Celý web", detail vzkazu nebo úkolu)
   se otevírají v už otevřeném hlavním okně: dotaz přes BroadcastChannel
   „kb-okna" (posluchač na konci ui.js), jinak nové okno.

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
            /* placený oběd – stejné pole jako „Vložit placený oběd" ve
               výkazech; korunový paušál k němu dopočítá store.js */
            obed: z.obed === true,
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

    /* ------------------------------------------------------ přehled -- */

    const DNI_UKOLY = 7;             // úkoly s termínem do tolika dní (i prošlé)

    /** Pondělí a neděle týdne, do kterého patří `dnes` – u nás se týden počítá od pondělí. */
    function tyden(dnes) {
        const d = new Date(dnes + "T00:00:00");
        const od = posunDny(dnes, -((d.getDay() + 6) % 7));
        return { od: od, do: posunDny(od, 6) };
    }

    /**
     * Hodiny dnes a v tomto týdnu (do dneška) proti fondu. Absence se počítá
     * jako odpracovaný čas – stejně jako zůstatek přesčasů ve výkazech, jinak
     * by týden dovolené vypadal jako 40 chybějících hodin.
     * fond(odIso, doIso) = V.fondHodin (bez víkendů a svátků).
     */
    function souhrnHodin(zapisy, dnes, fond, jeAbsence) {
        const t = tyden(dnes);
        const f = typeof fond === "function" ? fond : null;
        const r = {
            od: t.od, do: t.do,
            dnes: 0, dnesAbsence: 0, tyden: 0, tydenAbsence: 0,
            fondDnes: f ? f(dnes, dnes) : HODIN_ZA_DEN,
            fondTyden: f ? f(t.od, t.do) : 5 * HODIN_ZA_DEN,
            fondDoDnes: f ? f(t.od, dnes) : 0
        };
        (zapisy || []).forEach(z => {
            if (!z || !z.datum || z.datum < t.od || z.datum > dnes) return;
            const h = Number(z.hodiny) || 0;
            const abs = z.absence === true || (jeAbsence ? jeAbsence(z.zakazka) : false);
            r.tyden += h;
            if (abs) r.tydenAbsence += h;
            if (z.datum === dnes) {
                r.dnes += h;
                if (abs) r.dnesAbsence += h;
            }
        });
        return r;
    }

    /**
     * Moje nevyřízené Quick TO-DO: jsem mezi adresáty a pro mě splněné není.
     * Pořadí jako na stránce Quick TO-DO – vzaté na vědomí dolů, „co
     * nejdříve" nahoru, pak termíny od nejbližšího, nakonec bez termínu.
     * f = { adresati(q), hotovoPro(q, uid), vzal(q, uid) } – z KBUI.
     */
    function mojeQuick(vse, uid, f) {
        return (vse || []).filter(q => q && f.adresati(q).indexOf(uid) !== -1 && !f.hotovoPro(q, uid))
            .sort((a, b) =>
                (f.vzal(a, uid) ? 1 : 0) - (f.vzal(b, uid) ? 1 : 0) ||
                (b.asap ? 1 : 0) - (a.asap ? 1 : 0) ||
                (a.doKdy ? 0 : 1) - (b.doKdy ? 0 : 1) ||
                String(a.doKdy || "").localeCompare(String(b.doKdy || "")) ||
                (Number(b.ms) || 0) - (Number(a.ms) || 0));
    }

    /** Moje otevřené úkoly s termínem do `dni` dní (i ty po termínu), od nejbližšího. */
    function ukolySTerminem(ukoly, uid, dnes, dni) {
        const mez = posunDny(dnes, dni === undefined ? DNI_UKOLY : dni);
        return (ukoly || []).filter(u => u && u.stav !== "hotovo" && u.termin &&
                (u.prirazeni || []).indexOf(uid) !== -1 && String(u.termin) <= mez)
            .sort((a, b) => String(a.termin).localeCompare(String(b.termin)) ||
                String(a.nazev || "").localeCompare(String(b.nazev || ""), "cs"));
    }

    /**
     * Nejbližší milníky, které vidím (KB.milniky už je podle práv) – stejné
     * pravidlo jako dlaždice na nástěnce: s termínem, nesplněné nebo splněné
     * a čekající na potvrzení; prošlé zůstávají nahoře.
     */
    function nejblizsiMilniky(milniky, kolik) {
        return (milniky || []).filter(m => m && m.datum && (!m.hotovo || m.potvrzeno === false))
            .sort((a, b) => String(a.datum).localeCompare(String(b.datum)))
            .slice(0, kolik || 4);
    }

    /** Za kolik dní je termín: „dnes", „zítra", „za 3 dny", „po termínu". */
    function kdyText(datum, dnes) {
        const n = Math.round((new Date(datum + "T00:00:00") - new Date(dnes + "T00:00:00")) / 86400000);
        if (n < 0) return "po termínu";
        if (n === 0) return "dnes";
        if (n === 1) return "zítra";
        return "za " + n + (n <= 4 ? " dny" : " dní");
    }

    /**
     * Které z otevřených oken webu má cíl převzít (odpovědi na dotaz přes
     * BroadcastChannel). Detail vzkazu a „Celý web" vezme kterékoliv okno –
     * nic se v něm nepřepíná. Stránku přednostně okno, které na ní už je
     * (jen se vytáhne). Jinak okno bez rozepsané práce, které na cíl přejde;
     * okno s rozepsaným formulářem se nepřepisuje – pak null a mini otevře
     * nové okno. cil = { stranka, ukol, quick }.
     */
    function vyberOkno(odpovedi, cil) {
        const c = cil || {};
        const vse = (odpovedi || []).filter(o => o && o.okno).slice().sort((a, b) =>
            (b.viditelne ? 1 : 0) - (a.viditelne ? 1 : 0) ||
            (Number(b.aktivniMs) || 0) - (Number(a.aktivniMs) || 0));
        if (c.quick || (!c.stranka && !c.ukol)) return vse[0] || null;
        const volna = vse.filter(o => !o.rozepsano);
        if (c.ukol) return volna.find(o => o.stranka === "ukoly.html") || volna[0] || null;
        return vse.find(o => o.stranka === c.stranka) || volna[0] || null;
    }

    /** Adresa cíle v novém okně (detail vzkazu otevře ui.js podle #quick=…). */
    function adresaCile(cil) {
        const c = cil || {};
        if (c.quick) return "quicktodo.html#quick=" + encodeURIComponent(c.quick);
        if (c.ukol) return "ukoly.html?moje=1&otevri=" + encodeURIComponent(c.ukol);
        return c.stranka || "index.html";
    }

    window.KBMINI = {
        HODIN_ZA_DEN, ZACATEK_DNE, DNI_ZPET, DNI_UKOLY, REZIE_FIRMA,
        minuty, zaokrouhliCas, posunDny, konecDne, obvyklyZacatek, predvyplnCasy,
        prekryvy, sestavVolby, filtrujVolby, zapisZVolby, kontrolaZapisu,
        hoNahlaseno, volnoNahlaseno,
        tyden, souhrnHodin, mojeQuick, ukolySTerminem, nejblizsiMilniky, kdyText,
        vyberOkno, adresaCile
    };

    if (typeof document === "undefined" || !document.getElementById) return;   // Node

    /* ======================================================== OKNO ====== */

    const KANAL_OKNO = "kb-mini";            // jméno samostatného okna (ui.js otevriMiniOkno)
    const KANAL_OKNA = "kb-okna";            // BroadcastChannel k hlavním oknům (konec ui.js)
    const VELKE_OKNO = "kb-mini-velke-okno";
    const STAV_KLIC = "kb-mini-stav";        // záložka a sbalení – { zalozka, pip: {…}, okno: {…} }

    /* Vnitřní velikost proužku a celého okna. Chrome menší nedovolí
       (plovoucí 240 × 52/58, samostatné 162 × 26) – o pixel víc nevadí,
       prohlížeč to srovná na své minimum. */
    const PROUZEK = { pip: { w: 240, h: 52 }, okno: { w: 160, h: 44 } };
    const VELIKOST = { pip: { w: 380, h: 640 }, okno: { w: 380, h: 700 } };
    const MALE_OKNO = 120;                   // nižší okno = jen proužek
    const VELKE_ZAS = 220;                   // vyšší okno ze proužku = celé mini

    const s = {
        koren: null,
        zastup: null,
        rezim: "",
        zalozka: "zapis",         // "zapis" | "prehled"
        sbaleno: false,           // ukazuje se proužek se šipkou
        vlastniZmena: 0,          // kdy mini samo měnilo velikost okna (ms)
        posledniHotovo: null,     // { id, text, ms } – odškrtnuté Quick TO-DO, dá se vrátit
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

    /* ------------------------------------- uložený režim okna ---- */

    function ctiStav() {
        try {
            const v = JSON.parse(localStorage.getItem(STAV_KLIC) || "null");
            return (v && typeof v === "object") ? v : {};
        } catch (err) { return {}; }      // soukromé okno, zakázané úložiště
    }

    function ulozStav(zmena) {
        try { localStorage.setItem(STAV_KLIC, JSON.stringify(Object.assign(ctiStav(), zmena))); }
        catch (err) { /* nezapamatuje se – nevadí */ }
    }

    /** Uložený stav sbalení pro plovoucí okno („pip") nebo samostatné okno („okno"). */
    const stavOkna = (druh) => Object.assign({}, ctiStav()[druh] || {});

    /* ------------------------------------------ hlavní okno webu ---- */

    let dotazu = 0;

    /**
     * Stránku webu otevře v hlavním okně, ne v mini. Zeptá se přes
     * BroadcastChannel, jaká okna webu jsou otevřená (odpoví posluchač na
     * konci ui.js), a vybere vhodné (vyberOkno) – to na cíl přejde nebo se
     * jen vytáhne; okno s rozepsaným formulářem se nepřepisuje. Když žádné
     * neodpoví, otevře se nové okno. Obyčejná záložka mini se prostě
     * přepne na celou stránku. cil = { stranka, ukol, quick } (prázdný =
     * „Celý web").
     */
    function doHlavnihoOkna(cil) {
        const adresa = adresaCile(cil);
        if (!samostatne()) { location.href = absolutni(adresa); return; }
        const o = hlavniOkno();
        const otevriNove = () => {
            let w = null;
            try { w = window.open(absolutni(adresa), "_blank"); } catch (err) { w = null; }
            if (w) { try { w.focus(); } catch (err) { /* nic */ } return; }
            hlaska("Prohlížeč nové okno zablokoval – povol vyskakovací okna pro tenhle web.", "warn");
        };
        let kanal = null;
        try { kanal = new BroadcastChannel(KANAL_OKNA); } catch (err) { kanal = null; }
        if (!kanal) {
            // starší prohlížeč: aspoň okno, ze kterého se mini otevřelo
            if (o && !cil.stranka && !cil.ukol && !cil.quick) { try { o.focus(); return; } catch (err) { /* nic */ } }
            return otevriNove();
        }
        const dotaz = "d" + Date.now().toString(36) + "-" + (++dotazu);
        const odpovedi = [];
        kanal.onmessage = (event) => {
            const d = event.data || {};
            if (d.dotaz === dotaz && d.typ === "tady") odpovedi.push(d);
        };
        kanal.postMessage({ typ: "kdo", dotaz: dotaz });
        setTimeout(() => {
            const okno = vyberOkno(odpovedi, cil);
            if (!okno) { kanal.close(); return otevriNove(); }
            kanal.postMessage({ typ: "otevri", dotaz: dotaz, okno: okno.okno, cil: {
                adresa: adresa,
                quick: cil.quick || "",
                jenUkazat: !cil.stranka && !cil.ukol && !cil.quick
            } });
            /* Okno, ze kterého se mini otevřelo, jde vytáhnout dopředu i odsud
               (s gestem kliknutí); jiné se zkusí vytáhnout samo. */
            try { if (o && o.KB_OKNO_ID === okno.okno) o.focus(); } catch (err) { /* nic */ }
            hlaska(cil.quick ? "Vzkaz je otevřený v hlavním okně webu."
                : "Otevřeno v hlavním okně webu.", "ok");
            setTimeout(() => { try { kanal.close(); } catch (err) { /* nic */ } }, 1500);
        }, 250);
    }

    const otevriVHlavnim = (stranka) => doHlavnihoOkna({ stranka: stranka });

    /** „Celý web": hlavní okno dopředu, a když žádné není, otevřít nástěnku. */
    const celyWeb = () => doHlavnihoOkna({});

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

    /** Hláška do právě viditelné záložky (Zápis i Přehled mají svoji). */
    function hlaska(text, ton) {
        if (!s.koren) return;
        const el = s.koren.querySelector("[data-mini-pane]:not([hidden]) [data-mini-hlaska]") ||
            $("[data-mini-hlaska]");
        if (!el) return;
        el.textContent = text || "";
        el.className = "mini__hlaska" + (ton ? " mini__hlaska--" + ton : "");
    }

    /* --------------------------------------- sbalení k okraji ---- */

    /** Kde mini právě je: plovoucí okno, nebo okno stránky mini.html. */
    const oknoMini = () => s.pip || window;
    const druhOkna = () => (s.pip ? "pip" : "okno");

    /**
     * Smí mini měnit velikost svého okna? Samostatné okno „kb-mini" (popup),
     * okno nainstalované aplikace a popup obecně ano; obyčejná záložka ne
     * (resizeTo tam nic neudělá) a na dotykovém zařízení to nemá smysl.
     */
    function lzeMenitOkno() {
        try { if (window.matchMedia("(pointer: coarse)").matches) return false; } catch (err) { /* nic */ }
        let aplikace = false;
        try { aplikace = window.matchMedia("(display-mode: standalone)").matches; } catch (err) { /* nic */ }
        const popup = !!(window.toolbar && window.toolbar.visible === false);
        return window.name === KANAL_OKNO || aplikace || popup;
    }

    const lzeSbalit = () => !!s.pip || lzeMenitOkno();

    /** Rámeček okna (lišta, okraje) – resizeTo počítá s vnější velikostí. */
    const ramecek = (w) => ({
        w: Math.max(0, (w.outerWidth || 0) - (w.innerWidth || 0)),
        h: Math.max(0, (w.outerHeight || 0) - (w.innerHeight || 0))
    });

    /** Samostatné okno k pravému okraji obrazovky (plovoucím oknem moveTo nepohne). */
    function kOkraji(w) {
        try {
            const sc = w.screen;
            const vlevo = Number(sc.availLeft) || 0, nahore = Number(sc.availTop) || 0;
            const y = Math.max(nahore, Math.min(w.screenY, nahore + sc.availHeight - w.outerHeight));
            w.moveTo(vlevo + sc.availWidth - w.outerWidth, y);
        } catch (err) { /* prohlížeč posun nedovolil */ }
    }

    function nelzeSbalit(druh) {
        s.sbaleno = false;
        ulozStav({ [druh]: Object.assign(stavOkna(druh), { sbaleno: false }) });
        kresliSbaleni();
        hlaska("Tohle okno se zmenšit nedá – sbalit jde plovoucí okno nebo samostatné mini okno (Alt+Shift+M).", "warn");
    }

    /**
     * Sbalí okno na proužek se šipkou. Plovoucí okno chce gesto – volat
     * přímo z kliknutí, bez čekání. `priStartu` = samostatné okno se sbaluje
     * samo podle posledního režimu; velikost před sbalením se pak nepřepíše
     * (okno ještě nemusí mít svou velikost).
     */
    function sbal(priStartu) {
        if (!lzeSbalit()) return;
        const w = oknoMini();
        const druh = druhOkna();
        const st = stavOkna(druh);
        /* Při startu má okno ještě velikost, se kterou ho prohlížeč otevřel
           (ze zástupce klidně celé okno aplikace) – pak platí uložená
           velikost, a když žádná není, vytáhne se na výchozí. */
        if (!priStartu) st.pred = { w: w.outerWidth, h: w.outerHeight, x: w.screenX, y: w.screenY };
        st.sbaleno = true;
        ulozStav({ [druh]: st });
        s.sbaleno = true;
        s.vlastniZmena = Date.now();
        kresliSbaleni();
        const r = ramecek(w);
        try {
            w.resizeTo(r.w + PROUZEK[druh].w, r.h + PROUZEK[druh].h);
        } catch (err) {
            return nelzeSbalit(druh);      // plovoucí okno bez gesta: NotAllowedError
        }
        if (!s.pip) {
            setTimeout(() => kOkraji(w), 150);
            setTimeout(() => kOkraji(w), 600);    // kdyby se velikost dorovnala později
        }
        // obyčejná záložka nebo prohlížeč, který změnu nedovolil: okno je pořád velké
        setTimeout(() => {
            if (s.sbaleno && oknoMini() === w && w.innerHeight > VELKE_ZAS) nelzeSbalit(druh);
        }, 900);
    }

    /** Šipka ‹ – vrátí okno na velikost před sbalením (nebo výchozí). */
    function vytahni() {
        const w = oknoMini();
        const druh = druhOkna();
        const st = stavOkna(druh);
        const r = ramecek(w);
        const p = st.pred || {};
        // mini větší než ~ polovina obrazovky je skoro jistě velikost celého okna aplikace
        const rozumne = Number(p.w) >= 300 && Number(p.h) >= 300 &&
            Number(p.w) <= Math.max(720, (w.screen.availWidth || 0) / 2);
        const cil = rozumne
            ? { w: Number(p.w), h: Number(p.h) }
            : { w: r.w + VELIKOST[druh].w, h: r.h + VELIKOST[druh].h };
        st.sbaleno = false;
        ulozStav({ [druh]: st });
        s.sbaleno = false;
        s.vlastniZmena = Date.now();
        if (!s.pip) {
            /* Samostatné okno vyjede od proužku do obrazovky: pravý okraj
               zůstane tam, kde je proužek, a celé okno se vejde na obrazovku. */
            try {
                const sc = w.screen;
                const vlevo = Number(sc.availLeft) || 0, nahore = Number(sc.availTop) || 0;
                const x = Math.max(vlevo, Math.min(w.screenX + w.outerWidth - cil.w, vlevo + sc.availWidth - cil.w));
                const y = Math.max(nahore, Math.min(w.screenY, nahore + sc.availHeight - cil.h));
                w.moveTo(x, y);
            } catch (err) { /* nic */ }
        }
        try { w.resizeTo(cil.w, cil.h); } catch (err) { /* zůstane malé – viz kontrola níž */ }
        kresliSbaleni();
        vykresli();
        // když se okno nezvětšilo, ať v něm aspoň zůstane proužek, ne useknuté mini
        setTimeout(() => {
            if (!s.sbaleno && oknoMini() === w && w.innerHeight < MALE_OKNO) {
                s.sbaleno = true;
                kresliSbaleni();
            }
        }, 900);
    }

    /**
     * Velikost okna mění i člověk (tažením za okraj) a Chrome otevírá
     * plovoucí okno v poslední velikosti: malé okno = proužek, zvětšené
     * z proužku = celé mini. Vlastní změny chvíli nehlídat.
     */
    function hlidejVelikost(w) {
        w.addEventListener("resize", () => {
            if (oknoMini() !== w || !lzeSbalit() || Date.now() - s.vlastniZmena < 1000) return;
            const druh = druhOkna();
            if (!s.sbaleno && w.innerHeight < MALE_OKNO) {
                s.sbaleno = true;
            } else if (s.sbaleno && w.innerHeight >= VELKE_ZAS) {
                s.sbaleno = false;
            } else {
                return;
            }
            ulozStav({ [druh]: Object.assign(stavOkna(druh), { sbaleno: s.sbaleno }) });
            kresliSbaleni();
            if (!s.sbaleno) vykresli();
        });
    }

    function kresliSbaleni() {
        if (!s.koren) return;
        s.koren.classList.toggle("mini--sbalene", !!s.sbaleno);
        kresliProuzek();
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

    const paneZapis = (obsah) =>
        '<div class="mini__pane" id="miniPaneZapis" role="tabpanel" aria-labelledby="miniTabZapis" ' +
            'data-mini-pane="zapis">' + obsah + "</div>";

    /** Záložka Přehled – karty se kreslí v kresliPrehled. */
    const panePrehled = (sVykazy) =>
        '<div class="mini__pane" id="miniPanePrehled" role="tabpanel" aria-labelledby="miniTabPrehled" ' +
            'data-mini-pane="prehled" hidden>' +
            (sVykazy ? '<section class="mini__karta" data-mini-hodiny></section>' : "") +
            '<section class="mini__karta" data-mini-qseznam></section>' +
            (sVykazy ? '<section class="mini__karta" data-mini-ukoly></section>' : "") +
            '<section class="mini__karta" data-mini-milniky></section>' +
            '<p class="mini__hlaska" data-mini-hlaska role="status" aria-live="polite"></p>' +
            '<p class="mini__tip" data-mini-tip hidden></p>' +
        "</div>";

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
            // bez výkazů zbývá jen přehled (Quick TO-DO a milníky)
            telo.innerHTML = paneZapis(zprava("Výkazy u tvého účtu zapnuté nejsou – Quick TO-DO a milníky najdeš v Přehledu.")) +
                panePrehled(false);
            s.zalozka = "prehled";
        } else {
            const kb = KB();
            const obedKc = Number(kb.OBED_KC) > 0 ? V().kc(kb.OBED_KC) : "";
            telo.innerHTML = paneZapis(
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
                    '<div class="mini__prepinace">' +
                        /* home office – předvyplní se z nahlášeného HO jako ve výkazech */
                        '<label class="mini__ho"><input type="checkbox" data-mini-ho> Home office</label>' +
                        /* oběd – „Vložit placený oběd" z výkazů, paušál podle store.js */
                        '<label class="mini__ho" title="Placený oběd – stejný paušál jako ve výkazech">' +
                            '<input type="checkbox" data-mini-obed> Oběd' +
                            (obedKc ? " <small>" + esc(obedKc) + "</small>" : "") + "</label>" +
                    "</div>" +
                    '<p class="mini__pozn" data-mini-obedpozn hidden></p>' +
                    '<button type="button" class="btn btn--primary mini__plne" data-mini-uloz>Uložit</button>' +
                    '<p class="mini__hlaska" data-mini-hlaska role="status" aria-live="polite"></p>' +
                    V().casDatalist() +
                "</section>" +
                '<div class="mini__pata">' +
                    '<button type="button" class="btn btn--ghost btn--sm" data-mini-vykazy>Otevřít výkazy</button>' +
                "</div>") +
                panePrehled(true);
            s.dotknuto = { od: false, do: false, druh: false, ho: false };
            s.minuta = "";
            nastavCasy(true);
        }
        kresliZalozky();
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
        const sbalit = $("[data-mini-sbalit]");
        if (pip) pip.hidden = !umiPlovouci() || !prihlasen || !!s.pip;
        if (zpet) zpet.hidden = !s.pip;
        if (sbalit) sbalit.hidden = !lzeSbalit();
    }

    /** Quick TO-DO bez odložených (na zítra / na pondělí) – ty se do té doby neukazují. */
    function quickBezOdlozenych(uid) {
        const ui = UI();
        return (KB().quicktodo || []).filter(q => !(ui && ui.quickOdlozeno && ui.quickOdlozeno(q, uid)));
    }

    /** Počet Quick TO-DO, které na mě čekají (vzaté na vědomí a odložené ne – jako odznak v pásu). */
    function pocetQuick() {
        const uid = mojeUid(), ui = UI();
        if (!uid || !ui || !ui.quickAdresati) return 0;
        return quickBezOdlozenych(uid).filter(q => ui.quickAdresati(q).indexOf(uid) !== -1 &&
            !ui.quickHotovoPro(q, uid) && !ui.quickVzal(q, uid)).length;
    }

    const cislo = (h) => Number(h || 0).toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
    const kratkeDatum = (iso) => {
        const c = String(iso || "").split("-");
        return c.length === 3 ? Number(c[2]) + ". " + Number(c[1]) + "." : "";
    };

    function kresliZalozky() {
        if (!s.koren) return;
        const sZalozkami = s.rezim === "zapis" || s.rezim === "bezvykazu";
        const lista = $("[data-mini-zalozky]");
        if (lista) lista.hidden = !sZalozkami;
        s.koren.querySelectorAll("[data-mini-zalozka]").forEach(b => {
            const ano = b.dataset.miniZalozka === s.zalozka;
            b.setAttribute("aria-selected", ano ? "true" : "false");
            b.tabIndex = ano ? 0 : -1;
        });
        s.koren.querySelectorAll("[data-mini-pane]").forEach(p => { p.hidden = p.dataset.miniPane !== s.zalozka; });
        const pocet = $("[data-mini-zalozka-pocet]");
        if (pocet) {
            const n = sZalozkami ? pocetQuick() : 0;
            pocet.textContent = String(n);
            pocet.hidden = !n;
        }
    }

    function prepniZalozku(zalozka, soustredit) {
        if (zalozka !== "zapis" && zalozka !== "prehled") return;
        s.zalozka = zalozka;
        ulozStav({ zalozka: zalozka });
        kresliZalozky();
        if (soustredit) {
            const tab = s.koren.querySelector('[data-mini-zalozka="' + zalozka + '"]');
            if (tab) tab.focus();
        }
        vykresli();
    }

    /** Proužek sbaleného okna: šipka, Quick TO-DO a dnešní hodiny. */
    function kresliProuzek() {
        const el = s.koren && s.koren.querySelector("[data-mini-prouzek-info]");
        if (!el) return;
        const uid = mojeUid();
        let text = "Mini okno";
        if (!uid || !KB() || !UI()) {
            el.innerHTML = "<span>Mini okno</span>";
        } else {
            const kolik = pocetQuick();
            const vykazy = UI().can("vykaz.otevrit");
            const hodin = vykazy ? dnesniZapisy().reduce((n, z) => n + (Number(z.hodiny) || 0), 0) : 0;
            el.innerHTML =
                '<span title="Quick TO-DO, které na tebe čekají">TO-DO <b class="mini__odznak' +
                    (kolik ? "" : " mini__odznak--nula") + '">' + esc(kolik) + "</b></span>" +
                (vykazy ? '<span title="Dnes zapsáno">' + esc(cislo(hodin)) + " h</span>" : "");
            text = "TO-DO " + kolik + (vykazy ? " · " + cislo(hodin) + " h" : "");
        }
        // samostatné okno ukazuje název v liště i nad proužkem
        if (!s.pip) document.title = s.sbaleno ? text + " – Mini okno" : "Mini okno – Pasport Kaňa";
    }

    /* ---------------------------------------------------- přehled ---- */

    function kresliHodinyPrehled() {
        const box = $("[data-mini-hodiny]");
        if (!box) return;
        const v = V();
        const r = souhrnHodin(mojeZapisy(), s.dnes, v.fondHodin, v.jeAbsence);
        const radek = (nazev, h, fond, pozn) => {
            const plno = fond > 0 && h >= fond;
            const procent = fond > 0 ? Math.max(0, Math.min(100, Math.round(h / fond * 100))) : (h > 0 ? 100 : 0);
            return '<div class="mini__fond">' +
                '<div class="mini__fondhlava"><span>' + esc(nazev) + "</span>" +
                    '<span class="mini__soucet' + (plno ? " mini__soucet--plno" : "") + '"><b>' + esc(cislo(h)) +
                    "</b>" + (fond > 0 ? " z " + esc(cislo(fond)) : "") + " h</span></div>" +
                '<div class="mini__pruh' + (plno ? " mini__pruh--plno" : "") + '"><i style="width:' +
                    Number(procent) + '%"></i></div>' +
                (pozn ? '<p class="mini__pozn">' + esc(pozn) + "</p>" : "") +
            "</div>";
        };
        const rozdil = Math.round((r.tyden - r.fondDoDnes) * 100) / 100;
        const poznTyden = r.fondDoDnes > 0
            ? "Fond do dneška " + cislo(r.fondDoDnes) + " h · " + (rozdil < 0 ? "chybí " + cislo(-rozdil) + " h"
                : rozdil > 0 ? "o " + cislo(rozdil) + " h víc" : "přesně podle fondu") +
              (r.tydenAbsence ? " · z toho absence " + cislo(r.tydenAbsence) + " h" : "")
            : "";
        box.innerHTML = '<h2 class="mini__nadpis">Hodiny <span>proti fondu</span></h2>' +
            radek("Dnes", r.dnes, r.fondDnes, r.fondDnes ? "" : "Dnes je víkend nebo svátek – fond je nula.") +
            radek("Tento týden", r.tyden, r.fondTyden, poznTyden);
    }

    function kresliQuickSeznam() {
        const box = $("[data-mini-qseznam]");
        if (!box) return;
        const ui = UI(), uid = mojeUid();
        const seznam = mojeQuick(quickBezOdlozenych(uid), uid,
            { adresati: ui.quickAdresati, hotovoPro: ui.quickHotovoPro, vzal: ui.quickVzal });
        const kolik = pocetQuick();
        const MAX = 6;
        const jmenoUid = (id) => {
            const u = (KB().users || []).find(x => x.id === id);
            return u ? ((u.first || "") + " " + (u.last || "")).trim() : "";
        };
        const radky = seznam.slice(0, MAX).map(q => {
            const text = String(q.text || "").trim() || "Vzkaz s obrázkem";
            const vzal = ui.quickVzal(q, uid);
            // oznámení: bez termínu, ✓ = Beru na vědomí (ui.js, KBUI.jeOznameni)
            const info = ui.jeOznameni(q);
            const akce = info ? "Beru na vědomí" : "Splněno";
            const poTerminu = q.doKdy && String(q.doKdy) < s.dnes;
            const odKoho = q.odKoho === uid ? "jen pro mě" : (q.odKohoJmeno || jmenoUid(q.odKoho));
            const meta = [
                info ? "oznámení" : "",
                odKoho ? esc(q.odKoho === uid ? odKoho : "od " + odKoho) : "",
                q.projekt ? esc(q.projekt) : "",
                q.asap && !info ? '<span class="mini__asap">co nejdříve</span>' : "",
                q.doKdy && !info ? '<span class="' + (poTerminu ? "mini__po" : "") + '">do ' + esc(kratkeDatum(q.doKdy)) + "</span>" : "",
                vzal ? "beru na vědomí" : ""
            ].filter(Boolean).join(" · ");
            return '<li class="mini__radek">' +
                '<button type="button" class="mini__splnit" data-mini-qhotovo="' + esc(q.id) + '" title="' + akce + '" ' +
                    'aria-label="' + esc(akce + ": " + text) + '">✓</button>' +
                '<button type="button" class="mini__odkaz" data-mini-qdetail="' + esc(q.id) + '" ' +
                    'title="Otevřít vzkaz v hlavním okně webu"><b>' + esc(text) + "</b>" +
                    (meta ? "<small>" + meta + "</small>" : "") + "</button>" +
            "</li>";
        }).join("");
        const posledni = s.posledniHotovo && Date.now() - s.posledniHotovo.ms < 15000 ? s.posledniHotovo : null;
        box.innerHTML =
            '<h2 class="mini__nadpis">Quick TO-DO <b class="mini__odznak' + (kolik ? "" : " mini__odznak--nula") + '">' +
                esc(kolik) + "</b></h2>" +
            (posledni ? '<div class="mini__vratitpruh"><span>' +
                esc((posledni.info ? "Vzato na vědomí: " : "Splněno: ") + posledni.text) + "</span>" +
                '<button type="button" data-mini-qvratit="' + esc(posledni.id) + '">Vrátit</button></div>' : "") +
            (radky ? '<ul class="mini__radky">' + radky + "</ul>"
                   : '<p class="mini__prazdne">Nikdo po tobě nic nechce.</p>') +
            '<p class="mini__dalsi"><button type="button" data-mini-otevri="quicktodo.html">' +
                esc(seznam.length > MAX ? "Další " + (seznam.length - MAX) + " na stránce Quick TO-DO →"
                    : "Otevřít Quick TO-DO →") + "</button></p>";
    }

    function kresliUkolyPrehled() {
        const box = $("[data-mini-ukoly]");
        if (!box) return;
        const seznam = ukolySTerminem(KB().ukoly, mojeUid(), s.dnes, DNI_UKOLY);
        const radky = seznam.slice(0, 6).map(u => {
            const kdy = kdyText(u.termin, s.dnes);
            const trida = kdy === "po termínu" ? " mini__datum--pozde"
                : (kdy === "dnes" || kdy === "zítra") ? " mini__datum--brzy" : "";
            return '<li class="mini__radek">' +
                '<span class="mini__datum' + trida + '">' + esc(kratkeDatum(u.termin)) +
                    "<span>" + esc(kdy) + "</span></span>" +
                '<button type="button" class="mini__odkaz" data-mini-ukol="' + esc(u.id) + '" ' +
                    'title="Otevřít úkol v hlavním okně webu"><b>' + esc(u.nazev || "Úkol bez názvu") + "</b>" +
                    (u.projekt ? "<small>" + esc(u.projekt) + "</small>" : "") + "</button>" +
            "</li>";
        }).join("");
        box.innerHTML = '<h2 class="mini__nadpis">Moje úkoly <span>termín do ' + esc(DNI_UKOLY) + " dní</span></h2>" +
            (radky ? '<ul class="mini__radky">' + radky + "</ul>"
                : '<p class="mini__prazdne">' + (s.ukolyPrisly ? "Žádný můj úkol s termínem do týdne."
                    : "Úkoly ještě nedorazily…") + "</p>") +
            (seznam.length > 6 ? '<p class="mini__dalsi"><button type="button" data-mini-otevri="ukoly.html">' +
                esc("Další " + (seznam.length - 6) + " v Úkolech →") + "</button></p>" : "");
    }

    function kresliMilnikyPrehled() {
        const box = $("[data-mini-milniky]");
        if (!box) return;
        const seznam = nejblizsiMilniky(KB().milniky, 4);
        const radky = seznam.map(m => {
            const ceka = m.hotovo && m.potvrzeno === false;
            const kdy = ceka ? "čeká na potvrzení" : kdyText(m.datum, s.dnes);
            const trida = kdy === "po termínu" ? " mini__datum--pozde" : "";
            const nazev = (m.cinnost || "Milník") + (m.napln ? " – " + m.napln : "");
            return '<li class="mini__radek">' +
                '<span class="mini__datum' + trida + '">' + esc(kratkeDatum(m.datum)) +
                    "<span>" + esc(kdy) + "</span></span>" +
                '<button type="button" class="mini__odkaz" data-mini-otevri="milniky.html" ' +
                    'title="Otevřít milníky v hlavním okně webu"><b>' + esc(nazev) + "</b>" +
                    (m.zakazka ? "<small>" + esc(m.zakazka) + "</small>" : "") + "</button>" +
            "</li>";
        }).join("");
        box.innerHTML = '<h2 class="mini__nadpis">Milníky <span>nejbližší</span></h2>' +
            (radky ? '<ul class="mini__radky">' + radky + "</ul>"
                : '<p class="mini__prazdne">Žádný nadcházející milník.</p>');
    }

    function kresliTip() {
        const el = $("[data-mini-tip]");
        if (!el) return;
        el.hidden = !lzeSbalit();
        el.textContent = s.pip
            ? "Tip: tlačítko →| v záhlaví sbalí okno na proužek se šipkou. K okraji obrazovky si ho přetáhni " +
              "sám – plovoucí okno prohlížeč posunout neumí, příště se ale otevře na stejném místě. Šipka ‹ ho vytáhne."
            : "Tip: tlačítko →| v záhlaví sbalí okno na proužek se šipkou a odsune ho k pravému okraji " +
              "obrazovky. Jinam si ho přetáhneš za horní lištu. Šipka ‹ ho zase vytáhne.";
    }

    function kresliPrehled() {
        if (s.zalozka !== "prehled" || !$("[data-mini-pane=\"prehled\"]")) return;
        kresliHodinyPrehled();
        kresliQuickSeznam();
        kresliUkolyPrehled();
        kresliMilnikyPrehled();
        kresliTip();
    }

    /** Oběd zapsaný dnes už jinde – upozornit, ať se nezapočítá dvakrát. */
    function kresliObed() {
        const pole = $("[data-mini-obed]"), pozn = $("[data-mini-obedpozn]");
        if (!pole || !pozn) return;
        const uz = pole.checked ? dnesniZapisy().find(z => z.obed === true) : null;
        const text = uz ? "Oběd už dnes máš u zápisu " + (celodenni(uz) ? "na celý den"
            : (uz.od || "") + "–" + (uz.do || "")) + " – započítal by se podruhé." : "";
        pozn.textContent = text;
        pozn.hidden = !text;
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
            const kde = [co === z.zakazka ? "" : (z.zakazka || ""), z.obed === true ? "oběd" : ""]
                .filter(Boolean).join(" · ");
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
        kresliZalozky();
        kresliProuzek();
        if (rezim === "bezvykazu") kresliPrehled();
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
        kresliObed();
        kresliPrehled();
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
            obed: !!($("[data-mini-obed]") || {}).checked,
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
            hlaska("Uloženo " + p.od + "–" + p.do + " (" + v.hod(kb.spocitejHodiny(p.od, p.do, 0)) + ")" +
                (p.obed ? " i s obědem" : "") + ".", "ok");
            $("[data-mini-pozn]").value = "";
            // oběd patří k jednomu zápisu – další zápis dne ho mít nemá
            const obed = $("[data-mini-obed]");
            if (obed) obed.checked = false;
            kresliObed();
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
        /* Naposledy sbalené plovoucí okno se otevře rovnou jako proužek.
           Chrome si ale poslední velikost i místo pamatuje sám a velikost
           z požadavku pak nebere – o proužku proto rozhodne skutečná výška. */
        const velikost = stavOkna("pip").sbaleno ? PROUZEK.pip : VELIKOST.pip;
        try {
            w = await window.documentPictureInPicture.requestWindow({ width: velikost.w, height: velikost.h });
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
        const podleVysky = () => {
            if (s.pip !== w || !w.innerHeight) return;
            s.sbaleno = w.innerHeight < MALE_OKNO;
            ulozStav({ pip: Object.assign(stavOkna("pip"), { sbaleno: s.sbaleno }) });
            kresliSbaleni();
        };
        podleVysky();
        setTimeout(podleVysky, 400);       // okno mohlo dostat velikost až po otevření
        hlidejVelikost(w);
        w.addEventListener("pagehide", () => {
            s.koren.classList.remove("mini--plovouci");
            document.body.insertBefore(s.koren, s.zastup);
            s.zastup.hidden = true;
            s.pip = null;
            // zpátky ve stránce: proužek jen v samostatném okně, které je opravdu malé
            s.sbaleno = lzeMenitOkno() && window.innerHeight < MALE_OKNO;
            kresliSbaleni();
            kresliHlavicku();
            kresliTip();
        });
        kresliSbaleni();
        kresliHlavicku();
        kresliTip();
    }

    function vratZPlovouciho() {
        if (s.pip) { try { s.pip.close(); } catch (err) { /* nic */ } }
    }

    /* --------------------------------------------------- ovládání ---- */

    /** Odškrtnutí Quick TO-DO stejnou funkcí jako stránka Quick TO-DO (UI.quickPrepni). */
    async function quickHotovo(id, hotovo, tlacitko) {
        const q = (KB().quicktodo || []).find(x => x.id === id);
        if (!q) return;
        if (tlacitko) tlacitko.disabled = true;
        try {
            await UI().quickPrepni(q, hotovo);
            s.posledniHotovo = hotovo ? { id: q.id, text: String(q.text || "").trim() || "vzkaz", ms: Date.now(),
                info: UI().jeOznameni(q) } : null;
            hlaska(hotovo ? "" : "Vzkaz je zpátky mezi nevyřízenými.", hotovo ? "" : "ok");
            if (hotovo) setTimeout(naplanuj, 15500);       // proužek „Vrátit" pak zmizí
        } catch (err) {
            console.error(err);
            hlaska("Uložení selhalo – zkus to prosím znovu.", "error");
            if (tlacitko) tlacitko.disabled = false;
        }
        naplanuj();
    }

    function klik(event) {
        const el = event.target.closest && event.target.closest(
            "[data-mini-plovouci],[data-mini-vratit],[data-mini-cely],[data-mini-login]," +
            "[data-mini-zmenit],[data-mini-volba],[data-mini-uloz],[data-mini-vykazy]," +
            "[data-mini-zalozka],[data-mini-sbalit],[data-mini-vytahni],[data-mini-qhotovo]," +
            "[data-mini-qvratit],[data-mini-qdetail],[data-mini-ukol],[data-mini-otevri]");
        if (!el) return;
        // sbalení a vytažení musí běžet hned v kliknutí – plovoucí okno chce gesto
        if (el.hasAttribute("data-mini-sbalit")) return sbal(false);
        if (el.hasAttribute("data-mini-vytahni")) return vytahni();
        if (el.hasAttribute("data-mini-zalozka")) return prepniZalozku(el.dataset.miniZalozka, false);
        if (el.hasAttribute("data-mini-qhotovo")) return void quickHotovo(el.dataset.miniQhotovo, true, el);
        if (el.hasAttribute("data-mini-qvratit")) return void quickHotovo(el.dataset.miniQvratit, false, el);
        if (el.hasAttribute("data-mini-qdetail")) return doHlavnihoOkna({ quick: el.dataset.miniQdetail });
        if (el.hasAttribute("data-mini-ukol")) return doHlavnihoOkna({ ukol: el.dataset.miniUkol });
        if (el.hasAttribute("data-mini-otevri")) {
            const stranka = el.dataset.miniOtevri;
            if (/^[a-z0-9-]+\.html$/.test(stranka)) otevriVHlavnim(stranka);
            return;
        }
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
    }

    function klavesy(event) {
        // Alt+Shift+M – zpátky na celý web (ve webu tatáž zkratka otevírá mini)
        if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyM") {
            event.preventDefault();
            return celyWeb();
        }
        const t = event.target;
        if (!t || !t.matches) return;
        // šipky mezi záložkami (jako u každého seznamu záložek)
        if (t.matches("[data-mini-zalozka]") && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            return prepniZalozku(s.zalozka === "zapis" ? "prehled" : "zapis", true);
        }
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
        if (t.matches("[data-mini-obed]")) kresliObed();
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
        s.zalozka = ctiStav().zalozka === "prehled" ? "prehled" : "zapis";
        zmensiOknoZeZastupce();
        /* Samostatné okno si pamatuje sbalení: naposledy proužek = zase
           proužek u okraje. Malé okno (Chrome přenesl velikost) taky. */
        if (lzeMenitOkno()) {
            hlidejVelikost(window);
            if (stavOkna("okno").sbaleno) sbal(true);
            else if (window.innerHeight && window.innerHeight < MALE_OKNO) s.sbaleno = true;
            kresliSbaleni();
        }

        ["vykazy", "ukoly", "projekty-docs", "quicktodo", "users", "uzaverka",
         "vykazy-meta", "status", "moje-sazba", "kalendar", "milniky"].forEach(udalost => KB().on(udalost, naplanuj));
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
