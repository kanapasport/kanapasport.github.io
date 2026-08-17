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
    UI.ROLES = [
        { id: "hlavni-spravce", title: "Hlavní správce", short: "HL. SPRÁVCE" },
        { id: "spravce",        title: "Manažer",        short: "MANAŽER" },
        { id: "zamestnanec",    title: "Zaměstnanec",    short: "ZAMĚSTNANEC" },
        { id: "student",        title: "Student",        short: "STUDENT" }
    ];

    const PERMISSIONS = {
        "hlavni-spravce": ["*"],
        "spravce": [
            "ukol.create", "ukol.edit", "ukol.delete",
            "zakazky.manage", "historie.view", "milnik.manage",
            "navod.create", "navod.delete", "navod.pdf",
            "vykaz.otevrit", "vykaz.view", "vykaz.edit"
        ],
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

    /** Role, podle které se stránka vykresluje – tedy náhled, když je zapnutý. */
    UI.role = () => UI.nahled() || UI.skutecnaRole();
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
    UI.isAdmin = () => UI.isOwner() || UI.role() === "spravce";

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
            const role = UI.ROLES.find(r => r.id === UI.role()) || UI.ROLES[3];
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
            const role = UI.ROLES.find(r => r.id === UI.role()) || UI.ROLES[3];
            el.textContent = window.KB_USER ? role.short : "NEPŘIHLÁŠEN";
            el.className = "rolepill" + (UI.isAdmin() ? " rolepill--admin" : "") +
                           (window.KB_USER ? "" : " rolepill--off");
        });
        // prvky, které smí vidět jen někdo – data-need="ukol.create"
        document.querySelectorAll("[data-need]").forEach(el => {
            el.hidden = !UI.can(el.dataset.need);
        });
        paintNahled();
    };

    /** Přepínač náhledu a pruh, který připomíná, že je zapnutý. */
    function paintNahled() {
        const jeHlavni = UI.skutecnaRole() === "hlavni-spravce";
        const nahled = UI.nahled();

        document.querySelectorAll("[data-nahled-box]").forEach(box => { box.hidden = !jeHlavni; });
        document.querySelectorAll("[data-nahled]").forEach(sel => { sel.value = nahled; });

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
        pruh.innerHTML = "<span><b>Prohlížíš web jako " + esc((role.title || nahled).toLowerCase()) +
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

    UI.deriveVaultKey = async (passphrase, saltHex) => {
        const base = await crypto.subtle.importKey(
            "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: fromHex(saltHex), iterations: 150000, hash: "SHA-256" },
            base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    };

    UI.vaultEncrypt = async (key, text) => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(String(text)));
        return { iv: toHex(iv), data: toHex(data) };
    };

    UI.vaultDecrypt = async (key, blob) => {
        if (!blob || !blob.iv || !blob.data) return "";
        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: fromHex(blob.iv) }, key, fromHex(blob.data));
        return new TextDecoder().decode(plain);
    };

    /** Kontrolní věta – ověří, že zadané heslo k trezoru je to správné. */
    UI.VAULT_CHECK = "PASPORT-KANA-TREZOR";

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
    function projektyMenu() {
        const dulezitost = { "resit-okamzite": 0, "vysoka": 1, "stredni": 2, "nizka": 3 };
        const otevrene = ((window.KB && window.KB.projektyDocs) || [])
            .filter(p => !p.uzavreno)
            .sort((a, b) => (dulezitost[a.priorita] ?? 9) - (dulezitost[b.priorita] ?? 9)
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
            const cls = "navbtn" + (isActive ? " navbtn--active" : "");
            const menu = menuOf(item);
            // položka s `need` se ukáže jen tomu, kdo na ni má právo
            const gate = item.need ? ' data-need="' + item.need + '" hidden' : "";

            if (!menu) {
                return '<div class="navitem"' + gate + '><a class="' + cls + '" href="' + item.href + '">' +
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
                ? '<a class="' + cls + '" href="' + item.href + '" data-menu-toggle="' + index + '">' +
                      item.title + CARET + "</a>"
                : '<button type="button" class="' + cls + '" data-menu-toggle="' + index + '">' +
                      item.title + CARET + "</button>";

            return '<div class="navitem" data-menu="' + index + '">' + head +
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
        { title: "SPRÁVA FIREM", href: "firmy.html", need: "vykaz.view" }
    ];

    /** Nástroje vpravo nad lištou – vidět je ikona, popis vyjede po najetí. */
    function toolsHtml() {
        const tools = (window.KB_TOOLS || []).map(tool => {
            const inner = icon(tool.icon) + "<span>" + tool.title + "</span>";
            // nástroj s `need` se ukáže jen tomu, kdo na něj má právo
            const gate = tool.need ? ' data-need="' + tool.need + '" hidden' : "";
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
            window.KB.on("vykazy", renderMujDen);
            window.KB.on("quicktodo", renderMujDen);
            window.KB.on("users", () => { pozadejOData(); renderMujDen(); renderQuick(); });
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
            '<div class="siderail__spodek">' +
                /* Quick TO-DO smí každý – je to vzkaz kolegovi, ne firemní
                   údaj. Proto bez data-need, stejně jako Moje úkoly. */
                '<button type="button" class="siderail__btn" data-quick-otevri>' +
                    icon("tasks") + '<span>Quick TO-DO</span>' +
                    '<span class="siderail__odznak" data-quick-pocet hidden></span></button>' +
                '<a class="siderail__btn siderail__btn--hlavni" href="vykazy.html#novy"' +
                    ' data-need="vykaz.otevrit" hidden>' +
                    icon("plus") + "<span>Nový výkaz</span></a>" +
                '<a class="siderail__btn" href="ukoly.html?moje=1">' +
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

    /* ------------------------------------------------------ Quick TO-DO ---
       Panel vyjede zpoza pásu přes obsah stránky – vzkaz se často píše
       uprostřed jiné práce a nemá smysl kvůli němu někam odcházet.
       Je dostupný na každé stránce a smí ho poslat každý. */

    function mountQuickPanel() {
        if (document.getElementById("kbQuickPanel")) return;
        const panel = document.createElement("div");
        panel.id = "kbQuickPanel";
        panel.className = "quickpanel no-print";
        /* Skrytí i inline: kdyby se CSS načetlo pozdě nebo ze zastaralé
           mezipaměti, panel by ležel přes pás jako neschovaný blok –
           přesně to se Michalovi stalo. Inline hodnoty drží zavřený stav
           nezávisle na souboru se styly. */
        panel.style.pointerEvents = "none";
        panel.innerHTML =
            '<div class="quickpanel__stin" data-quick-zavri></div>' +
            '<div class="quickpanel__deska">' +
                '<div class="quickpanel__hlava">' +
                    '<span class="quickpanel__stitek">Quick TO-DO</span>' +
                    '<button type="button" class="linkbtn" data-quick-zavri>Zavřít</button>' +
                "</div>" +
                '<div class="quickpanel__telo">' +
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
                    '<div class="quickpanel__seznam" data-quick-seznam></div>' +
                "</div>" +
            "</div>";
        document.body.appendChild(panel);
        const deska = panel.querySelector(".quickpanel__deska");
        deska.style.transform = "translateX(-102%)";
        deska.style.visibility = "hidden";
        panel.querySelector(".quickpanel__stin").style.opacity = "0";
    }

    /**
     * Otevře nebo zavře panel. Posun i poloha se nastavují rovnou na prvek,
     * ne jen třídou: v jednom prohlížeči se změna třídy do rozvržení
     * nepropsala a panel zůstal ležet přes pás. Levý okraj se měří z pásu –
     * media query se nemusí trefit do všech kombinací šířky a zvětšení.
     */
    function prepniQuick(otevrit) {
        const panel = document.getElementById("kbQuickPanel");
        if (!panel) return;
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
        if (!panel || !uid) return;

        // nabídky (jen jednou, ať se nepřepisuje rozepsaný výběr)
        const komu = panel.querySelector("[data-quick-komu]");
        /* Sebe si zadavatel nezaškrtává – vzkaz vidí v seznamu tak jako tak,
           protože ho poslal. Řadí se manažeři, pak zaměstnanci, pak studenti;
           nadpisy k tomu netřeba, stačí, že to drží pohromadě. */
        const PORADI = { "hlavni-spravce": 0, "spravce": 1, "zamestnanec": 2, "student": 3 };
        const lide = (window.KB.users || [])
            .filter(u => u.active !== false && u.id !== uid)
            .sort((a, b) => (PORADI[a.role] === undefined ? 9 : PORADI[a.role]) -
                            (PORADI[b.role] === undefined ? 9 : PORADI[b.role]) ||
                            (a.last || "").localeCompare(b.last || "", "cs"));

        if (lide.length && !komu.querySelector("input")) {
            komu.innerHTML = lide.map(u =>
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

            return '<div class="quickrad' + (q.hotovo ? " quickrad--hotovo" : "") + '">' +
                '<span class="quickrad__text">' + esc(q.text) +
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
        const splnene = proMe.concat(odeMe).filter(q => q.hotovo);

        panel.querySelector("[data-quick-seznam]").innerHTML =
            (aktivniProMe.length
                ? '<div class="quickpanel__nadpis">Pro mě</div>' + aktivniProMe.map(q => radek(q, false)).join("")
                : '<div class="quickpanel__prazdno">Žiješ šťastný život, nikdo po tobě nic nechce.</div>') +
            (aktivniOdeMe.length
                ? '<div class="quickpanel__nadpis">Poslal jsem</div>' + aktivniOdeMe.map(q => radek(q, true)).join("")
                : "") +
            (splnene.length
                ? '<button type="button" class="linkbtn" data-quick-splnene style="margin-top:14px">' +
                    (quickSplneneVidet ? "Skrýt historii" : "Historie – splněné (" + splnene.length + ")") +
                  "</button>" +
                  (quickSplneneVidet ? splnene.map(q => radek(q, q.odKoho === uid && q.proUid !== uid)).join("") : "")
                : "");

        // odznak s počtem nesplněných na tlačítku v pásu
        const kolik = proMe.filter(q => !q.hotovo).length;
        document.querySelectorAll("[data-quick-pocet]").forEach(el => {
            el.textContent = kolik;
            el.hidden = !kolik;
        });
    }

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
            window.KB.deleteQuickTodo(smaz.dataset.quickSmaz)
                .catch(() => UI.toast("Smazání selhalo.", "error"));
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
        if (!komu.length) return UI.toast("Vyber, komu vzkaz patří.", "warn");

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

            UI.toast(komu.length === 1 ? "Quick to-do zadáno."
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
        if (!box || !doRailu || !doListy) return;
        const cil = isCompact() ? doListy : doRailu;
        if (box.parentElement !== cil) cil.appendChild(box);
    }
    window.addEventListener("resize", placeSearch);
    // resize někdy nepřijde (otočení tabletu, obnovení okna) – hlídá se i média
    try {
        window.matchMedia("(max-width: 1120px), (hover: none)")
            .addEventListener("change", placeSearch);
    } catch (err) { /* starší prohlížeč – stačí resize */ }

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
        "PROSTŘEDÍ",
        "- ArcGIS Pro, Python 3 z prostředí arcgispro-py3. Používej jen `arcpy`",
        "  a standardní knihovnu, nic se nedoinstalovává.",
        "- Skript se zapojuje jako Script Tool do našeho toolboxu, nespouští se v Notebooku.",
        "",
        "NAŠE DATA",
        "- Každé patro budovy je vlastní File Geodatabase (např. P01 = přízemí,",
        "  N01 = 1. patro, N02 = 2. patro).",
        "- Feature classy mají tvar Q<číslo>_<oblast>_<název>: Q3 = konstrukce,",
        "  Q4 = technologie, Q5 = zařízení, Q6 = facility management (místnosti).",
        "- Prvky se propojují přes polohový kód místnosti.",
        "- Technologie (chlazení, vzduchotechnika, voda, požární …) mají vlastní složky.",
        "",
        "JAK MÁ SKRIPT VYPADAT",
        "- Jeden samostatný .py soubor, nic víc.",
        "- Nahoře `import arcpy` a `arcpy.env.overwriteOutput = True`.",
        "- Vstupy ber výhradně přes `arcpy.GetParameterAsText(0)`, `(1)`, … hned na",
        "  začátku a pod sebe. Žádné natvrdo zapsané cesty k datům.",
        "- Názvy polí dej jako konstanty pod parametry (velkými písmeny), ať se dá",
        "  jediné místo přepsat, když se pole v geodatabázi jmenuje jinak.",
        "- Zaškrtávátko z toolboxu se čte jako `arcpy.GetParameterAsText(n).lower() == 'true'`.",
        "- Mezivýsledky dělej ve workspace `memory` s časovým razítkem v názvu",
        "  (`f\"memory\\\\neco_{int(time.time())}\"`), pak je `Append`ni do cílové vrstvy.",
        "  Do mapy nesmí přibýt žádná odpadní vrstva.",
        "- Celý běh obal do `try` / `except` / `finally`; ve `finally` ukliď dočasná data.",
        "- Komentáře česky, jednoduché a k věci. Kód rozděl očíslovanými bloky.",
        "- Ošetři prázdný vstup, chybějící pole a to, že v mapě může být aktivní výběr.",
        "",
        "JAK MÁ SKRIPT VYPISOVAT",
        "- Všechno přes `arcpy.AddMessage()`, varování `arcpy.AddWarning()`,",
        "  chyby `arcpy.AddError()`. Žádný `print()`.",
        "- Hlášky česky a pro člověka, ne pro programátora.",
        "- Na začátku napiš, co se bude dít; kroky číslovaně ve tvaru „1/4 …“, „2/4 …“.",
        "- Oddělovač mezi fázemi: `arcpy.AddMessage(\"-\" * 40)`.",
        "- Na konci shrnutí s počty: kolik prvků se zpracovalo, kolik přeskočilo, kolik chyb.",
        "- U chyby napiš i tip, co s tím (uložit editaci, zrušit výběr, zkontrolovat pole).",
        "",
        "CO ODEVZDAT",
        "1. Celý skript v jednom bloku kódu.",
        "2. „Jak skript funguje pod kapotou“ – číslovaný přehled hlavních kroků logiky.",
        "3. „Nastavení nástroje v Toolboxu“ – tabulka se sloupci Label (popisek v okně),",
        "   Data Type (typ dat) a Direction/Type (Input/Required, Output/Required),",
        "   jeden řádek na každý `GetParameterAsText` v pořadí, jak jdou ve skriptu.",
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
