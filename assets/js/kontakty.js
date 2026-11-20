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
       další pole (štítky, kontaktní osoba…) má stačit přidat řádek sem. `hlavicky` = jak se sloupec může
       jmenovat v Excelu (bez diakritiky, mezer a teček, malými písmeny).
       `typ` říká, jak se hodnota ukáže: text | tel | email | web | misto |
       dlouhy | ano (true/false) | vycet (jen hodnoty z `hodnoty`) | datum (RRRR-MM-DD).
       `bunka` = pole nemá vlastní sloupec, kreslí se v buňce jiného pole
       (hvězdička u názvu, palec a datum u zkušenosti) – Michal 20. 11. 2026
       chtěl k pěti polím město, zkušenost a oblíbené a tabulka by jinak
       měla dvanáct sloupců. */
    const POLE = [
        { klic: "nazev", nazev: "Název", typ: "text", max: 120, povinne: true,
          hlavicky: ["nazev", "nazevfirmy", "firma", "jmeno", "kontakt", "dodavatel"] },
        { klic: "telefon", nazev: "Telefon", typ: "tel", max: 60,
          hlavicky: ["telcislo", "telefon", "tel", "telefonnicislo", "cislo", "mobil", "telefonmobil"] },
        { klic: "email", nazev: "E-mail", typ: "email", max: 160,
          hlavicky: ["email", "mail", "emailovaadresa", "emaily"] },
        { klic: "web", nazev: "Web", typ: "web", max: 160,
          hlavicky: ["web", "www", "webovestranky", "stranky", "url", "adresawebu"] },
        // jedno pole: někdo má adresu sídla, jiný jen „Brno a okolí“ – obojí jde do map
        { klic: "mesto", nazev: "Město / adresa", typ: "misto", max: 160,
          hlavicky: ["mesto", "adresa", "mestoadresa", "sidlo", "misto", "obec", "lokalita", "kdejezdi"] },
        { klic: "palec", nazev: "Hodnocení", typ: "vycet", hodnoty: ["", "nahoru", "dolu"], bunka: "zkusenost", hlavicky: [] },
        { klic: "zkusenost", nazev: "Zkušenost", typ: "text", max: 200,
          hlavicky: ["zkusenost", "zkusenosti", "hodnoceni", "reference"] },
        { klic: "naposledy", nazev: "Naposledy použit", typ: "datum", bunka: "zkusenost", hlavicky: [] },
        { klic: "poznamka", nazev: "Poznámka", typ: "dlouhy", max: 500,
          hlavicky: ["poznamka", "poznamky", "pozn", "popis", "info"] },
        { klic: "oblibeny", nazev: "Oblíbený", typ: "ano", bunka: "nazev", hlavicky: [] }
    ];
    /* Bez hlavičky z Excelu platí pořadí PŮVODNÍCH pěti sloupců – tak vypadal
       Michalův sešit a nová pole v něm nejsou. */
    const BEZ_HLAVICKY = ["nazev", "telefon", "email", "web", "poznamka"];
    /** Pole, která se dají hledat a psát jako text (ne ano/ne, výčet a datum). */
    const TEXTOVE = (p) => ["ano", "vycet", "datum"].indexOf(p.typ) === -1;

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

    /** RRRR-MM-DD jen jako skutečné datum (žádný 31. 2.), jinak "". */
    function cistiDatum(v) {
        const s = String(v == null ? "" : v).trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return "";
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : "";
    }

    /** „2026-10-12“ → „12. 10. 2026“ (neplatné → ""). */
    function datumCesky(v) {
        const s = cistiDatum(v);
        return s ? Number(s.slice(8)) + ". " + Number(s.slice(5, 7)) + ". " + s.slice(0, 4) : "";
    }

    /**
     * Ořez a limity podle smlouvy dat; vrací vždy všechna pole z POLE
     * (bez `undefined`). Poznámka smí mít víc řádků, ostatní texty ne.
     * Ano/ne jen z `=== true`, výčet jen ze seznamu, datum jen ISO – co
     * kdo podvrhne z konzole, skončí jako prázdno. Náhled a počet obrázků
     * sem nepatří: píše je jen KB.pridejKontaktObrazek / smazKontaktObrazek.
     */
    function cisti(data) {
        const d = data || {};
        const vysledek = {};
        POLE.forEach(p => {
            let v = d[p.klic];
            if (p.typ === "ano") { vysledek[p.klic] = v === true; return; }
            if (p.typ === "vycet") { vysledek[p.klic] = p.hodnoty.indexOf(v) !== -1 ? v : ""; return; }
            if (p.typ === "datum") { vysledek[p.klic] = cistiDatum(v); return; }
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

    /* Město / adresa → hledání na Mapy.cz. Hodnota jde jen do parametru
       přes encodeURIComponent, takže ani podvrh odkaz nezmění. */
    function mapaHref(mesto) {
        const s = radek(mesto);
        return s ? "https://mapy.cz/zakladni?q=" + encodeURIComponent(s.slice(0, 160)) : "";
    }

    /** Oblíbené první, pak ostatní; v obou částech česky podle názvu. */
    const serad = (seznam) => (Array.isArray(seznam) ? seznam : []).slice().sort((a, b) =>
        ((b && b.oblibeny === true) - (a && a.oblibeny === true)) ||
        String((a && a.nazev) || "").localeCompare(String((b && b.nazev) || ""), "cs"));

    /* ---------------------------------------------- duplicity a hledání */

    /** Klíč duplicity: název bez diakritiky a interpunkce + posledních 9 číslic
        telefonu (s předvolbou i bez ní je to totéž číslo). */
    function klic(k) {
        const x = k || {};
        const nazev = fold(x.nazev).replace(/[^\p{L}\p{N}]+/gu, "");
        const cislice = String(x.telefon || "").replace(/\D/g, "").slice(-9);
        return nazev + "|" + cislice;
    }

    /** Hledání přes textová pole (i město a zkušenost); mezera = všechna slova musí sedět. */
    function hleda(k, dotaz) {
        const slova = fold(dotaz).split(/\s+/).filter(Boolean);
        if (!slova.length) return true;
        const x = k || {};
        const text = fold(POLE.filter(TEXTOVE).map(p => x[p.klic] || "").join(" \n ")) +
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
     * První řádek s hlavičkou určí sloupce v jakémkoli pořadí (pozná i Město /
     * Adresa a Zkušenost); bez hlavičky platí pořadí BEZ_HLAVICKY. Sloupce navíc (bez známého názvu) se připojí
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
            sloupce = BEZ_HLAVICKY.slice();
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

    /* ------------------------------------------------- zmenšenina
       Malá podoba prvního obrázku do seznamu (nejvýš 240 px na delší straně).
       KBUI.nahledObrazku dělá 420 px na šířku – u vysokého snímku e-mailu
       to přeleze 90 000 znaků, které na kontakt smí, a seznam kreslí
       zmenšeninu jen 40 px vysokou. Jen v prohlížeči (canvas). */
    function zmensenina(dataUrl) {
        return new Promise((ok) => {
            if (typeof Image === "undefined" || typeof document === "undefined") return ok("");
            const img = new Image();
            img.onload = () => {
                const k = Math.min(1, 240 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
                const c = document.createElement("canvas");
                c.width = Math.max(1, Math.round(img.naturalWidth * k));
                c.height = Math.max(1, Math.round(img.naturalHeight * k));
                const g = c.getContext("2d");
                g.fillStyle = "#fff";               // průhledné PNG by v JPEG zčernalo
                g.fillRect(0, 0, c.width, c.height);
                g.drawImage(img, 0, 0, c.width, c.height);
                ok(c.toDataURL("image/jpeg", 0.75));
            };
            img.onerror = () => ok("");
            img.src = dataUrl;
        });
    }

    root.KBKontakty = {
        zmensenina: zmensenina,
        POLE: POLE,
        fold: fold,
        cisti: cisti,
        zExcelu: zExcelu,
        rozdelTsv: rozdelTsv,
        webHref: webHref,
        telHref: telHref,
        mailHref: mailHref,
        mapaHref: mapaHref,
        datumCesky: datumCesky,
        serad: serad,
        MAX_OBRAZKU: 6,
        adresy: adresy,
        jeEmail: jeEmail,
        klic: klic,
        hleda: hleda
    };
})(typeof window !== "undefined" ? window : globalThis);
