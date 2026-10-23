/* ==========================================================================
   Sdílené UI – horní lišta s roletkami, toasty, uživatel a role,
   vyhledávání, práce s obrázky, pokyn pro AI.
   ========================================================================== */

(function () {
    "use strict";

    const USER_KEY = "company_kb_username";
    const ROLE_KEY = "company_kb_role";

    window.KB_USER = localStorage.getItem(USER_KEY) || "";
    window.KB_ROLE = localStorage.getItem(ROLE_KEY) || "zamestnanec";

    const UI = {};
    window.KBUI = UI;

    const esc = (value) => String(value == null ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    UI.esc = esc;

    /* ------------------------------------------- bezpečné hodnoty do HTML ---
       Pravidla databáze hlídají, KDO smí psát, ne CO zapíše. Poznámku,
       návod, tabuli nebo plán tak může podvrhnout i student z konzole
       prohlížeče – a vykreslí se pak manažerovi pod jeho přihlášením.
       Proto do src, style a innerHTML nejde nic, co by web sám nevyrobil:
       obrázky jsou vždy data URL z canvasu, barvy hex z palet. */

    const OBRAZEK_OK = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]*$/;
    UI.bezpecnyObrazek = (url) => (typeof url === "string" && OBRAZEK_OK.test(url)) ? url : "";

    const BARVA_OK = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
    UI.barva = (hex, nahradni) => {
        const s = typeof hex === "string" ? hex.trim() : "";
        return BARVA_OK.test(s) ? s : (nahradni === undefined ? "" : nahradni);
    };

    /* HTML z databáze (příručka) se projde v inertní šabloně, kde se nic
       nespustí, a zůstanou jen značky a atributy, které editor příručky
       opravdu dělá. Skripty, obrázky, styly a on…= odpadnou. */
    const HTML_ZNACKY = new Set(["P", "B", "STRONG", "I", "EM", "U", "BR", "HR", "SECTION", "DIV", "SPAN",
        "H2", "H3", "H4", "UL", "OL", "LI", "A", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH",
        "CODE", "PRE", "SMALL", "BLOCKQUOTE"]);
    const HTML_PRYC = new Set(["SCRIPT", "STYLE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED",
        "SVG", "MATH", "TEMPLATE", "NOSCRIPT", "LINK", "META", "BASE", "FORM", "INPUT", "BUTTON",
        "TEXTAREA", "SELECT", "IMG", "VIDEO", "AUDIO", "SOURCE", "PICTURE"]);
    const HTML_ATRIBUTY = new Set(["class", "id", "href", "title", "colspan", "rowspan"]);
    UI.cistyHtml = (html) => {
        const sablona = document.createElement("template");
        sablona.innerHTML = String(html == null ? "" : html);
        const projdi = (rodic) => Array.from(rodic.children).forEach(el => {
            const znacka = el.tagName.toUpperCase();
            if (HTML_PRYC.has(znacka)) { el.remove(); return; }
            projdi(el);
            if (!HTML_ZNACKY.has(znacka)) { el.replaceWith(...el.childNodes); return; }
            Array.from(el.attributes).forEach(a => {
                const jmeno = a.name.toLowerCase();
                if (!HTML_ATRIBUTY.has(jmeno) ||
                    (jmeno === "href" && !/^(?:https?:|mailto:|#|[^:]*$)/i.test(a.value.trim()))) {
                    el.removeAttribute(a.name);
                }
            });
        });
        projdi(sablona.content);
        return sablona.innerHTML;
    };

    /* -------------------------------------------------------------- barvy ---
       Zkoušení odstínů na stránce barvy.html. Barva se mění POUZE na té
       stránce a jen dokud se nezavře – firemní červená je daná a nikdo si
       ji nemůže přepsat natrvalo. Trvalá změna = přepsat --accent
       v :root v app.css a nasadit. */

    const ACCENT_KEY = "company_kb_accent";
    const ACCENT_VARS = ["--accent", "--accent-dark", "--accent-lt", "--accent-tint", "--doc-accent"];

    // úklid po starší verzi, kde si šla barva uložit do prohlížeče
    try { localStorage.removeItem(ACCENT_KEY); } catch (err) { /* soukromý režim */ }

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    /** #rrggbb -> [h 0-360, s 0-100, l 0-100] */
    UI.hexToHsl = (hex) => {
        const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
        if (!m) return [349, 85, 42];
        const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16) / 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        const l = (max + min) / 2;
        let h = 0;
        if (d) {
            h = max === r ? ((g - b) / d + (g < b ? 6 : 0))
              : max === g ? ((b - r) / d + 2)
              : ((r - g) / d + 4);
            h *= 60;
        }
        const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
        return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
    };

    UI.hslToHex = (h, s, l) => {
        h = ((h % 360) + 360) % 360;
        s = clamp(s, 0, 100) / 100;
        l = clamp(l, 0, 100) / 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
                  : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        return "#" + rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
    };

    /** Z jedné barvy dopočítá celou sadu odstínů, které web používá. */
    UI.accentVars = (hex) => {
        const [h, s, l] = UI.hexToHsl(hex);
        return {
            "--accent":      hex,
            "--accent-dark": UI.hslToHex(h, s, l - 9),
            "--accent-lt":   UI.hslToHex(h, clamp(s + 4, 0, 100), l + 14),
            "--accent-tint": UI.hslToHex(h, clamp(s - 10, 0, 100), 96),
            "--doc-accent":  hex
        };
    };

    UI.applyAccent = (hex) => {
        const vars = UI.accentVars(hex);
        Object.keys(vars).forEach(name => document.documentElement.style.setProperty(name, vars[name]));
    };

    UI.resetAccent = () => {
        ACCENT_VARS.forEach(name => document.documentElement.style.removeProperty(name));
    };

    /* Zvolená barva se drží v prohlížeči a platí na všech stránkách –
       výchozí (petrolejovou z app.css) tím jde přebít třeba zpátky na
       původní červenou. Aplikuje se hned při načtení, ať stránka neblikne. */

    const AKCENT_KLIC = "kb-akcent";

    UI.ulozAkcent = (hex) => {
        try {
            if (hex) localStorage.setItem(AKCENT_KLIC, hex);
            else localStorage.removeItem(AKCENT_KLIC);
        } catch (err) { /* soukromý režim */ }
    };
    UI.ulozenyAkcent = () => {
        try { return localStorage.getItem(AKCENT_KLIC) || ""; } catch (err) { return ""; }
    };

    (() => {
        const hex = UI.ulozenyAkcent();
        if (/^#[\da-f]{6}$/i.test(hex)) UI.applyAccent(hex);
    })();

    /* ------------------------------------------- zámek citlivých sekcí ----
       Odemčení sazeb a hesel vydrží jen chvíli. Kdo odejde od počítače,
       nenechá je otevřené – po třech minutách bez práce se heslo chce znovu.
       Každá práce se stránkou platnost prodlouží (hlídá se dole). */

    UI.ZAMEK_PLATNOST = 3 * 60 * 1000;

    UI.zamekPamet = (klic) => {
        try {
            const surove = sessionStorage.getItem(klic);
            if (!surove) return "";
            const data = JSON.parse(surove);
            if (!data || (Date.now() - (data.ms || 0)) > UI.ZAMEK_PLATNOST) {
                sessionStorage.removeItem(klic);
                return "";
            }
            return data.v || "";
        } catch (err) {
            // starý formát (holý hash) nebo rozbitý zápis – radši znovu heslo
            try { sessionStorage.removeItem(klic); } catch (e) {}
            return "";
        }
    };

    UI.zamekZapamatuj = (klic, hodnota) => {
        try {
            if (hodnota) sessionStorage.setItem(klic, JSON.stringify({ v: hodnota, ms: Date.now() }));
            else sessionStorage.removeItem(klic);
        } catch (err) { /* soukromý režim */ }
    };

    /* Práce se stránkou prodlužuje odemčení – tříminutovka je od poslední
       akce, ne od zadání hesla. Jinak by se sekce zamkla člověku pod rukama
       uprostřed vyplňování. */
    UI.zamekObnovujPri = (klic) => {
        const obnov = () => {
            const hodnota = UI.zamekPamet(klic);
            if (hodnota) UI.zamekZapamatuj(klic, hodnota);
        };
        document.addEventListener("pointerdown", obnov);
        document.addEventListener("keydown", obnov);
    };

    /* ------------------------------------------------------------- toast
       UI.toast(text, typ, { zpet }) – typ "error" / "warn" / nic (zelená).
       zpet = funkce, která akci vrátí (může vrátit Promise): v hlášce je
       pak tlačítko „Zpět“, hláška vydrží 8 s a pod myší nezmizí. Jen pro
       akce, které mají v kódu jednoduchý opak (Splněno, beru na vědomí,
       zveřejnění…) – mazání má dál potvrzovací okno (UI.potvrd níž).
       akce = { text, fn } – místo „Zpět“ tlačítko s vlastním popiskem
       (např. „Otevřít“ po přeposlání zprávy); vydrží stejně, „Vráceno“ neříká. */

    UI.toast = (message, tone, volby) => {
        let el = document.getElementById("kbToast");
        if (!el) {
            el = document.createElement("div");
            el.id = "kbToast";
            el.className = "no-print";
            el.setAttribute("role", "status");
            el.setAttribute("aria-live", "polite");
            // --spodek-listy: na telefonu výška spodní lišty (app.css), jinak 0
            el.style.cssText = "position:fixed;left:50%;bottom:calc(24px + var(--spodek-listy, 0px));" +
                "transform:translate(-50%,140%);" +
                "z-index:300;padding:13px 20px;border-radius:12px;color:#fff;font-size:14px;font-weight:700;" +
                "box-shadow:0 18px 34px -14px rgba(0,0,0,.5);transition:transform .25s ease,opacity .25s ease;" +
                "opacity:0;max-width:min(560px,calc(100vw - 32px));text-align:center;" +
                "display:flex;align-items:center;justify-content:center;gap:14px;pointer-events:none";
            el._schovej = () => {
                el.style.transform = "translate(-50%, 140%)";
                el.style.opacity = "0";
                el.style.pointerEvents = "none";
                el._zpet = null;
                const b = el.querySelector("button");
                if (b) b.disabled = true;          // schovaný „Zpět“ nesmí jít odkliknout ani Tabem
            };
            // pod myší hláška se „Zpět“ nezmizí – kdo na něj míří, nesmí o něj přijít
            el.addEventListener("mouseenter", () => { if (el._zpet) clearTimeout(el._timer); });
            el.addEventListener("mouseleave", () => {
                if (el._zpet) { clearTimeout(el._timer); el._timer = setTimeout(el._schovej, 3000); }
            });
            document.body.appendChild(el);
        }
        const zpet = volby && typeof volby.zpet === "function" ? volby.zpet : null;
        const akce = !zpet && volby && volby.akce && typeof volby.akce.fn === "function" ? volby.akce : null;
        const tlacitko = zpet || (akce && akce.fn);
        el.style.background = tone === "error" ? "#b91c1c" : tone === "warn" ? "#b45309" : "#16794a";
        el.textContent = message;
        el._zpet = tlacitko;
        if (tlacitko) {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = zpet ? "Zpět" : String(akce.text || "Otevřít");
            b.style.cssText = "flex:none;min-height:32px;padding:0 14px;border:1px solid rgba(255,255,255,.65);" +
                "border-radius:var(--r,6px);background:rgba(255,255,255,.16);color:#fff;font:inherit;" +
                "font-weight:900;cursor:pointer";
            b.addEventListener("click", () => {
                if (el._zpet !== tlacitko) return;     // hláška mezitím patří jiné akci
                el._zpet = null;
                clearTimeout(el._timer);
                el._schovej();
                if (!zpet) {
                    try { akce.fn(); } catch (err) { console.error(err); }
                    return;
                }
                Promise.resolve().then(zpet).then(
                    () => UI.toast("Vráceno."),
                    (err) => { console.error(err); UI.toast("Vrátit se nepodařilo.", "error"); });
            });
            el.appendChild(b);
        }
        el.style.pointerEvents = tlacitko ? "auto" : "none";
        requestAnimationFrame(() => {
            el.style.transform = "translate(-50%, 0)";
            el.style.opacity = "1";
        });
        clearTimeout(el._timer);
        el._timer = setTimeout(el._schovej, tlacitko ? 8000 : 3400);
    };

    /* ------------------------------------------- okna Potvrď a Zeptej se ----
       Místo nativních oken prohlížeče confirm() a prompt(): ta blokují celou
       stránku, nejdou nastylovat, na telefonu v aplikaci vypadají cize
       a automatický test je neodklikne (rešerše webu 19. 10. 2026).

         await UI.potvrd({ nadpis, text, ano: "Smazat", ne: "Zrušit", nebezpecne: true })
             → true / false
         await UI.zeptej({ nadpis, text, vychozi, typ: "text" | "number" | "date",
                           overeni, ano, ne, placeholder, min, max, krok, viceradku })
             → zadaný řetězec (jako prompt, neořezaný) / null = zrušeno

       - Bez nadpisu se nadpisem stane první odstavec textu (do prázdného
         řádku): „Smazat X?\n\nPodrobnosti“ se rozdělí samo. \n v textu platí.
       - overeni(hodnota) → nic / "" = v pořádku, text = chyba (ukáže se pod
         polem a okno zůstane otevřené), false = obecná chyba.
       - Modální: role alertdialog / dialog, aria-modal, fokus jde dovnitř
         (pole; u nebezpečné akce „Zrušit“, jinak hlavní tlačítko), Tab
         neuteče ven, po zavření se vrátí, odkud přišel. Esc = zrušit,
         Enter = potvrdit (na tlačítku zmáčkne to tlačítko; u nebezpečné
         akce jen tak – omylem se nic nesmaže). Klávesy a kliky z okna
         nejdou do stránky pod ním (její Delete, Ctrl+Z, Esc…).
       - Na telefonu (do 600 px) vyjede zespodu přes celou šířku.
       - Vzhled z tokenů app.css (styl se vloží jednou, s náhradními hodnotami).

       Převod: if (!confirm("…")) return;  →  if (!(await UI.potvrd({ … }))) return;
       Funkce kolem musí být async a kdo čekal na její výsledek, musí ho
       počkat (await) – jinak by kód běžel dřív, než člověk odpoví. */

    const DLG_STYL = [
        ".kbdlg{position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;",
        "padding:var(--sp-4,16px);background:rgba(11,13,16,.55);opacity:0;transition:opacity .15s ease}",
        ".kbdlg.je-videt{opacity:1}",
        ".kbdlg__deska{box-sizing:border-box;width:min(460px,100%);max-height:calc(100vh - 32px);",
        "max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain;display:grid;",
        "grid-template-columns:auto minmax(0,1fr);gap:var(--sp-2,8px) var(--sp-4,16px);align-items:start;",
        "padding:var(--sp-5,24px);background:var(--surface,#fff);color:var(--text,#16191d);",
        "border:1px solid var(--line,#dfe3e8);border-radius:var(--r-lg,8px);",
        "box-shadow:0 24px 48px -18px rgba(11,13,16,.5);font-family:var(--font,system-ui,sans-serif);",
        "font-size:var(--fs-3,14px);line-height:var(--lh,1.45);text-align:left;",
        "transform:translateY(8px);transition:transform .15s ease}",
        ".kbdlg.je-videt .kbdlg__deska{transform:none}",
        ".kbdlg__deska:focus{outline:none}",
        ".kbdlg__kruh{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;",
        "background:var(--accent-tint,#f0f7fa);color:var(--accent,#1d556d)}",
        ".kbdlg__kruh svg{width:20px;height:20px}",
        ".kbdlg--nebezpecne .kbdlg__kruh{background:var(--danger-tint,#fde3e3);color:var(--danger,#b91c1c)}",
        ".kbdlg__nadpis{margin:0;min-height:40px;display:flex;align-items:center;font-size:var(--fs-4,16px);",
        "font-weight:var(--fw-tucne,900);line-height:1.3;color:var(--text,#16191d);overflow-wrap:anywhere}",
        ".kbdlg__text{grid-column:2;margin:0;color:var(--text-soft,#3f4650);white-space:pre-line;",
        "overflow-wrap:anywhere}",
        ".kbdlg__pole{grid-column:2;display:grid;gap:var(--sp-1,4px);margin-top:var(--sp-1,4px)}",
        ".kbdlg__vstup{box-sizing:border-box;width:100%;font:inherit}",
        "textarea.kbdlg__vstup{min-height:96px;resize:vertical}",
        ".kbdlg__chyba{margin:0;font-size:var(--fs-2,13px);font-weight:var(--fw-polotucne,700);",
        "color:var(--danger,#b91c1c)}",
        ".kbdlg__chyba[hidden]{display:none}",
        ".kbdlg__vstup[aria-invalid=true]{border-color:var(--danger,#b91c1c)}",
        ".kbdlg__akce{grid-column:1 / -1;display:flex;flex-wrap:wrap;justify-content:flex-end;",
        "gap:var(--sp-2,8px);margin-top:var(--sp-3,12px)}",
        ".kbdlg .btn:focus-visible{outline:2px solid var(--accent,#1d556d);outline-offset:2px}",
        ".kbdlg .kbdlg__ano--nebezpecne{background:var(--danger,#b91c1c);border-color:var(--danger,#b91c1c);",
        "color:#fff}",
        ".kbdlg .kbdlg__ano--nebezpecne:hover{filter:brightness(.9)}",
        ".kbdlg .kbdlg__ano--nebezpecne:focus-visible{outline-color:var(--danger,#b91c1c)}",
        "@media (max-width:600px){",
        ".kbdlg{align-items:flex-end;padding:0}",
        ".kbdlg__deska{width:100%;max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);",
        "border-width:1px 0 0;border-radius:var(--r-lg,8px) var(--r-lg,8px) 0 0;",
        "padding:var(--sp-5,24px) var(--sp-4,16px) calc(var(--sp-4,16px) + env(safe-area-inset-bottom));",
        "transform:translateY(32px)}",
        ".kbdlg__akce{display:grid;grid-template-columns:1fr 1fr}",
        ".kbdlg__akce .btn{width:100%}}",
        "@media (prefers-reduced-motion:reduce){.kbdlg,.kbdlg__deska{transition:none}}"
    ].join("");

    const dlgIkona = (cesta) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + cesta + "</svg>";
    const DLG_IKONY = {
        otazka: dlgIkona('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4' +
            'c-.6.3-1 .8-1 1.5v.5M12 16.8v.01"/>'),
        pozor: dlgIkona('<path d="M12 4.5l9 15.5H3z"/><path d="M12 10v4.5M12 17.5v.01"/>'),
        pero: dlgIkona('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>')
    };

    const dlgZasobnik = [];     // otevřená okna, nahoře poslední
    let dlgPocitadlo = 0;
    let dlgDozvukDo = 0;        // chvíli po zavření: držený Enter nesmí znovu zmáčknout tlačítko pod ním
    const dlgHorni = () => dlgZasobnik[dlgZasobnik.length - 1] || null;

    window.addEventListener("keydown", (e) => {
        const o = dlgHorni();
        if (!o) {
            if (e.key === "Enter" && e.repeat && Date.now() < dlgDozvukDo) {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }
        e.stopPropagation();            // zkratky stránky pod oknem nejedou
        if (e.key === "Escape") { e.preventDefault(); o.zrus(); return; }
        if (e.key === "Tab") { e.preventDefault(); o.tab(e.shiftKey); return; }
        if (e.key !== "Enter" || e.isComposing) return;
        if (e.repeat) { e.preventDefault(); return; }
        const cil = e.target;
        if (cil && cil.tagName === "BUTTON" && o.el.contains(cil)) return;     // zmáčkne tlačítko s fokusem
        if (cil && cil.tagName === "TEXTAREA" && !(e.ctrlKey || e.metaKey)) return;   // nový řádek
        e.preventDefault();
        if (o.sPolem || !o.nebezpecne) o.ano();
    }, true);

    // fokus mimo okno (klik do stránky, myš, čtečka) se vrací dovnitř
    document.addEventListener("focusin", (e) => {
        const o = dlgHorni();
        if (o && !o.el.contains(e.target)) o.fokus();
    }, true);

    function dlgOtevri(volby, sPolem) {
        const v = typeof volby === "string" ? { text: volby } : Object.assign({}, volby || {});
        if (!document.getElementById("kbDlgStyl")) {
            const styl = document.createElement("style");
            styl.id = "kbDlgStyl";
            styl.textContent = DLG_STYL;
            document.head.appendChild(styl);
        }
        return new Promise((hotovo) => {
            const id = "kbdlg" + (++dlgPocitadlo);
            const nebezpecne = !!v.nebezpecne;
            const typ = v.typ === "number" || v.typ === "date" ? v.typ : "text";
            const viceradku = sPolem && typ === "text" && !!v.viceradku;
            let nadpis = v.nadpis == null ? "" : String(v.nadpis);
            let text = v.text == null ? "" : String(v.text);
            if (!nadpis) {
                const i = text.indexOf("\n\n");
                nadpis = i === -1 ? text : text.slice(0, i);
                text = i === -1 ? "" : text.slice(i + 2).replace(/^\n+/, "");
            }
            if (!nadpis) nadpis = sPolem ? "Zadej hodnotu" : "Opravdu?";

            let pole = "";
            if (sPolem) {
                const vychozi = v.vychozi == null ? "" : String(v.vychozi);
                const spolecne = ' class="field kbdlg__vstup" id="' + id + '-v" aria-labelledby="' + id + '-n"' +
                    ' aria-describedby="' + (text ? id + "-t " : "") + id + '-ch" autocomplete="off"' +
                    (v.placeholder ? ' placeholder="' + esc(v.placeholder) + '"' : "") +
                    (v.maxDelka ? ' maxlength="' + esc(v.maxDelka) + '"' : "");
                const cislo = typ === "number"
                    ? (v.min != null ? ' min="' + esc(v.min) + '"' : "") +
                      (v.max != null ? ' max="' + esc(v.max) + '"' : "") +
                      ' step="' + esc(v.krok != null ? v.krok : "any") + '"' +
                      ' inputmode="' + (v.krok != null && Number.isInteger(Number(v.krok)) ? "numeric" : "decimal") + '"'
                    : "";
                pole = '<div class="kbdlg__pole">' +
                    (viceradku
                        ? '<textarea rows="4"' + spolecne + ">" + esc(vychozi) + "</textarea>"
                        : '<input type="' + typ + '"' + spolecne + cislo + ' value="' + esc(vychozi) + '">') +
                    '<p class="kbdlg__chyba" id="' + id + '-ch" role="alert" hidden></p></div>';
            }

            const pred = document.activeElement;
            const el = document.createElement("div");
            el.className = "kbdlg no-print" + (nebezpecne ? " kbdlg--nebezpecne" : "");
            el.innerHTML =
                '<div class="kbdlg__deska" role="' + (sPolem ? "dialog" : "alertdialog") + '" aria-modal="true"' +
                    ' aria-labelledby="' + id + '-n"' + (text ? ' aria-describedby="' + id + '-t"' : "") + ' tabindex="-1">' +
                    '<span class="kbdlg__kruh">' +
                        (sPolem ? DLG_IKONY.pero : nebezpecne ? DLG_IKONY.pozor : DLG_IKONY.otazka) + "</span>" +
                    '<h2 class="kbdlg__nadpis" id="' + id + '-n">' + esc(nadpis) + "</h2>" +
                    (text ? '<p class="kbdlg__text" id="' + id + '-t">' + esc(text) + "</p>" : "") +
                    pole +
                    '<div class="kbdlg__akce">' +
                        '<button type="button" class="btn btn--ghost" data-kbdlg="ne">' +
                            esc(v.ne || "Zrušit") + "</button>" +
                        '<button type="button" class="btn ' +
                            (nebezpecne ? "kbdlg__ano--nebezpecne" : "btn--primary") + '" data-kbdlg="ano">' +
                            esc(v.ano || (sPolem ? "OK" : "Ano")) + "</button>" +
                    "</div>" +
                "</div>";

            const vstup = el.querySelector(".kbdlg__vstup");
            const chyba = el.querySelector(".kbdlg__chyba");
            const tlNe = el.querySelector('[data-kbdlg="ne"]');
            const tlAno = el.querySelector('[data-kbdlg="ano"]');
            const o = { el: el, sPolem: sPolem, nebezpecne: nebezpecne };
            const otevrenoMs = Date.now();
            let zavreno = false;

            o.fokus = () => {
                const cil = vstup || (nebezpecne ? tlNe : tlAno);
                try { cil.focus({ preventScroll: true }); } catch (err) { cil.focus(); }
            };
            o.tab = (zpet) => {
                const prvky = [vstup, tlNe, tlAno].filter(Boolean);
                const i = prvky.indexOf(document.activeElement);
                prvky[zpet ? (i <= 0 ? prvky.length - 1 : i - 1)
                           : (i === -1 || i === prvky.length - 1 ? 0 : i + 1)].focus();
            };
            const zavri = (vysledek) => {
                if (zavreno) return;
                zavreno = true;
                const i = dlgZasobnik.indexOf(o);
                if (i !== -1) dlgZasobnik.splice(i, 1);
                el.classList.remove("je-videt");
                el.style.pointerEvents = "none";
                setTimeout(() => el.remove(), 200);
                dlgDozvukDo = Date.now() + 1000;
                // fokus zpátky, odkud přišel (tlačítko, pole); jinak do okna pod ním
                if (pred && pred !== document.body && pred.isConnected && typeof pred.focus === "function") {
                    try { pred.focus({ preventScroll: true }); } catch (err) { /* nic */ }
                } else if (dlgHorni()) dlgHorni().fokus();
                hotovo(vysledek);
            };
            const ukazChybu = (zprava) => {
                chyba.textContent = zprava || "";
                chyba.hidden = !zprava;
                if (zprava) vstup.setAttribute("aria-invalid", "true");
                else vstup.removeAttribute("aria-invalid");
            };
            const zkontroluj = () => {
                const s = vstup.validity || {};
                let zprava = "";
                if (s.badInput) zprava = typ === "date" ? "Zadej platné datum." : "Zadej číslo.";
                else if (typ === "number" && vstup.value !== "" &&
                         (s.rangeUnderflow || s.rangeOverflow || s.stepMismatch)) {
                    zprava = v.min != null && v.max != null
                        ? "Zadej číslo od " + v.min + " do " + v.max + "." : "Zadej platné číslo.";
                }
                if (!zprava && typeof v.overeni === "function") {
                    let r;
                    try { r = v.overeni(vstup.value); } catch (err) { console.error(err); r = false; }
                    if (r === false) zprava = "Zadej platnou hodnotu.";
                    else if (typeof r === "string") zprava = r;
                }
                ukazChybu(zprava);
                return !zprava;
            };
            o.ano = () => {
                if (!sPolem) return zavri(true);
                if (!zkontroluj()) { vstup.focus(); return; }
                zavri(vstup.value);
            };
            o.zrus = () => zavri(sPolem ? null : false);

            if (vstup) vstup.addEventListener("input", () => { if (!chyba.hidden) ukazChybu(""); });
            /* Klik na tmavé pozadí = Zrušit, ale jen celý klik na pozadí a ne
               hned po otevření – druhý klik dvojkliku na „Smazat“ by okno
               jinak rovnou zavřel. Kliky z okna do stránky neprobublají. */
            let dolu = false;
            el.addEventListener("pointerdown", (e) => { dolu = e.target === el; e.stopPropagation(); });
            el.addEventListener("mousedown", (e) => e.stopPropagation());
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                const b = e.target.closest("[data-kbdlg]");
                if (b) { if (b.dataset.kbdlg === "ano") o.ano(); else o.zrus(); return; }
                if (e.target === el && dolu && Date.now() - otevrenoMs > 350) o.zrus();
            });

            dlgZasobnik.push(o);
            document.body.appendChild(el);
            o.fokus();
            // řádek k přepsání se označí celý (jako u prompt), delší text dostane kurzor na konec
            if (vstup && viceradku) vstup.setSelectionRange(vstup.value.length, vstup.value.length);
            else if (vstup && typ === "text") vstup.select();
            requestAnimationFrame(() => el.classList.add("je-videt"));
        });
    }

    UI.potvrd = (volby) => dlgOtevri(volby, false);
    UI.zeptej = (volby) => dlgOtevri(volby, true);

    /* ------------------------------------------------------ uživatel a role --

       Čtyři role a k nim pevně dané pravomoci. Kdo co smí, se řeší JEN tady –
       stránky se ptají přes UI.can("neco"), takže se pravidlo mění na jednom
       místě.

       POZOR: tohle rozhoduje o tom, co je vidět a co jde odkliknout, ale není
       to zabezpečení. Dokud běží anonymní přihlášení k Firebase a otevřená
       pravidla databáze, dostane se ke všem datům kdokoliv, kdo zná adresu.
       Skutečné oddělení práv je až Firebase Auth + Firestore Rules (README). */

    /* „Správce" se navenek říká Manažer – tak se to ve firmě používá.
       Vnitřní id `spravce` se NEMĚNÍ: sedí na něm pravidla databáze
       (firestore.rules) i role uložené u lidí. Přejmenovává se jen to,
       co je vidět. */
    /* Majitel (Ondřej Kaňa) a asistentka (Věra Tothová) přibyli 21. 8. –
       zatím mají práva manažera, dělení práv přijde později. Id rolí jsou
       i v firestore.rules (spravce()) a ve store.js (tabule). */
    UI.ROLES = [
        { id: "hlavni-spravce", title: "Hlavní správce", short: "HL. SPRÁVCE" },
        { id: "majitel",        title: "Majitel",        short: "MAJITEL" },
        { id: "spravce",        title: "Manažer",        short: "MANAŽER" },
        { id: "asistentka",     title: "Asistentka",     short: "ASISTENTKA" },
        { id: "zamestnanec",    title: "Zaměstnanec",    short: "ZAMĚSTNANEC" },
        { id: "student",        title: "Student",        short: "STUDENT" }
    ];
    UI.MANAZERSKE_ROLE = ["hlavni-spravce", "majitel", "spravce", "asistentka"];

    /* Typ spolupráce – zatím jen dělí sazby a seznam lidí, dál se podle něj
       bude dělit. Kdo ho nemá nastavený, bere se podle role. */
    UI.TYPY = [
        { id: "zamestnanec", title: "Zaměstnanec", mnozne: "Zaměstnanci" },
        { id: "osvc",        title: "OSVČ",        mnozne: "OSVČ" },
        { id: "student",     title: "Student",     mnozne: "Studenti" },
        /* Účet, za kterým není člověk (zápis výkazů do Tabulek Google).
           Spravuje se v Uživatelích, ale nikam, kde se rozděluje práce,
           nepatří – k projektu se nepřiřazuje a sazbu nemá. */
        { id: "servis",      title: "Služební účet", mnozne: "Služební účty" }
    ];
    UI.typUvazku = (u) => (u && u.typ) || ((u && u.role === "student") ? "student" : "zamestnanec");
    UI.jeSluzebni = (u) => UI.typUvazku(u) === "servis";

    /* V jakém pořadí se lidé nabízejí: zaměstnanci a OSVČ napřed,
       studenti až za nimi (přání Michala 24. 8.). */
    UI.PORADI_TYPU = { zamestnanec: 0, osvc: 1, student: 2, servis: 3 };

    const MANAZER_PRAVA = [
        "ukol.create", "ukol.edit", "ukol.delete",
        "zakazky.manage", "historie.view", "milnik.manage",
        "navod.create", "navod.delete", "navod.pdf",
        "vykaz.otevrit", "vykaz.view", "vykaz.edit"
    ];

    /* Peníze firmy (faktury, pokladna) vidí jen hlavní správce, majitel
       a asistentka – běžný správce ne (Michal 24. 9. 2026). Hlídá to
       i databáze (firestore.rules, funkce finance()). */
    const FINANCE_PRAVA = MANAZER_PRAVA.concat(["finance.view"]);

    const PERMISSIONS = {
        "hlavni-spravce": ["*"],
        "majitel":    FINANCE_PRAVA,
        "spravce":    MANAZER_PRAVA,
        "asistentka": FINANCE_PRAVA,
        /* Zaměstnanec si výkazy otevře, ale vidí a zapisuje jen svoje – bez
           cizích zápisů, bez sazeb a bez exportu. Hlídá to i databáze
           (firestore.rules), ne jen schované tlačítko. */
        "zamestnanec": ["ukol.create", "ukol.edit", "navod.create", "vykaz.otevrit"],
        // student si taky zapisuje odpracovaný čas – jen svůj, jako zaměstnanec
        "student":     ["ukol.edit", "navod.create", "vykaz.otevrit"]
    };

    /** Souhrn pro obrazovku správy – co která role smí. */
    UI.PERMISSION_LABELS = {
        "ukol.create":    "zakládat úkoly",
        "ukol.edit":      "zapisovat procenta a poznámky",
        "ukol.delete":    "mazat úkoly",
        "zakazky.manage": "spravovat zakázky a skupiny",
        "historie.view":  "vidět historii zápisů",
        "milnik.manage":  "zapisovat milníky",
        "navod.create":   "tvořit návody",
        "navod.delete":   "mazat návody",
        "navod.pdf":      "stahovat návody do PDF",
        "vykaz.otevrit":  "otevřít výkazy a zapisovat svoje",
        "vykaz.view":     "vidět výkazy všech lidí včetně peněz",
        "finance.view":   "vidět faktury a pokladnu (peníze firmy)",
        "vykaz.edit":     "zapisovat výkazy za kohokoliv",
        "users.manage":   "spravovat uživatele",
        "web.design":     "měnit vzhled webu"
    };

    /**
     * Role se bere ze záznamu v databázi, ne z prohlížeče. Hodnota uložená
     * v prohlížeči slouží jen k tomu, aby stránka po načtení chvíli nebliklá,
     * než dorazí data – jakmile je seznam lidí k dispozici, rozhoduje on.
     * Kdo v seznamu není (třeba starým anonymním přihlášením), je student.
     */
    UI.skutecnaRole = () => {
        const uid = (window.KB && window.KB.currentUid) ? window.KB.currentUid() : "";
        const users = (window.KB && window.KB.users) || [];

        if (users.length) {
            const zaznam = uid ? users.find(u => u.id === uid) : null;
            return (zaznam && zaznam.active !== false && zaznam.role) ? zaznam.role : "student";
        }
        return window.KB_ROLE || "student";
    };

    /* ------------------------------------------------------ náhled role ---

       Hlavní správce si může web prohlédnout očima zaměstnance nebo studenta,
       aby viděl, co na koho vyskočí. Tři pojistky, aby z toho nebyla díra:

       1. Náhled se uzná JEN tomu, jehož skutečná role v databázi je hlavní
          správce. Kdokoliv jiný si ho do prohlížeče může zapsat, jak chce,
          a nedostane tím ani o kousek víc – proto se to nedá zneužít.
       2. Náhled jde vždycky jen dolů. Hlavní správce smí všechno, takže
          každá jiná role je zúžení, nikdy rozšíření.
       3. Sedí v sessionStorage, ne v localStorage – zavřením záložky zmizí.

       A hlavně: je to náhled TOHO, CO SE VYKRESLÍ. Data z databáze chodí
       pořád podle skutečného účtu, protože pravidla Firestore čtou UID.
       Na otestování zabezpečení tohle není – na to je potřeba druhý účet. */

    const NAHLED_KEY = "company_kb_nahled";

    UI.nahled = () => {
        if (UI.skutecnaRole() !== "hlavni-spravce") return "";
        try { return sessionStorage.getItem(NAHLED_KEY) || ""; } catch (err) { return ""; }
    };

    UI.setNahled = (role) => {
        if (UI.skutecnaRole() !== "hlavni-spravce") return;
        try {
            if (role) sessionStorage.setItem(NAHLED_KEY, role);
            else sessionStorage.removeItem(NAHLED_KEY);
        } catch (err) { /* soukromý režim */ }
        document.dispatchEvent(new CustomEvent("kb-role"));
        UI.paintUser();
    };

    /** Náhled na konkrétního člověka: hodnota "uid:<id>" v přepínači. */
    UI.nahledUid = () => {
        const n = UI.nahled();
        return n.indexOf("uid:") === 0 ? n.slice(4) : "";
    };

    /** Role, podle které se stránka vykresluje – tedy náhled, když je zapnutý.
        U náhledu na člověka se bere JEHO role ze seznamu lidí. */
    UI.role = () => {
        const n = UI.nahled();
        if (!n) return UI.skutecnaRole();
        if (n.indexOf("uid:") === 0) {
            const u = ((window.KB && window.KB.users) || []).find(x => x.id === n.slice(4));
            return (u && u.role) || "zamestnanec";
        }
        return n;
    };
    UI.roleTitle = (id) => (UI.ROLES.find(r => r.id === (id || UI.role())) || {}).title || "Student";

    /** Smí daná role tuhle věc? Hlavní správce smí všechno. */
    UI.canAs = (role, action) => {
        const allowed = PERMISSIONS[role] || [];
        return allowed.indexOf("*") !== -1 || allowed.indexOf(action) !== -1;
    };

    /** Smí to přihlášený? */
    UI.can = (action) => UI.canAs(UI.role(), action);

    UI.isOwner = () => UI.role() === "hlavni-spravce";
    /** „Správce" v původním smyslu – hlavní správce i běžný správce. */
    UI.isAdmin = () => UI.MANAZERSKE_ROLE.indexOf(UI.role()) !== -1;

    UI.setUser = (name) => {
        window.KB_USER = name;
        localStorage.setItem(USER_KEY, name);
        UI.paintUser();
        if (window.KB && window.KB.logLogin) window.KB.logLogin(name);
    };

    UI.setRole = (role) => {
        window.KB_ROLE = role;
        localStorage.setItem(ROLE_KEY, role);
        UI.paintUser();
        document.dispatchEvent(new CustomEvent("kb-role"));
    };

    UI.paintUser = () => {
        /* Jméno a role bydlí dole ve svislém pásu; nahoře vpravo zůstává
           jen tlačítko přihlášení/odhlášení (přání Michala). Na úzkém okně
           bez pásu se jméno ukáže i nahoře, jinak by nebylo nikde. */
        document.querySelectorAll("[data-userbox]").forEach(box => {
            // na širokém okně tohle schová CSS – jméno i odhlášení nese pás
            box.innerHTML = window.KB_USER
                ? '<span class="appbar__jmeno-mobil">' + esc(window.KB_USER) + "</span>" +
                  '<button type="button" class="linkbtn" data-logout>Odhlásit</button>'
                : '<button type="button" class="linkbtn" data-login>Přihlásit se</button>';
        });
        /* Jméno, role a odhlášení sedí uprostřed spodku pásu – přání Michala.
           Nahoře vpravo zůstane přihlašovací tlačítko jen pro nepřihlášené
           a pro úzké okno, kde žádný pás není. */
        document.querySelectorAll("[data-rail-ja]").forEach(box => {
            const role = UI.ROLES.find(r => r.id === UI.role()) || UI.ROLES.find(r => r.id === "student");
            // iniciály do kolečka – „Jan Novák" → „JN"
            const inicialy = String(window.KB_USER || "").trim().split(/\s+/)
                .map(c => c.charAt(0)).join("").slice(0, 2).toUpperCase();
            box.innerHTML = window.KB_USER
                ? '<span class="siderail__avatar" aria-hidden="true">' + esc(inicialy) + "</span>" +
                  '<span class="siderail__kdo"><b>' + esc(window.KB_USER) + "</b>" +
                  '<span class="siderail__role">' + esc(role.title) + "</span></span>" +
                  '<button type="button" class="siderail__odhlasit" data-logout>Odhlásit se</button>'
                : '<button type="button" class="siderail__odhlasit" data-login>Přihlásit se</button>';
        });
        document.querySelectorAll("[data-user-name]").forEach(el => {
            el.textContent = window.KB_USER || "nepřihlášen";
        });
        document.querySelectorAll("[data-role-pill]").forEach(el => {
            const role = UI.ROLES.find(r => r.id === UI.role()) || UI.ROLES.find(r => r.id === "student");
            el.textContent = window.KB_USER ? role.short : "NEPŘIHLÁŠEN";
            el.className = "rolepill" + (UI.isAdmin() ? " rolepill--admin" : "") +
                           (window.KB_USER ? "" : " rolepill--off");
        });
        /* Prvky, které smí vidět jen někdo – data-need="ukol.create".
           Nepřihlášenému se skryjí všechny: role se do doby, než dorazí
           seznam lidí, bere z prohlížeče, takže po odhlášení zůstávala
           poslední zapamatovaná a s ní i tlačítka jako Nový výkaz. */
        document.querySelectorAll("[data-need]").forEach(el => {
            el.hidden = !window.KB_USER || !UI.can(el.dataset.need);
        });

        /* Osobní věci nemá nepřihlášený proč vidět: Quick TO-DO, Správa aut,
           Nový výkaz, Moje úkoly ani ikony nástrojů nic nenačtou (data drží
           pravidla databáze), ale klikaly se a vypadalo to jako rozbitý web.
           Nabídka stránek zůstává – ta slouží k rozhlédnutí a stejně za ní
           je přihlášení. */
        const prihlasen = !!window.KB_USER;
        document.querySelectorAll("[data-jen-prihlaseny]").forEach(el => {
            el.hidden = !prihlasen;
        });

        // skupina pásu bez jediné viditelné položky se schová celá
        srovnejSkupiny(true);
        paintNahled();
    };

    /** Přepínač náhledu a pruh, který připomíná, že je zapnutý. */
    function paintNahled() {
        const jeHlavni = UI.skutecnaRole() === "hlavni-spravce";
        const nahled = UI.nahled();

        document.querySelectorAll("[data-nahled-box]").forEach(box => { box.hidden = !jeHlavni; });
        document.querySelectorAll("[data-nahled]").forEach(sel => {
            /* Kromě rolí i konkrétní lidé – když si někdo stěžuje, hlavní
               správce se na web podívá přímo jeho očima (jeho role a co
               s ní vidí; data mu zůstávají vlastní). */
            if (jeHlavni && !sel.querySelector("optgroup") &&
                ((window.KB && window.KB.users) || []).length) {
                /* Po skupinách jako všude jinde – zaměstnanci, OSVČ,
                   studenti – ať se člověk najde rychle. */
                const lide = window.KB.users
                    .filter(u => u.active !== false && !UI.jeSluzebni(u) &&
                        u.id !== (window.KB.currentUid && window.KB.currentUid()))
                    .sort((a, b) => (a.last || "").localeCompare(b.last || "", "cs"));
                sel.insertAdjacentHTML("beforeend", UI.TYPY.map(t => {
                    const moji = lide.filter(u => UI.typUvazku(u) === t.id);
                    if (!moji.length) return "";
                    return '<optgroup label="' + esc(t.mnozne) + '">' +
                        moji.map(u => '<option value="uid:' + esc(u.id) + '">' +
                            esc(((u.first || "") + " " + (u.last || "")).trim() || u.email || "?") +
                            "</option>").join("") + "</optgroup>";
                }).join(""));
            }
            sel.value = nahled;
        });

        let pruh = document.getElementById("kbNahledPruh");
        if (!nahled) { if (pruh) pruh.remove(); return; }

        const role = UI.ROLES.find(r => r.id === nahled) || {};
        if (!pruh) {
            pruh = document.createElement("div");
            pruh.id = "kbNahledPruh";
            pruh.className = "nahledpruh no-print";
            const header = document.querySelector(".appbar");
            if (header && header.parentNode) header.parentNode.insertBefore(pruh, header.nextSibling);
            else document.body.insertBefore(pruh, document.body.firstChild);
        }
        const uidNahledu = UI.nahledUid();
        const clovekNahledu = uidNahledu
            ? ((window.KB && window.KB.users) || []).find(u => u.id === uidNahledu) : null;
        const popisNahledu = clovekNahledu
            ? ((clovekNahledu.first || "") + " " + (clovekNahledu.last || "")).trim() +
              " (" + (UI.roleTitle(clovekNahledu.role) || "").toLowerCase() + ")"
            : (role.title || nahled).toLowerCase();
        pruh.innerHTML = "<span><b>Prohlížíš web jako " + esc(popisNahledu) +
            "</b> — vidíš jen to, co vidí on. Tvoje oprávnění se nezměnila.</span>" +
            '<button type="button" class="btn btn--sm" data-nahled-konec>Zpět na hlavního správce</button>';
    }

    /* Přepínač se nesprávci musí schovat i tehdy, když se role změní jinudy
       než přes paintUser – třeba když dorazí seznam lidí až po vykreslení. */
    document.addEventListener("kb-role", paintNahled);

    // přepnutí náhledu a návrat zpět – kdekoliv na stránce
    document.addEventListener("change", (event) => {
        const sel = event.target.closest("[data-nahled]");
        if (sel) UI.setNahled(sel.value);
    });
    document.addEventListener("click", (event) => {
        if (event.target.closest("[data-nahled-konec]")) UI.setNahled("");
    });

    /* ---------------------------------------------------------- přihlášení */

    const EMAIL_KEY = "company_kb_email";
    window.KB_EMAIL = localStorage.getItem(EMAIL_KEY) || "";

    /** Otisk hesla. Sůl je u každého jiná, ať se stejná hesla neprozradí. */
    UI.hashPassword = async (password, salt) => {
        const data = new TextEncoder().encode(String(salt || "") + ":" + String(password || ""));
        const buffer = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");
    };

    UI.newSalt = () => Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map(b => b.toString(16).padStart(2, "0")).join("");

    /* Trezor na hesla lidí byl zrušený 1. 9. 2026 – hesla v databázi nejsou
       vůbec, přihlašuje Firebase Auth. */

    
    
    
    /* Záznam přihlášeného se hledá podle UID účtu – dokument v `users` se tak
       jmenuje, protože jen podle cesty si ho umí přečíst i pravidla databáze. */
    UI.me = () => {
        const uid = (window.KB && window.KB.currentUid) ? window.KB.currentUid() : "";
        if (!uid) return null;
        return (window.KB.users || []).find(u => u.id === uid) || null;
    };

    /** Chyby z Firebase přeložené do lidské řeči. */
    const chybaPrihlaseni = (code) => ({
        "auth/invalid-email":        "Tohle není platný e-mail.",
        "auth/user-disabled":        "Účet je zablokovaný. Ozvi se hlavnímu správci.",
        "auth/user-not-found":       "Takový účet neexistuje.",
        "auth/wrong-password":       "Nesprávné heslo.",
        "auth/invalid-credential":   "Nesprávný e-mail nebo heslo.",
        "auth/too-many-requests":    "Moc pokusů po sobě. Zkus to za chvíli.",
        "auth/network-request-failed": "Nejde se spojit se serverem."
    })[code] || "Přihlášení se nezdařilo.";

    /** Přihlášení přes Firebase Auth. */
    UI.login = async (email, password) => {
        try {
            await window.KB.signIn(email, password);
        } catch (err) {
            return { ok: false, error: chybaPrihlaseni(err && err.code) };
        }

        // seznam lidí dorazí až po přihlášení – počkáme na svůj záznam
        const user = await new Promise(resolve => {
            if (UI.me()) return resolve(UI.me());
            const hotovo = setTimeout(() => resolve(UI.me()), 8000);
            window.KB.on("users", () => {
                if (UI.me()) { clearTimeout(hotovo); resolve(UI.me()); }
            });
        });

        if (!user) {
            await window.KB.signOut().catch(() => {});
            return { ok: false, error: "Účet není v seznamu lidí. Ozvi se hlavnímu správci." };
        }
        if (user.active === false) {
            await window.KB.signOut().catch(() => {});
            return { ok: false, error: "Účet je pozastavený. Ozvi se hlavnímu správci." };
        }

        window.KB_EMAIL = user.email || String(email).trim().toLowerCase();
        localStorage.setItem(EMAIL_KEY, window.KB_EMAIL);
        UI.setRole(user.role || "student");
        UI.setUser(((user.first || "") + " " + (user.last || "")).trim() || window.KB_EMAIL);
        return { ok: true, user: user };
    };

    UI.logout = async () => {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(EMAIL_KEY);
        /* Co o člověku zůstává v prohlížeči: role, náhled role a odemčení
           zamčených stránek. Volby vzhledu (záložky, filtry, oblíbené) nic
           neprozradí, ty zůstávají. */
        [ROLE_KEY, NAHLED_KEY, "company_kb_zamek"].forEach(k => localStorage.removeItem(k));
        try { sessionStorage.clear(); } catch (err) { /* nevadí */ }
        window.KB_USER = "";
        window.KB_EMAIL = "";
        UI.setRole("student");
        UI.paintUser();
        await window.KB.odhlasACisti().catch(() => {});
        UI.toast("Odhlášeno.");
        /* odhlasACisti zavřel databázi, aby šla smazat její kopie
           v prohlížeči – stránka se proto načte znovu, už bez dat */
        setTimeout(() => location.reload(), 700);
    };

    /** Role se bere ze seznamu – když ji správce změní, projeví se sama. */
    UI.syncRole = () => {
        const uid = (window.KB && window.KB.currentUid) ? window.KB.currentUid() : "";
        if (!uid) return;
        // dokud seznam lidí nedorazí z databáze, nemáme co porovnávat –
        // jinak by se člověk při každém načtení stránky sám odhlásil
        if (!((window.KB && window.KB.users) || []).length) return;

        const user = UI.me();
        if (!user || user.active === false) return void UI.logout();
        if (user.role && user.role !== window.KB_ROLE) UI.setRole(user.role);

        const name = ((user.first || "") + " " + (user.last || "")).trim();
        if (name && name !== window.KB_USER) UI.setUser(name);
        if (user.email && user.email !== window.KB_EMAIL) {
            window.KB_EMAIL = user.email;
            localStorage.setItem(EMAIL_KEY, user.email);
        }
    };

    /* ------------------------------------------------------- okno přihlášení */

    UI.openLogin = () => {
        let box = document.getElementById("kbLogin");
        if (!box) {
            box = document.createElement("div");
            box.id = "kbLogin";
            box.className = "loginbox no-print";
            box.innerHTML =
                '<form class="loginbox__card card col" style="gap:14px">' +
                    /* Zavírá se JEN křížkem. Klik bokem okno zavíral i tomu,
                       kdo jen táhl myší přes heslo, a rozepsané přihlášení
                       zmizelo (přání Michala 1. 9. 2026). */
                    '<button type="button" class="loginbox__zavri" data-login-close' +
                        ' title="Zavřít" aria-label="Zavřít">&times;</button>' +
                    '<img src="Pasport_Kana_black.png" alt="Pasport Kaňa" style="height:52px;object-fit:contain;margin:0 auto">' +
                    '<b style="font-size:17px;text-align:center">Přihlášení</b>' +
                    '<div><label class="label" for="kbLoginEmail">E-mail</label>' +
                        '<input id="kbLoginEmail" type="email" class="field" autocomplete="username" placeholder="jmeno@pasport.eu"></div>' +
                    '<div><label class="label" for="kbLoginPass">Heslo</label>' +
                        '<input id="kbLoginPass" type="password" class="field" autocomplete="current-password"></div>' +
                    '<div id="kbLoginErr" class="tiny" style="color:var(--danger);min-height:16px"></div>' +
                    '<button type="submit" class="btn btn--primary" style="width:100%">Přihlásit se</button>' +
                    '<div class="tiny muted" style="text-align:center;line-height:1.5">' +
                        "Heslo ti přidělí hlavní správce.</div>" +
                "</form>";
            document.body.appendChild(box);

            box.querySelector("[data-login-close]").addEventListener("click",
                () => box.classList.remove("is-open"));

            box.querySelector("form").addEventListener("submit", async (event) => {
                event.preventDefault();
                const err = document.getElementById("kbLoginErr");
                err.textContent = "";

                const result = await UI.login(
                    document.getElementById("kbLoginEmail").value,
                    document.getElementById("kbLoginPass").value);

                if (!result.ok) return void (err.textContent = result.error);

                box.classList.remove("is-open");
                document.getElementById("kbLoginPass").value = "";
                UI.toast("Vítej, " + window.KB_USER + " · " + UI.roleTitle());
                document.dispatchEvent(new CustomEvent("kb-role"));
            });
        }
        box.classList.add("is-open");
        setTimeout(() => document.getElementById("kbLoginEmail").focus(), 50);
    };

    /* ------------------------------------------------------ brána webu ----

       Nepřihlášený člověk nemá vidět vůbec nic – ani prázdné výpisy, ze
       kterých se dá klikat dál. Místo obsahu stránky se mu ukáže jediná
       výzva k přihlášení. Řeší se to centrálně, aby to platilo na všech
       stránkách včetně těch, které teprve přibudou. */

    function gateHtml() {
        return '<div class="gate">' +
            '<button type="button" class="gate__btn" data-login>' +
                '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor">' +
                    ((window.KB_ICONS || {}).lock || "") + "</svg>" +
                "<span>Pro náhled na webu je nutné přihlášení</span>" +
            "</button>" +
        "</div>";
    }

    /** Podle stavu přihlášení schová nebo ukáže obsah stránky. */
    UI.paintGate = () => {
        const stav = (window.KB && window.KB.status) || "connecting";
        if (stav === "connecting") return;          // ještě nevíme, nic neblikáme

        const prihlasen = !!(window.KB.currentUid && window.KB.currentUid());
        document.querySelectorAll("main").forEach(m => { m.hidden = !prihlasen; });

        let gate = document.getElementById("kbGate");
        if (prihlasen) {
            if (gate) gate.remove();
            return;
        }
        if (!gate) {
            gate = document.createElement("div");
            gate.id = "kbGate";
            gate.innerHTML = gateHtml();
            const header = document.querySelector(".appbar");
            if (header && header.parentNode) header.parentNode.insertBefore(gate, header.nextSibling);
            else document.body.appendChild(gate);
        }
    };

    /** Kde se bez přihlášení nedá pokračovat – otevře rovnou přihlašovací okno. */
    UI.requireUser = () => {
        if (window.KB_USER) return window.KB_USER;
        UI.openLogin();
        return "";
    };

    /* ---------------------------------------------------------- horní lišta */

    const icon = (name) =>
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor">' + ((window.KB_ICONS || {})[name] || "") + "</svg>";

    const CARET = '<svg class="navbtn__caret" fill="none" viewBox="0 0 24 24" stroke="currentColor">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7"/></svg>';

    let lastNav = {};

    /** Úzké okno nebo dotykový displej – roletky se ovládají ťuknutím. */
    const isCompact = () => window.matchMedia("(max-width: 1120px), (hover: none)").matches;

    /* Roletka ÚKOLY & TO-DO (Michal 20. 10. 2026: „nechci, aby se tam
       ukázalo všechno … primárně stačí Biopharm a pak co mají lidé
       přiřazeno k sobě"). Dřív vypisovala každou zakázku, ke které kdy
       byl úkol. Teď:
         MOJE ÚKOLY            počet mých otevřených
         Moje zakázky          kde mám přiřazené otevřené úkoly, nejvíc nahoře
         Oblíbené projekty     hvězdička ve Správě (společná pro firmu)
         Úkoly týmu            jen manažer: kde má otevřené úkoly kdokoliv,
                               nejvýš osm podle počtu
         VŠECHNY PROJEKTY →    celý seznam úkolů
       Žádný projekt tu není natvrdo, všechno jde z dat. Data chodí až po
       vykreslení lišty – roletku dosypává refreshNav na události „ukoly",
       „projekty-docs" a „zakazky" (oblíbené). Všechny úkoly pás jinak
       nečte (jen moje) – manažer si je řekne, až na roletku najede
       (nactiUkolyTymu), ať se nečtou na každé stránce zbytečně. */
    const MAX_ZAKAZEK_TYMU = 8;

    function taskMenu() {
        const KB = window.KB || {};
        const uid = KB.currentUid ? KB.currentUid() : "";
        const otevrene = (KB.ukoly || []).filter(u => u.stav !== "hotovo");
        const naZakazku = (nazev) => "ukoly.html?zak=" + encodeURIComponent(UI.slug(nazev));
        const uzVidet = new Set();          // každá zakázka v roletce jen jednou
        const radek = (nazev, pocet) => {
            uzVidet.add(UI.slug(nazev));
            return { title: nazev, href: naZakazku(nazev), pocet: pocet || 0 };
        };
        /** Otevřené úkoly po zakázkách, nejvíc nahoře; úkol bez zakázky
            nemá kam vést (je jen v Mých úkolech). */
        const poZakazkach = (seznam) => {
            const pocty = new Map();
            seznam.forEach(u => {
                const nazev = String(u.projekt || "").trim();
                if (nazev) pocty.set(nazev, (pocty.get(nazev) || 0) + 1);
            });
            return Array.from(pocty, ([nazev, pocet]) => ({ nazev, pocet }))
                .filter(z => !uzVidet.has(UI.slug(z.nazev)))
                .sort((a, b) => b.pocet - a.pocet || a.nazev.localeCompare(b.nazev, "cs"))
                .slice(0, MAX_ZAKAZEK_TYMU);
        };

        const moje = uid ? otevrene.filter(u => (u.prirazeni || []).indexOf(uid) !== -1) : [];
        const menu = [{ title: "MOJE ÚKOLY", href: "ukoly.html?moje=1", pocet: moje.length }];

        const mojeZakazky = poZakazkach(moje).map(z => radek(z.nazev, z.pocet));
        if (mojeZakazky.length) menu.push({ sekce: "Moje zakázky", polozky: mojeZakazky });

        /* Oblíbené v pořadí, jak je hvězdička seřadila; uzavřené ne.
           Počet otevřených úkolů jen u manažera – ten má (po najetí)
           načtené úkoly všech; zaměstnanci by číslo podle stránky
           jednou počítalo jen jeho úkoly a jindy všechny. */
        const manazer = UI.can("vykaz.view");
        const vsechPocet = (nazev) => otevrene.filter(u =>
            UI.slug(String(u.projekt || "").trim()) === UI.slug(nazev)).length;
        const oblibene = UI.oblibeneProjekty();
        const oblibeneProj = (KB.projektyDocs || [])
            .filter(p => !p.uzavreno && String(p.nazev || "").trim() &&
                oblibene.indexOf(p.id) !== -1 && !uzVidet.has(UI.slug(p.nazev)))
            .sort((a, b) => oblibene.indexOf(a.id) - oblibene.indexOf(b.id))
            .map(p => String(p.nazev).trim())
            .map(nazev => radek(nazev, manazer ? vsechPocet(nazev) : 0));
        if (oblibeneProj.length) menu.push({ sekce: "Oblíbené projekty", polozky: oblibeneProj });

        /* Dokud jsou načtené jen moje úkoly, vyjde tu prázdno (všechny
           zakázky jsou už výš) – oddíl se ukáže, až dorazí úkoly všech. */
        if (manazer) {
            const tym = poZakazkach(otevrene).map(z => radek(z.nazev, z.pocet));
            if (tym.length) menu.push({ sekce: "Úkoly týmu", polozky: tym });
        }

        menu.push({ title: "VŠECHNY PROJEKTY →", href: "ukoly.html?vse=1" });
        return menu;
    }

    /* Všechny úkoly si pás řekne jen u manažera a jen když najede na
       roletku úkolů (myš, Tab, ťuknutí). Odběr pak na stránce běží dál
       a roletka se dosype přes událost „ukoly". */
    let ukolyTymuChteny = false;
    function nactiUkolyTymu(event) {
        if (ukolyTymuChteny || !event.target || !event.target.closest ||
            !event.target.closest("[data-ukoly-menu]")) return;
        const KB = window.KB;
        if (!KB || !KB.watchUkoly || !KB.currentUid || !KB.currentUid() || !UI.can("vykaz.view")) return;
        ukolyTymuChteny = true;
        KB.watchUkoly();
    }
    ["mouseover", "focusin", "touchstart"].forEach(typ =>
        document.addEventListener(typ, nactiUkolyTymu, { passive: true }));

    /** Roletka PROJEKTŮ – otevřené projekty z databáze, nejdřív ty naléhavé. */
    /** Oblíbené projekty (hvězdička ve Správě) – sdílený klíč s ní. */
    /* ------------------------------------------------- peněžní pole ----
       Do rozpočtů se píšou statisíce a miliony a bez mezer se v nich nedá
       číst („6000000"). `type=number` mezery neumí, proto obyčejné textové
       pole, které se při psaní samo dělí po tisících. Čte se z něj přes
       `KBUI.penize(el)` – hodnota v poli je text s mezerami.
       (Přání Michala 1. 9. 2026.) */

    /** Číslo z peněžního pole – mezery i nedělitelné mezery pryč. */
    UI.penize = (el) => {
        if (!el) return 0;
        return Number(String(el.value || "").replace(/[\s\u00a0]/g, "")
            .replace(",", ".")) || 0;
    };

    /** Zapíše číslo do peněžního pole už rozdělené po tisících. */
    UI.nastavPenize = (el, hodnota) => {
        if (!el) return;
        const n = Number(hodnota) || 0;
        el.value = n ? UI.penizeText(n) : "";
    };

    UI.penizeText = (n) => String(Math.round(Number(n) || 0))
        .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

    /* Formátuje se při psaní a kurzor zůstává za stejnou číslicí, jinak by
       po každé mezeře uskočil na konec. */
    UI.formatujPenize = (el) => {
        const pred = String(el.value || "").slice(0, el.selectionStart || 0)
            .replace(/\D/g, "").length;
        const cifry = String(el.value || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
        const text = cifry ? UI.penizeText(cifry) : "";
        el.value = text;
        let i = 0, videno = 0;
        while (i < text.length && videno < pred) {
            if (text.charAt(i) >= "0" && text.charAt(i) <= "9") videno++;
            i++;
        }
        try { el.setSelectionRange(i, i); } catch (err) { }
    };

    document.addEventListener("input", (event) => {
        const el = event.target;
        if (el && el.matches && el.matches("[data-penize]")) UI.formatujPenize(el);
    });

    /* Oblíbené projekty jsou společné pro celou firmu – leží v číselníku
       zakázek. Starý seznam z prohlížeče slouží jen tomu, kdo si ještě
       nestihl načíst data (přání Michala 1. 9. 2026). */
    UI.oblibeneProjekty = () => {
        const z = window.KB && window.KB.oblibeneProjekty;
        if (Array.isArray(z)) return z;
        try { return JSON.parse(localStorage.getItem("kb-sprava-oblibene")) || []; }
        catch (err) { return []; }
    };

    /* Týdenní stav projektu – semafor + pár vět (rešerše 22). Leží v hlavičce
       projektu: `stavProjektu` = poslední zápis { kod, text, ms, uid, jmeno },
       `stavHistorie` = starší zápisy (KB.ulozStavProjektu). Kódy a názvy STEJNÉ
       jako v Apps Scriptu (STAVY_PROJEKTU_ v gas/Upozorneni.gs), barvy
       v app.css (.semafor--<kód>). */
    UI.STAVY_PROJEKTU = [
        { kod: "plan", nazev: "V plánu" },
        { kod: "riziko", nazev: "Hrozí skluz" },
        { kod: "skluz", nazev: "Skluz" },
        { kod: "pauza", nazev: "Pozastaveno" },
        { kod: "hotovo", nazev: "Hotovo" }
    ];
    /* Po kolika dnech bez aktualizace stav zešedne. Hotový, pozastavený
       a uzavřený projekt nezastarává – v pátek se mu ani nepřipomíná. */
    UI.STAV_ZASTARALY_DNI = 8;

    /** Jeden zápis stavu (poslední, nebo `zapis` z historie) k vykreslení,
     *  nebo null, když projekt stav nemá. */
    UI.stavProjektu = (p, zapis) => {
        const s = zapis || (p && p.stavProjektu);
        const druh = s && UI.STAVY_PROJEKTU.find(x => x.kod === s.kod);
        if (!druh) return null;
        const ms = Number(s.ms) || 0;
        const dni = ms ? Math.floor((Date.now() - ms) / 86400000) : 0;
        return {
            kod: druh.kod, nazev: druh.nazev, text: String(s.text || ""), ms: ms,
            jmeno: String(s.jmeno || ""), dni: dni,
            zastaraly: !zapis && !!ms && dni >= UI.STAV_ZASTARALY_DNI && !(p && p.uzavreno === true) &&
                druh.kod !== "hotovo" && druh.kod !== "pauza"
        };
    };

    /** Semafor jako HTML: tečka + název, s `jenTecka` jen tečka (Gantt,
     *  nástěnka) a název v bublině. Prázdno, když projekt stav nemá. */
    UI.semaforHtml = (p, jenTecka) => {
        const s = UI.stavProjektu(p);
        if (!s) return "";
        const popis = "Stav: " + s.nazev +
            (s.ms ? " · " + new Date(s.ms).toLocaleDateString("cs-CZ") : "") +
            (s.zastaraly ? " · stav zastaralý (" + s.dni + " dní bez aktualizace)" : "") +
            (s.text ? " – " + s.text : "");
        return '<span class="semafor semafor--' + esc(s.kod) + (s.zastaraly ? " semafor--zastaraly" : "") +
            (jenTecka ? ' semafor--tecka" role="img" aria-label="' + esc(popis) : "") +
            '" title="' + esc(popis) + '">' + (jenTecka ? "" : esc(s.nazev)) + "</span>";
    };

    function projektyMenu() {
        const dulezitost = { "resit-okamzite": 0, "vysoka": 1, "stredni": 2, "nizka": 3 };
        const oblibene = UI.oblibeneProjekty();
        const otevrene = ((window.KB && window.KB.projektyDocs) || [])
            .filter(p => !p.uzavreno)
            // oblíbené vždycky první, zbytek podle priority a názvu
            .sort((a, b) => (oblibene.indexOf(a.id) === -1) - (oblibene.indexOf(b.id) === -1)
                || (dulezitost[a.priorita] ?? 9) - (dulezitost[b.priorita] ?? 9)
                || (a.nazev || "").localeCompare(b.nazev || "", "cs"))
            .slice(0, 12)
            .map(p => ({
                title: ((p.cislo ? p.cislo + " " : "") + (p.nazev || "")).trim(),
                href: "sprava.html?id=" + encodeURIComponent(p.id)
            }));
        return otevrene.length
            ? [{ title: "SPRÁVA PROJEKTŮ", href: "sprava.html" }].concat(otevrene)
            : null;
    }

    /**
     * Roletka u MILNÍKŮ: rovnou nejbližší termíny, žádné další zanořování.
     * Splněné a milníky bez data se nepočítají – jde o to, co přijde na řadu.
     * Každý řádek je odkaz, takže se vykreslí tučně jako nadpis skupiny.
     */
    function milnikMenu() {
        const czDatum = (iso) => {
            const [, m, d] = iso.split("-");
            return d.replace(/^0/, "") + ". " + m.replace(/^0/, "") + ".";
        };
        const zkrat = (text, limit) => {
            const t = String(text || "").trim();
            return t.length > limit ? t.slice(0, limit - 1).trim() + "…" : t;
        };

        const nejblizsi = ((window.KB && window.KB.milniky) || [])
            .filter(m => m.datum && !m.hotovo)
            .sort((a, b) => a.datum.localeCompare(b.datum))
            .slice(0, 6)
            .map(m => ({
                title: czDatum(m.datum) + " · " + m.cinnost +
                       (m.napln ? " — " + zkrat(m.napln, 60) : ""),
                href: "milniky.html?zak=" + encodeURIComponent(UI.slug(m.zakazka || ""))
            }));

        return nejblizsi.length ? nejblizsi : null;
    }

    const menuOf = (item) => item.menu
        || (item.tasks ? taskMenu() : null)
        || (item.projekty ? projektyMenu() : null)
        || (item.milniky ? milnikMenu() : null);

    /* Odznak u POZNÁMEK: kolik konverzací má nepřečtenou zprávu. Počítá ho
       store z hlaviček konverzací (KB.poznNeprecteno, ztlumené se nepočítají),
       tady se jen kreslí – v liště i v pásu na telefonu. V liště se kreslí
       rovnou s počtem, ať po překreslení lišty (refreshNav) nezmizí. */
    const ODZNAK_POZN = "margin-left:6px;min-width:18px;height:18px;padding:0 5px;" +
        "border-radius:var(--r-pill);background:var(--danger);color:#fff;font-size:var(--fs-1);" +
        "font-weight:900;line-height:18px;letter-spacing:0;text-align:center;" +
        // bílý lem – na aktivní (cihlové) položce by červená splynula
        "box-shadow:0 0 0 2px var(--surface)";
    const pocetPoznamek = () => Number(window.KB && window.KB.poznNeprecteno) || 0;
    const jsouPoznamky = (href) => String(href || "").split(/[?#]/)[0] === "poznamky.html";
    const odznakPoznamek = (item) => {
        if (!item || !jsouPoznamky(item.href)) return "";
        const n = pocetPoznamek();
        return '<span data-pozn-pocet title="Konverzace s nepřečtenou zprávou" style="' + ODZNAK_POZN + '"' +
            (n ? "" : " hidden") + ">" + esc(n > 99 ? "99+" : String(n)) + "</span>";
    };
    function vypisOdznakPoznamek() {
        const n = pocetPoznamek();
        document.querySelectorAll("[data-pozn-pocet]").forEach(el => {
            el.textContent = n > 99 ? "99+" : String(n);
            el.hidden = !n;
        });
        srovnejSkupiny();
    }

    /**
     * Roletka u NÁVODŮ: svislý seznam kategorií pod sebou. Najetím myší na
     * řádek se rozbalí jeho obsah, kliknutím se přejde na danou sekci.
     */
    function navHtml(active) {
        const items = (window.KB_NAV || []).map((item, index) => {
            const isActive = active && item.href && item.href.split(/[?#]/)[0] === active;
            /* Podbarvení skupin: barva jde z KB_NAV (`barva`), text zůstává
               tmavý – jen aktivní položka se barvou zalije celá. */
            const cls = "navbtn" + (isActive ? " navbtn--active" : "") +
                (item.barva ? " navbtn--skup" : "");
            const tint = item.barva ? ' style="--skup:' + item.barva + '"' : "";
            const menu = menuOf(item);
            // položka s `need` se ukáže jen tomu, kdo na ni má právo
            const gate = (item.need ? ' data-need="' + item.need + '" hidden' : "") +
                (item.tasks ? " data-ukoly-menu" : "");

            if (!menu) {
                return '<div class="navitem"' + gate + '><a class="' + cls + '"' + tint +
                    ' href="' + item.href + '">' +
                    (item.icon ? icon(item.icon) : "") + item.title + odznakPoznamek(item) + "</a></div>";
            }

            /* Počet otevřených úkolů u řádku roletky (Úkoly & TO-DO). */
            const pocet = (n) => n ? '<span class="dropdown__pocet">' + esc(n) + "</span>" : "";
            const groups = menu.map(group => group.sekce
                /* oddíl = drobný popisek a pod ním řádky (zakázky u úkolů) */
                ? '<div class="dropdown__group dropdown__group--sekce">' +
                    '<span class="dropdown__sekce">' + esc(group.sekce) + "</span>" +
                    (group.polozky || []).map(p =>
                        '<a class="dropdown__radek" href="' + esc(p.href) + '">' +
                            '<span class="dropdown__radek-nazev">' + esc(p.title) + "</span>" +
                            pocet(p.pocet) + "</a>").join("") +
                  "</div>"
                : '<div class="dropdown__group">' +
                    /* Názvy v roletce chodí z databáze (zakázky u úkolů, náplň
                       milníků) a přejmenovat je smí kdokoliv přihlášený – bez
                       ošetření by si tudy šlo podstrčit skript do lišty, tedy
                       na každou stránku webu. */
                    (group.href
                        ? '<a class="dropdown__title" href="' + esc(group.href) + '">' + esc(group.title) +
                          pocet(group.pocet) +
                          ((group.children || []).length ? '<span class="dropdown__more">›</span>' : "") + "</a>"
                        : '<span class="dropdown__title">' + esc(group.title) + "</span>") +
                    ((group.children || []).length
                        ? '<div class="dropdown__sub"><div class="dropdown__subin">' +
                            group.children.map(child =>
                                '<a class="dropdown__link" href="' + esc(child.href) + '">' +
                                    esc(child.title) + "</a>").join("") +
                          "</div></div>"
                        : "") +
                "</div>"
            ).join("");

            // Položka s roletkou i vlastní stránkou je odkaz: najetím se roletka
            // rozbalí, kliknutím na název se přejde rovnou na tu stránku.
            const head = item.href
                ? '<a class="' + cls + '"' + tint + ' href="' + item.href + '" data-menu-toggle="' + index + '">' +
                      item.title + CARET + "</a>"
                : '<button type="button" class="' + cls + '"' + tint + ' data-menu-toggle="' + index + '">' +
                      item.title + CARET + "</button>";

            /* `gate` patří i sem: položka s roletkou ho dřív zahazovala,
               takže `need` fungovalo jen u položek bez roletky. */
            return '<div class="navitem" data-menu="' + index + '"' + gate + ">" + head +
                '<div class="dropdown">' + groups + "</div>" +
            "</div>";
        }).join("");

        return '<nav class="appbar__nav">' + items + "</nav>";
    }

    /**
     * Druhý řádek lišty. Stránky, které patří k sobě, ho mají stejný a liší se
     * jen zvýrazněnou položkou – jinak člověk po prokliku ztratí cestu zpátky
     * k sourozencům (přesně tohle vadilo u Vytížení týmu).
     *
     * @param {Array} polozky – [{ title, href, need }]
     * @param {string} aktivni – href té, na které zrovna jsme
     */
    UI.paintSubbar = (polozky, aktivni) => {
        const slot = document.getElementById("appSubbar");
        if (!slot) return;
        slot.innerHTML = '<div class="subbar__in"><div class="subbar__left">' +
            polozky.map(p => {
                const gate = p.need ? ' data-need="' + esc(p.need) + '" hidden' : "";
                return p.href === aktivni
                    ? '<span class="subbar__cat"' + gate + ">" + esc(p.title) + "</span>"
                    : '<a class="subbar__cat subbar__cat--up" href="' + esc(p.href) + '"' +
                      gate + ">" + esc(p.title) + "</a>";
            }).join("") +
        "</div></div>";
        // odkazy vznikly až teď, práva se na nich musí dorovnat
        UI.paintUser();
    };

    /** Podlišta projektů – seznam, plán a správa patří k sobě. */
    /* Seznam projektů tu byl zdvojený se Správou – jeden projekt se vyplňoval
       na dvou místech. Zůstala Správa, kde je všechno pohromadě. */
    UI.PODLISTA_PROJEKTY = [
        { title: "SPRÁVA PROJEKTŮ", href: "sprava.html", need: "vykaz.view" },
        { title: "PLÁN PROJEKTŮ", href: "gantt.html", need: "vykaz.view" },
        { title: "SPRÁVA ZAMĚSTNANCŮ", href: "zamestnanci.html", need: "vykaz.view" },
        { title: "SPRÁVA FIREM", href: "firmy.html", need: "vykaz.view" }
    ];
    /* FAKTURY byly v podliště projektů – od 22. 9. 2026 jsou v levém pásu
       vedle Pokladny (přání Michala: mimo projekty, jen manažeři a asistentka). */

    /** Nástroje vpravo nad lištou – vidět je ikona, popis vyjede po najetí. */
    function toolsHtml() {
        const tools = (window.KB_TOOLS || []).map(tool => {
            const inner = icon(tool.icon) + "<span>" + tool.title + "</span>";
            // nástroj s `need` se ukáže jen tomu, kdo na něj má právo
            // bez práva se ikona neukáže vůbec; bez přihlášení žádná z nich
            const gate = tool.need ? ' data-need="' + tool.need + '" hidden'
                                   : ' data-jen-prihlaseny hidden';
            return tool.action
                ? '<button type="button" class="toolbtn" data-action="' + tool.action + '"' + gate +
                  ' title="' + tool.title + '">' + inner + "</button>"
                : '<a class="toolbtn" href="' + tool.href + '"' + gate +
                  ' title="' + tool.title + '">' + inner + "</a>";
        }).join("");
        return '<div class="toolrail">' + tools + "</div>";
    }

    /* Na kterých stránkách má hledání smysl.
       Jinde v liště jen viselo a po Enteru odskočilo do návodů – vypadalo to,
       že hledá v tom, na co se člověk zrovna dívá, a přitom nehledalo nic.
       Návody: hledá v nich. Výkazy: filtrují si vlastní tabulku (UI.onSearch). */
    const STRANKY_S_HLEDANIM = [
        "index.html", "navody.html", "navod.html", "uvod.html",
        "vykazy.html", "vykazy-prehled.html"
    ];

    const maHledani = (active) => STRANKY_S_HLEDANIM.indexOf(active) !== -1;

    function searchHtml(active) {
        if (!maHledani(active)) return "";
        // výkazy si pole berou na filtrování své tabulky, návody hledají návody
        const vykazy = active.indexOf("vykazy") === 0;
        const popis = vykazy ? "Filtrovat výkazy…" : "Hledat v návodech…";
        return '<div class="searchbox">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>' +
            '<input id="kbSearch" type="search" autocomplete="off" placeholder="' + popis +
                '" aria-label="' + popis + '">' +
            '<div class="searchbox__vysledky" id="kbSearchOut" hidden></div>' +
        "</div>";
    }

    /**
     * Vykreslí hlavičku do prvku #appHeader.
     * Nahoře vpravo přihlášený uživatel, pod ním vycentrované logo
     * (vpravo od něj ikony nástrojů) a úplně dole navigační lišta.
     * @param {Object} options – { active: "navody.html", big: true, subbar: true }
     */
    /* Instalace na plochu. Manifest sám nestačí – Chrome na Androidu
       nabídne „Instalovat aplikaci" (a udělá skutečnou ikonu, ne jen
       zástupce) až když stránka má service worker. Ten náš nic necachuje,
       je tam jen kvůli téhle podmínce. (Michal 2. 9. 2026.) */
    /* Červená lišta, když web nedostane data z databáze (22. 9. 2026).
       Nese i prohlížeč a zařízení – z fotky hlášky se pak dá poznat, kde
       je problém, i když u toho nikdo nemá konzoli. */
    function popisProhlizece() {
        const ua = navigator.userAgent || "";
        const verze = (ua.match(/Version\/([\d.]+)/) || [])[1] || "";
        const prohlizec = /Edg\//.test(ua) ? "Edge"
            : /CriOS|Chrome\//.test(ua) ? "Chrome"
            : /FxiOS|Firefox\//.test(ua) ? "Firefox"
            : /Safari\//.test(ua) ? "Safari" + (verze ? " " + verze : "") : "prohlížeč";
        const zarizeni = /iPhone/.test(ua) ? "iPhone"
            : (/iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua))) ? "iPad"
            : /Mac/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android"
            : /Windows/.test(ua) ? "Windows" : "";
        return [prohlizec, zarizeni, window.KB && window.KB.webkitObchvat ? "režim WebKit" : ""]
            .filter(Boolean).join(" · ");
    }

    function ukazChybuDat(zprava) {
        let lista = document.getElementById("kbDataChyba");
        if (!zprava) { if (lista) lista.hidden = true; return; }
        if (!lista) {
            lista = document.createElement("div");
            lista.id = "kbDataChyba";
            lista.className = "datachyba no-print";
            lista.setAttribute("role", "alert");
            document.body.appendChild(lista);
            lista.addEventListener("click", (event) => {
                if (event.target.closest("[data-datachyba-zavri]")) lista.hidden = true;
            });
        }
        lista.innerHTML = "<b>Web nedostal data z databáze.</b> " + esc(zprava) +
            " Zkus stránku obnovit; když to nepomůže, pošli správci fotku téhle lišty." +
            '<span class="datachyba__info">' + esc(popisProhlizece()) + "</span>" +
            '<button type="button" class="linkbtn datachyba__zavri" data-datachyba-zavri>Skrýt</button>';
        lista.hidden = false;
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (!window.KB || !window.KB.on) return;
        window.KB.on("data-chyba", (event) => ukazChybuDat(event.detail));
        if (window.KB.dataChyba) ukazChybuDat(window.KB.dataChyba);
    });

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("sw.js")
                .catch(err => console.warn("Service worker se nezaregistroval:", err));
        });
    }

    /* Bez signálu (v terénu, rešerše bod 29): stránku podá service worker
       z mezipaměti (sw.js), data Firestore ze své. Proužek pod lištou řekne,
       že je to stav z posledního připojení. Bez trvalé fronty zápisů
       (Safari – store.js, KB.offlineFronta) se změny neuchovají, řekne to taky. */
    function prouzekBezSignalu() {
        let el = document.getElementById("kbBezSignalu");
        if (navigator.onLine !== false) { if (el) el.hidden = true; return; }
        if (!el) {
            el = document.createElement("div");
            el.id = "kbBezSignalu";
            el.className = "bezsignalu no-print";
            el.setAttribute("role", "status");
            const lista = document.querySelector(".appbar, #appHeader");
            if (lista) lista.after(el); else document.body.prepend(el);
        }
        el.textContent = window.KB && window.KB.offlineFronta
            ? "Bez signálu – ukazuje se, co bylo naposledy načtené; změny se uloží po připojení."
            : "Bez signálu – v tomhle prohlížeči se data ani změny bez připojení neuchovají; počkej na signál.";
        el.hidden = false;
    }
    window.addEventListener("online", prouzekBezSignalu);
    window.addEventListener("offline", prouzekBezSignalu);
    document.addEventListener("DOMContentLoaded", prouzekBezSignalu);

    /* Instalace webu jako aplikace (Michal 21. 10. 2026: ikonu instalace
       v adresním řádku Chrome neukazoval a z mini okna se nic nestalo).
       Když prohlížeč instalaci nabídnout umí, pošle `beforeinstallprompt` –
       schová se a tlačítko „Nainstalovat aplikaci" v pásu ho vyvolá.
       Bez něj (už nainstalováno, Safari, Firefox) ukáže tlačítko návod.
       V okně nainstalované aplikace je tlačítko schované (app.css). */
    let pozvankaInstalace = null;
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        pozvankaInstalace = event;
    });
    window.addEventListener("appinstalled", () => {
        pozvankaInstalace = null;
        UI.toast("Aplikace je nainstalovaná – najdeš ji v nabídce Start jako Pasport Kaňa.", "ok");
    });
    UI.nainstalujAplikaci = async () => {
        if (pozvankaInstalace) {
            const pozvanka = pozvankaInstalace;
            pozvankaInstalace = null;        // jde použít jen jednou
            try { await pozvanka.prompt(); } catch (err) { console.warn("Instalace se nespustila:", err); }
            return;
        }
        const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
        await UI.potvrd({
            nadpis: "Nainstalovat aplikaci",
            text: iphone
                ? "V Safari dej Sdílet (čtvereček se šipkou) → Přidat na plochu."
                : "Prohlížeč teď instalaci sám nenabídl – buď už aplikaci máš (hledej Pasport Kaňa v nabídce Start), " +
                  "nebo ji přidej ručně:\n\n" +
                  "Chrome: ⋮ vpravo nahoře → Odeslat, uložit a sdílet → Nainstalovat stránku jako aplikaci…\n" +
                  "Edge: ⋯ → Aplikace → Nainstalovat tento web jako aplikaci\n\n" +
                  "Pak pravým tlačítkem na ikoně na hlavním panelu → Připnout. Tamtéž najdeš Mini okno.",
            ano: "Rozumím",
            ne: "Zavřít"
        });
    };

    UI.mountNav = (options = {}) => {
        const slot = document.getElementById("appHeader");
        if (!slot) return;

        const active = options.active || location.pathname.split("/").pop() || "index.html";

        lastNav = options;

        slot.outerHTML =
            '<header class="appbar no-print' + (options.big ? " appbar--big" : "") + '">' +
                // červený pruh: uživatel vpravo nahoře, logo uprostřed,
                // ikony nástrojů vpravo dole – tedy přímo nad lištou
                '<div class="appbar__band"><div class="appbar__bandin">' +
                    /* hamburger: na dotyku a v úzkém okně vysouvá svislý pás,
                       který je tam jinak schovaný za okrajem obrazovky */
                    '<button type="button" class="appbar__burger no-print" data-pas-burger ' +
                        'aria-label="Otevřít panel akcí" aria-controls="kbPas" aria-expanded="false">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">' +
                            '<path stroke-linecap="round" stroke-width="2.2" d="M4 6h16M4 12h16M4 18h16"/></svg>' +
                    "</button>" +
                    // vlevo nahoře přepínač náhledu – vykreslí se jen hlavnímu
                    // správci, ostatním zůstane skrytý (paintUser). Obal
                    // (display: contents) se na telefonu stěhuje do pásu
                    // i s tím, co k přepínači přidá stránka (nástěnka:
                    // Základní / Manažerská) – placeNahled.
                    '<div class="appbar__vlevo" data-nahled-slot>' +
                    '<label class="appbar__nahled" data-nahled-box hidden>' +
                        '<span>Zobrazit jako</span>' +
                        '<select data-nahled>' +
                            /* 4. pád, protože se to čte jako „zobrazit jako koho" */
                            '<option value="">hlavního správce</option>' +
                            '<option value="spravce">manažera</option>' +
                            '<option value="zamestnanec">zaměstnance</option>' +
                            '<option value="student">studenta</option>' +
                        "</select>" +
                    "</label>" +
                    "</div>" +
                    // barvy webu jsou jen mezi ikonami nástrojů a jen pro
                    // hlavního správce – v pruhu je to zbytečně na očích
                    // stav synchronizace se ukazuje dole ve svislém pásu;
                    // tady zůstává jen přihlášení, úplně vpravo
                    '<div class="appbar__userbox">' +
                        '<div class="appbar__user" data-userbox></div>' +
                    "</div>" +
                    '<a class="appbar__logo" href="index.html" aria-label="Domů">' +
                        // na telefonu značka a nápis vedle sebe, stejně jako v pásu
                        '<picture><source media="(max-width: 600px)" srcset="assets/logo-pas.png">' +
                        '<img src="Pasport_Kana_white.png" alt="Pasport Kaňa"></picture>' +
                    "</a>" +
                    toolsHtml() +
                "</div></div>" +

                '<div class="appbar__bar"><div class="appbar__barin">' +
                    navHtml(active) +
                    searchHtml(active) +
                "</div></div>" +

                // druhý řádek lišty – stránka si ho naplní sama (filtry kategorie)
                (options.subbar ? '<div class="appbar__sub" id="appSubbar"></div>' : "") +
            "</header>";

        bindNav();
        bindHeader();
        bindSearch();
        mountRail();
        mountSpodniLista();
        placeSearch();
        placeNahled();
        UI.paintUser();
        UI.bindCloudStatus("[data-cloud-status]");
        stickyOffset();
        mountToTop();
        mountQuickPanel();
        pozadejOData();
        renderMujDen();
        renderQuick();

        // roletky se plní z databáze – po doručení dat se lišta překreslí
        if (window.KB) {
            window.KB.on("tasks", refreshNav);
            window.KB.on("ukoly", () => { refreshNav(); renderMujDen(); });
            window.KB.on("projekty-docs", refreshNav);
            // oblíbené projekty v roletce úkolů leží v číselníku zakázek
            window.KB.on("zakazky", refreshNav);
            window.KB.on("milniky", refreshNav);
            window.KB.on("vykazy", () => { renderMujDen();
                /* hlídka smí rozhodnout až nad skutečnými záznamy – emit
                   umí vyvolat i odběr částek dřív, než záznamy dorazí */
                if (window.KB.vykazyPrisly) {
                    hlidkaPrislo.vykazy = true; hlidkaVykazu(); hlidkaDopredu();
                }
                dopocitejCastky(); });
            /* Panel se překresluje taky – byl navázaný jen pás, takže nový
               vzkaz (i vlastní poznámka) se v otevřeném panelu objevil až
               po jeho zavření a otevření. */
            window.KB.on("quicktodo", () => { renderMujDen(); renderQuick();
                hlidkaPrislo.quick = true; hlidkaVykazu(); hlidkaDopredu();
                hlidkaAkci(); });
            // připomenutí akcí se přepočítá i s příchodem kalendáře
            window.KB.on("kalendar", hlidkaAkci);
            window.KB.on("users", () => { pozadejOData(); renderMujDen(); renderQuick(); });
            window.KB.on("auta", renderAuta);
            window.KB.on("pozn-neprecteno", vypisOdznakPoznamek);
        }
        // roletka úkolů je pro manažera jiná (Úkoly týmu) – po změně role / náhledu znovu
        document.addEventListener("kb-role", () => { pozadejOData(); renderMujDen(); renderQuick(); refreshNav(); });
    };

    /** Překreslí navigaci (obsah roletek se bere z databáze). Roletka
        otevřená ťuknutím zůstane otevřená – data se do ní dosypávají
        i ve chvíli, kdy na ni člověk kouká (úkoly týmu u manažera). */
    function refreshNav() {
        const active = lastNav.active || location.pathname.split("/").pop() || "index.html";
        const nav = document.querySelector(".appbar__nav");
        if (!nav) return;
        const otevrena = nav.querySelector(".navitem.is-open[data-menu]");
        const index = otevrena ? String(otevrena.dataset.menu).replace(/\D/g, "") : "";
        nav.outerHTML = navHtml(active);
        bindNav();
        if (index) {
            const znovu = document.querySelector('.appbar__nav .navitem[data-menu="' + index + '"]');
            if (znovu) znovu.classList.add("is-open");
        }
        UI.paintUser();
    }

    /* ------------------------------------------------------- svislý pás ---
       Logo (klik = domů), hledání a rychlé akce – jako v Caflou. Vykresluje
       se na každé stránce; na úzkém okně a na dotyku ho CSS schová za
       levý okraj a vysouvá se třemi čárkami (na telefonu i „Menu" dole).

       Pás po skupinách (20. 10. 2026). Starý pás byl vysoký 1 284–1 353 px
       a na 1080p i 1440 × 900 byl „Nový výkaz", Nastavení i Odhlásit pod
       okrajem obrazovky. Michal: „dal to klidně do nějakých skupinek, aby
       nepotřeboval být rolovatelný … kliknout a vyjede mi ikonka stránek,
       co jsou v té skupince". Proto:
         nahoře  logo, hledání (jen kde je), + Nový výkaz, zkrácené Stats,
         střed   skupiny – klik vysune jejich stránky; každá zůstane
                 otevřená nebo zavřená, jak ji člověk nechal, a pás si to
                 pamatuje (každý prohlížeč zvlášť, telefon zvlášť od PC),
         dole    jméno, role, Odhlásit a stav spojení.
       Práva nesou položky samy (`need` = data-need, jinak jen přihlášený –
       stejné jako dřív); skupina, ve které nic nezbude, se neukáže
       (srovnejSkupiny). Odznak Quick TO-DO se na zavřené skupině ukáže jako
       součet. Když se pás do okna nevejde (víc otevřených skupin, nízké
       okno), roluje se jen prostřední část se skupinami – logo, Nový
       výkaz a Odhlásit zůstanou vždy vidět. */

    const TELEFON = "(max-width: 600px)";
    const jeTelefon = () => window.matchMedia(TELEFON).matches;

    const cesta = (d) => '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + d + '"/>';
    /* Ikony, které v KB_ICONS (taxonomy.js) nejsou – stejný obrysový styl. */
    const IKONY_PASU = {
        slunce: cesta("M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"),
        zvonek: cesta("M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"),
        bublina: cesta("M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"),
        penize: cesta("M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"),
        kufr: cesta("M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"),
        blesk: cesta("M13 10V3L4 14h7v7l9-11h-7z"),
        okno: cesta("M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"),
        stahnout: cesta("M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4"),
        foto: cesta("M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z") +
              cesta("M15 13a3 3 0 11-6 0 3 3 0 016 0z"),
        mrizka: cesta("M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"),
        menu: cesta("M4 6h16M4 12h16M4 18h16"),
        sipka: cesta("M19 9l-7 7-7-7"),
        pozn: cesta("M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"),
        // přístroj na stativu (Vybavení)
        stativ: cesta("M9 6a3 3 0 106 0 3 3 0 00-6 0zM12 9v4m0 0l-6 8m6-8l6 8m-6-8v8")
    };
    const ikonaPasu = (nazev, trida) => '<svg' + (trida ? ' class="' + trida + '"' : "") +
        ' fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">' +
        (IKONY_PASU[nazev] || (window.KB_ICONS || {})[nazev] || "") + "</svg>";

    /* Co je v které skupině. `attr` = tlačítko, které otevírá panel nebo
       okno (posluchače jsou navěšené na dokumentu, takže fungují i ve
       sbalené skupině), `need` = právo, bez něj „jen přihlášený". */
    const SKUPINY_PASU = [
        { id: "den", nazev: "Můj den", ikona: "slunce", polozky: [
            { nazev: "Moje úkoly", ikona: "tasks", href: "ukoly.html?moje=1" },
            { nazev: "Quick TO-DO", ikona: "blesk", attr: "data-quick-otevri", odznak: "data-quick-pocet",
              popis: "Napsat vzkaz – kolik vzkazů na tebe čeká, ukazuje číslo" },
            { nazev: "Rychlý zápis", ikona: "calendar", attr: "data-ho-otevri",
              popis: "Home office, volno, dovolená a doktor na pár kliknutí" },
            { nazev: "Postup dne", ikona: "scan", href: "postup.html" },
            { nazev: "Mini okno", ikona: "okno", attr: "data-mini-okno", need: "vykaz.otevrit",
              popis: "Rychlý zápis hodin v malém okně (Alt+Shift+M)" }
        ] },
        { id: "tym", nazev: "Lidé a komunikace", ikona: "users", polozky: [
            { nazev: "Porady", ikona: "bublina", href: "porady.html" },
            { nazev: "Správa aut", ikona: "car", attr: "data-auta-otevri" },
            { nazev: "Vybavení", ikona: "stativ", attr: "data-vybaveni-otevri",
              popis: "Rezervace přístrojů – kdo má který přístroj a kdy" }
        ] },
        { id: "zakazky", nazev: "Zakázky", ikona: "kufr", polozky: [
            { nazev: "Seznam zakázek", ikona: "building", href: "zakazky.html" },
            // zakládání projektů je manažerská práce
            { nazev: "Nový projekt", ikona: "plus", href: "sprava.html#novy", need: "zakazky.manage" }
        ] },
        /* jen hlavní správce, majitel a asistentka (finance.view) */
        { id: "penize", nazev: "Peníze", ikona: "penize", polozky: [
            { nazev: "Faktury", ikona: "receipt", href: "faktury.html", need: "finance.view" },
            { nazev: "Pokladna", ikona: "penize", href: "pokladna.html", need: "finance.view" }
        ] },
        { id: "nastaveni", nazev: "Nastavení a nápověda", ikona: "cog", polozky: [
            { nazev: "Nastavení", ikona: "cog", href: "nastaveni.html", need: "vykaz.view" },
            // co komu chodí na e-mail – osobní nastavení
            { nazev: "Upozornění", ikona: "zvonek", href: "upozorneni.html" },
            { nazev: "Jak web používat", ikona: "library", href: "prirucka.html" },
            { nazev: "Stáhnout aplikaci", ikona: "stahnout", attr: "data-instalace",
              popis: "Web jako aplikace ve vlastním okně – na ikoně pak Mini okno, Nový výkaz a další" }
        ] }
    ];

    /* Na telefonu je horní lišta schovaná (dvanáct položek v pěti řádcích
       zabíralo půl obrazovky) – její stránky jsou proto v pásu jako první
       skupina. Na PC ji CSS neukazuje, tam je lišta nahoře. */
    const IKONY_STRANEK = {
        "vykazy.html": "clock", "ukoly.html": "tasks", "quicktodo.html": "blesk",
        "kalendar.html": "calendar", "milniky.html": "flag", "navody.html": "library",
        "poznamky.html": "pozn", "plany.html": "map", "fotky-bph.html": "foto",
        "tabule.html": "board", "sprava.html": "building", "reporty.html": "chart"
    };
    const nazevStranky = (titulek) => {
        const s = String(titulek || "").toLowerCase();
        return (s.charAt(0).toUpperCase() + s.slice(1))
            .replace(/to-do/g, "TO-DO").replace(/\bbph\b/g, "BPH");
    };
    const skupinaStranek = () => ({
        id: "stranky", nazev: "Stránky webu", ikona: "mrizka", jenTelefon: true,
        polozky: (window.KB_NAV || []).filter(p => p.href).map(p => ({
            nazev: nazevStranky(p.title), href: p.href, need: p.need || "",
            ikona: IKONY_STRANEK[p.href.split(/[?#]/)[0]] || p.icon || "mrizka",
            odznak: jsouPoznamky(p.href) ? "data-pozn-pocet" : "",
            verejne: !p.need          // jako v liště: bez práva je vidí každý
        }))
    });

    /** Je odkaz stránka, na které právě jsme? Odkaz s # je akce (Nový projekt). */
    function jeAktivniOdkaz(href) {
        if (!href || href.indexOf("#") !== -1) return false;
        const [soubor, dotaz] = href.split("?");
        const ted = lastNav.active || location.pathname.split("/").pop() || "index.html";
        if (soubor !== ted) return false;
        if (!dotaz) return true;
        const ma = new URLSearchParams(location.search);
        return Array.from(new URLSearchParams(dotaz)).every(([k, v]) => ma.get(k) === v);
    }

    function polozkaPasu(p) {
        const gate = p.need ? ' data-need="' + esc(p.need) + '" hidden'
            : (p.verejne ? "" : " data-jen-prihlaseny hidden");
        const popis = p.popis ? ' title="' + esc(p.popis) + '"' : "";
        const vnitrek = ikonaPasu(p.ikona) + '<span class="passkup__text">' + esc(p.nazev) + "</span>" +
            (p.odznak ? '<span class="siderail__odznak" ' + p.odznak + " hidden></span>" : "");
        if (!p.href) {
            return '<button type="button" class="passkup__polozka" ' + p.attr + gate + popis + ">" +
                vnitrek + "</button>";
        }
        const aktivni = jeAktivniOdkaz(p.href);
        return '<a class="passkup__polozka' + (aktivni ? " je-aktivni" : "") + '" href="' + esc(p.href) + '"' +
            (aktivni ? ' aria-current="page"' : "") + gate + popis + ">" + vnitrek + "</a>";
    }

    function skupinaPasu(s) {
        const id = "kbSkup-" + s.id;
        const aktivni = s.polozky.some(p => jeAktivniOdkaz(p.href));
        return '<div class="passkup' + (s.jenTelefon ? " passkup--telefon" : "") +
                (aktivni ? " passkup--aktivni" : "") + '" data-skupina="' + esc(s.id) + '">' +
            '<button type="button" class="passkup__hlava" id="' + id + '-hlava" aria-expanded="false"' +
                ' aria-controls="' + id + '" data-skupina-prepni="' + esc(s.id) + '">' +
                ikonaPasu(s.ikona) + '<span class="passkup__nazev">' + esc(s.nazev) + "</span>" +
                // součet odznaků, dokud je skupina zavřená (jinak je vidět u položky)
                '<span class="siderail__odznak passkup__soucet" data-skupina-soucet hidden' +
                    ' title="Nesplněné vzkazy v Quick TO-DO"></span>' +
                ikonaPasu("sipka", "passkup__sipka") +
            "</button>" +
            '<div class="passkup__polozky" id="' + id + '" role="group" aria-labelledby="' + id + '-hlava" hidden>' +
                s.polozky.map(polozkaPasu).join("") +
            "</div>" +
        "</div>";
    }

    /* Které skupiny jsou otevřené – každá zvlášť (Michal 20. 10. 2026:
       „pokud si v levém pásu rozkliknu nějakou skupinu, tak ať je klidně
       rozkliknutá"; dřív otevření jedné zavřelo ostatní). Pamatuje se
       v prohlížeči jako { id: true/false } jen u skupin, na které člověk
       klikl (volba vzhledu, odhlášení ji nemaže); telefon má vlastní
       klíč. Skupina, na kterou ještě nesáhl, je otevřená, když je výchozí
       (na PC „Můj den", na telefonu „Stránky webu") nebo když je v ní
       stránka, na které je. Starý klíč kb-pas-skupina (jedna otevřená
       skupina nebo „-" = všechny zavřené) se při prvním čtení převede. */
    const SKUPINY_KEY = "kb-pas-skupiny";
    const STARY_SKUPINA_KEY = "kb-pas-skupina";
    const priponaKlice = () => (jeTelefon() ? "-telefon" : "");
    const idSkupin = () => Array.from(document.querySelectorAll(".siderail [data-skupina]"))
        .map(sk => sk.dataset.skupina);

    function ulozSkupiny(stav) {
        try { localStorage.setItem(SKUPINY_KEY + priponaKlice(), JSON.stringify(stav)); }
        catch (err) { /* soukromý režim – zůstane jen do obnovení stránky */ }
    }

    function nactiSkupiny() {
        let ulozeno = null;
        try { ulozeno = JSON.parse(localStorage.getItem(SKUPINY_KEY + priponaKlice()) || "null"); }
        catch (err) { ulozeno = null; }
        if (ulozeno && typeof ulozeno === "object" && !Array.isArray(ulozeno)) {
            // z prohlížeče jen skupiny, které v pásu jsou, a jen ano/ne
            const stav = {};
            idSkupin().forEach(id => { if (typeof ulozeno[id] === "boolean") stav[id] = ulozeno[id]; });
            return stav;
        }
        let stary = null;
        try { stary = localStorage.getItem(STARY_SKUPINA_KEY + priponaKlice()); } catch (err) { /* soukromý režim */ }
        if (stary === null) return {};
        const stav = {};
        const id = String(stary).replace(/[^a-z]/g, "");
        if (stary === "-") idSkupin().forEach(sk => { stav[sk] = false; });
        else if (id && idSkupin().indexOf(id) !== -1) stav[id] = true;
        ulozSkupiny(stav);
        try { localStorage.removeItem(STARY_SKUPINA_KEY + priponaKlice()); } catch (err) { /* nevadí */ }
        return stav;
    }

    /** Výslovná volba vyhrává; jinak výchozí skupina a skupina otevřené stránky. */
    function maBytOtevrena(sk, stav) {
        const id = sk.dataset.skupina;
        if (typeof stav[id] === "boolean") return stav[id];
        if (id === (jeTelefon() ? "stranky" : "den")) return true;
        return sk.classList.contains("passkup--aktivni") && !sk.classList.contains("passkup--telefon");
    }

    function nastavSkupinu(sk, otevrit) {
        const hlava = sk.querySelector("[data-skupina-prepni]");
        const polozky = sk.querySelector(".passkup__polozky");
        if (hlava) hlava.setAttribute("aria-expanded", String(otevrit));
        if (polozky) polozky.hidden = !otevrit;
        sk.classList.toggle("je-otevrena", otevrit);
    }

    /** Rozloží skupiny podle zapamatovaného stavu – po postavení pásu a při
        přechodu mezi šířkou telefonu a PC (každá má svůj klíč). */
    function rozlozSkupiny() {
        const stav = nactiSkupiny();
        document.querySelectorAll(".siderail [data-skupina]").forEach(sk =>
            nastavSkupinu(sk, maBytOtevrena(sk, stav)));
        srovnejSkupiny();
    }

    /** Střed pásu roluje – když pod spodním krajem ještě něco je, kraj se
        rozplyne. Bez toho to na telefonu (bez posuvníku) vypadalo, že
        seznam končí a další skupiny zmizely. */
    function oznacDalsiSkupiny() {
        const sk = document.querySelector(".siderail__skupiny");
        if (sk) sk.classList.toggle("ma-dalsi", sk.scrollTop + sk.clientHeight < sk.scrollHeight - 2);
    }

    /** Prázdné skupiny pryč, součty odznaků na zavřených skupinách. Volá se
        po každém přepočtu práv (paintUser) a po novém počtu vzkazů. */
    function srovnejSkupiny() {
        // paintUser běží i dřív, než mountNav pás postaví – pak není co srovnávat
        if (!document.querySelector(".siderail")) return;
        document.querySelectorAll(".siderail [data-skupina]").forEach(sk => {
            const polozky = Array.from(sk.querySelectorAll(".passkup__polozka")).filter(p => !p.hidden);
            sk.hidden = !polozky.length;
            const soucet = polozky.reduce((s, p) => {
                const o = p.querySelector(".siderail__odznak");
                return s + (o && !o.hidden ? (Number(o.textContent) || 0) : 0);
            }, 0);
            const el = sk.querySelector("[data-skupina-soucet]");
            if (el) {
                el.textContent = soucet;
                el.hidden = !soucet || sk.classList.contains("je-otevrena");
            }
        });
        oznacDalsiSkupiny();
    }

    /* Klik na hlavičku přepne jen tu jednu skupinu; ostatní zůstanou, jak jsou. */
    document.addEventListener("click", (event) => {
        const hlava = event.target.closest && event.target.closest("[data-skupina-prepni]");
        const sk = hlava && hlava.closest(".siderail [data-skupina]");
        if (!sk) return;
        const otevrit = hlava.getAttribute("aria-expanded") !== "true";
        nastavSkupinu(sk, otevrit);
        const stav = nactiSkupiny();
        stav[sk.dataset.skupina] = otevrit;
        ulozSkupiny(stav);
        srovnejSkupiny();
    });

    function mountRail() {
        if (document.querySelector(".siderail")) return;
        const rail = document.createElement("aside");
        rail.className = "siderail no-print";
        rail.id = "kbPas";
        rail.setAttribute("aria-label", "Panel akcí");
        rail.innerHTML =
            /* Logo vedle sebe: vlevo značka, vpravo PASPORT / Kaňa zarovnané
               doleva (Michal 20. 10. 2026). Obrázek je složený z dílů
               původního loga – stejné písmo (assets/logo-pas.png). */
            '<a class="siderail__logo" href="index.html" aria-label="Domů">' +
                '<img src="assets/logo-pas.png" alt="Pasport Kaňa" width="534" height="120"></a>' +
            '<div data-rail-search></div>' +
            // hlavní akce dne – vždy nahoře pod logem, nikdy pod okrajem
            '<a class="siderail__btn siderail__btn--hlavni" href="vykazy.html#novy"' +
                ' data-need="vykaz.otevrit" hidden>' +
                icon("plus") + "<span>Nový výkaz</span></a>" +
            // STATS – osobní stav, ne kopie lišty (viz komentář u renderMujDen)
            '<div class="siderail__mujden" data-rail-mujden hidden></div>' +
            '<nav class="siderail__skupiny" aria-label="Stránky a akce po skupinách">' +
                [skupinaStranek()].concat(SKUPINY_PASU).map(skupinaPasu).join("") +
            "</nav>" +
            '<div class="siderail__spodek">' +
                // na telefonu sem přistěhuje placeNahled přepínač „Zobrazit jako"
                '<div class="siderail__nahled" data-rail-nahled></div>' +
                '<div class="siderail__ja" data-rail-ja></div>' +
                '<div class="siderail__stav" data-cloud-status>Připojuji…</div>' +
            "</div>";
        document.body.insertBefore(rail, document.body.firstChild);
        rozlozSkupiny();
        // rozplynutý kraj středu: při rolování i při změně jeho výšky (okno, Stats)
        const stred = rail.querySelector(".siderail__skupiny");
        stred.addEventListener("scroll", oznacDalsiSkupiny, { passive: true });
        if (window.ResizeObserver) new ResizeObserver(oznacDalsiSkupiny).observe(stred);
        else window.addEventListener("resize", oznacDalsiSkupiny);
    }

    /* ------------------------------------------- spodní lišta (telefon) ---
       Do 600 px: pět nejčastějších cílů na palec – Domů, Výkazy, Úkoly,
       Quick TO-DO (s odznakem) a Menu, které vysune pás. Na PC ji CSS
       nevykreslí vůbec. Práva jako všude (data-need / jen přihlášený). */
    function mountSpodniLista() {
        if (document.querySelector(".spodnilista")) return;
        // `celyNazev` – když se popisek do pětiny šířky telefonu nevejde celý
        const odkaz = (href, ikona, nazev, gate, navic, celyNazev) => {
            const aktivni = jeAktivniOdkaz(href);
            return '<a class="spodnilista__btn" href="' + href + '"' + gate +
                (celyNazev ? ' aria-label="' + esc(celyNazev) + '" title="' + esc(celyNazev) + '"' : "") +
                (aktivni ? ' aria-current="page"' : "") + ">" +
                ikonaPasu(ikona) + "<span>" + esc(nazev) + "</span>" + (navic || "") + "</a>";
        };
        const lista = document.createElement("nav");
        lista.className = "spodnilista no-print";
        lista.setAttribute("aria-label", "Hlavní stránky");
        lista.innerHTML =
            odkaz("index.html", "home", "Domů", "") +
            odkaz("vykazy.html", "clock", "Výkazy", ' data-need="vykaz.otevrit" hidden') +
            odkaz("ukoly.html", "tasks", "Úkoly", " data-jen-prihlaseny hidden") +
            odkaz("quicktodo.html", "blesk", "Quick", " data-jen-prihlaseny hidden",
                '<span class="spodnilista__odznak" data-quick-pocet hidden></span>', "Quick TO-DO") +
            '<button type="button" class="spodnilista__btn" data-pas-burger aria-controls="kbPas"' +
                ' aria-expanded="false">' + ikonaPasu("menu") + "<span>Menu</span></button>";
        document.body.appendChild(lista);
        document.body.classList.add("ma-spodnilistu");
    }

    /* Přepínač „Zobrazit jako" (jen hlavní správce) se do zkrácené hlavičky
       telefonu nevejde – bydlí tam dole v pásu u jména. Stěhuje se celý
       obal i s tím, co k němu přidala stránka; posluchače visí na dokumentu
       nebo na prvcích samých, takže se nic neztratí. */
    function placeNahled() {
        const box = document.querySelector("[data-nahled-slot]");
        const doPasu = document.querySelector("[data-rail-nahled]");
        const doPruhu = document.querySelector(".appbar__bandin");
        if (!box || !doPasu || !doPruhu) return;
        if (jeTelefon()) {
            if (box.parentElement !== doPasu) doPasu.appendChild(box);
        } else if (box.parentElement !== doPruhu) {
            doPruhu.insertBefore(box, doPruhu.querySelector(".appbar__userbox"));
        }
    }
    try {
        window.matchMedia(TELEFON).addEventListener("change", () => {
            placeNahled();
            if (document.querySelector(".siderail")) rozlozSkupiny();
        });
    } catch (err) { /* starší prohlížeč – zůstane, jak se to vykreslilo */ }

    /* --------------------------------------- splnění Quick TO-DO --------
       Vzkaz se plní dvěma způsoby a obě stránky (panel v pásu i dlaždice
       na nástěnce) musí číst stejně – proto to bydlí tady.

         společný (výchozí)  jeden odškrtne za všechny
         „každý sám"         každý má svoje odškrtnutí v `hotoviUids`;
                             zadavatel vidí, kolik lidí to už má */

    /* ------------------------------------------------- obrázky ---------
       Zmenšení screenshotu a náhled na dlaždici. Bydlelo to v poznámkách;
       od chvíle, kdy screenshot nese i Quick TO-DO, to musí umět obojí
       stejně – jinak by jedno okno vzalo obrázek, který druhé odmítne
       (Michal 4. 9. 2026). */

    /** Zmenší obrázek na rozumnou velikost (limit dokumentu je 1 MB). */
    UI.zmensiObrazek = async (blob) => {
        const bitmapa = await createImageBitmap(blob);
        const k = Math.min(1, 1600 / Math.max(bitmapa.width, bitmapa.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bitmapa.width * k);
        c.height = Math.round(bitmapa.height * k);
        c.getContext("2d").drawImage(bitmapa, 0, 0, c.width, c.height);
        let out = c.toDataURL("image/jpeg", 0.8);
        if (out.length > 900000) out = c.toDataURL("image/jpeg", 0.6);
        if (out.length > 900000) throw new Error("Obrázek je moc velký.");
        return out;
    };

    /** Malý náhled na dlaždici (ze screenshotu v plné velikosti). */
    UI.nahledObrazku = (dataUrl) => new Promise((ok) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement("canvas");
            const k = Math.min(1, 420 / img.naturalWidth);
            c.width = Math.round(img.naturalWidth * k);
            c.height = Math.round(img.naturalHeight * k);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            ok(c.toDataURL("image/jpeg", 0.7));
        };
        img.onerror = () => ok("");
        img.src = dataUrl;
    });

    UI.quickAdresati = (q) => (q && q.proUids && q.proUids.length)
        ? q.proUids : [(q && q.proUid) || ""].filter(Boolean);

    /** Je vzkaz splněný pro TOHOHLE člověka? */
    UI.quickHotovoPro = (q, uid) => (q && q.rezim === "kazdy")
        ? (q.hotoviUids || []).indexOf(uid) !== -1
        : !!(q && q.hotovo);

    /** Je vzkaz odbytý úplně? U „každý sám" až když ho mají všichni. */
    UI.quickHotovoVse = (q) => {
        if (!q) return false;
        if (q.rezim !== "kazdy") return !!q.hotovo;
        const komu = UI.quickAdresati(q);
        return komu.length > 0 && komu.every(u => (q.hotoviUids || []).indexOf(u) !== -1);
    };

    /** Vzal si vzkaz tenhle člověk aspoň na vědomí? */
    UI.quickVzal = (q, uid) => !!(q && (q.vzaliUids || []).indexOf(uid) !== -1);

    /* ---------------------------------------- oznámení (22. 10. 2026) ---
       Vzkaz, na který se „Splněno" nehodí – přidal tě do konverzace, zmínka,
       nové milníky, zpětný zápis (Michal). Bere se na vědomí STEJNÝM polem
       jako splnění (rezim "kazdy" → hotoviUids), takže počty, filtry,
       historie i pravidla platí beze změny – liší se jen popisky. Starší
       vzkazy bez pole `druh` se poznají podle začátku textu. */
    const OZNAMENI_TEXT = /^(Přidal tě do konverzace|Zmínil tě|Máš nově zveřejněné milníky|Změnil se termín milníků|Zpětný zápis povolen|Zpětný zápis na .+ povolen nebyl)/;
    UI.jeOznameni = (q) => !!q && (q.druh === "info" ||
        (q.druh == null && OZNAMENI_TEXT.test(String(q.text || ""))));

    /** Kam oznámení bez vlastního odkazu vede – jen pevné adresy, nic z databáze. */
    const cilOznameni = (q) => {
        const t = String((q && q.text) || "");
        return /^(Máš nově zveřejněné milníky|Změnil se termín milníků)/.test(t) ? "milniky.html"
            : /^Zpětný zápis/.test(t) ? "vykazy.html" : "";
    };

    /** „Otevřít" u oznámení (poznámka / konverzace, milníky, výkazy); otevření ho vezme na vědomí. */
    UI.quickOtevritHtml = (q) => !UI.jeOznameni(q) ? ""
        : q.poznamka ? '<button type="button" class="btn btn--ghost btn--sm" data-pozn-nahled="' +
            esc(q.poznamka) + '">Otevřít</button>'
        : cilOznameni(q) ? '<a class="btn btn--ghost btn--sm" href="' + esc(cilOznameni(q)) + '">Otevřít</a>' : "";

    /* ------------------------------------------ odložení (bod 26) -------
       Vzkaz Quick TO-DO a upozornění pro kontrolu jde odložit na zítra
       nebo na pondělí (rešerše 19. 10. 2026): do té doby se neukazuje ani
       nepočítá do odznaku, pak se vrátí samo. Odložení je osobní – ukládá
       se čas návratu (ms místní půlnoci) pod toho, kdo odložil. */

    /** Čas návratu: "zitra" | "pondeli" (nejbližší příští; v neděli = zítra). */
    UI.odlozitDo = (kam, ted) => {
        const d = new Date(ted || Date.now());
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + (kam === "pondeli" ? ((8 - d.getDay()) % 7 || 7) : 1));
        return d.getTime();
    };

    const DNY_ODLOZENI = ["ne", "po", "út", "st", "čt", "pá", "so"];
    /** „čt 23. 10." */
    UI.odlozenoText = (ms) => {
        const d = new Date(Number(ms) || 0);
        return DNY_ODLOZENI[d.getDay()] + " " + d.getDate() + ". " + (d.getMonth() + 1) + ".";
    };

    /* Návrat bez obnovení stránky: jeden časovač na nejbližší návrat, pak se
       znovu ohlásí data (KB.emit) a seznamy i odznaky se překreslí samy. */
    const navratOdlozeni = {};      // událost → { ms, casovac }
    function hlidejNavrat(ms, udalost) {
        const n = navratOdlozeni[udalost];
        if (n && n.ms <= ms) return;
        if (n) clearTimeout(n.casovac);
        navratOdlozeni[udalost] = { ms: ms, casovac: setTimeout(() => {
            delete navratOdlozeni[udalost];
            if (window.KB && window.KB.emit) window.KB.emit(udalost);
        }, Math.min(ms - Date.now() + 1000, 2147483000)) };
    }

    /** Je odloženo (návrat v budoucnu)? `udalost` se ohlásí, až čas vyprší. */
    UI.odlozeno = (ms, udalost) => {
        const n = Number(ms) || 0;
        if (!(n > Date.now())) return false;
        if (udalost) hlidejNavrat(n, udalost);
        return true;
    };

    /** Odložil si tenhle člověk vzkaz? */
    UI.quickOdlozeno = (q, uid) => UI.odlozeno(q && q.odlozeno && q.odlozeno[uid], "quicktodo");

    /** Volby do nabídky (KBNabidka); fn(ms) uloží. V neděli je zítra pondělí – jen jedna. */
    UI.odlozitPolozky = (fn) => {
        const zitra = UI.odlozitDo("zitra"), pondeli = UI.odlozitDo("pondeli");
        return [{ text: "Odložit na zítra (" + UI.odlozenoText(zitra) + ")", ikona: "hodiny", fn: () => fn(zitra) }]
            .concat(pondeli === zitra ? [] : [{ text: "Odložit na pondělí (" + UI.odlozenoText(pondeli) + ")",
                ikona: "kalendar", fn: () => fn(pondeli) }]);
    };

    /** Tlačítko „Odložit" u položky – otevře volby přes KBNabidka. `attr` skládá volající (s esc). */
    UI.odlozitTlacitko = (attr, trida) =>
        '<button type="button" class="btn btn--ghost btn--sm' + (trida ? " " + esc(trida) : "") + '"' +
        ' data-nabidka-vic aria-haspopup="menu"' +
        ' aria-expanded="false" ' + attr + ' title="Odložit na zítra nebo na pondělí – do té doby zmizí">Odložit</button>';

    /** Odloží vzkaz do `ms` (0 = vrátit hned) – s hláškou a „Zpět". */
    UI.quickOdloz = (q, ms) => {
        const uid = window.KB.currentUid();
        const bylo = Number((q.odlozeno || {})[uid]) || 0;
        return window.KB.odlozQuick(q.id, ms)
            .then(() => UI.toast(ms ? "Odloženo do " + UI.odlozenoText(ms) + " – pak se vzkaz vrátí sám."
                    : "Vzkaz je zpátky v seznamu.", undefined,
                { zpet: () => window.KB.odlozQuick(q.id, bylo > Date.now() ? bylo : 0) }))
            .catch((err) => { console.error(err); UI.toast("Uložení selhalo.", "error"); });
    };

    /* Nabídka u vzkazu (⋯ = tlačítko Odložit, pravé tlačítko, podržení prstu)
       na stránce Quick TO-DO i v dlaždici nástěnky. Jen adresát a jen
       nesplněný vzkaz – jinde zůstane nabídka prohlížeče. */
    function nabidkaQuick(cil) {
        const tl = cil.closest("[data-quick-odlozit]");
        const radek = cil.closest("[data-quick-radek]");
        const id = tl ? tl.getAttribute("data-quick-odlozit") : (radek ? radek.getAttribute("data-quick-radek") : "");
        const q = id && (window.KB.quicktodo || []).find(x => x.id === id);
        const uid = window.KB.currentUid && window.KB.currentUid();
        if (!q || UI.quickAdresati(q).indexOf(uid) === -1 || UI.quickHotovoPro(q, uid)) return null;
        const polozky = UI.quickOdlozeno(q, uid)
            ? [{ text: "Vrátit hned (odloženo do " + UI.odlozenoText(q.odlozeno[uid]) + ")", ikona: "vratit",
                fn: () => UI.quickOdloz(q, 0) }]
            : UI.odlozitPolozky((ms) => UI.quickOdloz(q, ms));
        // oznámení: totéž co tlačítko v řádku
        if (UI.jeOznameni(q)) polozky.unshift({ text: "Beru na vědomí", ikona: "hotovo", fn: () => vezmiNaVedomi(q) });
        if (!tl) polozky.unshift({ text: "Otevřít vzkaz", ikona: "otevrit", fn: () => UI.otevriQuick(q.id) });
        return { nadpis: String(q.text || "Vzkaz").slice(0, 60), radek: radek, polozky: polozky };
    }
    // nabidka.js se načítá až za ui.js (stránky, které vzkazy ukazují)
    document.addEventListener("DOMContentLoaded", () => {
        if (window.KBNabidka) window.KBNabidka.pripoj(nabidkaQuick);
    });

    /**
     * Kolik adresátů si vzkaz vzalo na vědomí – vrací „3 z 5", nebo nic.
     * Zadavatel tím pozná, že vzkaz nezapadl, i když ho nikdo neodškrtl
     * jako splněný (Michal 25. 9. 2026). Nula se neukazuje, jinak by
     * u každého vzkazu svítilo „0 z 5". U vzkazu jedinému člověku, kterým
     * jsem já sám, taky ne – vedle už stojí „beru na vědomí". */
    UI.quickVedomi = (q) => {
        const komu = UI.quickAdresati(q);
        const vzali = komu.filter(u => UI.quickVzal(q, u));
        if (!vzali.length) return "";
        const ja = (window.KB.currentUid && window.KB.currentUid()) || "";
        if (komu.length === 1 && vzali[0] === ja) return "";
        return vzali.length + " z " + komu.length;
    };

    /** Jména těch, kdo si vzkaz vzali na vědomí. */
    UI.quickVedomiJmena = (q) => UI.quickAdresati(q)
        .filter(u => UI.quickVzal(q, u))
        .map(u => {
            const x = (window.KB.users || []).find(y => y.id === u);
            return x ? ((x.first || "") + " " + (x.last || "")).trim() : "";
        })
        .filter(Boolean);

    /**
     * „2 z 5 splnilo · chybí Petr Trávník, Marek Pelikán" pod vzkazem, který
     * si každý škrtá sám. Samotný počet nestačil – zadavatel z něj nepoznal,
     * koho má popohnat (Michal 16. 9. 2026). Kdo si vzkaz vzal aspoň na
     * vědomí, je u jména poznat.
     */
    UI.quickStav = (q) => {
        if (!q || q.rezim !== "kazdy") return "";
        const komu = UI.quickAdresati(q);
        const hotovych = komu.filter(u => (q.hotoviUids || []).indexOf(u) !== -1);
        const jmeno = (uid) => {
            const u = (window.KB.users || []).find(x => x.id === uid);
            return u ? ((u.first || "") + " " + (u.last || "")).trim() : "";
        };
        const chybi = komu.filter(u => hotovych.indexOf(u) === -1)
            .map(u => jmeno(u) + (UI.quickVzal(q, u) ? " (ví o tom)" : ""))
            .filter(t => t.trim());
        const vypis = chybi.length > 4
            ? chybi.slice(0, 4).join(", ") + " a další " + (chybi.length - 4)
            : chybi.join(", ");
        return hotovych.length + " z " + komu.length + (UI.jeOznameni(q) ? " vzali na vědomí" : " splnilo") +
            (vypis ? " · chybí " + vypis : "");
    };

    /* Odškrtnutí posílá celý vzkaz zpátky – náhled screenshotu a komentáře
       se z něj ale vypouští. Náhled je desítky kilobajtů, které nemá cenu
       posílat při každém kliknutí, a komentář, který mezitím někdo přidal,
       by se přepsal starou kopií. Merge je v databázi nechá být. */
    const bezPriloh = (q) => {
        const kopie = Object.assign({}, q);
        delete kopie.nahled;
        delete kopie.obrazku;
        delete kopie.komentare;
        delete kopie.vzaliUids;   // „beru na vědomí" se dopisuje zvlášť
        return kopie;
    };

    /** „↻ každý týden" u opakovaného vzkazu, jinak prázdno. */
    UI.quickOpakovani = (q) => {
        const popis = q && q.opakovani && ((window.KB && window.KB.OPAKOVANI_POPIS) || {})[q.opakovani];
        return popis ? "↻ " + popis : "";
    };

    /**
     * Hláška po odškrtnutí. U opakovaného vzkazu řekne, kdy přijde další –
     * zakládá ho prohlížeč zadavatele (KB.zalozDalsiQuick), u vlastního
     * vzkazu hned, u cizího, až má zadavatel web otevřený.
     */
    UI.quickHlaskaSplneno = (q) => {
        if (UI.jeOznameni(q)) return "Vzato na vědomí.";
        const dalsi = q && q.opakovani && window.KB && window.KB.dalsiTerminOpakovani
            ? window.KB.dalsiTerminOpakovani(q.doKdy, q.opakovani, q.opakovaniDen) : "";
        return dalsi ? "Splněno. Další opakování: do " + czDatumKratke(dalsi) + "." : "Splněno.";
    };

    /** Odškrtnutí i vrácení – podle režimu sáhne na správné pole. */
    UI.quickPrepni = (q, hotovo) => {
        const uid = window.KB.currentUid();
        if (q.rezim === "kazdy") {
            const bez = (q.hotoviUids || []).filter(x => x !== uid);
            return window.KB.saveQuickTodo(q.id, Object.assign(bezPriloh(q), {
                hotoviUids: hotovo ? bez.concat([uid]) : bez,
                /* `hotovo` drží, jestli to mají VŠICHNI – podle něj se vzkaz
                   uklidí ze seznamu zadavateli. */
                hotovo: hotovo
                    ? UI.quickAdresati(q).every(u =>
                        u === uid || (q.hotoviUids || []).indexOf(u) !== -1)
                    : false,
                hotovoKdo: "",
                hotovoMs: hotovo ? Date.now() : 0
            }));
        }
        return window.KB.saveQuickTodo(q.id, Object.assign(bezPriloh(q), {
            hotovo: hotovo,
            hotovoKdo: hotovo ? (window.KB_USER || "") : "",
            hotovoMs: hotovo ? Date.now() : 0
        }));
    };

    /** Oznámení „Beru na vědomí" (nabídka, otevření odkazu) – s hláškou a Zpět. */
    function vezmiNaVedomi(q) {
        return UI.quickPrepni(q, true)
            .then(() => UI.toast("Vzato na vědomí.", undefined, {
                zpet: () => UI.quickPrepni((window.KB.quicktodo || []).find(x => x.id === q.id) || q, false)
            }))
            .catch(() => UI.toast("Uložení selhalo.", "error"));
    }

    /* Otevření odkazu z oznámení (Otevřít, odkaz v textu) ho rovnou vezme na
       vědomí – kdo se šel podívat, ví o tom. Odchod ze stránky počká na
       zápis nejvýš 1,5 s (bez signálu ho drží fronta v prohlížeči). */
    document.addEventListener("click", (e) => {
        const cil = e.target.closest && e.target.closest("a[href], [data-pozn-nahled]");
        const misto = cil && cil.closest("[data-quick-radek], #kbQuickOkno");
        if (!misto) return;
        const id = misto.id === "kbQuickOkno" ? quickOknoId : misto.getAttribute("data-quick-radek");
        const q = id && (window.KB.quicktodo || []).find(x => x.id === id);
        const uid = window.KB.currentUid && window.KB.currentUid();
        if (!q || !UI.jeOznameni(q) || UI.quickAdresati(q).indexOf(uid) === -1 || UI.quickHotovoPro(q, uid)) return;
        const odchod = cil.tagName === "A" && !e.defaultPrevented && e.button === 0 &&
            !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) && !cil.target;
        if (!odchod) return void vezmiNaVedomi(q);
        e.preventDefault();
        const zapis = UI.quickPrepni(q, true).catch(err => console.warn("Oznámení se nevzalo na vědomí:", err));
        Promise.race([zapis, new Promise(r => setTimeout(r, 1500))]).then(() => { location.href = cil.href; });
    });

    /* ------------------------------------------- náhled poznámky ---------
       Vzkaz svázaný s poznámkou dřív vedl odkazem na poznamky.html. Kdo si
       ho přečetl na nástěnce, přišel o rozdělanou práci a musel se klikat
       zpátky. Poznámka se proto otevře PŘES stránku, na které člověk je
       (přání Michala 2. 9. 2026); tlačítko na plnou stránku v okně zůstává,
       tam se dá poznámka i upravit. */

    let poznOknoId = "";

    function poznOkno() {
        let okno = document.getElementById("kbPoznOkno");
        if (okno) return okno;
        okno = document.createElement("div");
        okno.id = "kbPoznOkno";
        okno.className = "hookno no-print";
        okno.hidden = true;
        okno.innerHTML =
            '<div class="hookno__deska card">' +
                '<div class="hookno__hlava"><span data-pozn-nadpis>Poznámka</span>' +
                    '<a class="linkbtn linkbtn--tmavy" data-pozn-cela' +
                        ' href="poznamky.html">Otevřít v Poznámkách</a>' +
                    '<button type="button" class="linkbtn linkbtn--tmavy"' +
                        " data-pozn-zavri>Zavřít</button></div>" +
                '<div class="hookno__telo" data-pozn-telo></div>' +
            "</div>";
        document.body.appendChild(okno);
        okno.addEventListener("click", (e) => {
            if (e.target === okno || e.target.closest("[data-pozn-zavri]")) zavriPoznamku();
        });
        return okno;
    }

    function zavriPoznamku() {
        poznOknoId = "";
        const okno = document.getElementById("kbPoznOkno");
        if (okno) okno.hidden = true;
    }

    /**
     * Otevře poznámku v okně přes stránku.
     * Poznámky chodí vlastním odběrem (KB.watchPoznamky) – stránka, která
     * si o ně neřekla, je nemá. Proto se to pozná a řekne, místo aby okno
     * zůstalo prázdné.
     */
    UI.otevriPoznamku = async (id) => {
        if (!id) return;
        const okno = poznOkno();
        const telo = okno.querySelector("[data-pozn-telo]");
        poznOknoId = id;
        okno.querySelector("[data-pozn-cela]").href = "poznamky.html?pozn=" + encodeURIComponent(id);
        okno.hidden = false;

        const z = (window.KB.poznamky || []).find(p => p.id === id);
        if (!z) {
            telo.innerHTML = '<p class="small muted" style="line-height:1.6">' +
                "Tuhle poznámku ti nikdo nesdílel, nebo už neexistuje." +
                " Zkus ji otevřít v Poznámkách.</p>";
            return;
        }
        const kdy = z.ms ? new Date(z.ms).toLocaleDateString("cs-CZ") : "";
        telo.innerHTML =
            '<div class="small muted" style="margin-bottom:8px">' +
                [esc(z.listNazev || ""), esc(z.jmeno || ""), esc(kdy)]
                    .filter(Boolean).join(" · ") +
                (z.stav === 1 ? ' · <b style="color:var(--ok)">splněno</b>' : "") +
            "</div>" +
            '<div style="font-size:15px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere">' +
                UI.textSOdkazy(z.text || "", z.odkazy) + "</div>" +
            (z.nahled
                ? '<img src="' + esc(z.nahled) + '" alt="" style="margin-top:12px;max-width:100%;' +
                  'border-radius:8px;border:1px solid var(--line)">' : "") +
            (Number(z.obrazku) > 1
                ? '<p class="tiny muted" style="margin-top:6px">Poznámka má ' +
                  esc(String(z.obrazku)) + " obrázků – zbytek je v Poznámkách.</p>" : "") +
            ((z.komentare || []).length
                ? '<div style="margin-top:14px;border-top:1px solid var(--line-soft);padding-top:10px">' +
                    '<div class="tiny muted" style="font-weight:900;letter-spacing:.06em;' +
                        'text-transform:uppercase;margin-bottom:6px">Komentáře</div>' +
                    (z.komentare || []).map(k =>
                        '<div style="font-size:13.5px;line-height:1.55;margin-bottom:8px">' +
                            '<b>' + esc(k.jmeno || "") + "</b> " +
                            '<span class="muted">' + esc(k.ms
                                ? new Date(k.ms).toLocaleDateString("cs-CZ") : "") + "</span><br>" +
                            esc(k.text || "") + "</div>").join("") +
                  "</div>"
                : "");
    };

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && poznOknoId) zavriPoznamku();
    });

    /* ------------------------------------------------------- „Můj den" ---

       První pokus byl zrcadlit lištu (u návodů kategorie, u projektů
       projekty). Michal to zamítl a měl pravdu: roletka v liště to udělá
       líp a pás pak jen opisoval. Tohle je náhrada, která lištu nedubluje:
       osobní stav toho, kdo je přihlášený – kolik má dnes a tento týden
       vykázáno, kolik má otevřených úkolů a co ho nejdřív tlačí.

       Data si pás vyžádá sám (jen „moje"), takže je má na každé stránce;
       kdyby si stránka řekla o víc, store odběr povýší – zúžit ho nejde. */

    let mujDenZapnut = false;

    function pozadejOData() {
        if (mujDenZapnut || !window.KB || !window.KB.currentUid || !window.KB.currentUid()) return;
        mujDenZapnut = true;
        window.KB.watchQuickTodo();
        if (window.KB.watchPoznHlavy) window.KB.watchPoznHlavy();   // odznak u Poznámek
        window.KB.watchMojeProjekty();     // roletka projektů v Quick TO-DO
        if (!UI.can("vykaz.otevrit")) return;      // student výkazy nemá
        window.KB.watchMojeVykazy();
        window.KB.watchMojeUkoly();
    }

    /* --------------------------------------------- páteční hlídka výkazů ---
       Kdo v pátek (a o víkendu) nemá v běžícím týdnu jediný zápis, dostane
       do Quick TO-DO vzkaz „co nejdříve". Platí pro každého včetně manažerů.
       Vzkaz má pevné id (uid + pondělí týdne), takže se týž týden nezaloží
       podruhé – ani odškrtnutý, ani z jiného počítače. Kontrola se pouští
       až po příchodu výkazů I vzkazů, jinak by rozhodovala nad prázdnem. */

    const hlidkaPrislo = { vykazy: false, quick: false };
    let hlidkaBezela = false;

    /* Výkazy se na webu píšou až od týdne 31. 8. 2026 – starší týdny hlídka
       ignoruje a svoje staré vzkazy z doby před spuštěním každému uklidí. */
    const HLIDKA_START = "2026-08-31";

    function hlidkaVykazu() {
        if (hlidkaBezela || !hlidkaPrislo.vykazy || !hlidkaPrislo.quick) return;
        const uid = window.KB.currentUid && window.KB.currentUid();
        if (!uid || !UI.can("vykaz.otevrit")) return;
        /* Komu se výkazy nehlídají (majitelé) a kdo momentálně nepracuje,
           ten připomínku nedostane (Michal 16. 9. 2026). */
        const ja = UI.me();
        if (ja && (ja.bezHlidky === true || ja.nepracuje === true)) return;

        hlidkaBezela = true;    // rozhodnuto – druhé kolo by zapsalo duplicitu

        /* úklid vzkazů o týdnech před spuštěním (id končí pondělím týdne) */
        (window.KB.quicktodo || []).forEach(q => {
            if (q.id && q.id.indexOf("qt_hlidka_" + uid + "_") === 0 &&
                    q.id.slice(-10) < HLIDKA_START) {
                window.KB.deleteQuickTodo(q.id).catch(() => {});
            }
        });

        const dnes = new Date();
        const den = (d) => d.getFullYear() + "-" +
            String(d.getMonth() + 1).padStart(2, "0") + "-" +
            String(d.getDate()).padStart(2, "0");
        const po = new Date(dnes);
        po.setDate(po.getDate() - (po.getDay() + 6) % 7);      // pondělí týdne

        /* Pá/So/Ne se hlídá AKTUÁLNÍ týden (oranžově). V pondělí je poslední
           šance doplnit MINULÝ týden před uzávěrkou – hlídá se ten (červeně).
           Út–Čt hlídka mlčí. */
        const denVTydnu = dnes.getDay();
        let minuly;
        if ([5, 6, 0].indexOf(denVTydnu) !== -1) {
            minuly = false;
        } else if (denVTydnu === 1) {
            minuly = true;
            po.setDate(po.getDate() - 7);
        } else {
            return;
        }
        const ne = new Date(po);
        ne.setDate(ne.getDate() + 6);
        const pondeli = den(po), nedele = den(ne);
        if (pondeli < HLIDKA_START) return;

        const maZapis = (window.KB.vykazy || []).some(z =>
            z.uid === uid && (z.datum || "") >= pondeli && (z.datum || "") <= nedele);
        if (maZapis) return;

        const id = "qt_hlidka_" + uid + "_" + pondeli;
        const stavajici = (window.KB.quicktodo || []).find(q => q.id === id);
        /* Odškrtnutý vzkaz se znovu neotvírá. Víkendový oranžový se ale
           v pondělí přepíše na červený „minulý týden" – zpřísnění platí
           i tomu, kdo si vzkaz o víkendu smazal křížkem. */
        if (stavajici && (stavajici.hotovo || !minuly || stavajici.hlidka === "minuly")) return;
        if (!stavajici && !minuly) {
            /* pojistka pro tenhle prohlížeč: smazaný (ne odškrtnutý) vzkaz by
               se jinak založil znovu, protože v databázi po něm nic nezbylo */
            try { if (localStorage.getItem("kb-hlidka") === id) return; } catch (err) { }
        }

        window.KB.saveQuickTodo(id, {
            text: minuly
                ? "Nemáš zapsaný výkaz v minulém týdnu, naprav to"
                : "Nemáš zapsaný výkaz v tomhle týdnu, naprav to",
            proUids: [uid],
            odKoho: uid,
            odKohoJmeno: "Hlídka výkazů",
            asap: true,
            hlidka: minuly ? "minuly" : "tyden"
        }).then(() => {
            try { localStorage.setItem("kb-hlidka", id); } catch (err) { }
        }).catch(err => console.warn("Hlídka výkazů nezapsala vzkaz:", err));
    }

    /* --------------------------------------- dopočet částek k výkazům ---
       Zaměstnanec zapisuje jen čas; sazbu a částku k tomu musí doplnit
       manažer, protože peníze zaměstnanec zapsat nesmí. Dělá se to tady,
       z manažerova prohlížeče, jakmile mu dorazí zápisy i tajný číselník
       se sazbami — bez toho zůstávaly cizí výkazy za nula korun a do
       Tabulek šly bez taxy (Michal 2. 9. 2026). */

    let castkyBezi = false;

    function dopocitejCastky() {
        if (castkyBezi || !UI.can("vykaz.view")) return;
        if (!window.KB.doplnCastky) return;
        castkyBezi = true;
        window.KB.doplnCastky()
            .then(v => {
                if (!v) return;
                if (v.doplneno) {
                    /* Hláška má říct, ČÍ výkaz a k jakému dni se doplnil.
                       Samotné „u 3 výkazů" se nedalo s ničím spojit a manažer
                       nevěděl, komu se co dopočítalo (Michal 4. 9. 2026). */
                    const den = (iso) => {
                        const kusy = String(iso || "").split("-");
                        return kusy.length === 3
                            ? Number(kusy[2]) + ". " + Number(kusy[1]) + "." : "";
                    };
                    const kdo = (z) => {
                        if (z.osoba) return z.osoba;
                        const u = (window.KB.users || []).find(x => x.id === z.uid);
                        return u ? ((u.first || "") + " " + (u.last || "")).trim() : "";
                    };
                    const popisy = (v.doplnene || [])
                        .map(z => (kdo(z) + " " + den(z.datum)).trim())
                        .filter(Boolean);
                    UI.toast(popisy.length
                        ? "Doplněny sazby k výkazům: " + popisy.slice(0, 3).join(", ") +
                            (popisy.length > 3 ? " a další " + (popisy.length - 3) : "") + "."
                        : "Doplněny sazby u " + v.doplneno + " výkazů.");
                }
                if (v.chybiSazba.length) {
                    const jmena = v.chybiSazba.map(uid => {
                        const u = (window.KB.users || []).find(x => x.id === uid);
                        return u ? ((u.first || "") + " " + (u.last || "")).trim() : uid;
                    });
                    console.warn("Bez sazby v číselníku (výkazy zůstanou za 0 Kč):", jmena);
                    UI.toast("Chybí sazba: " + jmena.join(", ") +
                        " — doplň ji v Nastavení, jinak jsou jejich výkazy za 0 Kč.", "warn");
                }
            })
            .catch(err => console.warn("Dopočet částek selhal:", err))
            .finally(() => { castkyBezi = false; });
    }

    /* -------------------------------------- výkaz zapsaný dopředu ------
       Práce se vykazuje pozpátku, ne dopředu. Zápis s budoucím datem se
       do Tabulek propíše až po tom dni (skript ho odloží), takže by mohl
       tiše proklouznout – manažer o něm má vědět hned. Dovolená a volno
       dopředu jsou v pořádku (tak je Rychlý zápis dělá), hlídá se jen
       práce na zakázce. Běží jen manažerovi – jen ten vidí cizí výkazy.
       (Přání Michala 1. 9. 2026.) */

    let dopreduNaposled = null;   // co se už zapsalo, se nepíše znovu

    function hlidkaDopredu() {
        if (!hlidkaPrislo.vykazy || !hlidkaPrislo.quick) return;
        const uid = window.KB.currentUid && window.KB.currentUid();
        if (!uid || !UI.can("vykaz.view")) return;

        const dnes = new Date();
        const dnesIso = dnes.getFullYear() + "-" +
            String(dnes.getMonth() + 1).padStart(2, "0") + "-" +
            String(dnes.getDate()).padStart(2, "0");

        const dopredu = (window.KB.vykazy || []).filter(z =>
            !z.absence && (z.datum || "") > dnesIso);

        const id = "qt_dopredu_" + uid;
        const stavajici = (window.KB.quicktodo || []).find(q => q.id === id);

        if (!dopredu.length) {
            // uklidilo se samo: zápis se smazal nebo ten den už proběhl
            dopreduNaposled = null;
            if (stavajici) window.KB.deleteQuickTodo(id).catch(() => {});
            return;
        }

        const cesky = (iso) => {
            const c = String(iso).split("-");
            return c.length === 3 ? Number(c[2]) + ". " + Number(c[1]) + "." : iso;
        };
        const jmeno = (z) => {
            const u = (window.KB.users || []).find(x => x.id === z.uid);
            return u ? ((u.first || "") + " " + (u.last || "")).trim() : (z.osoba || "někdo");
        };
        const popis = dopredu.slice(0, 4).map(z =>
            jmeno(z) + " " + cesky(z.datum) + " (" + (z.zakazka || "bez projektu") + ")").join(", ");
        const text = "Výkaz dopředu: " + popis +
            (dopredu.length > 4 ? " a další " + (dopredu.length - 4) : "") +
            ". Do Tabulek to půjde až po tom dni.";

        /* Stejný text se nepřepisuje – vzkaz by naskakoval při každém
           načtení. Vlastní zápis se pamatuje i mimo databázi: tři události
           za sebou (výkazy, vzkazy, lidé) doběhnou dřív, než se uložený
           vzkaz stihne vrátit odběrem, a vznikly by tři stejné řádky
           v historii (Michal 1. 9. 2026). */
        if (stavajici && stavajici.text === text) return;
        if (dopreduNaposled === text) return;
        dopreduNaposled = text;

        window.KB.saveQuickTodo(id, {
            text: text,
            proUids: [uid],
            odKoho: uid,
            odKohoJmeno: "Hlídka výkazů",
            asap: true,
            hlidka: "dopredu"
        }).catch(err => console.warn("Hlídka dopředu nezapsala vzkaz:", err));
    }

    /* ------------------------------------- připomenutí z kalendáře -----
       U události se dá zvolit „den / týden / měsíc předem". Vzkaz nezakládá
       server, ale prohlížeč toho, komu akce patří – jakmile den připomenutí
       nastane, objeví se v Quick TO-DO s termínem v den akce. Id je pevné
       (`qt_akce_<udalost>_<uid>`), takže vznikne jen jednou; kdo si vzkaz
       smaže, nedostane ho znovu (pojistka v prohlížeči).
       (Přání Michala 1. 9. 2026.) */

    const PREDSTIH = { den: 1, tyden: 7, mesic: 30 };

    function hlidkaAkci() {
        if (!hlidkaPrislo.quick) return;
        const uid = window.KB.currentUid && window.KB.currentUid();
        if (!uid) return;

        const den = (d) => d.getFullYear() + "-" +
            String(d.getMonth() + 1).padStart(2, "0") + "-" +
            String(d.getDate()).padStart(2, "0");
        const dnes = den(new Date());

        (window.KB.kalendar || []).forEach(u => {
            if (!u.od) return;
            // akce jen pro vybrané: připomíná se jen jim a autorovi
            if (Array.isArray(u.proUids) && u.proUids.length &&
                    u.uid !== uid && u.proUids.indexOf(uid) === -1) return;
            if (u.od < dnes) return;                       // už proběhlo

            /* Připomenutí můžou být dvě (třeba měsíc a den předem). Každé má
               vlastní vzkaz, ať se to druhé neztratí v prvním. */
            [["", u.pripomenout], ["2", u.pripomenout2]].forEach(([poradi, volba]) =>
                zaloz(u, poradi, PREDSTIH[volba]));
        });

        function zaloz(u, poradi, kolik) {
            if (!kolik) return;

            const id = "qt_akce_" + u.id + poradi + "_" + uid;
            const co = String(u.text || "").trim() || "akce v kalendáři";
            const kdyText = (() => {
                const c = String(u.od).split("-");
                return c.length === 3 ? Number(c[2]) + ". " + Number(c[1]) + "." : u.od;
            })();
            const text = "Připomenutí: " + co + " – " + kdyText;

            /* Vzkaz už existuje: musí držet krok s akcí. Když se akce posune
               nebo přejmenuje, připomínka to vezme za svou – jinak v ní visí
               starý termín. (25. 9. 2026: akce vznikla na 25. 9., vzkaz se
               založil o tři vteřiny později a Marek pak akci přesunul na
               2. 10.; ve vzkazu zůstalo 25. 9.) Posun DNE odškrtnutý vzkaz
               zase otevře – je to jiný den, než na který se člověk chystal.
               Samotná změna názvu odškrtnutí nechá být. */
            const stary = (window.KB.quicktodo || []).find(q => q.id === id);
            if (stary) {
                const jinyDen = (stary.doKdy || "") !== u.od;
                if (!jinyDen && stary.text === text) return;
                window.KB.saveQuickTodo(id, Object.assign({}, stary, {
                    text: text,
                    doKdy: u.od,
                    hotovo: jinyDen ? false : stary.hotovo === true,
                    hotoviUids: jinyDen ? [] : (stary.hotoviUids || []),
                    hotovoKdo: jinyDen ? "" : (stary.hotovoKdo || ""),
                    hotovoMs: jinyDen ? 0 : (stary.hotovoMs || 0)
                })).catch(err => console.warn("Připomínka se nesrovnala:", err));
                return;
            }

            const kdy = new Date(u.od + "T00:00:00");
            kdy.setDate(kdy.getDate() - kolik);
            if (dnes < den(kdy)) return;                   // ještě není čas
            try { if (localStorage.getItem("kb-" + id)) return; } catch (err) { }

            window.KB.saveQuickTodo(id, {
                text: text,
                proUids: [uid],
                odKoho: uid,
                odKohoJmeno: "Kalendář",
                doKdy: u.od,          // termín vzkazu = den akce
                hlidka: "akce"
            }).then(() => {
                try { localStorage.setItem("kb-" + id, "1"); } catch (err) { }
            }).catch(err => console.warn("Připomenutí se nezapsalo:", err));
        }
    }

    /* ------------------------------------------------------ Quick TO-DO ---
       Panel vyjede zpoza pásu přes obsah stránky – vzkaz se často píše
       uprostřed jiné práce a nemá smysl kvůli němu někam odcházet.
       Je dostupný na každé stránce a smí ho poslat každý. */

    function mountQuickPanel() {
        if (document.getElementById("kbQuickPanel")) return;
        const panel = document.createElement("div");
        panel.id = "kbQuickPanel";
        /* Okno uprostřed, ne vysouvací deska – stejné jako Rychlý zápis
           (vysouvání se u pásu sekalo, přání Michala 26. 8. večer). */
        panel.className = "hookno no-print";
        panel.hidden = true;
        panel.innerHTML =
            '<div class="hookno__deska card">' +
                '<div class="hookno__hlava">Quick TO-DO' +
                    '<button type="button" class="linkbtn linkbtn--tmavy"' +
                        " data-quick-zavri>Zavřít</button></div>" +
                '<div class="hookno__telo quickpanel__telo">' +
                    '<div class="quickpanel__form">' +
                        /* @ zmíní kolegu (dostane vlastní vzkaz), # odkáže
                           na projekt nebo úkol (22. 10. 2026) */
                        '<input type="text" class="field" data-quick-text data-napoveda maxlength="300" ' +
                            'placeholder="Napiš rychlý úkol (@ kolega, # projekt či úkol)" autocomplete="off">' +
                        /* Úkol, nebo jen pro informaci (22. 10. 2026): oznámení
                           si každý adresát bere na vědomí sám, bez termínu. */
                        '<div class="quickpanel__druh" role="radiogroup" aria-label="Druh vzkazu">' +
                            '<label><input type="radio" name="kbQuickDruh" value="" data-quick-druh checked> Úkol</label>' +
                            '<label><input type="radio" name="kbQuickDruh" value="info" data-quick-druh>' +
                                " Jen pro informaci</label>" +
                        "</div>" +

                        /* Lidí může být víc – stejný vzkaz se často posílá
                           celé partě. Zaškrtávátka místo roletky, ať je vidět,
                           komu to jde, bez rozbalování. */
                        '<div class="quickpanel__kdo" data-lide-vyber>' +
                            '<div class="quickpanel__popisek">Komu' +
                                '<button type="button" class="linkbtn" data-quick-oblibene-uloz>uložit jako oblíbené</button>' +
                            "</div>" +
                            '<div class="quickpanel__oblibene" data-quick-oblibene></div>' +
                            '<div class="quickpanel__hledej">' +
                                '<input type="text" class="field" data-quick-hledej' +
                                    ' placeholder="Hledat člověka…" aria-label="Hledat člověka">' +
                                '<button type="button" data-quick-hledej-zrus hidden' +
                                    ' title="Zrušit hledání">×</button>' +
                            "</div>" +
                            '<div class="quickpanel__lide" data-quick-komu></div>' +
                        "</div>" +

                        '<div class="quickpanel__radek" data-quick-jen-ukol>' +
                            '<label class="quickpanel__do">Do:' +
                                '<input type="date" class="field" data-quick-kdy aria-label="Do kdy">' +
                            "</label>" +
                            /* Opakování (21. 10. 2026): po splnění vznikne
                               stejný vzkaz s dalším termínem, počítaným od
                               termínu „Do", ne ode dne splnění. */
                            '<label class="quickpanel__do">Opakovat:' +
                                '<select class="field" data-quick-opakovani aria-label="Opakovat">' +
                                    '<option value="">ne</option>' +
                                    '<option value="tyden">každý týden</option>' +
                                    '<option value="14dni">každých 14 dní</option>' +
                                    '<option value="mesic">každý měsíc</option>' +
                                "</select>" +
                            "</label>" +
                        "</div>" +
                        '<label class="quickpanel__asap" data-quick-jen-ukol>' +
                            '<input type="checkbox" data-quick-asap> <b>Udělej co nejdříve</b>' +
                            '<span>bez termínu, řadí se první</span>' +
                        "</label>" +

                        /* Dva způsoby splnění (Michal 3. 9. 2026). Nezaškrtnuto
                           = jak to bylo dosud: kdo první odškrtne, zhasne to
                           všem. Zaškrtnuto = každý si škrtá své, hodí se na
                           „zkontrolujte si fotky ve své technologii". */
                        '<label class="quickpanel__asap" data-quick-jen-ukol>' +
                            '<input type="checkbox" data-quick-kazdy> <b>Každý si odškrtne sám</b>' +
                            '<span>jinak stačí, když to splní jeden za všechny</span>' +
                        "</label>" +

                        '<select class="field" data-quick-projekt aria-label="Projekt"></select>' +

                        /* Screenshot ke vzkazu (Michal 4. 9. 2026): co je
                           vidět na obrazovce, se popisuje hůř, než se to
                           vyfotí. Vkládá se stejně jako v poznámkách. */
                        '<div class="quickpanel__fotky">' +
                            '<div class="row" style="gap:8px;flex-wrap:wrap">' +
                                '<button type="button" class="btn btn--sm btn--ghost" data-quick-vlozit' +
                                    ' title="Stiskni PrintScreen (nebo Win+Shift+S) a pak sem klikni">' +
                                    "+ Vložit screenshot</button>" +
                                '<button type="button" class="btn btn--sm btn--ghost" data-quick-vybrat>' +
                                    "Vybrat z PC</button>" +
                                '<span class="tiny muted" style="align-self:center">nebo Ctrl+V</span>' +
                            "</div>" +
                            '<input type="file" data-quick-soubor accept="image/*" multiple hidden>' +
                            '<div class="pnahledy" data-quick-nahledy style="margin-top:8px"></div>' +
                        "</div>" +

                        '<button type="button" class="btn btn--primary" data-quick-uloz>Zadat quick to-do</button>' +
                    "</div>" +
                    /* přehled vzkazů má vlastní stránku – panel je na tvorbu */
                    '<a class="linkbtn" href="quicktodo.html" style="margin-top:14px;align-self:flex-start">' +
                        "Celkový přehled vzkazů →</a>" +
                "</div>" +
            "</div>";
        document.body.appendChild(panel);
        /* Zavření klikem na pozadí jen když na pozadí i ZAČALO – výběr
           textu tažením, který skončí mimo desku, okno zavíral a rozepsaný
           vzkaz zahodil (přání Michala 31. 8. 2026). */
        let stiskNaPozadi = false;
        panel.addEventListener("pointerdown", (event) => {
            stiskNaPozadi = event.target === panel;
        });
        panel.addEventListener("click", (event) => {
            if (event.target === panel && stiskNaPozadi) prepniQuick(false);
        });
    }

    function prepniQuick(otevrit) {
        const panel = document.getElementById("kbQuickPanel");
        if (panel) panel.hidden = !otevrit;
    }

    /* -------------------------------------- screenshoty k rozepsanému vzkazu */

    let quickNoveObrazky = [];

    function vykresliQuickNahledy() {
        const box = document.querySelector("[data-quick-nahledy]");
        if (!box) return;
        box.innerHTML = quickNoveObrazky.map((d, i) =>
            '<span class="pnahled"><img src="' + d + '" alt="">' +
            '<button type="button" data-quick-odeber="' + i + '" title="Odebrat">×</button></span>').join("");
    }

    async function pridejQuickObrazky(soubory) {
        for (const soubor of soubory) {
            try { quickNoveObrazky.push(await UI.zmensiObrazek(soubor)); }
            catch (err) { UI.toast("Obrázek se nepodařilo zpracovat.", "error"); }
        }
        vykresliQuickNahledy();
    }

    const quickPanelOtevreny = () => {
        const panel = document.getElementById("kbQuickPanel");
        return !!(panel && !panel.hidden);
    };

    document.addEventListener("paste", (event) => {
        if (!quickPanelOtevreny()) return;
        const obrazek = Array.from((event.clipboardData || {}).items || [])
            .find(i => i.type && i.type.indexOf("image/") === 0);
        if (obrazek) { event.preventDefault(); pridejQuickObrazky([obrazek.getAsFile()]); }
    });

    document.addEventListener("change", (event) => {
        if (!event.target.matches || !event.target.matches("[data-quick-soubor]")) return;
        if (event.target.files.length) pridejQuickObrazky(Array.from(event.target.files));
        event.target.value = "";
    });

    /* „Jen pro informaci" schová termín, opakování, „co nejdříve" i „každý
       sám" – oznámení je nemá, každý ho bere na vědomí sám. */
    function prepniDruhQuick(panel) {
        if (!panel) return;
        const info = !!panel.querySelector('[data-quick-druh][value="info"]:checked');
        panel.querySelectorAll("[data-quick-jen-ukol]").forEach(el => { el.hidden = info; });
        panel.querySelector("[data-quick-uloz]").textContent = info ? "Poslat pro informaci" : "Zadat quick to-do";
    }
    document.addEventListener("change", (event) => {
        if (event.target.matches && event.target.matches("[data-quick-druh]")) {
            prepniDruhQuick(event.target.closest("#kbQuickPanel"));
        }
    });

    /* ------------------------------------------------- okno vzkazu ------
       Vzkaz se screenshotem se do řádku nevejde. Rozkliknutím se otevře
       okno přes stránku: obrázek v plné velikosti, splnění a komentáře –
       stejně jako u poznámek (Michal 4. 9. 2026). */

    let quickOknoId = "";
    let quickOknoObrazky = { id: "", seznam: [] };

    function quickOkno() {
        let okno = document.getElementById("kbQuickOkno");
        if (okno) return okno;
        okno = document.createElement("div");
        okno.id = "kbQuickOkno";
        okno.className = "hookno no-print";
        okno.hidden = true;
        okno.innerHTML =
            '<div class="hookno__deska card">' +
                '<div class="hookno__hlava">Quick TO-DO' +
                    '<button type="button" class="linkbtn linkbtn--tmavy"' +
                        " data-quick-okno-zavri>Zavřít</button></div>" +
                '<div class="hookno__telo" data-quick-okno-telo></div>' +
            "</div>";
        document.body.appendChild(okno);
        okno.addEventListener("click", (e) => {
            if (e.target === okno || e.target.closest("[data-quick-okno-zavri]")) zavriQuickOkno();
        });
        return okno;
    }

    function zavriQuickOkno() {
        quickOknoId = "";
        const okno = document.getElementById("kbQuickOkno");
        if (okno) okno.hidden = true;
    }

    function vykresliQuickOkno() {
        const okno = document.getElementById("kbQuickOkno");
        if (!okno || okno.hidden || !quickOknoId) return;
        const telo = okno.querySelector("[data-quick-okno-telo]");
        const q = (window.KB.quicktodo || []).find(x => x.id === quickOknoId);
        if (!q) {
            telo.innerHTML = '<p class="small muted">Tenhle vzkaz už neexistuje.</p>';
            return;
        }
        const uid = window.KB.currentUid();
        const jmeno = (id) => {
            const u = (window.KB.users || []).find(x => x.id === id);
            return u ? ((u.first || "") + " " + (u.last || "")).trim() : "";
        };
        const mujVzkaz = q.odKoho === uid;
        const jsemAdresat = UI.quickAdresati(q).indexOf(uid) !== -1;
        const hotovoMne = jsemAdresat ? UI.quickHotovoPro(q, uid) : UI.quickHotovoVse(q);
        const ostatni = UI.quickAdresati(q).filter(x => x !== uid).map(jmeno).filter(Boolean);
        const obrazky = quickOknoObrazky.id === quickOknoId ? quickOknoObrazky.seznam : [];
        const info = UI.jeOznameni(q);

        telo.innerHTML =
            '<div class="small muted" style="margin-bottom:8px">' +
                [ info ? '<span class="quickrad__info">ℹ oznámení</span>' : "",
                  mujVzkaz ? "Zadal jsem" : "Zadal: " + esc(q.odKohoJmeno || jmeno(q.odKoho) || "?"),
                  q.projekt ? esc(q.projekt) : "",
                  q.asap && !info ? "co nejdříve" : "",
                  q.doKdy && !info ? "do " + esc(czDatumKratke(q.doKdy)) : "",
                  esc(UI.quickOpakovani(q))
                ].filter(Boolean).join(" · ") +
                (hotovoMne ? ' · <b style="color:var(--ok)">' + (info ? "vzato na vědomí" : "splněno") + "</b>" : "") +
            "</div>" +
            '<div style="font-size:15px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere">' +
                UI.textSOdkazy(q.text || "", q.odkazy) + "</div>" +
            (ostatni.length
                ? '<div class="tiny muted" style="margin-top:6px">Spoluúčast: ' +
                  esc(ostatni.join(", ")) + (q.rezim === "kazdy" ? " · každý sám" : "") + "</div>"
                : "") +
            // u oznámení „každý sám" i tady, kolik lidí ho už vzalo na vědomí
            (info && q.rezim === "kazdy" && ostatni.length
                ? '<div class="tiny muted" style="margin-top:4px">' + esc(UI.quickStav(q)) + "</div>" : "") +
            (UI.quickVedomi(q)
                ? '<div class="tiny muted" style="margin-top:4px">Ví o tom: ' +
                  esc(UI.quickVedomiJmena(q).join(", ")) + " · " + esc(UI.quickVedomi(q)) + "</div>"
                : "") +
            (obrazky.length
                ? '<div class="quickokno__obrazky">' + obrazky.map(o =>
                    '<img src="' + esc(o.data) + '" alt="">').join("") + "</div>"
                : (Number(q.obrazku)
                    ? '<p class="tiny muted" style="margin-top:10px">Načítám obrázek…</p>' : "")) +

            /* Splnit smí ten, komu vzkaz patří. Zadavatel mimo adresáty
               nemá co odškrtávat – u „každý sám" už vůbec. */
            (jsemAdresat && !(mujVzkaz && q.rezim === "kazdy")
                ? '<div class="row" style="gap:8px;margin-top:14px">' +
                    (q.zadostZpetne && !hotovoMne
                        ? '<a class="btn btn--sm btn--primary" href="vykazy.html#zpetne">Vyřídit ve Výkazech</a>'
                        : "") +
                    UI.quickOtevritHtml(q) +
                    (hotovoMne
                        ? '<button type="button" class="btn btn--sm btn--ghost"' +
                            ' data-quick-hotovo="' + esc(q.id) + '" data-zpet="1">Vrátit</button>'
                        : info
                        ? '<button type="button" class="btn btn--sm btn--primary"' +
                            ' data-quick-hotovo="' + esc(q.id) + '">Beru na vědomí</button>'
                        : '<button type="button" class="btn btn--sm quicksplnit"' +
                            ' data-quick-hotovo="' + esc(q.id) + '">Splněno</button>') +
                    // oznámení má „Beru na vědomí" místo Splněno – druhé tlačítko by bylo navíc
                    (!hotovoMne && !info
                        ? (UI.quickVzal(q, uid)
                            ? '<button type="button" class="btn btn--sm btn--ghost"' +
                                ' data-quick-vzal="' + esc(q.id) + '" data-zpet="1">Zrušit beru na vědomí</button>'
                            : '<button type="button" class="btn btn--sm btn--ghost"' +
                                ' data-quick-vzal="' + esc(q.id) + '">Beru na vědomí</button>')
                        : "") +
                  "</div>"
                : "") +

            '<div style="margin-top:14px;border-top:1px solid var(--line-soft);padding-top:10px">' +
                '<div class="tiny muted" style="font-weight:900;letter-spacing:.06em;' +
                    'text-transform:uppercase;margin-bottom:6px">Komentáře</div>' +
                ((q.komentare || []).length
                    ? (q.komentare || []).slice()
                        .sort((a, b) => (a.ms || 0) - (b.ms || 0)).map(k =>
                        '<div style="font-size:13.5px;line-height:1.55;margin-bottom:8px">' +
                            "<b>" + esc(k.jmeno || "") + "</b> " +
                            '<span class="muted">' + esc(k.ms
                                ? new Date(k.ms).toLocaleDateString("cs-CZ") : "") + "</span><br>" +
                            esc(k.text || "") + "</div>").join("")
                    : '<div class="tiny muted" style="margin-bottom:8px">Zatím bez komentáře.</div>') +
                '<div class="row" style="gap:8px">' +
                    '<input type="text" class="field grow" data-quick-koment maxlength="500"' +
                        ' placeholder="Napsat komentář…">' +
                    '<button type="button" class="btn btn--sm btn--primary" data-quick-koment-odesli>' +
                        "Odeslat</button>" +
                "</div>" +
            "</div>";
    }

    /**
     * Otevře vzkaz v okně přes stránku. Obrázky se dotahují zvlášť –
     * v seznamu vzkazů leží jen malý náhled.
     */
    UI.otevriQuick = async (id) => {
        if (!id) return;
        quickOknoId = id;
        quickOkno().hidden = false;
        vykresliQuickOkno();

        const q = (window.KB.quicktodo || []).find(x => x.id === id);
        if (!q || !Number(q.obrazku) || quickOknoObrazky.id === id) return;
        try {
            const seznam = await window.KB.nactiQuickObrazky(id);
            quickOknoObrazky = { id: id, seznam: seznam };
            if (quickOknoId === id) vykresliQuickOkno();
        } catch (err) {
            console.warn("Obrázky vzkazu se nenačetly:", err);
        }
    };

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && quickOknoId) return void zavriQuickOkno();
        if (e.key === "Enter" && e.target.matches && e.target.matches("[data-quick-koment]")) {
            const btn = document.querySelector("[data-quick-koment-odesli]");
            if (btn) btn.click();
        }
        /* Klávesnicí se vzkaz otevře stejně jako myší – text řádku je
           tlačítko jen rolí, ne značkou. */
        if ((e.key === "Enter" || e.key === " ") && e.target.matches &&
            e.target.matches("[data-quick-detail]")) {
            e.preventDefault();
            UI.otevriQuick(e.target.dataset.quickDetail);
        }
    });

    function prepniPanel(id, otevrit) {
        const panel = document.getElementById(id);
        if (!panel) return;
        // otevřený panel vytlačí ten druhý – oba vyjíždějí ze stejného místa
        if (otevrit) document.querySelectorAll(".quickpanel").forEach(p2 => {
            if (p2.id !== id) prepniPanel(p2.id, false);
        });
        const deska = panel.querySelector(".quickpanel__deska");
        const stin = panel.querySelector(".quickpanel__stin");

        /* pás je position:fixed, takže offsetParent je vždycky null –
           viditelnost se musí číst ze spočteného stylu */
        const pas = document.querySelector(".siderail");
        const pasVidet = pas && getComputedStyle(pas).display !== "none";
        deska.style.left = (pasVidet ? pas.offsetWidth : 0) + "px";

        panel.classList.toggle("je-otevreny", !!otevrit);
        panel.style.pointerEvents = otevrit ? "auto" : "none";
        deska.style.visibility = "visible";
        deska.style.transform = otevrit ? "translateX(0)" : "translateX(-102%)";
        stin.style.opacity = otevrit ? "1" : "0";
        if (!otevrit) setTimeout(() => {
            if (!panel.classList.contains("je-otevreny")) deska.style.visibility = "hidden";
        }, 260);
    }

    const czDatumKratke = (iso) => {
        if (!iso) return "";
        const [y, m, d] = iso.split("-");
        return Number(d) + ". " + Number(m) + ". " + y;
    };
    const dnesISO = () => {
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
            "-" + String(d.getDate()).padStart(2, "0");
    };

    let quickSplneneVidet = false;
    let quickOdlozeneVidet = false;

    /* ------------------------------------------------ pípnutí na nový vzkaz
       Krátký tón, když PŘI OTEVŘENÉ stránce přistane nový quick to-do pro mě.
       Co existovalo už před načtením stránky, nepípá – od toho je okno
       „Co je nového" po přihlášení. */

    const casNacteni = Date.now();
    let quickZname = null;   // null = první vykreslení, ještě nepípat

    function pipni() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.06, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
            osc.start(); osc.stop(ctx.currentTime + 0.31);
        } catch (err) { /* bez zvuku se dá žít */ }
    }

    function ohlasNove(proMe) {
        /* `uid` sem nepatří jako volná proměnná – tahle funkce běží mimo
           vykreslení seznamu a jinde ho nemá odkud vzít. */
        const ja = window.KB.currentUid();
        const ted = new Set(proMe.filter(q => !UI.quickHotovoPro(q, ja)).map(q => q.id));
        if (quickZname !== null) {
            const novy = proMe.find(q => !q.hotovo && !quickZname.has(q.id) &&
                (q.ms || 0) > casNacteni);
            if (novy) {
                pipni();
                UI.toast((UI.jeOznameni(novy) ? "Nové oznámení od " : "Nový quick to-do od ") +
                    (novy.odKohoJmeno || "?") +
                    ": " + novy.text.slice(0, 60));
            }
        }
        quickZname = ted;
    }

    /* ----------------------------------------------- oblíbené party lidí ---
       Kdo posílá pořád dokola tomu samému hloučku, si ho uloží pod jménem
       a příště ho nasadí jedním ťuknutím. Je to osobní zvyk jednoho člověka
       na jednom počítači, ne firemní údaj – proto localStorage a ne databáze. */

    const OBLIBENE_KEY = "kb-quick-oblibene";

    function nactiOblibene() {
        try {
            const data = JSON.parse(localStorage.getItem(OBLIBENE_KEY) || "[]");
            return Array.isArray(data) ? data : [];
        } catch (err) { return []; }
    }

    function ulozOblibene(seznam) {
        try { localStorage.setItem(OBLIBENE_KEY, JSON.stringify(seznam.slice(0, 12))); }
        catch (err) { /* soukromý režim – oblíbené prostě nezůstanou */ }
    }

    /** Kdo je zrovna zaškrtnutý v panelu. */
    function vybraniKomu() {
        const panel = document.getElementById("kbQuickPanel");
        if (!panel) return [];
        return Array.from(panel.querySelectorAll("[data-quick-komu] input:checked"))
            .map(ch => ch.value);
    }

    function vykresliOblibene() {
        const panel = document.getElementById("kbQuickPanel");
        const box = panel && panel.querySelector("[data-quick-oblibene]");
        if (!box) return;

        const seznam = nactiOblibene();
        box.innerHTML = seznam.map((o, i) =>
            '<span class="quickobl"><button type="button" data-quick-oblibene-nasad="' + i + '">' +
                esc(o.nazev) + "</button>" +
            '<button type="button" class="quickobl__x" data-quick-oblibene-smaz="' + i +
                '" title="Smazat oblíbené">&times;</button></span>').join("");
        box.hidden = !seznam.length;
    }

    function renderQuick() {
        const panel = document.getElementById("kbQuickPanel");
        const uid = (window.KB && window.KB.currentUid) ? window.KB.currentUid() : "";
        /* Seznam se kreslí do KAŽDÉHO [data-quick-seznam] – v panelu už není
           (panel je jen na tvorbu), zato ho má stránka quicktodo.html.
           Formulářová část se řeší jen, když panel opravdu existuje. */
        if (!uid) return;
        if (panel) naplnQuickForm(panel, uid);
        vykresliQuickSeznamy(uid);
        // otevřené okno vzkazu musí přijmout nový komentář i cizí splnění
        vykresliQuickOkno();
    }

    /* Schová jména, která hledanému nesedí. Zaškrtnutí zůstávají – kdo si
       vybere tři lidi a pak hledá čtvrtého, o vybrané nepřijde; proto se jen
       skrývá, nepřekresluje. Vybraní lidé zůstanou vidět vždycky, ať je
       poznat, komu vzkaz opravdu jde. */
    function profiltrujLidi(panel) {
        if (!panel) return;
        const pole = panel.querySelector("[data-quick-hledej]");
        const komu = panel.querySelector("[data-quick-komu]");
        if (!pole || !komu) return;
        const dotaz = pole.value.trim().toLowerCase();
        // křížek nemusí být všude – funkci půjčují i poznámky
        const zrus = panel.querySelector("[data-quick-hledej-zrus]");
        if (zrus) zrus.hidden = !dotaz;

        let videt = 0;
        komu.querySelectorAll("label").forEach(l => {
            const ch = l.querySelector("input");
            const sedi = !dotaz || l.textContent.toLowerCase().indexOf(dotaz) !== -1;
            const nechat = sedi || (ch && ch.checked);
            l.hidden = !nechat;
            if (nechat) videt++;
        });

        let nic = komu.querySelector(".quickpanel__nic");
        if (!videt) {
            if (!nic) {
                nic = document.createElement("div");
                nic.className = "quickpanel__nic";
                komu.appendChild(nic);
            }
            nic.textContent = "Nikdo takový v seznamu není.";
            nic.hidden = false;
        } else if (nic) {
            nic.hidden = true;
        }
    }

    /* Stejné hledání v lidech použije i poznámka, když se posílá víc
       kolegům naráz – ať se to všude ovládá stejně (Michal 4. 9. 2026).
       Stačí, aby kontejner nesl stejná data-jména jako panel vzkazů. */
    UI.profiltrujLidi = profiltrujLidi;

    /* Výběrů lidí je na webu víc (panel vzkazů, upozornění u poznámky).
       Hledání proto pracuje s tím nejbližším, ne natvrdo s panelem –
       jinak by psaní v poznámce filtrovalo seznam v panelu. */
    const vyberLidi = (el) => (el && el.closest && el.closest("[data-lide-vyber]")) ||
        document.getElementById("kbQuickPanel");

    /**
     * Zaškrtávátka lidí do libovolného kontejneru – panel Quick TO-DO i
     * poznámky z nich vybírají stejně. Řadí manažery, pak zaměstnance,
     * pak studenty; `sJa` přidá volbu „Jen pro mě".
     */
    UI.lideDoVyberu = (kontejner, sJa, vynech) => {
        const uid = window.KB.currentUid();
        const pryc = new Set(vynech || []);
        const PORADI = { "hlavni-spravce": 0, "majitel": 1, "spravce": 2, "asistentka": 3,
                         "zamestnanec": 4, "student": 5 };
        const lide = (window.KB.users || [])
            .filter(u => u.active !== false && u.id !== uid && !pryc.has(u.id))
            // kdo momentálně nepracuje, je až za všemi ostatními
            .sort((a, b) => (a.nepracuje === true ? 1 : 0) - (b.nepracuje === true ? 1 : 0) ||
                            (PORADI[a.role] === undefined ? 9 : PORADI[a.role]) -
                            (PORADI[b.role] === undefined ? 9 : PORADI[b.role]) ||
                            (a.last || "").localeCompare(b.last || "", "cs"));
        kontejner.innerHTML =
            (sJa ? '<label class="quickpanel__ja"><input type="checkbox" value="' + esc(uid) +
                '" data-quick-jaja> Jen pro mě</label>' : "") +
            lide.map(u =>
                '<label' + (u.nepracuje === true ? ' class="je-nepracuje"' : "") + '>' +
                '<input type="checkbox" value="' + esc(u.id) + '"> ' +
                esc(((u.first || "") + " " + (u.last || "")).trim()) +
                (u.nepracuje === true ? ' <span class="tiny muted">(nepracuje)</span>' : "") +
                "</label>").join("");
    };

    function naplnQuickForm(panel, uid) {
        // nabídky (jen jednou, ať se nepřepisuje rozepsaný výběr)
        const komu = panel.querySelector("[data-quick-komu]");
        /* Sebe si zadavatel zaškrtne první volbou „Jen pro mě" – poznámka
           pro sebe je jiný záměr než vzkaz kolegovi a dřív se nedala uložit
           vůbec (bez vybraného člověka to hlásilo chybu). Seznam i řazení
           staví UI.lideDoVyberu, ať je stejný i jinde. */
        /* Seznam se staví jednou – ale ZNOVU, když mezitím dorazil seznam
           lidí: první vykreslení mohlo přijít dřív (vzkazy před lidmi)
           a v „Komu" pak zůstalo jen „Jen pro mě" (našlo se 21. 10. 2026).
           Zaškrtnutí se přenesou. */
        const pocetLidi = String((window.KB.users || []).length);
        if (!komu.querySelector("input") || komu.dataset.lidi !== pocetLidi) {
            const zaskrtnuti = Array.from(komu.querySelectorAll("input:checked")).map(ch => ch.value);
            UI.lideDoVyberu(komu, true);
            komu.querySelectorAll("input").forEach(ch => {
                if (zaskrtnuti.indexOf(ch.value) !== -1) ch.checked = true;
            });
            komu.dataset.lidi = pocetLidi;
        }
        vykresliOblibene();
        profiltrujLidi(panel);
        const projektSel = panel.querySelector("[data-quick-projekt]");
        const projekty = (window.KB.projektyDocs || []).filter(p => !p.uzavreno).map(p => p.nazev);
        if (projekty.length && projektSel.options.length <= 1) {
            projektSel.innerHTML = '<option value="">— bez projektu —</option>' + projekty.map(n =>
                '<option value="' + esc(n) + '">' + esc(n) + "</option>").join("");
        }

    }

    /* MOJE = co mi kdo poslal, ZADANÉ = co jsem poslal já – stejné
       přepínání jako Moje/Všechny u zadaných úkolů (přání Michala 21. 8.). */
    let quickRezim = "moje";

    const IKONA_FOTO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="3" y="6" width="18" height="14" rx="2"></rect>' +
        '<circle cx="12" cy="13" r="3.2"></circle>' +
        '<path d="M8 6l1.6-2h4.8L16 6"></path></svg>';

    function vykresliQuickSeznamy(uid) {
        const jmeno = (id) => {
            const u = (window.KB.users || []).find(x => x.id === id);
            return u ? ((u.first || "") + " " + (u.last || "")).trim() : "";
        };
        const vse = window.KB.quicktodo || [];
        // adresáti jsou v `proUids`; starší záznamy mají jen `proUid`
        const adresati = (q) => (q.proUids && q.proUids.length) ? q.proUids : [q.proUid];
        const jeProMe = (q) => adresati(q).indexOf(uid) !== -1;

        const proMe = vse.filter(jeProMe);
        const odeMe = vse.filter(q => q.odKoho === uid && !jeProMe(q));

        ohlasNove(proMe);

        const radek = (q, mujVzkaz) => {
            /* Splněno se čte podle režimu: společný vzkaz má `hotovo`,
               u „každý sám" rozhoduje, jestli je člověk v `hotoviUids`.
               Zadavatel u svého vzkazu vidí, jestli ho mají všichni. */
            const hotovoMne = mujVzkaz ? UI.quickHotovoVse(q) : UI.quickHotovoPro(q, uid);
            /* „Beru na vědomí": vzkaz zůstane v seznamu, jen zešedne a spadne
               dolů. Na připomínku akce se nedá říct „splněno" – a přitom má
               zmizet z toho, co po mně ještě někdo chce (Michal 16. 9. 2026). */
            const jsemAdresat = adresati(q).indexOf(uid) !== -1;
            const vzatoMne = jsemAdresat && !hotovoMne && UI.quickVzal(q, uid);
            const odlozenoMne = jsemAdresat && !hotovoMne && UI.quickOdlozeno(q, uid);
            // oznámení: štítek místo termínu a „co nejdříve", Beru na vědomí místo Splněno
            const info = UI.jeOznameni(q);
            const poTerminu = !hotovoMne && !info && q.doKdy && q.doKdy < dnesISO();
            /* U společného vzkazu se vypisuje, s kým na tom člověk je –
               sebe v tom seznamu vidět nepotřebuje. */
            const ostatni = adresati(q).filter(x => x !== uid).map(jmeno).filter(Boolean);

            /* hlídka výkazů: oranžově dokud jde o běžící týden, červeně
               v pondělí, kdy je poslední šance doplnit ten minulý */
            const hlidkaBarva = hotovoMne ? "" :
                q.hlidka === "minuly" ? "#c8102e" :
                q.hlidka === "tyden" ? "#b06000" : "";

            /* Náhled screenshotu rovnou v řádku – ať je na první pohled
               vidět, že vzkaz nějaký obrázek nese. Klik na text i na náhled
               otevře vzkaz v okně (Michal 4. 9. 2026). */
            const foto = q.nahled
                ? '<button type="button" class="quickrad__foto" data-quick-detail="' +
                    esc(q.id) + '" title="Otevřít vzkaz i s obrázkem">' +
                    '<img src="' + esc(q.nahled) + '" alt=""></button>'
                : (Number(q.obrazku)
                    ? '<button type="button" class="quickrad__foto quickrad__foto--ikona"' +
                        ' data-quick-detail="' + esc(q.id) + '" title="Vzkaz nese obrázek">' +
                        IKONA_FOTO + "</button>"
                    : "");

            return '<div class="quickrad' +
                (hotovoMne ? " quickrad--hotovo" : (q.asap && !info ? " quickrad--asap" : "")) +
                (vzatoMne || odlozenoMne ? " quickrad--vzato" : "") + '" data-quick-radek="' + esc(q.id) + '">' +
                '<span class="quickrad__text quickrad__text--klik" data-quick-detail="' +
                    esc(q.id) + '" role="button" tabindex="0"' +
                    ' title="Otevřít vzkaz – komentáře a obrázky">' +
                (hlidkaBarva
                    ? '<b style="color:' + hlidkaBarva + '">' + esc(q.text) + "</b>"
                    : UI.textSOdkazy(q.text, q.odkazy)) +
                    '<span class="quickrad__kdo">' +
                        /* Pod nadpisem „Poslal jsem" je „Zadal: já" jen
                           zopakování toho, co už tam stojí – vynechává se. */
                        /* Oddělovač se dává jen MEZI kusy, ne před první –
                           u vlastního vzkazu chybí „Zadal:" a řádek by jinak
                           začínal osamocenou tečkou. */
                        [ info ? '<span class="quickrad__info">ℹ oznámení</span>' : "",
                          mujVzkaz ? "" : "Zadal: " + esc(q.odKohoJmeno || jmeno(q.odKoho) || "?"),
                          q.projekt ? esc(q.projekt) : "",
                          q.asap && !info ? '<span class="quickrad__asap">co nejdříve</span>' : "",
                          q.doKdy && !info ? '<span class="' + (poTerminu ? "quickrad__po" : "") + '">do ' +
                            esc(czDatumKratke(q.doKdy)) + "</span>" : "",
                          esc(UI.quickOpakovani(q))
                        ].filter(Boolean).join(" · ") +
                        (ostatni.length ? "<br>Spoluúčast: " + esc(ostatni.join(", ")) +
                            (q.rezim === "kazdy" ? " · každý sám" : "") : "") +
                        // u „každý sám" je vidět, kolik lidí to už odškrtlo
                        (q.rezim === "kazdy" && ostatni.length
                            ? '<br><span class="quickrad__splnil">' + esc(UI.quickStav(q)) +
                              "</span>" : "") +
                        // kolik lidí si vzkaz vzalo na vědomí (jména v bublině)
                        (UI.quickVedomi(q)
                            ? '<br><span class="quickrad__vzato" title="' +
                              esc(UI.quickVedomiJmena(q).join(", ")) + '">ví o tom ' +
                              esc(UI.quickVedomi(q)) + "</span>" : "") +
                        (vzatoMne
                            ? '<br><span class="quickrad__vzato">beru na vědomí</span>' : "") +
                        (odlozenoMne
                            ? '<br><span class="quickrad__vzato">odloženo do ' +
                              esc(UI.odlozenoText(q.odlozeno[uid])) + "</span>" : "") +
                        (q.rezim !== "kazdy" && q.hotovo && q.hotovoKdo
                            ? '<br><span class="quickrad__splnil">' + (info ? "vzal na vědomí " : "splnil ") +
                              esc(q.hotovoKdo) +
                              (q.hotovoMs ? " · " + esc(czDatumKratke(new Date(q.hotovoMs)
                                  .toISOString().slice(0, 10))) : "") + "</span>" : "") +
                    "</span>" +
                "</span>" +
                foto +
                /* vzkaz svázaný s poznámkou nese odkaz – proklik přistane
                   rovnou na té poznámce (poznamky.html si ji samo otevře);
                   oznámení má místo toho „Otevřít" */
                (q.poznamka && !info ? '<button type="button" class="btn btn--ghost btn--sm"' +
                    ' data-pozn-nahled="' + esc(q.poznamka) + '">Poznámka</button>' : "") +
                UI.quickOtevritHtml(q) +
                /* žádost o zpětný zápis se vyřizuje ve Výkazech – jedním
                   kliknutím povolit den, od dne, nebo odmítnout (22. 9. 2026) */
                (q.zadostZpetne && jsemAdresat && !hotovoMne
                    ? '<a class="btn btn--primary btn--sm" href="vykazy.html#zpetne">Vyřídit</a>' : "") +
                /* Beru na vědomí – jen pro adresáta a jen dokud to není
                   splněné. Zpátky se to vezme kliknutím na totéž. Oznámení
                   ho nemá – tam „Beru na vědomí" stojí místo Splněno. */
                (jsemAdresat && !hotovoMne && !info
                    ? (vzatoMne
                        ? '<button type="button" class="linkbtn" data-quick-vzal="' + esc(q.id) +
                            '" data-zpet="1" title="Zrušit beru na vědomí">Beru ✓</button>'
                        : '<button type="button" class="btn btn--ghost btn--sm" data-quick-vzal="' +
                            esc(q.id) + '" title="Vím o tom – zůstane v seznamu, ale přestane ' +
                            'svítit v odznaku">Beru na vědomí</button>')
                    : "") +
                // odložit na zítra / na pondělí (volby v nabídce), odložené vrátit hned
                (jsemAdresat && !hotovoMne
                    ? (odlozenoMne
                        ? '<button type="button" class="btn btn--ghost btn--sm" data-quick-odlozit-zrus="' +
                            esc(q.id) + '">Vrátit hned</button>'
                        : UI.odlozitTlacitko('data-quick-odlozit="' + esc(q.id) + '"'))
                    : "") +
                // splněné mizí ze seznamu, proto pořádné tlačítko a ne zaškrtávátko
                /* Zadavatel, který mezi adresáty není, nemá co odškrtávat –
                   splnění je na těch, komu vzkaz patří (oznámení za ně na
                   vědomí nebere ani u společného). */
                (mujVzkaz && (q.rezim === "kazdy" || info)
                    ? ""
                    : (hotovoMne
                        ? '<button type="button" class="btn btn--ghost btn--sm" data-quick-hotovo="' +
                            esc(q.id) + '" data-zpet="1">Vrátit</button>'
                        : info
                        ? '<button type="button" class="btn btn--sm btn--primary" data-quick-hotovo="' +
                            esc(q.id) + '">Beru na vědomí</button>'
                        : '<button type="button" class="btn btn--sm quicksplnit" data-quick-hotovo="' +
                            esc(q.id) + '">Splněno</button>')) +
                (q.odKoho === uid ? '<button type="button" class="linkbtn" data-quick-smaz="' +
                    esc(q.id) + '" title="Smazat">×</button>' : "") +
            "</div>";
        };

        /* Splněné se schovávají – jinak by seznam jen rostl. Kdo je chce
           vidět (nebo vrátit), rozklikne si je dole. */
        /* „Co nejdříve" nahoru, pak termíny od nejbližšího, nakonec vzkazy
           bez termínu. Bez řazení by ASAP zapadlo mezi ostatní. */
        const naporadi = (a, b) =>
            // co mám vzaté na vědomí, spadne pod to, co po mně ještě někdo chce
            (UI.quickVzal(a, uid) ? 1 : 0) - (UI.quickVzal(b, uid) ? 1 : 0) ||
            (b.asap ? 1 : 0) - (a.asap ? 1 : 0) ||
            (a.doKdy ? 0 : 1) - (b.doKdy ? 0 : 1) ||
            (a.doKdy || "").localeCompare(b.doKdy || "");

        /* Co je pro mě, se řídí MÝM splněním; co jsem poslal, mizí ze
           seznamu, až to má celá parta. */
        /* Odložené (na zítra / na pondělí) do té doby nejsou v seznamu ani
           v odznaku – leží pod odkazem „Odložené" dole. */
        const aktivniProMe = proMe.filter(q => !UI.quickHotovoPro(q, uid) && !UI.quickOdlozeno(q, uid)).sort(naporadi);
        const odlozene = proMe.filter(q => !UI.quickHotovoPro(q, uid) && UI.quickOdlozeno(q, uid)).sort(naporadi);
        const aktivniOdeMe = odeMe.filter(q => !UI.quickHotovoVse(q)).sort(naporadi);
        /* Historie splněných drží jen poslední týden – starší zůstávají
           v databázi a v týdenních lozích reportů, tady by jen překážely. */
        const tydenZpet = Date.now() - 7 * 24 * 3600 * 1000;
        const mojeRezim = quickRezim !== "zadane";
        // třetí přepínač: jen vzkazy svázané s poznámkou (upozornění kolegů)
        const jenPozn = quickRezim === "poznamky";
        const splnene = (mojeRezim ? proMe : odeMe)
            .filter(q => UI.quickHotovoPro(q, uid) && (!jenPozn || q.poznamka)
                && (q.hotovoMs || q.ms || 0) >= tydenZpet);
        const aktivni = (mojeRezim ? aktivniProMe : aktivniOdeMe)
            .filter(q => !jenPozn || q.poznamka);
        const odlozeneTady = mojeRezim ? odlozene.filter(q => !jenPozn || q.poznamka) : [];

        const seznamHtml =
            '<div class="row" style="gap:6px;margin-bottom:10px">' +
                '<button type="button" class="chip' + (quickRezim === "moje" ? " chip--active" : "") +
                    '" data-quick-rezim="moje">Moje</button>' +
                '<button type="button" class="chip' + (quickRezim === "zadane" ? " chip--active" : "") +
                    '" data-quick-rezim="zadane">Zadané</button>' +
                '<button type="button" class="chip' + (jenPozn ? " chip--active" : "") +
                    '" data-quick-rezim="poznamky">Poznámky</button>' +
            "</div>" +
            /* Řádky jdou do mřížky – na stránce Quick TO-DO se na širokém
               monitoru složí do sloupců místo jednoho úzkého pruhu. */
            (aktivni.length
                ? '<div class="quickmriz">' + aktivni.map(q => radek(q, !mojeRezim)).join("") + "</div>"
                : '<div class="quickpanel__prazdno">' + (mojeRezim
                    ? "Žiješ šťastný život, nikdo po tobě nic nechce."
                    : "Nic zadaného – co jsi poslal, je splněné nebo smazané.") + "</div>") +
            (splnene.length
                ? '<button type="button" class="linkbtn" data-quick-splnene style="margin-top:14px">' +
                    (quickSplneneVidet ? "Skrýt historii" : "Splněné za poslední týden (" + splnene.length + ")") +
                  "</button>" +
                  (quickSplneneVidet
                      ? '<div class="quickmriz">' + splnene.map(q => radek(q, !mojeRezim)).join("") + "</div>"
                      : "")
                : "") +
            (odlozeneTady.length
                ? '<button type="button" class="linkbtn" data-quick-odlozene style="margin-top:14px;display:block">' +
                    (quickOdlozeneVidet ? "Skrýt odložené" : "Odložené (" + odlozeneTady.length + ")") + "</button>" +
                  (quickOdlozeneVidet
                      ? '<div class="quickmriz">' + odlozeneTady.map(q => radek(q, false)).join("") + "</div>"
                      : "")
                : "");
        document.querySelectorAll("[data-quick-seznam]").forEach(el => {
            el.innerHTML = seznamHtml;
        });

        // odznak s počtem nesplněných na tlačítku v pásu
        // vzaté na vědomí v odznaku nesvítí – vím o tom, nemusí mě to honit; odložené taky ne
        const kolik = aktivniProMe.filter(q => !UI.quickVzal(q, uid)).length;
        document.querySelectorAll("[data-quick-pocet]").forEach(el => {
            el.textContent = kolik;
            el.hidden = !kolik;
        });
        srovnejSkupiny();
    }

    /* ------------------------------------------------------ správa aut ---
       Panel jako Quick TO-DO, jen s jiným obsahem: nahoře „AUTO BRNO" –
       nejbližší pracovní dny, pod každým se člověk přidá tlačítkem +.
       Dole rezervace tří vozů (od–do a kam se jede). Vidí to celá firma,
       jinak by se dva domlouvali na tomtéž autě přes hlavu toho druhého. */

    const AUTA = ["TOYOTA", "ROOMSTER", "YETI"];
    const DNY_CZ = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
    const PRACOVNICH_DNU = 10;      // dva týdny dopředu; dál se stejně neplánuje

    let autoVybrane = "";           // u kterého vozu je rozevřený formulář
    /* Otevření poznámky funguje odkudkoliv – z panelu v pásu i z dlaždice
       na nástěnce. Jedna obsluha pro celý web. */
    document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-pozn-nahled]");
        if (b) { e.preventDefault(); UI.otevriPoznamku(b.dataset.poznNahled); }
    });

    let autoPridavam = "";          // u kterého dne je rozevřený výběr člověka

    function mountAutaPanel() {
        if (document.getElementById("kbAutaPanel")) return;
        const panel = document.createElement("div");
        panel.id = "kbAutaPanel";
        panel.className = "hookno no-print";
        panel.hidden = true;
        panel.innerHTML =
            '<div class="hookno__deska card">' +
                '<div class="hookno__hlava">Správa aut' +
                    '<button type="button" class="linkbtn linkbtn--tmavy"' +
                        " data-auta-zavri>Zavřít</button></div>" +
                '<div class="hookno__telo quickpanel__telo" data-auta-telo></div>' +
            "</div>";
        document.body.appendChild(panel);
        panel.addEventListener("click", (event) => {
            if (event.target === panel) prepniAuta(false);
        });
    }

    function prepniAuta(otevrit) {
        const panel = document.getElementById("kbAutaPanel");
        if (panel) panel.hidden = !otevrit;
    }

    /* ------------------------------------------------ HOME OFFICE ------
       Stejný panel jako Správa aut: dny na dva týdny dopředu a u každého
       tři tlačítka – Home office, Volno, Dovolená. Člověk se zaklikne sám;
       zapisuje se to do kalendáře (typ homeoffice/volno/dovolena), takže
       to manažer vidí na nástěnce a dovolenou potvrzuje jako ostatní.
       Odkliknutí vlastní volby ji zase smaže. */

    const HO_DNU = 20;          // čtyři týdny dopředu

    /* Druhy, které se u dne hlásí jako „kdo další chybí". Klíč sedí na
       `typ` v kalendáři. */
    const POPIS_TYPU = { homeoffice: 1, volno: 1, dovolena: 1, doktor: 1 };

    const HO_TYPY = [
        { id: "homeoffice", popis: "HO",       cely: "Home office" },
        { id: "volno",      popis: "Volno",    cely: "Volno" },
        { id: "dovolena",   popis: "Dovolená", cely: "Dovolená" },
        { id: "doktor",     popis: "Doktor",   cely: "Doktor" }
    ];

    /* Okno uprostřed, ne vysouvací deska – vysouvání se u pásu sekalo
       a bylo vidět skrz (přání Michala 26. 8. 2026 večer). */
    function mountHoPanel() {
        if (document.getElementById("kbHoPanel")) return;
        const panel = document.createElement("div");
        panel.id = "kbHoPanel";
        panel.className = "hookno no-print";
        panel.hidden = true;
        panel.innerHTML =
            '<div class="hookno__deska card hookno__deska--siroka">' +
                '<div class="hookno__hlava">Rychlý zápis' +
                    '<button type="button" class="linkbtn linkbtn--tmavy"' +
                        " data-ho-zavri>Zavřít</button></div>" +
                '<div class="hookno__telo" data-ho-telo></div>' +
            "</div>";
        document.body.appendChild(panel);
        panel.addEventListener("click", (event) => {
            if (event.target === panel) prepniHo(false);
        });
    }

    /** Vlastní záznam z panelu pro den+typ – jen ty jdou odkliknout. */
    function mujHoZaznam(iso, typ) {
        const uid = window.KB.currentUid ? window.KB.currentUid() : "";
        return (window.KB.kalendar || []).find(k =>
            k.uid === uid && k.typ === typ && k.zdroj !== "vykaz" &&
            (k.od || "") <= iso && iso <= (k.do || k.od || ""));
    }

    /** Pracovní dny rozdělené po týdnech: [{ popis: "31. 8. – 4. 9.", dny }]. */
    function tydnyPracovnichDnu(kolik) {
        const tydny = [];
        let posledni = null;
        pracovniDny(kolik).forEach(den => {
            const d = new Date(den.iso + "T00:00:00");
            const po = new Date(d);
            po.setDate(d.getDate() - (d.getDay() + 6) % 7);
            const klic = po.toISOString().slice(0, 10);
            if (!posledni || posledni.klic !== klic) {
                const pa = new Date(po); pa.setDate(po.getDate() + 4);
                posledni = { klic: klic, dny: [],
                    popis: po.getDate() + ". " + (po.getMonth() + 1) + ". – " +
                           pa.getDate() + ". " + (pa.getMonth() + 1) + "." };
                tydny.push(posledni);
            }
            posledni.dny.push(den);
        });
        return tydny;
    }
    UI.tydnyPracovnichDnu = tydnyPracovnichDnu;

    function renderHo() {
        const telo = document.querySelector("#kbHoPanel [data-ho-telo]");
        if (!telo) return;
        const uid = window.KB.currentUid ? window.KB.currentUid() : "";

        const den2html = (den) => {
            const tlacitka = HO_TYPY.map(t => {
                const muj = mujHoZaznam(den.iso, t.id);
                return '<button type="button" class="hoden__btn' +
                    (muj ? " hoden__btn--zap" : "") +
                    '" data-ho-den="' + den.iso + '" data-ho-typ="' + t.id + '"' +
                    ' title="' + t.cely + '">' + t.popis + "</button>";
            }).join("");
            /* Kdo další ten den chybí – NEJEN home office. Dovolená, volno
               i doktor patří k plánování stejně (přání Michala 1. 9. 2026).
               Řadí se podle druhu, jména jen křestní, ať se to vejde. */
            const kdoJinde = {};
            (window.KB.kalendar || []).forEach(k => {
                if (k.uid === uid || !POPIS_TYPU[k.typ]) return;
                if ((k.od || "") > den.iso || den.iso > (k.do || k.od || "")) return;
                const jmeno = (k.osoba || "").split(" ")[0];
                if (!jmeno) return;
                (kdoJinde[k.typ] = kdoJinde[k.typ] || []).push(jmeno);
            });
            const poznamka = HO_TYPY.map(t => kdoJinde[t.id]
                ? t.popis + ": " + kdoJinde[t.id].join(", ") : "").filter(Boolean).join(" · ");

            return '<div class="hoden">' +
                '<span class="hoden__den"><b>' + esc(den.nazev) + "</b> " +
                    esc(den.popis) + "</span>" +
                (den.svatek ? '<span class="hoden__svatek" title="' + esc(den.svatek) +
                    '">svátek</span>' : "") +
                '<span class="hoden__tlacitka">' + tlacitka + "</span>" +
                (poznamka
                    ? '<span class="hoden__ostatni" title="Kdo další ten den chybí">' +
                        esc(poznamka) + "</span>" : "") +
            "</div>";
        };

        telo.classList.add("hookno__telo--mriz");
        telo.innerHTML =
            '<p class="tiny muted" style="margin:0;line-height:1.6;grid-column:1/-1">' +
                "Zaklikni si dny dopředu. <b>Dovolená</b> = jedeš pryč," +
                " <b>Volno</b> = jsi doma a nepracuješ, <b>HO</b> = pracuješ" +
                " z domu. Uvidí to všichni v kalendáři; dovolená a volno se" +
                " rovnou zapíšou i do výkazu a potvrzuje je manažer.</p>" +
            tydnyPracovnichDnu(HO_DNU).map((tyden, i) =>
                '<section class="hotyden hotyden--' + (i % 2) + '">' +
                    '<div class="hotyden__hlava">Týden ' + esc(tyden.popis) + "</div>" +
                    tyden.dny.map(den2html).join("") +
                "</section>").join("");
    }

    function prepniHo(otevrit) {
        const panel = document.getElementById("kbHoPanel");
        if (panel) panel.hidden = !otevrit;
    }

    document.addEventListener("click", async (event) => {
        if (event.target.closest("[data-ho-otevri]")) {
            mountHoPanel();
            renderHo();
            prepniHo(true);
            return;
        }
        if (event.target.closest("[data-ho-zavri]")) {
            prepniHo(false);
            return;
        }
        const volba = event.target.closest("#kbHoPanel [data-ho-typ]");
        if (volba) {
            const iso = volba.dataset.hoDen, typ = volba.dataset.hoTyp;
            /* Dovolená a volno jdou i do výkazu – a uzavřený měsíc (uzávěrka
               výkazů) databáze nemanažerovi nepustí. Ať to člověk ví hned,
               ne z obecné chyby. HO je jen kalendář, toho se to netýká. */
            const cara = String((window.KB && window.KB.uzaverkaOd) || "");
            const predtim = mujHoZaznam(iso, typ);
            const sahaNaVykaz = predtim ? !!predtim.vykazId : typ !== "homeoffice";
            if (cara && iso < cara && sahaNaVykaz && !UI.can("vykaz.view")) {
                UI.toast("Měsíc je uzavřený – oprava přes Nahlásit chybu ve Výkazech.", "warn");
                return;
            }
            volba.disabled = true;
            try {
                const muj = mujHoZaznam(iso, typ);
                if (muj) {
                    /* Odklik ruší kalendář I výkaz. Smazat výkaz smí vlastník
                       jen u záznamů z panelu (firestore.rules, zdroj=panel). */
                    if (muj.vykazId) {
                        await window.KB.deleteVykaz(muj.vykazId).catch(err => {
                            console.warn("Výkaz se nepodařilo smazat:", err);
                            UI.toast("Kalendář zrušen; výkaz musí smazat manažer" +
                                " (nová pravidla databáze ještě nejsou nasazená).", "warn");
                        });
                    }
                    await window.KB.deleteUdalost(muj.id);
                } else if (typ === "homeoffice") {
                    // HO je jen plán v kalendáři – hodiny se vykazují normálně
                    await window.KB.saveUdalost(window.KB.newUdalostId(), {
                        typ: typ, od: iso, do: iso, celyDen: true, zdroj: "panel"
                    });
                } else {
                    /* Volno a dovolená jdou rovnou i do výkazu jako celodenní
                       absence – do Tabulek Google je skript pustí až po tom,
                       co den proběhne. */
                    const jmeno = window.KB_USER || "";
                    const popis = typ === "dovolena" ? "Dovolená"
                        : typ === "doktor" ? "Doktor" : "Volno";
                    const vykazId = "vyk_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
                    await window.KB.saveMujVykaz(vykazId, {
                        datum: iso, zakazka: popis, nazev: popis + " – " + jmeno,
                        osoba: jmeno, absence: true, celyden: true,
                        od: "00:00", do: "23:59", pauza: 0, hodinyPevne: 8,
                        cinnost: "", firma: "", km: 0, obed: false, zdroj: "panel"
                    });
                    await window.KB.saveUdalost(window.KB.newUdalostId(), {
                        typ: typ, od: iso, do: iso, celyDen: true,
                        zdroj: "panel", vykazId: vykazId
                    });
                }
            } catch (err) {
                console.error(err);
                UI.toast("Uložení selhalo.", "error");
            } finally {
                volba.disabled = false;
            }
            return;
        }
    });

    // panel se překresluje, jak chodí kalendář z databáze
    document.addEventListener("DOMContentLoaded", () => {
        if (window.KB && window.KB.on) window.KB.on("kalendar", renderHo);
    });

    /** „1 člověk / 3 lidé / 6 lidí" – jinak by v pruhu svítilo „1 lidí". */
    const V_pocetLidi = (n) =>
        n + " " + (n === 1 ? "člověk" : (n >= 2 && n <= 4 ? "lidé" : "lidí"));

    /** Nejbližší pracovní dny od dneška – víkendy se do Brna nejezdí. */
    function pracovniDny(kolik) {
        const dny = [];
        const d = new Date();
        while (dny.length < kolik) {
            const den = d.getDay();
            if (den !== 0 && den !== 6) {
                const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
                    "-" + String(d.getDate()).padStart(2, "0");
                dny.push({
                    iso: iso,
                    nazev: DNY_CZ[den],
                    popis: d.getDate() + ". " + (d.getMonth() + 1) + ".",
                    svatek: UI.svatek(iso)
                });
            }
            d.setDate(d.getDate() + 1);
        }
        return dny;
    }

    function renderAuta() {
        const telo = document.querySelector("#kbAutaPanel [data-auta-telo]");
        if (!telo) return;
        const uid = window.KB.currentUid ? window.KB.currentUid() : "";
        const zaznamy = window.KB.auta || [];
        const dnes = dnesISO();

        /* ---- AUTO BRNO: kdo který den jede ---- */
        const brnoHtml = tydnyPracovnichDnu(PRACOVNICH_DNU).map((tyden, ti) =>
            '<section class="hotyden hotyden--' + (ti % 2) + '">' +
                '<div class="hotyden__hlava">Týden ' + esc(tyden.popis) + "</div>" +
                tyden.dny.map(den => {
            const lide = zaznamy.filter(z => z.druh === "brno" && z.datum === den.iso);
            const jsemTam = lide.some(z => z.uid === uid);
            /* Kdo veze partu, přihlásí i kolegy – proto je „přidat člověka"
               vedle odhlášení. Nabízejí se jen ti, kdo na dni ještě nejsou. */
            const zbyva = (window.KB.users || [])
                .filter(u => u.active !== false && !lide.some(z => z.uid === u.id))
                .sort((a, b) => (a.last || "").localeCompare(b.last || "", "cs"));

            return '<div class="auta__den">' +
                '<div class="auta__denhlava">' +
                    "<b>" + esc(den.nazev) + "</b> " + esc(den.popis) +
                    (den.svatek ? ' <span class="hoden__svatek" title="' + esc(den.svatek) +
                        '">svátek</span>' : "") +
                    '<span class="auta__pocetlidi">' +
                        (lide.length ? V_pocetLidi(lide.length) : "nikdo") + "</span>" +
                    (jsemTam
                        ? '<button type="button" class="linkbtn" data-auto-odhlas="' +
                            esc((lide.find(z => z.uid === uid) || {}).id || "") + '">odhlásit se</button>'
                        : '<button type="button" class="auta__plus" data-auto-brno="' + den.iso +
                            '" title="Přidat se na tenhle den">+</button>') +
                    (zbyva.length
                        ? '<button type="button" class="linkbtn" data-auto-pridej="' + den.iso + '">' +
                            (autoPridavam === den.iso ? "zavřít" : "+ člověk") + "</button>"
                        : "") +
                "</div>" +
                (autoPridavam === den.iso
                    ? '<div class="auta__vyber">' + zbyva.map(u =>
                        '<button type="button" class="auta__clovek auta__clovek--pridat" ' +
                            'data-auto-kolega="' + den.iso + "|" + esc(u.id) + '">+ ' +
                            esc(((u.first || "") + " " + (u.last || "")).trim()) + "</button>").join("") +
                      "</div>"
                    : "") +
                (lide.length
                    ? '<div class="auta__lide">' + lide.map(z =>
                        '<span class="auta__clovek' + (z.uid === uid ? " je-ja" : "") + '">' +
                        esc(z.jmeno || "?") +
                        '<button type="button" class="auta__x" data-auto-odhlas="' + esc(z.id) +
                            '" title="Odebrat z tohohle dne">×</button></span>').join("") + "</div>"
                    : '<span class="auta__prazdno">zatím nikdo</span>') +
            "</div>";
        }).join("") + "</section>").join("");

        /* ---- rezervace vozů ---- */
        const rezervaceHtml = AUTA.map(auto => {
            const moje = zaznamy.filter(z => z.druh === "rezervace" && z.auto === auto &&
                (z.do || z.od || "") >= dnes);
            return '<div class="auta__vuz">' +
                '<button type="button" class="auta__vuzhlava' + (autoVybrane === auto ? " je-otevreny" : "") +
                    '" data-auto-vyber="' + esc(auto) + '">' +
                    "<b>" + esc(auto) + "</b>" +
                    '<span class="auta__pocet">' + (moje.length ? moje.length + "×" : "volné") + "</span>" +
                "</button>" +
                (autoVybrane === auto
                    ? '<div class="auta__form">' +
                        '<div class="auta__radek">' +
                            '<label>Od<input type="date" class="field" data-auto-od value="' + dnes + '"></label>' +
                            '<label>Do<input type="date" class="field" data-auto-do value="' + dnes + '"></label>' +
                        "</div>" +
                        '<input type="text" class="field" data-auto-kam maxlength="200" placeholder="Kam jedeš (např. Brno – zaměření)">' +
                        '<button type="button" class="btn btn--primary btn--sm" data-auto-uloz="' +
                            esc(auto) + '">Rezervovat</button>' +
                      "</div>"
                    : "") +
                (moje.length
                    ? '<div class="auta__seznam">' + moje.map(z =>
                        '<div class="auta__rez">' +
                            '<span class="auta__rezkdy">' + esc(czDatumKratke(z.od)) +
                                (z.do && z.do !== z.od ? " – " + esc(czDatumKratke(z.do)) : "") + "</span>" +
                            '<span class="auta__rezkdo"><b>' + esc(z.jmeno || "?") + "</b>" +
                                (z.kam ? " – " + esc(z.kam) : "") + "</span>" +
                            (z.uid === uid || UI.isAdmin()
                                ? '<button type="button" class="linkbtn" data-auto-smaz="' + esc(z.id) + '">zrušit</button>'
                                : "") +
                        "</div>").join("") + "</div>"
                    : "") +
            "</div>";
        }).join("");

        telo.innerHTML =
            '<div class="auta__nadpis">Auto Brno</div>' +
            '<p class="tiny muted" style="margin:0 0 8px;line-height:1.5">' +
                "Přidej se na den, kdy jedeš – ostatní uvidí, s kým se svezou.</p>" +
            brnoHtml +
            '<div class="auta__nadpis" style="margin-top:16px">Rezervace</div>' +
            rezervaceHtml;
    }

    /* Změna „Od" táhne „Do" s sebou: skoro každá rezervace je na jeden
       den a nechávat v „Do" dnešek nutilo opravovat dvě pole místo jednoho.
       Kdo si „Do" nastavil dál do budoucna, tomu se nesahá. */
    document.addEventListener("change", (event) => {
        const od = event.target.closest("#kbAutaPanel [data-auto-od]");
        if (!od) return;
        const doPole = document.querySelector("#kbAutaPanel [data-auto-do]");
        if (doPole && (!doPole.value || doPole.value < od.value)) doPole.value = od.value;
    });

    async function ulozRezervaci(auto) {
        const telo = document.querySelector("#kbAutaPanel [data-auta-telo]");
        const od = telo.querySelector("[data-auto-od]").value;
        const doKdy = telo.querySelector("[data-auto-do]").value || od;
        const kam = telo.querySelector("[data-auto-kam]").value.trim();
        if (!od) return void UI.toast("Vyber, od kdy auto potřebuješ.", "warn");
        if (doKdy < od) return void UI.toast("Datum do nesmí být dřív než datum od.", "warn");
        try {
            await window.KB.saveAuto(window.KB.newAutoId(), {
                druh: "rezervace", auto: auto, od: od, do: doKdy, kam: kam
            });
            /* Formulář se zavírá tady, ne až s příchodem dat: překreslení
               přijde ze snapshotu a to by ještě četlo starou hodnotu. */
            autoVybrane = "";
            renderAuta();
            UI.toast("Auto " + auto + " rezervované.");
        } catch (err) {
            console.error(err);
            UI.toast("Rezervace se neuložila.", "error");
        }
    }

    document.addEventListener("click", (event) => {
        if (event.target.closest("[data-instalace]")) UI.nainstalujAplikaci();
    });

    document.addEventListener("click", async (event) => {
        if (event.target.closest("[data-auta-otevri]")) {
            window.KB.watchAuta();      // data si řekne až otevřený panel
            mountAutaPanel();
            renderAuta();
            prepniAuta(true);
            return;
        }
        if (event.target.closest("[data-auta-zavri]")) {
            prepniAuta(false);
            return;
        }

        const brno = event.target.closest("[data-auto-brno]");
        if (brno) {
            try {
                await window.KB.saveAuto(window.KB.newAutoId(),
                    { druh: "brno", datum: brno.dataset.autoBrno });
            } catch (err) { UI.toast("Přidání se nepovedlo.", "error"); }
            return;
        }
        const pridej = event.target.closest("[data-auto-pridej]");
        if (pridej) {
            autoPridavam = autoPridavam === pridej.dataset.autoPridej ? "" : pridej.dataset.autoPridej;
            renderAuta();
            return;
        }
        const kolega = event.target.closest("[data-auto-kolega]");
        if (kolega) {
            const [datum, kdo] = kolega.dataset.autoKolega.split("|");
            const clovek = (window.KB.users || []).find(u => u.id === kdo);
            try {
                await window.KB.saveAuto(window.KB.newAutoId(), {
                    druh: "brno", datum: datum, uid: kdo,
                    jmeno: clovek ? ((clovek.first || "") + " " + (clovek.last || "")).trim() : ""
                });
                autoPridavam = "";
                renderAuta();
            } catch (err) { UI.toast("Přidání se nepovedlo.", "error"); }
            return;
        }
        const odhlas = event.target.closest("[data-auto-odhlas]");
        if (odhlas) {
            window.KB.deleteAuto(odhlas.dataset.autoOdhlas)
                .catch(() => UI.toast("Odhlášení se nepovedlo.", "error"));
            return;
        }
        const vyber = event.target.closest("[data-auto-vyber]");
        if (vyber) {
            // druhé kliknutí na tentýž vůz formulář zase zavře
            autoVybrane = autoVybrane === vyber.dataset.autoVyber ? "" : vyber.dataset.autoVyber;
            renderAuta();
            return;
        }
        const uloz = event.target.closest("[data-auto-uloz]");
        if (uloz) return void ulozRezervaci(uloz.dataset.autoUloz);

        const smaz = event.target.closest("[data-auto-smaz]");
        if (smaz) {
            window.KB.deleteAuto(smaz.dataset.autoSmaz)
                .catch(() => UI.toast("Zrušení se nepovedlo.", "error"));
            return;
        }
    });

    /* ------------------------------------------------------- vybavení ---
       Rezervace přístrojů (skenery, dálkoměry, notebooky…) – panel jako
       Správa aut. Kód je ve vlastním souboru assets/js/vybaveni.js a načte
       se až prvním otevřením z pásu: většina návštěv webu ho nepotřebuje.
       S ním i nabídka ⋯ (nabidka.js + .css), pokud ji stránka sama nemá.
       Verze (?v=) se bere z ui.js na téže stránce – po zvednutí verze tak
       nepřijde starý soubor z mezipaměti. */

    const verzeWebu = () => {
        const s = document.querySelector('script[src*="assets/js/ui.js"]');
        const m = s && /[?&]v=([^&#]+)/.exec(s.getAttribute("src") || "");
        return m ? m[1] : "";
    };
    const nacitaneSoubory = {};

    /** Načte skript nebo styl webu (cesta od kořene, např. "assets/js/x.js"). */
    UI.nactiSoubor = (cesta) => {
        if (nacitaneSoubory[cesta]) return nacitaneSoubory[cesta];
        nacitaneSoubory[cesta] = new Promise((hotovo, chyba) => {
            const v = verzeWebu();
            const adresa = cesta + (v ? "?v=" + encodeURIComponent(v) : "");
            const css = /\.css$/.test(cesta);
            const el = document.createElement(css ? "link" : "script");
            if (css) { el.rel = "stylesheet"; el.href = adresa; } else { el.src = adresa; }
            el.onload = () => hotovo();
            el.onerror = () => {
                delete nacitaneSoubory[cesta];
                el.remove();
                chyba(new Error("Nenačetl se soubor " + cesta));
            };
            document.head.appendChild(el);
        });
        return nacitaneSoubory[cesta];
    };

    document.addEventListener("click", (event) => {
        if (!event.target.closest || !event.target.closest("[data-vybaveni-otevri]")) return;
        const nacist = [];
        if (!window.KBNabidka) nacist.push(UI.nactiSoubor("assets/js/nabidka.js"));
        if (!document.querySelector('link[href*="assets/css/nabidka.css"]')) {
            nacist.push(UI.nactiSoubor("assets/css/nabidka.css"));
        }
        if (!window.KBVybaveni) nacist.push(UI.nactiSoubor("assets/js/vybaveni.js"));
        Promise.all(nacist).then(
            () => window.KBVybaveni.otevri(),
            (err) => {
                console.error(err);
                UI.toast("Vybavení se nenačetlo – zkus obnovit stránku.", "error");
            });
    });

    /**
     * Otevře panel Quick TO-DO. `volby` (nepovinné) ho předvyplní – „Quick
     * TO-DO k úkolu…" na stránce Úkoly: { odkaz: {t, id, n}, komu: [uid],
     * projekt }. Rozepsaný text zůstane, odkaz se připíše za něj; adresáti
     * se nastaví přesně na `komu` (bez sebe – sám sobě jen „Jen pro mě").
     */
    UI.otevriQuickPanel = (volby) => {
        const o = volby || {};
        mountQuickPanel();
        renderQuick();
        prepniQuick(true);
        const panel = document.getElementById("kbQuickPanel");
        const pole = panel.querySelector("[data-quick-text]");
        const odkaz = UI.cisteOdkazy(o.odkaz ? [o.odkaz] : [])[0];
        if (odkaz) {
            const ted = pole.value.replace(/\s+$/, "");
            pole.value = (ted ? ted + " " : "") + "#" + odkaz.n + " ";
            pole.kbOdkazy = (pole.kbOdkazy || []).concat([odkaz]);
        }
        if (Array.isArray(o.komu)) {
            const ja = window.KB.currentUid();
            const komu = o.komu.filter(u => u && u !== ja);
            if (!komu.length && o.komu.indexOf(ja) !== -1) komu.push(ja);
            panel.querySelectorAll("[data-quick-komu] input").forEach(ch => {
                ch.checked = komu.indexOf(ch.value) !== -1;
            });
            profiltrujLidi(panel);
        }
        const projektSel = panel.querySelector("[data-quick-projekt]");
        if (o.projekt && Array.from(projektSel.options).some(x => x.value === o.projekt)) {
            projektSel.value = o.projekt;
        }
        setTimeout(() => {
            pole.focus();
            pole.setSelectionRange(pole.value.length, pole.value.length);
        }, 60);
    };

    document.addEventListener("click", async (event) => {
        if (event.target.closest("[data-quick-otevri]")) {
            UI.otevriQuickPanel();
            return;
        }
        if (event.target.closest("[data-quick-zavri]")) {
            prepniQuick(false);
            return;
        }
        const smaz = event.target.closest("[data-quick-smaz]");
        if (smaz) {
            /* Dlaždice na nástěnce má vlastní obsluhu – bez téhle zábrany
               se mazalo dvakrát: první pokus vzkaz smazal, druhý spadl na
               právech a vyhodil „Smazání selhalo", ačkoli vzkaz zmizel. */
            if (!smaz.closest("#kbQuickPanel, [data-quick-seznam]")) return;
            window.KB.deleteQuickTodo(smaz.dataset.quickSmaz)
                .catch(() => UI.toast("Smazání selhalo.", "error"));
            return;
        }
        /* Rozkliknutí vzkazu – okno s obrázkem, splněním a komentáři.
           Odkaz „#projekt / #úkol" v textu vede tam, kam ukazuje. */
        const detail = event.target.closest("[data-quick-detail]");
        if (detail && !event.target.closest("a[href]")) {
            UI.otevriQuick(detail.dataset.quickDetail);
            return;
        }
        if (event.target.closest("[data-quick-vlozit]")) {
            try {
                const kusy = await navigator.clipboard.read();
                for (const p of kusy) {
                    const typ = (p.types || []).find(t => t.indexOf("image/") === 0);
                    if (typ) return void pridejQuickObrazky([await p.getType(typ)]);
                }
                UI.toast("Ve schránce není obrázek – stiskni PrintScreen" +
                    " (nebo Win+Shift+S) a klikni znovu.", "warn");
            } catch (err) {
                UI.toast("Prohlížeč schránku nevydal – vlož screenshot klávesami Ctrl+V.", "warn");
            }
            return;
        }
        if (event.target.closest("[data-quick-vybrat]")) {
            const pole = document.querySelector("[data-quick-soubor]");
            if (pole) pole.click();
            return;
        }
        const odeber = event.target.closest("[data-quick-odeber]");
        if (odeber) {
            quickNoveObrazky.splice(Number(odeber.dataset.quickOdeber), 1);
            vykresliQuickNahledy();
            return;
        }
        if (event.target.closest("[data-quick-koment-odesli]")) {
            const pole = document.querySelector("[data-quick-koment]");
            const text = pole ? pole.value.trim() : "";
            if (!text || !quickOknoId) return;
            try {
                await window.KB.pridejQuickKomentar(quickOknoId, text);
                pole.value = "";
            } catch (err) {
                console.error(err);
                UI.toast("Komentář se neuložil.", "error");
            }
            return;
        }

        const quickPrep = event.target.closest("[data-quick-rezim]");
        if (quickPrep) {
            quickRezim = quickPrep.dataset.quickRezim;
            renderQuick();
            return;
        }
        if (event.target.closest("[data-quick-splnene]")) {
            quickSplneneVidet = !quickSplneneVidet;
            renderQuick();
            return;
        }
        if (event.target.closest("[data-quick-odlozene]")) {
            quickOdlozeneVidet = !quickOdlozeneVidet;
            renderQuick();
            return;
        }
        // odložený vzkaz zpátky hned (stránka Quick TO-DO i dlaždice nástěnky)
        const nevracet = event.target.closest("[data-quick-odlozit-zrus]");
        if (nevracet) {
            const q = (window.KB.quicktodo || []).find(x => x.id === nevracet.dataset.quickOdlozitZrus);
            if (q) UI.quickOdloz(q, 0);
            return;
        }
        const vzalBtn = event.target.closest("[data-quick-vzal]");
        if (vzalBtn && vzalBtn.tagName === "BUTTON") {
            const id = vzalBtn.dataset.quickVzal;
            const vzal = !vzalBtn.dataset.zpet;
            window.KB.quickVzetiNaVedomi(id, vzal)
                .then(() => UI.toast(vzal ? "Vzato na vědomí." : "Vráceno mezi nové.", undefined,
                    { zpet: () => window.KB.quickVzetiNaVedomi(id, !vzal) }))
                .catch(() => UI.toast("Uložení selhalo.", "error"));
            return;
        }

        // Splněno / Vrátit – tlačítkem, ne zaškrtávátkem
        const hotovoBtn = event.target.closest("[data-quick-hotovo]");
        if (hotovoBtn && hotovoBtn.tagName === "BUTTON") {
            // dlaždice na nástěnce si Splněno obsluhuje sama – viz mazání výš
            if (!hotovoBtn.closest("#kbQuickPanel, #kbQuickOkno, [data-quick-seznam]")) return;
            const q = (window.KB.quicktodo || []).find(x => x.id === hotovoBtn.dataset.quickHotovo);
            if (q) {
                const hotovo = !hotovoBtn.dataset.zpet;
                UI.quickPrepni(q, hotovo)
                    .then(() => UI.toast(hotovo ? UI.quickHlaskaSplneno(q)
                        : UI.jeOznameni(q) ? "Vráceno mezi nová oznámení." : "Vráceno mezi nesplněné.", undefined, {
                        // vrací se nad čerstvým vzkazem – mezitím ho mohl odškrtnout i někdo další
                        zpet: () => UI.quickPrepni((window.KB.quicktodo || [])
                            .find(x => x.id === q.id) || q, !hotovo)
                    }))
                    .catch(() => UI.toast("Uložení selhalo.", "error"));
            }
            return;
        }
        if (!event.target.closest("[data-quick-uloz]")) return;

        const panel = document.getElementById("kbQuickPanel");
        const pole = panel.querySelector("[data-quick-text]");
        const text = pole.value.trim();
        const komu = vybraniKomu();
        // screenshot sám o sobě dává smysl – ať kvůli němu nikdo nevymýšlí text
        if (!text && !quickNoveObrazky.length) {
            return UI.toast("Napiš, co se nemá zapomenout – nebo vlož screenshot.", "warn");
        }
        if (!komu.length) return UI.toast("Vyber, komu vzkaz patří – nebo zaškrtni Jen pro mě.", "warn");

        // „Jen pro informaci" = oznámení: bez termínu a opakování, každý bere na vědomí sám
        const info = !!panel.querySelector('[data-quick-druh][value="info"]:checked');
        const asap = !info && panel.querySelector("[data-quick-asap]").checked;
        const kazdy = info || panel.querySelector("[data-quick-kazdy]").checked;
        const doKdy = info ? "" : panel.querySelector("[data-quick-kdy]").value;
        const projekt = panel.querySelector("[data-quick-projekt]").value;
        const opakovani = info ? "" : panel.querySelector("[data-quick-opakovani]").value;
        // další termín se počítá od termínu – bez něj (i u „co nejdříve") není od čeho
        if (opakovani && (asap || !doKdy)) {
            return UI.toast("Opakovaný vzkaz potřebuje termín „Do“ – další se počítá od něj.", "warn");
        }

        try {
            /* Jeden vzkaz pro všechny vybrané. Ve společném režimu ho kdokoliv
               odškrtne za všechny; v „každý sám" si ho škrtá každý zvlášť. */
            const id = window.KB.newQuickId();
            const odkazy = UI.odkazyPole(pole);
            await window.KB.saveQuickTodo(id, Object.assign({
                text: text || "(jen screenshot)", proUids: komu,
                doKdy: asap ? "" : doKdy,   // „co nejdříve" termín nemá
                asap: asap,
                rezim: kazdy ? "kazdy" : "",
                druh: info ? "info" : "",
                projekt: projekt,
                opakovani: opakovani
            }, odkazy.length ? { odkazy: odkazy } : {}));

            /* Zmínka přes @: kdo není mezi adresáty, dostane vlastní vzkaz
               „Zmínil tě v Quick TO-DO" – původní vzkaz by neviděl. */
            let zmineni = [];
            try {
                zmineni = await UI.ohlasZminky(UI.zminkyVTextu(text).filter(u => komu.indexOf(u) === -1),
                    "Zmínil tě v Quick TO-DO: " + text, { projekt: projekt, odkazy: odkazy });
            } catch (err) {
                console.warn("Vzkaz o zmínce se nezapsal:", err);
            }

            /* Obrázky až po vzkazu – pravidla se u nich ptají rodičovského
               dokumentu, takže dřív by na ně nikdo neměl právo. Náhled jde
               s prvním z nich, ať je vzkaz v seznamu poznat na první pohled. */
            if (quickNoveObrazky.length) {
                const nahled = await UI.nahledObrazku(quickNoveObrazky[0]);
                for (let i = 0; i < quickNoveObrazky.length; i++) {
                    await window.KB.pridejQuickObrazek(id, quickNoveObrazky[i],
                        i === 0 ? nahled : "");
                }
                quickNoveObrazky = [];
                vykresliQuickNahledy();
            }

            pole.value = "";
            pole.kbOdkazy = [];
            panel.querySelector("[data-quick-kdy]").value = "";
            panel.querySelector("[data-quick-asap]").checked = false;
            panel.querySelector("[data-quick-kazdy]").checked = false;
            panel.querySelector("[data-quick-opakovani]").value = "";
            panel.querySelector("[data-quick-projekt]").value = "";
            panel.querySelectorAll("[data-quick-komu] input:checked")
                .forEach(ch => { ch.checked = false; });
            panel.querySelector("[data-quick-hledej]").value = "";
            panel.querySelector('[data-quick-druh][value=""]').checked = true;
            prepniDruhQuick(panel);
            profiltrujLidi(panel);

            const jenJa = komu.length === 1 && komu[0] === window.KB.currentUid();
            const opak = opakovani ? " Opakuje se " + ((window.KB.OPAKOVANI_POPIS || {})[opakovani] || "") + "." : "";
            UI.toast((jenJa ? "Poznámka uložena jen pro tebe."
                : info ? (komu.length === 1 ? "Oznámení posláno."
                    : "Oznámení posláno " + komu.length + " lidem – každý si ho vezme na vědomí sám.")
                : komu.length === 1 ? "Quick to-do zadáno."
                : (kazdy ? "Zadáno " + komu.length + " lidem – každý si odškrtne sám."
                    : "Společný quick to-do zadán " + komu.length + " lidem.")) + opak +
                (zmineni.length ? " Zmínka poslána: " + zmineni.join(", ") + "." : ""));
        } catch (err) {
            console.error(err);
            UI.toast("Odeslání selhalo.", "error");
        }
    });

    /* --------------------------------------------- ovládání oblíbených part */

    document.addEventListener("click", async (event) => {
        const panel = document.getElementById("kbQuickPanel");
        if (!panel) return;

        if (event.target.closest("[data-quick-oblibene-uloz]")) {
            const komu = vybraniKomu();
            if (!komu.length) return UI.toast("Nejdřív zaškrtni lidi, které chceš uložit.", "warn");

            const nazev = ((await UI.zeptej({ nadpis: "Jak se má ta parta jmenovat?",
                placeholder: "např. Parta na focení", ano: "Uložit" })) || "").trim();
            if (!nazev) return;

            const seznam = nactiOblibene().filter(o => o.nazev !== nazev);
            seznam.unshift({ nazev: nazev, lide: komu });
            ulozOblibene(seznam);
            vykresliOblibene();
            return void UI.toast("Uloženo mezi oblíbené.");
        }

        const nasad = event.target.closest("[data-quick-oblibene-nasad]");
        if (nasad) {
            const o = nactiOblibene()[Number(nasad.dataset.quickOblibeneNasad)];
            if (!o) return;
            // parta se přidá k tomu, co je zaškrtnuté – nechává se skládat
            const vybrat = new Set(o.lide || []);
            panel.querySelectorAll("[data-quick-komu] input").forEach(ch => {
                if (vybrat.has(ch.value)) ch.checked = true;
            });
            profiltrujLidi(panel);      // vybraní musí zůstat vidět i při hledání
            return;
        }

        if (event.target.closest("[data-quick-hledej-zrus]")) {
            const obal = vyberLidi(event.target);
            if (!obal) return;
            obal.querySelector("[data-quick-hledej]").value = "";
            profiltrujLidi(obal);
            obal.querySelector("[data-quick-hledej]").focus();
            return;
        }

        const smaz = event.target.closest("[data-quick-oblibene-smaz]");
        if (smaz) {
            const seznam = nactiOblibene();
            seznam.splice(Number(smaz.dataset.quickOblibeneSmaz), 1);
            ulozOblibene(seznam);
            vykresliOblibene();
        }
    });

    document.addEventListener("input", (event) => {
        if (!event.target.matches || !event.target.matches("[data-quick-hledej]")) return;
        profiltrujLidi(vyberLidi(event.target));
    });

    document.addEventListener("keydown", (event) => {
        /* Escape v hledání jen vyprázdní pole – zavřít celý panel a přijít
           o rozepsaný vzkaz by za to nestálo. */
        if (event.key === "Escape" && event.target && event.target.matches &&
                event.target.matches("[data-quick-hledej]") && event.target.value) {
            event.stopPropagation();
            event.target.value = "";
            return void profiltrujLidi(vyberLidi(event.target));
        }
        if (event.key === "Escape") prepniQuick(false);

        /* Enter přepíná zaškrtávátko stejně jako mezerník. Tab mezi štítky
           lidí funguje, ale Enter na nich nedělal nic – kdo jede z klávesnice,
           čekal potvrzení Enterem (Správa projektů, Quick TO-DO, výkazy). */
        if (event.key === "Enter" && event.target &&
            event.target.matches && event.target.matches('input[type="checkbox"]')) {
            event.preventDefault();
            event.target.checked = !event.target.checked;
            event.target.dispatchEvent(new Event("change", { bubbles: true }));
        }
    });

    /* Stats v pásu jsou zkrácené na dvě čísla (Dnes, Týden) – podrobnosti
       (moje úkoly, TO-DO, Quick TO-DO, nejbližší termín) se rozbalí klikem
       a pás si to pamatuje. Plných šest řádků bralo ~200 px a byl to jeden
       z důvodů, proč spodek pásu padal pod okraj obrazovky. */
    const MUJDEN_KEY = "kb-pas-stats";
    let mujdenOtevreny = false;
    try { mujdenOtevreny = localStorage.getItem(MUJDEN_KEY) === "1"; } catch (err) { /* soukromý režim */ }

    document.addEventListener("click", (event) => {
        const tlacitko = event.target.closest && event.target.closest("[data-mujden-prepni]");
        if (!tlacitko) return;
        mujdenOtevreny = !mujdenOtevreny;
        try { localStorage.setItem(MUJDEN_KEY, mujdenOtevreny ? "1" : "0"); } catch (err) { /* nevadí */ }
        tlacitko.setAttribute("aria-expanded", String(mujdenOtevreny));
        const vic = document.getElementById("kbMujdenVic");
        if (vic) vic.hidden = !mujdenOtevreny;
    });

    function renderMujDen() {
        const slot = document.querySelector("[data-rail-mujden]");
        if (!slot) return;

        const uid = (window.KB && window.KB.currentUid) ? window.KB.currentUid() : "";
        if (!uid || !UI.can("vykaz.otevrit")) { slot.hidden = true; return; }

        const dnes = new Date();
        const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
            "-" + String(d.getDate()).padStart(2, "0");
        // týden od pondělí – tak se u nás počítá odpracovaná doba
        const pondeli = new Date(dnes);
        pondeli.setDate(pondeli.getDate() - ((pondeli.getDay() + 6) % 7));

        const moje = (window.KB.vykazy || []).filter(z => z.uid === uid && !z.absence);
        const secti = (kdy) => moje.filter(kdy).reduce((s, z) => s + (Number(z.hodiny) || 0), 0);
        const hodinyDnes = secti(z => z.datum === iso(dnes));
        const hodinyTyden = secti(z => (z.datum || "") >= iso(pondeli) && (z.datum || "") <= iso(dnes));

        const mojeUkoly = (window.KB.ukoly || [])
            .filter(u => u.stav !== "hotovo" && (u.prirazeni || []).indexOf(uid) !== -1);
        const nejblizsi = mojeUkoly.filter(u => u.termin).sort((a, b) => a.termin.localeCompare(b.termin))[0];
        // TO-DO = nedodělané položky napříč mými úkoly; Quick = co mi kdo poslal
        const todoZbyva = mojeUkoly.reduce((s, u) =>
            s + (u.todo || []).filter(t => t.vypnuto !== true && (Number(t.pct) || 0) < 100).length, 0);
        const quickZbyva = (window.KB.quicktodo || [])
            .filter(q => !UI.quickHotovoPro(q, uid) && !UI.quickVzal(q, uid) && !UI.quickOdlozeno(q, uid) &&
                q.proUid === uid).length;

        /* Dokud výkazy nedorazily, svítí „—" – nula by tvrdila, že člověk
           dnes nic nezapsal (rešerše 19. 10.: pás na Celkovém přehledu). */
        const prislo = window.KB.vykazyPrisly === true;
        const cislo = (h) => prislo
            ? Number(h || 0).toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " h" : "—";
        const czDatum = (i) => { const [, m, d] = i.split("-"); return Number(d) + ". " + Number(m) + "."; };

        slot.hidden = false;
        slot.innerHTML =
            '<button type="button" class="mujden__hlava" data-mujden-prepni aria-controls="kbMujdenVic"' +
                ' aria-expanded="' + mujdenOtevreny + '" title="Stats – podrobnosti">' +
                '<span class="mujden__cislo"><small>Dnes</small><b>' + esc(cislo(hodinyDnes)) + "</b></span>" +
                '<span class="mujden__cislo"><small>Týden</small><b>' + esc(cislo(hodinyTyden)) + "</b></span>" +
                ikonaPasu("sipka", "mujden__sipka") +
            "</button>" +
            '<div class="mujden__vic" id="kbMujdenVic"' + (mujdenOtevreny ? "" : " hidden") + ">" +
                '<div class="mujden__radek"><span>Moje úkoly</span><b>' + esc(mojeUkoly.length) + "</b></div>" +
                '<div class="mujden__radek"><span>TO-DO</span><b>' + esc(todoZbyva) + "</b></div>" +
                '<div class="mujden__radek"><span>Quick TO-DO</span><b>' + esc(quickZbyva) + "</b></div>" +
                (nejblizsi
                    ? '<a class="mujden__termin" href="ukoly.html?moje=1">' +
                        "<span>Nejbližší termín · " + esc(czDatum(nejblizsi.termin)) + "</span>" +
                        "<b>" + esc(nejblizsi.nazev || "") + "</b></a>"
                    : "") +
            "</div>";
    }

    /* Hledání je jedno jediné pole. Na širokém okně bydlí v pásu, na úzkém
       v liště – přesouvá se i s posluchači a rozepsaný dotaz přežije. */
    function placeSearch() {
        const box = document.querySelector(".searchbox");
        const doRailu = document.querySelector("[data-rail-search]");
        const doListy = document.querySelector(".appbar__barin");

        /* Bez hledání zbývaly v pásu dvě čáry těsně nad sebou: jedna pod
           logem, druhá nad „Můj den" – mezi nimi prázdné místo po poli.
           Pás si to řekne třídou a CSS druhou čáru i mezeru zruší. */
        const rail = document.querySelector(".siderail");
        if (rail) rail.classList.toggle("siderail--bezhledani", !box);

        if (!box || !doRailu || !doListy) return;
        /* Hledání bydlí VŽDY v pásu – na dotyku je pás vysouvací hamburgerem
           a lupa v liště se tam pletla přes položky (přání Michala 29. 8.). */
        const cil = doRailu;
        if (box.parentElement !== cil) cil.appendChild(box);
    }
    window.addEventListener("resize", placeSearch);
    // resize někdy nepřijde (otočení tabletu, obnovení okna) – hlídá se i média
    try {
        window.matchMedia("(max-width: 1120px), (hover: none)")
            .addEventListener("change", placeSearch);
    } catch (err) { /* starší prohlížeč – stačí resize */ }

    /* ------------------------------------------------- hamburger pásu ---
       Na dotyku a v úzkém okně je svislý pás schovaný za krajem obrazovky;
       třemi čárkami v pruhu se vysune, záclonou, Escape nebo proklikem
       v pásu se zase zavře. */

    /* Tři čárky v pruhu i „Menu" ve spodní liště hlásí, jestli je pás venku. */
    const oznacBurgery = (otevreno) => document.querySelectorAll("[data-pas-burger]")
        .forEach(b => b.setAttribute("aria-expanded", String(otevreno)));

    function zavriPas() {
        document.body.classList.remove("pas-otevren");
        const zaclona = document.querySelector(".pas-zaclona");
        if (zaclona) zaclona.hidden = true;
        oznacBurgery(false);
    }

    document.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("[data-pas-burger]")) {
            let zaclona = document.querySelector(".pas-zaclona");
            if (!zaclona) {
                zaclona = document.createElement("div");
                zaclona.className = "pas-zaclona no-print";
                document.body.appendChild(zaclona);
            }
            const otevrit = !document.body.classList.contains("pas-otevren");
            document.body.classList.toggle("pas-otevren", otevrit);
            zaclona.hidden = !otevrit;
            oznacBurgery(otevrit);
            return;
        }
        if (e.target.classList && e.target.classList.contains("pas-zaclona")) {
            zavriPas();
            return;
        }
        /* ťuknutí na akci v pásu pás rovnou zavře, ať nezůstane přes obsah;
           rozbalení skupiny nebo Stats je jen listování v pásu – ten zůstane */
        if (document.body.classList.contains("pas-otevren") &&
            e.target.closest && e.target.closest(".siderail a, .siderail button") &&
            !e.target.closest("[data-skupina-prepni], [data-mujden-prepni]")) {
            zavriPas();
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") zavriPas();
    });

    /** Tlačítko „nahoru" – ukáže se, až je stránka o dost delší než okno. */
    function mountToTop() {
        if (document.getElementById("kbToTop")) return;

        const button = document.createElement("button");
        button.id = "kbToTop";
        button.type = "button";
        button.className = "totop no-print";
        button.setAttribute("aria-label", "Nahoru na začátek stránky");
        button.innerHTML = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7"/></svg>';
        button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
        document.body.appendChild(button);

        const check = () => {
            const tall = document.documentElement.scrollHeight > window.innerHeight * 1.6;
            button.classList.toggle("is-visible", tall && window.scrollY > 400);
        };
        window.addEventListener("scroll", check, { passive: true });
        window.addEventListener("resize", check);
        check();
    }

    /**
     * Lišta má zůstat vidět i po odrolování, ale logo nad ní ne – proto se
     * hlavička posouvá nahoru přesně o výšku toho, co je nad lištou.
     */
    function stickyOffset() {
        const header = document.querySelector(".appbar");
        const bar = header && header.querySelector(".appbar__bar");
        if (!header || !bar) return;
        const apply = () => {
            header.style.top = "-" + Math.max(0, bar.offsetTop) + "px";
        };
        apply();
        window.addEventListener("resize", apply);
        if (window.ResizeObserver) new ResizeObserver(apply).observe(header);
    }

    /** Naváže prvky, které se při překreslení navigace vytvářejí znovu. */
    function bindNav() {
        // Roletka se na myši otevírá najetím (CSS). Klik řešíme kvůli dotyku:
        // na úzkém okně první ťuknutí roletku rozbalí, druhé teprve přejde na
        // stránku. S myší odkaz rovnou proklikne, roletka je vidět při najetí.
        document.querySelectorAll("[data-menu-toggle]").forEach(button => {
            button.addEventListener("click", (event) => {
                const item = button.closest(".navitem");
                const wasOpen = item.classList.contains("is-open");
                const jeOdkaz = button.tagName === "A";

                if (jeOdkaz && !isCompact()) return;   // myš: nech proklik na stránku
                if (jeOdkaz && wasOpen) return;        // dotyk: podruhé už na stránku

                event.preventDefault();
                event.stopPropagation();
                document.querySelectorAll(".navitem.is-open").forEach(n => n.classList.remove("is-open"));
                if (!wasOpen) item.classList.add("is-open");
            });
        });
        // na dotyku se obsah kategorie rozbalí až ťuknutím na její řádek
        document.querySelectorAll(".dropdown__group").forEach(group => {
            const title = group.querySelector(".dropdown__title");
            if (!title || !group.querySelector(".dropdown__sub")) return;

            title.addEventListener("click", (event) => {
                if (!isCompact()) return;   // na širokém okně s myší stačí najet
                event.preventDefault();
                event.stopPropagation();
                const wasOpen = group.classList.contains("is-open");
                group.parentElement.querySelectorAll(".dropdown__group.is-open")
                    .forEach(other => other.classList.remove("is-open"));
                if (!wasOpen) group.classList.add("is-open");
            });
        });
    }

    /** Prvky, které vzniknou jen jednou při vykreslení hlavičky. */
    function bindHeader() {
        // ikony nástrojů s akcí – oba pokyny pro AI
        document.querySelectorAll(".toolrail [data-action='ai-prompt']").forEach(button => {
            button.addEventListener("click", () => UI.copyAiPrompt());
        });
        document.querySelectorAll(".toolrail [data-action='script-prompt']").forEach(button => {
            button.addEventListener("click", () => UI.copyAiPrompt(null, null, "skript"));
        });
    }

    /* Kliknutí kamkoliv do datumového pole rozbalí rovnou kalendář – jinak
       ho otevírá jen malá ikonka u kraje a lidi klikají do prázdna. */
    document.addEventListener("click", (event) => {
        const datum = event.target.closest('input[type="date"]');
        if (datum && !datum.disabled && typeof datum.showPicker === "function") {
            try { datum.showPicker(); } catch (err) { /* už je otevřený */ }
        }
    });

    // zavírání roletek – jednou pro celou stránku
    document.addEventListener("click", () => {
        document.querySelectorAll(".navitem.is-open").forEach(n => n.classList.remove("is-open"));
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            document.querySelectorAll(".navitem.is-open").forEach(n => n.classList.remove("is-open"));
        }
    });

    /* -------------------------------------------------- mini okno ---
       Malé okno na rychlý zápis dnešních hodin (mini.html, logika
       v assets/js/mini.js). Otevírá se z pásu a zkratkou Alt+Shift+M –
       Ctrl+Shift+M v Chromu a Edgi přepíná profil a ve Firefoxu zapíná
       zobrazení pro mobil, proto ne ta. Okno „kb-mini" se nezakládá
       podruhé: další otevření ho jen vytáhne dopředu i s rozepsaným
       zápisem. V samotném mini okně (window.KB_MINI) si zkratku řeší
       mini.js – vrací na celý web. */
    UI.otevriMiniOkno = () => {
        let okno = null;
        try { okno = window.open("", "kb-mini", "popup,width=380,height=700"); } catch (err) { okno = null; }
        if (!okno) {
            UI.toast("Prohlížeč malé okno zablokoval – povol vyskakovací okna pro tenhle web.", "warn");
            return;
        }
        try {
            if (!/mini\.html$/.test(okno.location.pathname)) okno.location.href = "mini.html";
        } catch (err) { /* okno s jiným původem – nech být */ }
        try { okno.focus(); } catch (err) { /* nic */ }
    };

    document.addEventListener("click", (event) => {
        if (event.target.closest && event.target.closest("[data-mini-okno]")) UI.otevriMiniOkno();
    });

    document.addEventListener("keydown", (event) => {
        if (window.KB_MINI || event.code !== "KeyM") return;
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        UI.otevriMiniOkno();
    });

    // přihlášení a odhlášení – kdekoliv na stránce
    document.addEventListener("click", (event) => {
        const target = event.target.closest("[data-logout],[data-login],[data-role-pill]");
        if (!target) return;
        /* Odhlášení smaže kopii databáze v prohlížeči i s frontou neodeslaných
           změn – a znovu se přihlásit jde jen se signálem. */
        if (target.hasAttribute("data-logout") && navigator.onLine === false) {
            return UI.toast("Bez signálu se neodhlašuj – neodeslané změny by se smazaly a přihlásit se jde jen se signálem.", "warn");
        }
        if (target.hasAttribute("data-logout")) return UI.logout();
        // odznak role slouží k přihlášení; roli si nikdo nepřepíná sám
        if (window.KB_USER) return;
        UI.openLogin();
    });

    /* ------------------------------------------------ hledání v liště */

    let searchHandler = null;

    /** Stránka si řekne, co má hledání v liště dělat. */
    UI.onSearch = (handler) => {
        searchHandler = handler;
        const input = document.getElementById("kbSearch");
        if (input && input.value.trim()) handler(input.value.trim());
    };

    UI.searchValue = () => {
        const input = document.getElementById("kbSearch");
        return input ? input.value.trim() : "";
    };

    /** Vyprázdní hledání zvenčí – používá to tlačítko Reset u filtrů. */
    UI.setSearch = (text) => {
        const input = document.getElementById("kbSearch");
        if (input) input.value = text || "";
    };

    function bindSearch() {
        const input = document.getElementById("kbSearch");
        if (!input) return;

        const preset = new URLSearchParams(location.search).get("q");
        if (preset) input.value = preset;

        // na úzkých displejích je z hledání jen lupa – pole vyjede po ťuknutí
        const box = input.closest(".searchbox");
        const collapsed = () => window.matchMedia("(max-width: 1120px)").matches;
        // hledání má být "pod" navigací – při otevření ji nepřekrývá zbytečně dlouho

        if (preset && collapsed()) box.classList.add("is-open");

        box.addEventListener("click", (event) => {
            if (!collapsed()) return;
            if (!box.classList.contains("is-open")) {
                box.classList.add("is-open");
                input.focus();
            } else if (event.target !== input) {
                box.classList.remove("is-open");
            }
        });
        input.addEventListener("blur", () => {
            if (collapsed() && !input.value.trim()) box.classList.remove("is-open");
        });

        input.addEventListener("input", () => {
            if (searchHandler) searchHandler(input.value.trim());
            else napovez(input.value.trim());
        });
        input.addEventListener("keydown", (event) => {
            if (event.key === "Escape") return void schovejNapovedu();
            if (event.key !== "Enter") return;
            const value = input.value.trim();
            if (searchHandler || !value) return;
            /* Enter otevře první nalezený návod – to je skoro vždycky ten
               hledaný. Když nic nesedí, aspoň se ukáže celý přehled. */
            const prvni = document.querySelector("#kbSearchOut a");
            location.href = prvni ? prvni.getAttribute("href")
                                  : "navody.html?q=" + encodeURIComponent(value);
        });

        // klik mimo hledání nabídku zavře, jinak by visela přes stránku
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".searchbox")) schovejNapovedu();
        });
    }

    /* ------------------------------------------------ našeptávač návodů ---
       Stránky bez vlastního hledání (detail návodu, úvod) rovnou ukazují,
       co se našlo. Klik jde na ten návod – dřív se muselo naslepo odentrovat
       do přehledu a hledat znovu očima. */

    function schovejNapovedu() {
        const out = document.getElementById("kbSearchOut");
        if (out) { out.hidden = true; out.innerHTML = ""; }
    }

    function napovez(dotaz) {
        const out = document.getElementById("kbSearchOut");
        if (!out) return;
        if (dotaz.length < 2) return schovejNapovedu();

        const nalezene = UI.searchGuides((window.KB && window.KB.guides) || [], dotaz);
        out.hidden = false;
        out.innerHTML = nalezene.length
            ? nalezene.slice(0, 8).map(g =>
                '<a href="navod.html?id=' + encodeURIComponent(g.id) + '">' +
                    "<b>" + UI.highlight(g.title || "Bez názvu", dotaz) + "</b>" +
                    (g.desc ? "<span>" + esc(g.desc) + "</span>" : "") +
                "</a>").join("") +
              (nalezene.length > 8
                ? '<a class="searchbox__vic" href="navody.html?q=' + encodeURIComponent(dotaz) + '">' +
                  "Zobrazit všech " + nalezene.length + " nálezů</a>" : "")
            : '<span class="searchbox__nic">Nic nenalezeno. ' +
              '<a href="navody.html">Projít celou databázi</a></span>';
    }

    /* --------------------------------------------------------- stav cloudu */

    UI.bindCloudStatus = (selector) => {
        const paint = (status) => {
            // data z mezipaměti hlásí „online" i bez signálu – rozhoduje prohlížeč
            if (navigator.onLine === false) status = "offline";
            document.querySelectorAll(selector).forEach(el => {
                el.textContent = status === "online" ? "Živě synchronizováno"
                    : status === "offline" ? "Offline režim" : "Připojuji…";
                el.dataset.state = status;   // barvu řeší CSS podle podkladu
            });
        };
        const prekresli = () => paint(window.KB ? window.KB.status : "connecting");
        prekresli();
        window.addEventListener("online", prekresli);
        window.addEventListener("offline", prekresli);
        if (window.KB) window.KB.on("status", (event) => paint(event.detail));
    };

    /* -------------------------------------------- české státní svátky ---
       Pevný seznam + Velikonoce dopočítané (Meeusův algoritmus). Žádné
       stahování odněkud – svátky se nemění a web musí fungovat offline. */

    const SVATKY_PEVNE = {
        "01-01": "Nový rok",
        "05-01": "Svátek práce",
        "05-08": "Den vítězství",
        "07-05": "Cyril a Metoděj",
        "07-06": "Mistr Jan Hus",
        "09-28": "Den české státnosti",
        "10-28": "Vznik Československa",
        "11-17": "Den boje za svobodu a demokracii",
        "12-24": "Štědrý den",
        "12-25": "1. svátek vánoční",
        "12-26": "2. svátek vánoční"
    };

    function velikonocniNedele(rok) {
        const a = rok % 19, b = Math.floor(rok / 100), c = rok % 100;
        const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const mesic = Math.floor((h + l - 7 * m + 114) / 31);
        const den = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(rok, mesic - 1, den);
    }

    const denIso = (d) => d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");

    /** Název státního svátku pro den, jinak prázdno. */
    UI.svatek = (iso) => {
        const pevny = SVATKY_PEVNE[String(iso).slice(5)];
        if (pevny) return pevny;
        const rok = Number(String(iso).slice(0, 4));
        if (!rok) return "";
        const nedele = velikonocniNedele(rok);
        const patek = new Date(nedele); patek.setDate(nedele.getDate() - 2);
        const pondeli = new Date(nedele); pondeli.setDate(nedele.getDate() + 1);
        if (iso === denIso(patek)) return "Velký pátek";
        if (iso === denIso(pondeli)) return "Velikonoční pondělí";
        return "";
    };

    /* --------------------------------------- našeptávač k <select> ------
       Roletka, do které se dá psát. Vlastní <select> zůstává (jen se
       schová) a dál drží hodnotu, takže ho zbytek stránky čte jako
       předtím a každé překreslení jeho <option> se projeví samo.

       Hledá se po slovech a bez ohledu na diakritiku v celém popisku
       volby. U úkolů je součástí popisku i jméno člověka, kterému úkol
       patří – „travnik" tak najde všechno Petra Trávníka.

       Skupiny (<optgroup>) se v nabídce vypíšou jako oddělovač a třída
       volby se přenese na řádek, takže si stránka může volby obarvit
       (výkazy tak odlišují cizí úkoly). */

    const hledacObal = (el) => el && el.closest("[data-hledac]");
    const hledacSelect = (obal) => obal && obal.querySelector("select");
    const hledacVstup = (obal) => obal && obal.querySelector("[data-hledac-vstup]");
    const hledacSeznam = (obal) => obal && obal.querySelector("[data-hledac-seznam]");

    function zabalHledac(select) {
        const obal = document.createElement("div");
        obal.className = "hledac";
        obal.setAttribute("data-hledac", "");
        select.parentNode.insertBefore(obal, select);
        obal.innerHTML =
            '<input type="text" class="field hledac__vstup" data-hledac-vstup autocomplete="off">' +
            '<span class="hledac__sipka" aria-hidden="true">&#9662;</span>' +
            '<div class="hledac__seznam" data-hledac-seznam hidden></div>';
        obal.appendChild(select);
        select.classList.add("hledac__select");
        return obal;
    }

    const maCoNabidnout = (select) =>
        Array.from(select.options).some(volba => volba.value);

    /**
     * Zapne našeptávač nad roletkou a srovná ho s tím, co je v ní vybrané.
     * Volá se i po každém překreslení options – je to zároveň „obnov".
     *
     * @param {HTMLSelectElement} select
     * @param {Object} [volby] – { popis, nazev, prazdne }
     */
    UI.naseptavac = (select, volby) => {
        if (!select) return;
        const o = volby || {};
        const obal = hledacObal(select) || zabalHledac(select);
        /* Nastavení se slučuje, nepřepisuje: volá se i bez něj (třeba po
           výběru) a to by jinak zahodilo, co si stránka nastavila. */
        obal.hledacVolby = Object.assign(obal.hledacVolby || {}, o);
        if (o.popis) obal.dataset.popis = o.popis;
        if (o.nazev) obal.dataset.nazev = o.nazev;
        if (o.prazdne) obal.dataset.prazdne = o.prazdne;

        const vstup = hledacVstup(obal);
        const vybrana = select.options[select.selectedIndex];
        const trida = vybrana && vybrana.value ? vybrana.className : "";

        vstup.value = vybrana && vybrana.value ? vybrana.textContent : "";
        vstup.className = ("field hledac__vstup " + trida).trim();
        vstup.placeholder = maCoNabidnout(select)
            ? (obal.dataset.popis || "Piš, co hledáš…")
            : (obal.dataset.prazdne || "Není z čeho vybírat");
        vstup.setAttribute("aria-label", obal.dataset.nazev || "Hledat");
        skryjHledac(obal);
    };

    function nabidkaHledace(obal, dotaz) {
        const select = hledacSelect(obal);
        const volby = obal.hledacVolby || {};
        const slova = foldText(dotaz).trim().split(/\s+/).filter(Boolean);
        const sedi = (text) => {
            const seno = foldText(text);
            return slova.every(slovo => seno.indexOf(slovo) !== -1);
        };

        const radekVolby = (volba, i) =>
            '<button type="button" class="hledac__radek ' + esc(volba.className) +
            (volba.selected ? " hledac__radek--vybrany" : "") +
            '" data-hledac-volba="' + i + '">' + esc(volba.textContent) + "</button>";

        /* Přednostní volby – stránka je hlásí funkcí, protože se mění za
           běhu (ve výkazu podle toho, co padlo u dřívějších záznamů).
           Vytáhnou se nahoru a v hlavním seznamu se už neopakují. */
        const nahoreSeznam = typeof volby.nahore === "function" ? (volby.nahore() || []) : [];
        const nahore = {};
        nahoreSeznam.forEach(hodnota => { nahore[hodnota] = true; });

        const radky = [];
        // zrušení výběru se nabízí, jen když je co rušit
        if (!slova.length && select.value && select.options[0] && !select.options[0].value) {
            radky.push('<button type="button" class="hledac__radek hledac__radek--zadny" ' +
                'data-hledac-volba="0">' + esc(select.options[0].textContent) + "</button>");
        }

        let prvniNahore = true;
        Array.from(select.options).forEach((volba, i) => {
            if (!volba.value || !nahore[volba.value]) return;
            if (slova.length && !sedi(volba.textContent)) return;
            if (prvniNahore) {
                prvniNahore = false;
                radky.push('<div class="hledac__delic">' +
                    esc(volby.nahorePopis || "naposledy použité") + "</div>");
            }
            radky.push(radekVolby(volba, i));
        });

        let skupina = "";
        Array.from(select.options).forEach((volba, i) => {
            if (!volba.value || nahore[volba.value]) return;
            if (slova.length && !sedi(volba.textContent)) return;

            const rodic = volba.parentElement;
            const jeSkupina = rodic && rodic.tagName === "OPTGROUP" ? rodic.label : "";
            if (jeSkupina !== skupina) {
                skupina = jeSkupina;
                if (skupina) {
                    radky.push('<div class="hledac__delic">' + esc(skupina) + "</div>");
                }
            }
            radky.push(radekVolby(volba, i));
        });

        if (!radky.length) {
            return '<div class="hledac__prazdno">' +
                (maCoNabidnout(select)
                    ? "Nic nesedí — zkus jen část slova."
                    : (obal.dataset.prazdne || "Není z čeho vybírat.")) + "</div>";
        }
        return radky.join("");
    }

    /* Nabídka je `position: fixed` – bloky formulářů mívají overflow:hidden
       a ořízly by ji. Poloha se proto dopočítává: pod pole, a když se tam
       nevejde, nad něj. */
    /* Sdílí ho i napovídání @ a # (níž) – stejná nabídka u jiného pole. */
    function umistiSeznam(r, seznam, vlevo, sirka) {
        const podNim = window.innerHeight - r.bottom - 12;
        const nadNim = r.top - 12;
        const dolu = podNim >= 200 || podNim >= nadNim;

        seznam.style.left = vlevo + "px";
        seznam.style.width = sirka + "px";
        seznam.style.maxHeight = Math.max(120, Math.min(320, dolu ? podNim : nadNim)) + "px";
        seznam.style.top = dolu ? (r.bottom + 4) + "px" : "auto";
        seznam.style.bottom = dolu ? "auto" : (window.innerHeight - r.top + 4) + "px";
    }

    function umistiHledac(obal) {
        const r = hledacVstup(obal).getBoundingClientRect();
        umistiSeznam(r, hledacSeznam(obal), r.left, r.width);
    }

    function ukazHledac(obal, dotaz) {
        const seznam = hledacSeznam(obal);
        seznam.innerHTML = nabidkaHledace(obal, dotaz);
        seznam.hidden = false;
        obal.classList.add("hledac--otevreno");
        umistiHledac(obal);
    }

    function skryjHledac(obal) {
        const seznam = hledacSeznam(obal);
        if (!seznam) return;
        seznam.hidden = true;
        obal.classList.remove("hledac--otevreno");
    }

    function vyberVHledaci(obal, index) {
        const select = hledacSelect(obal);
        const volba = select && select.options[index];
        if (!volba) return;
        select.value = volba.value;
        UI.naseptavac(select);
        /* Obě události: stránky poslouchají různě (výkazy na `input`,
           úkoly na `change`) a ručně vybraná hodnota se musí chovat
           stejně jako klik do původní roletky. */
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    document.addEventListener("input", (event) => {
        const vstup = event.target.closest && event.target.closest("[data-hledac-vstup]");
        if (vstup) ukazHledac(hledacObal(vstup), vstup.value);
    });

    document.addEventListener("focusin", (event) => {
        const vstup = event.target.closest && event.target.closest("[data-hledac-vstup]");
        if (!vstup) return;
        vstup.select();          // další psaní rovnou přepíše, co tam stálo
        ukazHledac(hledacObal(vstup), "");
    });

    /* Odchod z pole nabídku zavře a text vrátí na vybranou hodnotu, ať
       v poli nezůstane viset rozepsaný dotaz. */
    document.addEventListener("focusout", (event) => {
        const vstup = event.target.closest && event.target.closest("[data-hledac-vstup]");
        if (!vstup) return;
        const obal = hledacObal(vstup);
        if (event.relatedTarget && obal.contains(event.relatedTarget)) return;
        UI.naseptavac(hledacSelect(obal));
    });

    /* `mousedown`, ne `click`: klik by nabídku zavřel odchodem zaměření
       dřív, než by se stihl vybrat řádek. */
    document.addEventListener("mousedown", (event) => {
        const volba = event.target.closest && event.target.closest("[data-hledac-volba]");
        if (volba) {
            event.preventDefault();
            vyberVHledaci(hledacObal(volba), Number(volba.dataset.hledacVolba));
            return;
        }
        document.querySelectorAll(".hledac--otevreno").forEach(obal => {
            if (!obal.contains(event.target)) UI.naseptavac(hledacSelect(obal));
        });
    });

    document.addEventListener("keydown", (event) => {
        const vstup = event.target.closest && event.target.closest("[data-hledac-vstup]");
        if (!vstup) return;
        const obal = hledacObal(vstup);
        const seznam = hledacSeznam(obal);

        if (event.key === "Escape") return void UI.naseptavac(hledacSelect(obal));

        if (event.key === "Enter") {
            const akt = seznam.querySelector(".hledac__radek--akt") ||
                        seznam.querySelector(".hledac__radek");
            if (seznam.hidden || !akt) return;
            event.preventDefault();          // ať Enter neodešle formulář
            vyberVHledaci(obal, Number(akt.dataset.hledacVolba));
            return;
        }

        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        if (seznam.hidden) return void ukazHledac(obal, vstup.value);

        const radky = Array.from(seznam.querySelectorAll(".hledac__radek"));
        if (!radky.length) return;
        const ted = radky.findIndex(r => r.classList.contains("hledac__radek--akt"));
        const kam = event.key === "ArrowDown"
            ? Math.min(radky.length - 1, ted + 1)
            : Math.max(0, (ted === -1 ? 0 : ted - 1));
        radky.forEach(r => r.classList.remove("hledac__radek--akt"));
        radky[kam].classList.add("hledac__radek--akt");
        radky[kam].scrollIntoView({ block: "nearest" });
    });

    /* Rolování posune nabídku s polem; když pole odjede z obrazovky nebo
       se schová (zavřený formulář), nabídka se zavře. */
    function srovnejHledace() {
        document.querySelectorAll(".hledac--otevreno").forEach(obal => {
            const vstup = hledacVstup(obal);
            const r = vstup.getBoundingClientRect();
            const pryc = !vstup.offsetParent || !r.width ||
                         r.bottom < 0 || r.top > window.innerHeight;
            if (pryc) UI.naseptavac(hledacSelect(obal));
            else umistiHledac(obal);
        });
    }

    window.addEventListener("scroll", srovnejHledace, true);
    window.addEventListener("resize", srovnejHledace);

    /* ------------------------------------- zmínky @ a odkazy # v textu ---
       Po napsání „@" nabídka lidí, po „#" projektů a úkolů – stejný zvyk
       jako zmínky v Poradách (bod 19 rešerše, 22. 10. 2026). Pole se
       přihlásí atributem `data-napoveda`; vybrané odkazy si nese ve
       vlastnosti `kbOdkazy` a stránka je při ukládání vezme přes
       UI.odkazyPole(pole).

       Text zůstává čitelný („#VZT – G61", „@Jan Novák") – tak ho dostane
       i e-mail z Apps Scriptu a dlaždice, které text jen vypisují. Kam
       „#" vede, drží vedle textu pole `odkazy` [{ t: "p" | "u", id, n }]:
       podle id je odkaz spolehlivý (stejně pojmenované úkoly ani
       přejmenování ho nespletou) a staré texty bez pole se kreslí jako
       dřív. Nabídka má vzhled našeptávače (.hledac__seznam). */

    const PISMENO = /[\p{L}\p{N}_]/u;

    /** Lidé, které jde zmínit: aktivní, s jménem, bez služebních účtů. */
    function lideKZmince() {
        return ((window.KB && window.KB.users) || [])
            .filter(u => u && u.id && u.active !== false && !UI.jeSluzebni(u))
            .map(u => ({ id: u.id, jmeno: ((u.first || "") + " " + (u.last || "")).replace(/\s+/g, " ").trim() }))
            .filter(u => u.jmeno);
    }

    /** Je `znacka` v textu jako celek (před ní ani za ní není písmeno)? */
    function maZnacku(text, znacka) {
        for (let i = text.indexOf(znacka); i !== -1; i = text.indexOf(znacka, i + 1)) {
            if (!PISMENO.test(text.charAt(i - 1)) && !PISMENO.test(text.charAt(i + znacka.length))) return true;
        }
        return false;
    }

    /** Odkazy z databáze jen v povoleném tvaru – cokoliv navíc zahodí. */
    UI.cisteOdkazy = (odkazy) => (Array.isArray(odkazy) ? odkazy : [])
        .filter(o => o && (o.t === "p" || o.t === "u") && typeof o.id === "string" && o.id &&
            typeof o.n === "string" && o.n.trim())
        .slice(0, 20)
        .map(o => ({ t: o.t, id: o.id.slice(0, 120), n: o.n.slice(0, 120) }));

    /** Kam odkaz vede: projekt do Správy projektů, úkol do Úkolů (otevře i cizí). */
    UI.odkazAdresa = (o) => (o.t === "p" ? "sprava.html?id=" : "ukoly.html?otevri=") +
        encodeURIComponent(o.id);

    /** Kdo je v textu zmíněný přes „@Jméno Příjmení" (uid). */
    UI.zminkyVTextu = (text) => {
        const t = String(text || "");
        return t.indexOf("@") === -1 ? []
            : lideKZmince().filter(u => maZnacku(t, "@" + u.jmeno)).map(u => u.id);
    };

    /**
     * Text do innerHTML: všechno přes esc, „#Název" z `odkazy` jako odkaz
     * a „@Jméno" zvýrazněné. Bez odkazů a zmínek vrací přesně esc(text).
     */
    UI.textSOdkazy = (text, odkazy) => {
        const t = String(text == null ? "" : text);
        const znacky = UI.cisteOdkazy(odkazy).map(o => ({ s: "#" + o.n, o: o }));
        if (t.indexOf("@") !== -1) lideKZmince().forEach(u => znacky.push({ s: "@" + u.jmeno }));
        if (!znacky.length) return esc(t);
        // delší přednost: „#VZT – G61" se nesmí rozpadnout na „#VZT"
        znacky.sort((a, b) => b.s.length - a.s.length);
        const sedi = (z, i) => t.startsWith(z.s, i) && !PISMENO.test(t.charAt(i + z.s.length));
        let ven = "", od = 0, i = 0;
        while (i < t.length) {
            const c = t.charAt(i);
            if ((c !== "#" && c !== "@") || PISMENO.test(t.charAt(i - 1))) { i++; continue; }
            // dva stejně pojmenované úkoly: každý výskyt dostane svůj odkaz
            const z = znacky.find(x => !x.pouzito && sedi(x, i)) || znacky.find(x => sedi(x, i));
            if (!z) { i++; continue; }
            z.pouzito = true;
            ven += esc(t.slice(od, i)) + (z.o
                ? '<a class="odkazref" href="' + esc(UI.odkazAdresa(z.o)) + '" title="' +
                    (z.o.t === "p" ? "Otevřít projekt" : "Otevřít úkol") + '">' + esc(z.s) + "</a>"
                : '<span class="zminka">' + esc(z.s) + "</span>");
            i += z.s.length;
            od = i;
        }
        return ven + esc(t.slice(od));
    };

    /** Odkazy, které pole opravdu nese – jen ty, jejichž „#Název" v textu zůstal. */
    UI.odkazyPole = (pole) => {
        const t = String((pole && pole.value) || "");
        const ven = [];
        UI.cisteOdkazy(pole && pole.kbOdkazy).forEach(o => {
            if (maZnacku(t, "#" + o.n) && !ven.some(x => x.t === o.t && x.id === o.id)) ven.push(o);
        });
        return ven;
    };

    /**
     * Zmíněným přes @ vzkaz do Quick TO-DO („Zmínil tě v …") – stávající
     * cesta upozornění: pípnutí, odznak i e-mail z Apps Scriptu. Sebe
     * vynechá; víc lidí = jeden vzkaz. Je to oznámení – každý ho bere na
     * vědomí sám (druh "info").
     * @returns {Promise<string[]>} jména, komu vzkaz šel
     */
    UI.ohlasZminky = async (uids, text, volby) => {
        const o = volby || {};
        const ja = window.KB.currentUid();
        const komu = (uids || []).filter((u, i, a) => u && u !== ja && a.indexOf(u) === i);
        if (!komu.length) return [];
        const odkazy = UI.cisteOdkazy(o.odkazy);
        // oznámení – každý zmíněný ho bere na vědomí sám
        await window.KB.saveQuickTodo(window.KB.newQuickId(), Object.assign({
            text: text, proUids: komu, rezim: "kazdy", druh: "info", projekt: o.projekt || ""
        }, odkazy.length ? { odkazy: odkazy } : {}));
        const lide = lideKZmince();
        return komu.map(u => (lide.find(x => x.id === u) || {}).jmeno).filter(Boolean);
    };

    let nap = null;          // otevřená nabídka: { pole, od, znak, polozky, akt }
    let napEl = null;

    function zavriNapovedu() {
        nap = null;
        if (napEl) { napEl.hidden = true; napEl.innerHTML = ""; }
    }

    const nazevOdkazu = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 120);

    function polozkyNapovedy(znak, dotaz) {
        const slova = foldText(dotaz).trim().split(/\s+/).filter(Boolean);
        const sedi = (text) => { const s = foldText(text); return slova.every(x => s.indexOf(x) !== -1); };
        const ja = (window.KB && window.KB.currentUid) ? window.KB.currentUid() : "";
        const abc = (a, b) => a.text.localeCompare(b.text, "cs");
        if (znak === "@") {
            return lideKZmince().filter(u => u.id !== ja && sedi(u.jmeno))
                .map(u => ({ text: u.jmeno, vlozit: "@" + u.jmeno })).sort(abc).slice(0, 8);
        }
        const projekty = ((window.KB && window.KB.projektyDocs) || [])
            .filter(p => p && p.id && p.uzavreno !== true && nazevOdkazu(p.nazev) &&
                sedi((p.cislo || "") + " " + p.nazev))
            .map(p => ({ skupina: "Projekty", text: nazevOdkazu(p.nazev), popis: String(p.cislo || ""),
                odkaz: { t: "p", id: p.id, n: nazevOdkazu(p.nazev) } }))
            .sort(abc).slice(0, 6);
        // nehotové úkoly dřív – na ty se odkazuje nejčastěji
        const ukoly = ((window.KB && window.KB.ukoly) || [])
            .filter(u => u && u.id && nazevOdkazu(u.nazev) && sedi(u.nazev + " " + (u.projekt || "")))
            .sort((a, b) => (a.stav === "hotovo" ? 1 : 0) - (b.stav === "hotovo" ? 1 : 0) ||
                nazevOdkazu(a.nazev).localeCompare(nazevOdkazu(b.nazev), "cs"))
            .slice(0, 8)
            .map(u => ({ skupina: "Úkoly", text: nazevOdkazu(u.nazev),
                popis: [u.projekt, u.stav === "hotovo" ? "hotový" : ""].filter(Boolean).join(" · "),
                odkaz: { t: "u", id: u.id, n: nazevOdkazu(u.nazev) } }));
        return projekty.concat(ukoly).map(p => Object.assign(p, { vlozit: "#" + p.text }));
    }

    function umistiNapovedu() {
        const r = nap.pole.getBoundingClientRect();
        const sirka = Math.min(Math.max(r.width, 240), 380, window.innerWidth - 16);
        umistiSeznam(r, napEl, Math.max(8, Math.min(r.left, window.innerWidth - sirka - 8)), sirka);
    }

    function vykresliNapovedu() {
        if (!napEl) {
            napEl = document.createElement("div");
            napEl.className = "hledac__seznam napoveda no-print";
            napEl.setAttribute("role", "listbox");
            document.body.appendChild(napEl);
        }
        let skupina = "";
        napEl.setAttribute("aria-label", nap.znak === "@" ? "Zmínit kolegu" : "Odkaz na projekt nebo úkol");
        napEl.innerHTML = nap.polozky.map((p, i) => {
            const delic = p.skupina && p.skupina !== skupina
                ? '<div class="hledac__delic">' + esc(p.skupina) + "</div>" : "";
            skupina = p.skupina || "";
            return delic + '<button type="button" class="hledac__radek' + (i === nap.akt ? " hledac__radek--akt" : "") +
                '" role="option" tabindex="-1" aria-selected="' + (i === nap.akt) + '" data-napoveda-i="' + i + '">' +
                esc(p.text) + (p.popis ? '<span class="napoveda__popis">' + esc(p.popis) + "</span>" : "") +
                "</button>";
        }).join("");
        napEl.hidden = false;
        umistiNapovedu();
    }

    /** Podívá se, jestli se před kurzorem píše „@…" nebo „#…", a nabídne. */
    function napovez(pole) {
        const pred = pole.value.slice(0, pole.selectionStart || 0);
        // jen na začátku slova – „jan@firma.cz" ani „C#" nabídku neotevřou
        const m = /(^|[\s(„"'])([@#])([^@#\n]{0,40})$/.exec(pred);
        if (!m || /^\s|\s\s/.test(m[3])) return zavriNapovedu();
        const polozky = polozkyNapovedy(m[2], m[3]);
        // dopsaná zmínka s mezerou za ní („@Jan Novák ") už nic nenabízí
        const dopsano = /\s$/.test(m[3]) && polozky.some(p => foldText(p.text) === foldText(m[3].trim()));
        if (!polozky.length || dopsano) return zavriNapovedu();
        nap = { pole: pole, od: pred.length - m[3].length - 1, znak: m[2], polozky: polozky, akt: 0 };
        vykresliNapovedu();
    }

    function vlozNapovedu(i) {
        const p = nap && nap.polozky[i];
        if (!p) return;
        const pole = nap.pole;
        const vlozit = p.vlozit + " ";
        const kam = nap.od + vlozit.length;
        pole.value = pole.value.slice(0, nap.od) + vlozit + pole.value.slice(pole.selectionStart || 0);
        if (p.odkaz) pole.kbOdkazy = (pole.kbOdkazy || []).concat([p.odkaz]);
        zavriNapovedu();
        pole.focus();
        pole.setSelectionRange(kam, kam);
        // stránka se o změně dozví (výška pole, koncept); nabídka se znovu neotvírá
        const udalost = new Event("input", { bubbles: true });
        udalost.kbNapoveda = true;
        pole.dispatchEvent(udalost);
    }

    document.addEventListener("input", (e) => {
        if (e.kbNapoveda) return;
        const pole = e.target;
        if (pole && pole.matches && pole.matches("[data-napoveda]")) napovez(pole);
        else if (nap) zavriNapovedu();
    });

    /* Šipky, Enter/Tab a Esc patří otevřené nabídce DŘÍV než stránce –
       Enter jinde odesílá zprávu nebo ukládá poznámku, Esc zavírá okno. */
    window.addEventListener("keydown", (e) => {
        if (!nap || e.target !== nap.pole || e.isComposing) return;
        const n = nap.polozky.length;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            nap.akt = (nap.akt + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
            vykresliNapovedu();
            const akt = napEl.querySelector(".hledac__radek--akt");
            if (akt) akt.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
            vlozNapovedu(nap.akt);
        } else if (e.key === "Escape") {
            zavriNapovedu();
        } else {
            return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);

    /* Výběr až na `click` (řádek tou dobou ještě stojí, klik nepropadne na
       stránku pod ním); `mousedown` jen podrží kurzor v poli. */
    document.addEventListener("mousedown", (e) => {
        if (e.target.closest && e.target.closest("[data-napoveda-i]")) return void e.preventDefault();
        if (nap && e.target !== nap.pole) zavriNapovedu();
    });
    document.addEventListener("click", (e) => {
        const b = e.target.closest && e.target.closest("[data-napoveda-i]");
        if (b && nap) vlozNapovedu(Number(b.dataset.napovedaI));
    });
    document.addEventListener("focusout", (e) => {
        if (nap && e.target === nap.pole) zavriNapovedu();
    });

    function srovnejNapovedu() {
        if (!nap) return;
        const r = nap.pole.getBoundingClientRect();
        if (!nap.pole.isConnected || !r.width || r.bottom < 0 || r.top > window.innerHeight) zavriNapovedu();
        else umistiNapovedu();
    }
    window.addEventListener("scroll", srovnejNapovedu, true);
    window.addEventListener("resize", srovnejNapovedu);

    /* ------------------------------------------------------ vyhledávání */

    const foldText = (value) => String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");   // odstraní diakritiku, ať hledání funguje i bez háčků

    UI.fold = foldText;

    /** Název → bezpečné id do adresy (zakázky). */
    UI.slug = (value) => foldText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bez-zakazky";

    UI.searchGuides = (guides, query) => {
        const needle = foldText(query).trim();
        if (!needle) return guides;
        const words = needle.split(/\s+/);
        return guides.filter(guide => {
            const haystack = foldText([
                guide.title, guide.desc, guide.category, guide.author,
                window.KB_categoryLabel ? window.KB_categoryLabel(guide) : "",
                (guide.steps || []).map(s => (s.title || "") + " " + (s.content || "") + " " + (s.code || "")).join(" ")
            ].join(" "));
            return words.every(word => haystack.includes(word));
        });
    };

    UI.highlight = (text, query) => {
        const escaped = esc(text);
        const needle = foldText(query).trim();
        if (!needle) return escaped;
        const first = needle.split(/\s+/)[0];
        const start = foldText(escaped).indexOf(first);
        if (start < 0) return escaped;
        return escaped.slice(0, start) + "<mark>" + escaped.slice(start, start + first.length) +
               "</mark>" + escaped.slice(start + first.length);
    };

    /* ------------------------------------------------------- pokyn pro AI */

    /** Seznam povolených `cat` / `subcat` – ať si je AI nevymýšlí. */
    function catNabidka() {
        return (window.KB_CATEGORIES || []).map(category => {
            const listy = [];
            const walk = (nodes, cesta) => (nodes || []).forEach(node => {
                const dal = cesta.concat([node.title]);
                if (node.children && node.children.length) walk(node.children, dal);
                else listy.push('"' + node.id + '" = ' + dal.join(" / "));
            });
            walk(category.children, []);
            return "  cat \"" + category.id + "\" (" + category.title + "), subcat: " +
                   (listy.length ? listy.join(", ") : "nech prázdné");
        }).join("\n");
    }

    UI.aiPrompt = (catId, subId) => {
        const category = window.KB_findCategory ? window.KB_findCategory(catId) : null;
        const hit = window.KB_findNode ? window.KB_findNode(catId, subId) : null;

        // Zařazení: buď je vybrané z lišty, nebo AI dostane celou nabídku.
        const zarazeni = category
            ? ['  "cat": "' + category.id + '", "subcat": "' + (hit ? hit.node.id + '"' : '" – vyber nejbližší téma z nabídky:'),
               hit ? "" : catNabidka()].filter(Boolean)
            : ['  "cat" a "subcat" – vyber přesně jednu dvojici z tohoto seznamu:', catNabidka()];

        return [
            "Z naší konverzace vytvoř technický návod pro firemní web Pasport Kaňa.",
            "Výsledek vrať STRIKTNĚ jako jeden JSON objekt (žádný jiný text, žádné ```) s klíči:",
            '  "title"   – krátký výstižný název',
            '  "desc"    – jedna věta, co návod řeší',
            '  "version" – např. "v1.0"'
        ].concat(zarazeni).concat([
            '  "steps"   – pole kroků, každý krok má:',
            '        "title"   – název kroku',
            '        "content" – popis; nové řádky jako \\n, odrážky začni "- ",',
            "                    tučně **takto**, název tlačítka nebo cesty `takto`,",
            "                    na obrázek odkazuj zápisem [obr 1], [obr 2] …",
            '        "code"    – volitelný kód, cesta nebo příkaz (jinak "")',
            "Piš česky, stručně, v rozkazovacím způsobu (Otevři…, Klikni…, Nastav…).",
            "Jde-li o návod ke skriptu do ArcGIS Pro, dej jako samostatný krok i nastavení",
            "parametrů v Toolboxu (Label, Data Type, Direction) – tam se lidi zasekávají",
            "nejčastěji – a zmiň, na jaké licenci skript běží.",
            'Klíč "author" nevyplňuj – doplní se sám podle přihlášeného člověka.',
            "Obrázky do JSONu nevkládej – ty doplním ve webovém editoru na místa [obr N]."
        ]).join("\n");
    };

    /* ----------------------------------------------- pokyn pro ArcPy skript ---
       Popisuje, jak u nás skripty vypadají a co od nich čekáme. Záměrně
       neobsahuje postup pro člověka – ten se vkládá do chatu s AI tak, jak je. */

    UI.scriptPrompt = () => [
        "Píšeš skript pro naši firmu, která dělá pasportizaci budov v ArcGIS Pro.",
        "Než začneš psát, drž se těchhle pravidel – takhle u nás skripty vypadají.",
        "",
        "PROSTŘEDÍ A LICENCE",
        "- ArcGIS Pro, Python 3 z prostředí arcgispro-py3. Používej jen `arcpy`",
        "  a standardní knihovnu, nic se nedoinstalovává.",
        "- Skript se zapojuje jako Script Tool do našeho toolboxu, nespouští se v Notebooku.",
        "- DŮLEŽITÉ: skript musí běžet na licenci Basic. Většina lidí ve firmě má jen",
        "  tu – když použiješ nástroj vyšší úrovně, spadne jim to na",
        "  „ERROR 000824: The tool is not licensed“.",
        "- Metody třídy Geometry licenci NEPROCHÁZEJÍ a fungují všude: `.intersect()`,",
        "  `.difference()`, `.union()`, `.buffer()`, `.cut()`, `.densify()`, `.boundary()`,",
        "  `.distanceTo()`, `.projectAs()`, `.positionAlongLine()`, `.segmentAlongLine()`.",
        "  Co jde spočítat geometrií, počítej geometrií – ne nástrojem.",
        "- NEPOUŽÍVEJ: CreateThiessenPolygons, FeatureVerticesToPoints, SplitLineAtPoint",
        "  (Advanced), FeatureToLine, Densify jako nástroj (Standard).",
        "- Klidně používej: Intersect, Erase, Union, Clip, Identity, SpatialJoin, Dissolve,",
        "  Buffer, Append, ExportCAD – v ArcGIS Pro jsou všechny Basic.",
        "",
        "NAŠE DATA",
        "- Každé patro budovy je vlastní File Geodatabase (např. P01 = přízemí,",
        "  N01 = 1. patro, N02 = 2. patro).",
        "- Feature classy mají tvar Q<číslo>_<oblast>_<název>: Q3 = konstrukce,",
        "  Q4 = technologie, Q5 = zařízení, Q6 = facility management (místnosti).",
        "- Prvky se propojují přes polohový kód místnosti ve tvaru budova + podlaží +",
        "  číslo, např. BHA81N01006. Číslo místnosti může mít písmenný sufix (005a),",
        "  takže NIKDY neutínej pevný počet znaků – hledej předěl podle označení",
        "  podlaží (písmeno N/P/S + 2 číslice).",
        "- Cílové pole kódu se liší podle vrstvy: ve stavbě `POLOH_KOD`,",
        "  v technologiích `polohova_cast`. Skript má zvládnout obojí.",
        "- Technologie (chlazení, vzduchotechnika, voda, požární …) mají vlastní složky",
        "  a všechny sdílejí stejnou atributovou šablonu – dá se nad nimi psát",
        "  jeden společný skript.",
        "",
        "JAK MÁ SKRIPT VYPADAT",
        "- Jeden samostatný .py soubor, nic víc.",
        "- Nahoře `import arcpy` a `arcpy.env.overwriteOutput = True`.",
        "- Vstupy ber hned na začátku a pod sebe. Text přes `arcpy.GetParameterAsText(0)`,",
        "  ale zaškrtávátka a čísla přes `arcpy.GetParameter(n)` – vrátí rovnou `bool`",
        "  nebo číslo, takže odpadá řešení desetinné čárky. Žádné natvrdo psané cesty.",
        "- Názvy polí dej jako konstanty pod parametry (velkými písmeny), ať se dá",
        "  jediné místo přepsat, když se pole v geodatabázi jmenuje jinak.",
        "- Názvy polí porovnávej BEZ ohledu na velikost písmen – v jedné geodatabázi",
        "  se běžně vyskytuje `POLOH_KOD` i `poloh_kod`.",
        "- Geometrii ber přes tokeny `SHAPE@`, `SHAPE@AREA`, `SHAPE@LENGTH`, `OID@`.",
        "  Nikdy ne přes `Shape_Length` – ten se v různých geodatabázích jmenuje jinak.",
        "- Vstupní vrstvy ber jako Feature Layer, ne Feature Class – jen tak skript",
        "  respektuje aktivní výběr uživatele v mapě.",
        "- Mezivýsledky dělej ve workspace `memory` s časovým razítkem v názvu",
        "  (`f\"memory\\\\neco_{int(time.time())}\"`), pak je `Append`ni do cílové vrstvy.",
        "  Do mapy nesmí přibýt žádná odpadní vrstva.",
        "- Celý běh obal do `try` / `except` / `finally`; ve `finally` ukliď dočasná data.",
        "- Komentáře česky, jednoduché a k věci. Kód rozděl očíslovanými bloky.",
        "",
        "PASTI, NA KTERÉ SI DÁT POZOR",
        "- Nikdy neotvírej dva zapisovací kurzory nad jednou geodatabází současně –",
        "  padá to na „workspace already in transaction mode“. Nejdřív si všechno spočítej",
        "  do paměti a teprve pak zapisuj, jeden kurzor po druhém.",
        "- Neměň tabulku, nad kterou běží kurzor. Posbírej změny a proveď je až potom.",
        "- `Delete` obal do `try`/`except` – při otevřené editaci vyhodí",
        "  „ERROR 000496: Table is being edited“ a shodil by celý běh.",
        "- `if hodnota:` zahodí legitimní nulu. Piš `if hodnota is not None:`.",
        "- Kurzorům dej `sql_clause=(None, \"ORDER BY OBJECTID\")`, ať je pořadí",
        "  při každém spuštění stejné.",
        "- Prostorové přiřazení nedělej podle středu prvku (HAVE_THEIR_CENTER_IN) –",
        "  u tenkých dořezů u stěny míjí. Rozhodni podle největší plochy překryvu.",
        "- Když dělíš geometrii, ověř, že součet dílů sedí s originálem. Radši nerozdělit",
        "  než přijít o kus dat.",
        "",
        "OCHRANA DAT – TOHLE JE ZÁSADNÍ",
        "- Skript nesmí přepsat práci, kterou někdo udělal ručně.",
        "- Pro každou skupinu polí udělej samostatné zaškrtávátko, co se má zapisovat.",
        "  Nezaškrtnuté pole se nesmí dotknout za žádných okolností.",
        "- Přidej přepínač „přepsat i vyplněné hodnoty“. Ve výchozím stavu vypnutý –",
        "  doplňují se jen prázdná pole.",
        "- Identifikátory (např. kód dveří) NIKDY nepřečíslovávej. Už přidělené číslo",
        "  je trvalé, nové prvky dostanou další volné – přečíslování rozbije vazby",
        "  na dokumentaci.",
        "- Když analýza u prvku selže, NIC nezapisuj a nahlaš jeho OID. Nikdy nezapisuj",
        "  prázdnou hodnotu – smazal bys tím, co tam bylo.",
        "- Když má skript něco mazat nebo přepsat existující soubor, zeptej se přepínačem",
        "  a ve výchozím stavu to nedělej.",
        "",
        "JAK MÁ SKRIPT VYPISOVAT",
        "- Všechno přes `arcpy.AddMessage()`, varování `arcpy.AddWarning()`,",
        "  chyby `arcpy.AddError()`. Žádný `print()`.",
        "- Hlášky česky a pro člověka, ne pro programátora.",
        "- Na začátku napiš, co se bude dít; kroky číslovaně ve tvaru „1/4 …“, „2/4 …“.",
        "- Oddělovač mezi fázemi: `arcpy.AddMessage(\"-\" * 40)`.",
        "- Na konci shrnutí s počty: kolik prvků se zpracovalo, kolik přeskočilo, kolik chyb.",
        "- Prvky, které selhaly, vypiš i s jejich OID, ať si je uživatel najde v mapě.",
        "- U chyby napiš i tip, co s tím (uložit editaci, zrušit výběr, zkontrolovat pole).",
        "",
        "CO ODEVZDAT",
        "1. Celý skript v jednom bloku kódu.",
        "2. „Jak skript funguje pod kapotou“ – číslovaný přehled hlavních kroků logiky.",
        "3. „Nastavení nástroje v Toolboxu“ – tabulka se sloupci Label (popisek v okně),",
        "   Data Type (typ dat) a Direction/Type (Input/Required, Output/Required),",
        "   jeden řádek na každý parametr v pořadí, jak jdou ve skriptu.",
        "   U datového typu si ověř, co používá odpovídající nástroj od Esri – výstupní",
        "   výkres je např. CAD Drawing Dataset, ne File.",
        "4. „Malý tip před spuštěním“ – krátké odrážky s tím, na co si dát pozor,",
        "   a výpis názvů polí, které skript očekává.",
        "",
        "Když ti k zadání něco chybí (název vrstvy, pole, chování v hraničním případě),",
        "nejdřív se zeptej a teprve pak piš – nevymýšlej si názvy polí."
    ].join("\n");

    /** Zkopíruje pokyn do schránky. `druh`: "navod" (výchozí) nebo "skript". */
    UI.copyAiPrompt = async (catId, subId, druh) => {
        const text = druh === "skript" ? UI.scriptPrompt() : UI.aiPrompt(catId, subId);
        try {
            await navigator.clipboard.writeText(text);
            UI.toast("Pokyn zkopírován – vlož ho do chatu s AI.");
        } catch (err) {
            UI.toast("Kopírování se nezdařilo, zkuste to ručně.", "error");
        }
    };

    /* ---------------------------------------------------------- obrázky */

    UI.compressImage = (file, maxWidth = 1400, quality = 0.72) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Soubor se nepodařilo načíst."));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error("Neplatný obrázek."));
            image.onload = () => {
                const scale = Math.min(1, maxWidth / image.width);
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(image.width * scale);
                canvas.height = Math.round(image.height * scale);
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve({
                    dataUrl: canvas.toDataURL("image/jpeg", quality),
                    w: canvas.width, h: canvas.height,
                    name: file.name || "screenshot.jpg"
                });
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });

    /* Dorovnání role řešíme na jednom místě pro celý web – kdyby si to měla
       hlídat každá stránka zvlášť, dřív nebo později se na to někde zapomene
       a zůstane platit role uložená v prohlížeči. */
    document.addEventListener("DOMContentLoaded", () => {
        UI.paintUser();
        UI.paintGate();
        if (!window.KB || !window.KB.on) return;

        window.KB.on("status", UI.paintGate);
        window.KB.on("users", () => {
            UI.syncRole();
            UI.paintUser();
            UI.paintGate();
            document.dispatchEvent(new CustomEvent("kb-role"));
        });
    });
})();

/* ==========================================================================
   Mini okno ↔ hlavní okna webu (samostatné bloky, logika mini v mini.js).
   ========================================================================== */

/* --------------------------------- hlavní okno přes BroadcastChannel ---
   Mini okno (samostatné, ze zástupce na ikoně nebo plovoucí) neotvírá
   stránky webu u sebe. Zeptá se kanálem „kb-okna", jaká okna webu jsou
   otevřená, vybere jedno (mini.js vyberOkno) a pošle mu cíl: okno na cíl
   přejde, otevře detail vzkazu, nebo se jen vytáhne dopředu. Okno, ve
   kterém člověk něco psal, hlásí `rozepsano` – takové mini nepřepisuje
   a otevře raději nové. Odpovídá jen okno, které samo není mini. */
(function () {
    "use strict";

    const UI = window.KBUI;
    const KANAL = "kb-okna";
    const OKNO_ID = "o" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    // mini.js podle toho pozná, jestli vybrané okno je to, ze kterého se otevřelo
    window.KB_OKNO_ID = OKNO_ID;

    const jsemMini = () => !!window.KB_MINI || /(^|\/)mini\.html$/.test(location.pathname);
    const strankaTed = () => location.pathname.split("/").pop() || "index.html";
    // jen stránka webu s nevinným dotazem a kotvou – nic jiného se nenačte
    const ADRESA_OK = /^[a-z0-9-]+\.html(\?[A-Za-z0-9=&%._-]*)?(#[A-Za-z0-9=%._-]*)?$/;
    const QUICK_OK = /^[A-Za-z0-9_-]{1,80}$/;

    let aktivniMs = 0;
    let rozepsano = false;
    try { if (document.hasFocus()) aktivniMs = Date.now(); } catch (err) { /* nic */ }
    window.addEventListener("focus", () => { aktivniMs = Date.now(); });

    /* Rozepsaný formulář: člověk něco napsal nebo vybral (ne hledání).
       Zpátky se to nevrací – raději nové okno navíc než ztracený zápis. */
    document.addEventListener("input", (event) => {
        const t = event.target;
        if (!event.isTrusted || !t || !t.matches) return;
        if (t.matches('input[type="search"], .searchbox input')) return;
        if (t.matches("input, textarea, select, [contenteditable]")) rozepsano = true;
    }, true);

    let kanal = null;
    try { kanal = new BroadcastChannel(KANAL); } catch (err) { kanal = null; }
    if (!kanal) return;

    kanal.onmessage = (event) => {
        const d = event.data;
        if (!d || typeof d !== "object" || jsemMini()) return;
        if (d.typ === "kdo") {
            kanal.postMessage({
                typ: "tady", dotaz: d.dotaz, okno: OKNO_ID, stranka: strankaTed(),
                rozepsano: rozepsano, aktivniMs: aktivniMs,
                viditelne: document.visibilityState === "visible"
            });
            return;
        }
        if (d.typ !== "otevri" || d.okno !== OKNO_ID) return;
        const cil = (d.cil && typeof d.cil === "object") ? d.cil : {};
        const adresa = String(cil.adresa || "");
        if (cil.quick && QUICK_OK.test(String(cil.quick))) {
            if (window.KB && window.KB.watchQuickTodo) window.KB.watchQuickTodo();
            if (UI && UI.otevriQuick) UI.otevriQuick(String(cil.quick));
        } else if (!cil.jenUkazat && ADRESA_OK.test(adresa)) {
            const soubor = adresa.split(/[?#]/)[0];
            // na té stránce už jsem (a cíl nic dalšího nechce) – jen se ukázat
            const uzTady = soubor === strankaTed() && !/[?#]/.test(adresa);
            if (!uzTady) location.href = adresa;
        }
        /* Vytáhnout se okno zkusí – prohlížeč to ale bez kliknutí v něm
           nemusí dovolit (pak mini aspoň hlásí, kde se to otevřelo). */
        try { window.focus(); } catch (err) { /* nic */ }
        kanal.postMessage({ typ: "otevreno", dotaz: d.dotaz, okno: OKNO_ID });
    };
})();

/* ----------------------------------------- detail vzkazu podle #quick= ---
   Mini okno bez otevřeného hlavního okna otevře quicktodo.html#quick=ID –
   vzkaz se ukáže v okně detailu, jakmile dorazí (stejně jako klik na něj). */
(function () {
    "use strict";

    let id = "";
    const zkus = () => {
        if (!id || !(window.KB.quicktodo || []).some(q => q.id === id)) return;
        const otevrit = id;
        id = "";
        try { history.replaceState(null, "", location.pathname + location.search); } catch (err) { /* nic */ }
        window.KBUI.otevriQuick(otevrit);
    };
    const podleKotvy = () => {
        const m = /^#quick=([A-Za-z0-9_-]{1,80})$/.exec(location.hash || "");
        if (!m || window.KB_MINI || !window.KB || !window.KBUI) return;
        id = m[1];
        // vzkazy poslouchá i pás; tady pro jistotu (odběr se nezdvojí)
        if (window.KB.watchQuickTodo) window.KB.watchQuickTodo();
        zkus();
    };

    document.addEventListener("DOMContentLoaded", () => {
        if (!window.KB || !window.KB.on) return;
        window.KB.on("quicktodo", zkus);
        window.KB.on("users", podleKotvy);       // přihlášení dorazilo – odběr už půjde
        podleKotvy();
    });
    window.addEventListener("hashchange", podleKotvy);
})();

/* ------------------------------ velikost okna aplikace po mini okně ---
   Zástupce „Mini okno" na ikoně nainstalované aplikace otevře okno
   aplikace a mini.js ho zmenší (velikost předtím uloží do
   `kb-mini-velke-okno`). Chrome si pamatuje jednu velikost na celou
   aplikaci, takže by pak i web samotný naskočil jako malé okno. Okno
   aplikace (display-mode standalone) na PC, které je podezřele malé, se
   proto vrátí na uloženou velikost – jednou, pak se záznam smaže. */
(function () {
    "use strict";

    const VELKE_OKNO = "kb-mini-velke-okno";

    document.addEventListener("DOMContentLoaded", () => {
        if (window.KB_MINI || /(^|\/)mini\.html$/.test(location.pathname)) return;
        try {
            if (!window.matchMedia("(display-mode: standalone)").matches) return;
            if (window.matchMedia("(pointer: coarse)").matches) return;      // telefon, tablet
            const v = JSON.parse(localStorage.getItem(VELKE_OKNO) || "null");
            if (!v) return;
            localStorage.removeItem(VELKE_OKNO);
            if (!(Number(v.w) >= 600 && Number(v.h) >= 400)) return;
            // běžné okno nechat – jen to, které zůstalo po mini (to má do 520 px)
            if (window.outerWidth > 520 && window.outerHeight > 240) return;
            window.resizeTo(Number(v.w), Number(v.h));
        } catch (err) { /* prohlížeč změnu velikosti nedovolil */ }
    });
})();
