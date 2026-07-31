/* ==========================================================================
   Struktura firemního webu – JEDINÉ místo, kde se definují sekce a kategorie.
   Když budeš chtít přidat/přejmenovat kategorii, uprav jen tenhle soubor;
   rozcestník, filtry i editor se přizpůsobí samy.
   ========================================================================== */

window.KB_ICONS = {
    map:      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>',
    cpu:      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/>',
    scan:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2m8-16h2a2 2 0 012 2v2m-4 12h2a2 2 0 002-2v-2M4 12h16"/>',
    building: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>',
    plus:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    sparkles: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>',
    download: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>',
    library:  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>',
    lock:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>',
    users:    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>',
    shield:   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>',
    search:   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>'
};

/* Kategorie návodů. `id` se ukládá do databáze jako pole `cat` / `subcat`. */
window.KB_CATEGORIES = [
    {
        id: 'pasportizace',
        title: 'PASPORTIZAČNÍ POSTUPY',
        sub: 'ArcGIS Pro · pracovní postupy',
        icon: 'map',
        accent: '#6366f1',
        children: [
            { id: 'sln',      title: 'SLN' },
            { id: 'steny',    title: 'STĚNY' },
            { id: 'chlazeni', title: 'CHLAZENÍ' },
            { id: 'profese',  title: 'Ostatní profese' }
        ]
    },
    {
        id: 'programy',
        title: 'PROGRAMY',
        sub: 'ArcGIS · Revit · AutoCAD · ArchLine',
        icon: 'cpu',
        accent: '#0ea5e9',
        children: [
            { id: 'arcgis-nastaveni', title: 'ArcGIS – základní nastavení' },
            { id: 'arcgis-funkce',    title: 'ArcGIS – funkcionalita' },
            { id: 'arcgis-skripty',   title: 'ArcGIS – skripty' },
            { id: 'revit',            title: 'Revit' },
            { id: 'autocad-priprava', title: 'AutoCAD – příprava dat pro ArcGIS' },
            { id: 'autocad-zkratky',  title: 'AutoCAD – zkratky a rychlá práce' },
            { id: 'archline',         title: 'ArchLine' }
        ]
    },
    {
        id: 'skenovani',
        title: 'SKENOVÁNÍ',
        sub: 'Sběr dat v terénu, mračna bodů',
        icon: 'scan',
        accent: '#10b981',
        children: [
            { id: 'skener-obsluha', title: 'Obsluha skeneru' },
            { id: 'skener-data',    title: 'Zpracování dat' }
        ]
    },
    {
        id: 'pasporty',
        title: 'PASPORTY BARÁKŮ',
        sub: 'Výstupy, zprávy a výkresy',
        icon: 'building',
        accent: '#f59e0b',
        children: [
            { id: 'zpravy',  title: 'Tvorba zpráv' },
            { id: 'vykresy', title: 'Tvorba výkresů' },
            { id: 'vizual',  title: 'Vizuál výkresů' }
        ]
    }
];

/* Sekce rozcestníku na hlavní stránce. */
window.KB_SECTIONS = [
    {
        id: 'navody',
        title: 'Návody',
        desc: 'Pracovní postupy rozdělené podle oblasti',
        tiles: window.KB_CATEGORIES.map(c => ({
            title: c.title,
            sub: c.sub,
            icon: c.icon,
            accent: c.accent,
            href: 'navody.html?kat=' + c.id,
            cat: c.id,
            children: c.children
        }))
    },
    {
        id: 'tvorba',
        title: 'Tvorba a nástroje',
        desc: 'Jak dostat nový návod do databáze',
        tiles: [
            { title: 'NOVÝ NÁVOD',      sub: 'Editor s živým náhledem A4 a obrázky', icon: 'plus',     accent: '#6366f1', href: 'editor.html' },
            { title: 'POKYN PRO AI',    sub: 'Zkopíruje prompt pro Gemini / Claude', icon: 'sparkles', accent: '#a855f7', action: 'ai-prompt' },
            { title: 'IMPORT OD AI',    sub: 'Vložit hotový JSON a uložit',          icon: 'download', accent: '#a855f7', href: 'editor.html#import' },
            { title: 'VŠECHNY NÁVODY',  sub: 'Kompletní databáze s vyhledáváním',    icon: 'library',  accent: '#64748b', href: 'navody.html' }
        ]
    },
    {
        id: 'pripravujeme',
        title: 'Připravujeme',
        desc: 'Zprovozníme, až bude obsah hotový',
        tiles: [
            { title: 'PŘIHLAŠOVÁNÍ',    sub: 'Účet a heslo vygeneruje správce',      icon: 'lock',   soon: true },
            { title: 'SPRÁVA UŽIVATELŮ',sub: 'Přehled, kdo a kdy se přihlásil',      icon: 'users',  soon: true },
            { title: 'OCHRANA DAT',     sub: 'Vodoznak, omezené stahování PDF',      icon: 'shield', soon: true }
        ]
    }
];

/* ---------------------------------------------------------------- pomocné */

window.KB_findCategory = (id) => window.KB_CATEGORIES.find(c => c.id === id) || null;

window.KB_findSub = (catId, subId) => {
    const cat = window.KB_findCategory(catId);
    if (!cat) return null;
    return (cat.children || []).find(s => s.id === subId) || null;
};

/* Popisek kategorie pro zobrazení – funguje i pro staré návody,
   které mají jen volný text v poli `category`. */
window.KB_categoryLabel = (guide) => {
    const cat = window.KB_findCategory(guide.cat);
    if (!cat) return guide.category || 'Nezařazeno';
    const sub = window.KB_findSub(guide.cat, guide.subcat);
    return sub ? cat.title + ' · ' + sub.title : cat.title;
};
