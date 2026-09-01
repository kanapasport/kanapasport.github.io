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
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    UI.esc = esc;

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

    /* ------------------------------------------------------------- toast */

    UI.toast = (message, tone) => {
        let el = document.getElementById("kbToast");
        if (!el) {
            el = document.createElement("div");
            el.id = "kbToast";
            el.className = "no-print";
            el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translate(-50%,140%);" +
                "z-index:300;padding:13px 20px;border-radius:12px;color:#fff;font-size:14px;font-weight:700;" +
                "box-shadow:0 18px 34px -14px rgba(0,0,0,.5);transition:transform .25s ease,opacity .25s ease;" +
                "opacity:0;max-width:min(560px,calc(100vw - 32px));text-align:center";
            document.body.appendChild(el);
        }
        el.style.background = tone === "error" ? "#b91c1c" : tone === "warn" ? "#b45309" : "#16794a";
        el.textContent = message;
        requestAnimationFrame(() => {
            el.style.transform = "translate(-50%, 0)";
            el.style.opacity = "1";
        });
        clearTimeout(el._timer);
        el._timer = setTimeout(() => {
            el.style.transform = "translate(-50%, 140%)";
            el.style.opacity = "0";
        }, 3400);
    };

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

    const PERMISSIONS = {
        "hlavni-spravce": ["*"],
        "majitel":    MANAZER_PRAVA,
        "spravce":    MANAZER_PRAVA,
        "asistentka": MANAZER_PRAVA,
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
            box.innerHTML = window.KB_USER
                ? "<b>" + esc(window.KB_USER) + "</b>" +
                  '<span class="siderail__role">' + esc(role.title) + "</span>" +
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

    /* ------------------------------------------------- trezor na hesla ---

       Otisk hesla se zpětně přečíst nedá – to je jeho smysl. Aby si hlavní
       správce mohl heslo i zobrazit, ukládá se vedle otisku ještě zašifrovaná
       podoba. Klíč se odvozuje z hesla k trezoru, které zná jen on, a nikdy
       neopouští prohlížeč; v databázi leží pouze šifrovaný text.

       Kdyby se tedy někdo k databázi dostal (dokud běží otevřená pravidla,
       je to reálné), hesla lidí z ní nevyčte. */

    const toHex = (buffer) => Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, "0")).join("");
    const fromHex = (hex) => new Uint8Array(
        (String(hex || "").match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16)));

    
    
    
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
        window.KB_USER = "";
        window.KB_EMAIL = "";
        UI.setRole("student");
        UI.paintUser();
        await window.KB.signOut().catch(() => {});
        UI.toast("Odhlášeno.");
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
                    '<img src="Pasport_Kana_black.png" alt="Pasport Kaňa" style="height:52px;object-fit:contain;margin:0 auto">' +
                    '<b style="font-size:17px;text-align:center">Přihlášení</b>' +
                    '<div><label class="label" for="kbLoginEmail">E-mail</label>' +
                        '<input id="kbLoginEmail" type="email" class="field" autocomplete="username" placeholder="jmeno@pasport.eu"></div>' +
                    '<div><label class="label" for="kbLoginPass">Heslo</label>' +
                        '<input id="kbLoginPass" type="password" class="field" autocomplete="current-password"></div>' +
                    '<div id="kbLoginErr" class="tiny" style="color:var(--danger);min-height:16px"></div>' +
                    '<button type="submit" class="btn btn--primary" style="width:100%">Přihlásit se</button>' +
                    '<button type="button" class="linkbtn" style="margin:0 auto" data-login-close>Zavřít</button>' +
                    '<div class="tiny muted" style="text-align:center;line-height:1.5">' +
                        "Heslo ti přidělí hlavní správce.</div>" +
                "</form>";
            document.body.appendChild(box);

            box.querySelector("[data-login-close]").addEventListener("click", () => box.classList.remove("is-open"));
            box.addEventListener("click", (event) => {
                if (event.target === box) box.classList.remove("is-open");
            });

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

    /** Roletka ÚKOLŮ – projekty, ke kterým existují úkoly. Bere se z nového
        seznamu úkolů; dokud není, poslouží starší úkoly z Postupu práce. */
    function taskMenu() {
        const names = [];
        const zdroj = ((window.KB && window.KB.ukoly && window.KB.ukoly.length)
            ? window.KB.ukoly : (window.KB && window.KB.tasks) || []);
        zdroj.forEach(task => {
            const name = (task.projekt || task.zakazka || "").trim() || "Bez projektu";
            if (names.indexOf(name) === -1) names.push(name);
        });
        if (!names.length) return null;

        return [{ title: "VŠECHNY ÚKOLY", href: "ukoly.html" }].concat(
            names.map(name => ({ title: name, href: "ukoly.html?zak=" + encodeURIComponent(UI.slug(name)) })));
    }

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
            const gate = item.need ? ' data-need="' + item.need + '" hidden' : "";

            if (!menu) {
                return '<div class="navitem"' + gate + '><a class="' + cls + '"' + tint +
                    ' href="' + item.href + '">' +
                    (item.icon ? icon(item.icon) : "") + item.title + "</a></div>";
            }

            const groups = menu.map(group =>
                '<div class="dropdown__group">' +
                    /* Názvy v roletce chodí z databáze (zakázky u úkolů, náplň
                       milníků) a přejmenovat je smí kdokoliv přihlášený – bez
                       ošetření by si tudy šlo podstrčit skript do lišty, tedy
                       na každou stránku webu. */
                    (group.href
                        ? '<a class="dropdown__title" href="' + esc(group.href) + '">' + esc(group.title) +
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
        { title: "SPRÁVA FIREM", href: "firmy.html", need: "vykaz.view" },
        { title: "FAKTURY", href: "faktury.html", need: "vykaz.view" }
    ];

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
                        'aria-label="Otevřít panel akcí">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">' +
                            '<path stroke-linecap="round" stroke-width="2.2" d="M4 6h16M4 12h16M4 18h16"/></svg>' +
                    "</button>" +
                    // vlevo nahoře přepínač náhledu – vykreslí se jen hlavnímu
                    // správci, ostatním zůstane skrytý (paintUser)
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
                    // barvy webu jsou jen mezi ikonami nástrojů a jen pro
                    // hlavního správce – v pruhu je to zbytečně na očích
                    // stav synchronizace se ukazuje dole ve svislém pásu;
                    // tady zůstává jen přihlášení, úplně vpravo
                    '<div class="appbar__userbox">' +
                        '<div class="appbar__user" data-userbox></div>' +
                    "</div>" +
                    '<a class="appbar__logo" href="index.html" aria-label="Domů">' +
                        '<img src="Pasport_Kana_white.png" alt="Pasport Kaňa">' +
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
        placeSearch();
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
            window.KB.on("milniky", refreshNav);
            window.KB.on("vykazy", () => { renderMujDen();
                /* hlídka smí rozhodnout až nad skutečnými záznamy – emit
                   umí vyvolat i odběr částek dřív, než záznamy dorazí */
                if (window.KB.vykazyPrisly) {
                    hlidkaPrislo.vykazy = true; hlidkaVykazu(); hlidkaDopredu();
                } });
            /* Panel se překresluje taky – byl navázaný jen pás, takže nový
               vzkaz (i vlastní poznámka) se v otevřeném panelu objevil až
               po jeho zavření a otevření. */
            window.KB.on("quicktodo", () => { renderMujDen(); renderQuick();
                hlidkaPrislo.quick = true; hlidkaVykazu(); hlidkaDopredu(); });
            window.KB.on("users", () => { pozadejOData(); renderMujDen(); renderQuick(); });
            window.KB.on("auta", renderAuta);
        }
        document.addEventListener("kb-role", () => { pozadejOData(); renderMujDen(); renderQuick(); });
    };

    /** Překreslí navigaci (obsah roletek se bere z databáze). */
    function refreshNav() {
        const active = lastNav.active || location.pathname.split("/").pop() || "index.html";
        const nav = document.querySelector(".appbar__nav");
        if (!nav) return;
        nav.outerHTML = navHtml(active);
        bindNav();
        UI.paintUser();
    }

    /* ------------------------------------------------------- svislý pás ---
       Logo (klik = domů), hledání a rychlé akce – jako v Caflou. Vykresluje
       se na každé stránce; na úzkém okně a na dotyku ho CSS schová a hledání
       se přestěhuje zpátky do lišty (placeSearch). */

    function mountRail() {
        if (document.querySelector(".siderail")) return;
        const rail = document.createElement("aside");
        rail.className = "siderail no-print";
        rail.innerHTML =
            '<a class="siderail__logo" href="index.html" aria-label="Domů">' +
                '<img src="Pasport_Kana_white.png" alt="Pasport Kaňa"></a>' +
            '<div data-rail-search></div>' +
            // STATS – osobní stav, ne kopie lišty (viz komentář u renderMujDen)
            '<div class="siderail__mujden" data-rail-mujden hidden></div>' +
            /* Provozní trojice Quick TO-DO / Správa aut / Home office –
               vzkazy a plánování, které smí každý. Oddělená čarou z obou
               stran (přání Michala 26. 8. 2026). */
            '<div class="siderail__oddel"></div>' +
            '<button type="button" class="siderail__btn" data-jen-prihlaseny hidden data-quick-otevri>' +
                icon("tasks") + '<span>Quick TO-DO</span>' +
                '<span class="siderail__odznak" data-quick-pocet hidden></span></button>' +
            '<button type="button" class="siderail__btn" data-jen-prihlaseny hidden data-auta-otevri>' +
                icon("car") + "<span>Správa aut</span></button>" +
            '<button type="button" class="siderail__btn" data-jen-prihlaseny hidden data-ho-otevri>' +
                icon("calendar") + "<span>Rychlý zápis</span></button>" +
            '<a class="siderail__btn" href="postup.html" data-jen-prihlaseny hidden>' +
                icon("scan") + "<span>Postup dne</span></a>" +
            '<div class="siderail__oddel"></div>' +
            '<a class="siderail__btn" href="prirucka.html" data-jen-prihlaseny hidden>' +
                icon("library") + "<span>Jak web používat</span></a>" +
            '<div class="siderail__spodek">' +
                '<a class="siderail__btn siderail__btn--hlavni" href="vykazy.html#novy"' +
                    ' data-need="vykaz.otevrit" hidden>' +
                    icon("plus") + "<span>Nový výkaz</span></a>" +
                '<a class="siderail__btn" href="ukoly.html?moje=1" data-jen-prihlaseny hidden>' +
                    icon("tasks") + "<span>Moje úkoly</span></a>" +
                // zakládání projektů je manažerská práce, proto až za úkoly
                '<a class="siderail__btn" href="sprava.html#novy" data-need="zakazky.manage" hidden>' +
                    icon("building") + "<span>Nový projekt</span></a>" +
                '<a class="siderail__btn" href="nastaveni.html" data-need="vykaz.view" hidden>' +
                    icon("cog") + "<span>Nastavení</span></a>" +
                '<div class="siderail__ja" data-rail-ja></div>' +
                '<div class="siderail__stav" data-cloud-status>Připojuji…</div>' +
            "</div>";
        document.body.insertBefore(rail, document.body.firstChild);
    }

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
                        '<input type="text" class="field" data-quick-text maxlength="300" ' +
                            'placeholder="Napiš rychlý úkol">' +

                        /* Lidí může být víc – stejný vzkaz se často posílá
                           celé partě. Zaškrtávátka místo roletky, ať je vidět,
                           komu to jde, bez rozbalování. */
                        '<div class="quickpanel__kdo">' +
                            '<div class="quickpanel__popisek">Komu' +
                                '<button type="button" class="linkbtn" data-quick-oblibene-uloz>uložit jako oblíbené</button>' +
                            "</div>" +
                            '<div class="quickpanel__oblibene" data-quick-oblibene></div>' +
                            '<div class="quickpanel__lide" data-quick-komu></div>' +
                        "</div>" +

                        '<div class="quickpanel__radek">' +
                            '<label class="quickpanel__do">Do:' +
                                '<input type="date" class="field" data-quick-kdy aria-label="Do kdy">' +
                            "</label>" +
                        "</div>" +
                        '<label class="quickpanel__asap">' +
                            '<input type="checkbox" data-quick-asap> <b>Udělej co nejdříve</b>' +
                            '<span>bez termínu, řadí se první</span>' +
                        "</label>" +

                        '<select class="field" data-quick-projekt aria-label="Projekt"></select>' +
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
        const ted = new Set(proMe.filter(q => !q.hotovo).map(q => q.id));
        if (quickZname !== null) {
            const novy = proMe.find(q => !q.hotovo && !quickZname.has(q.id) &&
                (q.ms || 0) > casNacteni);
            if (novy) {
                pipni();
                UI.toast("Nový quick to-do od " + (novy.odKohoJmeno || "?") +
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
    }

    function naplnQuickForm(panel, uid) {
        // nabídky (jen jednou, ať se nepřepisuje rozepsaný výběr)
        const komu = panel.querySelector("[data-quick-komu]");
        /* Sebe si zadavatel zaškrtne první volbou „Jen pro mě" – poznámka
           pro sebe je jiný záměr než vzkaz kolegovi a dřív se nedala uložit
           vůbec (bez vybraného člověka to hlásilo chybu).
           Řadí se manažeři, pak zaměstnanci, pak studenti; nadpisy k tomu
           netřeba, stačí, že to drží pohromadě. */
        const PORADI = { "hlavni-spravce": 0, "majitel": 1, "spravce": 2, "asistentka": 3,
                         "zamestnanec": 4, "student": 5 };
        const lide = (window.KB.users || [])
            .filter(u => u.active !== false && u.id !== uid)
            .sort((a, b) => (PORADI[a.role] === undefined ? 9 : PORADI[a.role]) -
                            (PORADI[b.role] === undefined ? 9 : PORADI[b.role]) ||
                            (a.last || "").localeCompare(b.last || "", "cs"));

        if (!komu.querySelector("input")) {
            komu.innerHTML =
                '<label class="quickpanel__ja"><input type="checkbox" value="' + esc(uid) +
                    '" data-quick-jaja> Jen pro mě</label>' +
                lide.map(u =>
                    '<label><input type="checkbox" value="' + esc(u.id) + '"> ' +
                    esc(((u.first || "") + " " + (u.last || "")).trim()) + "</label>").join("");
        }
        vykresliOblibene();
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
            const poTerminu = !q.hotovo && q.doKdy && q.doKdy < dnesISO();
            /* U společného vzkazu se vypisuje, s kým na tom člověk je –
               sebe v tom seznamu vidět nepotřebuje. */
            const ostatni = adresati(q).filter(x => x !== uid).map(jmeno).filter(Boolean);

            /* hlídka výkazů: oranžově dokud jde o běžící týden, červeně
               v pondělí, kdy je poslední šance doplnit ten minulý */
            const hlidkaBarva = q.hotovo ? "" :
                q.hlidka === "minuly" ? "#c8102e" :
                q.hlidka === "tyden" ? "#b06000" : "";

            return '<div class="quickrad' +
                (q.hotovo ? " quickrad--hotovo" : (q.asap ? " quickrad--asap" : "")) + '">' +
                '<span class="quickrad__text">' +
                (hlidkaBarva
                    ? '<b style="color:' + hlidkaBarva + '">' + esc(q.text) + "</b>"
                    : esc(q.text)) +
                    '<span class="quickrad__kdo">' +
                        /* Pod nadpisem „Poslal jsem" je „Zadal: já" jen
                           zopakování toho, co už tam stojí – vynechává se. */
                        /* Oddělovač se dává jen MEZI kusy, ne před první –
                           u vlastního vzkazu chybí „Zadal:" a řádek by jinak
                           začínal osamocenou tečkou. */
                        [ mujVzkaz ? "" : "Zadal: " + esc(q.odKohoJmeno || jmeno(q.odKoho) || "?"),
                          q.projekt ? esc(q.projekt) : "",
                          q.asap ? '<span class="quickrad__asap">co nejdříve</span>' : "",
                          q.doKdy ? '<span class="' + (poTerminu ? "quickrad__po" : "") + '">do ' +
                            esc(czDatumKratke(q.doKdy)) + "</span>" : ""
                        ].filter(Boolean).join(" · ") +
                        (ostatni.length ? "<br>Spoluúčast: " + esc(ostatni.join(", ")) : "") +
                        (q.hotovo && q.hotovoKdo
                            ? '<br><span class="quickrad__splnil">splnil ' + esc(q.hotovoKdo) +
                              (q.hotovoMs ? " · " + esc(czDatumKratke(new Date(q.hotovoMs)
                                  .toISOString().slice(0, 10))) : "") + "</span>" : "") +
                    "</span>" +
                "</span>" +
                /* vzkaz svázaný s poznámkou nese odkaz – proklik přistane
                   rovnou na té poznámce (poznamky.html si ji samo otevře) */
                (q.poznamka ? '<a class="btn btn--ghost btn--sm" href="poznamky.html?pozn=' +
                    esc(q.poznamka) + '">Otevřít</a>' : "") +
                // splněné mizí ze seznamu, proto pořádné tlačítko a ne zaškrtávátko
                (q.hotovo
                    ? '<button type="button" class="btn btn--ghost btn--sm" data-quick-hotovo="' +
                        esc(q.id) + '" data-zpet="1">Vrátit</button>'
                    : '<button type="button" class="btn btn--sm quicksplnit" data-quick-hotovo="' +
                        esc(q.id) + '">Splněno</button>') +
                (q.odKoho === uid ? '<button type="button" class="linkbtn" data-quick-smaz="' +
                    esc(q.id) + '" title="Smazat">×</button>' : "") +
            "</div>";
        };

        /* Splněné se schovávají – jinak by seznam jen rostl. Kdo je chce
           vidět (nebo vrátit), rozklikne si je dole. */
        /* „Co nejdříve" nahoru, pak termíny od nejbližšího, nakonec vzkazy
           bez termínu. Bez řazení by ASAP zapadlo mezi ostatní. */
        const naporadi = (a, b) =>
            (b.asap ? 1 : 0) - (a.asap ? 1 : 0) ||
            (a.doKdy ? 0 : 1) - (b.doKdy ? 0 : 1) ||
            (a.doKdy || "").localeCompare(b.doKdy || "");

        const aktivniProMe = proMe.filter(q => !q.hotovo).sort(naporadi);
        const aktivniOdeMe = odeMe.filter(q => !q.hotovo).sort(naporadi);
        /* Historie splněných drží jen poslední týden – starší zůstávají
           v databázi a v týdenních lozích reportů, tady by jen překážely. */
        const tydenZpet = Date.now() - 7 * 24 * 3600 * 1000;
        const mojeRezim = quickRezim !== "zadane";
        // třetí přepínač: jen vzkazy svázané s poznámkou (upozornění kolegů)
        const jenPozn = quickRezim === "poznamky";
        const splnene = (mojeRezim ? proMe : odeMe)
            .filter(q => q.hotovo && (!jenPozn || q.poznamka)
                && (q.hotovoMs || q.ms || 0) >= tydenZpet);
        const aktivni = (mojeRezim ? aktivniProMe : aktivniOdeMe)
            .filter(q => !jenPozn || q.poznamka);

        const seznamHtml =
            '<div class="row" style="gap:6px;margin-bottom:10px">' +
                '<button type="button" class="chip' + (quickRezim === "moje" ? " chip--active" : "") +
                    '" data-quick-rezim="moje">Moje</button>' +
                '<button type="button" class="chip' + (quickRezim === "zadane" ? " chip--active" : "") +
                    '" data-quick-rezim="zadane">Zadané</button>' +
                '<button type="button" class="chip' + (jenPozn ? " chip--active" : "") +
                    '" data-quick-rezim="poznamky">Poznámky</button>' +
            "</div>" +
            (aktivni.length
                ? aktivni.map(q => radek(q, !mojeRezim)).join("")
                : '<div class="quickpanel__prazdno">' + (mojeRezim
                    ? "Žiješ šťastný život, nikdo po tobě nic nechce."
                    : "Nic zadaného – co jsi poslal, je splněné nebo smazané.") + "</div>") +
            (splnene.length
                ? '<button type="button" class="linkbtn" data-quick-splnene style="margin-top:14px">' +
                    (quickSplneneVidet ? "Skrýt historii" : "Splněné za poslední týden (" + splnene.length + ")") +
                  "</button>" +
                  (quickSplneneVidet ? splnene.map(q => radek(q, !mojeRezim)).join("") : "")
                : "");
        document.querySelectorAll("[data-quick-seznam]").forEach(el => {
            el.innerHTML = seznamHtml;
        });

        // odznak s počtem nesplněných na tlačítku v pásu
        const kolik = proMe.filter(q => !q.hotovo).length;
        document.querySelectorAll("[data-quick-pocet]").forEach(el => {
            el.textContent = kolik;
            el.hidden = !kolik;
        });
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
            // kdo další ten den je doma – ať se parta domluví
            const ostatni = (window.KB.kalendar || [])
                .filter(k => k.typ === "homeoffice" && k.uid !== uid &&
                    (k.od || "") <= den.iso && den.iso <= (k.do || k.od || ""))
                .map(k => (k.osoba || "").split(" ")[0]).filter(Boolean);
            return '<div class="hoden">' +
                '<span class="hoden__den"><b>' + esc(den.nazev) + "</b> " +
                    esc(den.popis) + "</span>" +
                (den.svatek ? '<span class="hoden__svatek" title="' + esc(den.svatek) +
                    '">svátek</span>' : "") +
                '<span class="hoden__tlacitka">' + tlacitka + "</span>" +
                (ostatni.length
                    ? '<span class="hoden__ostatni" title="Kdo další je ten den na HO">HO: ' +
                        esc(ostatni.join(", ")) + "</span>" : "") +
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

    document.addEventListener("click", async (event) => {
        if (event.target.closest("[data-quick-otevri]")) {
            mountQuickPanel();
            renderQuick();
            prepniQuick(true);
            setTimeout(() => {
                const pole = document.querySelector("#kbQuickPanel [data-quick-text]");
                if (pole) pole.focus();
            }, 60);
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
        // Splněno / Vrátit – tlačítkem, ne zaškrtávátkem
        const hotovoBtn = event.target.closest("[data-quick-hotovo]");
        if (hotovoBtn && hotovoBtn.tagName === "BUTTON") {
            // dlaždice na nástěnce si Splněno obsluhuje sama – viz mazání výš
            if (!hotovoBtn.closest("#kbQuickPanel, [data-quick-seznam]")) return;
            const q = (window.KB.quicktodo || []).find(x => x.id === hotovoBtn.dataset.quickHotovo);
            if (q) {
                // u společného vzkazu se zapíše, kdo ho odškrtl za všechny
                const hotovo = !hotovoBtn.dataset.zpet;
                window.KB.saveQuickTodo(q.id, Object.assign({}, q, {
                    hotovo: hotovo,
                    hotovoKdo: hotovo ? (window.KB_USER || "") : "",
                    hotovoMs: hotovo ? Date.now() : 0
                })).catch(() => UI.toast("Uložení selhalo.", "error"));
            }
            return;
        }
        if (!event.target.closest("[data-quick-uloz]")) return;

        const panel = document.getElementById("kbQuickPanel");
        const text = panel.querySelector("[data-quick-text]").value.trim();
        const komu = vybraniKomu();
        if (!text) return UI.toast("Napiš, co se nemá zapomenout.", "warn");
        if (!komu.length) return UI.toast("Vyber, komu vzkaz patří – nebo zaškrtni Jen pro mě.", "warn");

        const asap = panel.querySelector("[data-quick-asap]").checked;
        const doKdy = panel.querySelector("[data-quick-kdy]").value;
        const projekt = panel.querySelector("[data-quick-projekt]").value;

        try {
            /* Jeden vzkaz pro všechny vybrané – je to společný úkol. Kdo ho
               odškrtne, odškrtne ho všem a ostatním zmizí ze seznamu. */
            await window.KB.saveQuickTodo(window.KB.newQuickId(), {
                text: text, proUids: komu,
                doKdy: asap ? "" : doKdy,   // „co nejdříve" termín nemá
                asap: asap,
                projekt: projekt
            });

            panel.querySelector("[data-quick-text]").value = "";
            panel.querySelector("[data-quick-kdy]").value = "";
            panel.querySelector("[data-quick-asap]").checked = false;
            panel.querySelector("[data-quick-projekt]").value = "";
            panel.querySelectorAll("[data-quick-komu] input:checked")
                .forEach(ch => { ch.checked = false; });

            const jenJa = komu.length === 1 && komu[0] === window.KB.currentUid();
            UI.toast(jenJa ? "Poznámka uložena jen pro tebe."
                : komu.length === 1 ? "Quick to-do zadáno."
                : "Společný quick to-do zadán " + komu.length + " lidem.");
        } catch (err) {
            console.error(err);
            UI.toast("Odeslání selhalo.", "error");
        }
    });

    /* --------------------------------------------- ovládání oblíbených part */

    document.addEventListener("click", (event) => {
        const panel = document.getElementById("kbQuickPanel");
        if (!panel) return;

        if (event.target.closest("[data-quick-oblibene-uloz]")) {
            const komu = vybraniKomu();
            if (!komu.length) return UI.toast("Nejdřív zaškrtni lidi, které chceš uložit.", "warn");

            const nazev = (prompt("Jak se má ta parta jmenovat?", "") || "").trim();
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

    document.addEventListener("keydown", (event) => {
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
            s + (u.todo || []).filter(t => (Number(t.pct) || 0) < 100).length, 0);
        const quickZbyva = (window.KB.quicktodo || [])
            .filter(q => !q.hotovo && q.proUid === uid).length;

        const cislo = (h) => Number(h || 0).toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
        const czDatum = (i) => { const [, m, d] = i.split("-"); return Number(d) + ". " + Number(m) + "."; };

        slot.hidden = false;
        slot.innerHTML =
            '<span class="siderail__nadpis">Stats</span>' +
            '<div class="mujden__radek"><span>Dnes</span><b>' + cislo(hodinyDnes) + " h</b></div>" +
            '<div class="mujden__radek"><span>Tento týden</span><b>' + cislo(hodinyTyden) + " h</b></div>" +
            '<div class="mujden__radek"><span>Moje úkoly</span><b>' + mojeUkoly.length + "</b></div>" +
            '<div class="mujden__radek"><span>TO-DO</span><b>' + todoZbyva + "</b></div>" +
            '<div class="mujden__radek"><span>Quick TO-DO</span><b>' + quickZbyva + "</b></div>" +
            (nejblizsi
                ? '<a class="mujden__termin" href="ukoly.html?moje=1">' +
                    "<span>Nejbližší termín · " + esc(czDatum(nejblizsi.termin)) + "</span>" +
                    "<b>" + esc(nejblizsi.nazev || "") + "</b></a>"
                : "");
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

    function zavriPas() {
        document.body.classList.remove("pas-otevren");
        const zaclona = document.querySelector(".pas-zaclona");
        if (zaclona) zaclona.hidden = true;
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
            return;
        }
        if (e.target.classList && e.target.classList.contains("pas-zaclona")) {
            zavriPas();
            return;
        }
        // ťuknutí na akci v pásu pás rovnou zavře, ať nezůstane přes obsah
        if (document.body.classList.contains("pas-otevren") &&
            e.target.closest && e.target.closest(".siderail a, .siderail button")) {
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

    // přihlášení a odhlášení – kdekoliv na stránce
    document.addEventListener("click", (event) => {
        const target = event.target.closest("[data-logout],[data-login],[data-role-pill]");
        if (!target) return;
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
            document.querySelectorAll(selector).forEach(el => {
                el.textContent = status === "online" ? "Živě synchronizováno"
                    : status === "offline" ? "Offline režim" : "Připojuji…";
                el.dataset.state = status;   // barvu řeší CSS podle podkladu
            });
        };
        paint(window.KB ? window.KB.status : "connecting");
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
    function umistiHledac(obal) {
        const r = hledacVstup(obal).getBoundingClientRect();
        const seznam = hledacSeznam(obal);
        const podNim = window.innerHeight - r.bottom - 12;
        const nadNim = r.top - 12;
        const dolu = podNim >= 200 || podNim >= nadNim;

        seznam.style.left = r.left + "px";
        seznam.style.width = r.width + "px";
        seznam.style.maxHeight = Math.max(120, Math.min(320, dolu ? podNim : nadNim)) + "px";
        seznam.style.top = dolu ? (r.bottom + 4) + "px" : "auto";
        seznam.style.bottom = dolu ? "auto" : (window.innerHeight - r.top + 4) + "px";
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
