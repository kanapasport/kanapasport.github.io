/* ==========================================================================
   TABULE NA NÁPADY – nekonečné plátno pro myšlenkové mapy a poznámky.

   Ovládání je převzaté z Mira:
     levé tlačítko  – výběr; tažením přes plochu se vybírá rámečkem,
                      tažením za prvek se prvky posouvají (i více najednou)
     prostřední     – posun plátna (stejně tak mezerník + tažení)
     kolečko        – přiblížení k místu pod kurzorem
     dva prsty      – posun a přiblížení na dotykovém displeji
     Apple Pencil   – kreslí i bez přepnutí nástroje (jako ve Freeformu)

   Souřadnice prvků jsou v „papírovém" prostoru, který je nekonečný.
   Posun a přiblížení nedělá přepočet každého prvku, ale jedna CSS
   transformace na obalu – proto je plynulé i s několika sty prvky.
   Rastr teček se posouvá a zvětšuje spolu s ním, aby bylo poznat,
   jestli se hýbe pohled, nebo jen prvek.
   ========================================================================== */

(function () {
    "use strict";

    const B = {};
    window.KBBoard = B;

    const esc = (value) => window.KBUI.esc(value);
    const ok = (v) => typeof v === "number" && isFinite(v);

    /* prvky, které se kreslí jako HTML (dá se do nich psát) */
    const BOXES = ["note", "text", "mind", "image", "table"];
    /* prvky s textem uvnitř */
    const TEXTY = ["note", "text", "mind"];

    const GRID = 24;          // rozteč rastru v papírových pixelech
    const GAP_X = 90, GAP_Y = 60;

    const S = {
        id: null, title: "", titleTouched: false,
        elements: [],
        images: {},
        view: { x: 0, y: 0, k: 1 },
        tool: "select",
        color: "#c8102e",
        paint: "stroke",
        shape: "round",
        width: 3,
        sel: [],              // id vybraných prvků
        editing: "",
        undo: [], redo: [],
        stamp: Math.random().toString(36).slice(2),
        pending: null, remote: null, unwatch: null,
        space: false
    };

    let el = {};

    /* ====================================================== souřadnice ==== */

    const toWorld = (clientX, clientY) => {
        if (!ok(S.view.x) || !ok(S.view.y) || !ok(S.view.k) || S.view.k <= 0) applyView();
        const rect = el.stage.getBoundingClientRect();
        return {
            x: (clientX - rect.left - S.view.x) / S.view.k,
            y: (clientY - rect.top - S.view.y) / S.view.k
        };
    };

    function applyView() {
        if (!ok(S.view.x) || !ok(S.view.y) || !ok(S.view.k) || S.view.k <= 0) {
            S.view = { x: el.stage.clientWidth / 2, y: el.stage.clientHeight / 2, k: 1 };
        }
        el.world.style.transform =
            "translate(" + S.view.x + "px," + S.view.y + "px) scale(" + S.view.k + ")";

        // rastr teček se veze s plátnem – jinak není poznat posun ani zoom
        const step = GRID * S.view.k;
        const dot = Math.max(1, Math.min(2.6, 1 + S.view.k * 0.6));
        el.stage.style.backgroundSize = step + "px " + step + "px";
        el.stage.style.backgroundPosition = S.view.x + "px " + S.view.y + "px";
        el.stage.style.backgroundImage =
            "radial-gradient(circle at " + dot + "px " + dot + "px, var(--line) " + dot + "px, transparent " + dot + "px)";

        if (el.zoomLabel) el.zoomLabel.textContent = Math.round(S.view.k * 100) + " %";
    }

    function zoomAt(clientX, clientY, factor) {
        const next = Math.min(4, Math.max(0.15, S.view.k * factor));
        const rect = el.stage.getBoundingClientRect();
        const sx = clientX - rect.left, sy = clientY - rect.top;
        S.view.x = sx - (sx - S.view.x) * (next / S.view.k);
        S.view.y = sy - (sy - S.view.y) * (next / S.view.k);
        S.view.k = next;
        applyView();
    }

    /* ========================================================== model ==== */

    const newId = () => "el_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const find = (id) => S.elements.find(e => e.id === id) || null;
    const isSel = (id) => S.sel.indexOf(id) !== -1;

    function pushUndo() {
        S.undo.push(JSON.stringify(S.elements));
        if (S.undo.length > 50) S.undo.shift();
        S.redo.length = 0;
    }

    function undo() {
        if (!S.undo.length) return;
        S.redo.push(JSON.stringify(S.elements));
        S.elements = JSON.parse(S.undo.pop());
        S.sel = [];
        render(); save();
    }

    function redo() {
        if (!S.redo.length) return;
        S.undo.push(JSON.stringify(S.elements));
        S.elements = JSON.parse(S.redo.pop());
        S.sel = [];
        render(); save();
    }

    function bounds(e) {
        if (!e || e.type === "link") return null;
        if (e.type === "ink") {
            const xs = [], ys = [];
            for (let i = 0; i < e.points.length; i += 2) { xs.push(e.points[i]); ys.push(e.points[i + 1]); }
            if (!xs.length) return null;
            return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        }
        if (e.type === "arrow") {
            const a = arrowEnds(e);
            return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
        }
        return { x: e.x, y: e.y, w: e.w, h: e.h };
    }

    function sanitize(list) {
        return (list || []).filter(e => {
            if (!e || !e.type) return false;
            if (e.type === "link") return !!(e.from && e.to);
            if (e.type === "ink") return Array.isArray(e.points) && e.points.length >= 4 && e.points.every(ok);
            if (e.type === "arrow") return ok(e.x) && ok(e.y) && ok(e.x2) && ok(e.y2);
            return ok(e.x) && ok(e.y) && ok(e.w) && ok(e.h);
        });
    }

    /* ==================================================== spojnice ==== */

    /** Čtyři úchyty na stranách prvku i se směrem, kterým z nich čára vychází. */
    function anchors(e) {
        const b = bounds(e);
        if (!b) return null;
        return {
            up:    { x: b.x + b.w / 2, y: b.y,        nx: 0,  ny: -1 },
            down:  { x: b.x + b.w / 2, y: b.y + b.h,  nx: 0,  ny: 1 },
            left:  { x: b.x,           y: b.y + b.h / 2, nx: -1, ny: 0 },
            right: { x: b.x + b.w,     y: b.y + b.h / 2, nx: 1,  ny: 0 }
        };
    }

    /** Vybere dvojici stran, které jsou k sobě nejblíž – čára pak nekříží prvek. */
    function pickSides(a, b) {
        const A = anchors(a), Bn = anchors(b);
        if (!A || !Bn) return null;
        let best = null;
        Object.keys(A).forEach(ka => Object.keys(Bn).forEach(kb => {
            const d = Math.hypot(A[ka].x - Bn[kb].x, A[ka].y - Bn[kb].y);
            if (!best || d < best.d) best = { d: d, p1: A[ka], p2: Bn[kb] };
        }));
        return best;
    }

    /** Čára vychází kolmo ze strany prvku a kolmo do druhého – jako v Miru. */
    function curve(p1, p2) {
        const pull = Math.max(40, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.42);
        return "M" + p1.x + "," + p1.y +
            " C" + (p1.x + p1.nx * pull) + "," + (p1.y + p1.ny * pull) +
            " " + (p2.x + p2.nx * pull) + "," + (p2.y + p2.ny * pull) +
            " " + p2.x + "," + p2.y;
    }

    /**
     * Spojnice mapy: z rodiče vychází vždy ze středu té strany, kterou
     * potomek leží – všechny větve tak vyjíždějí z jednoho místa a teprve
     * pak se rozbíhají, jako v myšlenkových mapách.
     */
    const OPPOSITE = { left: "right", right: "left", up: "down", down: "up" };

    function linkPath(link) {
        const a = find(link.from), b = find(link.to);
        if (!a || !b) return "";
        const A = anchors(a), Bn = anchors(b);
        if (!A || !Bn) return "";

        // strana je daná tím, kam se uzel přidával; bez ní se odvodí z polohy
        let dir = link.dir;
        if (!dir || !A[dir]) {
            const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
            const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
            dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "down" : "up");
        }
        return curve(A[dir], Bn[OPPOSITE[dir]]);
    }

    const linksOf = (id) => S.elements.filter(e =>
        (e.type === "link" && (e.from === id || e.to === id)) ||
        (e.type === "arrow" && (e.from === id || e.to === id)));

    /* ======================================================= šipky ==== */

    /** Konce šipky – když je přichycená k prvku, počítají se z jeho úchytů. */
    function arrowEnds(e) {
        let x1 = e.x, y1 = e.y, x2 = e.x2, y2 = e.y2;
        let n1 = null, n2 = null;

        const from = e.from ? find(e.from) : null;
        const to = e.to ? find(e.to) : null;

        if (from && to) {
            const s = pickSides(from, to);
            if (s) return { x1: s.p1.x, y1: s.p1.y, x2: s.p2.x, y2: s.p2.y, n1: s.p1, n2: s.p2 };
        }
        if (from) {
            const A = anchors(from);
            if (A) {
                let best = null;
                Object.keys(A).forEach(k => {
                    const d = Math.hypot(A[k].x - x2, A[k].y - y2);
                    if (!best || d < best.d) best = { d: d, p: A[k] };
                });
                x1 = best.p.x; y1 = best.p.y; n1 = best.p;
            }
        }
        if (to) {
            const A = anchors(to);
            if (A) {
                let best = null;
                Object.keys(A).forEach(k => {
                    const d = Math.hypot(A[k].x - x1, A[k].y - y1);
                    if (!best || d < best.d) best = { d: d, p: A[k] };
                });
                x2 = best.p.x; y2 = best.p.y; n2 = best.p;
            }
        }
        return { x1: x1, y1: y1, x2: x2, y2: y2, n1: n1, n2: n2 };
    }

    function arrowPath(e) {
        const a = arrowEnds(e);
        if (a.n1 && a.n2) return curve(a.n1, a.n2);
        if (ok(e.cx) && ok(e.cy)) return "M" + a.x1 + "," + a.y1 + " Q" + e.cx + "," + e.cy + " " + a.x2 + "," + a.y2;
        return "M" + a.x1 + "," + a.y1 + " L" + a.x2 + "," + a.y2;
    }

    function arrowMid(e) {
        const a = arrowEnds(e);
        if (ok(e.cx) && ok(e.cy) && !(a.n1 && a.n2)) {
            return { x: (a.x1 + 2 * e.cx + a.x2) / 4, y: (a.y1 + 2 * e.cy + a.y2) / 4 };
        }
        return { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 };
    }

    /** Prvek pod bodem – kvůli přichytávání šipek. */
    function elementAt(point, skipId) {
        for (let i = S.elements.length - 1; i >= 0; i--) {
            const e = S.elements[i];
            if (e.id === skipId || e.type === "link" || e.type === "arrow" || e.type === "ink") continue;
            const b = bounds(e);
            if (b && point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h) return e;
        }
        return null;
    }

    /* ====================================================== vykreslení ==== */

    function inkPath(p) {
        const n = Math.floor(p.length / 2);
        if (!n) return "";
        if (n < 3) return "M" + p[0] + "," + p[1] + " L" + p[p.length - 2] + "," + p[p.length - 1];
        let d = "M" + p[0] + "," + p[1];
        for (let i = 1; i < n - 1; i++) {
            const x = p[i * 2], y = p[i * 2 + 1];
            d += " Q" + x + "," + y + " " + ((x + p[i * 2 + 2]) / 2) + "," + ((y + p[i * 2 + 3]) / 2);
        }
        return d + " L" + p[(n - 1) * 2] + "," + p[(n - 1) * 2 + 1];
    }

    const RADIUS = { none: "0", rect: "0", round: "10", pill: "999" };

    function svgHtml(e) {
        const sel = isSel(e.id);
        const stroke = 'stroke="' + esc(e.color || "#16191d") + '" stroke-width="' + (e.width || 3) + '"';

        if (e.type === "link") {
            const path = '<path data-el="' + e.id + '" d="' + linkPath(e) + '" fill="none" stroke="' +
                esc(sel ? "#c8102e" : (e.color || "#8a95a3")) + '" stroke-width="' + (sel ? 3.5 : 2.5) +
                '" stroke-linecap="round" class="blink"/>';
            if (!sel) return path;

            // vybraná čára: tečky na stranách rodiče přehodí, odkud vychází
            const parent = find(e.from);
            const A = parent ? anchors(parent) : null;
            if (!A) return path;
            return path + Object.keys(A).map(dir =>
                '<circle class="bside' + ((e.dir || "right") === dir ? " is-on" : "") + '" data-side="' + e.id + "|" + dir +
                '" cx="' + A[dir].x + '" cy="' + A[dir].y + '" r="7"/>').join("");
        }
        if (e.type === "ink") {
            return '<path data-el="' + e.id + '" d="' + inkPath(e.points) + '" fill="none" ' + stroke +
                ' stroke-linecap="round" stroke-linejoin="round" class="bsvg' + (sel ? " is-sel" : "") + '"/>';
        }
        if (e.type === "arrow") {
            const a = arrowEnds(e);
            const mid = arrowMid(e);
            const grips = sel
                ? '<circle class="bgrip" data-h="' + e.id + '|a" cx="' + a.x1 + '" cy="' + a.y1 + '" r="6"/>' +
                  '<circle class="bgrip bgrip--mid" data-h="' + e.id + '|m" cx="' + mid.x + '" cy="' + mid.y + '" r="6"/>' +
                  '<circle class="bgrip" data-h="' + e.id + '|b" cx="' + a.x2 + '" cy="' + a.y2 + '" r="6"/>'
                : "";
            return '<path data-el="' + e.id + '" d="' + arrowPath(e) + '" fill="none" ' + stroke +
                ' stroke-linecap="round" marker-end="url(#kbArrow)" class="bsvg' + (sel ? " is-sel" : "") + '"/>' + grips;
        }
        if (e.type === "rect") {
            return '<rect data-el="' + e.id + '" x="' + e.x + '" y="' + e.y + '" width="' + Math.max(1, e.w) +
                '" height="' + Math.max(1, e.h) + '" rx="' + (e.shape === "pill" ? 999 : e.shape === "rect" ? 0 : 8) +
                '" fill="' + (e.fill || "none") + '" ' + stroke + ' class="bsvg' + (sel ? " is-sel" : "") + '"/>';
        }
        if (e.type === "ellipse") {
            return '<ellipse data-el="' + e.id + '" cx="' + (e.x + e.w / 2) + '" cy="' + (e.y + e.h / 2) +
                '" rx="' + Math.abs(e.w / 2) + '" ry="' + Math.abs(e.h / 2) + '" fill="' + (e.fill || "none") + '" ' +
                stroke + ' class="bsvg' + (sel ? " is-sel" : "") + '"/>';
        }
        return "";
    }

    function tableHtml(e) {
        const rows = Math.max(1, e.rows || 2), cols = Math.max(1, e.cols || 2);
        const cells = e.cells || {};
        const style = "font-size:" + (e.size || 13) + "px;text-align:" + (e.align || "left") +
            ";color:" + esc(e.tcolor || "#16191d") + ";";

        let out = "";
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const key = r + "_" + c;
                // první řádek bereme jako hlavičku
                const head = r === 0 ? "font-weight:900;background:rgba(0,0,0,.035);" : "font-weight:" + (e.bold === false ? 400 : 400) + ";";
                out += '<div class="btcell" data-cell="' + e.id + "|" + key + '" style="' + style + head + '">' +
                    esc(cells[key] || "") + "</div>";
            }
        }
        return '<div class="btgrid" style="grid-template-columns:repeat(' + cols + ',1fr);' +
            "grid-template-rows:repeat(" + rows + ',1fr)">' + out + "</div>";
    }

    function boxHtml(e) {
        const sel = isSel(e.id);
        const style = "left:" + e.x + "px;top:" + e.y + "px;width:" + e.w + "px;height:" + e.h + "px;";

        if (e.type === "image") {
            return '<div class="bel bel--image' + (sel ? " is-sel" : "") + '" data-el="' + e.id + '" style="' + style + '">' +
                '<img src="' + (S.images[e.imageId] || "") + '" alt="" draggable="false">' +
                (sel ? '<span class="bel__grip"></span>' : "") + "</div>";
        }

        const shape = e.shape || "round";
        const radius = "border-radius:" + RADIUS[shape] + "px;";
        const back = "background:" + esc(e.fill || "#ffffff") + ";";
        const line = (e.stroke && shape !== "none") ? "border:2px solid " + esc(e.stroke) + ";" : "border:2px solid transparent;";

        if (e.type === "table") {
            return '<div class="bel bel--table' + (sel ? " is-sel" : "") + '" data-el="' + e.id + '" ' +
                'style="' + style + back + line + radius + '">' + tableHtml(e) +
                (sel ? '<span class="bel__grip"></span>' +
                       // + na všech čtyřech stranách: přidá řádek/sloupec právě tam
                       ["up", "right", "down", "left"].map(side =>
                           '<button type="button" class="bel__plus bel__plus--' + side + '" data-tadd="' + e.id + "|" + side +
                           '" title="Přidat ' + (side === "up" || side === "down" ? "řádek" : "sloupec") + '">+</button>').join("") +
                       '<button type="button" class="bel__minus bel__minus--right" data-tdel="' + e.id + '|col" title="Ubrat sloupec">−</button>' +
                       '<button type="button" class="bel__minus bel__minus--down" data-tdel="' + e.id + '|row" title="Ubrat řádek">−</button>' : "") +
            "</div>";
        }

        const size = "font-size:" + (e.size || (e.type === "text" ? 18 : 15)) + "px;" +
            "font-weight:" + (e.bold === false ? 400 : 700) + ";" +
            "text-align:" + (e.align || "center") + ";" +
            "color:" + esc(e.tcolor || "#16191d") + ";";

        // uzel mapy: tečky na stranách – kliknutím vznikne navázané pole,
        // tažením se dá umístit kam chceš (jako v Miru)
        const dots = (e.type === "mind" && sel)
            ? ["up", "right", "down", "left"].map(dir =>
                '<button type="button" class="bel__plus bel__plus--' + dir + '" data-add="' + e.id + "|" + dir +
                '" title="Klikni = přidat, táhni = umístit">+</button>').join("")
            : "";

        return '<div class="bel bel--' + e.type + (sel ? " is-sel" : "") + '" data-el="' + e.id + '" ' +
            'style="' + style + back + line + radius + '">' +
            '<div class="bel__text" data-text="' + e.id + '" style="' + size + '"' +
                (S.editing === e.id ? ' contenteditable="true"' : "") + ">" + esc(e.text || "") + "</div>" +
            (sel ? '<span class="bel__grip"></span>' : "") + dots +
        "</div>";
    }

    function render() {
        if (S.editing) return;

        const boxes = S.elements.filter(e => BOXES.indexOf(e.type) !== -1);
        const shapes = S.elements.filter(e => boxes.indexOf(e) === -1);

        el.svg.innerHTML =
            '<defs><marker id="kbArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
            '<path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>' +
            shapes.map(svgHtml).join("");

        el.html.innerHTML = boxes.map(boxHtml).join("") +
            // rámeček u vybraných kreseb a tvarů
            S.sel.map(id => {
                const e = find(id);
                if (!e || BOXES.indexOf(e.type) !== -1 || e.type === "arrow") return "";
                const b = bounds(e);
                if (!b) return "";
                return '<div class="bel__ghost" style="left:' + (b.x - 6) + "px;top:" + (b.y - 6) +
                    "px;width:" + (b.w + 12) + "px;height:" + (b.h + 12) + 'px"></div>';
            }).join("");

        applyView();
        paintButtons();
    }

    function paintButtons() {
        if (el.undo) el.undo.disabled = !S.undo.length;
        if (el.redo) el.redo.disabled = !S.redo.length;
        document.querySelectorAll(".board__bar [data-tool]").forEach(b =>
            b.classList.toggle("is-active", b.dataset.tool === S.tool));
        document.querySelectorAll("[data-color]").forEach(b =>
            b.classList.toggle("is-active", b.dataset.color === S.color));
        document.querySelectorAll("[data-width]").forEach(b =>
            b.classList.toggle("is-active", +b.dataset.width === S.width));
        document.querySelectorAll("[data-paint]").forEach(b =>
            b.classList.toggle("is-active", b.dataset.paint === S.paint));
        document.querySelectorAll("[data-shape]").forEach(b =>
            b.classList.toggle("is-active", b.dataset.shape === S.shape));
        document.querySelectorAll("[data-align]").forEach(b =>
            b.classList.toggle("is-active", b.dataset.align === (S.align || "center")));
        document.querySelectorAll("[data-size]").forEach(b =>
            b.classList.toggle("is-active", +b.dataset.size === (S.size || 15)));
        document.querySelectorAll("[data-tcolor]").forEach(b =>
            b.classList.toggle("is-active", b.dataset.tcolor === (S.tcolor || "#16191d")));

        // kontextová lišta říká, čeho se nastavení týká
        if (el.selinfo) {
            const n = S.sel.length;
            el.selinfo.textContent = n === 0 ? "Nastavení pro nové prvky"
                : n === 1 ? "Vybraný prvek" : "Vybráno " + n + " prvků";
        }
        document.querySelectorAll("[data-needsel]").forEach(b => { b.disabled = !S.sel.length; });
    }

    /* ======================================================== ukládání ==== */

    function save() {
        clearTimeout(S.pending);
        setStatus("Ukládám…");
        S.pending = setTimeout(async () => {
            try {
                S.elements = sanitize(S.elements);
                await window.KB.saveBoard(S.id, S.elements, S.stamp);
                await window.KB.saveBoardMeta(S.id, { title: S.title });
                setStatus("Uloženo");
            } catch (err) {
                console.error(err);
                setStatus("Uložení selhalo", true);
            }
        }, 700);
    }

    function setStatus(text, bad) {
        if (!el.status) return;
        el.status.textContent = text;
        el.status.style.color = bad ? "var(--danger)" : "var(--dim)";
    }

    function applyRemote(data) {
        if (!data || data.stamp === S.stamp) return;
        if (S.editing || drag.mode) { S.remote = data; return; }
        const same = JSON.stringify(data.elements || []) === JSON.stringify(S.elements);
        S.elements = sanitize(data.elements);
        S.sel = S.sel.filter(id => find(id));
        render();
        if (!same) setStatus("Aktualizováno od: " + (data.updatedBy || "kolega"));
    }

    /* ====================================================== interakce ==== */

    const drag = {};
    const pointers = new Map();
    let pinch = null;

    function select(ids, add) {
        S.sel = add ? S.sel.concat(ids.filter(id => !isSel(id))) : ids.slice();
        render();
    }

    /** Nový uzel mapy – jednořádkový, hned se do něj píše. */
    function makeMind(x, y, parent) {
        const node = {
            id: newId(), type: "mind", x: x, y: y, w: 180, h: 46, text: "",
            shape: parent ? (parent.shape || S.shape) : S.shape,
            fill: parent ? parent.fill : "#ffffff",
            stroke: parent ? parent.stroke : S.color
        };
        S.elements.push(node);
        return node;
    }

    /**
     * Rozprostře potomky rovnoměrně na tu stranu, na které vznikli –
     * jako v Miru. Střed skupiny sedí na středu rodiče, takže s přibývajícími
     * uzly se větev roztahuje na obě strany, ne jen dolů.
     */
    function arrangeChildren(parentId) {
        const parent = find(parentId);
        if (!parent) return;

        const groups = {};
        S.elements.filter(e => e.type === "link" && e.from === parentId).forEach(link => {
            const dir = link.dir || "right";
            (groups[dir] = groups[dir] || []).push(link.to);
        });

        const GAP = 18;
        Object.keys(groups).forEach(dir => {
            const kids = groups[dir].map(find).filter(Boolean);
            if (!kids.length) return;

            if (dir === "left" || dir === "right") {
                const total = kids.reduce((sum, k) => sum + k.h, 0) + GAP * (kids.length - 1);
                let y = parent.y + parent.h / 2 - total / 2;
                kids.forEach(k => {
                    k.x = dir === "right" ? parent.x + parent.w + GAP_X : parent.x - k.w - GAP_X;
                    k.y = y;
                    y += k.h + GAP;
                });
            } else {
                const total = kids.reduce((sum, k) => sum + k.w, 0) + GAP * (kids.length - 1);
                let x = parent.x + parent.w / 2 - total / 2;
                kids.forEach(k => {
                    k.y = dir === "down" ? parent.y + parent.h + GAP_Y : parent.y - k.h - GAP_Y;
                    k.x = x;
                    x += k.w + GAP;
                });
            }
        });
    }

    function addChild(parentId, dir, at) {
        const parent = find(parentId);
        if (!parent) return;

        pushUndo();
        const node = makeMind(parent.x, parent.y, parent);
        S.elements.push({ id: newId(), type: "link", from: parentId, to: node.id, dir: dir, color: "#8a95a3" });

        if (at) { node.x = at.x - node.w / 2; node.y = at.y - node.h / 2; }
        else arrangeChildren(parentId);      // nový uzel se vejde mezi ostatní

        S.sel = [node.id];
        render(); save();
        startEditing(node.id);
    }

    /** Enter při psaní = další uzel na stejné úrovni (stejný rodič i strana). */
    function addSibling(id) {
        const link = S.elements.find(e => e.type === "link" && e.to === id);
        if (!link) {
            const me = find(id);
            return me ? addChild(id, "right") : null;
        }
        addChild(link.from, link.dir || "right");
    }

    function startElement(point) {
        const id = newId();
        const base = { id: id, color: S.color, shape: S.shape };

        if (S.tool === "note")  Object.assign(base, { type: "note", x: point.x - 90, y: point.y - 60, w: 180, h: 120, text: "", fill: "#ffffff", stroke: S.color });
        if (S.tool === "text")  Object.assign(base, { type: "text", x: point.x, y: point.y - 28, w: 260, h: 56, text: "", fill: "#ffffff", stroke: "", shape: "none" });
        if (S.tool === "rect")  Object.assign(base, { type: "rect", x: point.x, y: point.y, w: 1, h: 1 });
        if (S.tool === "ellipse") Object.assign(base, { type: "ellipse", x: point.x, y: point.y, w: 1, h: 1 });
        if (S.tool === "arrow") Object.assign(base, { type: "arrow", x: point.x, y: point.y, x2: point.x, y2: point.y });
        if (S.tool === "table") Object.assign(base, { type: "table", x: point.x, y: point.y, w: 1, h: 1, rows: 2, cols: 2, cells: {}, fill: "#ffffff", stroke: S.color });
        if (S.tool === "pen")   Object.assign(base, { type: "ink", points: [point.x, point.y], width: S.width });

        pushUndo();
        S.elements.push(base);
        return base;
    }

    function onDown(event) {
        if (event.target.closest("[data-add],[data-tadd],[data-tdel],[data-side]")) return;   // tlačítka řeší klik

        // v rozepsaném textu má myš vybírat písmena, ne tahat s polem
        if (event.target.closest('[contenteditable="true"]')) return;

        pointers.set(event.pointerId, event);

        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                      cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
            drag.mode = "";
            return;
        }
        if (pointers.size > 2) return;

        const point = toWorld(event.clientX, event.clientY);

        // prostřední tlačítko nebo mezerník = posun plátna (jako v Miru)
        if (event.button === 1 || S.space || S.tool === "hand") {
            event.preventDefault();
            Object.assign(drag, { mode: "pan", x0: event.clientX, y0: event.clientY, ox: S.view.x, oy: S.view.y });
            return;
        }
        if (event.button === 2) return;

        const hit = event.target.closest("[data-el]");
        const grip = event.target.classList && event.target.classList.contains("bel__grip");
        const handle = event.target.closest ? event.target.closest("[data-h]") : null;

        if (S.tool === "erase" || (event.pointerType === "pen" && event.buttons === 32)) {
            drag.mode = "erase"; drag.erased = false;
            eraseAt(event);
            return;
        }

        // Apple Pencil kreslí i v režimu výběru
        if (event.pointerType === "pen" && (S.tool === "select")) {
            pushUndo();
            const ink = { id: newId(), type: "ink", color: S.color, width: S.width, points: [point.x, point.y] };
            S.elements.push(ink);
            S.sel = [];
            Object.assign(drag, { mode: "ink", id: ink.id });
            render();
            return;
        }

        if (S.tool === "select") {
            if (handle) {
                const [id, which] = handle.dataset.h.split("|");
                pushUndo();
                Object.assign(drag, { mode: "arrowpt", id: id, which: which });
                return;
            }
            if (grip && S.sel.length === 1) {
                const e = find(S.sel[0]);
                pushUndo();
                Object.assign(drag, { mode: "resize", id: e.id, x0: point.x, y0: point.y, ox: e.w, oy: e.h });
                return;
            }
            if (hit) {
                const e = find(hit.dataset.el);
                if (!e) return;
                const cell = event.target.closest("[data-cell]");
                if (!isSel(e.id)) select([e.id], event.shiftKey);
                pushUndo();
                Object.assign(drag, {
                    mode: "move", x0: point.x, y0: point.y, moved: false,
                    cell: cell ? cell.dataset.cell : "",
                    start: S.sel.map(id => ({ id: id, snap: JSON.stringify(find(id)) }))
                });
                return;
            }
            // tažení přes prázdnou plochu = výběr rámečkem
            Object.assign(drag, { mode: "marquee", x0: point.x, y0: point.y, add: event.shiftKey, moved: false });
            if (!event.shiftKey && S.sel.length) { S.sel = []; render(); }
            return;
        }

        // uzel mapy se nekreslí tažením – rovnou stojí a píše se do něj
        if (S.tool === "mind") {
            pushUndo();
            const node = makeMind(point.x - 90, point.y - 23, null);
            S.tool = "select";
            S.sel = [node.id];
            render(); save();
            return startEditing(node.id);
        }

        const created = startElement(point);

        Object.assign(drag, {
            mode: created.type === "ink" ? "ink" : "create",
            id: created.id, x0: point.x, y0: point.y, moved: false
        });
        render();
    }

    function onMove(event) {
        if (pointers.has(event.pointerId)) pointers.set(event.pointerId, event);

        if (pinch && pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
            S.view.x += cx - pinch.cx;
            S.view.y += cy - pinch.cy;
            zoomAt(cx, cy, dist / pinch.dist);
            pinch = { dist: dist, cx: cx, cy: cy };
            return;
        }
        if (!drag.mode) return;
        drag.moved = true;

        if (drag.mode === "erase") return eraseAt(event);

        if (drag.mode === "pan") {
            S.view.x = drag.ox + (event.clientX - drag.x0);
            S.view.y = drag.oy + (event.clientY - drag.y0);
            return applyView();
        }

        const point = toWorld(event.clientX, event.clientY);

        if (drag.mode === "marquee") {
            const x = Math.min(drag.x0, point.x), y = Math.min(drag.y0, point.y);
            const w = Math.abs(point.x - drag.x0), h = Math.abs(point.y - drag.y0);
            el.band.hidden = false;
            el.band.style.cssText = "left:" + (x * S.view.k + S.view.x) + "px;top:" + (y * S.view.k + S.view.y) +
                "px;width:" + (w * S.view.k) + "px;height:" + (h * S.view.k) + "px";
            drag.box = { x: x, y: y, w: w, h: h };
            return;
        }

        if (drag.mode === "pull") {
            el.band.hidden = true;
            const from = find(drag.id);
            const a = anchors(from);
            const p1 = a ? a[drag.which] : { x: drag.x0, y: drag.y0, nx: 0, ny: 0 };
            el.svg.querySelector("#kbPull").setAttribute("d",
                "M" + p1.x + "," + p1.y + " L" + point.x + "," + point.y);
            drag.at = point;
            return;
        }

        if (drag.mode === "move") {
            const dx = point.x - drag.x0, dy = point.y - drag.y0;
            drag.start.forEach(item => {
                const e = find(item.id);
                const was = JSON.parse(item.snap);
                if (!e) return;
                if (e.type === "ink") e.points = was.points.map((v, i) => i % 2 === 0 ? v + dx : v + dy);
                else if (e.type === "arrow") { e.x = was.x + dx; e.y = was.y + dy; e.x2 = was.x2 + dx; e.y2 = was.y2 + dy;
                    if (ok(was.cx)) { e.cx = was.cx + dx; e.cy = was.cy + dy; } }
                else { e.x = was.x + dx; e.y = was.y + dy; }
                renderLive(e);
            });
            return;
        }

        const e = find(drag.id);
        if (!e) return;

        if (drag.mode === "arrowpt") {
            if (drag.which === "a") { e.x = point.x; e.y = point.y; e.from = ""; }
            else if (drag.which === "b") { e.x2 = point.x; e.y2 = point.y; e.to = ""; }
            else { e.cx = (4 * point.x - e.x - e.x2) / 2; e.cy = (4 * point.y - e.y - e.y2) / 2; }
            return renderLive(e);
        }
        if (drag.mode === "resize") {
            e.w = Math.max(40, drag.ox + (point.x - drag.x0));
            e.h = Math.max(28, drag.oy + (point.y - drag.y0));
            if (e.type === "table") {
                e.cols = Math.max(1, Math.round(e.w / 120));
                e.rows = Math.max(1, Math.round(e.h / 44));
                return render();
            }
            return renderLive(e);
        }
        if (drag.mode === "create") {
            if (e.type === "arrow") { e.x2 = point.x; e.y2 = point.y; }
            else {
                e.x = Math.min(drag.x0, point.x); e.y = Math.min(drag.y0, point.y);
                e.w = Math.abs(point.x - drag.x0); e.h = Math.abs(point.y - drag.y0);
                if (e.type === "table") {
                    e.cols = Math.max(1, Math.round(e.w / 120));
                    e.rows = Math.max(1, Math.round(e.h / 44));
                    return render();
                }
            }
            return renderLive(e);
        }
        if (drag.mode === "ink") {
            const lx = e.points[e.points.length - 2], ly = e.points[e.points.length - 1];
            if (Math.hypot(point.x - lx, point.y - ly) > 1.5) {
                e.points.push(point.x, point.y);
                renderLive(e);
            }
        }
    }

    function renderLive(e) {
        const node = el.stage.querySelector('[data-el="' + e.id + '"]');
        if (!node) return render();

        if (BOXES.indexOf(e.type) !== -1) {
            node.style.left = e.x + "px"; node.style.top = e.y + "px";
            node.style.width = e.w + "px"; node.style.height = e.h + "px";
        } else if (e.type === "ink") {
            node.setAttribute("d", inkPath(e.points));
        } else if (e.type === "arrow") {
            node.setAttribute("d", arrowPath(e));
            const a = arrowEnds(e), mid = arrowMid(e);
            const place = (k, x, y) => { const g = el.svg.querySelector('[data-h="' + e.id + "|" + k + '"]'); if (g) { g.setAttribute("cx", x); g.setAttribute("cy", y); } };
            place("a", a.x1, a.y1); place("m", mid.x, mid.y); place("b", a.x2, a.y2);
        } else if (e.type === "rect") {
            node.setAttribute("x", e.x); node.setAttribute("y", e.y);
            node.setAttribute("width", Math.max(1, e.w)); node.setAttribute("height", Math.max(1, e.h));
        } else if (e.type === "ellipse") {
            node.setAttribute("cx", e.x + e.w / 2); node.setAttribute("cy", e.y + e.h / 2);
            node.setAttribute("rx", Math.max(1, Math.abs(e.w / 2))); node.setAttribute("ry", Math.max(1, Math.abs(e.h / 2)));
        }

        // spojnice a přichycené šipky se vezou s prvkem
        linksOf(e.id).forEach(link => {
            const path = el.svg.querySelector('[data-el="' + link.id + '"]');
            if (path) path.setAttribute("d", link.type === "link" ? linkPath(link) : arrowPath(link));
        });
    }

    /**
     * Guma jako na papíře: v kresbě ubírá jen to, přes co přejede, a tah
     * se v tom místě rozdělí. Ostatní prvky (lepítka, tvary) maže celé.
     */
    function eraseAt(event) {
        const point = toWorld(event.clientX, event.clientY);
        const radius = 11 / S.view.k;
        let changed = false;
        const out = [];

        S.elements.forEach(e => {
            if (e.type !== "ink") { out.push(e); return; }

            const runs = [];
            let run = [];
            for (let i = 0; i < e.points.length; i += 2) {
                const hit = Math.hypot(e.points[i] - point.x, e.points[i + 1] - point.y) <= radius;
                if (hit) {
                    changed = true;
                    if (run.length >= 4) runs.push(run);
                    run = [];
                } else {
                    run.push(e.points[i], e.points[i + 1]);
                }
            }
            if (run.length >= 4) runs.push(run);

            runs.forEach((points, index) => {
                out.push(index === 0
                    ? Object.assign({}, e, { points: points })
                    : Object.assign({}, e, { id: newId(), points: points }));
            });
        });

        // co není kresba, se maže celé
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const hit = target && target.closest ? target.closest("[data-el]") : null;
        const id = hit && hit.dataset.el;
        const box = id ? find(id) : null;

        if (box && box.type !== "ink") {
            changed = true;
            const keep = out.filter(e => e.id !== id &&
                !((e.type === "link" || e.type === "arrow") && (e.from === id || e.to === id)));
            out.length = 0;
            keep.forEach(e => out.push(e));
        }

        if (!changed) return;
        if (!drag.erased) { pushUndo(); drag.erased = true; }
        S.elements = out;
        render();
    }

    function onUp(event) {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!drag.mode) return;

        const mode = drag.mode, id = drag.id, moved = drag.moved;
        drag.mode = "";

        if (mode === "erase") { if (drag.erased) save(); return; }
        if (mode === "pan") return;

        if (mode === "marquee") {
            el.band.hidden = true;
            const box = drag.box;
            if (box && (box.w > 3 || box.h > 3)) {
                const inside = S.elements.filter(e => {
                    const b = bounds(e);
                    return b && b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
                }).map(e => e.id);
                select(inside, drag.add);
            }
            return;
        }

        if (mode === "pull") {
            const path = el.svg.querySelector("#kbPull");
            if (path) path.setAttribute("d", "");

            // pustím-li čáru nad jiným polem, jen se k němu připojí
            const over = (moved && drag.at) ? elementAt(drag.at, drag.id) : null;
            if (over && TEXTY.indexOf(over.type) !== -1) {
                const exists = S.elements.some(e => e.type === "link" &&
                    ((e.from === drag.id && e.to === over.id) || (e.from === over.id && e.to === drag.id)));
                if (!exists) {
                    pushUndo();
                    S.elements.push({ id: newId(), type: "link", from: drag.id, to: over.id, color: "#8a95a3" });
                    S.sel = [over.id];
                    render(); save();
                }
                return;
            }
            if (moved && drag.at) addChild(drag.id, drag.which, drag.at);
            else addChild(drag.id, drag.which);
            return;
        }

        if (mode === "move") {
            // ťuknutí bez tažení = rovnou psát (i do prázdné buňky tabulky)
            if (!moved && S.sel.length === 1) {
                const one = find(S.sel[0]);
                if (drag.cell) { render(); return editCell(drag.cell); }
                if (one && TEXTY.indexOf(one.type) !== -1) { render(); return startEditing(one.id); }
            }
            render();     // ručně posunutý uzel zůstane, kde ho člověk nechal
            return save();
        }
        if (mode === "arrowpt") {
            const e = find(id);
            if (e && drag.which !== "m") {
                // konec šipky se přichytí k prvku, nad kterým skončil
                const p = { x: drag.which === "a" ? e.x : e.x2, y: drag.which === "a" ? e.y : e.y2 };
                const over = elementAt(p, e.id);
                if (over) { if (drag.which === "a") e.from = over.id; else e.to = over.id; }
            }
            render(); return save();
        }

        const e = find(id);
        if (!e) return;

        if (mode === "create" && !moved) {
            if (e.type === "arrow") { e.x2 = e.x + 170; e.y2 = e.y; }
            else if (e.type === "table") { e.w = 360; e.h = 132; e.cols = 3; e.rows = 3; }
            else if (e.type !== "note" && e.type !== "text") { e.w = 170; e.h = 110; }
        }
        if (mode === "ink" && e.points.length < 4) {
            S.elements = S.elements.filter(x => x.id !== e.id);
        }
        if (mode === "create" && e.type === "arrow") {
            const a = elementAt({ x: e.x, y: e.y }, e.id);
            const b = elementAt({ x: e.x2, y: e.y2 }, e.id);
            if (a) e.from = a.id;
            if (b) e.to = b.id;
        }

        if (mode !== "ink") { S.tool = "select"; S.sel = [e.id]; }
        render();
        save();
        if (mode === "create" && TEXTY.indexOf(e.type) !== -1) startEditing(e.id);
    }

    /* ========================================================== psaní ==== */

    function startEditing(id) {
        if (S.editing && S.editing !== id) stopEditing();
        const e = find(id);
        if (!e) return;

        S.editing = id;
        const node = el.html.querySelector('[data-text="' + id + '"]');
        if (!node) { S.editing = ""; return render(); }

        node.setAttribute("contenteditable", "true");
        node.focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function stopEditing() {
        if (!S.editing) return;
        const node = el.html.querySelector('[data-text="' + S.editing + '"]');
        const e = find(S.editing);
        if (node && e) {
            const text = node.innerText.replace(/ /g, ' ').trim();
            if (text !== (e.text || '')) { pushUndo(); e.text = text; save(); }
            autoSize(e);       // pole se přizpůsobí množství textu
        }
        S.editing = '';
        if (S.remote) { const r = S.remote; S.remote = null; return applyRemote(r); }
        render();
    }

    /**
     * Přizpůsobí velikost pole textu. Uzel mapy roste do šířky, dokud se
     * text vejde na řádek; delší text se zalomí a pole povyroste do výšky.
     * Prázdný uzel zůstane – jde do něj kdykoliv kliknout a dopsat.
     */
    function autoSize(e) {
        if (!e || (e.type !== 'mind' && e.type !== 'text')) return;

        const size = e.size || (e.type === 'text' ? 18 : 15);
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;visibility:hidden;' +
            'font-family:var(--font);font-size:' + size + 'px;font-weight:' + (e.bold === false ? 400 : 700) + ';';
        probe.textContent = e.text || ' ';
        document.body.appendChild(probe);
        const textWidth = probe.getBoundingClientRect().width;

        const pad = 34;
        const maxW = e.type === 'mind' ? 420 : 520;
        const minW = e.type === 'mind' ? 120 : 180;
        const wanted = Math.min(maxW, Math.max(minW, Math.ceil(textWidth) + pad));

        probe.style.whiteSpace = 'normal';
        probe.style.width = (wanted - pad) + 'px';
        const lines = Math.max(1, Math.round(probe.getBoundingClientRect().height / (size * 1.35)));
        document.body.removeChild(probe);

        const oldW = e.w, oldH = e.h;
        e.w = wanted;
        e.h = Math.max(e.type === 'mind' ? 46 : 56, Math.ceil(lines * size * 1.35) + 22);

        // uzel vlevo od rodiče musí růst doleva, uzel nad ním nahoru –
        // jinak by se odsazení postupně sjedlo
        const parent = parentOf(e.id);
        if (parent) {
            if (e.x + oldW < parent.x) e.x -= (e.w - oldW);
            if (e.y + oldH < parent.y) e.y -= (e.h - oldH);
            arrangeChildren(parent.id);     // sourozenci se přerovnají kolem něj
        }
    }

    /** Uzel, ze kterého tenhle vzešel (první spojnice, která do něj vede). */
    function parentOf(id) {
        const link = S.elements.find(e => e.type === "link" && e.to === id);
        return link ? find(link.from) : null;
    }

    function editCell(key) {
        const [id, cell] = key.split("|");
        const e = find(id);
        const node = el.html.querySelector('[data-cell="' + key + '"]');
        if (!e || !node) return;
        S.editing = id;
        node.setAttribute("contenteditable", "true");
        node.focus();
        node.oninput = () => { e.cells = e.cells || {}; e.cells[cell] = node.innerText.trim(); };
        node.onblur = () => { S.editing = ""; node.removeAttribute("contenteditable"); render(); save(); };
    }

    /* ======================================================== nástroje ==== */

    function setTool(tool) {
        stopEditing();
        S.tool = tool;
        el.stage.dataset.tool = tool;
        paintButtons();
    }

    function eachSelected(fn) {
        if (!S.sel.length) return;
        pushUndo();
        S.sel.forEach(id => { const e = find(id); if (e) fn(e); });
        render(); save();
    }

    function setColor(color) {
        S.color = color;
        eachSelected(e => {
            if (BOXES.indexOf(e.type) !== -1 || e.type === "rect" || e.type === "ellipse") {
                if (S.paint === "fill") e.fill = color; else { e.stroke = color; e.color = color; }
            } else e.color = color;
        });
        paintButtons();
    }

    function setShape(shape) {
        S.shape = shape;
        eachSelected(e => { e.shape = shape; });
        paintButtons();
    }

    /** Vzhled textu ve vybraných polích (i v buňkách tabulky). */
    function setText(prop, value) {
        S[prop] = value;
        eachSelected(e => {
            e[prop] = value;
            if (prop === "size" || prop === "bold") autoSize(e);
        });
        paintButtons();
    }

    function removeSelected() {
        if (!S.sel.length) return;
        pushUndo();
        const gone = S.sel.slice();
        S.elements = S.elements.filter(e => gone.indexOf(e.id) === -1 &&
            !((e.type === "link" || e.type === "arrow") && (gone.indexOf(e.from) !== -1 || gone.indexOf(e.to) !== -1)));
        S.sel = [];
        render(); save();
    }

    function toFront() {
        if (!S.sel.length) return;
        pushUndo();
        const picked = S.elements.filter(e => isSel(e.id));
        S.elements = S.elements.filter(e => !isSel(e.id)).concat(picked);
        render(); save();
    }

    function duplicate() {
        if (!S.sel.length) return;
        pushUndo();
        const copies = [];
        S.sel.forEach(id => {
            const e = find(id);
            if (!e) return;
            const copy = JSON.parse(JSON.stringify(e));
            copy.id = newId();
            if (copy.points) copy.points = copy.points.map(v => v + 26);
            else { copy.x += 26; copy.y += 26; if (ok(copy.x2)) { copy.x2 += 26; copy.y2 += 26; } }
            copy.from = ""; copy.to = "";
            copies.push(copy);
        });
        S.elements = S.elements.concat(copies);
        S.sel = copies.map(c => c.id);
        render(); save();
    }

    /** Přerovná mapu pod vybraným uzlem – dolů, nebo doprava. */
    function layout(dir) {
        const rootId = S.sel[0];
        const root = find(rootId);
        if (!root || root.type !== "mind") return window.KBUI.toast("Nejdřív vyber kořenový uzel mapy.", "warn");

        pushUndo();
        const seen = {};
        const children = (id) => S.elements
            .filter(e => e.type === "link" && (e.from === id || e.to === id))
            .map(e => e.from === id ? e.to : e.from)
            .filter(cid => !seen[cid] && find(cid));

        let cursor = 0;
        const walk = (id, depth) => {
            seen[id] = true;
            const kids = children(id);
            kids.forEach(kid => { seen[kid] = true; });
            kids.forEach(kid => {
                const node = find(kid);
                if (dir === "down") { node.x = cursor * 210; node.y = depth * 120; }
                else { node.x = depth * 270; node.y = cursor * 70; }
                if (!children(kid).length) cursor++;
                walk(kid, depth + 1);
            });
        };
        root.x = 0; root.y = 0;
        walk(rootId, 1);
        render(); save(); fitAll();
    }

    function fitAll() {
        const bs = S.elements.map(bounds).filter(b => b && ok(b.x) && ok(b.y));
        if (!bs.length) {
            S.view = { x: el.stage.clientWidth / 2, y: el.stage.clientHeight / 2, k: 1 };
            return applyView();
        }
        const minX = Math.min(...bs.map(b => b.x)), minY = Math.min(...bs.map(b => b.y));
        const maxX = Math.max(...bs.map(b => b.x + b.w)), maxY = Math.max(...bs.map(b => b.y + b.h));
        const pad = 70;
        const k = Math.min(1.3, Math.max(0.2, Math.min(
            el.stage.clientWidth / Math.max(1, maxX - minX + pad * 2),
            el.stage.clientHeight / Math.max(1, maxY - minY + pad * 2))));
        if (!ok(k)) return;
        S.view.k = k;
        S.view.x = (el.stage.clientWidth - (maxX - minX) * k) / 2 - minX * k;
        S.view.y = (el.stage.clientHeight - (maxY - minY) * k) / 2 - minY * k;
        applyView();
    }

    async function pasteImage(file) {
        try {
            const result = await window.KBUI.compressImage(file, 1200, 0.75);
            const imgId = window.KB.newImageId();
            await window.KB.saveBoardImage(S.id, imgId, result.dataUrl, { w: result.w, h: result.h });
            S.images[imgId] = result.dataUrl;

            const rect = el.stage.getBoundingClientRect();
            const middle = toWorld(rect.left + el.stage.clientWidth / 2, rect.top + el.stage.clientHeight / 2);
            const scale = Math.min(1, 360 / result.w);
            pushUndo();
            S.elements.push({ id: newId(), type: "image", imageId: imgId,
                x: middle.x - result.w * scale / 2, y: middle.y - result.h * scale / 2,
                w: result.w * scale, h: result.h * scale });
            render(); save();
            window.KBUI.toast("Obrázek vložen.");
        } catch (err) {
            console.error(err);
            window.KBUI.toast("Obrázek se nepodařilo vložit.", "error");
        }
    }

    /* =========================================================== start ==== */

    B.open = async function (boardId, refs) {
        el = refs;
        S.id = boardId;
        S.stamp = Math.random().toString(36).slice(2);
        el.stage.dataset.tool = S.tool;

        const useMeta = (list) => {
            const meta = (list || []).find(b => b.id === boardId);
            if (!meta || S.titleTouched) return;
            S.title = meta.title || "Bez názvu";
            if (el.title) el.title.value = S.title;
        };
        S.title = "Bez názvu";
        useMeta(window.KB.boards);
        window.KB.on("boards", (event) => useMeta(event.detail));

        const data = await window.KB.getBoard(boardId).catch(() => ({ elements: [] }));
        S.elements = sanitize(data.elements);
        S.images = await window.KB.loadBoardImages(boardId).catch(() => ({}));

        render();
        fitAll();
        setStatus("Uloženo");

        if (S.unwatch) S.unwatch();
        S.unwatch = window.KB.watchBoard(boardId, applyRemote);

        el.stage.addEventListener("pointerdown", onDown);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        el.stage.addEventListener("contextmenu", (event) => event.preventDefault());
        el.stage.addEventListener("auxclick", (event) => { if (event.button === 1) event.preventDefault(); });

        el.stage.addEventListener("wheel", (event) => {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) > 40) {
                zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
            } else {
                S.view.x -= event.deltaX; S.view.y -= event.deltaY;
                applyView();
            }
        }, { passive: false });

        el.stage.addEventListener("dblclick", (event) => {
            const cell = event.target.closest("[data-cell]");
            if (cell) return editCell(cell.dataset.cell);
            const hit = event.target.closest("[data-el]");
            if (hit) {
                const e = find(hit.dataset.el);
                if (e && TEXTY.indexOf(e.type) !== -1) return startEditing(e.id);
                return;
            }
            if (S.tool !== "select") return;
            const point = toWorld(event.clientX, event.clientY);
            pushUndo();
            const note = { id: newId(), type: "note", x: point.x - 90, y: point.y - 60, w: 180, h: 120,
                           text: "", fill: "#ffffff", stroke: S.color, shape: S.shape };
            S.elements.push(note);
            S.sel = [note.id];
            render();
            startEditing(note.id);
        });

        el.html.addEventListener("focusout", (event) => {
            if (event.target.dataset && event.target.dataset.text) stopEditing();
        });

        // přehození strany, ze které vychází vybraná spojnice
        el.svg.addEventListener("click", (event) => {
            const side = event.target.closest("[data-side]");
            if (!side) return;
            const [id, dir] = side.dataset.side.split("|");
            const link = find(id);
            if (!link) return;
            pushUndo();
            link.dir = dir;
            arrangeChildren(link.from);
            render(); save();
        });

        // tečky u uzlu mapy: klik = přidat směrem, tažení = umístit ručně
        el.html.addEventListener("pointerdown", (event) => {
            const plus = event.target.closest("[data-add]");
            if (!plus) return;
            event.preventDefault(); event.stopPropagation();
            const [id, dir] = plus.dataset.add.split("|");
            Object.assign(drag, { mode: "pull", id: id, which: dir, moved: false, at: null });
            if (!el.svg.querySelector("#kbPull")) {
                el.svg.insertAdjacentHTML("beforeend", '<path id="kbPull" class="bpull" fill="none"/>');
            }
        });

        el.html.addEventListener("click", (event) => {
            const add = event.target.closest("[data-tadd]");
            if (add) {
                const [id, side] = add.dataset.tadd.split("|");
                const e = find(id);
                if (!e) return;
                pushUndo();
                const cells = e.cells || {};
                const moved = {};

                if (side === "right") { e.cols++; e.w += 120; Object.assign(moved, cells); }
                if (side === "down")  { e.rows++; e.h += 44; Object.assign(moved, cells); }
                if (side === "left") {
                    // nový sloupec vlevo – obsah se posune o jeden doprava
                    Object.keys(cells).forEach(k => {
                        const [r, c] = k.split("_").map(Number);
                        moved[r + "_" + (c + 1)] = cells[k];
                    });
                    e.cols++; e.w += 120; e.x -= 120;
                }
                if (side === "up") {
                    Object.keys(cells).forEach(k => {
                        const [r, c] = k.split("_").map(Number);
                        moved[(r + 1) + "_" + c] = cells[k];
                    });
                    e.rows++; e.h += 44; e.y -= 44;
                }
                e.cells = moved;
                return render(), save();
            }
            const del = event.target.closest("[data-tdel]");
            if (del) {
                const [id, what] = del.dataset.tdel.split("|");
                const e = find(id);
                if (!e) return;
                pushUndo();
                if (what === "col" && e.cols > 1) { e.cols--; e.w -= 120; }
                if (what === "row" && e.rows > 1) { e.rows--; e.h -= 44; }
                return render(), save();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.code === "Space" && !S.editing) { S.space = true; el.stage.dataset.space = "1"; }
            if (S.editing) {
                if (event.key === "Escape") { event.preventDefault(); document.activeElement.blur(); }
                // Enter uzavře psaní a přidá další uzel na stejnou úroveň
                if (event.key === "Enter" && !event.shiftKey) {
                    const e = find(S.editing);
                    if (e && e.type === "mind") {
                        event.preventDefault();
                        const id = e.id;
                        stopEditing();
                        addSibling(id);
                    }
                }
                return;
            }
            if (/input|textarea/i.test(event.target.tagName || "")) return;

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
                event.preventDefault();
                return event.shiftKey ? redo() : undo();
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                event.preventDefault();
                return select(S.elements.filter(e => e.type !== "link").map(e => e.id));
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); return duplicate(); }
            if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); }
            if (event.key === "Escape") { S.sel = []; render(); }
            if (event.key === "v") setTool("select");
            if (event.key === "p") setTool("pen");
            if (event.key === "n") setTool("note");
            if (event.key === "t") setTool("text");
            if (event.key === "m") setTool("mind");
        });
        document.addEventListener("keyup", (event) => {
            if (event.code === "Space") { S.space = false; el.stage.dataset.space = ""; }
        });

        document.addEventListener("paste", (event) => {
            const files = Array.from(event.clipboardData ? event.clipboardData.files : [])
                .filter(f => f.type.startsWith("image/"));
            if (!files.length || S.editing) return;
            event.preventDefault();
            pasteImage(files[0]);
        });

        document.querySelectorAll(".board__bar [data-tool]").forEach(button =>
            button.addEventListener("click", () => setTool(button.dataset.tool)));
        document.querySelectorAll("[data-color]").forEach(button =>
            button.addEventListener("click", () => setColor(button.dataset.color)));
        document.querySelectorAll("[data-paint]").forEach(button =>
            button.addEventListener("click", () => { S.paint = button.dataset.paint; paintButtons(); }));
        document.querySelectorAll("[data-shape]").forEach(button =>
            button.addEventListener("click", () => setShape(button.dataset.shape)));
        document.querySelectorAll("[data-align]").forEach(button =>
            button.addEventListener("click", () => setText("align", button.dataset.align)));
        document.querySelectorAll("[data-size]").forEach(button =>
            button.addEventListener("click", () => setText("size", +button.dataset.size)));
        document.querySelectorAll("[data-bold]").forEach(button =>
            button.addEventListener("click", () => setText("bold", button.dataset.bold === "1")));
        document.querySelectorAll("[data-tcolor]").forEach(button =>
            button.addEventListener("click", () => setText("tcolor", button.dataset.tcolor)));
        document.querySelectorAll("[data-layout]").forEach(button =>
            button.addEventListener("click", () => layout(button.dataset.layout)));
        document.querySelectorAll("[data-width]").forEach(button =>
            button.addEventListener("click", () => {
                S.width = +button.dataset.width;
                eachSelected(e => { if (e.type === "ink") e.width = S.width; });
                paintButtons();
            }));

        if (el.undo)  el.undo.addEventListener("click", undo);
        if (el.redo)  el.redo.addEventListener("click", redo);
        if (el.del)   el.del.addEventListener("click", removeSelected);
        if (el.front) el.front.addEventListener("click", toFront);
        if (el.copy)  el.copy.addEventListener("click", duplicate);
        if (el.fit)   el.fit.addEventListener("click", fitAll);
        if (el.zoomIn)  el.zoomIn.addEventListener("click", () => zoomAt(el.stage.getBoundingClientRect().left + el.stage.clientWidth / 2, el.stage.getBoundingClientRect().top + el.stage.clientHeight / 2, 1.2));
        if (el.zoomOut) el.zoomOut.addEventListener("click", () => zoomAt(el.stage.getBoundingClientRect().left + el.stage.clientWidth / 2, el.stage.getBoundingClientRect().top + el.stage.clientHeight / 2, 1 / 1.2));
        if (el.pick)  el.pick.addEventListener("change", (event) => {
            const file = event.target.files && event.target.files[0];
            if (file) pasteImage(file);
            event.target.value = "";
        });
        if (el.title) el.title.addEventListener("input", () => {
            S.titleTouched = true;
            S.title = el.title.value.trim() || "Bez názvu";
            save();
        });

        paintButtons();
    };

    window.addEventListener("beforeunload", () => {
        if (!S.id || !S.pending) return;
        clearTimeout(S.pending);
        window.KB.saveBoard(S.id, S.elements, S.stamp);
    });
})();
