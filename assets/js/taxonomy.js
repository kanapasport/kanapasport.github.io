/* ==========================================================================
   Struktura firemního webu – JEDINÉ místo, kde se definují sekce a kategorie.
   Když budeš chtít přidat/přejmenovat kategorii, uprav jen tenhle soubor;
   rozcestník, horní lišta i filtry se přizpůsobí samy.

   Kategorie mají až tři úrovně:
       kategorie  ->  skupina (např. program)  ->  téma
   U návodu se do databáze ukládá `cat` (kategorie) a `subcat` (nejnižší
   zvolená úroveň).
   ========================================================================== */

window.KB_ICONS = {
    map:      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>',
    cpu:      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/>',
    scan:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2m8-16h2a2 2 0 012 2v2m-4 12h2a2 2 0 002-2v-2M4 12h16"/>',
    building: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>',
    code:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>',
    tasks:    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>',
    plus:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    sparkles: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>',
    download: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>',
    library:  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>',
    lock:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>',
    users:    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>',
    shield:   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>',
    search:   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>',
    home:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>',
    palette:  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/>',
    board:    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h18v11H3zM12 16v4m-4 0h8M8 9l2.5 2.5L15 7"/>'
};

/* ------------------------------------------------------------- kategorie ---
   `main` = téma toho nejdůležitějšího návodu kategorie. Ten se na stránce
   návodů otevře rovnou v náhledu, když se kategorie jen rozklikne. */

window.KB_CATEGORIES = [
    {
        id: 'skripty',
        title: 'SKRIPTY',
        sub: 'Naše nástroje v ArcGIS Pro a tvorba nových',
        icon: 'code',
        main: 'skript-ai',
        children: [
            {
                id: 'skripty-obecne', title: 'OBECNÉ', children: [
                    { id: 'skript-instalace',  title: 'Instalace a spouštění' },
                    { id: 'skript-body',       title: 'Body v polygonu' },
                    { id: 'skript-cistic',     title: 'Čistič polygonů' },
                    { id: 'skript-ftp',        title: 'FeatureToPolygon Upgrade' },
                    { id: 'skript-kopie',      title: 'Kopie polygonů' },
                    { id: 'skript-symbolika',  title: 'Hromadná symbolika' },
                    { id: 'skript-ai',         title: 'Jak si nechat skript napsat od AI' }
                ]
            },
            {
                id: 'skripty-stavba', title: 'STAVBA', children: [
                    { id: 'skript-mistnosti', title: 'Generování místností' },
                    { id: 'skript-dvere',     title: 'Dveře – automatizace' },
                    { id: 'skript-plocha',    title: 'Zápis plochy a obvodu' }
                ]
            },
            {
                id: 'skripty-technologie', title: 'TECHNOLOGIE', children: [
                    { id: 'skript-kontrola', title: 'Kontrola polohových kódů' },
                    { id: 'skript-atributy', title: 'Hromadný zápis atributů' }
                ]
            }
        ]
    },
    {
        id: 'pasportizace',
        title: 'PASPORTIZAČNÍ POSTUPY',
        sub: 'Pracovní postupy u jednotlivých profesí',
        icon: 'map',
        children: [
            { id: 'sln',      title: 'SLN' },
            { id: 'steny',    title: 'STĚNY' },
            { id: 'chlazeni', title: 'CHLAZENÍ' },
            { id: 'profese',  title: 'OSTATNÍ PROFESE' }
        ]
    },
    {
        id: 'programy',
        title: 'PROGRAMY',
        sub: 'Ovládání softwaru, který denně používáme',
        icon: 'cpu',
        children: [
            {
                id: 'arcgis', title: 'ArcGIS', children: [
                    { id: 'arcgis-nastaveni', title: 'Základní nastavení' },
                    { id: 'arcgis-funkce',    title: 'Základní funkcionalita' },
                    { id: 'arcgis-data',      title: 'Práce s daty' },
                    { id: 'arcgis-vykresy',   title: 'Výkresy a tisk' }
                ]
            },
            {
                id: 'autocad', title: 'AutoCAD', children: [
                    { id: 'autocad-priprava', title: 'Příprava dat pro ArcGIS' },
                    { id: 'autocad-zkratky',  title: 'Zkratky a rychlá práce' }
                ]
            },
            {
                id: 'revit', title: 'Revit', children: [
                    { id: 'revit-export', title: 'Export do ArcGIS' },
                    { id: 'revit-zaklady', title: 'Základy ovládání' }
                ]
            },
            { id: 'archicad', title: 'ArchiCAD' },
            { id: 'archline',  title: 'ArchLine' }
        ]
    },
    {
        id: 'skenovani',
        title: 'SKENOVÁNÍ',
        sub: 'Sběr dat v terénu a mračna bodů',
        icon: 'scan',
        children: [
            { id: 'skener-obsluha', title: 'OBSLUHA SKENERU' },
            { id: 'skener-data',    title: 'ZPRACOVÁNÍ DAT' }
        ]
    },
    {
        id: 'pasporty',
        title: 'PASPORTIZACE DOMŮ',
        sub: 'Výstupy, zprávy a výkresy',
        icon: 'building',
        children: [
            { id: 'zpravy',  title: 'TVORBA ZPRÁV' },
            { id: 'vykresy', title: 'TVORBA VÝKRESŮ' },
            { id: 'vizual',  title: 'VIZUÁL VÝKRESŮ' }
        ]
    }
];

