/* ==========================================================================
   Výplaty a mzdy – společná okna a akce nad měsícem člověka (window.KBVYPLATY).

   Michal 12. 11. 2026, Iris: vytaženo z vyplaty.html, ať Výplaty (OSVČ)
   i Výpis pro mzdovou (zaměstnanci, dohodáři, studenti) zapisují do
   private/vyplaty/mesice/{uid}_{RRRR-MM} stejně: Proplaceno… (i částečně),
   Bonus…, Uzavřít / Odemknout měsíc, Přepočítat (V.vyplataMesice +
   KB.ulozVyplatu, řetěz přenosu), nabídka řádku (nabidka.js), Kč za
   tečkami; nově Mzda… (KB.ulozMzdu, historie od měsíce) a Poznámka pro
   účetní (`poznamkaUcetni`). Stránka si kreslí tabulku / karty sama a volá:
     KBVYPLATY.init({ naplanuj })          – okno, klávesy, odkrytí částek
     KBVYPLATY.radek(u, mesic)             – uložený dokument + živý výpočet
     KBVYPLATY.akceRadku(r, { mzdove })    – tlačítka / položky nabídky
     KBVYPLATY.akce(druh, uid, mesic)      – provedení (okna, potvrzení)
     KBVYPLATY.pripojNabidku(fn)           – fn(cil) → { uid, mesic, radek, navic } | null
   Peníze jen přes KBUI.esc. Potřebuje ui.js, nabidka.js, vykazy.js, store.js.
   ========================================================================== */

