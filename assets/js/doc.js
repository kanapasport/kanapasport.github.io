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
        .replace(/"/g, "&quot;");

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
        const imagesByStep = steps.map(step => (step.images || []).filter(img => imageMap[img.id]));

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
                    html: '<figure class="doc-fig doc-fig--' + (img.size || "m") + '">' +
                          '<img src="' + imageMap[img.id] + '" data-img="' + img.id + '" alt="' + esc(img.caption || caption) + '">' +
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

    function ensureLightbox() {
        let box = document.getElementById("kbLightbox");
        if (box) return box;
        box = document.createElement("div");
        box.id = "kbLightbox";
        box.className = "lightbox no-print";
        box.innerHTML = '<button class="lightbox__close" aria-label="Zavřít">&times;</button>' +
                        '<img alt=""><div class="lightbox__cap"></div>';
        document.body.appendChild(box);
        const close = () => box.classList.remove("is-open");
        box.addEventListener("click", (e) => { if (e.target === box || e.target.classList.contains("lightbox__close")) close(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
        return box;
    }

    function openImage(src, caption) {
        const box = ensureLightbox();
        box.querySelector("img").src = src;
        box.querySelector(".lightbox__cap").textContent = caption || "";
        box.classList.add("is-open");
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
        const scale = Math.min(1, available / natural);
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