/* ---------------------------------------------------------------- sekce */

window.KB_SECTIONS = [
    {
        id: 'navody',
        title: 'Všechny návody',
        href: 'navody.html',
        icon: 'library',
        desc: 'Klikni na dlaždici a dostaneš se na výpis návodů dané oblasti.',
        tiles: window.KB_CATEGORIES.map(category => ({
            title: category.title,
            sub: category.sub,
            icon: category.icon,
            href: 'navody.html?kat=' + category.id,
            cat: category.id,
            children: category.children
        }))
    }
];

/* ------------------------------------------------------ horní navigace ---
   V liště jsou jen dvě položky a jsou vycentrované. Roletka u NÁVODŮ je
   svislý seznam kategorií – rozbalí se až najetím myší na řádek. */

window.KB_NAV = [
    { title: 'DOMŮ', href: 'index.html', icon: 'home' },
    {
        title: 'NÁVODY', href: 'navody.html',
        menu: [{ title: 'VŠECHNY NÁVODY', href: 'navody.html' }].concat(
            window.KB_CATEGORIES.map(category => ({
                title: category.title,
                href: 'navody.html?kat=' + category.id,
                children: [{ title: 'Vše v sekci', href: 'navody.html?kat=' + category.id }].concat(
                    (category.children || []).map(child => ({
                        title: child.title,
                        href: 'navody.html?kat=' + category.id + '&sub=' + child.id
                    })))
            })))
    },
    // roletka se naplní zakázkami z databáze (viz taskMenu v ui.js)
    { title: 'ÚKOLOVNÍK', href: 'ukoly.html', tasks: true },
    { title: 'TABULE', href: 'tabule.html', icon: 'board' }
];

/* ------------------------------------------------- nástroje (ikony) -----
   Vpravo nad lištou. Vidět je jen ikona, po najetí myší se rozbalí popis. */

window.KB_TOOLS = [
    { title: 'Nový návod',     icon: 'plus',     href: 'editor.html' },
    { title: 'Pokyn pro AI',   icon: 'sparkles', action: 'ai-prompt' },
    { title: 'Import od AI',   icon: 'download', href: 'editor.html#import' },
    { title: 'Všechny návody', icon: 'library',  href: 'navody.html' },
    // jen pro hlavního správce – `need` řídí, komu se ikona vůbec ukáže
    { title: 'Uživatelé',   icon: 'users',   href: 'uzivatele.html', need: 'users.manage' },
    { title: 'Barvy webu',  icon: 'palette', href: 'barvy.html',     need: 'web.design' }
];

/* --------------------------------------------------------------- pomocné */

window.KB_findCategory = (id) => window.KB_CATEGORIES.find(c => c.id === id) || null;

/** Najde uzel kdekoliv ve stromu kategorie a vrátí i cestu k němu. */
window.KB_findNode = (catId, nodeId) => {
    const category = window.KB_findCategory(catId);
    if (!category || !nodeId) return null;

    const walk = (nodes, path) => {
        for (const node of nodes || []) {
            const next = path.concat([node]);
            if (node.id === nodeId) return { node: node, path: next };
            const found = walk(node.children, next);
            if (found) return found;
        }
        return null;
    };
    return walk(category.children, []);
};

/** Zpětně kompatibilní hledání podkategorie (jen název uzlu). */
window.KB_findSub = (catId, subId) => {
    const hit = window.KB_findNode(catId, subId);
    return hit ? hit.node : null;
};

/** Vrátí všechna id uzlu i jeho potomků – pro filtrování skupin (programů). */
window.KB_descendantIds = (catId, nodeId) => {
    const hit = window.KB_findNode(catId, nodeId);
    if (!hit) return [];
    const ids = [];
    const walk = (node) => {
        ids.push(node.id);
        (node.children || []).forEach(walk);
    };
    walk(hit.node);
    return ids;
};

/** Popisek kategorie pro zobrazení – funguje i pro staré návody s volným textem. */
window.KB_categoryLabel = (guide) => {
    const category = window.KB_findCategory(guide.cat);
    if (!category) return guide.category || 'Nezařazeno';
    const hit = window.KB_findNode(guide.cat, guide.subcat);
    if (!hit) return category.title;
    return category.title + ' · ' + hit.path.map(n => n.title).join(' · ');
};