(function () {
    "use strict";

    const A = {};
    window.KBVYPLATY = A;

    const V = window.KBVYK;
    const $ = (id) => document.getElementById(id);
    const esc = (value) => window.KBUI.esc(value);

    let naplanuj = () => {};
    let pracuji = false;                  // probíhá zápis – nic se nemačká dvakrát
    let penizeVidet = false;
    let okno = null;                      // { druh, uid, mesic, zbyva }
    const nacteneMesice = new Set();      // starší měsíce dotažené mimo živé okno výkazů
    const nacteneRoky = new Set();        // roky dotažené kvůli limitu DPP
    const nacitam = new Set();

    /* ------------------------------------------------------ drobnosti ---- */
    A.jeMesic = (m) => /^\d{4}-\d{2}$/.test(String(m || ""));
    A.mesicText = (m) => V.mesicText(m);
    A.tentoMesic = () => V.dnesISO().slice(0, 7);
    A.TYP_KRATCE = { zamestnanec: "HPP", dpp: "DPP", dpc: "DPČ", osvc: "OSVČ", student: "Student" };
    A.finance = () => window.KBUI.can("finance.view");
    A.hlavni = () => window.KBUI.isOwner();
    A.kdo = () => window.KB_USER || "";
    A.typ = (u) => window.KBUI.typUvazku(u);
    A.pracuji = () => pracuji;
    A.kratkeMs = (ms) => {
        const d = new Date(Number(ms) || 0);
        return Number(ms) ? d.getDate() + ". " + (d.getMonth() + 1) + ". " + d.getFullYear() : "";
    };
    A.stejne = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
    const stejne = A.stejne;

    /* ------------------------------------------------ SKRYTÉ PENÍZE ----
       Kč jsou za tečkami jako ve výkazech: stránka bývá na promítačce.
       Odkrytí platí pro celou stránku (body.penize-videt), nepamatuje se. */
    A.tajne = (html) => '<span class="tajne">' + html + "</span>" +
        '<span class="tajne__zastup" data-penize-prepni title="Zobrazit peníze">•••</span>';
    A.kcHtml = (kc) => A.tajne(esc(V.kc(kc)));
    A.kcBunka = (kc) => Number(kc) ? A.kcHtml(kc) : '<span class="vynic">—</span>';
    A.zbyvaBunka = (kc) => Number(kc) ? A.tajne('<span class="' + (Number(kc) < 0 ? "vyminus" : "") + '">' +
        esc(V.kc(kc)) + "</span>") : '<span class="vynic">0 Kč</span>';
    A.hodBunka = (h) => Number(h) ? esc(V.hod(h)) : '<span class="vynic">—</span>';
    A.pouzijSkryti = () => {
        document.body.classList.toggle("penize-videt", penizeVidet);
        document.querySelectorAll("button[data-penize-prepni]").forEach(b => {
            b.textContent = penizeVidet ? "skrýt částky" : "zobrazit částky";
        });
    };

    /* ------------------------------------------------------- data ---- */
    A.dokumenty = () => window.KB.vyplaty || [];
    A.dokument = (uid, m) => V.vyplataDokument(A.dokumenty(), uid, m);
    A.clovek = (uid) => (window.KB.users || []).find(u => u.id === uid) || null;
    A.jmeno = (u, uid) => u ? V.jmeno(u) : (uid || "—");
    const nahradnik = (uid) => A.clovek(uid) || { id: uid, first: "", last: uid };

    /** Jsou výkazy (i s částkami) pro měsíc v paměti? Bez nich by vyšly nuly. */
    A.pripraveno = (m) => {
        if (!window.KB.vykazyPrisly || !window.KB.castkyPrisly || !window.KB.vyplatyPrisly) return false;
        const od = V.mesicRozsah(m).od;
        return !window.KB.vykazyOknoOd || od >= window.KB.vykazyOknoOd || nacteneMesice.has(m);
    };

    /** Starší měsíce (mimo živé okno 4 měsíců) a rok kvůli limitu DPP se dotahují dotazem. */
    async function dotahni(od, doKdy, klic, hotovo) {
        if (nacitam.has(klic)) return;
        nacitam.add(klic);
        try {
            await window.KB.nactiVykazyRozsah(od, doKdy);
            hotovo();
        } catch (err) {
            console.warn("Starší výkazy se nenačetly:", err);
            window.KBUI.toast("Starší výkazy se nepodařilo načíst.", "warn");
        } finally {
            nacitam.delete(klic);
            naplanuj();
        }
    }
    A.zajistiMesic = (m) => {
        const oknoOd = window.KB.vykazyOknoOd;
        if (!oknoOd || !A.jeMesic(m) || nacteneMesice.has(m)) return;
        const r = V.mesicRozsah(m);
        if (r.od >= oknoOd) return;
        dotahni(r.od, r.do, "m" + m, () => nacteneMesice.add(m));
    };
    A.zajistiRok = (rok) => {
        const oknoOd = window.KB.vykazyOknoOd;
        if (!oknoOd || nacteneRoky.has(rok)) return;
        const od = rok + "-01-01";
        if (od >= oknoOd) { nacteneRoky.add(rok); return; }
        const konec = rok + "-12-31";
        const doKdy = konec < oknoOd ? konec : V.posunIso(oknoOd, -1);
        dotahni(od, doKdy, "r" + rok, () => nacteneRoky.add(rok));
    };

    /** Je před měsícem dokument, ale ne hned ten předchozí? (Přenos by se ztratil.) */
    const posledniPred = (uid, m) => A.dokumenty().filter(d => d.uid === uid && A.jeMesic(d.mesic) && d.mesic < m)
        .sort((a, b) => b.mesic.localeCompare(a.mesic))[0] || null;

    /** Živý výpočet měsíce (zaměstnanec: mzda z KB.mzdy, hodiny z výkazů; ostatní z částek). */
    const zivyVypocet = (uid, m, typDok, zaklad, prenos, d) => V.vyplataMesice({ uid: uid, mesic: m, typ: typDok,
        zaklad: typDok === "zamestnanec" ? null : zaklad, zaznamy: window.KB.vykazy || [], prenos: prenos,
        bonusy: d ? d.bonusy : [], proplaceno: d ? d.proplaceno : [] });

    /** Řádek: uložený dokument (je-li), živý výpočet z výkazů a co z toho plyne. */
    A.radek = (u, m) => {
        const d = A.dokument(u.id, m);
        const typDok = (d && d.typ) || A.typ(u);
        const zaklad = V.vyplataZVykazu(window.KB.vykazy || [], u.id, m);
        const pren = V.vyplataPrenos(A.dokumenty(), u.id, m);
        const zivy = zivyVypocet(u.id, m, typDok, zaklad, pren.prenos, d);
        const uzavreno = !!(d && d.uzavreno);
        const cisla = d || zivy;
        const klice = typDok === "zamestnanec" ? ["hodiny", "mzda"] : ["hodiny", "prace", "obedy", "km", "skoleniPlacene"];
        const zmena = !!d && !uzavreno && A.pripraveno(m) &&
            (klice.some(k => !stejne(d[k], zivy[k])) || !stejne(d.prenos, pren.prenos));
        const pred = pren.zDokumentu ? null : posledniPred(u.id, m);
        let limit = null;
        if (typDok === "dpp") {
            const rok = m.slice(0, 4);
            limit = V.limitDpp(V.hodinyRoku(window.KB.vykazy || [], u.id, rok), V.dppKcMesice(cisla),
                window.KB.dppNastaveni);
            limit.nacteno = nacteneRoky.has(rok);
        }
        const nic = !d && !zaklad.zapisu && !pren.prenos && !(typDok === "zamestnanec" && zivy.mzda);
        return { u: u, d: d, zaklad: zaklad, pren: pren, zivy: zivy, cisla: cisla, uzavreno: uzavreno,
            zmena: zmena, ztracenyPrenos: pred && !stejne(pred.zbyva, 0) ? pred : null,
            typ: typDok, limit: limit, nic: nic };
    };

    /** Stav platby: "uzavreno" | "zaplaceno" | "castecne" | "otevreno" | "nespocitano". */
    A.stavPlatby = (r) => !r.d ? "nespocitano"
        : r.uzavreno ? (Number(r.d.proplacenoCelkem) && Number(r.d.zbyva) <= 0.005 ? "zaplaceno" : "uzavreno")
        : Number(r.d.proplacenoCelkem) ? "castecne" : "otevreno";

    /* ------------------------------------------------ zápis měsíce ---- */

    /**
     * Nová pole dokumentu měsíce. Otevřený měsíc (a výslovný přepočet) se
     * počítá znovu z výkazů, uzavřený drží uložený základ. Přenos se bere ze
     * `zbyva` předchozího měsíce (předaný `prenos` má přednost – řetěz).
     * zmena: { bonus, proplaceno, zamknout, uzavrit, odemknout, prepocet, poznamkaUcetni, mzda: {kc, od} }
     */
    function novaPole(u, m, stary, zmena, prenos) {
        const ted = Date.now();
        const zUlozeneho = !!(stary && stary.uzavreno) && !zmena.prepocet;
        const typDok = (zUlozeneho && stary.typ) || A.typ(u) || "";
        const zam = typDok === "zamestnanec";
        const zaklad = zUlozeneho
            ? { hodiny: stary.hodiny, prace: stary.prace, obedy: stary.obedy, km: stary.km,
                skoleniPlacene: stary.skoleniPlacene }
            : zam ? null : V.vyplataZVykazu(window.KB.vykazy || [], u.id, m);
        const bonusy = ((stary && stary.bonusy) || []).concat(zmena.bonus ? [zmena.bonus] : []);
        const proplaceno = ((stary && stary.proplaceno) || []).concat(zmena.proplaceno ? [zmena.proplaceno] : []);
        const p = prenos !== undefined ? prenos : V.vyplataPrenos(A.dokumenty(), u.id, m).prenos;
        // mzda: uzavřený měsíc drží uloženou, čerstvě změněná má přednost před KB.mzdy (odběr ještě nedoběhl)
        const mzda = zam && zUlozeneho && !zmena.mzda ? { kc: stary.mzda, od: stary.mzdaOd } : zam ? zmena.mzda : null;
        const pole = V.vyplataMesice({ uid: u.id, mesic: m, typ: typDok, zaklad: zaklad,
            zaznamy: window.KB.vykazy || [], prenos: p, bonusy: bonusy, proplaceno: proplaceno,
            mzda: mzda ? Number(mzda.kc) || 0 : undefined, mzdaOd: mzda ? mzda.od || "" : undefined });
        pole.uzavreno = zmena.odemknout ? null
            : (stary && stary.uzavreno) ? stary.uzavreno
            : (zmena.uzavrit || (zmena.proplaceno && zmena.zamknout)) ? { ms: ted, kdo: A.kdo() } : null;
        pole.odemknul = zmena.odemknout ? { ms: ted, kdo: A.kdo() } : ((stary && stary.odemknul) || null);
        if (zmena.poznamkaUcetni !== undefined) pole.poznamkaUcetni = zmena.poznamkaUcetni;
        if (!zUlozeneho) { pole.spocitanoMs = ted; pole.spocitalKdo = A.kdo(); }
        return pole;
    }

    /** Uloží měsíc v transakci; uzavřený měsíc mezitím = nic (jen hlavní správce smí dál). */
    async function zapisMesic(u, m, zmena, prenos) {
        let uzavrenyMezitim = false;
        const ulozeno = await window.KB.ulozVyplatu(u.id, m, (stary) => {
            if (stary && stary.uzavreno && !A.hlavni() && !zmena.odemknout) { uzavrenyMezitim = true; return null; }
            return novaPole(u, m, stary, zmena, prenos);
        });
        if (uzavrenyMezitim) throw Object.assign(new Error("uzavřeno"), { code: "uzavreno" });
        return ulozeno;
    }

    /** Měsíce mezi posledním dokumentem a `m`, které nejsou spočítané – jinak by se přenos ztratil. */
    async function doplnRetez(u, m) {
        const pred = posledniPred(u.id, m);
        if (!pred || pred.mesic === V.posunMesic(m, -1)) return;
        const prvni = V.posunMesic(pred.mesic, 1);
        const posledni = V.posunMesic(m, -1);
        const oknoOd = window.KB.vykazyOknoOd;
        if (oknoOd && V.mesicRozsah(prvni).od < oknoOd) {
            await window.KB.nactiVykazyRozsah(V.mesicRozsah(prvni).od, V.mesicRozsah(posledni).do);
            for (let k = prvni; k <= posledni; k = V.posunMesic(k, 1)) nacteneMesice.add(k);
        }
        let zbyva = pred.zbyva;
        for (let k = prvni, i = 0; k <= posledni && i < 36; k = V.posunMesic(k, 1), i++) {
            const ulozeno = await zapisMesic(u, k, {}, zbyva);
            zbyva = ulozeno ? ulozeno.zbyva : zbyva;
        }
        return zbyva;
    }

    /** Přenos dál: pozdější spočítané měsíce dostanou nové „z minula“ (dokud řetěz nepřeruší díra). */
    async function prenesDal(u, m, zbyva) {
        const strop = A.tentoMesic();
        let k = m;
        for (let i = 0; i < 36; i++) {
            const dalsi = V.posunMesic(k, 1);
            if (dalsi > strop) return;
            const d = A.dokument(u.id, dalsi);
            if (!d || stejne(d.prenos, zbyva)) return;
            if (d.uzavreno && !A.hlavni()) {
                window.KBUI.toast("Přenos do " + A.mesicText(dalsi) + " se nezměnil – ten měsíc je uzavřený. " +
                    "Srovná ho hlavní správce (Přepočítat).", "warn");
                return;
            }
            const prenos = zbyva;
            const ulozeno = await window.KB.ulozVyplatu(u.id, dalsi, (stary) => {
                if (!stary || (stary.uzavreno && !A.hlavni())) return null;
                const s = V.vyplataSoucty(stary.typ === "zamestnanec" ? { prace: stary.mzda } : stary,
                    prenos, stary.bonusy, stary.proplaceno);
                return { prenos: s.prenos, kVyplate: s.kVyplate, zbyva: s.zbyva };
            });
            if (!ulozeno) return;
            zbyva = ulozeno.zbyva;
            k = dalsi;
        }
    }

    /** Jedna akce nad měsícem člověka: řetěz před ním, zápis, přenos dál, hláška. */
    A.provedAkci = async (uid, m, zmena, hlaska, aktivita) => {
        if (pracuji) return false;
        const u = nahradnik(uid);
        if (!A.pripraveno(m)) {
            window.KBUI.toast("Výkazy se ještě načítají – zkus to za chvilku.", "warn");
            return false;
        }
        pracuji = true;
        naplanuj();
        try {
            const zbyvaPred = await doplnRetez(u, m);
            const ulozeno = await zapisMesic(u, m, zmena, zbyvaPred);
            if (ulozeno) await prenesDal(u, m, ulozeno.zbyva);
            window.KB.zapisAktivitu("vyplata", aktivita + " – " + A.jmeno(A.clovek(uid), uid) + ", " + A.mesicText(m));
            if (hlaska) window.KBUI.toast(typeof hlaska === "function" ? hlaska(ulozeno) : hlaska);
            return true;
        } catch (err) {
            console.error(err);
            window.KBUI.toast(err && err.code === "uzavreno"
                ? "Měsíc je mezitím uzavřený – změnit ho může jen hlavní správce."
                : err && err.code === "permission-denied"
                    ? "Databáze změnu odmítla – měsíc je uzavřený, nebo na to nemáš právo."
                    : "Uložení se nepovedlo – zkus to znovu.", "error");
            return false;
        } finally {
            pracuji = false;
            naplanuj();
        }
    };

    /** Přepočítá otevřené řádky jeden po druhém (provedAkci si hlídá `pracuji`). */
    A.prepocitatVse = async (radky, m) => {
        if (pracuji || !A.pripraveno(m)) return;
        const otevrene = radky.filter(r => !r.nic && !r.uzavreno);
        if (!otevrene.length) return window.KBUI.toast("Nic otevřeného k přepočtu.");
        let n = 0;
        for (const r of otevrene) {
            if (await A.provedAkci(r.u.id, m, { prepocet: true }, "", "přepočítal výplatu")) n++;
        }
        window.KBUI.toast("Přepočítáno " + V.pocet(n, ["člověk", "lidé", "lidí"]) + " z výkazů.");
    };

    /* ------------------------------------------------- akce řádku ---- */

    /** Tlačítka v detailu i položky nabídky. volby.mzdove = výpis pro mzdovou (Mzda…, Poznámka pro účetní). */
    A.akceRadku = (r, volby) => {
        const v = volby || {};
        const smiPsat = A.finance() && (!r.uzavreno || A.hlavni());
        return [
            { akce: "proplaceno", text: v.mzdove ? "Zaplaceno…" : "Proplaceno…", povoleno: smiPsat, ikona: "platba",
                title: "Zapsat výplatu (i částečnou) – doplacením se měsíc uzavře" },
            { akce: "bonus", text: "Bonus…", povoleno: smiPsat, ikona: "plus" },
            v.mzdove && r.typ === "zamestnanec"
                ? { akce: "mzda", text: "Mzda…", povoleno: A.finance(), ikona: "upravit", title: "Mzda s historií od měsíce" } : null,
            v.mzdove ? { akce: "poznamka", text: "Poznámka pro účetní…", povoleno: smiPsat, ikona: "zprava" } : null,
            r.uzavreno
                ? (A.hlavni() ? { akce: "odemknout", text: "Odemknout měsíc", povoleno: true, ikona: "vratit", nebezpeci: true } : null)
                : { akce: "uzavrit", text: "Uzavřít měsíc", povoleno: A.finance(), ikona: "hotovo" },
            { akce: "prepocitat", text: "Přepočítat", povoleno: smiPsat, ikona: "historie",
                title: "Spočítat znovu z výkazů a uložit" }
        ].concat(v.navic || []).filter(Boolean);
    };

    /** Tlačítko akce (detail řádku, karta) – stejné pro obě stránky. */
    A.tlacitko = (a, uid) => '<button type="button" class="btn btn--sm ' +
        (a.akce === "proplaceno" ? "btn--primary" : "btn--ghost") + '" data-akce="' + esc(a.akce) + '" data-uid="' + esc(uid) + '"' +
        (a.povoleno && !pracuji ? "" : " disabled") + (a.title ? ' title="' + esc(a.title) + '"' : "") + ">" + esc(a.text) + "</button>";

    /** Provede akci; neznámý druh vrátí false (stránka si ho obslouží sama). */
    A.akce = async (druh, uid, m) => {
        const kdoText = A.jmeno(A.clovek(uid), uid) + ", " + A.mesicText(m);
        if (["proplaceno", "bonus", "mzda", "poznamka"].indexOf(druh) !== -1) { otevriOkno(druh, uid, m); return true; }
        if (druh === "uzavrit") {
            if (!(await window.KBUI.potvrd({ nadpis: "Uzavřít měsíc – " + kdoText + "?",
                text: "Měsíc se spočítá z výkazů a zamkne. Zápisy, částky a bonusy toho měsíce pak změní a odemkne jen hlavní správce.",
                ano: "Uzavřít měsíc" }))) return true;
            await A.provedAkci(uid, m, { uzavrit: true }, "Měsíc je uzavřený.", "uzavřel měsíc výplaty");
            return true;
        }
        if (druh === "odemknout") {
            if (!A.hlavni()) return true;
            if (!(await window.KBUI.potvrd({ nadpis: "Odemknout měsíc – " + kdoText + "?",
                text: "Zápisy, částky a bonusy toho měsíce půjde zase měnit. Zapíše se, kdo a kdy odemknul.",
                ano: "Odemknout měsíc", nebezpecne: true }))) return true;
            await A.provedAkci(uid, m, { odemknout: true }, "Měsíc je odemknutý.", "odemknul měsíc výplaty");
            return true;
        }
        if (druh === "prepocitat") {
            const d = A.dokument(uid, m);
            if (d && d.uzavreno && !(await window.KBUI.potvrd({ nadpis: "Přepočítat uzavřený měsíc – " + kdoText + "?",
                text: "Čísla se spočítají znovu z dnešních výkazů a můžou se změnit. Měsíc zůstane uzavřený.",
                ano: "Přepočítat" }))) return true;
            await A.provedAkci(uid, m, { prepocet: true }, "Přepočítáno z výkazů.", "přepočítal výplatu");
            return true;
        }
        return false;
    };

    /** Nabídka pravým tlačítkem / dlouhým stiskem: fn(cil) → { uid, mesic, radek, mzdove, navic } | null. */
    A.pripojNabidku = (fn) => window.KBNabidka.pripoj((cil) => {
        if (!A.finance() || pracuji) return null;
        const x = fn(cil);
        if (!x) return null;
        const r = A.radek(nahradnik(x.uid), x.mesic);
        const polozky = A.akceRadku(r, { mzdove: x.mzdove, navic: x.navic }).filter(a => a.povoleno).map(a => ({
            text: a.text, ikona: a.ikona, nebezpeci: a.nebezpeci,
            fn: () => (a.fn ? a.fn() : A.akce(a.akce, x.uid, x.mesic)) }));
        if (!polozky.length) return null;
        return { nadpis: A.jmeno(A.clovek(x.uid), x.uid) + " · " + A.mesicText(x.mesic), radek: x.radek, polozky: polozky };
    });

    /* ----------------------------------------------------------- OKNO ----
       Jedno okno pro Proplaceno / Bonus / Mzda / Poznámka – co se nehodí,
       je schované. Id prvků drží tvar z vyplaty.html (testy na ně sahají). */
    const STYL = `
        .vyokno { position: fixed; inset: 0; z-index: 120; display: flex; align-items: center; justify-content: center;
            padding: 18px; background: rgba(11, 13, 16, .55); }
        .vyokno[hidden] { display: none; }
        .vyokno__deska { width: 100%; max-width: 480px; max-height: 92vh; overflow-y: auto; padding: 20px;
            display: flex; flex-direction: column; gap: 12px; }
        .vyokno__nadpis { font-size: var(--fs-4); font-weight: 900; }
        .vyokno__pole { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .vyokno__pole[hidden], .vyokno__zaskrt[hidden] { display: none; }
        .vyokno__pole .label { font-size: var(--fs-1); font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
            color: var(--muted); }
        .vyokno__pole textarea.field { min-height: 90px; resize: vertical; }
        .vyokno__mrizka { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .vyokno__zaskrt { display: flex; align-items: center; gap: 8px; font-size: var(--fs-2); font-weight: 700; }
        .vyokno__chyba { margin: 0; color: var(--danger); font-size: var(--fs-2); font-weight: 700; }
        .vyokno__historie { width: 100%; border-collapse: collapse; font-size: var(--fs-2); }
        .vyokno__historie th, .vyokno__historie td { padding: 4px 6px; border-bottom: 1px solid var(--line-soft); text-align: left;
            overflow-wrap: anywhere; }
        .vyokno__historie th { font-size: var(--fs-1); font-weight: 800; text-transform: uppercase; color: var(--muted); }
        .vyokno__historie tr.je-platna td { font-weight: 800; }
        @media (max-width: 599.98px) {
            .vyokno { padding: 8px; }
            .vyokno__deska { padding: 14px; }
            .vyokno__mrizka { grid-template-columns: minmax(0, 1fr); }
        }`;
    const OKNO = '<div class="card vyokno__deska" role="dialog" aria-modal="true" aria-labelledby="oNadpis">' +
        '<b id="oNadpis" class="vyokno__nadpis">Proplaceno</b>' +
        '<p id="oInfo" class="small muted" style="margin:0;line-height:1.6"></p>' +
        '<div class="vyokno__mrizka">' +
            '<label class="vyokno__pole" id="oOdPole"><span class="label">Platí od měsíce</span>' +
                '<input type="month" id="oOd" class="field" placeholder="RRRR-MM"></label>' +
            '<label class="vyokno__pole" id="oKcPole"><span class="label">Kč</span>' +
                '<input type="text" id="oKc" class="field" data-penize inputmode="numeric" autocomplete="off"></label>' +
            '<label class="vyokno__pole" id="oDatumPole"><span class="label">Datum</span>' +
                '<input type="date" id="oDatum" class="field"></label>' +
        "</div>" +
        '<label class="vyokno__pole" id="oPoznPole"><span class="label">Poznámka</span>' +
            '<input type="text" id="oPozn" class="field" maxlength="200" autocomplete="off"></label>' +
        '<label class="vyokno__pole" id="oTextPole"><span class="label">Poznámka pro účetní</span>' +
            '<textarea id="oText" class="field" maxlength="300" rows="4"></textarea></label>' +
        '<label class="vyokno__zaskrt" id="oUzavritPole"><input type="checkbox" id="oUzavrit"> Uzavřít měsíc (zamknout)</label>' +
        '<div id="oHistorie"></div>' +
        '<p id="oZamek" class="tiny muted" style="margin:0;line-height:1.6"></p>' +
        '<p id="oChyba" class="vyokno__chyba" role="alert" hidden></p>' +
        '<div class="row row--wrap" style="gap:10px;justify-content:flex-end">' +
            '<button type="button" id="oZrusit" class="btn btn--ghost">Zrušit</button>' +
            '<button type="button" id="oUlozit" class="btn btn--primary">Uložit</button>' +
        "</div></div>";

    const NADPISY = { proplaceno: "Proplaceno – ", bonus: "Bonus – ", mzda: "Mzda – ", poznamka: "Poznámka pro účetní – " };
    const ULOZIT = { proplaceno: "Zapsat proplacení", bonus: "Přidat bonus", mzda: "Uložit mzdu", poznamka: "Uložit poznámku" };

    function historieHtml(uid, m) {
        const h = ((window.KB.mzdy || {})[uid] || {}).historie || [];
        if (!h.length) return '<p class="small muted" style="margin:0">Mzda zatím není zadaná.</p>';
        const platna = V.mzdaProMesic({ historie: h }, m);
        return '<table class="vyokno__historie" id="oHistTab"><thead><tr><th>Od</th><th>Kč</th><th>Kdo, kdy</th></tr></thead><tbody>' +
            h.slice().sort((a, b) => String(b.od).localeCompare(String(a.od))).map(x =>
                '<tr class="' + (platna && platna.od === x.od ? "je-platna" : "") + '"><td>' + esc(A.mesicText(x.od) || x.od) +
                "</td><td>" + A.kcHtml(x.kc) + "</td><td>" + esc([x.kdo, A.kratkeMs(x.ms)].filter(Boolean).join(" · ")) + "</td></tr>"
            ).join("") + "</tbody></table>";
    }

    function otevriOkno(druh, uid, m) {
        const r = A.radek(nahradnik(uid), m);
        // čerstvý výpočet – otevřený měsíc se při uložení stejně spočítá znovu z výkazů
        const c = r.uzavreno ? r.cisla : r.zivy;
        okno = { druh: druh, uid: uid, mesic: m, zbyva: Math.max(0, Math.round(c.zbyva)) };
        const penize = druh === "proplaceno" || druh === "bonus";
        $("oNadpis").textContent = NADPISY[druh] + A.jmeno(A.clovek(uid), uid) + ", " + A.mesicText(m);
        $("oInfo").innerHTML = druh === "mzda"
            ? esc("Měsíční mzda platí od zadaného měsíce do další změny. V " + A.mesicText(m) + " teď: ") +
                (r.zivy.mzda ? A.kcHtml(r.zivy.mzda) : esc("nezadaná"))
            : druh === "poznamka" ? esc("Vypíše se u člověka ve výpisu pro mzdovou (i v PDF). Nejvýš 300 znaků.")
            : "K výplatě " + A.kcHtml(c.kVyplate) + " · už proplaceno " + A.kcHtml(c.proplacenoCelkem) +
                " · zbývá " + A.kcHtml(c.zbyva) + (r.zaklad.bezSazby && !r.uzavreno && r.typ !== "zamestnanec"
                    ? '<br><span class="vystitek vystitek--warn">' + esc(V.pocet(r.zaklad.bezSazby, ["zápis", "zápisy", "zápisů"])) +
                        " bez sazby – částka se ještě nedopočítala</span>" : "");
        $("oOdPole").hidden = druh !== "mzda";
        $("oKcPole").hidden = druh === "poznamka";
        $("oDatumPole").hidden = druh !== "proplaceno";
        $("oPoznPole").hidden = !penize;
        $("oTextPole").hidden = druh !== "poznamka";
        $("oUzavritPole").hidden = druh !== "proplaceno" || r.uzavreno;
        $("oHistorie").hidden = druh !== "mzda";
        $("oHistorie").innerHTML = druh === "mzda" ? historieHtml(uid, m) : "";
        $("oOd").value = m;
        $("oDatum").value = V.dnesISO();
        window.KBUI.nastavPenize($("oKc"), druh === "proplaceno" ? okno.zbyva : druh === "mzda" ? r.zivy.mzda : "");
        $("oPozn").value = "";
        $("oText").value = druh === "poznamka" ? String((r.d && r.d.poznamkaUcetni) || "") : "";
        $("oUzavrit").checked = true;                 // předvyplněno celé zbývá = doplacení
        delete $("oUzavrit").dataset.rucne;
        $("oZamek").textContent = druh === "proplaceno"
            ? (r.uzavreno ? "Měsíc je uzavřený – zápis jde jen hlavnímu správci." :
                "Doplacením celé částky se měsíc uzavře: zápisy, částky a bonusy toho měsíce pak změní jen hlavní správce. " +
                "Částečná platba měsíc nechá otevřený (zaškrtnutím ho zamkneš i tak).")
            : druh === "bonus" ? (r.uzavreno ? "Měsíc je uzavřený – bonus přidá jen hlavní správce." : "Bonus se přičte k nároku měsíce.")
            : druh === "mzda" ? "Stejný měsíc „od“ přepíše dřívější zápis. Otevřený měsíc se hned přepočítá."
            : (r.uzavreno ? "Měsíc je uzavřený – poznámku změní jen hlavní správce." : "");
        $("oChyba").hidden = true;
        $("oUlozit").textContent = ULOZIT[druh];
        $("vyOkno").hidden = false;
        A.pouzijSkryti();
        const prvni = druh === "mzda" ? $("oOd") : druh === "poznamka" ? $("oText") : $("oKc");
        prvni.focus();
        if (prvni.select) prvni.select();
    }
    A.otevriOkno = otevriOkno;
    A.oknoOtevrene = () => !!okno;

    function zavriOkno() {
        okno = null;
        $("vyOkno").hidden = true;
    }

    async function ulozOkno() {
        if (!okno) return;
        const { druh, uid, mesic: m } = okno;
        const kc = window.KBUI.penize($("oKc"));
        const datum = $("oDatum").value;
        const poznamka = $("oPozn").value.trim().slice(0, 200);
        const chyba = (t) => { $("oChyba").textContent = t; $("oChyba").hidden = false; };
        let ok = false;
        if (druh === "mzda") {
            const od = $("oOd").value.trim();
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(od)) return chyba("Zadej měsíc „platí od“ (RRRR-MM).");
            if (!(kc > 0)) return chyba("Zadej mzdu v Kč (víc než nula).");
            $("oUlozit").disabled = true;
            try {
                const historie = await window.KB.ulozMzdu(uid, od, kc);
                ok = true;
                // otevřený spočítaný měsíc hned přepočítat s novou mzdou (odběr KB.mzdy může ještě běžet)
                const d = A.dokument(uid, m);
                const platna = V.mzdaProMesic({ historie: historie }, m);
                if (d && !d.uzavreno && od <= m) {
                    await A.provedAkci(uid, m, { mzda: platna || { kc: 0, od: "" } }, "", "přepočítal výplatu po změně mzdy");
                }
                window.KBUI.toast("Mzda uložená (platí od " + A.mesicText(od) + ").");
            } catch (err) {
                console.error(err);
                chyba(err && err.code === "permission-denied" ? "Databáze změnu odmítla – mzdu mění jen finance."
                    : "Mzda se neuložila – zkus to znovu.");
            }
            $("oUlozit").disabled = false;
            if (ok) zavriOkno();
            return;
        }
        if (druh === "poznamka") {
            const text = $("oText").value.trim().slice(0, 300);
            $("oUlozit").disabled = true;
            ok = await A.provedAkci(uid, m, { poznamkaUcetni: text }, "Poznámka pro účetní uložená.", "upravil poznámku pro účetní");
            $("oUlozit").disabled = false;
            if (ok) zavriOkno();
            return;
        }
        if (!(kc > 0)) return chyba("Zadej částku v Kč (víc než nula).");
        if (druh === "proplaceno" && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return chyba("Zadej datum proplacení.");
        const zamknout = $("oUzavrit").checked;
        const polozka = druh === "proplaceno"
            ? { kc: Math.round(kc * 100) / 100, datum: datum, kdo: A.kdo(), poznamka: poznamka, ms: Date.now() }
            : { kc: Math.round(kc * 100) / 100, poznamka: poznamka, kdo: A.kdo(), ms: Date.now() };
        $("oUlozit").disabled = true;
        ok = await A.provedAkci(uid, m, druh === "proplaceno" ? { proplaceno: polozka, zamknout: zamknout } : { bonus: polozka },
            druh === "proplaceno"
                ? (ulozeno) => ulozeno && ulozeno.uzavreno ? "Proplacení zapsáno – měsíc je uzavřený."
                    : "Proplacení zapsáno – zbývá " + V.kc(ulozeno ? ulozeno.zbyva : 0) + ", měsíc zůstává otevřený."
                : "Bonus přidán.",
            druh === "proplaceno" ? "zapsal proplacení výplaty" : "přidal bonus k výplatě");
        $("oUlozit").disabled = false;
        if (ok) zavriOkno();
    }

    /* ---------------------------------------------------------- start */
    A.init = (volby) => {
        naplanuj = (volby && volby.naplanuj) || naplanuj;
        if ($("vyOkno")) return;
        const styl = document.createElement("style");
        styl.id = "vyplatyAkceStyl";
        styl.textContent = STYL;
        document.head.appendChild(styl);
        const el = document.createElement("div");
        el.id = "vyOkno";
        el.className = "vyokno";
        el.hidden = true;
        el.innerHTML = OKNO;
        document.body.appendChild(el);

        $("oZrusit").addEventListener("click", zavriOkno);
        $("oUlozit").addEventListener("click", ulozOkno);
        el.addEventListener("click", (event) => { if (event.target === el) zavriOkno(); });
        // částečná platba měsíc nezamyká – zaškrtávátko jde se zadanou částkou, dokud na něj člověk nesáhne
        $("oKc").addEventListener("input", () => {
            if (okno && okno.druh === "proplaceno" && !$("oUzavrit").dataset.rucne) {
                $("oUzavrit").checked = window.KBUI.penize($("oKc")) >= okno.zbyva - 0.005;
            }
        });
        $("oUzavrit").addEventListener("change", () => { $("oUzavrit").dataset.rucne = "1"; });
        document.addEventListener("click", (event) => {
            if (event.target.closest && event.target.closest("[data-penize-prepni]")) {
                penizeVidet = !penizeVidet;
                A.pouzijSkryti();
            }
        });
        document.addEventListener("keydown", (event) => {
            if (!okno) return;
            if (event.key === "Escape") { event.preventDefault(); zavriOkno(); return; }
            if (event.key === "Enter" && event.target.closest && event.target.closest("#vyOkno input")) {
                event.preventDefault();
                ulozOkno();
            }
        });
    };
})();
