/* ==========================================================================
   Vybavení – rezervace přístrojů (skenery, dálkoměry, notebooky…).

   Panel jako Správa aut: nahoře dva týdny dopředu (kdo má který přístroj
   který den), pod tím přístroje – klik rozbalí formulář rezervace a pod ním
   jsou jeho rezervace – a dole pro manažera správa seznamu přístrojů.
   Vidí to celá firma, ať se lidé nedomlouvají přes hlavu toho druhého.

   Seznam přístrojů žije v datech (public/data/meta/vybaveni), v kódu žádný
   přístroj není. Data, transakce a hlídání kolizí jsou ve store.js
   (KB.watchVybaveni, KB.ulozRezervaciVybaveni…), tady je jen panel.

   Soubor se načítá až prvním otevřením panelu z pásu (ui.js,
   data-vybaveni-otevri) – spolu s nabídkou ⋯ (nabidka.js), když ji stránka
   sama nemá.
   ========================================================================== */

(function () {
    "use strict";
    if (window.KBVybaveni) return;

    const UI = window.KBUI;
    const KB = () => window.KB || {};
    const esc = (v) => UI.esc(v);

    const DNY_CZ = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
    const PREHLED_DNU = 14;        // dva týdny dopředu, jako u aut

    const stav = {
        otevreny: "",      // přístroj s rozevřeným formulářem rezervace
        upravuji: "",      // id rezervace, která se ve formuláři upravuje
        form: null,        // { od, do, projektId, projekt, poznamka }
        sprava: null,      // manažer: rozbalený seznam (null = rozbalit, když je prázdný)
        pform: null,       // manažer: rozepsaný přístroj { id, nazev, druh, poznamka, aktivni }
        ukladam: false,
        podpis: null       // co je v panelu vykreslené (rozhoduje celé × částečné překreslení)
    };

    /* ------------------------------------------------------- pomocníci --- */

    const isoDen = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0");
    const dnes = () => isoDen(new Date());
    const kratce = (iso) => {
        const c = String(iso || "").split("-");
        return c.length === 3 ? Number(c[2]) + ". " + Number(c[1]) + "." : "";
    };
    const rozsah = (od, doKdy) => kratce(od) + (doKdy && doKdy !== od ? " – " + kratce(doKdy) : "");
    const mojeUid = () => (KB().currentUid ? KB().currentUid() : "");
    const panel = () => document.getElementById("kbVybaveniPanel");
    const vic = (popis) => (window.KBNabidka ? window.KBNabidka.tlacitko(popis) : "");
    /** Selektor [atribut="hodnota"] – hodnota z databáze, proto přes CSS.escape. */
    const podle = (atribut, hodnota) => "[" + atribut + '="' +
        (window.CSS && CSS.escape ? CSS.escape(String(hodnota)) : String(hodnota).replace(/["\\]/g, "\\$&")) + '"]';

    const pristroje = () => KB().vybaveni || [];
    const najdiPristroj = (id) => pristroje().find(p => p.id === id) || null;
    /** Rezervace, které ještě neskončily (odběr je bere od dneška; panel může
        být otevřený přes půlnoc). */
    const rezervace = () => {
        const d = dnes();
        return (KB().vybaveniRezervace || []).filter(r => String(r.do || r.od || "") >= d);
    };
    const najdiRez = (id) => (KB().vybaveniRezervace || []).find(r => r.id === id) || null;
    const nazevPristroje = (r) => {
        const p = najdiPristroj(r.pristrojId);
        return (p && p.nazev) || r.pristroj || "?";
    };
    const smiUpravit = (r) => !!r && (r.uid === mojeUid() || UI.isAdmin());

    /** Rezervace téhož přístroje, které se s od–do překrývají (bez upravované). */
    function kolizeVProhlizeci(pristrojId, od, doKdy, bezId) {
        if (!pristrojId || !od || !doKdy || doKdy < od) return [];
        return (KB().vybaveniRezervace || []).filter(r => r.pristrojId === pristrojId &&
            r.id !== bezId && String(r.od || "") <= doKdy && od <= String(r.do || r.od || ""));
    }

    /** Dny do čitelných úseků: ["2026-10-22","2026-10-23","2026-10-27"] → „22. 10. – 23. 10., 27. 10.". */
    function slozRozsahy(dny) {
        const serazene = Array.from(new Set(dny)).sort();
        const useky = [];
        serazene.forEach(den => {
            const posledni = useky[useky.length - 1];
            if (posledni) {
                const dalsi = new Date(posledni.do + "T00:00:00Z");
                dalsi.setUTCDate(dalsi.getUTCDate() + 1);
                if (dalsi.toISOString().slice(0, 10) === den) { posledni.do = den; return; }
            }
            useky.push({ od: den, do: den });
        });
        return useky.map(u => rozsah(u.od, u.do)).join(", ");
    }

    /** „Skener má v té době Jan Novák (22. 10. – 24. 10.)." – z rezervací v prohlížeči. */
    function textKolize(nazev, kolize) {
        return nazev + " má v té době " + kolize.map(r =>
            (r.jmeno || "?") + " (" + rozsah(r.od, r.do) + ")").join(", ") + ".";
    }

    /** Totéž ze zámků, které našla transakce (prohlížeč o rezervaci ještě nevěděl). */
    function textKolizeZamku(nazev, kolize) {
        const poLidech = {};
        kolize.forEach(k => {
            const kdo = k.sirotek ? "" : (k.jmeno || "?");
            (poLidech[kdo] = poLidech[kdo] || []).push(k.den);
        });
        const casti = Object.keys(poLidech).map(kdo => (kdo || "záznam bez rezervace") +
            " (" + slozRozsahy(poLidech[kdo]) + ")");
        return nazev + " má v té době " + casti.join(", ") + ".";
    }

    /* ---------------------------------------------------------- přehled --- */

    /** Dva týdny dopředu po týdnech. Víkend jen, když na něj něco je. */
    function tydnyPrehledu(rez) {
        const tydny = [];
        let posledni = null;
        const d = new Date();
        d.setHours(12, 0, 0, 0);
        for (let i = 0; i < PREHLED_DNU; i++, d.setDate(d.getDate() + 1)) {
            const iso = isoDen(d);
            const denTydne = d.getDay();
            const ten = rez.filter(r => String(r.od || "") <= iso && iso <= String(r.do || r.od || ""));
            const vikend = denTydne === 0 || denTydne === 6;
            if (vikend && !ten.length) continue;
            const po = new Date(d);
            po.setDate(d.getDate() - (denTydne + 6) % 7);
            const klic = isoDen(po);
            if (!posledni || posledni.klic !== klic) {
                posledni = { klic: klic, po: po, dny: [], vikend: false };
                tydny.push(posledni);
            }
            if (vikend) posledni.vikend = true;
            posledni.dny.push({
                iso: iso, nazev: DNY_CZ[denTydne], popis: d.getDate() + ". " + (d.getMonth() + 1) + ".",
                svatek: UI.svatek ? UI.svatek(iso) : "", rezervace: ten
            });
        }
        tydny.forEach(t => {
            const konec = new Date(t.po);
            konec.setDate(t.po.getDate() + (t.vikend ? 6 : 4));
            t.popis = t.po.getDate() + ". " + (t.po.getMonth() + 1) + ". – " +
                konec.getDate() + ". " + (konec.getMonth() + 1) + ".";
        });
        return tydny;
    }

    function prehledHtml() {
        const aktivni = new Set(pristroje().filter(p => p.aktivni).map(p => p.id));
        const vPanelu = aktivni.size;
        if (!vPanelu && !rezervace().length) {
            return '<p class="auta__prazdno">Zatím tu není žádný přístroj. Seznam spravuje manažer.</p>';
        }
        const uid = mojeUid();
        return tydnyPrehledu(rezervace()).map((tyden, ti) =>
            '<section class="hotyden hotyden--' + (ti % 2) + '">' +
                '<div class="hotyden__hlava">Týden ' + esc(tyden.popis) + "</div>" +
                tyden.dny.map(den => {
                    const obsazene = new Set(den.rezervace.map(r => r.pristrojId)
                        .filter(id => aktivni.has(id))).size;
                    const volne = Math.max(0, vPanelu - obsazene);
                    return '<div class="auta__den">' +
                        '<div class="auta__denhlava">' +
                            "<b>" + esc(den.nazev) + "</b> " + esc(den.popis) +
                            (den.svatek ? ' <span class="hoden__svatek" title="' + esc(den.svatek) +
                                '">svátek</span>' : "") +
                            '<span class="auta__pocetlidi">' +
                                (den.rezervace.length ? "volné " + volne + " z " + vPanelu : "vše volné") +
                            "</span>" +
                        "</div>" +
                        (den.rezervace.length
                            ? '<div class="auta__lide">' + den.rezervace.map(r =>
                                '<span class="auta__clovek vyb__chip' + (r.uid === uid ? " je-ja" : "") + '"' +
                                    (r.projekt || r.poznamka
                                        ? ' title="' + esc([r.projekt, r.poznamka].filter(Boolean).join(" · ")) + '"'
                                        : "") + ">" +
                                    "<b>" + esc(nazevPristroje(r)) + "</b> · " + esc(r.jmeno || "?") +
                                "</span>").join("") + "</div>"
                            : "") +
                    "</div>";
                }).join("") +
            "</section>").join("");
    }

    /* --------------------------------------------------------- přístroje --- */

    /** Přístroje do panelu: aktivní, a k nim vyřazené nebo smazané, pokud na
        ně ještě běží rezervace (ať se dají zrušit). */
    function pristrojeVPanelu() {
        const rez = rezervace();
        const vysledek = pristroje().filter(p => p.aktivni || rez.some(r => r.pristrojId === p.id));
        rez.forEach(r => {
            if (vysledek.some(p => p.id === r.pristrojId)) return;
            vysledek.push({ id: r.pristrojId, nazev: r.pristroj || "?", druh: "", poznamka: "",
                aktivni: false, mimoSeznam: true });
        });
        return vysledek;
    }

    function stavPristroje(p) {
        const jeho = rezervace().filter(r => r.pristrojId === p.id);
        const d = dnes();
        const ted = jeho.find(r => String(r.od || "") <= d && d <= String(r.do || r.od || ""));
        if (ted) return "dnes má " + (ted.jmeno || "?");
        if (jeho.length) return jeho.length + "× rezervace";
        return p.aktivni ? "volné" : (p.mimoSeznam ? "mimo seznam" : "vyřazený");
    }

    function seznamRezervaciHtml(p) {
        const jeho = rezervace().filter(r => r.pristrojId === p.id);
        if (!jeho.length) return "";
        const uid = mojeUid();
        return '<div class="auta__seznam">' + jeho.map(r =>
            '<div class="auta__rez vyb__rez' + (r.uid === uid ? " je-moje" : "") + '" data-vyb-rez="' + esc(r.id) + '">' +
                '<span class="auta__rezkdy">' + esc(rozsah(r.od, r.do)) + "</span>" +
                '<span class="auta__rezkdo"><b>' + esc(r.jmeno || "?") + "</b>" +
                    (r.projekt ? " – " + esc(r.projekt) : "") +
                    (r.poznamka ? '<span class="vyb__rezpozn">' + esc(r.poznamka) + "</span>" : "") +
                "</span>" +
                (smiUpravit(r) ? vic("Další akce: rezervace " + rozsah(r.od, r.do)) : "") +
            "</div>").join("") + "</div>";
    }

    /** Volby projektů. Uzavřené se nenabízejí – kromě toho, který už
        rezervace má (jinak by ho uložení tiše smazalo). */
    function projektyVolby(vybranyId, vybranyText) {
        const projekty = (KB().projektyDocs || []).filter(p => p.uzavreno !== true || p.id === vybranyId);
        const popis = (p) => [p.cislo, p.nazev].filter(Boolean).join(" – ");
        let html = '<option value="">— bez projektu —</option>' + projekty.map(p =>
            '<option value="' + esc(p.id) + '"' + (p.id === vybranyId ? " selected" : "") + ">" +
                esc(popis(p) || p.id) + "</option>").join("");
        if (vybranyId && !projekty.some(p => p.id === vybranyId)) {
            html += '<option value="' + esc(vybranyId) + '" selected>' + esc(vybranyText || vybranyId) + "</option>";
        }
        return html;
    }

    function formularHtml(p) {
        const f = stav.form || {};
        const upr = stav.upravuji ? najdiRez(stav.upravuji) : null;
        return '<div class="auta__form" data-vyb-form="' + esc(p.id) + '">' +
            (upr ? '<div class="vyb__upravuji">Úprava rezervace – ' + esc(upr.jmeno || "?") + ", " +
                esc(rozsah(upr.od, upr.do)) + "</div>" : "") +
            '<div class="auta__radek vyb__dvojice">' +
                '<label>Od<input type="date" class="field" data-vyb-od value="' + esc(f.od || "") + '"></label>' +
                '<label>Do<input type="date" class="field" data-vyb-do value="' + esc(f.do || "") + '"></label>' +
            "</div>" +
            '<div class="auta__radek"><label>Projekt (nepovinné)' +
                '<select class="field" data-vyb-projekt>' + projektyVolby(f.projektId, f.projekt) + "</select>" +
            "</label></div>" +
            '<input type="text" class="field" data-vyb-pozn maxlength="200" value="' + esc(f.poznamka || "") +
                '" placeholder="Poznámka / kam (např. sken 2. NP)" aria-label="Poznámka">' +
            '<p class="vyb__kolize" data-vyb-kolize role="alert" hidden></p>' +
            '<div class="vyb__tlacitka">' +
                '<button type="button" class="btn btn--primary btn--sm" data-vyb-uloz="' + esc(p.id) + '">' +
                    (upr ? "Uložit změny" : "Rezervovat") + "</button>" +
                (upr ? '<button type="button" class="btn btn--ghost btn--sm" data-vyb-zrus-upravu>Zrušit úpravu</button>' : "") +
            "</div>" +
        "</div>";
    }

    function pristrojHtml(p) {
        const otevreny = stav.otevreny === p.id;
        return '<div class="auta__vuz" data-vyb-pristroj="' + esc(p.id) + '">' +
            '<button type="button" class="auta__vuzhlava vyb__hlava' + (otevreny ? " je-otevreny" : "") +
                '" data-vyb-vyber="' + esc(p.id) + '" aria-expanded="' + (otevreny ? "true" : "false") + '">' +
                "<b>" + esc(p.nazev) + "</b>" +
                (p.druh ? '<span class="vyb__druh">' + esc(p.druh) + "</span>" : "") +
                '<span class="auta__pocet" data-vyb-stav="' + esc(p.id) + '">' + esc(stavPristroje(p)) + "</span>" +
            "</button>" +
            (p.poznamka ? '<div class="vyb__pozn">' + esc(p.poznamka) + "</div>" : "") +
            '<div data-vyb-formslot="' + esc(p.id) + '">' + (otevreny ? formularHtml(p) : "") + "</div>" +
            '<div data-vyb-seznam="' + esc(p.id) + '">' + seznamRezervaciHtml(p) + "</div>" +
        "</div>";
    }

    /* ------------------------------------------- správa seznamu (manažer) --- */

    const spravaOtevrena = () => (stav.sprava === null ? !pristroje().length : stav.sprava);

    function spravaSeznamHtml() {
        const vse = pristroje();
        if (!vse.length) return '<p class="auta__prazdno">Seznam je prázdný – přidej první přístroj.</p>';
        return vse.map(p =>
            '<div class="vyb__radek' + (p.aktivni ? "" : " vyb__radek--vyrazeny") +
                '" data-vyb-pristroj-radek="' + esc(p.id) + '">' +
                '<span class="vyb__radeknazev"><b>' + esc(p.nazev) + "</b>" +
                    (p.druh ? ' <span class="vyb__druh">' + esc(p.druh) + "</span>" : "") +
                    (p.poznamka ? '<span class="vyb__rezpozn">' + esc(p.poznamka) + "</span>" : "") +
                "</span>" +
                '<span class="vyb__stitek' + (p.aktivni ? "" : " vyb__stitek--ne") + '">' +
                    (p.aktivni ? "v nabídce" : "vyřazený") + "</span>" +
                vic("Další akce: " + p.nazev) +
            "</div>").join("");
    }

    function pformHtml() {
        const f = stav.pform || { id: "", nazev: "", druh: "", poznamka: "", aktivni: true };
        const druhy = Array.from(new Set(pristroje().map(p => p.druh).filter(Boolean))).sort();
        return '<div class="auta__form vyb__pform" data-vyb-pform>' +
            '<div class="vyb__upravuji">' + (f.id ? "Úprava přístroje" : "Nový přístroj") + "</div>" +
            '<div class="auta__radek vyb__dvojice">' +
                '<label>Název<input type="text" class="field" data-vyb-p="nazev" maxlength="80" value="' +
                    esc(f.nazev) + '" placeholder="např. Skener 1"></label>' +
                '<label>Druh<input type="text" class="field" data-vyb-p="druh" maxlength="40" value="' +
                    esc(f.druh) + '" placeholder="např. skener" list="kbVybDruhy"></label>' +
            "</div>" +
            '<datalist id="kbVybDruhy">' + druhy.map(d => '<option value="' + esc(d) + '">').join("") + "</datalist>" +
            '<input type="text" class="field" data-vyb-p="poznamka" maxlength="200" value="' + esc(f.poznamka) +
                '" placeholder="Poznámka (kde leží, co k němu patří…)" aria-label="Poznámka k přístroji">' +
            '<label class="vyb__check"><input type="checkbox" data-vyb-p="aktivni"' +
                (f.aktivni !== false ? " checked" : "") + "> V nabídce – dá se rezervovat</label>" +
            '<div class="vyb__tlacitka">' +
                '<button type="button" class="btn btn--primary btn--sm" data-vyb-puloz>' +
                    (f.id ? "Uložit přístroj" : "Přidat přístroj") + "</button>" +
                (f.id ? '<button type="button" class="btn btn--ghost btn--sm" data-vyb-pzrus>Zrušit úpravu</button>' : "") +
            "</div>" +
        "</div>";
    }

    function spravaHtml() {
        if (!UI.isAdmin()) return "";
        const otevrena = spravaOtevrena();
        return '<div class="vyb__sprava">' +
            '<div class="vyb__spravahlava"><span class="auta__nadpis">Seznam přístrojů</span>' +
                '<button type="button" class="linkbtn" data-vyb-sprava aria-expanded="' +
                    (otevrena ? "true" : "false") + '">' + (otevrena ? "skrýt" : "spravovat") + "</button>" +
            "</div>" +
            (otevrena
                ? '<div data-vyb-sprava-seznam>' + spravaSeznamHtml() + "</div>" + pformHtml()
                : "") +
        "</div>";
    }

    /* ------------------------------------------------------- vykreslení --- */

    /** Co tvoří kostru panelu. Když se změní, překreslí se celý (i formulář
        z uloženého stavu); jinak jen data kolem formuláře – rozepsaná pole
        a fokus zůstanou, i když mezitím dorazí cizí rezervace. */
    function podpisKostry() {
        return JSON.stringify([
            pristrojeVPanelu().map(p => [p.id, p.nazev, p.druh, p.poznamka, p.aktivni]),
            stav.otevreny, stav.upravuji, UI.isAdmin(), spravaOtevrena(), !!KB().vybaveniPrislo
        ]);
    }

    function render() {
        const el = panel();
        if (!el || el.hidden) return;
        const telo = el.querySelector("[data-vyb-telo]");
        if (!KB().vybaveniPrislo) {
            telo.innerHTML = '<p class="tiny muted" style="margin:0">Načítám přístroje…</p>';
            stav.podpis = podpisKostry();
            return;
        }
        const vPanelu = pristrojeVPanelu();
        telo.innerHTML =
            '<p class="tiny muted vyb__uvod">Rezervuj si přístroj na dny, kdy ho potřebuješ. ' +
                "Vidí to celá firma; stejný přístroj ve stejný den dvakrát rezervovat nejde.</p>" +
            '<div class="auta__nadpis">Dva týdny dopředu</div>' +
            '<div data-vyb-prehled>' + prehledHtml() + "</div>" +
            (vPanelu.length
                ? '<div class="auta__nadpis vyb__nadpis2">Přístroje</div>' + vPanelu.map(pristrojHtml).join("")
                : "") +
            spravaHtml();
        const vyber = telo.querySelector("[data-vyb-projekt]");
        if (vyber && UI.naseptavac) {
            UI.naseptavac(vyber, { nazev: "Projekt", popis: "Piš číslo nebo název projektu…",
                prazdne: "Žádný projekt k výběru" });
        }
        ukazKolizi();
        stav.podpis = podpisKostry();
    }

    /** Po příchodu dat: kostra stejná → jen data kolem formuláře. */
    function obnov() {
        const el = panel();
        if (!el || el.hidden) return;
        if (stav.upravuji && KB().vybaveniPrislo && !najdiRez(stav.upravuji)) {
            stav.upravuji = ""; stav.form = null; stav.otevreny = "";
            UI.toast("Rezervaci, kterou upravuješ, mezitím někdo zrušil.", "warn");
            return render();
        }
        if (podpisKostry() !== stav.podpis || !el.querySelector("[data-vyb-prehled]")) return render();
        el.querySelector("[data-vyb-prehled]").innerHTML = prehledHtml();
        pristrojeVPanelu().forEach(p => {
            const s = el.querySelector(podle("data-vyb-stav", p.id));
            if (s) s.textContent = stavPristroje(p);
            const seznam = el.querySelector(podle("data-vyb-seznam", p.id));
            if (seznam) seznam.innerHTML = seznamRezervaciHtml(p);
        });
        const sprava = el.querySelector("[data-vyb-sprava-seznam]");
        if (sprava) sprava.innerHTML = spravaSeznamHtml();
        ukazKolizi();
    }

    /** Roletka projektů se plní z dat, která můžou dorazit až po otevření
        formuláře – po příchodu se přesype a vybraná hodnota zůstane. */
    function obnovProjekty() {
        const el = panel();
        const vyber = el && !el.hidden && el.querySelector("[data-vyb-projekt]");
        if (!vyber || !stav.form) return;
        vyber.innerHTML = projektyVolby(stav.form.projektId, stav.form.projekt);
        if (UI.naseptavac) UI.naseptavac(vyber);
    }

    /** Živé upozornění u formuláře, když se termín kryje s cizí rezervací. */
    function ukazKolizi() {
        const el = panel();
        const box = el && el.querySelector("[data-vyb-kolize]");
        if (!box || !stav.form) return;
        const f = stav.form;
        const k = kolizeVProhlizeci(stav.otevreny, f.od, f.do || f.od, stav.upravuji);
        const p = najdiPristroj(stav.otevreny);
        box.textContent = k.length ? textKolize((p && p.nazev) || "Přístroj", k) : "";
        box.hidden = !k.length;
    }

    /* ---------------------------------------------------------- akce --- */

    function prepniPristroj(id) {
        if (stav.otevreny === id) {
            stav.otevreny = ""; stav.upravuji = ""; stav.form = null;
            return render();
        }
        const p = pristrojeVPanelu().find(x => x.id === id);
        if (!p || !p.aktivni) {
            UI.toast("Vyřazený přístroj se rezervovat nedá – jeho rezervace jde jen zrušit.", "warn");
            return;
        }
        stav.otevreny = id; stav.upravuji = "";
        stav.form = { od: dnes(), do: dnes(), projektId: "", projekt: "", poznamka: "" };
        render();
        zamer("[data-vyb-od]");
    }

    function zacniUpravu(id) {
        const r = najdiRez(id);
        if (!r || !smiUpravit(r)) return;
        stav.otevreny = r.pristrojId; stav.upravuji = r.id;
        stav.form = { od: r.od || "", do: r.do || r.od || "", projektId: r.projektId || "",
            projekt: r.projekt || "", poznamka: r.poznamka || "" };
        render();
        zamer("[data-vyb-od]");
    }

    /** Fokus a posun na pole v panelu (po překreslení). */
    function zamer(selektor) {
        const pole = panel() && panel().querySelector(selektor);
        if (!pole) return;
        try { pole.focus({ preventScroll: true }); } catch (e) { pole.focus(); }
        if (pole.scrollIntoView) pole.scrollIntoView({ block: "nearest" });
    }

    const odmitnuto = (err) => !!err && /permission/i.test(String(err.code || err.message || ""));

    async function ulozRezervaci(pristrojId, uzZkusenoUvolnit) {
        if (stav.ukladam) return;
        const p = pristrojeVPanelu().find(x => x.id === pristrojId);
        const f = stav.form || {};
        const od = f.od || "", doKdy = f.do || f.od || "";
        if (!p) return;
        if (!od) return void UI.toast("Vyber, od kdy přístroj potřebuješ.", "warn");
        if (doKdy < od) return void UI.toast("Datum do nesmí být dřív než datum od.", "warn");
        const dny = KB().dnyRozsahu ? KB().dnyRozsahu(od, doKdy) : [];
        if (!dny.length) return void UI.toast("Zkontroluj datum od a do.", "warn");
        const max = KB().VYBAVENI_MAX_DNU || 92;
        if (dny.length > max) {
            return void UI.toast("Rezervace může mít nejvýš " + max + " dní – na delší dobu ji rozděl.", "warn");
        }
        // kolize podle rezervací, které prohlížeč zná – databáze to ověří ještě jednou
        const kolize = kolizeVProhlizeci(pristrojId, od, doKdy, stav.upravuji);
        if (kolize.length) {
            ukazKolizi();
            return void UI.toast(textKolize(p.nazev, kolize), "error");
        }

        const tlacitko = panel() && panel().querySelector(podle("data-vyb-uloz", pristrojId));
        stav.ukladam = true;
        if (tlacitko) tlacitko.disabled = true;
        const uprava = !!stav.upravuji;
        let sirotci = null;         // osiřelé zámky, které smí tenhle člověk uvolnit
        try {
            await KB().ulozRezervaciVybaveni(stav.upravuji, {
                pristrojId: pristrojId, pristroj: p.nazev, od: od, do: doKdy,
                projektId: f.projektId || "", projekt: f.projektId ? (f.projekt || "") : "",
                poznamka: f.poznamka || ""
            });
            stav.otevreny = ""; stav.upravuji = ""; stav.form = null;
            render();
            UI.toast(uprava ? "Rezervace upravená." : p.nazev + " – rezervováno na " + rozsah(od, doKdy) + ".");
        } catch (err) {
            if (err && err.kod === "kolize") {
                const k = err.kolize || [];
                const box = panel() && panel().querySelector("[data-vyb-kolize]");
                const text = textKolizeZamku(p.nazev, k);
                if (box) { box.textContent = text; box.hidden = false; }
                /* Osiřelý zámek (rezervace k němu zmizela mimo web) smí uvolnit
                   manažer a ten, na koho zní – jednou, pak se uloží znovu. */
                const osirele = k.filter(x => x.sirotek);
                if (osirele.length && osirele.length === k.length && !uzZkusenoUvolnit &&
                        (UI.isAdmin() || osirele.every(x => x.uid === mojeUid()))) {
                    sirotci = osirele;
                } else {
                    UI.toast(text, "error");
                }
            } else if (err && err.kod) {
                UI.toast(err.message, "warn");
            } else if (odmitnuto(err)) {
                console.error(err);
                UI.toast("Databáze rezervaci odmítla – nejspíš ještě nejsou nasazená pravidla pro vybavení.", "error");
            } else {
                console.error(err);
                UI.toast("Rezervace se neuložila – zkontroluj připojení.", "error");
            }
        } finally {
            stav.ukladam = false;
            const t = panel() && panel().querySelector(podle("data-vyb-uloz", pristrojId));
            if (t) t.disabled = false;
        }
        if (!sirotci) return;
        const ano = await UI.potvrd({
            nadpis: "Uvolnit zablokované dny?",
            text: "Dny " + slozRozsahy(sirotci.map(x => x.den)) + " drží záznam, ke kterému už " +
                "žádná rezervace není (smazaná mimo web). Uvolnit je a rezervovat?",
            ano: "Uvolnit a rezervovat", ne: "Nechat"
        });
        if (!ano) return;
        try {
            await KB().uvolniZamkyVybaveni(sirotci);
        } catch (err) {
            console.error(err);
            return void UI.toast("Uvolnit se to nepovedlo.", "error");
        }
        return ulozRezervaci(pristrojId, true);
    }

    async function zrusRezervaci(id) {
        const r = najdiRez(id);
        if (!r || !smiUpravit(r)) return;
        const cizi = r.uid !== mojeUid();
        const ano = await UI.potvrd({
            nadpis: "Zrušit rezervaci?",
            text: nazevPristroje(r) + ", " + rozsah(r.od, r.do) + (cizi ? " – " + (r.jmeno || "?") : "") +
                ". Přístroj se uvolní pro ostatní.",
            ano: "Zrušit rezervaci", ne: "Nechat", nebezpecne: true
        });
        if (!ano) return;
        try {
            await KB().zrusRezervaciVybaveni(id);
            if (stav.upravuji === id) { stav.upravuji = ""; stav.form = null; stav.otevreny = ""; render(); }
            UI.toast("Rezervace zrušená.");
        } catch (err) {
            console.error(err);
            UI.toast(odmitnuto(err) ? "Tuhle rezervaci zrušit nesmíš." : "Zrušení se nepovedlo.", "error");
        }
    }

    async function ulozPristroj() {
        if (!UI.isAdmin()) return;
        const f = stav.pform || { id: "", nazev: "", druh: "", poznamka: "", aktivni: true };
        if (!String(f.nazev || "").trim()) {
            UI.toast("Napiš název přístroje.", "warn");
            return void zamer('[data-vyb-p="nazev"]');
        }
        const dvojnik = pristroje().find(p => p.id !== f.id &&
            p.nazev.trim().toLowerCase() === String(f.nazev).trim().toLowerCase());
        if (dvojnik) return void UI.toast("Přístroj s tímhle názvem už v seznamu je.", "warn");
        try {
            await KB().ulozPristroj(f);
            UI.toast(f.id ? "Přístroj upravený." : "Přístroj přidaný do seznamu.");
            stav.pform = null;
            stav.sprava = true;      // seznam zůstane rozbalený i po prvním přístroji – přidává se jich víc
            render();
        } catch (err) {
            if (err && err.kod) return void UI.toast(err.message, "warn");
            console.error(err);
            UI.toast(odmitnuto(err) ? "Seznam přístrojů smí měnit jen manažer." : "Přístroj se neuložil.", "error");
        }
    }

    async function prepniAktivni(id) {
        const p = najdiPristroj(id);
        if (!p || !UI.isAdmin()) return;
        const puvodne = Object.assign({}, p);
        try {
            await KB().ulozPristroj(Object.assign({}, p, { aktivni: !p.aktivni }));
            UI.toast(p.aktivni ? p.nazev + " – vyřazený z nabídky." : p.nazev + " – zpátky v nabídce.", undefined,
                { zpet: () => KB().ulozPristroj(puvodne) });
        } catch (err) {
            console.error(err);
            UI.toast("Změna se neuložila.", "error");
        }
    }

    async function smazPristroj(id) {
        const p = najdiPristroj(id);
        if (!p || !UI.isAdmin()) return;
        if (rezervace().some(r => r.pristrojId === id)) {
            return void UI.toast("Na přístroj běží rezervace – zruš je, nebo ho jen vyřaď z nabídky.", "warn");
        }
        const ano = await UI.potvrd({
            nadpis: "Smazat přístroj?",
            text: p.nazev + " zmizí ze seznamu. Staré rezervace v historii zůstanou.",
            ano: "Smazat", ne: "Nechat", nebezpecne: true
        });
        if (!ano) return;
        try {
            await KB().smazPristroj(id);
            if (stav.pform && stav.pform.id === id) stav.pform = null;
            UI.toast("Přístroj smazaný.");
        } catch (err) {
            console.error(err);
            UI.toast("Smazání se nepovedlo.", "error");
        }
    }

    /* ---------------------------------------------------------- panel --- */

    function mount() {
        let el = panel();
        if (el) return el;
        el = document.createElement("div");
        el.id = "kbVybaveniPanel";
        el.className = "hookno no-print";
        el.hidden = true;
        el.innerHTML =
            '<div class="hookno__deska card" role="dialog" aria-modal="true" aria-labelledby="kbVybaveniNadpis">' +
                '<div class="hookno__hlava"><span id="kbVybaveniNadpis">Vybavení</span>' +
                    '<button type="button" class="linkbtn linkbtn--tmavy" data-vyb-zavri>Zavřít</button></div>' +
                '<div class="hookno__telo quickpanel__telo" data-vyb-telo></div>' +
            "</div>";
        document.body.appendChild(el);

        el.addEventListener("click", (e) => {
            if (e.target === el) return void zavri();
            const t = e.target;
            if (t.closest("[data-vyb-zavri]")) return void zavri();
            const vyber = t.closest("[data-vyb-vyber]");
            if (vyber) return void prepniPristroj(vyber.dataset.vybVyber);
            const uloz = t.closest("[data-vyb-uloz]");
            if (uloz) return void ulozRezervaci(uloz.dataset.vybUloz);
            if (t.closest("[data-vyb-zrus-upravu]")) {
                stav.otevreny = ""; stav.upravuji = ""; stav.form = null;
                return void render();
            }
            if (t.closest("[data-vyb-sprava]")) {
                stav.sprava = !spravaOtevrena();
                return void render();
            }
            if (t.closest("[data-vyb-puloz]")) return void ulozPristroj();
            if (t.closest("[data-vyb-pzrus]")) { stav.pform = null; return void render(); }
        });

        const zmena = (e) => {
            const t = e.target;
            if (t.matches("[data-vyb-p]")) {
                stav.sprava = true;      // rozepsaný přístroj – seznam se nesmí sám sbalit
                stav.pform = stav.pform || { id: "", nazev: "", druh: "", poznamka: "", aktivni: true };
                stav.pform[t.dataset.vybP] = t.type === "checkbox" ? t.checked : t.value;
                return;
            }
            if (!stav.form) return;
            if (t.matches("[data-vyb-od]")) {
                stav.form.od = t.value;
                /* „Od" táhne „Do" s sebou (jako u aut): většina rezervací je
                   na jeden den. Kdo má „Do" dál, tomu se nesahá. */
                const doPole = el.querySelector("[data-vyb-do]");
                if (doPole && (!doPole.value || doPole.value < t.value)) {
                    doPole.value = t.value;
                    stav.form.do = t.value;
                }
                ukazKolizi();
            } else if (t.matches("[data-vyb-do]")) {
                stav.form.do = t.value;
                ukazKolizi();
            } else if (t.matches("[data-vyb-projekt]")) {
                stav.form.projektId = t.value;
                stav.form.projekt = t.value && t.selectedIndex >= 0 ? t.options[t.selectedIndex].textContent : "";
            } else if (t.matches("[data-vyb-pozn]")) {
                stav.form.poznamka = t.value;
            }
        };
        el.addEventListener("input", zmena);
        el.addEventListener("change", zmena);
        // Enter v poznámce = Rezervovat (v názvu přístroje = Přidat)
        el.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" || e.isComposing) return;
            if (e.target.matches("[data-vyb-pozn]") && stav.otevreny) {
                e.preventDefault();
                ulozRezervaci(stav.otevreny);
            } else if (e.target.matches('[data-vyb-p="nazev"], [data-vyb-p="druh"], [data-vyb-p="poznamka"]')) {
                e.preventDefault();
                ulozPristroj();
            }
        });
        return el;
    }

    function zavri() {
        const el = panel();
        if (el) el.hidden = true;
        if (window.KBNabidka && window.KBNabidka.jeOtevrena && window.KBNabidka.jeOtevrena()) {
            window.KBNabidka.zavri(true);
        }
    }

    /* Esc zavře panel – ne když je nahoře potvrzovací okno, nabídka ⋯ nebo
       rozbalený našeptávač (ty si Esc berou samy). */
    document.addEventListener("keydown", (e) => {
        const el = panel();
        if (e.key !== "Escape" || !el || el.hidden) return;
        if (document.querySelector(".kbdlg") || (window.KBNabidka && window.KBNabidka.jeOtevrena &&
            window.KBNabidka.jeOtevrena())) return;
        if (e.target && e.target.closest && e.target.closest("[data-hledac]")) return;
        zavri();
    });

    /* Nabídka ⋯ / pravé tlačítko u rezervací a v seznamu přístrojů. */
    let nabidkaPripojena = false;
    function pripojNabidku() {
        if (nabidkaPripojena || !window.KBNabidka) return;
        nabidkaPripojena = true;
        window.KBNabidka.pripoj((prvek) => {
            const el = panel();
            if (!el || el.hidden || !el.contains(prvek)) return null;
            const rRadek = prvek.closest("[data-vyb-rez]");
            if (rRadek) {
                const r = najdiRez(rRadek.dataset.vybRez);
                if (!smiUpravit(r)) return null;
                return {
                    nadpis: nazevPristroje(r) + " · " + rozsah(r.od, r.do),
                    radek: rRadek,
                    polozky: [
                        { text: "Upravit…", ikona: "upravit", fn: () => zacniUpravu(r.id) },
                        { text: "Zrušit rezervaci…", ikona: "smazat", nebezpeci: true, fn: () => zrusRezervaci(r.id) }
                    ]
                };
            }
            const pRadek = prvek.closest("[data-vyb-pristroj-radek]");
            if (pRadek && UI.isAdmin()) {
                const p = najdiPristroj(pRadek.dataset.vybPristrojRadek);
                if (!p) return null;
                return {
                    nadpis: p.nazev,
                    radek: pRadek,
                    polozky: [
                        { text: "Upravit…", ikona: "upravit", fn: () => {
                            stav.pform = Object.assign({}, p);
                            stav.sprava = true;
                            render();
                            zamer('[data-vyb-p="nazev"]');
                        } },
                        { text: p.aktivni ? "Vyřadit z nabídky" : "Vrátit do nabídky",
                          ikona: p.aktivni ? "skryt" : "oko", fn: () => prepniAktivni(p.id) },
                        { text: "Smazat…", ikona: "smazat", nebezpeci: true, fn: () => smazPristroj(p.id) }
                    ]
                };
            }
            return null;
        });
    }

    let posluchaci = false;
    function otevri() {
        if (!posluchaci && KB().on) {
            posluchaci = true;
            KB().on("vybaveni", obnov);
            KB().on("projekty-docs", obnovProjekty);
            KB().on("users", obnov);
            document.addEventListener("kb-role", render);
        }
        pripojNabidku();
        if (KB().watchVybaveni) KB().watchVybaveni();    // data si řekne až otevřený panel
        const el = mount();
        el.hidden = false;
        render();
    }

    window.KBVybaveni = {
        otevri: otevri,
        zavri: zavri,
        // pro testy: čisté výpočty bez databáze
        _kolize: kolizeVProhlizeci,
        _rozsahy: slozRozsahy
    };
})();
