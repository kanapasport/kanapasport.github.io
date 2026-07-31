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

    /* ------------------------------------------------------ uživatel a role */

    UI.isAdmin = () => window.KB_ROLE === "spravce";

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
        document.querySelectorAll("[data-user-name]").forEach(el => {
            el.textContent = window.KB_USER || "nepřihlášen";
        });
        document.querySelectorAll("[data-role-pill]").forEach(el => {
            const admin = UI.isAdmin();
            el.textContent = admin ? "SPRÁVCE" : "ZAMĚSTNANEC";
            el.className = "rolepill" + (admin ? " rolepill--admin" : "");
        });
    };

    /** Vyžádá jméno, pokud ještě není známé (dočasná identifikace autora). */
    UI.requireUser = () => {
        if (window.KB_USER) return window.KB_USER;
        const name = (prompt("Zadejte své jméno – podepíše se pod vaše zápisy:") || "").trim();
        if (name) UI.setUser(name);
        return window.KB_USER;
    };

    /* ---------------------------------------------------------- horní lišta */

    const icon = (name) =>
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor">' + ((window.KB_ICONS || {})[name] || "") + "</svg>";

    const CARET = '<svg class="navbtn__caret" fill="none" viewBox="0 0 24 24" stroke="currentColor">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7"/></svg>';

    function navHtml(active) {
        const items = (window.KB_NAV || []).map((item, index) => {
            const isActive = active && item.href && item.href.split(/[?#]/)[0] === active;
            const cls = "navbtn" + (isActive ? " navbtn--active" : "");

            if (!item.menu) {
                return '<div class="navitem"><a class="' + cls + '" href="' + item.href + '">' +
                    (item.icon ? icon(item.icon) : "") + item.title + "</a></div>";
            }

            const groups = item.menu.map(group =>
                '<div class="dropdown__group">' +
                    (group.href
                        ? '<a class="dropdown__title" href="' + group.href + '">' + group.title + "</a>"
                        : '<span class="dropdown__title">' + group.title + "</span>") +
                    (group.children || []).map(child =>
                        '<a class="dropdown__link" href="' + child.href + '">' + child.title + "</a>").join("") +
                "</div>"
            ).join("");

            return '<div class="navitem" data-menu="' + index + '">' +
                '<button type="button" class="' + cls + '" data-menu-toggle="' + index + '">' +
                    item.title + CARET + "</button>" +
                '<div class="dropdown' + (item.menu.length > 1 ? " dropdown--wide" : "") + '">' + groups + "</div>" +
            "</div>";
        }).join("");

        return '<nav class="appbar__nav">' + items + "</nav>";
    }

    function mobileNavHtml() {
        return '<div class="mobilenav" id="mobileNav">' +
            (window.KB_NAV || []).map((item, index) => {
                if (!item.menu) {
                    return '<a class="mobilenav__row" href="' + item.href + '">' + item.title + "</a>";
                }
                const links = item.menu.map(group =>
                    (group.href ? '<a class="mobilenav__sublink" href="' + group.href + '"><b>' + group.title + "</b></a>" : "") +
                    (group.children || []).map(child =>
                        '<a class="mobilenav__sublink" href="' + child.href + '">' + child.title + "</a>").join("")
                ).join("");
                return '<button type="button" class="mobilenav__row" data-msub="' + index + '">' +
                        item.title + "<span>+</span></button>" +
                    '<div class="mobilenav__sub" data-msub-panel="' + index + '">' + links + "</div>";
            }).join("") +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 6px 4px">' +
                '<span style="font-size:12px;color:var(--muted)">Přihlášen jako <b data-user-name>…</b></span>' +
                '<button type="button" class="rolepill" data-role-pill></button>' +
            "</div>" +
        "</div>";
    }

    /**
     * Vykreslí horní lištu do prvku #appHeader.
     * @param {Object} options – { active: "navody.html" }
     */
    UI.mountNav = (options = {}) => {
        const slot = document.getElementById("appHeader");
        if (!slot) return;

        const active = options.active || location.pathname.split("/").pop() || "index.html";

        slot.outerHTML =
            '<header class="appbar no-print">' +
                '<div class="appbar__inner">' +
                    '<a class="appbar__logo" href="index.html" aria-label="Domů">' +
                        '<img src="Pasport_Kana_black.png" alt="Pasport Kaňa">' +
                    "</a>" +
                    navHtml(active) +
                    '<div class="appbar__right">' +
                        '<div class="appbar__user">Přihlášen jako<br><b data-user-name>…</b></div>' +
                        '<button type="button" class="rolepill" data-role-pill></button>' +
                        '<button type="button" class="appbar__burger" id="navBurger" aria-label="Menu">' +
                            '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor">' +
                            '<path stroke-linecap="round" stroke-width="2" d="M4 7h16M4 12h16M4 17h16"/></svg>' +
                        "</button>" +
                    "</div>" +
                "</div>" +
                mobileNavHtml() +
            "</header>";

        bindNav();
        UI.paintUser();
    };

    function bindNav() {
        // roletky na desktopu – klik (funguje i na dotykovém iPadu)
        document.querySelectorAll("[data-menu-toggle]").forEach(button => {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                const item = button.closest(".navitem");
                const wasOpen = item.classList.contains("is-open");
                document.querySelectorAll(".navitem.is-open").forEach(n => n.classList.remove("is-open"));
                if (!wasOpen) item.classList.add("is-open");
            });
        });
        document.addEventListener("click", () => {
            document.querySelectorAll(".navitem.is-open").forEach(n => n.classList.remove("is-open"));
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                document.querySelectorAll(".navitem.is-open").forEach(n => n.classList.remove("is-open"));
            }
        });

        // mobilní panel
        const burger = document.getElementById("navBurger");
        const panel = document.getElementById("mobileNav");
        if (burger && panel) {
            burger.addEventListener("click", (event) => {
                event.stopPropagation();
                panel.classList.toggle("is-open");
            });
        }
        document.querySelectorAll("[data-msub]").forEach(button => {
            button.addEventListener("click", () => {
                const target = document.querySelector('[data-msub-panel="' + button.dataset.msub + '"]');
                if (target) target.classList.toggle("is-open");
            });
        });

        // přepínač role (dočasné, než bude opravdové přihlašování)
        document.querySelectorAll("[data-role-pill]").forEach(pill => {
            pill.addEventListener("click", () => {
                if (!UI.isAdmin()) {
                    if (!window.KB_USER) UI.requireUser();
                    UI.setRole("spravce");
                    UI.toast("Přepnuto na správce. Po zavedení přihlašování to bude podle účtu.");
                } else {
                    UI.setRole("zamestnanec");
                    UI.toast("Přepnuto na zaměstnance.");
                }
            });
        });
    }

    /* --------------------------------------------------------- stav cloudu */

    UI.bindCloudStatus = (selector) => {
        const paint = (status) => {
            document.querySelectorAll(selector).forEach(el => {
                el.textContent = status === "online" ? "Živě synchronizováno"
                    : status === "offline" ? "Offline režim" : "Připojuji…";
                el.style.color = status === "online" ? "var(--ok)"
                    : status === "offline" ? "var(--warn)" : "var(--dim)";
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

    document.addEventListener("DOMContentLoaded", UI.paintUser);
})();
