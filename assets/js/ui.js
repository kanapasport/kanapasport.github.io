/* ==========================================================================
   Sdílené UI – hlavička, toasty, uživatel, vyhledávání, práce s obrázky.
   ========================================================================== */

(function () {
    "use strict";

    const USER_KEY = "company_kb_username";
    window.KB_USER = localStorage.getItem(USER_KEY) || "";

    const UI = {};
    window.KBUI = UI;

    /* ------------------------------------------------------------- toast */

    UI.toast = (message, tone) => {
        let el = document.getElementById("kbToast");
        if (!el) {
            el = document.createElement("div");
            el.id = "kbToast";
            el.className = "no-print fixed bottom-5 right-5 text-white px-5 py-3 rounded-xl shadow-2xl " +
                           "transition-all transform translate-y-24 opacity-0 z-[300] text-sm font-semibold";
            document.body.appendChild(el);
        }
        el.style.background = tone === "error" ? "#e11d48" : tone === "warn" ? "#d97706" : "#059669";
        el.textContent = message;
        requestAnimationFrame(() => {
            el.classList.replace("translate-y-24", "translate-y-0");
            el.classList.replace("opacity-0", "opacity-100");
        });
        clearTimeout(el._timer);
        el._timer = setTimeout(() => {
            el.classList.replace("translate-y-0", "translate-y-24");
            el.classList.replace("opacity-100", "opacity-0");
        }, 3200);
    };

    /* -------------------------------------------------------- uživatel */

    UI.setUser = (name) => {
        window.KB_USER = name;
        localStorage.setItem(USER_KEY, name);
        UI.paintUser();
        if (window.KB && window.KB.logLogin) window.KB.logLogin(name);
    };

    UI.clearUser = () => {
        window.KB_USER = "";
        localStorage.removeItem(USER_KEY);
        UI.paintUser();
    };

    UI.paintUser = () => {
        document.querySelectorAll("[data-user-name]").forEach(el => {
            el.textContent = window.KB_USER || "nepřihlášen";
        });
    };

    /** Vyžádá jméno, pokud ještě není známé (jednoduchá identifikace autora). */
    UI.requireUser = () => {
        if (window.KB_USER) return window.KB_USER;
        const name = (prompt("Zadejte své jméno (podepíše se pod návod):") || "").trim();
        if (name) UI.setUser(name);
        return window.KB_USER;
    };

    /* ------------------------------------------------------- stav cloudu */

    UI.bindCloudStatus = (selector) => {
        const paint = (status) => {
            document.querySelectorAll(selector).forEach(el => {
                if (status === "online") {
                    el.innerHTML = '<span class="inline-flex items-center gap-1.5 text-emerald-400">' +
                        '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Živě synchronizováno</span>';
                } else if (status === "offline") {
                    el.innerHTML = '<span class="text-amber-400">Offline režim</span>';
                } else {
                    el.innerHTML = '<span class="text-slate-400">Připojuji…</span>';
                }
            });
        };
        paint(window.KB ? window.KB.status : "connecting");
        const attach = () => window.KB.on("status", (e) => paint(e.detail));
        if (window.KB) attach(); else document.addEventListener("kb-loaded", attach, { once: true });
    };

    /* ------------------------------------------------------ vyhledávání */

    const foldText = (value) => String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");   // odstraní diakritiku, ať hledání funguje i bez háčků

    UI.fold = foldText;

    /** Prohledá název, popis, kategorii i text jednotlivých kroků. */
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
        const escaped = window.KBDoc ? window.KBDoc.esc(text) : String(text || "");
        const needle = foldText(query).trim();
        if (!needle) return escaped;
        const folded = foldText(escaped);
        const start = folded.indexOf(needle.split(/\s+/)[0]);
        if (start < 0) return escaped;
        const len = needle.split(/\s+/)[0].length;
        return escaped.slice(0, start) + "<mark>" + escaped.slice(start, start + len) + "</mark>" + escaped.slice(start + len);
    };

    /* ------------------------------------------------------- pokyn pro AI */

    UI.aiPrompt = (catId, subId) => {
        const cat = window.KB_findCategory ? window.KB_findCategory(catId) : null;
        const sub = window.KB_findSub ? window.KB_findSub(catId, subId) : null;
        const catLine = cat
            ? '"cat": "' + cat.id + '"' + (sub ? ', "subcat": "' + sub.id + '"' : "")
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

    /** Zmenší a zkomprimuje screenshot, ať databázi nezahltíme. */
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
                    w: canvas.width,
                    h: canvas.height,
                    name: file.name || "screenshot.jpg"
                });
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });

    /* ------------------------------------------------------------ hlavička */

    UI.header = (options = {}) => {
        const back = options.back
            ? '<a href="' + options.back + '" class="text-slate-400 hover:text-white text-sm flex items-center gap-1.5 shrink-0">' +
              '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>' +
              (options.backLabel || "Zpět") + "</a>"
            : "";

        return '<header class="no-print bg-slate-800 border-b border-slate-700 sticky top-0 z-50 px-5 py-3 flex items-center gap-4 shadow-md">' +
            back +
            '<a href="index.html" class="flex items-center gap-3 shrink-0">' +
                '<img src="Pasport_Kana_white.png" alt="Pasport Kaňa" class="h-8 object-contain">' +
            "</a>" +
            '<div class="min-w-0 flex-1">' +
                '<div class="text-sm font-bold text-white truncate">' + (options.title || "Firemní návody") + "</div>" +
                '<div class="text-[11px] text-slate-500 truncate" data-cloud-status></div>' +
            "</div>" +
            '<div class="flex items-center gap-2 shrink-0">' + (options.actions || "") + "</div>" +
            '<div class="hidden md:block text-[11px] text-slate-500 border-l border-slate-700 pl-4 shrink-0">' +
                'Uživatel<br><span class="text-slate-300 font-semibold" data-user-name>…</span>' +
            "</div>" +
        "</header>";
    };

    UI.mountHeader = (options) => {
        const slot = document.getElementById("appHeader");
        if (!slot) return;
        slot.outerHTML = UI.header(options);
        UI.paintUser();
        UI.bindCloudStatus("[data-cloud-status]");
    };

    document.addEventListener("DOMContentLoaded", UI.paintUser);
})();
