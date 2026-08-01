/* ==========================================================================
   TABULE NA NÁPADY – nekonečné plátno pro myšlenkové mapy a poznámky.

   Jak to funguje:
   - Prvky (lepítko, text, kresba, tvar, šipka, obrázek) mají souřadnice
     v „papírovém" prostoru, který je nekonečný.
   - Posun a přiblížení nedělá přepočet každého prvku, ale jedna CSS
     transformace na obalu (#boardWorld). Proto je posouvání plynulé
     i s několika sty prvky.
   - Boxy (lepítka, text, obrázky) jsou obyčejné HTML divy, aby v nich
     šlo psát přímo. Kresba, tvary a šipky jsou v jedné SVG vrstvě.
   - Ukládá se celé pole prvků do jednoho dokumentu, se zpožděním po
     poslední změně. Cizí změny přitečou přes onSnapshot.
   ========================================================================== */

(function () {
    "use strict";

    const B = {};
    window.KBBoard = B;

    const esc = (value) => window.KBUI.esc(value);

    /* prvky, které se dají tahat za roh */
    const BOXES = ["note", "text", "rect", "ellipse", "image", "mind"];

    /* o kolik od sebe odsadit uzly myšlenkové mapy */
    const GAP_X = 70, GAP_Y = 55;

    const S = {
        id: null,
        title: "",
        elements: [],
        images: {},
        view: { x: 0, y: 0, k: 1 },
        tool: "select",
        color: "#ffd45e",
        width: 3,
        selected: "",
        editing: "",          // do kterého prvku se právě píše
        undo: [],
        redo: [],
        stamp: Math.random().toString(36).slice(2),   // rozliší vlastní zápis od cizího
        pending: null,
        remote: null,         // cizí verze, která čeká na dopsání textu
        unwatch: null
    };

    let el = {};              // odkazy na prvky stránky

    /* ====================================================== souřadnice ==== */

    const toWorld = (clientX, clientY) => {
        const rect = el.stage.getBoundingClientRect();
        return {
            x: (clientX - rect.left - S.view.x) / S.view.k,
            y: (clientY - rect.top - S.view.y) / S.view.k
        };
    };

    function applyView() {
        el.world.style.transform =
            "translate(" + S.view.x + "px," + S.view.y + "px) scale(" + S.view.k + ")";
        if (el.zoomLabel) el.zoomLabel.textContent = Math.round(S.view.k * 100) + " %";
    }

    function zoomAt(clientX, clientY, factor) {
        const next = Math.min(4, Math.max(0.15, S.view.k * factor));
        const rect = el.stage.getBoundingClientRect();
        const sx = clientX - rect.left, sy = clientY - rect.top;
        // bod pod kurzorem musí zůstat na místě
        S.view.x = sx - (sx - S.view.x) * (next / S.view.k);
        S.view.y = sy - (sy - S.view.y) * (next / S.view.k);
        S.view.k = next;
        applyView();
    }

    /* ========================================================== model ==== */

    const newId = () => "el_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const find = (id) => S.elements.find(e => e.id === id) || null;

    function pushUndo() {
        S.undo.push(JSON.stringify(S.elements));
        if (S.undo.length > 40) S.undo.shift();
        S.redo.length = 0;
        paintButtons();
    }

    function undo() {
        if (!S.undo.length) return;
        S.redo.push(JSON.stringify(S.elements));
        S.elements = JSON.parse(S.undo.pop());
        S.selected = "";
        render();
        save();
    }

    function redo() {
        if (!S.redo.length) return;
        S.undo.push(JSON.stringify(S.elements));
        S.elements = JSON.parse(S.redo.pop());
        S.selected = "";
        render();
        save();
    }

    /** Obálka prvku – kvůli výběru a doostření pohledu. */
    function bounds(e) {
        if (e.type === "ink") {
            const xs = [], ys = [];
            for (let i = 0; i < e.points.length; i += 2) { xs.push(e.points[i]); ys.push(e.points[i + 1]); }
            if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 };
            return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        }
        if (e.type === "arrow") {
            return { x: Math.min(e.x, e.x2), y: Math.min(e.y, e.y2), w: Math.abs(e.x2 - e.x), h: Math.abs(e.y2 - e.y) };
        }
        return { x: e.x, y: e.y, w: e.w, h: e.h };
    }

    /* ====================================================== vykreslení ==== */

    /* Body kresby držíme naplocho [x1,y1,x2,y2,…] – Firestore neumí uložit
       pole v poli. Čára se prokládá přes středy úseků, aby nebyla hranatá. */
    function inkPath(p) {
        const n = Math.floor(p.length / 2);
        if (!n) return "";
        if (n < 3) return "M" + p[0] + "," + p[1] + " L" + p[p.length - 2] + "," + p[p.length - 1];

        let d = "M" + p[0] + "," + p[1];
        for (let i = 1; i < n - 1; i++) {
            const x = p[i * 2], y = p[i * 2 + 1];
            const mx = (x + p[i * 2 + 2]) / 2, my = (y + p[i * 2 + 3]) / 2;
            d += " Q" + x + "," + y + " " + mx + "," + my;
        }
        return d + " L" + p[(n - 1) * 2] + "," + p[(n - 1) * 2 + 1];
    }

    /* ------------------------------------------- myšlenková mapa: spojnice */

    /** Bod na okraji obdélníku ve směru k druhému uzlu. */
    function edgePoint(from, to) {
        const cx = from.x + from.w / 2, cy = from.y + from.h / 2;
        const dx = (to.x + to.w / 2) - cx, dy = (to.y + to.h / 2) - cy;
        if (!dx && !dy) return { x: cx, y: cy };
        const sx = dx === 0 ? Infinity : (from.w / 2) / Math.abs(dx);
        const sy = dy === 0 ? Infinity : (from.h / 2) / Math.abs(dy);
        const s = Math.min(sx, sy);
        return { x: cx + dx * s, y: cy + dy * s };
    }

    /** Spojnice se počítá z aktuální polohy uzlů, takže je drží při přesunu. */
    function linkPath(link) {
        const a = find(link.from), b = find(link.to);
        if (!a || !b) return "";
        const p1 = edgePoint(a, b), p2 = edgePoint(b, a);
        if (Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y)) {
            const c = (p1.x + p2.x) / 2;
            return "M" + p1.x + "," + p1.y + " C" + c + "," + p1.y + " " + c + "," + p2.y + " " + p2.x + "," + p2.y;
        }
        const c = (p1.y + p2.y) / 2;
        return "M" + p1.x + "," + p1.y + " C" + p1.x + "," + c + " " + p2.x + "," + c + " " + p2.x + "," + p2.y;
    }

    const linksOf = (id) => S.elements.filter(e => e.type === "link" && (e.from === id || e.to === id));

    /** Založí navázaný uzel daným směrem a uhne, kdyby na někoho seděl. */
    function addChild(parentId, dir) {
        const parent = find(parentId);
        if (!parent) return;

        const w = 170, h = 74;
        let x = parent.x, y = parent.y + (parent.h - h) / 2;
        if (dir === "right") x = parent.x + parent.w + GAP_X;
        if (dir === "left")  x = parent.x - w - GAP_X;
        if (dir === "up")   { x = parent.x + (parent.w - w) / 2; y = parent.y - h - GAP_Y; }
        if (dir === "down") { x = parent.x + (parent.w - w) / 2; y = parent.y + parent.h + GAP_Y; }

        const hits = () => S.elements.some(e => BOXES.indexOf(e.type) !== -1 &&
            x < e.x + e.w + 12 && x + w + 12 > e.x && y < e.y + e.h + 12 && y + h + 12 > e.y);
        for (let i = 0; i < 24 && hits(); i++) {
            if (dir === "left" || dir === "right") y += h + 18; else x += w + 18;
        }

        pushUndo();
        const node = { id: newId(), type: "mind", x: x, y: y, w: w, h: h, text: "", color: parent.color || S.color };
        S.elements.push({ id: newId(), type: "link", from: parentId, to: node.id, color: "#94a0ad" });
        S.elements.push(node);
        S.selected = node.id;
        render();
        save();
        startEditing(node.id);
    }

    function svgHtml(e) {
        const sel = e.id === S.selected;
        const stroke = 'stroke="' + esc(e.color || "#16191d") + '" stroke-width="' + (e.width || 3) + '"';

        if (e.type === "link") {
            return '<path data-link="' + e.id + '" d="' + linkPath(e) + '" fill="none" stroke="' +
                esc(e.color || "#94a0ad") + '" stroke-width="2.5" stroke-linecap="round" class="blink"/>';
        }

        if (e.type === "ink") {
            return '<path data-el="' + e.id + '" d="' + inkPath(e.points) + '" fill="none" ' + stroke +
                ' stroke-linecap="round" stroke-linejoin="round" class="bsvg' + (sel ? " is-sel" : "") + '"/>';
        }
        if (e.type === "arrow") {
            return '<line data-el="' + e.id + '" x1="' + e.x + '" y1="' + e.y + '" x2="' + e.x2 + '" y2="' + e.y2 + '" ' +
                stroke + ' stroke-linecap="round" marker-end="url(#kbArrow)" class="bsvg' + (sel ? " is-sel" : "") + '"/>';
        }
        if (e.type === "rect") {
            return '<rect data-el="' + e.id + '" x="' + e.x + '" y="' + e.y + '" width="' + e.w + '" height="' + e.h +
                '" rx="6" fill="none" ' + stroke + ' class="bsvg' + (sel ? " is-sel" : "") + '"/>';
        }
        if (e.type === "ellipse") {
            return '<ellipse data-el="' + e.id + '" cx="' + (e.x + e.w / 2) + '" cy="' + (e.y + e.h / 2) +
                '" rx="' + Math.abs(e.w / 2) + '" ry="' + Math.abs(e.h / 2) + '" fill="none" ' + stroke +
                ' class="bsvg' + (sel ? " is-sel" : "") + '"/>';
        }
        return "";
    }

    function boxHtml(e) {
        const sel = e.id === S.selected;
        const style = "left:" + e.x + "px;top:" + e.y + "px;width:" + e.w + "px;height:" + e.h + "px;";

        if (e.type === "image") {
            return '<div class="bel bel--image' + (sel ? " is-sel" : "") + '" data-el="' + e.id + '" style="' + style + '">' +
                '<img src="' + (S.images[e.imageId] || "") + '" alt="" draggable="false">' +
                (sel ? '<span class="bel__grip"></span>' : "") +
            "</div>";
        }

        const filled = e.type === "note" || e.type === "mind";
        const back = filled ? "background:" + esc(e.color || "#ffd45e") + ";" : "";
        const color = filled ? "" : "color:" + esc(e.color || "#16191d") + ";";
        const size = "font-size:" + (e.size || (e.type === "text" ? 20 : 15)) + "px;";

        // uzel mapy má na všech čtyřech stranách tlačítko, které přidá navázaný uzel
        const plus = (e.type === "mind" && sel)
            ? ["up", "right", "down", "left"].map(dir =>
                '<button type="button" class="bel__plus bel__plus--' + dir + '" data-add="' + e.id + "|" + dir +
                '" title="Přidat navázané pole">+</button>').join("")
            : "";

        return '<div class="bel bel--' + e.type + (sel ? " is-sel" : "") + '" data-el="' + e.id + '" ' +
            'style="' + style + back + '">' +
            '<div class="bel__text" data-text="' + e.id + '" style="' + color + size + '"' +
                (S.editing === e.id ? ' contenteditable="true"' : "") + ">" + esc(e.text || "") + "</div>" +
            (sel ? '<span class="bel__grip"></span>' : "") + plus +
        "</div>";
    }

    function render() {
        if (S.editing) return;   // do rozepsaného textu nešaháme

        const boxes = S.elements.filter(e => BOXES.indexOf(e.type) !== -1 && e.type !== "rect" && e.type !== "ellipse");
        const shapes = S.elements.filter(e => boxes.indexOf(e) === -1);

        el.svg.innerHTML =
            '<defs><marker id="kbArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
            '<path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>' +
            shapes.map(svgHtml).join("");

        el.html.innerHTML = boxes.map(boxHtml).join("");

        // rámeček výběru u kresby, šipek a tvarů (boxy si ho kreslí samy)
        const sel = find(S.selected);
        if (sel && boxes.indexOf(sel) === -1) {
            const b = bounds(sel);
            const pad = 6;
            el.html.insertAdjacentHTML("beforeend",
                '<div class="bel__ghost" style="left:' + (b.x - pad) + "px;top:" + (b.y - pad) +
                "px;width:" + (b.w + pad * 2) + "px;height:" + (b.h + pad * 2) + 'px"></div>');
        }

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
        if (el.selbar) el.selbar.hidden = !S.selected;
    }

    /* ======================================================== ukládání ==== */

    function save() {
        clearTimeout(S.pending);
        setStatus("Ukládám…");
        S.pending = setTimeout(async () => {
            try {
                await window.KB.saveBoard(S.id, S.elements, S.stamp);
                await window.KB.saveBoardMeta(S.id, { title: S.title });
                setStatus("Uloženo");
            } catch (err) {
                console.error(err);
                setStatus("Uložení selhalo", true);
            }
        }, 800);
    }

    function setStatus(text, bad) {
        if (!el.status) return;
        el.status.textContent = text;
        el.status.style.color = bad ? "var(--danger)" : "var(--dim)";
    }

    /** Cizí změna – převezmeme ji, jen když zrovna nepíšeme. */
    function applyRemote(data) {
        if (!data || data.stamp === S.stamp) return;
        if (S.editing || drag.mode) { S.remote = data; return; }   // rozdělanou práci nepřerušíme

        // první snímek po otevření je to, co jsme právě načetli – jen ho tiše přijmeme
        const same = JSON.stringify(data.elements || []) === JSON.stringify(S.elements);
        S.elements = data.elements || [];
        S.selected = "";
        render();
        if (!same) setStatus("Aktualizováno od: " + (data.updatedBy || "kolega"));
    }

    /* ====================================================== interakce ==== */

    const drag = { mode: "", id: "", x0: 0, y0: 0, ox: 0, oy: 0, moved: false };
    const pointers = new Map();
    let pinch = null;

    function startElement(point) {
        const id = newId();
        const base = { id: id, color: S.color };

        if (S.tool === "mind")  Object.assign(base, { type: "mind", x: point.x - 85, y: point.y - 37, w: 170, h: 74, text: "" });
        if (S.tool === "note")  Object.assign(base, { type: "note", x: point.x - 90, y: point.y - 60, w: 180, h: 120, text: "" });
        if (S.tool === "text")  Object.assign(base, { type: "text", x: point.x, y: point.y - 16, w: 260, h: 44, text: "", color: "#16191d" });
        if (S.tool === "rect")  Object.assign(base, { type: "rect", x: point.x, y: point.y, w: 1, h: 1, color: S.color === "#ffd45e" ? "#16191d" : S.color });
        if (S.tool === "ellipse") Object.assign(base, { type: "ellipse", x: point.x, y: point.y, w: 1, h: 1, color: S.color === "#ffd45e" ? "#16191d" : S.color });
        if (S.tool === "arrow") Object.assign(base, { type: "arrow", x: point.x, y: point.y, x2: point.x, y2: point.y, color: S.color === "#ffd45e" ? "#16191d" : S.color });
        if (S.tool === "pen")   Object.assign(base, { type: "ink", points: [point.x, point.y], color: S.color === "#ffd45e" ? "#c8102e" : S.color, width: S.width });

        pushUndo();
        S.elements.push(base);
        S.selected = "";
        return base;
    }

    function onDown(event) {
        if (event.button === 2) return;                 // pravé tlačítko necháme systému
        if (event.target.closest("[data-add]")) return;  // plusko u uzlu mapy řeší klik
        pointers.set(event.pointerId, event);

        if (pointers.size === 2) {                      // dva prsty = přiblížení a posun
            const [a, b] = [...pointers.values()];
            pinch = {
                dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                cx: (a.clientX + b.clientX) / 2,
                cy: (a.clientY + b.clientY) / 2
            };
            drag.mode = "";
            return;
        }
        if (pointers.size > 2) return;

        const point = toWorld(event.clientX, event.clientY);
        const hit = event.target.closest("[data-el]");
        const grip = event.target.classList && event.target.classList.contains("bel__grip");

        /* Jako ve Freeformu: Apple Pencil kreslí, prst posouvá a vybírá.
           Když je zvolený konkrétní nástroj (lepítko, tvar…), pero ho respektuje. */
        const penDraws = event.pointerType === "pen" && (S.tool === "select" || S.tool === "hand");

        if (S.tool === "erase" || (event.pointerType === "pen" && event.buttons === 32)) {
            drag.mode = "erase";
            eraseAt(event);
            return;
        }

        if (penDraws) {
            const ink = { id: newId(), type: "ink", color: S.color === "#ffd45e" ? "#c8102e" : S.color,
                          width: S.width, points: [point.x, point.y] };
            pushUndo();
            S.elements.push(ink);
            S.selected = "";
            Object.assign(drag, { mode: "ink", id: ink.id, x0: point.x, y0: point.y, moved: false });
            render();
            return;
        }

        if (S.tool === "select") {
            if (grip && S.selected) {
                const e = find(S.selected);
                Object.assign(drag, { mode: "resize", id: S.selected, x0: point.x, y0: point.y, ox: e.w, oy: e.h, moved: false });
                return;
            }
            if (hit) {
                const e = find(hit.dataset.el);
                if (!e) return;
                S.selected = e.id;
                const b = bounds(e);
                Object.assign(drag, { mode: "move", id: e.id, x0: point.x, y0: point.y, ox: b.x, oy: b.y, moved: false });
                render();
                return;
            }
            // prázdná plocha = posun plátna
            Object.assign(drag, { mode: "pan", x0: event.clientX, y0: event.clientY, ox: S.view.x, oy: S.view.y, moved: false });
            if (S.selected) { S.selected = ""; render(); }
            return;
        }

        if (S.tool === "hand") {
            Object.assign(drag, { mode: "pan", x0: event.clientX, y0: event.clientY, ox: S.view.x, oy: S.view.y, moved: false });
            return;
        }

        const created = startElement(point);
        Object.assign(drag, { mode: created.type === "ink" ? "ink" : "create", id: created.id, x0: point.x, y0: point.y, moved: false });
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

        const point = toWorld(event.clientX, event.clientY);

        if (drag.mode === "pan") {
            S.view.x = drag.ox + (event.clientX - drag.x0);
            S.view.y = drag.oy + (event.clientY - drag.y0);
            return applyView();
        }

        const e = find(drag.id);
        if (!e) return;

        if (drag.mode === "move") {
            const dx = point.x - drag.x0, dy = point.y - drag.y0;
            if (e.type === "ink") {
                if (!drag.pts) drag.pts = e.points.slice();
                e.points = drag.pts.map((v, i) => i % 2 === 0 ? v + dx : v + dy);
            } else if (e.type === "arrow") {
                if (!drag.arr) drag.arr = { x: e.x, y: e.y, x2: e.x2, y2: e.y2 };
                e.x = drag.arr.x + dx; e.y = drag.arr.y + dy;
                e.x2 = drag.arr.x2 + dx; e.y2 = drag.arr.y2 + dy;
            } else {
                e.x = drag.ox + dx; e.y = drag.oy + dy;
            }
            return renderLive(e);
        }

        if (drag.mode === "resize") {
            e.w = Math.max(40, drag.ox + (point.x - drag.x0));
            e.h = Math.max(30, drag.oy + (point.y - drag.y0));
            return renderLive(e);
        }

        if (drag.mode === "create") {
            if (e.type === "arrow") { e.x2 = point.x; e.y2 = point.y; }
            else {
                e.x = Math.min(drag.x0, point.x); e.y = Math.min(drag.y0, point.y);
                e.w = Math.abs(point.x - drag.x0); e.h = Math.abs(point.y - drag.y0);
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

    /** Guma – co je pod hrotem, to zmizí (i s navázanými spojnicemi). */
    function eraseAt(event) {
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const hit = target && target.closest ? target.closest("[data-el],[data-link]") : null;
        if (!hit) return;

        const id = hit.dataset.el || hit.dataset.link;
        if (!id) return;
        if (!drag.erased) { pushUndo(); drag.erased = true; }
        S.elements = S.elements.filter(e =>
            e.id !== id && !(e.type === "link" && (e.from === id || e.to === id)));
        render();
    }

    /** Během tažení překreslíme jen jeden prvek, ne celou tabuli. */
    function renderLive(e) {
        const node = el.stage.querySelector('[data-el="' + e.id + '"]');
        if (!node) return render();

        if (e.type === "note" || e.type === "text" || e.type === "image" || e.type === "mind") {
            node.style.left = e.x + "px"; node.style.top = e.y + "px";
            node.style.width = e.w + "px"; node.style.height = e.h + "px";
            // spojnice myšlenkové mapy musí uzel následovat
            linksOf(e.id).forEach(link => {
                const path = el.svg.querySelector('[data-link="' + link.id + '"]');
                if (path) path.setAttribute("d", linkPath(link));
            });
            return;
        }
        if (e.type === "ink") return node.setAttribute("d", inkPath(e.points));
        if (e.type === "arrow") {
            node.setAttribute("x1", e.x); node.setAttribute("y1", e.y);
            node.setAttribute("x2", e.x2); node.setAttribute("y2", e.y2);
            return;
        }
        if (e.type === "rect") {
            node.setAttribute("x", e.x); node.setAttribute("y", e.y);
            node.setAttribute("width", Math.max(1, e.w)); node.setAttribute("height", Math.max(1, e.h));
            return;
        }
        if (e.type === "ellipse") {
            node.setAttribute("cx", e.x + e.w / 2); node.setAttribute("cy", e.y + e.h / 2);
            node.setAttribute("rx", Math.max(1, Math.abs(e.w / 2))); node.setAttribute("ry", Math.max(1, Math.abs(e.h / 2)));
        }
    }

    function onUp(event) {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!drag.mode) return;

        const mode = drag.mode, id = drag.id, moved = drag.moved;
        drag.mode = ""; drag.id = ""; drag.pts = null; drag.arr = null;

        if (mode === "erase") {
            const erased = drag.erased;
            drag.erased = false;
            if (erased) save();
            return;
        }
        if (mode === "pan") return;

        const e = find(id);
        if (!e) return;

        // klik bez tažení: tvary dostanou rozumnou výchozí velikost
        if (mode === "create" && !moved) {
            if (e.type === "arrow") { e.x2 = e.x + 160; e.y2 = e.y; }
            else { e.w = 160; e.h = 110; }
        }
        // čára z jednoho bodu nemá smysl
        if (mode === "ink" && e.points.length < 4) {
            S.elements = S.elements.filter(x => x.id !== e.id);
        }
        if (mode === "move" && !moved) {
            // ťuknutí do lepítka rovnou otevře psaní
            if (e.type === "note" || e.type === "text" || e.type === "mind") return startEditing(e.id);
        }
        if (mode !== "move" && mode !== "resize") {
            S.tool = "select";
            S.selected = e.id;
        }

        render();
        save();

        if ((mode === "create" || mode === "ink") && (e.type === "note" || e.type === "text" || e.type === "mind")) startEditing(e.id);
    }

    /* ========================================================== psaní ==== */

    function startEditing(id) {
        if (S.editing && S.editing !== id) stopEditing();   // rozepsaný text nejdřív ulož
        S.editing = id;
        render.call(null);           // render se přeskočí, dokreslíme ručně
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
            const text = node.innerText.replace(/ /g, " ").trim();
            if (text !== (e.text || "")) { pushUndo(); e.text = text; save(); }
            // prázdné lepítko po sobě neuklízí nepořádek
            if (!text && !e.keep) S.elements = S.elements.filter(x => x.id !== e.id);
        }
        S.editing = "";
        if (S.remote) { const r = S.remote; S.remote = null; return applyRemote(r); }
        render();
    }

    /* ======================================================== nástroje ==== */

    function setTool(tool) {
        stopEditing();
        S.tool = tool;
        el.stage.dataset.tool = tool;
        paintButtons();
    }

    function setColor(color) {
        S.color = color;
        const e = find(S.selected);
        if (e) { pushUndo(); e.color = color; render(); save(); }
        paintButtons();
    }

    function removeSelected() {
        if (!S.selected) return;
        pushUndo();
        const gone = S.selected;
        // s uzlem mapy zmizí i spojnice, které do něj vedly
        S.elements = S.elements.filter(e =>
            e.id !== gone && !(e.type === "link" && (e.from === gone || e.to === gone)));
        S.selected = "";
        render();
        save();
    }

    function toFront() {
        const e = find(S.selected);
        if (!e) return;
        pushUndo();
        S.elements = S.elements.filter(x => x.id !== e.id).concat([e]);
        render();
        save();
    }

    function duplicate() {
        const e = find(S.selected);
        if (!e) return;
        pushUndo();
        const copy = JSON.parse(JSON.stringify(e));
        copy.id = newId();
        if (copy.points) copy.points = copy.points.map(v => v + 24);
        else { copy.x += 24; copy.y += 24; if (copy.x2 !== undefined) { copy.x2 += 24; copy.y2 += 24; } }
        S.elements.push(copy);
        S.selected = copy.id;
        render();
        save();
    }

    /** Doostří pohled tak, aby byly vidět všechny prvky. */
    function fitAll() {
        if (!S.elements.length) {
            S.view = { x: el.stage.clientWidth / 2, y: el.stage.clientHeight / 2, k: 1 };
            return applyView();
        }
        const bs = S.elements.map(bounds);
        const minX = Math.min(...bs.map(b => b.x)), minY = Math.min(...bs.map(b => b.y));
        const maxX = Math.max(...bs.map(b => b.x + b.w)), maxY = Math.max(...bs.map(b => b.y + b.h));
        const pad = 60;
        const k = Math.min(2, Math.max(0.15,
            Math.min(el.stage.clientWidth / (maxX - minX + pad * 2), el.stage.clientHeight / (maxY - minY + pad * 2))));
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

            const middle = toWorld(el.stage.getBoundingClientRect().left + el.stage.clientWidth / 2,
                                   el.stage.getBoundingClientRect().top + el.stage.clientHeight / 2);
            const scale = Math.min(1, 360 / result.w);
            pushUndo();
            S.elements.push({
                id: newId(), type: "image", imageId: imgId,
                x: middle.x - result.w * scale / 2, y: middle.y - result.h * scale / 2,
                w: result.w * scale, h: result.h * scale
            });
            render();
            save();
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

        // název je v hlavičce tabule – ta může dorazit až po otevření stránky
        const useMeta = (list) => {
            const meta = (list || []).find(b => b.id === boardId);
            if (!meta || S.titleTouched) return;
            S.title = meta.title || "Bez názvu";
            if (el.title) el.title.value = S.title;
        };
        S.title = "Bez názvu";
        useMeta(window.KB.boards);
        window.KB.on("boards", (event) => useMeta(event.detail));

        const data = await window.KB.getBoard(boardId);
        S.elements = data.elements || [];
        S.images = await window.KB.loadBoardImages(boardId).catch(() => ({}));

        render();
        fitAll();
        setStatus("Uloženo");

        if (S.unwatch) S.unwatch();
        S.unwatch = window.KB.watchBoard(boardId, applyRemote);

        /* ---- ovládání ---- */
        el.stage.addEventListener("pointerdown", onDown);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);

        el.stage.addEventListener("wheel", (event) => {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) > 40) {
                zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
            } else {
                S.view.x -= event.deltaX;
                S.view.y -= event.deltaY;
                applyView();
            }
        }, { passive: false });

        el.stage.addEventListener("dblclick", (event) => {
            const hit = event.target.closest("[data-el]");
            if (hit) {
                const e = find(hit.dataset.el);
                if (e && (e.type === "note" || e.type === "text" || e.type === "mind")) return startEditing(e.id);
                return;
            }
            if (S.tool !== "select") return;
            const point = toWorld(event.clientX, event.clientY);
            pushUndo();
            const note = { id: newId(), type: "note", x: point.x - 90, y: point.y - 60, w: 180, h: 120, text: "", color: S.color };
            S.elements.push(note);
            render();
            startEditing(note.id);
        });

        el.html.addEventListener("focusout", (event) => {
            if (event.target.dataset && event.target.dataset.text) stopEditing();
        });

        // plusko u uzlu myšlenkové mapy
        el.html.addEventListener("click", (event) => {
            const plus = event.target.closest("[data-add]");
            if (!plus) return;
            event.preventDefault();
            event.stopPropagation();
            const [id, dir] = plus.dataset.add.split("|");
            addChild(id, dir);
        });

        document.addEventListener("keydown", (event) => {
            if (S.editing) {
                if (event.key === "Escape") { event.preventDefault(); document.activeElement.blur(); }
                return;
            }
            const typing = /input|textarea/i.test((event.target.tagName || ""));
            if (typing) return;

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
                event.preventDefault();
                return event.shiftKey ? redo() : undo();
            }
            if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); }
            if (event.key === "Escape") { S.selected = ""; render(); }
            if (event.key === "v") setTool("select");
            if (event.key === "p") setTool("pen");
            if (event.key === "n") setTool("note");
            if (event.key === "t") setTool("text");
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
        document.querySelectorAll("[data-width]").forEach(button =>
            button.addEventListener("click", () => {
                S.width = +button.dataset.width;
                const e = find(S.selected);
                if (e && e.type === "ink") { pushUndo(); e.width = S.width; render(); save(); }
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

    /** Uloží rozdělanou práci, když se odchází ze stránky. */
    window.addEventListener("beforeunload", () => {
        if (!S.id || !S.pending) return;
        clearTimeout(S.pending);
        window.KB.saveBoard(S.id, S.elements, S.stamp);
    });
})();
