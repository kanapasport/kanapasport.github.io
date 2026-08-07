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

    UI.ROLES = [
        { id: "hlavni-spravce", title: "Hlavní správce", short: "HL. SPRÁVCE" },
        { id: "spravce",        title: "Správce",        short: "SPRÁVCE" },
        { id: "zamestnanec",    title: "Zaměstnanec",    short: "ZAMĚSTNANEC" },
        { id: "student",        title: "Student",        short: "STUDENT" }
    ];

    const PERMISSIONS = {
        "hlavni-spravce": ["*"],
        "spravce": [
            "ukol.create", "ukol.edit", "ukol.delete",
            "zakazky.manage", "historie.view", "milnik.manage",
            "navod.create", "navod.delete", "navod.pdf"
        ],
        "zamestnanec": ["ukol.create", "ukol.edit", "navod.create"],
        "student":     ["ukol.edit", "navod.create"]
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
        "users.manage":   "spravovat uživatele",
        "web.design":     "měnit vzhled webu"
    };

    /**
     * Role se bere ze záznamu v databázi, ne z prohlížeče. Hodnota uložená
     * v prohlížeči slouží jen k tomu, aby stránka po načtení chvíli nebliklá,
     * než dorazí data – jakmile je seznam lidí k dispozici, rozhoduje on.
     * Kdo v seznamu není (třeba starým anonymním přihlášením), je student.
     */
    UI.role = () => {
        const uid = (window.KB && window.KB.currentUid) ? window.KB.currentUid() : "";
        const users = (window.KB && window.KB.users) || [];

        if (users.length) {
            const zaznam = uid ? users.find(u => u.id === uid) : null;
            return (zaznam && zaznam.active !== false && zaznam.role) ? zaznam.role : "student";
        }
        return window.KB_ROLE || "student";
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
        document.querySelectorAll("[data-userbox]").forEach(box => {
            box.innerHTML = window.KB_USER
                ? "Přihlášen jako <b>" + esc(window.KB_USER) + "</b>" +
                  '<button type="button" class="linkbtn" data-logout>Odhlásit</button>'
                : '<button type="button" class="linkbtn" data-login>Přihlásit se</button>';
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
    };

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

    /** Seznam zakázek do roletky ÚKOLOVNÍKU – bere se živě z databáze. */
    function taskMenu() {
        const names = [];
        ((window.KB && window.KB.tasks) || []).forEach(task => {
            const name = (task.zakazka || "").trim() || "Bez zakázky";
            if (names.indexOf(name) === -1) names.push(name);
        });
        if (!names.length) return null;

        return [{ title: "VŠECHNY ZAKÁZKY", href: "ukoly.html" }].concat(
            names.map(name => ({ title: name, href: "ukoly.html?zak=" + encodeURIComponent(UI.slug(name)) })));
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
                    (group.href
                        ? '<a class="dropdown__title" href="' + group.href + '">' + group.title +
                          ((group.children || []).length ? '<span class="dropdown__more">›</span>' : "") + "</a>"
                        : '<span class="dropdown__title">' + group.title + "</span>") +
                    ((group.children || []).length
                        ? '<div class="dropdown__sub"><div class="dropdown__subin">' +
                            group.children.map(child =>
                                '<a class="dropdown__link" href="' + child.href + '">' + child.title + "</a>").join("") +
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

    function searchHtml() {
        return '<div class="searchbox">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>' +
            '<input id="kbSearch" type="search" autocomplete="off" placeholder="Hledat…" aria-label="Hledat">' +
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
                    // barvy webu jsou jen mezi ikonami nástrojů a jen pro
                    // hlavního správce – v pruhu je to zbytečně na očích
                    '<div class="appbar__userbox">' +
                        '<div class="appbar__user" data-userbox></div>' +
                        '<div class="appbar__status" data-cloud-status>Připojuji…</div>' +
                    "</div>" +
                    '<a class="appbar__logo" href="index.html" aria-label="Domů">' +
                        '<img src="Pasport_Kana_white.png" alt="Pasport Kaňa">' +
                    "</a>" +
                    toolsHtml() +
                "</div></div>" +

                '<div class="appbar__bar"><div class="appbar__barin">' +
                    navHtml(active) +
                    searchHtml() +
                "</div></div>" +

                // druhý řádek lišty – stránka si ho naplní sama (filtry kategorie)
                (options.subbar ? '<div class="appbar__sub" id="appSubbar"></div>' : "") +
            "</header>";

        bindNav();
        bindHeader();
        bindSearch();
        UI.paintUser();
        UI.bindCloudStatus("[data-cloud-status]");
        stickyOffset();
        mountToTop();

        // roletky se plní z databáze – po doručení dat se lišta překreslí
        if (window.KB) {
            window.KB.on("tasks", refreshNav);
            window.KB.on("milniky", refreshNav);
        }
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
        // ikony nástrojů s akcí (zatím jen pokyn pro AI)
        document.querySelectorAll(".toolrail [data-action='ai-prompt']").forEach(button => {
            button.addEventListener("click", () => UI.copyAiPrompt());
        });
    }

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
        });
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            const value = input.value.trim();
            // stránky bez vlastního hledání pošlou dotaz do přehledu návodů
            if (!searchHandler && value) location.href = "navody.html?q=" + encodeURIComponent(value);
        });
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

    UI.aiPrompt = (catId, subId) => {
        const category = window.KB_findCategory ? window.KB_findCategory(catId) : null;
        const hit = window.KB_findNode ? window.KB_findNode(catId, subId) : null;
        const catLine = category
            ? '"cat": "' + category.id + '"' + (hit ? ', "subcat": "' + hit.node.id + '"' : "")
            : '"cat": "" (nech prázdné, doplním ručně)';

        return [
            "Z naší konverzace vytvoř technický návod pro firemní databázi Pasport Kaňa.",
            "Výsledek vrať STRIKTNĚ jako jeden JSON objekt (žádný jiný text, žádné ```) s klíči:",
            '  "title"    – krátký výstižný název',
            '  "desc"     – jedna věta, co návod řeší',
            '  "category" – lidský popis kategorie',
            "  " + catLine,
            '  "version"  – např. "v1.0"',
            '  "steps"    – pole kroků, každý krok má:',
            '        "title"   – název kroku',
            '        "content" – popis; nové řádky jako \\n, odrážky začni "- ",',
            "                    tučně **takto**, název tlačítka nebo cesty `takto`,",
            "                    na obrázek odkazuj zápisem [obr 1], [obr 2] …",
            '        "code"    – volitelný kód, cesta nebo příkaz (jinak "")',
            "Piš česky, stručně, v rozkazovacím způsobu (Otevři…, Klikni…, Nastav…).",
            "Obrázky do JSONu nevkládej – ty doplním ve webovém editoru na místa [obr N]."
        ].join("\n");
    };

    UI.copyAiPrompt = async (catId, subId) => {
        try {
            await navigator.clipboard.writeText(UI.aiPrompt(catId, subId));
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
