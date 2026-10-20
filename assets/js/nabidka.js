/* ==========================================================================
   Nabídka u řádku a hromadný výběr – window.KBNabidka.

   NABÍDKA: pravé tlačítko myši, „⋯“ na konci řádku, klávesa ContextMenu
   (Shift+F10) a dlouhé podržení prstu otevřou TOTÉŽ. Co v ní je, skládá
   stránka sama přes pripoj(fn): fn(prvek, dotyk) vrací
       { nadpis, radek, polozky: [{ text, ikona, fn, odkaz, nebezpeci, oddel }] }
   nebo null (zeptá se dalšího zdroje, nakonec zůstane nabídka prohlížeče).
   - ikona = název z IKONY níž (žádné HTML ze stránky),
   - odkaz = adresa (položka je pak <a>, jde i prostředním tlačítkem),
   - nebezpeci = mazání a spol.: jde vždycky dolů za čáru a červeně; potvrzení
     si dělá fn sama stejně jako dosud (confirm), komponenta nic nepřidává,
   - radek = prvek, který se po dobu otevření zvýrazní.
   Zavře ji Esc (fokus zpátky), klik vedle, Tab, posun stránky nebo výběr.
   V polích, odkazech a nad označeným textem zůstává nabídka prohlížeče.
   „⋯“ do řádku: KBNabidka.tlacitko("Další akce: …") – stačí, aby leželo
   uvnitř prvku, který zdroj pozná (stejně jako při pravém kliku).

   HROMADNÝ VÝBĚR: KBNabidka.vyber({ koren, nazev, akce, zap }) vrací
   ovládání s box(id, popis) / boxVse() (HTML zaškrtávátek), ids(), zrus().
   Shift+klik vybere rozsah. Dole se ukáže lišta „Vybráno N“ s akcemi
   akce(ids) → [{ text, ikona, nebezpeci, fn(ids) }]. Akce jsou smyčky přes
   existující funkce pro jednu položku – na to je KBNabidka.hromadne(ids,
   { otazka, krok(id) → false = přeskočeno, hotovo }): jedno potvrzení,
   průběh v liště a souhrn výsledku.

   Port Michalovy aplikace Asistent (js/nabidka.js), bez ES modulů – web má
   klasické skripty a globály (KB, KBUI).
   ========================================================================== */

