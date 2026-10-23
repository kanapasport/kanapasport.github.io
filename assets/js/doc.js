/* ==========================================================================
   A4 dokument – sazba, stránkování a export do PDF.

   Klíčová myšlenka: náhled na stránce se NEGENERUJE zvlášť od PDF.
   Obsah se rozstránkuje do skutečných A4 elementů (210×297 mm) a PDF
   se pak vyrobí přesně z nich (html2canvas → jsPDF). Co vidíš na obrazovce,
   to je doslova to, co vypadne do PDF – včetně diakritiky, zápatí i vodoznaku.
   ========================================================================== */

(function () {
    "use strict";

    const MM = {
        pageW: 210, pageH: 297,
        padX: 16, padTop: 14, footH: 24,
        stepIndent: 4.6,   // border-left 0.6mm + padding-left 4mm
        stepGap: 5         // margin-bottom u .doc-step
    };

    let pxPerMm = 3.7795275591;   // přepočítá se při prvním použití podle prohlížeče

    function calibrate() {
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;visibility:hidden;height:100mm;";
        document.body.appendChild(probe);
        const h = probe.getBoundingClientRect().height;
        document.body.removeChild(probe);
        if (h > 0) pxPerMm = h / 100;
    }

    const mm = (value) => value * pxPerMm;

    const esc = (str) => String(str == null ? "" : str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    /* Návod smí upravit každý člen, takže se nevěří ničemu, co v něm leží:
       velikost obrázku jen z výčtu, obrázek jen jako data URL. (doc.js se
       načítá před ui.js, KBUI se proto bere až při vykreslení.) */
    const velikostObrazku = (size) => (["s", "m", "l"].indexOf(size) >= 0 ? size : "m");
    const bezpecnyObrazek = (url) => (window.KBUI && window.KBUI.bezpecnyObrazek)
        ? window.KBUI.bezpecnyObrazek(url) : "";

    /* ----------------------------------------------------- text → HTML */

    /**
     * Jednoduché formátování: **tučně**, `kód` a odkaz na obrázek.
     * Obrázky se číslují jako KROK.POŘADÍ (obr. 2.1 = první obrázek druhého kroku),
     * takže přidání obrázku jinam nepřečísluje odkazy v celém dokumentu.
     * V textu kroku stačí napsat [obr 1] – doplní se číslo aktuálního kroku.
     */
    function inline(text, stepIndex, imagesByStep) {
        let out = esc(text);
        out = out.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
        out = out.replace(/`([^`]+?)`/g, '<code style="font-family:ui-monospace,Consolas,monospace;background:#f1f5f9;padding:0 1mm;border-radius:0.7mm">$1</code>');
        out = out.replace(/\[obr\.?\s*(\d+)(?:\.(\d+))?\]/gi, (match, first, second) => {
            const step = second === undefined ? stepIndex : parseInt(first, 10) - 1;
            const order = second === undefined ? parseInt(first, 10) : parseInt(second, 10);
            const image = (imagesByStep[step] || [])[order - 1];
            if (!image) return match;
            return '<a class="doc-ref" data-img="' + image.id + '">obr. ' + (step + 1) + "." + order + "</a>";
        });
        return out;
    }

    /* ------------------------------------------------ rozklad na atomy */

    /** Vrátí ploché pole nejmenších nedělitelných bloků. */
    function buildAtoms(guide, imageMap) {
        const steps = guide.steps || [];

        // obrázky seskupené po krocích – jen ty, ke kterým máme data
        const imagesByStep = steps.map(step => (step.images || []).filter(img => bezpecnyObrazek(imageMap[img.id])));

        const atoms = [];
        atoms.push({ step: null, keepWithNext: true, html: headHtml(guide) });

        if (!steps.length) {
            atoms.push({ step: 0, html: '<p class="doc-empty">Návod zatím nemá žádné kroky.</p>' });
        }

        steps.forEach((step, si) => {
            atoms.push({
                step: si, keepWithNext: true,
                html: '<h4 class="doc-step-title">' + esc(step.title || "Krok " + (si + 1)) + "</h4>"
            });

            const lines = String(step.content || "").split(/\n/);
            let bullets = [];
            const flushBullets = () => {
                if (!bullets.length) return;
                atoms.push({
                    step: si,
                    html: '<ul class="doc-p" style="padding-left:5mm;margin-top:0">' +
                        bullets.map(b => "<li>" + inline(b, si, imagesByStep) + "</li>").join("") + "</ul>"
                });
                bullets = [];
            };

            lines.forEach(line => {
                const trimmed = line.trim();
                if (!trimmed) { flushBullets(); return; }
                if (/^[-*•]\s+/.test(trimmed)) {
                    bullets.push(trimmed.replace(/^[-*•]\s+/, ""));
                } else {
                    flushBullets();
                    atoms.push({ step: si, html: '<p class="doc-p">' + inline(trimmed, si, imagesByStep) + "</p>" });
                }
            });
            flushBullets();

            if (step.code && step.code.trim()) {
                // dlouhý kód rozdělíme po řádcích, aby se vešel i přes zlom stránky
                const codeLines = step.code.replace(/\s+$/, "").split(/\n/);
                const chunkSize = 24;
                for (let i = 0; i < codeLines.length; i += chunkSize) {
                    atoms.push({
                        step: si,
                        html: '<pre class="doc-code">' + esc(codeLines.slice(i, i + chunkSize).join("\n")) + "</pre>"
                    });
                }
            }

            imagesByStep[si].forEach((img, ii) => {
                const caption = "obr. " + (si + 1) + "." + (ii + 1) +
                                (img.caption ? " — " + esc(img.caption) : "");
                atoms.push({
                    step: si,
                    html: '<figure class="doc-fig doc-fig--' + velikostObrazku(img.size) + '">' +
                          '<img src="' + esc(bezpecnyObrazek(imageMap[img.id])) + '" data-img="' + esc(img.id) + '" alt="' + esc(img.caption || caption) + '">' +
                          "<figcaption>" + caption + "</figcaption></figure>"
                });
            });
        });

        return atoms;
    }

    function headHtml(guide) {
        const category = window.KB_categoryLabel ? window.KB_categoryLabel(guide) : (guide.category || "");
        return '<div class="doc-head">' +
            '<img class="doc-head__logo" src="Pasport_Kana_black.png" alt="Pasport Kaňa">' +
            '<div class="doc-head__kicker">Firemní manuál</div>' +
            '<span class="doc-head__cat">' + esc(category || "Nezařazeno") + "</span>" +
            '<h1 class="doc-head__title">' + esc(guide.title || "Bez názvu") + "</h1>" +
            (guide.desc ? '<p class="doc-head__desc">' + esc(guide.desc) + "</p>" : "") +
            "</div>";
    }

    function footHtml(guide, page, total) {
        const category = window.KB_categoryLabel ? window.KB_categoryLabel(guide) : (guide.category || "");
        const date = guide.dateLabel || new Date().toLocaleDateString("cs-CZ");
        return '<div class="a4-foot">' +
            '<div class="a4-foot__col a4-foot__col--l">' +
                '<div class="a4-foot__row a4-foot__cat">' + esc(category || "NEZAŘAZENO") + "</div>" +
                '<div class="a4-foot__row">DATUM: <b>' + esc(date) + "</b></div>" +
                '<div class="a4-foot__row">VERZE: <b>' + esc(guide.version || "v1.0") + "</b></div>" +
            "</div>" +
            '<div class="a4-foot__col a4-foot__col--r">' +
                '<div class="a4-foot__row a4-foot__title">' + esc(guide.title || "Bez názvu") + "</div>" +
                '<div class="a4-foot__row">AUTOR: <b>' + esc(guide.author || "Nezadáno") + "</b></div>" +
                '<div class="a4-foot__row">STRANA: <b>' + page + "/" + total + "</b></div>" +
            "</div></div>";
    }

    /* ------------------------------------------------------ stránkování */

    function getRuler(widthPx) {
        let ruler = document.getElementById("a4Ruler");
        if (!ruler) {
            ruler = document.createElement("div");
            ruler.id = "a4Ruler";
            document.body.appendChild(ruler);
        }
        ruler.style.width = widthPx + "px";
        return ruler;
    }

    /**
     * Změří výšku atomu VČETNĚ spodní mezery a tu si zapamatuje zvlášť.
     * Za atom vkládáme nulovou vzpěru, aby se neuplatnila pravidla :last-child
     * (jinak by se mezera mezi odstavci do výpočtu vůbec nezapočítala).
     */
    const SPACER = '<i style="display:block;height:0;font-size:0"></i>';

    function measureInto(ruler, atom) {
        ruler.innerHTML = atom.html + SPACER;
        atom.h = ruler.offsetHeight;
        const child = ruler.firstElementChild;
        atom.mb = child ? parseFloat(getComputedStyle(child).marginBottom) || 0 : 0;
    }

    function paginate(atoms, capacityPx, contentWpx, stepWpx) {
        const rulerFull = getRuler(contentWpx);
        atoms.forEach(a => { if (a.step === null) measureInto(rulerFull, a); });

        // atomy uvnitř kroku mají menší šířku (odsazení), měříme je zvlášť
        const rulerStep = getRuler(stepWpx);
        atoms.forEach(a => { if (a.step !== null) measureInto(rulerStep, a); });
        rulerStep.innerHTML = "";

        const gap = mm(MM.stepGap);
        const pages = [];
        let current = [];
        let used = 0;
        let lastStep = undefined;

        for (let i = 0; i < atoms.length; i++) {
            const atom = atoms[i];
            const glued = atom.keepWithNext ? atoms[i + 1] : null;
            let extra = (current.length && atom.step !== lastStep) ? gap : 0;
            // spodní mezera posledního bloku na stránce se nikam nepromítne, neúčtujeme ji
            const trailing = (glued ? glued.mb : atom.mb) || 0;
            let need = extra + atom.h + (glued ? glued.h : 0) - trailing;

            if (current.length && used + need > capacityPx) {
                pages.push(current);
                current = [];
                used = 0;
                lastStep = undefined;
                extra = 0;
            }
            current.push(atom);
            used += extra + atom.h;
            lastStep = atom.step;
        }
        if (current.length) pages.push(current);
        return pages.length ? pages : [[]];
    }

    /* --------------------------------------------------------- vykreslení */

    function pageBodyHtml(atoms, continuesStep) {
        let html = "";
        let openStep = undefined;
        atoms.forEach(atom => {
            if (atom.step !== openStep) {
                if (openStep !== undefined) html += "</div>";
                if (atom.step === null) {
                    openStep = null;
                    html += '<div class="doc-headwrap">';
                } else {
                    openStep = atom.step;
                    html += '<div class="doc-step">';
                    if (atom.step === continuesStep && atom.html.indexOf("doc-step-title") === -1) {
                        html += '<div class="doc-cont">… pokračování</div>';
                    }
                }
            }
            html += atom.html;
        });
        if (openStep !== undefined) html += "</div>";
        return html;
    }

    /**
     * Vysází návod do containeru jako sadu A4 stránek.
     * @param {HTMLElement} container – prvek s třídou .a4-stage
     * @param {Object} guide – { title, desc, category, cat, subcat, version, author, steps }
     * @param {Object} imageMap – { imageId: dataUrl }
     */
    function render(container, guide, imageMap) {
        if (!pxPerMm || pxPerMm === 3.7795275591) calibrate();
        imageMap = imageMap || {};

        const contentW = mm(MM.pageW - 2 * MM.padX);
        const stepW = contentW - mm(MM.stepIndent);
        const capacity = mm(MM.pageH - MM.padTop - MM.footH);

        const pages = paginate(buildAtoms(guide, imageMap), capacity, contentW, stepW);

        container.innerHTML = pages.map((atoms, index) => {
            const previous = index > 0 ? pages[index - 1] : null;
            const continuesStep = previous ? previous[previous.length - 1].step : undefined;
            return '<div class="a4-page">' +
                '<img class="a4-watermark" src="Pasport_Kana_gray.png" alt="">' +
                '<div class="a4-body">' + pageBodyHtml(atoms, continuesStep) + "</div>" +
                footHtml(guide, index + 1, pages.length) +
                "</div>";
        }).join("");

        container.dataset.pageCount = pages.length;
        return pages.length;
    }

    /* ------------------------------------------------------ zvětšení obrázku */

    /* Prohlížeč: galerie (šipky, klávesy ← →, přejetí prstem, počitadlo) a
       přiblížení (kolečko k bodu kurzoru, dvojklik / dvojí ťuknutí, dva prsty,
       tlačítka − 1:1 +). Přiblížený obrázek se posouvá tažením – přejetí se
       pak nebere jako další fotka. */
    const LUPA_MAX = 8, LUPA_DVOJ = 2.5;
    const lb = { obrazky: [], index: 0, s: 1, x: 0, y: 0, predtim: null };
    const lbBox = () => document.getElementById("kbLightbox");
    const lbObr = () => lbBox().querySelector("img");
    const stredOkna = () => { const r = lbBox().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    // kolikrát je obrázek ve skutečné velikosti větší než přizpůsobený oknu
    const lbSkutecna = () => { const img = lbObr(); return img.offsetWidth ? img.naturalWidth / img.offsetWidth : 0; };

    /** Posun nepustí obrázek dál, než kam sahá jeho okraj (obrázek je na středu okna). */
    function lbOmez() {
        const box = lbBox(), img = lbObr();
        if (lb.s < 1.01) { lb.s = 1; lb.x = 0; lb.y = 0; return; }
        const mx = Math.max(0, (img.offsetWidth * lb.s - box.clientWidth) / 2);
        const my = Math.max(0, (img.offsetHeight * lb.s - box.clientHeight) / 2);
        lb.x = Math.min(mx, Math.max(-mx, lb.x));
        lb.y = Math.min(my, Math.max(-my, lb.y));
    }

    function lbUkaz() {
        const box = lbBox(), n = lb.obrazky.length;
        lbObr().style.transform = lb.s === 1 ? "" : "translate(" + lb.x + "px," + lb.y + "px) scale(" + lb.s + ")";
        box.classList.toggle("lightbox--blizko", lb.s > 1);
        box.classList.toggle("lightbox--galerie", n > 1);
        box.querySelector(".lightbox__pocet").textContent = n > 1 ? (lb.index + 1) + " / " + n : "";
        box.querySelector('[data-krok="-1"]').disabled = lb.index <= 0;
        box.querySelector('[data-krok="1"]').disabled = lb.index >= n - 1;
        box.querySelector('[data-lupa="-"]').disabled = lb.s === 1;
        box.querySelector('[data-lupa="+"]').disabled = lb.s >= LUPA_MAX;
        const jedna = box.querySelector('[data-lupa="1"]');
        jedna.textContent = lb.s > 1 ? "Celý" : "1:1";
        jedna.title = lb.s > 1 ? "Zpět na celý obrázek" : "Skutečná velikost (1:1)";
        // obrázek menší než okno už ve skutečné velikosti je
        jedna.disabled = lb.s === 1 && lbSkutecna() < 1.05;
    }

    /** Přiblíží na měřítko s; bod (px, py) na obrazovce zůstane pod kurzorem / prsty. */
    function lbPribliz(s, px, py) {
        const c = stredOkna();
        if (px === undefined) { px = c.x; py = c.y; }
        s = Math.min(LUPA_MAX, Math.max(1, s));
        lb.x = px - c.x - (s / lb.s) * (px - c.x - lb.x);
        lb.y = py - c.y - (s / lb.s) * (py - c.y - lb.y);
        lb.s = s;
        lbOmez();
        lbUkaz();
    }
    const lbPrepni = (px, py) => (lb.s > 1 ? lbPribliz(1) : lbPribliz(LUPA_DVOJ, px, py));

    function lbNastav(i) {
        lb.index = Math.max(0, Math.min(lb.obrazky.length - 1, i));
        lb.s = 1; lb.x = 0; lb.y = 0;
        lbObr().src = lb.obrazky[lb.index];
        lbUkaz();
    }
    const lbPosun = (krok) => { const i = lb.index + krok; if (i >= 0 && i < lb.obrazky.length) lbNastav(i); };

    function ensureLightbox() {
        let box = lbBox();
        if (box) return box;
        box = document.createElement("div");
        box.id = "kbLightbox";
        box.className = "lightbox no-print";
        box.tabIndex = -1;
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");
        box.setAttribute("aria-label", "Prohlížeč obrázků");
        // obrázek první: přiblížený (transform) se pak kreslí pod ovládáním
        box.innerHTML = '<img alt="" draggable="false">' +
            '<button class="lightbox__close" aria-label="Zavřít">&times;</button>' +
            '<div class="lightbox__pocet" aria-live="polite"></div>' +
            '<div class="lightbox__lupa">' +
                '<button type="button" data-lupa="-" aria-label="Oddálit" title="Oddálit">&minus;</button>' +
                '<button type="button" data-lupa="1">1:1</button>' +
                '<button type="button" data-lupa="+" aria-label="Přiblížit" title="Přiblížit">+</button>' +
            "</div>" +
            '<button type="button" class="lightbox__sipka lightbox__sipka--l" data-krok="-1" aria-label="Předchozí obrázek">&#8249;</button>' +
            '<button type="button" class="lightbox__sipka lightbox__sipka--p" data-krok="1" aria-label="Další obrázek">&#8250;</button>' +
            '<div class="lightbox__cap"></div>';
        document.body.appendChild(box);

        const close = () => {
            if (!box.classList.contains("is-open")) return;
            box.classList.remove("is-open");
            const kam = lb.predtim;
            lb.predtim = null;
            if (kam && kam.focus && document.contains(kam)) { try { kam.focus({ preventScroll: true }); } catch (e) { /* nic */ } }
        };

        /* Prsty a myš přes Pointer Events: jeden = posun (přiblížený) nebo
           přejetí (celý), dva = přiblížení. `tah` = pohyb nebyl klik. */
        const prsty = new Map();
        let gesto = null, tah = false, typ = "", tuk = { t: 0, x: 0, y: 0 };
        const vzdal = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const stred = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const zacni = () => {
            const p = Array.from(prsty.values());
            const poDvou = !!gesto && (gesto.dva || gesto.poDvou);
            if (p.length >= 2) {
                gesto = { dva: true, d0: vzdal(p[0], p[1]) || 1, m0: stred(p[0], p[1]), s0: lb.s, x0: lb.x, y0: lb.y };
                tah = true;
            } else if (p.length === 1) {
                // zbylý prst po stisknutí dvěma pokračuje v posunu bez skoku
                gesto = { dva: false, a: p[0], x0: lb.x, y0: lb.y, poDvou: poDvou };
            } else gesto = null;
        };

        box.addEventListener("pointerdown", (e) => {
            typ = e.pointerType;
            if (!prsty.size) tah = false;
            if (e.target.closest("button") || (e.pointerType === "mouse" && e.button !== 0)) return;
            prsty.set(e.pointerId, { x: e.clientX, y: e.clientY });
            zacni();
        });
        box.addEventListener("pointermove", (e) => {
            if (!gesto || !prsty.has(e.pointerId)) return;
            prsty.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const p = Array.from(prsty.values());
            if (gesto.dva && p.length >= 2) {
                const m = stred(p[0], p[1]), c = stredOkna();
                const s = Math.min(LUPA_MAX, Math.max(1, gesto.s0 * vzdal(p[0], p[1]) / gesto.d0));
                // bod, který byl na začátku pod prsty, zůstane pod nimi
                lb.x = m.x - c.x - (s / gesto.s0) * (gesto.m0.x - c.x - gesto.x0);
                lb.y = m.y - c.y - (s / gesto.s0) * (gesto.m0.y - c.y - gesto.y0);
                lb.s = s;
                lbOmez();
                lbUkaz();
            } else if (!gesto.dva) {
                const dx = e.clientX - gesto.a.x, dy = e.clientY - gesto.a.y;
                if (!tah && Math.abs(dx) + Math.abs(dy) > 8) {
                    tah = true;
                    // zachytit až při tažení – jinak by klik na obrázek mířil na pozadí a zavřel prohlížeč
                    try { box.setPointerCapture(e.pointerId); } catch (err) { /* nic */ }
                }
                if (tah && lb.s > 1) { lb.x = gesto.x0 + dx; lb.y = gesto.y0 + dy; lbOmez(); lbUkaz(); }
            }
        });
        const konec = (e) => {
            if (!prsty.has(e.pointerId)) return;
            const g = gesto;
            prsty.delete(e.pointerId);
            if (g && !g.dva && e.type === "pointerup") {
                const dx = e.clientX - g.a.x, dy = e.clientY - g.a.y;
                if (tah && !g.poDvou && lb.s === 1 && Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
                    lbPosun(dx < 0 ? 1 : -1);
                } else if (!tah && typ !== "mouse" && e.target.tagName === "IMG") {
                    // dvojí ťuknutí (myš má vlastní dblclick)
                    const ted = Date.now();
                    if (ted - tuk.t < 350 && Math.abs(e.clientX - tuk.x) < 30 && Math.abs(e.clientY - tuk.y) < 30) {
                        lbPrepni(e.clientX, e.clientY);
                        tuk.t = 0;
                    } else tuk = { t: ted, x: e.clientX, y: e.clientY };
                }
            }
            zacni();
        };
        box.addEventListener("pointerup", konec);
        box.addEventListener("pointercancel", konec);
        box.addEventListener("dblclick", (e) => { if (typ === "mouse" && e.target.tagName === "IMG") lbPrepni(e.clientX, e.clientY); });
        box.addEventListener("wheel", (e) => {
            e.preventDefault();     // jinak by rolovala stránka pod prohlížečem
            const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            lbPribliz(lb.s * Math.min(2, Math.max(0.5, Math.exp(-dy * 0.002))), e.clientX, e.clientY);
        }, { passive: false });
        lbObr().addEventListener("load", lbUkaz);     // 1:1 jde určit až s rozměry obrázku

        box.addEventListener("click", (e) => {
            if (tah) { tah = false; return; }         // konec tažení není klik
            const b = e.target.closest("button");
            if (e.target === box || (b && b.classList.contains("lightbox__close"))) return close();
            if (!b) return;
            if (b.dataset.krok) lbPosun(Number(b.dataset.krok));
            else if (b.dataset.lupa === "+") lbPribliz(lb.s * 1.5);
            else if (b.dataset.lupa === "-") lbPribliz(lb.s / 1.5);
            else if (b.dataset.lupa === "1") lbPribliz(lb.s > 1 ? 1 : lbSkutecna());
        });
        document.addEventListener("keydown", (e) => {
            if (!box.classList.contains("is-open")) return;
            if (e.key === "Escape") close();
            else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                lbPosun(e.key === "ArrowLeft" ? -1 : 1);
            }
        });
        window.addEventListener("resize", () => { if (box.classList.contains("is-open")) { lbOmez(); lbUkaz(); } });
        return box;
    }

    /**
     * Otevře prohlížeč. Staré volání openImage(src, popisek) ukáže jeden obrázek;
     * galerie: openImage(src, popisek, { obrazky: [src…], index }).
     */
    function openImage(src, caption, volby) {
        const box = ensureLightbox();
        const seznam = volby && Array.isArray(volby.obrazky) && volby.obrazky.length ? volby.obrazky.slice() : [src];
        const i = volby && volby.index !== undefined ? Number(volby.index) || 0 : Math.max(0, seznam.indexOf(src));
        lb.obrazky = seznam;
        box.querySelector(".lightbox__cap").textContent = caption || "";
        if (!box.classList.contains("is-open")) lb.predtim = document.activeElement;
        box.classList.add("is-open");
        lbNastav(i);
        try { box.focus({ preventScroll: true }); } catch (e) { /* nic */ }
    }

    /**
     * Zapne klikání na odkazy [obr N] i na samotné obrázky uvnitř dokumentu.
     * `images` může být mapa, nebo funkce vracející mapu (když se za běhu mění).
     */
    function enableImageZoom(container, images) {
        const map = () => (typeof images === "function" ? images() : images) || {};
        container.addEventListener("click", (event) => {
            const ref = event.target.closest(".doc-ref");
            if (ref) {
                const src = map()[ref.dataset.img];
                if (src) openImage(src, ref.textContent);
                return;
            }
            const img = event.target.closest(".doc-fig img");
            if (img) {
                const caption = img.closest("figure").querySelector("figcaption");
                openImage(img.src, caption ? caption.textContent : "");
            }
        });
    }

    /* ------------------------------------------------------------- export */

    /** Přizpůsobí měřítko náhledu šířce okna (aby se A4 vešla na obrazovku). */
    function fitStage(stage, wrapper) {
        const available = wrapper.clientWidth - 24;
        const natural = mm(MM.pageW);
        // schovaný nebo nulový kontejner by dal záporné měřítko a náhled by zmizel
        const scale = available > 40 ? Math.min(1, available / natural) : 1;
        stage.style.transform = "scale(" + scale + ")";
        // po zmenšení zůstává původní výška – korigujeme spodní mezerou
        const pages = stage.children.length || 1;
        const naturalH = pages * mm(MM.pageH) + (pages - 1) * mm(8);
        wrapper.style.height = (naturalH * scale + 20) + "px";
    }

    /**
     * Hlídá skutečnou šířku kontejneru a při každé změně přepočítá měřítko.
     * Řeší i případy, kdy událost resize nestačí – otočení iPadu, sbalení
     * panelu, doběhnutí layoutu po načtení písem.
     */
    function watchFit(wrapper, handler) {
        let lastWidth = -1;

        const check = () => {
            const width = wrapper.clientWidth;
            if (Math.abs(width - lastWidth) < 2) return;   // ignoruj změny výšky
            lastWidth = width;
            handler();
        };

        // Dvě nezávislé cesty schválně: ResizeObserver zachytí i změny, které
        // nesouvisí s oknem (sbalení panelu), a posluchače na okně fungují
        // i tam, kde observer nedostane snímek k vykreslení.
        if (typeof ResizeObserver !== "undefined") new ResizeObserver(check).observe(wrapper);
        window.addEventListener("resize", check);
        window.addEventListener("orientationchange", () => setTimeout(check, 250));
        window.addEventListener("load", check);
    }

    async function exportPdf(stage, filename) {
        if (!window.html2canvas || !window.jspdf) throw new Error("Chybí knihovny pro PDF.");
        const { jsPDF } = window.jspdf;

        // vypneme zmenšení náhledu, jinak by se PDF vyrenderovalo rozmazaně
        const savedTransform = stage.style.transform;
        stage.style.transform = "none";

        try {
            const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
            const pages = Array.from(stage.querySelectorAll(".a4-page"));

            for (let i = 0; i < pages.length; i++) {
                const canvas = await window.html2canvas(pages[i], {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: "#ffffff",
                    logging: false,
                    windowWidth: pages[i].scrollWidth,
                    windowHeight: pages[i].scrollHeight
                });
                const data = canvas.toDataURL("image/jpeg", 0.92);
                if (i > 0) pdf.addPage();
                pdf.addImage(data, "JPEG", 0, 0, MM.pageW, MM.pageH, undefined, "FAST");
            }
            pdf.save((filename || "Navod").replace(/[\\/:*?"<>|]/g, "_") + ".pdf");
        } finally {
            stage.style.transform = savedTransform;
        }
    }

    window.KBDoc = { render, exportPdf, fitStage, watchFit, enableImageZoom, openImage, esc, MM };
})();
