/* ==========================================================================
   Info k zakázkám – přiřazení poznámky k zakázce podle textu
   (Michal 12. 11. 2026, Iris).

   Poznámka z terénu (napsaná na webu nebo nadiktovaná zkratkou v telefonu)
   se sama přiřadí k zakázce, když text zmíní její zkratku, číslo, celý název
   nebo slovo z názvu, které žádná jiná otevřená zakázka nemá. Když si web
   není jistý (nic, nebo dvě zakázky se stejným skóre), zůstane „Nezařazeno“
   a člověk ji přiřadí sám – špatné přiřazení by poznámku schovalo lidem,
   kterým nepatří.

   Apps Script (gas\Kod.gs, najdiZakazku_) počítá STEJNĚ – při změně upravit
   i tam. Modul je bez závislostí, aby šel pustit v Node
   (testy\test_infozakazky_prirazeni.js); proto vlastní fold, ne KBUI.fold.
   ========================================================================== */

(function () {
    "use strict";

    // obecná slova z názvů zakázek – zakázku nerozliší, i když je jinde nemá
    const STOP = ["pasport", "pasportizace", "budova", "budovy", "budov", "objekt", "objektu", "objekty",
        "projekt", "projektu", "stavba", "stavby", "dokumentace", "zamereni", "rekonstrukce", "sken", "skeny"];

    /** Malá písmena bez diakritiky, mimo a–z0–9 mezera, slité mezery. */
    function fold(s) {
        return String(s === undefined || s === null ? "" : s).toLowerCase().normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    /** Výrazná slova názvu: aspoň 4 znaky, mimo STOP, bez opakování. */
    function slovaNazvu(nazev) {
        const ven = [];
        fold(nazev).split(" ").forEach(t => {
            if (t.length >= 4 && STOP.indexOf(t) === -1 && ven.indexOf(t) === -1) ven.push(t);
        });
        return ven;
    }

    /**
     * Zakázka, ke které text patří: `{ id, nazev, lide }`, nebo null.
     * `projekty` = hlavičky projektů ({ id, nazev, zkratka, cislo, lide, uzavreno }).
     */
    function najdiZakazku(text, projekty) {
        const foldText = fold(text);
        if (!foldText) return null;
        const tokeny = foldText.split(" ");
        const sMezerami = " " + foldText + " ";
        const otevrene = (Array.isArray(projekty) ? projekty : []).filter(p => p && p.uzavreno !== true);
        const slova = otevrene.map(p => slovaNazvu(p.nazev));

        let nejvys = 0, vitezove = [];
        otevrene.forEach((p, i) => {
            let skore = 0;
            const zkratka = fold(p.zkratka);
            if (zkratka.length >= 2 && tokeny.indexOf(zkratka) !== -1) skore += 3;
            const cislo = fold(p.cislo);
            if (cislo && sMezerami.indexOf(" " + cislo + " ") !== -1) skore += 3;
            const nazev = fold(p.nazev);
            if (nazev && sMezerami.indexOf(" " + nazev + " ") !== -1) skore += 3;
            slova[i].forEach(s => {
                if (tokeny.indexOf(s) === -1) return;
                if (slova.some((jina, j) => j !== i && jina.indexOf(s) !== -1)) return;
                skore += 1;
            });
            if (skore > nejvys) { nejvys = skore; vitezove = [p]; }
            else if (skore === nejvys && skore > 0) vitezove.push(p);
        });
        if (nejvys < 1 || vitezove.length !== 1) return null;
        const v = vitezove[0];
        return { id: v.id, nazev: v.nazev || "", lide: Array.isArray(v.lide) ? v.lide.slice() : [] };
    }

    window.KBINFO = { fold: fold, najdiZakazku: najdiZakazku, STOP: STOP };
})();