(function () {
    "use strict";

    const N = {};
    window.KBNabidka = N;

    const esc = (v) => (window.KBUI && window.KBUI.esc)
        ? window.KBUI.esc(v)
        : String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const toast = (text, ton) => { if (window.KBUI && window.KBUI.toast) window.KBUI.toast(text, ton); };

    const DRZET_MS = 480;     // dlouhé podržení prstu (iPhone pravé tlačítko nemá a contextmenu neposílá)
    const POSUN_PX = 10;      // prst se pohnul = posouvání stránky, ne podržení

    /* ---------------------------------------------------------- ikony ---
       Jen obrysy 24×24, barvu bere z textu. Stránka posílá název, ne SVG. */
    const IKONY = {
        upravit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
        smazat: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
        hotovo: '<path d="M5 13l4 4L19 7"/>',
        potvrdit: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
        vratit: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
        oko: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        skryt: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3 3.9"/>' +
            '<path d="M6.6 6.6A17 17 0 002 12s3.5 7 10 7a10 10 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
        hodiny: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
        lupa: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
        kopirovat: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 011-1h10"/>',
        otevrit: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
        filtr: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
        qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/>' +
            '<rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18v2M18 14h2"/>',
        platba: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
        vlajka: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
        hvezda: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
        historie: '<path d="M3 12a9 9 0 103-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        tisk: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
        rozbalit: '<path d="M6 9l6 6 6-6"/>',
        seznam: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
        uloz: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8"/><path d="M8 21v-7h8v7"/>',
        clovek: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
        kalendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
        zprava: '<path d="M4 5h16v11H8l-4 4z"/>'
    };
    N.ikona = (nazev) => IKONY[nazev]
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IKONY[nazev] + "</svg>"
        : "";

    /** „⋯“ do řádku. Popisek je pro čtečku a bublinu („Další akce: Oběd“). */
    N.tlacitko = (popisek) =>
        '<button type="button" class="nabidka-vic" data-nabidka-vic aria-haspopup="menu" aria-expanded="false" ' +
        'title="' + esc(popisek || "Další akce") + '" aria-label="' + esc(popisek || "Další akce") + '">' +
        '<span aria-hidden="true">⋯</span></button>';

    /** Zkopíruje text do schránky a řekne to. */
    N.kopiruj = (text, hlaska) => {
        const t = String(text == null ? "" : text);
        if (!t) return Promise.resolve(false);
        const zaloha = () => {
            const pole = document.createElement("textarea");
            pole.value = t;
            pole.setAttribute("readonly", "");
            pole.style.cssText = "position:fixed;left:-9999px;top:0";
            document.body.appendChild(pole);
            pole.select();
            let ok = false;
            try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
            pole.remove();
            return ok;
        };
        const hotovo = (ok) => {
            toast(ok ? (hlaska || "Zkopírováno.") : "Zkopíruj to ručně (Ctrl+C): " + t, ok ? undefined : "warn");
            return ok;
        };
        return (navigator.clipboard && navigator.clipboard.writeText
            ? navigator.clipboard.writeText(t).then(() => true, () => zaloha())
            : Promise.resolve(zaloha())).then(hotovo);
    };

    /* ======================================================== NABÍDKA ==== */

    const zdroje = [];
    let otevrena = null;      // { el, puvod, kdy, sirka, tlacitko, radek }
    let drzeni = null;        // { casovac, x, y }
    let potlacitKlik = 0;     // po dlouhém podržení pošle prohlížeč ještě klepnutí – to se zahodí

    /** Kdo skládá nabídku: fn(prvek, dotyk) → nabídka, nebo null. */
    N.pripoj = (fn) => { if (typeof fn === "function" && zdroje.indexOf(fn) < 0) zdroje.push(fn); };
    N.jeOtevrena = () => !!otevrena;

    function nabidkaPro(cil, dotyk, zTlacitka) {
        if (!zdroje.length || !cil || !cil.closest) return null;
        if (!zTlacitka) {
            // v polích a v odkazech nechat nabídku prohlížeče (kopírovat, vložit, otevřít odkaz)
            if (cil.closest('input, textarea, select, [contenteditable="true"], a[href], .nabidka, ' +
                '.vyber-lista, [hidden]')) return null;
            // označený text → nabídka prohlížeče s Kopírovat
            try {
                const v = window.getSelection && window.getSelection();
                if (v && !v.isCollapsed && String(v).trim() && v.rangeCount &&
                    v.getRangeAt(0).intersectsNode(cil)) return null;
            } catch (e) { /* bez výběru */ }
        }
        for (let i = 0; i < zdroje.length; i++) {
            let n = null;
            try { n = zdroje[i](cil, !!dotyk); } catch (e) { console.error(e); n = null; }
            if (n && n.polozky && n.polozky.some(Boolean)) return n;
        }
        return null;
    }

    /** Pořadí: běžné položky, jak je stránka dala; nebezpečné dolů za čáru. */
    function srovnej(polozky) {
        const vse = (polozky || []).filter(p => p && p.text);
        const bezne = vse.filter(p => !p.nebezpeci);
        const nebezpecne = vse.filter(p => p.nebezpeci)
            .map((p, i) => i === 0 && bezne.length ? Object.assign({}, p, { oddel: true }) : p);
        return bezne.concat(nebezpecne);
    }

    function polozkaHtml(p, i) {
        const tridy = "nabidka__polozka" + (p.nebezpeci ? " nabidka__polozka--nebezpeci" : "");
        const vnitrek = N.ikona(p.ikona) + "<span>" + esc(p.text) + "</span>";
        return (p.oddel && i ? '<hr class="nabidka__oddel" role="separator">' : "") +
            (p.odkaz
                ? '<a role="menuitem" class="' + tridy + '" href="' + esc(p.odkaz) + '" data-nabidka-i="' + i + '"' +
                    (p.novaZalozka ? ' target="_blank" rel="noopener"' : "") + ">" + vnitrek + "</a>"
                : '<button type="button" role="menuitem" class="' + tridy + '" data-nabidka-i="' + i + '">' +
                    vnitrek + "</button>");
    }

    /**
     * Otevře nabídku v bodě x, y (px v okně). puvod = prvek, na který se
     * kliklo (po Esc na něj vrátí fokus); volby.dotyk = podržení prstem
     * (fokus nepřesouvat), volby.tlacitko = „⋯“, ke kterému patří
     * (zarovná se k jeho pravému okraji a nese aria-expanded).
     */
    N.otevri = (x, y, n, puvod, volby) => {
        const v = volby || {};
        N.zavri(true);
        const polozky = srovnej(n.polozky);
        if (!polozky.length) return;
        const el = document.createElement("div");
        el.className = "nabidka";
        el.setAttribute("role", "menu");
        if (n.nadpis) el.setAttribute("aria-label", String(n.nadpis));
        el.innerHTML = (n.nadpis ? '<div class="nabidka__nadpis" aria-hidden="true">' + esc(n.nadpis) + "</div>" : "") +
            polozky.map(polozkaHtml).join("");
        document.body.appendChild(el);

        // u kurzoru, ale vždy celá na obrazovce (u pravého a dolního okraje se otočí)
        const w = el.offsetWidth, h = el.offsetHeight, okraj = 8;
        const sirka = document.documentElement.clientWidth, vyska = window.innerHeight;
        let levy = x, horni = y;
        if (v.tlacitko) {
            const r = v.tlacitko.getBoundingClientRect();
            levy = r.right - w;
            horni = r.bottom + 4;
            if (horni + h + okraj > vyska) horni = r.top - h - 4;
        } else if (y + h + okraj > vyska) {
            horni = y - h;
        }
        el.style.left = Math.max(okraj, Math.min(levy, sirka - w - okraj)) + "px";
        el.style.top = Math.max(okraj, Math.min(horni, vyska - h - okraj)) + "px";

        el.addEventListener("click", (e) => {
            e.stopPropagation(); // klepnutí v nabídce nejde do ovládání stránky pod ní
            const b = e.target.closest("[data-nabidka-i]");
            if (!b) return;
            const p = polozky[Number(b.getAttribute("data-nabidka-i"))];
            N.zavri(true);
            if (p && p.odkaz) return;          // odkaz si prohlížeč otevře sám
            e.preventDefault();
            if (p && typeof p.fn === "function") {
                try {
                    const r = p.fn();
                    if (r && typeof r.catch === "function") r.catch(err => { console.error(err); toast("Akce selhala.", "error"); });
                } catch (err) { console.error(err); toast("Akce selhala.", "error"); }
            }
        });

        const radek = n.radek && n.radek.classList ? n.radek : null;
        if (radek) radek.classList.add("je-v-nabidce");
        if (v.tlacitko) v.tlacitko.setAttribute("aria-expanded", "true");
        otevrena = { el, puvod, kdy: Date.now(), sirka, tlacitko: v.tlacitko || null, radek };
        requestAnimationFrame(() => el.classList.add("videt"));
        const prvni = el.querySelector("[data-nabidka-i]");
        if (prvni && !v.dotyk) prvni.focus({ preventScroll: true }); // šipkami a Enterem z klávesnice
    };

    /** Zavře nabídku; bez výběru (Esc) vrátí fokus tam, odkud se otevřela. */
    N.zavri = (vybrano) => {
        if (!otevrena) return;
        const { el, puvod, tlacitko, radek } = otevrena;
        const mela = el.contains(document.activeElement);
        otevrena = null;
        el.remove();
        if (radek) radek.classList.remove("je-v-nabidce");
        if (tlacitko) tlacitko.setAttribute("aria-expanded", "false");
        const kam = tlacitko && tlacitko.isConnected ? tlacitko
            : (puvod && puvod.isConnected ? puvod.closest("button, [tabindex], a[href]") : null);
        if (!vybrano && mela && kam) { try { kam.focus({ preventScroll: true }); } catch (e) { /* nic */ } }
    };

    function zrusDrzeni() {
        if (drzeni) { clearTimeout(drzeni.casovac); drzeni = null; }
    }

    // „⋯“ v řádku – zachytí se dřív, než klik dojde k řádku (ten by třeba otevřel detail)
    document.addEventListener("click", (e) => {
        const b = e.target && e.target.closest && e.target.closest("[data-nabidka-vic]");
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        if (otevrena && otevrena.tlacitko === b) { N.zavri(); return; }
        const n = nabidkaPro(b, false, true);
        if (!n) { toast("Tady teď žádná akce není.", "warn"); return; }
        const r = b.getBoundingClientRect();
        // z klávesnice (Enter, mezerník) má klik nulové souřadnice → fokus do nabídky
        otevri(r.right, r.bottom, n, b, { tlacitko: b, dotyk: e.pointerType === "touch" });
    }, true);
    const otevri = N.otevri;

    // pravé tlačítko (PC), Ctrl+klik (Mac), klávesa nabídky / Shift+F10, dlouhé podržení na Androidu
    document.addEventListener("contextmenu", (e) => {
        if (otevrena && otevrena.el.contains(e.target)) { e.preventDefault(); return; }
        const n = nabidkaPro(e.target, e.pointerType === "touch");
        if (!n) { N.zavri(true); return; }
        e.preventDefault();
        zrusDrzeni();
        if (otevrena && Date.now() - otevrena.kdy < 700) return; // právě ji otevřelo dlouhé podržení
        let x = e.clientX, y = e.clientY;
        const zKlavesnice = !x && !y;
        if (zKlavesnice) { const r = e.target.getBoundingClientRect(); x = r.left + 16; y = r.bottom; }
        const tl = e.target.closest && e.target.closest("[data-nabidka-vic]");
        otevri(x, y, n, e.target, { tlacitko: zKlavesnice && tl ? tl : null });
    });

    // dlouhé podržení prstem (iPhone, iPad)
    document.addEventListener("pointerdown", (e) => {
        if (otevrena && !otevrena.el.contains(e.target) &&
            !(otevrena.tlacitko && otevrena.tlacitko.contains(e.target))) N.zavri(true);
        zrusDrzeni();
        if (e.pointerType !== "touch" || !e.isPrimary || !nabidkaPro(e.target, true)) return;
        const cil = e.target, x = e.clientX, y = e.clientY;
        drzeni = {
            x, y,
            casovac: setTimeout(() => {
                drzeni = null;
                const n = cil.isConnected ? nabidkaPro(cil, true) : null;
                if (!n) return;
                potlacitKlik = Date.now();
                try { if (navigator.vibrate) navigator.vibrate(10); } catch (chyba) { /* nic */ }
                otevri(x, y, n, cil, { dotyk: true });
            }, DRZET_MS)
        };
    }, true);
    document.addEventListener("pointermove", (e) => {
        if (drzeni && Math.abs(e.clientX - drzeni.x) + Math.abs(e.clientY - drzeni.y) > POSUN_PX) zrusDrzeni();
    }, true);
    document.addEventListener("pointerup", zrusDrzeni, true);
    document.addEventListener("pointercancel", zrusDrzeni, true);

    // klepnutí, které prohlížeč pošle po dlouhém podržení, nemá řádek rozbalit ani otevřít
    document.addEventListener("click", (e) => {
        if (!potlacitKlik) return;
        const cerstve = Date.now() - potlacitKlik < 1500;
        potlacitKlik = 0;
        if (cerstve && !(otevrena && otevrena.el.contains(e.target))) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    // Esc zavře (a nezavře přitom okno pod ní), šipky mezi položkami, Tab a písmena ji zavřou
    document.addEventListener("keydown", (e) => {
        if (!otevrena) return;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); N.zavri(); return; }
        if (e.key === "Tab" || (e.key && e.key.length === 1 && e.key !== " ")) { N.zavri(true); return; }
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
            e.preventDefault();
            e.stopPropagation();
            const polozky = Array.from(otevrena.el.querySelectorAll("[data-nabidka-i]"));
            const i = polozky.indexOf(document.activeElement);
            const j = e.key === "Home" ? 0 : e.key === "End" ? polozky.length - 1
                : i === -1 ? (e.key === "ArrowDown" ? 0 : polozky.length - 1)
                : (i + (e.key === "ArrowDown" ? 1 : -1) + polozky.length) % polozky.length;
            if (polozky[j]) polozky[j].focus();
        }
    }, true);

    // posun stránky, jiná šířka okna, odchod z okna → zavřít (nabídka by visela mimo svůj řádek).
    // Posun hned po otevření (do 150 ms) patří k dojetí na prvek ze Shift+F10 a nabídku nezavírá.
    document.addEventListener("scroll", (e) => {
        if (otevrena && Date.now() - otevrena.kdy > 150 && !otevrena.el.contains(e.target)) N.zavri(true);
    }, true);
    window.addEventListener("resize", () => {
        if (otevrena && document.documentElement.clientWidth !== otevrena.sirka) N.zavri(true);
    });
    window.addEventListener("blur", () => N.zavri(true));

    /* ================================================ HROMADNÝ VÝBĚR ==== */

    const pocetText = (n, tvary) => n + " " + (n === 1 ? tvary[0] : (n >= 2 && n <= 4 ? tvary[1] : tvary[2]));
    N.pocet = pocetText;
    let lista = null;          // jediná lišta „Vybráno N“ na stránce
    let aktivniVyber = null;   // čí výběr lišta právě ukazuje

    /**
     * Jedno potvrzení, smyčka přes funkci pro jednu položku, souhrn.
     * krok(id) → false = přeskočeno (třeba na to člověk nemá právo),
     * výjimka = selhalo, cokoli jiného = hotovo.
     */
    N.hromadne = async (ids, v) => {
        const seznam = (ids || []).slice();
        if (!seznam.length) return null;
        if (v.otazka && !window.confirm(v.otazka)) return null;
        let ok = 0, preskoceno = 0, chyba = 0;
        for (let i = 0; i < seznam.length; i++) {
            if (aktivniVyber && aktivniVyber.bezi) {
                aktivniVyber.prubeh = "Pracuji… " + (i + 1) + " / " + seznam.length;
                const pocet = lista && lista.querySelector(".vyber-lista__pocet");
                if (pocet) pocet.textContent = aktivniVyber.prubeh;
            }
            try {
                const r = await v.krok(seznam[i]);
                if (r === false) preskoceno += 1; else ok += 1;
            } catch (err) {
                console.error(err);
                chyba += 1;
            }
        }
        const casti = [(v.hotovo || "Hotovo") + ": " + ok];
        if (preskoceno) casti.push("přeskočeno " + preskoceno + (v.proc ? " (" + v.proc + ")" : ""));
        if (chyba) casti.push("selhalo " + chyba);
        toast(casti.join(" · ") + ".", chyba ? "error" : (preskoceno ? "warn" : undefined));
        return { ok, preskoceno, chyba };
    };

    function dejListu() {
        if (lista && lista.isConnected) return lista;
        lista = document.createElement("div");
        lista.className = "vyber-lista";
        lista.setAttribute("role", "toolbar");
        lista.setAttribute("aria-label", "Hromadné akce");
        lista.hidden = true;
        document.body.appendChild(lista);
        lista.addEventListener("click", async (e) => {
            const vyber = aktivniVyber;
            if (!vyber) return;
            if (e.target.closest("[data-vyber-zrus]")) { vyber.zrus(); return; }
            const b = e.target.closest("[data-vyber-akce]");
            if (!b || b.disabled || vyber.bezi) return;
            const a = vyber.posledniAkce[Number(b.getAttribute("data-vyber-akce"))];
            if (!a || typeof a.fn !== "function") return;
            const ids = vyber.ids();
            vyber.bezi = true;
            vyber.prubeh = "";
            lista.querySelectorAll("button").forEach(x => { x.disabled = true; });
            let vysledek = null;
            try { vysledek = await a.fn(ids); }
            catch (err) { console.error(err); toast("Hromadná akce selhala.", "error"); }
            finally {
                vyber.bezi = false;
                vyber.prubeh = "";
                // po doběhnutí (ne po zrušení dotazu) výběr zmizí – položky se změnily
                if (vysledek) vyber.zrus(); else vyber.obnov();
            }
        });
        return lista;
    }

    N.vyber = (volby) => {
        const v = volby || {};
        const nazev = v.nazev || ["položka", "položky", "položek"];
        const vybrane = new Set();
        let posledni = "";         // naposledy kliknuté id – kotva pro Shift
        const koren = () => (typeof v.koren === "function" ? v.koren() : v.koren) || null;
        const smi = () => (typeof v.zap === "function" ? !!v.zap() : true);

        const api = { bezi: false, prubeh: "", posledniAkce: [] };

        api.box = (id, popis) => smi()
            ? '<label class="vyber-cil" title="Vybrat (Shift = celý rozsah)">' +
              '<input type="checkbox" class="vyber-box" data-vyber="' + esc(id) + '"' +
              (vybrane.has(String(id)) ? " checked" : "") +
              ' aria-label="' + esc("Vybrat: " + (popis || id)) + '"></label>'
            : "";
        api.boxVse = () => smi()
            ? '<label class="vyber-cil" title="Vybrat všechno vypsané">' +
              '<input type="checkbox" class="vyber-box" data-vyber-vse aria-label="Vybrat všechno vypsané"></label>'
            : "";
        api.ids = () => Array.from(vybrane);
        api.ma = (id) => vybrane.has(String(id));

        const boxy = () => { const k = koren(); return k ? Array.from(k.querySelectorAll("[data-vyber]")) : []; };

        /** Po překreslení: zaškrtnout podle výběru, zapomenout zmizelé, srovnat lištu. */
        api.obnov = () => {
            const k = koren();
            const vsechny = boxy();
            const videt = new Set(vsechny.map(b => b.getAttribute("data-vyber")));
            if (!api.bezi) Array.from(vybrane).forEach(id => { if (!videt.has(id) || !smi()) vybrane.delete(id); });
            vsechny.forEach(b => { b.checked = vybrane.has(b.getAttribute("data-vyber")); });
            const vse = k ? k.querySelector("[data-vyber-vse]") : null;
            if (vse) {
                vse.checked = vsechny.length > 0 && vybrane.size === vsechny.length;
                vse.indeterminate = vybrane.size > 0 && vybrane.size < vsechny.length;
            }
            const radkyVybrane = k ? k.querySelectorAll(".je-vybrany") : [];
            Array.from(radkyVybrane).forEach(r => r.classList.remove("je-vybrany"));
            vsechny.forEach(b => {
                const r = b.closest(v.radek || "tr, [data-vyber-radek]");
                if (r && b.checked) r.classList.add("je-vybrany");
            });
            kresliListu();
        };

        api.zrus = () => { vybrane.clear(); posledni = ""; api.obnov(); };

        function kresliListu() {
            if (!vybrane.size) {
                if (lista && aktivniVyber === api) { lista.hidden = true; document.body.classList.remove("ma-vyber"); }
                return;
            }
            const el = dejListu();
            aktivniVyber = api;
            const ids = api.ids();
            let akce = [];
            try { akce = (typeof v.akce === "function" ? v.akce(ids) : v.akce) || []; }
            catch (err) { console.error(err); akce = []; }
            akce = akce.filter(a => a && a.text);
            const bezne = akce.filter(a => !a.nebezpeci), nebezpecne = akce.filter(a => a.nebezpeci);
            api.posledniAkce = bezne.concat(nebezpecne);
            // během hromadné akce se stránka překresluje – lišta musí zůstat „pracuji“ a zamčená
            el.innerHTML = '<span class="vyber-lista__pocet" aria-live="polite">' +
                    esc(api.bezi && api.prubeh ? api.prubeh : "Vybráno " + pocetText(ids.length, nazev)) + "</span>" +
                '<span class="vyber-lista__akce">' +
                api.posledniAkce.map((a, i) =>
                    '<button type="button" class="vyber-lista__btn' + (a.nebezpeci ? " vyber-lista__btn--nebezpeci" : "") +
                    '" data-vyber-akce="' + i + '"' + (a.zakazano || api.bezi ? " disabled" : "") +
                    (a.title ? ' title="' + esc(a.title) + '"' : "") + ">" +
                    N.ikona(a.ikona) + "<span>" + esc(a.text) + "</span></button>").join("") +
                "</span>" +
                '<button type="button" class="vyber-lista__zrus" data-vyber-zrus title="Zrušit výběr" ' +
                    'aria-label="Zrušit výběr"' + (api.bezi ? " disabled" : "") + ">×</button>";
            el.hidden = false;
            document.body.classList.add("ma-vyber");
        }

        function prepni(box, zapnout, shift) {
            const id = box.getAttribute("data-vyber");
            const vsechny = boxy();
            const a = shift && posledni ? vsechny.findIndex(b => b.getAttribute("data-vyber") === posledni) : -1;
            const b = vsechny.indexOf(box);
            if (a !== -1 && b !== -1) {
                const [od, po] = a < b ? [a, b] : [b, a];
                for (let i = od; i <= po; i++) {
                    const x = vsechny[i].getAttribute("data-vyber");
                    if (zapnout) vybrane.add(x); else vybrane.delete(x);
                }
            } else if (zapnout) vybrane.add(id);
            else vybrane.delete(id);
            posledni = id;
            api.obnov();
        }

        // klik na zaškrtávátko (i na jeho rámeček) – nesmí dojít k řádku (rozbalení, otevření dokladu)
        document.addEventListener("click", (e) => {
            const k = koren();
            const cil = e.target && e.target.closest && e.target.closest(".vyber-cil, .vyber-box");
            if (!k || !cil || !k.contains(cil)) return;
            e.stopPropagation();
            const box = cil.matches(".vyber-box") ? cil : cil.querySelector(".vyber-box");
            if (!box) return;
            if (cil !== box) {
                // klik do rámečku kolem: přepnout ručně (label by poslal klik bez Shiftu)
                e.preventDefault();
                box.checked = !box.checked;
            }
            if (box.hasAttribute("data-vyber-vse")) {
                const zapnout = box.checked;
                boxy().forEach(b => { const x = b.getAttribute("data-vyber"); if (zapnout) vybrane.add(x); else vybrane.delete(x); });
                posledni = "";
                api.obnov();
                return;
            }
            prepni(box, box.checked, e.shiftKey);
        }, true);
        // tažení karty za zaškrtávátko nedává smysl
        document.addEventListener("dragstart", (e) => {
            if (e.target && e.target.closest && e.target.closest(".vyber-cil")) e.preventDefault();
        }, true);

        // překreslení stránky (innerHTML) zaškrtávátka smaže – po něm se srovnají samy
        let cekam = false;
        const hlidej = () => {
            const k = koren();
            if (!k || k.__kbVyberHlidany) return;
            k.__kbVyberHlidany = true;
            new MutationObserver(() => {
                if (cekam) return;
                cekam = true;
                Promise.resolve().then(() => { cekam = false; api.obnov(); });
            }).observe(k, { childList: true, subtree: true });
        };
        api.hlidej = hlidej;
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hlidej);
        else hlidej();
        return api;
    };
})();
