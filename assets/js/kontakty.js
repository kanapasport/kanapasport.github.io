/* =========================================================================
   KONTAKTY – čisté funkce bez databáze (Michal 20. 11. 2026)
   Dodavatelé, řemeslníci a služby, které měl Michal v Excelu. Tady je
   jen to, co jde spočítat bez Firebase: čtení textu zkopírovaného
   z Excelu, úklid polí, bezpečné odkazy a hledání. Stránka
   (kontakty.html) i store.js (KB.ulozKontakt, KB.vlozKontakty) volají
   totéž, takže co se uloží, je vyčištěné stejně, ať to přišlo z okna,
   z vložení z Excelu, nebo z konzole. Bez závislostí, ať jde pustit
   v Node s podvrženým `window` (testy\test_kontakty.js).
   ========================================================================= */
(function (root) {
    "use strict";

    /* Pole kontaktu na JEDNOM místě. Stránka z nich kreslí sloupce tabulky,
       kartu na telefonu i formulář, hledání a úklid jedou přes ně taky –
       další pole (štítky, kontaktní osoba, město…) si Michal teprve vybere
       a má stačit přidat řádek sem. `hlavicky` = jak se sloupec může
       jmenovat v Excelu (bez diakritiky, mezer a teček, malými písmeny).
       `typ` říká, jak se hodnota ukáže: text | tel | email | web | dlouhy. */
    const POLE = [
        { klic: "nazev", nazev: "Název", typ: "text", max: 120, povinne: true,
          hlavicky: ["nazev", "nazevfirmy", "firma", "jmeno", "kontakt", "dodavatel"] },
        { klic: "telefon", nazev: "Telefon", typ: "tel", max: 60,
          hlavicky: ["telcislo", "telefon", "tel", "telefonnicislo", "cislo", "mobil", "telefonmobil"] },
        { klic: "email", nazev: "E-mail", typ: "email", max: 160,
          hlavicky: ["email", "mail", "emailovaadresa", "emaily"] },
        { klic: "web", nazev: "Web", typ: "web", max: 160,
          hlavicky: ["web", "www", "webovestranky", "stranky", "url", "adresawebu"] },
        { klic: "poznamka", nazev: "Poznámka", typ: "dlouhy", max: 500,
          hlavicky: ["poznamka", "poznamky", "pozn", "popis", "info"] }
    ];

    /** Malými písmeny bez diakritiky – na hledání a na porovnání hlaviček. */
    const fold = (s) => String(s == null ? "" : s).toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "");

    /* Excel dává do schránky i pevné a nezlomitelné mezery (formát čísla
       „737 698 306“ je má mezi trojicemi) – v telefonu pak hledání ani
       odkaz nesedí. */
    const MEZERY = /[    ​﻿]/g;
    const radek = (s) => String(s == null ? "" : s).replace(MEZERY, " ").replace(/\s+/g, " ").trim();

    /* ------------------------------------------------------------ úklid */

    function cistiTelefon(t) {
        const s = radek(t);
        const cislice = s.replace(/[\s()./-]/g, "");
        let m = /^\d{9}$/.exec(cislice);
        if (m) return cislice.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
        // i bez plusu: Excel má číslo s předvolbou často jako číslo (420737698306) a plus zahodí
        m = /^(?:\+|00)?420(\d{9})$/.exec(cislice);
        if (m) return "+420 " + m[1].replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
        return s;                       // cizí tvar (pevná linka s klapkou, dvě čísla…) jen ořezat
    }

    function cistiWeb(w) {
        let s = String(w == null ? "" : w).replace(MEZERY, "").replace(/\s+/g, "");
        // čárka místo tečky je v Excelu nejčastější překlep („www,neco.cz“); v adrese webu čárka nebývá
        s = s.replace(/,/g, ".");
        s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");      // schéma neukládat – odkaz si ho dodá sám
        return s.replace(/\/$/, "");
    }

    function cistiEmail(e) {
        return String(e == null ? "" : e).replace(MEZERY, " ")
            .split(/[\s,;]+/).map(x => x.replace(/^mailto:/i, "").trim()).filter(Boolean).join(", ");
    }

    /**
     * Ořez a limity podle smlouvy dat; vrací vždy všechna pole z POLE
     * jako texty (bez `undefined`). Poznámka smí mít víc řádků, ostatní ne.
     */
    function cisti(data) {
        const d = data || {};
        const vysledek = {};
        POLE.forEach(p => {
            let v = d[p.klic];
            if (p.typ === "tel") v = cistiTelefon(v);
            else if (p.typ === "web") v = cistiWeb(v);
            else if (p.typ === "email") v = cistiEmail(v);
            else if (p.typ === "dlouhy") v = String(v == null ? "" : v).replace(MEZERY, " ")
                .replace(/\r\n?/g, "\n").split("\n").map(r => r.replace(/[ \t]+/g, " ").trim()).join("\n")
                .replace(/\n{3,}/g, "\n\n").trim();
            else v = radek(v);
            vysledek[p.klic] = v.slice(0, p.max).trim();
        });
        return vysledek;
    }

    /* ------------------------------------------------------- odkazy
       Do `href` nikdy holá hodnota z databáze: web nebo poznámku může
       kdokoli s přístupem podvrhnout třeba na `javascript:`. Odkaz vzniká
       jen z hodnoty, která prošla úzkým tvarem – jinak prázdno a stránka
       ukáže obyčejný text. */

    const DOMENA = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,24}(?::\d{1,5})?(?:[/?#][\w\-./?=&%#~+:@!,;]*)?$/u;

    function webHref(web) {
        const s = cistiWeb(web);
        return s && s.length <= 300 && DOMENA.test(s) ? "https://" + s : "";
    }

    function telHref(telefon) {
        // víc čísel v jedné buňce („737 111 222, 602 …“) – odkaz na první
        const prvni = String(telefon == null ? "" : telefon).split(/[,;]/)[0].replace(MEZERY, "");
        let c = prvni.replace(/[\s()./-]/g, "");
        if (/^00\d{6,15}$/.test(c)) c = "+" + c.slice(2);
        if (!/^\+?\d{6,15}$/.test(c)) return "";
        if (/^\d{9}$/.test(c)) c = "+420" + c;
        return "tel:" + c;
    }

    const EMAIL = /^[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,24}$/u;
    const jeEmail = (a) => EMAIL.test(String(a || "")) && String(a).length <= 160;

    /** Adresy z pole e-mail (už uklizené nebo ne) – stránka dělá odkaz z každé zvlášť. */
    const adresy = (email) => cistiEmail(email).split(", ").filter(Boolean);

    function mailHref(email) {
        const prvni = adresy(email)[0] || "";
        return jeEmail(prvni) ? "mailto:" + prvni : "";
    }

    /* ---------------------------------------------- duplicity a hledání */

    /** Klíč duplicity: název bez diakritiky a interpunkce + posledních 9 číslic
        telefonu (s předvolbou i bez ní je to totéž číslo). */
    function klic(k) {
        const x = k || {};
        const nazev = fold(x.nazev).replace(/[^\p{L}\p{N}]+/gu, "");
        const cislice = String(x.telefon || "").replace(/\D/g, "").slice(-9);
        return nazev + "|" + cislice;
    }

    /** Hledání přes všechna pole; mezera = všechna slova musí sedět. */
    function hleda(k, dotaz) {
        const slova = fold(dotaz).split(/\s+/).filter(Boolean);
        if (!slova.length) return true;
        const x = k || {};
        const text = fold(POLE.map(p => x[p.klic] || "").join(" \n ")) +
            " " + String(x.telefon || "").replace(/\D/g, "");    // „737698“ najde i „737 698 306“
        return slova.every(s => text.indexOf(s) !== -1);
    }

    /* ------------------------------------------------ vložení z Excelu */

    /**
     * Text ze schránky po kopírování buněk v Excelu → řádky buněk.
     * Buňky dělí tabulátor, řádky konec řádku. Buňka s odřádkováním,
     * tabulátorem nebo uvozovkou přijde celá v uvozovkách a uvozovky
     * uvnitř jsou zdvojené ("" → ").
     */
    function rozdelTsv(text) {
        const s = String(text == null ? "" : text).replace(/^﻿/, "");
        const radky = [];
        let bunky = [], bunka = "", i = 0;
        const konecBunky = () => { bunky.push(bunka); bunka = ""; };
        const konecRadku = () => { konecBunky(); radky.push(bunky); bunky = []; };
        while (i < s.length) {
            if (bunka === "" && s[i] === "\"") {
                // buňka v uvozovkách – čte se do uvozovky, za kterou není druhá
                let j = i + 1, obsah = "", zavreno = false;
                while (j < s.length) {
                    if (s[j] === "\"") {
                        if (s[j + 1] === "\"") { obsah += "\""; j += 2; continue; }
                        zavreno = true; j++; break;
                    }
                    obsah += s[j++];
                }
                // uvozovky na začátku obyčejné buňky (bez páru nebo s textem za nimi) se berou doslova
                if (zavreno && (j >= s.length || s[j] === "\t" || s[j] === "\n" || s[j] === "\r")) {
                    bunka = obsah; i = j;
                    continue;
                }
                bunka = "\""; i++;
                continue;
            }
            const c = s[i];
            if (c === "\t") { konecBunky(); i++; continue; }
            if (c === "\r" || c === "\n") {
                konecRadku();
                i += (c === "\r" && s[i + 1] === "\n") ? 2 : 1;
                continue;
            }
            bunka += c; i++;
        }
        if (bunka !== "" || bunky.length) konecRadku();
        return radky;
    }

    const HLAVICKA = (bunka) => {
        const f = fold(bunka).replace(/[^a-z0-9]+/g, "");
        const p = f ? POLE.find(x => x.hlavicky.indexOf(f) !== -1) : null;
        return p ? p.klic : "";
    };

    /**
     * Text zkopírovaný z Excelu → pole kontaktů (vyčištěných `cisti`).
     * První řádek s hlavičkou určí sloupce v jakémkoli pořadí; bez hlavičky
     * platí pořadí z POLE. Sloupce navíc (bez známého názvu) se připojí
     * k poznámce přes „ · “. Prázdné řádky a řádky bez názvu vynechá.
     */
    function zExcelu(text) {
        const radky = rozdelTsv(text).filter(r => r.some(b => String(b).trim() !== ""));
        if (!radky.length) return [];
        /* Hlavička = aspoň dvě buňky (nebo všechny neprázdné) jsou známé
           názvy sloupců a žádný se neopakuje. Obyčejný řádek s firmou
           „Web Plus“ tak hlavičkou nebude. */
        const prvni = radky[0].map(HLAVICKA);
        const neprazdne = radky[0].filter(b => String(b).trim() !== "").length;
        const znamych = prvni.filter(Boolean);
        const jeHlavicka = znamych.length >= Math.min(2, neprazdne) &&
            new Set(znamych).size === znamych.length && znamych.indexOf("nazev") !== -1;
        let sloupce;
        if (jeHlavicka) {
            sloupce = prvni;
            radky.shift();
        } else {
            sloupce = POLE.map(p => p.klic);
        }
        return radky.map(r => {
            const k = {}, navic = [];
            r.forEach((b, i) => {
                const hodnota = String(b == null ? "" : b).trim();
                const pole = sloupce[i];
                if (pole) k[pole] = hodnota;
                else if (hodnota) navic.push(hodnota);
            });
            if (navic.length) k.poznamka = [k.poznamka || ""].concat(navic).filter(Boolean).join(" · ");
            return cisti(k);
        }).filter(k => k.nazev);
    }

    root.KBKontakty = {
        POLE: POLE,
        fold: fold,
        cisti: cisti,
        zExcelu: zExcelu,
        rozdelTsv: rozdelTsv,
        webHref: webHref,
        telHref: telHref,
        mailHref: mailHref,
        adresy: adresy,
        jeEmail: jeEmail,
        klic: klic,
        hleda: hleda
    };
})(typeof window !== "undefined" ? window : globalThis);
