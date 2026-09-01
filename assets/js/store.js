/* ==========================================================================
   Datová vrstva – Firebase Firestore.
   Zůstáváme u Firebase (funguje, je zdarma a umí živou synchronizaci),
   jen se přidalo ukládání obrázků do podkolekce, aby hlavní dokument
   návodu zůstal malý a seznam se načítal rychle.

   Struktura v databázi:
     artifacts/{APP_ID}/public/data/guides/{guideId}              ← text návodu
     artifacts/{APP_ID}/public/data/guides/{guideId}/images/{id}  ← obrázek (base64)
     artifacts/{APP_ID}/public/data/tasks/{taskId}                ← úkol ze zakázky
     artifacts/{APP_ID}/public/data/logs/{autoId}                 ← záznamy přihlášení

     artifacts/{APP_ID}/private/vykazy/zaznamy/{id}               ← odpracovaný čas
     artifacts/{APP_ID}/private/vykazy/castky/{id}                ← sazba a částka
     artifacts/{APP_ID}/private/vykazy/ciselniky/nastaveni        ← sazby, rozpočty

   Větev `private` je oddělená schválně: do `public/data` smí podle pravidel
   číst každý přihlášený člověk, a to se níž nedá odebrat.

   Uvnitř je čas oddělený od peněz, protože Firestore neumí schovat jednotlivé
   pole – kdo dokument přečte, přečte ho celý. Zaměstnanec tak uvidí svoje
   hodiny, ale ne to, za kolik se jeho hodina fakturuje. Oba dokumenty mají
   stejné `{id}` a spárují se při čtení.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth, initializeAuth, browserLocalPersistence, onAuthStateChanged,
    signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { initializeApp as initializeSecondaryApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth as getSecondaryAuth, createUserWithEmailAndPassword, signOut as signOutSecondary }
    from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, getDoc, getDocs, setDoc, deleteDoc, deleteField, increment, arrayUnion,
    onSnapshot, serverTimestamp, addDoc, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBlrTyni-oy4kEr08ZqDBXh6aHfTWtOkPA",
    authDomain: "pasportkana.firebaseapp.com",
    projectId: "pasportkana",
    storageBucket: "pasportkana.firebasestorage.app",
    messagingSenderId: "32112827839",
    appId: "1:32112827839:web:274eb41ec288261cec550a",
    measurementId: "G-RTDPV2B7LW"
};
const APP_ID = "firemni-kb-app";

/** Výchozí rozdělení úkolů uvnitř zakázky, dokud si ho nikdo neupraví. */
const DEFAULT_SKUPINY = ["ARCGIS", "SKENY", "FOCENÍ", "TABULKY"];

/* Druhy vypracování ve výkazu. Vychází ze skupin úkolů, ať se hodiny dají
   porovnat s tím, jak je rozdělená práce v Postupu práce, ale je tu navíc
   administrativa – ta se na zakázce odpracuje taky a někam patřit musí. */
const DEFAULT_CINNOSTI = ["ArcGIS/Kreslení", "Focení", "Skeny", "Tabulky", "Administrativa"];

/* Paušály k výkazu. Jsou to firemní čísla, ne tajemství – zaměstnanec si
   svoje stravné i kilometry spočítá sám, tak ať je vidí i ve formuláři. */
const OBED_KC = 200;      // placený oběd, když ho zápis obsahuje
const KM_KC = 5;          // cestovní náhrada za kilometr

/* Technologie – zkratky podle budgetového excelu zakázek (list
   s rozpadem na technologie). Na tyhle se dělá rozpočet, na ně se
   vykazují hodiny a podle nich stojí řádky matice plnění, takže musí být
   všude STEJNÉ – v úkolech, ve výkazu i v matici.

   Tenhle seznam je jen výchozí. Projekt si může nastavit vlastní
   (Správa → Údaje → Technologie) a ten má přednost.

   Prázdný `nazev` = celý název zatím neznáme; v roletce se pak ukáže
   samotná zkratka. */
const DEFAULT_TECHNOLOGIE = [
    /* Pořadí, zkratky i názvy podle katalogu vrstev GDB (Michal, 26. 8.
       2026). HAS a SHZ jsou od té doby JEDNA položka „HAS/SHZ" – v GDB
       je to jedna technologie a na dvě se dělila jen tady na webu.
       Zkratka je pořád to, co se ukládá do dat; název se jen ukazuje. */
    { zkratka: "STAVBA",  nazev: "" },
    { zkratka: "HRM",     nazev: "hromosvody" },
    { zkratka: "SLN",     nazev: "silnoproud" },
    { zkratka: "SLB",     nazev: "slaboproud" },
    { zkratka: "MAR",     nazev: "měření a regulace" },
    { zkratka: "ZAR",     nazev: "zařízení" },
    { zkratka: "VZT",     nazev: "vzduchotechnika" },
    { zkratka: "HAS/SHZ", nazev: "požární (hašení, EPS je v SLB)" },
    { zkratka: "PLYN",    nazev: "plyny" },
    { zkratka: "RLM",     nazev: "" },
    { zkratka: "TER",     nazev: "vytápění/teplo" },
    { zkratka: "CHLAD",   nazev: "chlazení" },
    { zkratka: "VODA",    nazev: "" },
    { zkratka: "KAN",     nazev: "kanalizace" },
];

const bus = new EventTarget();
const KB = {
    DEFAULT_SKUPINY: DEFAULT_SKUPINY,
    DEFAULT_CINNOSTI: DEFAULT_CINNOSTI,
    DEFAULT_TECHNOLOGIE: DEFAULT_TECHNOLOGIE,
    OBED_KC: OBED_KC,
    KM_KC: KM_KC,
    guides: [],
    tasks: [],
    zakazky: [],            // číselník zakázek – aby se překlepem nezakládaly nové
    zakazkyClosed: [],      // uzavřené zakázky (v dlaždici zelené)
    skupiny: DEFAULT_SKUPINY.slice(),   // skupiny úkolů uvnitř zakázky
    users: [],              // lidé, kteří mají na web přístup, a jejich role
    milniky: [],            // termíny odevzdání po činnostech
    boards: [],             // tabule na nápady – jen hlavičky, obsah se dotahuje zvlášť
    vykazy: [],             // zápisy práce – načtou se až na vyžádání
    firmy: [],              // komu se fakturuje (číselník u zakázek, není tajný)
    /* POZOR na názvosloví: navenek se „zakázce" říká projekt a „projektu"
       část. Vnitřní klíče se ale NEPŘEJMENOVÁVAJÍ – sedí na nich uložená
       data i pravidla databáze. `projekty` níž jsou tedy ČÁSTI projektu. */
    projekty: {},           // části projektu: { "Zakázka A": ["Etapa 1", "Etapa 2"] }
    firmaMap: {},           // projekt → firma, které se fakturuje (doplní se ve výkazu samo)
    firmyDetail: {},        // firma → { ico, kontakt, email, telefon, adresa, poznamka }
    budgetCiselnik: {},     // projekt → { budovy, patra } pro skládání úkolů
    projektyDocs: [],       // hlavičky projektů (private/projekty/seznam) – dle práv
    ukoly: [],              // úkoly s TO-DO rozpadem (private/ukoly/seznam) – dle práv
    kalendar: [],           // události, dovolené, nemoci – vidí všichni členové
    pritomnost: [],         // kdo je právě na webu: { id: uid, ms, jmeno }
    aktivity: [],           // historie kroků (kdo co uložil) – jen pro manažery
    logy: [],               // historie přihlášení (public/data/logs)
    gsync: [],              // stavy zápisu výkazů do Tabulek Google
    faktury: [],            // fakturační středisko (private/faktury) – jen manažeři
    quicktodo: [],          // rychlé vzkazy: vidí je jen autor a adresát
    ukolBudgety: {},        // budgety úkolů (jen manažeři): id → { budgetHodin, rezervaHodin }
    auta: [],               // správa aut: zápisy na dny v Brně a rezervace vozů
    cinnosti: DEFAULT_CINNOSTI.slice(),
    technologie: DEFAULT_TECHNOLOGIE.slice(),
    sazby: {},              // výchozí hodinová sazba člověka: { uid: 100 }
    rozpocty: {},           // rozpočet zakázky: { "Zakázka A": { kc: 100, hodiny: 100 } }
    status: "connecting",   // connecting | online | offline
    ready: false
};
window.KB = KB;

KB.on = (event, handler) => bus.addEventListener(event, handler);
/** Odhlášení posluchače – pro jednorázové akce, které se mají stát jen jednou. */
KB.off = (event, handler) => bus.removeEventListener(event, handler);
const emit = (event, detail) => bus.dispatchEvent(new CustomEvent(event, { detail }));
/* Ruční vyvolání události – používá se při zkoušení stránek bez databáze
   (nastrčí se data do KB.boards apod. a stránka se překreslí, jako by
   dorazila z Firestore). V provozu se nevolá. */
KB.emit = emit;

let db = null;
let auth = null;
let authReady = null;

const guidesCol = () => collection(db, "artifacts", APP_ID, "public", "data", "guides");
const guideDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "guides", id);
const tasksCol = () => collection(db, "artifacts", APP_ID, "public", "data", "tasks");
const taskDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "tasks", id);
const metaDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "meta", id);
/* ------------------------------------------------------------- tabule ----
   Tabule leží v `private`, ne v `public/data`. Je to kvůli volbě „vidí ji
   jen vybraní lidé": v `public/data` stojí nahoře plošné `allow read`,
   které se níž ničím nedá odebrat, takže by omezení platilo jen ve webu
   a kdokoliv s přístupem do databáze by si obsah přečetl. Tady o čtení
   rozhoduje sama hlavička tabule (viditelnost, zakladatel, proUids).

   `stare*` míří na původní umístění – zůstává jen kvůli přesunu dat
   na stránce Import dat a po úklidu se dá smazat. */
const tabuleCol = () => collection(db, "artifacts", APP_ID, "private", "tabule", "seznam");
const boardDoc = (id) => doc(db, "artifacts", APP_ID, "private", "tabule", "seznam", id);
/* obsah tabule je zvlášť, aby seznam tabulí zůstal lehký */
const boardBody = (id) => doc(db, "artifacts", APP_ID, "private", "tabule", "seznam", id, "content", "data");
const boardImages = (id) => collection(db, "artifacts", APP_ID, "private", "tabule", "seznam", id, "images");
const boardImage = (id, imgId) => doc(db, "artifacts", APP_ID, "private", "tabule", "seznam", id, "images", imgId);

const stareBoardsCol = () => collection(db, "artifacts", APP_ID, "public", "data", "boards");
const stareBoardDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "boards", id);
const stareBoardBody = (id) => doc(db, "artifacts", APP_ID, "public", "data", "boards", id, "content", "data");
const stareBoardImages = (id) => collection(db, "artifacts", APP_ID, "public", "data", "boards", id, "images");
const stareBoardImage = (id, imgId) => doc(db, "artifacts", APP_ID, "public", "data", "boards", id, "images", imgId);
/* Auta: kdo který den jede do Brna a kdo si kdy bere který vůz.
   Schválně v `public/data` – rozvrh aut má vidět celá firma, jinak by se
   dva lidé domlouvali na tomtéž autě přes hlavu toho druhého. */
const autaCol = () => collection(db, "artifacts", APP_ID, "public", "data", "auta");
const autoDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "auta", id);

/* Zákaznická databáze: kdo platí který projekt a kontakty na firmy.
   Leží v `private`, kam vidí jen manažeři – názvy firem samotné zůstávají
   veřejné (`meta/zakazky.firmy`), ty potřebuje zaměstnanec do výkazu. */
const firmyDetailDoc = () => doc(db, "artifacts", APP_ID, "private", "ciselniky", "firmy", "detail");

const usersCol = () => collection(db, "artifacts", APP_ID, "public", "data", "users");
const userDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "users", id);
const imagesCol = (guideId) => collection(db, "artifacts", APP_ID, "public", "data", "guides", guideId, "images");
const imageDoc = (guideId, imgId) => doc(db, "artifacts", APP_ID, "public", "data", "guides", guideId, "images", imgId);
/* výkazy – mimo `public/data`, viz komentář v hlavičce souboru */
const vykazyCol = () => collection(db, "artifacts", APP_ID, "private", "vykazy", "zaznamy");
const vykazDoc = (id) => doc(db, "artifacts", APP_ID, "private", "vykazy", "zaznamy", id);
const castkyCol = () => collection(db, "artifacts", APP_ID, "private", "vykazy", "castky");
const castkaDoc = (id) => doc(db, "artifacts", APP_ID, "private", "vykazy", "castky", id);
const vykazyMeta = () => doc(db, "artifacts", APP_ID, "private", "vykazy", "ciselniky", "nastaveni");
/* hotové souhrny ze starých excelových výkazů – jeden dokument na zakázku */
const prehledDoc = (id) => doc(db, "artifacts", APP_ID, "private", "vykazy", "prehledy", id);
/* projekty a úkoly – v `private`, protože zaměstnanec smí vidět jen svoje;
   finance projektu zvlášť, protože pravidla neumí schovat jednotlivá pole */
const projektyCol = () => collection(db, "artifacts", APP_ID, "private", "projekty", "seznam");
const projektDoc = (id) => doc(db, "artifacts", APP_ID, "private", "projekty", "seznam", id);
const projektFinanceDoc = (id) => doc(db, "artifacts", APP_ID, "private", "projekty", "finance", id);
const ukolyCol = () => collection(db, "artifacts", APP_ID, "private", "ukoly", "seznam");
const ukolDoc = (id) => doc(db, "artifacts", APP_ID, "private", "ukoly", "seznam", id);
/* kalendář je v `public/data` – dovolené a nemoci mají vidět všichni */
const kalendarCol = () => collection(db, "artifacts", APP_ID, "public", "data", "kalendar");
const kalendarDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "kalendar", id);
/* historie aktivit – zapisuje každý (svoje kroky), čtou jen manažeři */
const aktivityCol = () => collection(db, "artifacts", APP_ID, "private", "aktivity", "seznam");
/* zámek na citlivé sekce (sazby, hesla lidí) – otisk hesla leží v databázi,
   ne v kódu: repozitář je veřejný a hash z něj by šel zkoušet hrubou silou */
const zamekDoc = () => doc(db, "artifacts", APP_ID, "private", "nastaveni", "zamek", "heslo");
/* Quick TO-DO je schválně mimo `private` – tam má správce plošné čtení,
   kdežto rychlé vzkazy má vidět JEN autor a adresát (pravidla je hlídají
   po dvojici polí odKoho/proUid) */
const quickCol = () => collection(db, "artifacts", APP_ID, "osobni", "quicktodo", "seznam");
const quickDoc = (id) => doc(db, "artifacts", APP_ID, "osobni", "quicktodo", "seznam", id);
/* kdo je právě na webu – malý dokument na člověka, vidí ho všichni */
const pritomnostCol = () => collection(db, "artifacts", APP_ID, "public", "data", "pritomnost");
const pritomnostDoc = (uid) => doc(db, "artifacts", APP_ID, "public", "data", "pritomnost", uid);

/* ------------------------------------------------------------------ start */

/* Odběry se navazují až po přihlášení a při odhlášení se zase ruší,
   aby po člověku nezůstal otevřený poslech dat. */
let odbery = [];

/* ------------------------------------------------------- odběry tabulí ---
   Seznam tabulí se skládá ze tří (u manažera čtyř) dotazů – viz komentář
   u cest nahoře. Části se drží zvlášť a po každé změně se slijí podle id,
   ať se tabule, která vyhoví dvěma dotazům, neobjeví dvakrát. */
let tabuleOdbery = [];
let tabuleVse = false;
const tabuleCasti = { vsem: [], moje: [], sdilene: [], vse: [] };

const zrusTabule = () => {
    tabuleOdbery.forEach(stop => { try { stop(); } catch (e) {} });
    tabuleOdbery = [];
    tabuleVse = false;
    tabuleCasti.vsem = []; tabuleCasti.moje = []; tabuleCasti.sdilene = []; tabuleCasti.vse = [];
};

function slejTabule() {
    const mapa = new Map();
    ["vsem", "moje", "sdilene", "vse"].forEach(klic =>
        tabuleCasti[klic].forEach(b => mapa.set(b.id, b)));
    KB.boards = Array.from(mapa.values())
        .sort((a, b) => (b.updatedMs || 0) - (a.updatedMs || 0));
    emit("boards", KB.boards);
}

function sledujTabuli(klic, dotaz) {
    tabuleOdbery.push(onSnapshot(dotaz, (snapshot) => {
        tabuleCasti[klic] = [];
        snapshot.forEach(d => tabuleCasti[klic].push({ id: d.id, ...d.data() }));
        slejTabule();
    }, (err) => console.error("Chyba čtení tabulí:", err)));
}
const zrusOdbery = () => { odbery.forEach(stop => { try { stop(); } catch (e) {} }); odbery = []; };

/* Výkazy se neposlouchají samy od sebe – kdo na ně nemá právo, dostal by od
   databáze jen odmítnutí do konzole. Odběr si vyžádá stránka `vykazy.html`
   zavoláním KB.watchVykazy() a od té chvíle se obnovuje i po přihlášení. */
let vykazyOdbery = [];
let vykazyChteno = "";          // "" | "vse" (správce) | "moje" (zaměstnanec)
const zrusVykazy = () => {
    vykazyOdbery.forEach(stop => { try { stop(); } catch (e) {} });
    vykazyOdbery = [];
    vykazyRezim = "";
    starsiZaznamy = [];
    starsiCastky = {};
};

/* Projekty a úkoly jedou na stejném principu: manažer poslouchá všechno,
   zaměstnanec se ptá jen na svoje (pravidla nejsou filtr – dotaz bez
   `array-contains` by mu databáze celý odmítla). */
let projektyOdber = null;
let projektyChteno = "";        // "" | "vse" | "moje"
let ukolyOdber = null;
let ukolyChteno = "";

/* Kdo si o data řekl dřív, ten určuje rozsah – a to je past: svislý pás
   si na každé stránce vyžádá „jen moje", takže by manažerovi zablokoval
   plný odběr, který si o kus dál řekne stránka. Proto se rozsah smí
   ROZŠÍŘIT (moje → vše), ale nikdy zúžit. */
let vykazyRezim = "";           // "" | "moje" | "vse"
let projektyRezim = "";
let ukolyRezim = "";
const zrusProjektyUkoly = () => {
    if (projektyOdber) { try { projektyOdber(); } catch (e) {} projektyOdber = null; }
    if (ukolyOdber) { try { ukolyOdber(); } catch (e) {} ukolyOdber = null; }
    projektyRezim = ""; ukolyRezim = "";
};

try {
    const app = initializeApp(FIREBASE_CONFIG);

    /* iPad a iPhone (WebKit): IndexedDB tam umí potichu VISET a je na ní
       postavená jak mezipaměť dat, tak ukládání přihlášení. Bez tohohle
       obcházení na iPadu 29. 8. napřed nechodila data, a po odhlášení
       nešlo ani přihlásit (session se neměla kam zapsat). iPad se hlásí
       jako „MacIntel", pozná se podle dotykových bodů. */
    const appleDotyk = navigator.maxTouchPoints > 1 &&
        /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);

    /* na jablečném dotyku se přihlášení ukládá do localStorage (spolehlivé),
       jinde zůstává výchozí IndexedDB */
    auth = appleDotyk
        ? initializeAuth(app, { persistence: browserLocalPersistence })
        : getAuth(app);
    /* Trvalá mezipaměť v prohlížeči (IndexedDB). Web je několik
       samostatných stránek, ne jedna aplikace – bez ní si každé otevření
       stránky přečte všechny kolekce znovu a Firestore počítá čtení za
       každý doručený dokument. S ní se odběr obnoví z disku a ze serveru
       přijde jen to, co se mezitím změnilo. Tohle byla hlavní příčina
       66 tisíc čtení za den při 634 zápisech (25. 8. 2026).

       `persistentMultipleTabManager` hlídá víc otevřených záložek naráz;
       kde IndexedDB není (anonymní okno, starý prohlížeč), se tiše
       spadne zpátky na paměťovou mezipaměť. */
    /* Data na jablečném dotyku (viz `appleDotyk` výš): bez trvalé
       mezipaměti a přes long-polling, se kterým má WebKit menší potíže
       než se streamováním. */
    try {
        db = appleDotyk
            ? initializeFirestore(app, { experimentalForceLongPolling: true })
            : initializeFirestore(app, {
                localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
            });
    } catch (err) {
        console.warn("Mezipaměť databáze se nezapnula, jede se bez ní:", err);
        db = getFirestore(app);
    }
    KB.auth = auth;

    // Přihlašuje se e-mailem a heslem. Dokud se nikdo nepřihlásí, web žádná
    // data nenačte – to je záměr, ne chyba.
    authReady = new Promise(resolve => {
        onAuthStateChanged(auth, (user) => { if (user) resolve(user); });
    });

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            zrusOdbery();
            zrusTabule();
            zrusVykazy();
            zrusProjektyUkoly();
            if (pritomnostCasovac) { clearInterval(pritomnostCasovac); pritomnostCasovac = null; }
            if (pritomnostOdber) { try { pritomnostOdber(); } catch (e) {} pritomnostOdber = null; }
            if (autaOdber) { try { autaOdber(); } catch (e) {} autaOdber = null; }
            if (tasksOdber) { try { tasksOdber(); } catch (e) {} tasksOdber = null; }
            KB.pritomnost = [];
            if (aktivityOdber) { try { aktivityOdber(); } catch (e) {} aktivityOdber = null; }
            if (logyOdber) { try { logyOdber(); } catch (e) {} logyOdber = null; }
            quickOdbery.forEach(stop => { try { stop(); } catch (e) {} });
            quickOdbery = []; quickPrijate = []; quickPrijateSkupina = [];
            quickOdeslane = []; KB.quicktodo = [];
            poznOdbery.forEach(stop => { try { stop(); } catch (e) {} });
            poznOdbery = [];
            poznKusy.listyMoje = []; poznKusy.listySdilene = [];
            poznKusy.zaznamyMoje = []; poznKusy.zaznamySdilene = [];
            KB.poznListy = []; KB.poznamky = [];
            KB.guides = []; KB.tasks = []; KB.users = []; KB.boards = []; KB.auta = [];
            KB.vykazy = []; syroveZaznamy = []; syroveCastky = {};
            KB.vykazyPrisly = false;
            KB.projektyDocs = []; KB.ukoly = []; KB.kalendar = [];
            KB.ready = true;
            setStatus("odhlasen");
            emit("guides", KB.guides);
            emit("users", KB.users);
            return;
        }
        zrusOdbery();
        odbery.push(onSnapshot(guidesCol(), (snapshot) => {
            KB.guides = [];
            snapshot.forEach(d => KB.guides.push({ id: d.id, ...d.data() }));
            KB.guides.sort((a, b) => (b.updatedMs || 0) - (a.updatedMs || 0));
            KB.ready = true;
            setStatus("online");
            emit("guides", KB.guides);
        }, (err) => {
            console.error("Chyba čtení databáze:", err);
            setStatus("offline");
        }));



        /* Tabule: tři dotazy místo jednoho. Pravidla umí povolit nebo zakázat
           celý dotaz, ne ho profiltrovat – kdyby se sáhlo na celou kolekci,
           strhla by jedna zamčená tabule celý seznam. Manažerovi se pak
           přidá čtvrtý dotaz na všechno (viz odběr uživatelů níž). */
        zrusTabule();
        sledujTabuli("vsem", query(tabuleCol(), where("viditelnost", "==", "vsichni")));
        sledujTabuli("moje", query(tabuleCol(), where("createdUid", "==", user.uid)));
        sledujTabuli("sdilene", query(tabuleCol(), where("proUids", "array-contains", user.uid)));



        odbery.push(onSnapshot(usersCol(), (snapshot) => {
            KB.users = [];
            snapshot.forEach(d => KB.users.push({ id: d.id, ...d.data() }));
            KB.users.sort((a, b) => (a.last || "").localeCompare(b.last || "", "cs"));
            emit("users", KB.users);

            /* Manažer má vidět i tabule, do kterých ho nikdo nepřidal.
               Jde to až teď: jakou má kdo roli, se pozná ze seznamu lidí,
               a ten dorazí po přihlášení. Přidá se jednou, ne při každé
               změně seznamu. */
            const ja = KB.users.find(u => u.id === user.uid);
            const manazer = ja && ja.active !== false &&
                ["hlavni-spravce", "majitel", "spravce", "asistentka"].indexOf(ja.role) !== -1;
            if (manazer && !tabuleVse) {
                tabuleVse = true;
                sledujTabuli("vse", tabuleCol());
            }
        }, (err) => console.error("Chyba čtení uživatelů:", err)));

        /* Milníky leží v jednom dokumentu jako pole. Je jich pár desítek
           a hlavně: `meta/…` smí zapisovat jen správce, takže se tím rovnou
           řeší i to, kdo je může měnit – bez dalších pravidel v databázi. */
        /* Povolení zpětného zápisu: { uid: "2026-09-15" } = do kdy smí
           člověk zapisovat i do uzavřených týdnů. Leží v meta (čtou všichni
           členové – zaměstnanec podle toho projde uzávěrkou), zapisuje
           správce. Odebrání = prázdné datum (hluboký merge klíče nemaže). */
        odbery.push(onSnapshot(metaDoc("zpetne"), (snap) => {
            const data = snap.exists() ? (snap.data() || {}) : {};
            KB.zpetnePovoleni = (data.povoleni && typeof data.povoleni === "object")
                ? data.povoleni : {};
            emit("zpetne", KB.zpetnePovoleni);
        }, () => { /* bez dokumentu prostě nikdo povolení nemá */ }));

        odbery.push(onSnapshot(metaDoc("gsync"), (snap) => {
            KB.gsyncUrl = (snap.exists() ? (snap.data() || {}).url : "") || "";
            emit("gsync-url", KB.gsyncUrl);
        }, () => { /* adresa nemusí být nastavená – zápis se pak jen nespustí */ }));

        odbery.push(onSnapshot(metaDoc("milniky"), (snap) => {
            const data = snap.exists() ? snap.data() : {};
            KB.milniky = Array.isArray(data.items) ? data.items : [];
            emit("milniky", KB.milniky);
        }, (err) => console.error("Chyba čtení milníků:", err)));

        odbery.push(onSnapshot(metaDoc("zakazky"), (snap) => {
            const data = snap.exists() ? snap.data() : {};
            KB.zakazky = Array.isArray(data.names) ? data.names : [];
            KB.zakazkyClosed = Array.isArray(data.closed) ? data.closed : [];
            /* Vzory výchozích oblíbených projektů (hvězdičky ve Správě) leží
               v databázi, ne ve zdrojáku – repozitář je veřejný a názvy
               zakázek do něj nepatří. */
            KB.oblibeneVzory = Array.isArray(data.oblibeneVzory) ? data.oblibeneVzory : [];
            /* Oblíbené projekty (hvězdička ve Správě) drží celá firma
               společné – dřív si je každý manažer sbíral ve svém
               prohlížeči a nikdo neviděl totéž (přání Michala 1. 9. 2026). */
            KB.oblibeneProjekty = Array.isArray(data.oblibeneIds) ? data.oblibeneIds : null;
            // dokud si skupiny nikdo neupravil, platí výchozí trojice
            KB.skupiny = (Array.isArray(data.groups) && data.groups.length)
                ? data.groups : KB.DEFAULT_SKUPINY.slice();
            /* Části projektu a firmy, kterým se fakturuje, leží tady a ne
               mezi tajnými čísly – zaměstnanec si je u svého výkazu musí
               umět vybrat. Tajné jsou sazby a rozpočty, ne názvy. */
            KB.projekty = (data.projekty && typeof data.projekty === "object") ? data.projekty : {};
            KB.firmy = Array.isArray(data.firmy) ? data.firmy : [];
            /* `firmaMap` (kdo platí který projekt) a `firmyDetail` (IČO,
               kontakt, telefon, adresa) se 1. 9. 2026 odstěhovaly do
               `private/ciselniky/firmy` – tady je četl každý člen, takže
               si odcházející zaměstnanec mohl jedním dotazem stáhnout
               celou zákaznickou databázi (bezpečnostní audit).
               Čte je KB.watchFirmyDetail(), a jen manažerské stránky. */
            /* budget číselník: projekt → { budovy: ["G61"], patra: ["1NP"] } –
               z něj se skládají úkoly (technologie × budova × patro) */
            KB.budgetCiselnik = (data.budget && typeof data.budget === "object") ? data.budget : {};
            emit("zakazky", KB.zakazky);
        }, (err) => console.error("Chyba čtení zakázek:", err)));

        /* Kalendář poslouchají všichni – dovolené a nemoci kolegů jsou
           schválně vidět, ať se dá plánovat. */
        odbery.push(onSnapshot(kalendarCol(), (snapshot) => {
            KB.kalendar = [];
            snapshot.forEach(d => KB.kalendar.push({ id: d.id, ...d.data() }));
            KB.kalendar.sort((a, b) => (a.od || "").localeCompare(b.od || ""));
            emit("kalendar", KB.kalendar);
        }, (err) => console.error("Chyba čtení kalendáře:", err)));


        ohlasSe(user);

        // po opětovném přihlášení navázat i výkazy, projekty a úkoly,
        // pokud si o ně některá stránka už řekla
        zrusVykazy();
        if (vykazyChteno) { vykazyRezim = vykazyChteno; sledujVykazy(vykazyChteno === "moje"); }
        zrusProjektyUkoly();
        if (projektyChteno) { projektyRezim = projektyChteno; sledujProjekty(projektyChteno === "moje"); }
        if (ukolyChteno) { ukolyRezim = ukolyChteno; sledujUkoly(ukolyChteno === "moje"); }
    });
} catch (err) {
    console.warn("Firebase se nepodařilo spustit – offline režim.", err);
    setStatus("offline");
    KB.ready = true;
    emit("guides", []);
}

function setStatus(value) {
    KB.status = value;
    emit("status", value);
}

/* ------------------------------------------------------- kdo je online ---
   Otisk „jsem tady" se obnovuje, dokud je stránka otevřená a vidět.

   POZOR na cenu: Firestore počítá čtení za každý dokument doručený
   každému posluchači. Když otisk píše N lidí a zároveň ho N lidí
   poslouchá, je to 12·N² čtení za hodinu — u dvaadvaceti lidí skoro
   6 000 za hodinu a denní strop free tarifu padne za jeden pracovní
   den (25. 8. 2026 přesně tohle shodilo i zápis výkazů do Tabulek).

   Proto se tu šetří třikrát:
     • otisk chodí po deseti minutách, ne po pěti,
     • schovaná záložka nepíše vůbec — otisk se pošle, až se na stránku
       někdo vrátí (jinak by hodiny běžely i v zapomenutém okně),
     • kolekci poslouchá jen stránka, která ji ukazuje (nástěnka), ne
       každá stránka webu — od toho je KB.watchPritomnost(). */

const PRITOMNOST_MINUT = 10;
KB.PRITOMNOST_MINUT = PRITOMNOST_MINUT;

let pritomnostCasovac = null;
let pritomnostViditelnost = null;

function ohlasSe(user) {
    if (pritomnostCasovac) clearInterval(pritomnostCasovac);

    const zapis = () => {
        if (!auth || !auth.currentUser) return;
        if (document.visibilityState === "hidden") return;
        setDoc(pritomnostDoc(auth.currentUser.uid), {
            ms: Date.now(),
            jmeno: window.KB_USER || ""
        }).catch(() => { /* pravidla ještě nemusí být nasazená */ });
    };

    zapis();
    pritomnostCasovac = setInterval(zapis, PRITOMNOST_MINUT * 60 * 1000);

    // návrat k záložce otisk dorovná, ať člověk nevypadá jako pryč
    if (!pritomnostViditelnost) {
        pritomnostViditelnost = () => {
            if (document.visibilityState === "visible") zapis();
        };
        document.addEventListener("visibilitychange", pritomnostViditelnost);
    }
}

/* Auta a staré úkoly z rozcestníku visely na každé stránce, i když je
   čte jen panel Správa aut a stránka historie. Každé otevření webu si
   je tím zbytečně přečetlo celé. */
let autaOdber = null;

KB.watchAuta = async () => {
    if (autaOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || autaOdber) return;
    autaOdber = onSnapshot(autaCol(), (snapshot) => {
        KB.auta = [];
        snapshot.forEach(d => KB.auta.push({ id: d.id, ...d.data() }));
        // od nejbližšího termínu – panel čte odshora dolů
        KB.auta.sort((a, b) => (a.od || "").localeCompare(b.od || ""));
        emit("auta", KB.auta);
    }, (err) => console.error("Chyba čtení aut:", err));
};

let tasksOdber = null;

KB.watchTasks = async () => {
    if (tasksOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || tasksOdber) return;
    tasksOdber = onSnapshot(tasksCol(), (snapshot) => {
        KB.tasks = [];
        snapshot.forEach(d => KB.tasks.push({ id: d.id, ...d.data() }));
        // nejbližší termín nahoře, úkoly bez termínu na konec
        KB.tasks.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
        emit("tasks", KB.tasks);
    }, (err) => console.error("Chyba čtení úkolů:", err));
};

/* Odběr přítomnosti si řekne stránka, která ji ukazuje. Kdyby ho měly
   všechny, platí se za každý otisk tolikrát, kolik je otevřených oken. */
let pritomnostOdber = null;

KB.watchPritomnost = async () => {
    if (pritomnostOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || pritomnostOdber) return;
    pritomnostOdber = onSnapshot(pritomnostCol(), (snapshot) => {
        KB.pritomnost = [];
        snapshot.forEach(d => KB.pritomnost.push({ id: d.id, ...d.data() }));
        emit("pritomnost", KB.pritomnost);
    }, (err) => console.error("Chyba čtení přítomnosti:", err));
};

/* ---------------------------------------------------- historie aktivit ---
   Krátký zápis „kdo co udělal" – plní se z ukládacích funkcí a čtou ho jen
   manažeři (Reporty). Nikdy nesmí shodit vlastní uložení, proto se chyby
   polykají: bez nasazených pravidel se prostě nic nezapíše. */

KB.zapisAktivitu = (druh, text, jmeno) => {
    try {
        if (!db || !auth || !auth.currentUser) return;
        addDoc(aktivityCol(), {
            druh: druh,                 // projekt | ukol | postup | vykaz | kalendar | auto
            text: String(text || "").slice(0, 200),
            uid: auth.currentUser.uid,
            /* Vzkazy hlídek nepíše člověk, ale web – v Reportu se proto
               podepisují jako „Systém" (přání Michala 1. 9. 2026). */
            jmeno: jmeno || window.KB_USER || "",
            ms: Date.now()
        }).catch(() => {});
    } catch (err) { /* nikdy neshodit uložení kvůli logu */ }
};

/* --------------------------------------------------------- Quick TO-DO ---
   Rychlý vzkaz s termínem: „Nezapomenout vystavit fakturu…" Vidí ho jen
   autor a adresát – proto dva dotazy (co mi kdo poslal + co jsem poslal já)
   slévané do jednoho pole; pravidla širší čtení nedovolí. */

let quickOdbery = [];
let quickPrijate = [];
let quickPrijateSkupina = [];
let quickOdeslane = [];

function slejQuick() {
    const mapa = new Map();
    quickPrijate.concat(quickPrijateSkupina, quickOdeslane).forEach(q => mapa.set(q.id, q));
    KB.quicktodo = Array.from(mapa.values())
        .sort((a, b) => (a.hotovo ? 1 : 0) - (b.hotovo ? 1 : 0)
            || (a.doKdy || "9999").localeCompare(b.doKdy || "9999")
            || (b.ms || 0) - (a.ms || 0));
    emit("quicktodo", KB.quicktodo);
}

KB.watchQuickTodo = async () => {
    if (quickOdbery.length) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || quickOdbery.length) return;
    const uid = auth.currentUser.uid;
    /* Dva dotazy na přijaté: `proUids` je dnešní podoba (vzkaz může mít víc
       adresátů), `proUid` drží starší záznamy z doby, kdy měl každý svůj
       vlastní dokument. Sléváme je podle id, takže se nezdvojí. */
    quickOdbery.push(onSnapshot(query(quickCol(), where("proUids", "array-contains", uid)), (s) => {
        quickPrijateSkupina = []; s.forEach(d => quickPrijateSkupina.push({ id: d.id, ...d.data() }));
        slejQuick();
    }, (err) => console.error("Chyba čtení Quick TO-DO:", err)));
    quickOdbery.push(onSnapshot(query(quickCol(), where("proUid", "==", uid)), (s) => {
        quickPrijate = []; s.forEach(d => quickPrijate.push({ id: d.id, ...d.data() }));
        slejQuick();
    }, (err) => console.error("Chyba čtení Quick TO-DO:", err)));
    quickOdbery.push(onSnapshot(query(quickCol(), where("odKoho", "==", uid)), (s) => {
        quickOdeslane = []; s.forEach(d => quickOdeslane.push({ id: d.id, ...d.data() }));
        slejQuick();
    }, (err) => console.error("Chyba čtení Quick TO-DO:", err)));
};

KB.newQuickId = () => "qt_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

KB.saveQuickTodo = async (id, data) => {
    if (authReady) await authReady;
    requireDb();

    /* Jeden vzkaz = jeden dokument, i když je pro víc lidí. Dřív se zakládal
       zvlášť pro každého, takže se v přehledu objevil čtyřikrát a splnění
       jednoho o ostatních nevědělo. `proUids` drží všechny adresáty;
       `proUid` zůstává kvůli starším záznamům a je v něm ten první. */
    const komu = Array.isArray(data.proUids) && data.proUids.length
        ? data.proUids.slice()
        : [data.proUid || KB.currentUid()];

    await setDoc(quickDoc(id), {
        text:    String(data.text || "").slice(0, 300),
        proUids: komu,
        proUid:  komu[0],
        odKoho:  data.odKoho || KB.currentUid(),
        odKohoJmeno: data.odKohoJmeno || window.KB_USER || "",
        doKdy:   data.doKdy || "",
        /* „Co nejdříve" je zvláštní stav, ne datum – kdo neví, do kdy to má
           být, by jinak musel vymyslet termín, který stejně nic neznamená.
           Řadí se před všechny termíny. */
        asap:    data.asap === true,
        projekt: data.projekt || "",       // nepovinná vazba na projekt
        hotovo:  data.hotovo === true,
        // u společného vzkazu je potřeba vědět, kdo ho odškrtl za všechny
        hotovoKdo: data.hotovoKdo || "",
        hotovoMs:  data.hotovoMs || 0,
        // nepovinná vazba na poznámku – vzkaz pak nese odkaz „Otevřít"
        poznamka: data.poznamka || "",
        // vzkaz hlídky výkazů: "tyden" (oranžově) | "minuly" (červeně)
        hlidka: data.hlidka || "",
        ms:      data.ms || Date.now()
    }, { merge: true });
    /* Od 21. 8. jde do aktivit i text vzkazu – Michal chce v reportech
       vidět, o jaký vzkaz šlo. Vzkaz tím pádem čtou i manažeři. */
    KB.zapisAktivitu("quicktodo", (data.hotovo === true
        ? "splnil quick to-do: "
        : "zadal quick to-do (" + komu.length + " lidem): ") +
        String(data.text || "").slice(0, 150),
        data.hlidka ? "Systém" : null);
    return id;
};

KB.deleteQuickTodo = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(quickDoc(id));
};

/* ------------------------------------------------------------ poznámky ---
   Osobní zápisník problémů: screenshot + pár vět, řazené do pojmenovaných
   listů. Jako Quick TO-DO leží mimo `private` – nevidí je ani manažer,
   jen autor a lidé, kterým autor list nebo poznámku nasdílel.

     osobni/poznamky/listy/{id}                { nazev, uid, sdileni }
     osobni/poznamky/zaznamy/{id}              poznámka + komentáře
     osobni/poznamky/zaznamy/{id}/obrazky/{n}  screenshoty (JPEG base64) */

const poznListyCol = () => collection(db, "artifacts", APP_ID, "osobni", "poznamky", "listy");
const poznListDoc = (id) => doc(db, "artifacts", APP_ID, "osobni", "poznamky", "listy", id);
const poznCol = () => collection(db, "artifacts", APP_ID, "osobni", "poznamky", "zaznamy");
const poznDoc = (id) => doc(db, "artifacts", APP_ID, "osobni", "poznamky", "zaznamy", id);
const poznObrazky = (id) => collection(db, "artifacts", APP_ID, "osobni", "poznamky", "zaznamy", id, "obrazky");
const poznObrazek = (id, n) => doc(db, "artifacts", APP_ID, "osobni", "poznamky", "zaznamy", id, "obrazky", String(n));

KB.poznListy = [];
KB.poznamky = [];
let poznOdbery = [];
const poznKusy = { listyMoje: [], listySdilene: [], zaznamyMoje: [], zaznamySdilene: [] };

function slejPoznamky() {
    const listy = new Map(), zaznamy = new Map();
    poznKusy.listyMoje.concat(poznKusy.listySdilene).forEach(l => listy.set(l.id, l));
    poznKusy.zaznamyMoje.concat(poznKusy.zaznamySdilene).forEach(z => zaznamy.set(z.id, z));
    KB.poznListy = Array.from(listy.values()).sort((a, b) => (a.ms || 0) - (b.ms || 0));
    KB.poznamky = Array.from(zaznamy.values()).sort((a, b) => (b.ms || 0) - (a.ms || 0));
    emit("poznamky", null);
}

KB.watchPoznamky = async () => {
    if (poznOdbery.length) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || poznOdbery.length) return;
    const uid = auth.currentUser.uid;
    /* Dva dotazy na listy a dva na poznámky (moje / sdílené se mnou) –
       pravidla umí dotaz povolit nebo zakázat, ne ho profiltrovat. */
    const sleduj = (klic, dotaz) => poznOdbery.push(onSnapshot(dotaz, (s) => {
        poznKusy[klic] = []; s.forEach(d => poznKusy[klic].push({ id: d.id, ...d.data() }));
        slejPoznamky();
    }, (err) => console.error("Chyba čtení poznámek:", err)));
    sleduj("listyMoje", query(poznListyCol(), where("uid", "==", uid)));
    sleduj("listySdilene", query(poznListyCol(), where("sdileni", "array-contains", uid)));
    sleduj("zaznamyMoje", query(poznCol(), where("uid", "==", uid)));
    sleduj("zaznamySdilene", query(poznCol(), where("sdileni", "array-contains", uid)));
};

KB.ulozPoznList = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    const lid = id || "pzl_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    await setDoc(poznListDoc(lid), {
        nazev: String(data.nazev || "List").slice(0, 80),
        sdileni: Array.isArray(data.sdileni) ? data.sdileni : [],
        uid: data.uid || KB.currentUid(),
        jmeno: data.jmeno || window.KB_USER || "",
        ms: data.ms || Date.now()
    }, { merge: true });
    return lid;
};

/** Smaže list i s jeho poznámkami a jejich obrázky (jen vlastní). */
KB.smazPoznList = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const moje = (KB.poznamky || []).filter(z => z.listId === id && z.uid === KB.currentUid());
    for (const z of moje) await KB.smazPoznamku(z.id);
    await deleteDoc(poznListDoc(id));
};

/* Ukládá se jen to, co v patchi opravdu je – sdílený člověk smí podle
   pravidel měnit jen komentáře a přisdílení, plný zápis by mu spadl. */
KB.ulozPoznamku = async (id, patch) => {
    if (authReady) await authReady;
    requireDb();
    const pid = id || "pz_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const p = {};
    if ("listId" in patch) p.listId = String(patch.listId || "");
    if ("listNazev" in patch) p.listNazev = String(patch.listNazev || "").slice(0, 80);
    if ("text" in patch) p.text = String(patch.text || "").slice(0, 2000);
    if ("stav" in patch) p.stav = Number(patch.stav) || 0;   // 0 = řeší se, 1 = splněno
    if ("sdileni" in patch) p.sdileni = Array.isArray(patch.sdileni) ? patch.sdileni : [];
    // malý náhled prvního screenshotu – ať je fotka vidět rovnou na dlaždici
    if ("nahled" in patch) p.nahled = String(patch.nahled || "").slice(0, 90000);
    if (!id) {
        p.uid = KB.currentUid();
        p.jmeno = window.KB_USER || "";
        p.komentare = [];
        p.obrazku = 0;
        if (!("stav" in p)) p.stav = 0;
    }
    p.ms = Date.now();
    await setDoc(poznDoc(pid), p, { merge: true });
    return pid;
};

KB.pridejPoznKomentar = async (id, text) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(poznDoc(id), {
        komentare: arrayUnion({
            uid: KB.currentUid(),
            jmeno: window.KB_USER || "",
            text: String(text || "").slice(0, 500),
            ms: Date.now()
        }),
        ms: Date.now()
    }, { merge: true });
};

/** Přisdílí poznámku dalšímu člověku (třeba při upozornění do Quick TO-DO). */
KB.pridejPoznSdileni = async (id, uid) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(poznDoc(id), { sdileni: arrayUnion(uid), ms: Date.now() }, { merge: true });
};

KB.pridejPoznObrazek = async (id, dataUrl) => {
    if (authReady) await authReady;
    requireDb();
    const n = "img_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    await setDoc(poznObrazek(id, n), { data: dataUrl, ms: Date.now() });
    await setDoc(poznDoc(id), { obrazku: increment(1), ms: Date.now() }, { merge: true });
    return n;
};

KB.nactiPoznObrazky = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(poznObrazky(id));
    const ven = [];
    snap.forEach(d => ven.push({ id: d.id, ...d.data() }));
    ven.sort((a, b) => (a.ms || 0) - (b.ms || 0));
    return ven;
};

KB.smazPoznamku = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const obrazky = await getDocs(poznObrazky(id));
    for (const d of obrazky.docs) await deleteDoc(d.ref);
    await deleteDoc(poznDoc(id));
};

/* ------------------------------------------------ zámek citlivých sekcí ---
   Role samotná už brání komukoliv mimo manažery, tohle je druhý zámek navíc
   pro sazby a hesla lidí – aby stačilo odejít od odemčeného počítače a nikdo
   je hned neviděl. Heslo si zvolí hlavní správce; ukládá se jen jeho otisk
   se solí, takže se z databáze zpětně přečíst nedá. */

KB.loadZamek = async () => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(zamekDoc());
    return snap.exists() ? snap.data() : null;
};

KB.saveZamek = async (salt, hash) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(zamekDoc(), {
        salt: salt, hash: hash,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    });
};

/* ------------------------------------------------- týdenní logy reportů --
   Reporty ukazují jen poslední týden; každé pondělí (přesněji: při první
   manažerově návštěvě Reportů v novém týdnu) se z aktivit uplynulého týdne
   udělá zápis s pevným id = pondělí logovaného týdne. Leží v `private`
   (nesou i texty quick vzkazů), takže je čtou jen manažeři – kryje je
   spodní pravidlo pro private, žádná změna pravidel není potřeba. */

const tydenniLogyCol = () => collection(db, "artifacts", APP_ID, "private", "reporty", "logy");
const tydenniLogDoc = (id) => doc(db, "artifacts", APP_ID, "private", "reporty", "logy", id);

KB.nactiAktivityRozsah = async (odMs, doMs) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(query(aktivityCol(),
        where("ms", ">=", odMs), where("ms", "<", doMs), orderBy("ms", "asc")));
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    return out;
};

KB.nactiTydenniLog = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(tydenniLogDoc(id));
    return snap.exists() ? snap.data() : null;
};

KB.ulozTydenniLog = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(tydenniLogDoc(id), data);
};

KB.nactiTydenniLogy = async (kolik) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(query(tydenniLogyCol(), orderBy("ms", "desc"), limit(kolik || 12)));
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    return out;
};

let aktivityOdber = null;

/** Posledních pár desítek kroků – jen pro manažery (pravidla). */
KB.watchAktivity = async () => {
    if (aktivityOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || aktivityOdber) return;
    /* 300 místo 40: reporty ukazují celý poslední týden a ten může mít
       stovky kroků; starší týdny žijí v týdenních lozích */
    /* 80 stačí: dlaždice na nástěnce ukazuje pár posledních a reporty si
       delší rozsah dotáhnou zvlášť (nactiAktivityRozsah). Tři sta řádků
       na každé otevření stránky bylo největší jednotlivé čtení webu. */
    aktivityOdber = onSnapshot(query(aktivityCol(), orderBy("ms", "desc"), limit(80)),
        (snapshot) => {
            KB.aktivity = [];
            snapshot.forEach(d => KB.aktivity.push({ id: d.id, ...d.data() }));
            emit("aktivity", KB.aktivity);
        }, (err) => console.error("Chyba čtení aktivit:", err));
};

/* Počká, dokud nedorazí první dávka dat (nebo dokud není jasné, že jsme offline). */
KB.whenReady = () => new Promise(resolve => {
    if (KB.ready) return resolve(KB.guides);
    KB.on("guides", () => resolve(KB.guides));
    setTimeout(() => resolve(KB.guides), 8000);
});

const requireDb = () => {
    if (!db || !auth || !auth.currentUser) throw new Error("Databáze není připojená.");
};

/* ----------------------------------------------------------------- návody */

KB.newId = () => "guide_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

KB.saveGuide = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    const payload = {
        title:    data.title || "Bez názvu",
        desc:     data.desc || "",
        category: data.category || "",     // volný text (zpětná kompatibilita)
        cat:      data.cat || "",          // id kategorie z taxonomy.js
        subcat:   data.subcat || "",       // id podkategorie
        version:  data.version || "v1.0",
        author:   data.author || "",
        steps:    data.steps || [],
        updatedAt: serverTimestamp(),
        updatedMs: Date.now(),
        lastEditor: window.KB_USER || ""
    };
    await setDoc(guideDoc(id), payload, { merge: true });
    return id;
};

KB.getGuide = async (id) => {
    const cached = KB.guides.find(g => g.id === id);
    if (cached) return cached;
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(guideDoc(id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

KB.deleteGuide = async (id) => {
    if (authReady) await authReady;
    requireDb();
    // nejdřív obrázky, pak samotný návod (Firestore nemaže podkolekce samo)
    const imgs = await getDocs(imagesCol(id));
    await Promise.all(imgs.docs.map(d => deleteDoc(imageDoc(id, d.id))));
    await deleteDoc(guideDoc(id));
};

/* --------------------------------------------------------------- obrázky */

KB.newImageId = () => "img_" + Date.now() + "_" + Math.floor(Math.random() * 10000);

/** Uloží jeden obrázek (data URL) jako samostatný dokument. */
KB.saveImage = async (guideId, imgId, dataUrl, meta = {}) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(imageDoc(guideId, imgId), {
        data: dataUrl,
        name: meta.name || "",
        w: meta.w || 0,
        h: meta.h || 0,
        createdAt: serverTimestamp()
    });
};

KB.deleteImage = async (guideId, imgId) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(imageDoc(guideId, imgId));
};

/** Vrátí mapu { imgId: dataUrl } pro daný návod. */
KB.loadImages = async (guideId) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(imagesCol(guideId));
    const map = {};
    snap.forEach(d => { map[d.id] = d.data().data; });
    return map;
};

/* ------------------------------------------------------------------ úkoly */

KB.newTaskId = () => "task_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

/**
 * Uloží úkol. Struktura:
 *   { zakazka, skupina, title, owner, deadline: "2026-07-31",
 *     subtasks: [{ id, title, percent, by, ms }],
 *     notes:    [{ id, subtaskId, text, author, ms }],
 *     log:      [{ subtaskId, sub, from, percent, by, ms }] }
 * Poznámky i historie jsou uvnitř dokumentu – je jich málo a načtou se
 * rovnou se seznamem.
 */
KB.saveTask = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(taskDoc(id), {
        zakazka:  data.zakazka || "",
        skupina:  data.skupina || "",      // ARCGIS / SKENY / FOCENÍ, prázdné = nezařazeno
        title:    data.title || "Bez názvu",
        owner:    data.owner || "",        // původní volný text (starší úkoly)
        owners:   data.owners || [],       // UID lidí, kterým úkol patří
        deadline: data.deadline || "",
        subtasks: data.subtasks || [],
        notes:    data.notes || [],
        log:      data.log || [],          // kdo a kdy měnil procenta
        done:     data.done || null,       // { by, ms } po potvrzení „úkol je hotov"
        createdBy: data.createdBy || window.KB_USER || "",
        createdMs: data.createdMs || Date.now(),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    return id;
};

/**
 * Uloží číselník zakázek – jeden dokument se seznamem názvů, seznamem
 * uzavřených a se skupinami, na které se úkoly uvnitř zakázky dělí.
 * Skupiny se zapíšou jen tehdy, když je volající opravdu předá; jinak
 * zůstanou v databázi ty stávající.
 */
KB.saveZakazky = async (names, closed, groups) => {
    if (authReady) await authReady;
    requireDb();

    const payload = {
        names: names,
        closed: closed || KB.zakazkyClosed || [],
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    };
    if (Array.isArray(groups)) payload.groups = groups;

    await setDoc(metaDoc("zakazky"), payload, { merge: true });
};

KB.deleteTask = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(taskDoc(id));
};

/* ----------------------------------------------------------- milníky ----
   Termíny odevzdání po činnostech (STAVBA, CHLAD, VZT…). Ukládají se jako
   pole v jednom dokumentu `meta/milniky` – je jich málo a zápis do `meta`
   mají povolený jen správci, takže se tím řeší i oprávnění.

   Položka: { id, cinnost, owners:[uid], owner, napln, datum:"2026-08-31", zakazka } */

KB.newMilnikId = () => "mil_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

KB.saveMilniky = async (items) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(metaDoc("milniky"), {
        items: items,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    });
};

/** Manažer potvrzuje milník, který si přiřazený člověk odškrtl sám. */
KB.potvrdMilnik = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const items = (KB.milniky || []).map(m => m.id !== id ? m : Object.assign({}, m, {
        potvrzeno: true,
        potvrdil: window.KB_USER || "",
        potvrzenoMs: Date.now()
    }));
    await KB.saveMilniky(items);
    const m = (KB.milniky || []).find(x => x.id === id);
    KB.zapisAktivitu("milnik", "potvrdil splněný milník" + (m && m.cinnost ? " " + m.cinnost : ""));
};

/* ------------------------------------------------------------- uživatelé --
   Seznam lidí, kteří mají na web přístup, a jejich role. Spravuje ho hlavní
   správce. Heslo se ukládá jen jako otisk (SHA-256 se solí), nikdy v čitelné
   podobě – i tak ale platí, že dokud běží anonymní přihlášení k Firebase
   a otevřená pravidla, je to zámek na skleněných dveřích. Skutečné oddělení
   přijde s Firebase Auth; poznámky k tomu jsou v README. */

KB.userId = (email) => String(email || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

/**
 * Jednorázový úklid po bezpečnostním auditu (1. 9. 2026): smaže z každého
 * člověka otisk hesla (`hash`, `salt`) i jeho šifrovanou podobu (`enc`)
 * a zahodí dokument trezoru. Ta pole ležela v `public/data`, kam vidí
 * každý člen – kdokoliv si je mohl stáhnout a doma zkoušet lámat.
 * Heslo od té doby zná jen Firebase Auth; zapomenuté se řeší odkazem.
 * Pouští se ručně z konzole, spustit jde opakovaně.
 */
KB.uklidHesla = async () => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(usersCol());
    let lidi = 0;
    for (const d of snap.docs) {
        const data = d.data() || {};
        if (!data.hash && !data.salt && !data.enc) continue;
        await setDoc(userDoc(d.id), {
            hash: deleteField(), salt: deleteField(), enc: deleteField()
        }, { merge: true });
        lidi++;
    }
    let trezor = false;
    try { await deleteDoc(metaDoc("vault")); trezor = true; } catch (err) { /* nebyl */ }
    KB.zapisAktivitu("navod", "smazal uložená hesla lidí i dokument trezoru (bezpečnostní úklid)");
    return { lidi: lidi, trezorSmazan: trezor };
};

KB.saveUser = async (data) => {
    if (authReady) await authReady;
    requireDb();

    /* Dokument se pojmenovává podle e-mailu, ale po přechodu na Firebase Auth
       podle UID účtu (pravidla si ho umí přečíst jen tak). Proto se dá id
       předat – u úpravy existujícího člověka se použije to jeho. */
    const id = data.id || KB.userId(data.email);
    const payload = {
        email: String(data.email || "").trim().toLowerCase(),
        first: data.first || "",
        last:  data.last || "",
        role:  data.role || "zamestnanec",
        active: data.active !== false,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    };
    // typ spolupráce (zaměstnanec | osvc | student) – jen když ho volající předá
    if (data.typ !== undefined) payload.typ = data.typ || "";
    /* HESLA SE NEUKLÁDAJÍ. Otisk (`hash`+`salt`) i šifrovaná podoba (`enc`)
       tu dřív ležely v `public/data/users`, kam vidí každý člen – kdokoliv
       si je mohl stáhnout a doma lámat. Heslo ověřuje Firebase Auth,
       zapomenuté se řeší odkazem (`KB.sendPasswordReset`).
       (Bezpečnostní audit, Michal 1. 9. 2026.) */
    if (data.createdMs) payload.createdMs = data.createdMs;

    await setDoc(userDoc(id), payload, { merge: true });
    return id;
};

KB.deleteUser = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(userDoc(id));
};

/* ------------------------------------------------------- přihlašování ----
   Firebase Auth, e-mail a heslo. Role se pak čte z users/{uid}. */

KB.signIn = (email, password) => signInWithEmailAndPassword(auth, String(email).trim(), password);
KB.signOut = () => signOut(auth);
KB.currentUid = () => (auth && auth.currentUser) ? auth.currentUser.uid : "";

/** Záložní cesta – pošle člověku odkaz, kterým si heslo nastaví sám. */
KB.sendPasswordReset = (email) => sendPasswordResetEmail(auth, String(email).trim());



/**
 * Založí účet novému člověku. Dělá se to přes DRUHOU instanci Firebase –
 * kdyby se použila ta hlavní, prohlížeč by přihlášeného správce odhlásil
 * a přihlásil jako toho nově založeného.
 */
KB.createAccount = async (email, password) => {
    const app2 = initializeSecondaryApp(FIREBASE_CONFIG, "zakladani-" + Date.now());
    const auth2 = getSecondaryAuth(app2);
    try {
        const cred = await createUserWithEmailAndPassword(auth2, String(email).trim(), password);
        return cred.user.uid;
    } finally {
        await signOutSecondary(auth2).catch(() => {});
    }
};

/* ------------------------------------------------------------- záloha ----
   Firestore na free tarifu nezálohuje. Tohle vysype celý obsah databáze
   do jednoho JSON souboru, včetně obrázků u návodů a obsahu tabulí.
   Otisky ani šifrovaná hesla se do zálohy nedávají – záloha se ukládá
   na disk a neměla by to být kopie přihlašovacích údajů. */

KB.exportAll = async (onProgress) => {
    if (authReady) await authReady;
    requireDb();

    const krok = (text) => { if (onProgress) onProgress(text); };

    krok("návody");
    const guides = [];
    for (const guide of KB.guides) {
        const images = await KB.loadImages(guide.id).catch(() => ({}));
        guides.push(Object.assign({}, guide, { _images: images }));
    }

    krok("tabule");
    const boards = [];
    for (const board of KB.boards) {
        const body = await getDoc(boardBody(board.id)).catch(() => null);
        const imgs = await getDocs(boardImages(board.id)).catch(() => null);
        const images = {};
        if (imgs) imgs.forEach(d => { images[d.id] = d.data(); });
        boards.push(Object.assign({}, board, {
            _content: body && body.exists() ? body.data() : null,
            _images: images
        }));
    }

    krok("úkoly a číselníky");
    // u lidí schválně bez salt/hash/enc – ať záloha není seznam hesel
    const users = KB.users.map(u => ({
        id: u.id, email: u.email, first: u.first, last: u.last,
        role: u.role, active: u.active !== false
    }));

    return {
        _info: "Záloha Pasport Kaňa – hesla ani jejich otisky záloha neobsahuje.",
        _vytvoreno: new Date().toISOString(),
        _kdo: window.KB_USER || "",
        guides: guides,
        tasks: KB.tasks,
        users: users,
        boards: boards,
        meta: {
            zakazky: KB.zakazky,
            zakazkyClosed: KB.zakazkyClosed,
            skupiny: KB.skupiny
        }
    };
};





/* ---------------------------------------------------------------- tabule --
   Hlavička tabule (název, kdo a kdy naposledy kreslil) je samostatný malý
   dokument, aby se seznam tabulí načítal rychle. Prvky jsou v podkolekci
   `content/data` a obrázky zvlášť, stejně jako u návodů.               */

KB.newBoardId = () => "board_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

KB.saveBoardMeta = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    /* Zapisuje se JEN to, co volající opravdu poslal.
       `merge: true` totiž slučuje dokumenty po polích, ne po tom, co je
       v nich zajímavé – a co se do zápisu dostane, to přepíše. Když se
       tady vyplňovaly náhradní hodnoty („Bez názvu", dnešní datum, moje
       uid), stačilo uložit viditelnost a tabule se tím přejmenovala,
       přepsala si datum založení a přepsala zakladatele na toho, kdo
       zrovna klikl. */
    const zaklad = {
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    };
    if (data.title !== undefined)      zaklad.title = data.title || "Bez názvu";
    if (data.createdMs !== undefined)  zaklad.createdMs = data.createdMs;
    if (data.createdBy !== undefined)  zaklad.createdBy = data.createdBy;
    if (data.createdUid !== undefined) zaklad.createdUid = data.createdUid;
    if (data.viditelnost) {
        zaklad.viditelnost = data.viditelnost === "vybrani" ? "vybrani" : "vsichni";
        zaklad.proUids = Array.isArray(data.proUids) ? data.proUids.slice() : [];
    }
    await setDoc(boardDoc(id), zaklad, { merge: true });
    return id;
};

/**
 * Vidí tenhle člověk tuhle tabuli?
 *
 * POZOR – tohle je pořádek, ne zámek. Tabule leží v `public/data`, kde má
 * podle pravidel čtení každý přihlášený, takže omezení platí ve webu, ne
 * v databázi. Na opravdu citlivé věci je potřeba tabule nejdřív přestěhovat
 * mimo `public/data` (jako výkazy) – do té doby sem takové věci nepatří.
 */
KB.tabuleViditelna = (board) => {
    if (!board) return false;
    if (board.viditelnost !== "vybrani") return true;      // starší tabule = pro všechny
    const uid = KB.currentUid();
    if (!uid) return false;
    if (board.createdUid === uid) return true;              // zakladatel o ni nepřijde
    if (window.KBUI && window.KBUI.isAdmin && window.KBUI.isAdmin()) return true;   // manažer vidí všechny
    return Array.isArray(board.proUids) && board.proUids.indexOf(uid) !== -1;
};

/** Tabule, které smí přihlášený vidět – v pořadí od naposledy upravované. */
KB.tabuleProMne = () => (KB.boards || []).filter(KB.tabuleViditelna);

/** Uloží prvky tabule. `stamp` pozná vlastní zápis od cizího při živé synchronizaci. */
KB.saveBoard = async (id, elements, stamp) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(boardBody(id), {
        elements: elements || [],
        stamp: stamp || "",
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    });
};

KB.getBoard = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(boardBody(id));
    return snap.exists() ? snap.data() : { elements: [] };
};

/** Živé sledování obsahu tabule – vrací funkci pro odhlášení. */
KB.watchBoard = (id, handler) => {
    if (!db) return () => {};
    return onSnapshot(boardBody(id), (snap) => {
        if (snap.exists()) handler(snap.data());
    }, (err) => console.error("Chyba čtení tabule:", err));
};

KB.deleteBoard = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const imgs = await getDocs(boardImages(id));
    await Promise.all(imgs.docs.map(d => deleteDoc(boardImage(id, d.id))));
    await deleteDoc(boardBody(id)).catch(() => {});
    await deleteDoc(boardDoc(id));
};

/* ---------------------------------------------------------------- auta ----
   Dva druhy záznamu v jedné kolekci, liší se polem `druh`:

     druh: "brno"       { datum, uid, jmeno }            – kdo který den jede
     druh: "rezervace"  { auto, od, do, uid, jmeno, kam } – kdo si bere vůz

   Jedna kolekce proto, že obojí je „kdo, kdy, s čím" a v panelu se to čte
   pohromadě; dělit to na dvě by znamenalo dva odběry pro totéž.            */

KB.newAutoId = () => "auto_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

KB.saveAuto = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(autoDoc(id), {
        druh:   data.druh === "rezervace" ? "rezervace" : "brno",
        datum:  data.datum || "",              // u zápisu na den
        auto:   data.auto || "",               // u rezervace
        od:     data.od || data.datum || "",   // společné řazení
        do:     data.do || data.datum || "",
        kam:    String(data.kam || "").slice(0, 200),
        /* `uid` je ten, kdo jede – nemusí to být ten, kdo zápis pořídil.
           Kdo veze partu, přihlásí kolegy za ně; `zapsalUid` proto drží
           autora zápisu a pravidla ho pouštějí i k cizímu jménu. */
        uid:    data.uid || KB.currentUid(),
        jmeno:  data.jmeno || window.KB_USER || "",
        zapsalUid: data.zapsalUid || KB.currentUid(),
        ms:     data.ms || Date.now()
    }, { merge: true });
    /* Do historie aktivit, ať je v Reportu vidět i domluva o autech
       (přání Michala 1. 9. 2026). */
    KB.zapisAktivitu("auto", (data.druh === "rezervace"
        ? "zapsal rezervaci auta " + (data.auto || "")
        : "zapsal cestu do Brna") +
        (data.datum || data.od ? " na " + (data.datum || data.od) : "") +
        (data.jmeno && data.jmeno !== window.KB_USER ? " – " + data.jmeno : ""));
    return id;
};

KB.deleteAuto = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const a = (KB.auta || []).find(x => x.id === id);
    await deleteDoc(autoDoc(id));
    KB.zapisAktivitu("auto", "smazal zápis auta" +
        (a && (a.datum || a.od) ? " na " + (a.datum || a.od) : ""));
};

/* ------------------------------------------ odbavená upozornění -----------
   Manažer si u upozornění na nástěnce odškrtne, že je to v pořádku (noční
   směna, dvě práce v jeden čas omylem zapsané správně…). Seznam odbavených
   leží v `private`, kam vidí jen manažeři – jsou to poznámky o cizích
   výkazech, ne firemní číselník. Je to jeden dokument s polem klíčů;
   je jich pár desítek, takže se to nevyplatí rozpadat na dokumenty.      */

const kontrolaDoc = () => doc(db, "artifacts", APP_ID, "private", "kontrola", "seznam", "vyrizeno");

KB.nactiKontrolaOk = async () => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(kontrolaDoc());
    const data = snap.exists() ? snap.data() : {};
    return Array.isArray(data.klice) ? data.klice : [];
};

KB.ulozKontrolaOk = async (klice) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(kontrolaDoc(), {
        klice: Array.isArray(klice) ? klice : [],
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    });
};

/* ------------------------------------------------- přesun starých tabulí --
   Tabule se stěhovaly z `public/data/boards` do `private/tabule/seznam`.
   Přesun se nedělá sám: běží ho hlavní správce jednou, tlačítkem na stránce
   Import dat. Nejdřív se všechno **zkopíruje** (`KB.presunTabule`) a teprve
   po ověření, že tabule v novém umístění fungují, se staré smažou
   (`KB.smazStareTabule`) – kdyby se kopírování rozbilo v půlce, data
   pořád leží na původním místě.                                          */

/** Kolik tabulí ještě leží na starém místě (0 = uklizeno). */
KB.pocetStarychTabuli = async () => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(stareBoardsCol());
    return snap.size;
};

/**
 * Zkopíruje tabule i s obsahem a obrázky na nové místo. Staré nechává být.
 * @param {Function} hlas – volá se po každé tabuli (hotovo, celkem, název)
 */
KB.presunTabule = async (hlas) => {
    if (authReady) await authReady;
    requireDb();
    const stare = await getDocs(stareBoardsCol());
    let tabuli = 0, obrazku = 0;

    for (const d of stare.docs) {
        const data = d.data() || {};
        /* Staré tabule viditelnost neřešily – jsou pro všechny. Musí ji mít
           zapsanou, jinak by je nenašel dotaz `viditelnost == "vsichni"`
           a v seznamu by nebyly vidět vůbec. */
        await setDoc(boardDoc(d.id), Object.assign({}, data, {
            viditelnost: data.viditelnost === "vybrani" ? "vybrani" : "vsichni",
            proUids: Array.isArray(data.proUids) ? data.proUids : [],
            createdUid: data.createdUid || ""
        }), { merge: true });

        const telo = await getDoc(stareBoardBody(d.id)).catch(() => null);
        if (telo && telo.exists()) await setDoc(boardBody(d.id), telo.data());

        const obrazky = await getDocs(stareBoardImages(d.id)).catch(() => null);
        if (obrazky) {
            for (const o of obrazky.docs) {
                await setDoc(boardImage(d.id, o.id), o.data());
                obrazku++;
            }
        }
        tabuli++;
        if (hlas) hlas(tabuli, stare.docs.length, data.title || d.id);
    }
    return { tabuli: tabuli, obrazku: obrazku };
};

/** Úklid původního umístění – až když nové tabule prokazatelně fungují. */
KB.smazStareTabule = async () => {
    if (authReady) await authReady;
    requireDb();
    const stare = await getDocs(stareBoardsCol());
    let tabuli = 0;
    for (const d of stare.docs) {
        const obrazky = await getDocs(stareBoardImages(d.id)).catch(() => null);
        if (obrazky) await Promise.all(obrazky.docs.map(o => deleteDoc(stareBoardImage(d.id, o.id))));
        await deleteDoc(stareBoardBody(d.id)).catch(() => {});
        await deleteDoc(stareBoardDoc(d.id));
        tabuli++;
    }
    return { tabuli: tabuli };
};

KB.saveBoardImage = async (boardId, imgId, dataUrl, meta = {}) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(boardImage(boardId, imgId), {
        data: dataUrl, w: meta.w || 0, h: meta.h || 0, createdAt: serverTimestamp()
    });
};

KB.loadBoardImages = async (boardId) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(boardImages(boardId));
    const map = {};
    snap.forEach(d => { map[d.id] = d.data().data; });
    return map;
};

/* ---------------------------------------------------------------- výkazy --
   Jeden dokument = jedna položka práce, ne celý den. Den se skládá z položek,
   protože ráno se fotí a odpoledne kreslí do ArcGIS – a přesně tyhle části
   se pak sčítají zvlášť. Kdyby byl dokumentem celý den, muselo by se to
   rozpadat až při čtení a nedalo by se to pořádně filtrovat.

   Položka:
     { uid, osoba, datum:"2026-08-12", nazev, zakazka, firma,
       cinnost:"FOCENÍ", technologie:"VZT", od:"07:30", do:"16:00",
       pauza:30, hodiny:8.5, sazba:100, castka:850, poznamka }

   `hodiny` a `castka` se ukládají dopočítané. Je to úmyslná duplicita:
   sazba se časem mění a přehled za loňský rok musí zůstat takový, jaký byl
   ve chvíli zápisu – ne přepočítaný dnešními čísly. */

/* Čas a peníze chodí ze dvou kolekcí. Držíme si je zvlášť a po každé změně
   je spojíme do jednoho pole – stránky pak pracují s jedním záznamem a je
   jim jedno, odkud která hodnota přišla. */
let syroveZaznamy = [];
let syroveCastky = {};

/* Starší období dotažená na vyžádání (mimo živé okno). Drží se zvlášť,
   aby je příští snímek živého odběru nesmazal. */
let starsiZaznamy = [];
let starsiCastky = {};

function spojVykazy() {
    const zive = new Set(syroveZaznamy.map(z => z.id));
    const vsechny = syroveZaznamy.concat(starsiZaznamy.filter(z => !zive.has(z.id)));
    const castky = Object.assign({}, starsiCastky, syroveCastky);
    KB.vykazy = vsechny.map(z => Object.assign(
        { sazba: 0, castka: 0 }, z, castky[z.id] || {}));
    // nejnovější nahoře; ve stejném dni se řadí podle začátku práce
    KB.vykazy.sort((a, b) => (b.datum || "").localeCompare(a.datum || "")
        || (a.od || "").localeCompare(b.od || ""));
    emit("vykazy", KB.vykazy);
}

/**
 * Dotáhne výkazy staršího období, které živé okno nepokrývá. Volá se ze
 * stránek, kde si člověk vybere delší rozsah (přehled, vytížení, filtr
 * výkazů). Jednorázový dotaz, ne odběr – historie se stejně nemění.
 * @returns {Promise<number>} kolik záznamů přibylo
 */
KB.nactiVykazyRozsah = async (od, doKdy) => {
    if (authReady) await authReady;
    requireDb();
    const zacatek = String(od || "").slice(0, 10);
    const konec = String(doKdy || "9999-12-31").slice(0, 10);
    if (!zacatek || (KB.vykazyOknoOd && zacatek >= KB.vykazyOknoOd)) return 0;

    const jenSve = vykazyRezim === "moje";
    const meze = [where("datum", ">=", zacatek), where("datum", "<=", konec)];
    const dotazZ = jenSve
        ? query(vykazyCol(), where("uid", "==", auth.currentUser.uid), ...meze)
        : query(vykazyCol(), ...meze);
    const snapZ = await getDocs(dotazZ);
    const nove = [];
    snapZ.forEach(d => nove.push({ id: d.id, ...d.data() }));

    const znam = new Set(starsiZaznamy.map(z => z.id));
    nove.forEach(z => { if (!znam.has(z.id)) starsiZaznamy.push(z); });

    if (!jenSve) {
        const snapC = await getDocs(query(castkyCol(), ...meze));
        snapC.forEach(d => { starsiCastky[d.id] = d.data(); });
    }
    spojVykazy();
    return nove.length;
};

/* POSUVNÉ OKNO. Manažer poslouchal úplně všechny výkazy od začátku –
   dneska pár desítek, po roce provozu ale desítky tisíc dokumentů na
   KAŽDÉ otevření stránky (a stejně tolik částek). Živě se proto drží jen
   posledních pár měsíců; starší období si stránka vyžádá dotazem
   `KB.nactiVykazyRozsah`, když si ho člověk vybere.
   Zaměstnanec má svoje záznamy bez omezení – je jich řádově míň. */
const OKNO_MESICU = 4;

function oknoOd() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (OKNO_MESICU - 1));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
}

function sledujVykazy(jenSve) {
    if (!db || !auth || !auth.currentUser) return;

    KB.vykazyOknoOd = jenSve ? "" : oknoOd();

    /* Pravidla nejsou filtr: kdo nesmí číst cizí zápisy, musí si o svoje říct
       dotazem, jinak Firestore odmítne celý přenos. */
    const zdroj = jenSve
        ? query(vykazyCol(), where("uid", "==", auth.currentUser.uid))
        : query(vykazyCol(), where("datum", ">=", KB.vykazyOknoOd));

    vykazyOdbery.push(onSnapshot(zdroj, (snapshot) => {
        syroveZaznamy = [];
        snapshot.forEach(d => syroveZaznamy.push({ id: d.id, ...d.data() }));
        /* U manažerů emituje „vykazy" i odběr částek – ten ale umí doběhnout
           DŘÍV než samotné záznamy a hlídka výkazů by pak rozhodovala nad
           prázdnem a rozdávala falešné vzkazy. Tenhle příznak říká, že už
           dorazily skutečné záznamy. */
        KB.vykazyPrisly = true;
        spojVykazy();
    }, (err) => {
        console.error("Chyba čtení výkazů:", err);
        emit("vykazy-chyba", err);
    }));

    if (jenSve) return;      // částky ani sazby zaměstnanci nepatří

    vykazyOdbery.push(onSnapshot(
        query(castkyCol(), where("datum", ">=", KB.vykazyOknoOd)), (snapshot) => {
        syroveCastky = {};
        snapshot.forEach(d => { syroveCastky[d.id] = d.data(); });
        spojVykazy();
    }, (err) => console.error("Chyba čtení částek:", err)));

    vykazyOdbery.push(onSnapshot(vykazyMeta(), (snap) => {
        const data = snap.exists() ? snap.data() : {};
        // prázdný uložený číselník nesmí přebít výchozí hodnoty z kódu
        KB.cinnosti = (Array.isArray(data.cinnosti) && data.cinnosti.length)
            ? data.cinnosti : KB.DEFAULT_CINNOSTI.slice();
        KB.technologie = (Array.isArray(data.technologie) && data.technologie.length)
            ? data.technologie : KB.DEFAULT_TECHNOLOGIE.slice();
        KB.sazby = (data.sazby && typeof data.sazby === "object") ? data.sazby : {};
        KB.rozpocty = (data.rozpocty && typeof data.rozpocty === "object") ? data.rozpocty : {};
        emit("vykazy-meta", data);
    }, (err) => console.error("Chyba čtení číselníků výkazů:", err)));
}

/** Živý přenos všech výkazů včetně peněz – jen pro správce. */
KB.watchVykazy = async () => {
    vykazyChteno = "vse";
    if (vykazyRezim === "vse") return;
    if (authReady) await authReady;
    if (vykazyRezim === "vse") return;
    // z „jen moje" se povyšuje na plný odběr – starý se musí zrušit
    if (vykazyRezim === "moje") zrusVykazy();
    vykazyRezim = "vse";
    sledujVykazy(false);
};

/** Živý přenos vlastních zápisů bez peněz – pro stránku zaměstnance. */
KB.watchMojeVykazy = async () => {
    if (vykazyRezim) return;            // plný odběr se nikdy nezužuje
    vykazyChteno = "moje";
    if (authReady) await authReady;
    if (vykazyRezim) return;
    vykazyRezim = "moje";
    sledujVykazy(true);
};

KB.newVykazId = () => "vyk_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

/**
 * Odpracované hodiny z časů a pauzy.
 * Konec dřív než začátek se bere jako práce přes půlnoc (22:00–02:00),
 * ne jako chyba – noční směny v provozech se dějí. Překlep se pozná podle
 * toho, že se výsledek hned ukáže u formuláře.
 */
KB.spocitejHodiny = (od, doKdy, pauzaMin) => {
    const minuty = (cas) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(cas || "").trim());
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const a = minuty(od), b = minuty(doKdy);
    if (a === null || b === null) return 0;

    const delka = (b >= a ? b - a : b + 1440 - a) - Math.max(0, Number(pauzaMin) || 0);
    return delka <= 0 ? 0 : Math.round((delka / 60) * 100) / 100;
};

/** Odpracovaný čas – tenhle dokument smí zapsat i vlastník zápisu. */
function zaznamPayload(data) {
    return {
        uid:      data.uid || "",
        osoba:    data.osoba || "",
        datum:    data.datum || "",
        nazev:    data.nazev || "",
        zakazka:  data.zakazka || "",
        projekt:  data.projekt || "",
        firma:    data.firma || "",
        cinnost:  data.cinnost || "",
        technologie: data.technologie || "",
        /* vazba na úkol – z ní se časem spočítá efektivita (budget vs. skutečnost) */
        ukolId:   data.ukolId || "",
        /* budova a patro – ať se dá sečíst, kolik hodin stálo jedno patro;
           nabídka se bere z nastavení projektu ve Správě */
        budova:   data.budova || "",
        patro:    data.patro || "",
        od:       data.od || "",
        do:       data.do || "",
        pauza:    Math.max(0, Number(data.pauza) || 0),
        /* Celodenní absence se zapisuje jako 00:00–23:59, ale do fondu se
           počítá jako běžná směna – jinak by týden dovolené udělal 120 hodin.
           `hodinyPevne` proto přebije výpočet z časů. */
        hodiny:   Number(data.hodinyPevne) > 0
                    ? Number(data.hodinyPevne)
                    : KB.spocitejHodiny(data.od, data.do, data.pauza),
        /* Oběd a kilometry patří k času, ne k tajným částkám – jsou to
           náhrady tomu, kdo pracoval, a ten si na ně musí umět sáhnout.
           Korunová hodnota se z nich dopočítá až v `castky`. */
        obed:     data.obed === true,
        km:       Math.max(0, Number(data.km) || 0),
        /* Dovolená, nemoc a školení se evidují, ale do součtů odpracovaných
           hodin a peněz se nepočítají – V.soucty je podle tohohle pole vynechá. */
        absence:  data.absence === true,
        /* Home office: zapsané hodiny odvedené z domu – jde do sloupce
           v Tabulkách i do budoucích přehledů, kdo kolik dělá na HO. */
        ho:       data.ho === true,
        /* odkud záznam vznikl ("panel" = rychlý zápis) – podle toho smí
           vlastník takový záznam zase smazat (viz firestore.rules) */
        zdroj:    data.zdroj || "",
        poznamka: data.poznamka || "",
        createdMs: data.createdMs || Date.now(),
        createdBy: data.createdBy || window.KB_USER || "",
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    };
}

/* ------------------------------------------- zápis do Google Sheets ---
   Osobní výkazy v Tabulkách Google plní samostatný Apps Script. Web mu po
   uložení pošle JEN ID zápisu; skript si ho sám přečte z databáze, takže
   se přes tuhle cestu nedá do výkazu nic podstrčit.

   Adresa skriptu leží v `meta/gsync` (čtou ji jen členové), ne ve zdroji –
   repozitář je veřejný. Chyba se nikdy nepropíše do ukládání výkazu:
   když zápis do tabulky nevyjde, dožene ho hodinový spouštěč a v reportu
   je vidět, u kterého zápisu se to nepovedlo. */

const gsyncDoc = (id) => doc(db, "artifacts", APP_ID, "private", "vykazy", "gsync", id);
const gsyncCol = () => collection(db, "artifacts", APP_ID, "private", "vykazy", "gsync");

KB.gsync = [];              // stavy zápisů do tabulek (jen manažeři)
KB.gsyncUrl = "";           // adresa Apps Scriptu z meta/gsync

KB.posliDoSheets = (id) => {
    if (!KB.gsyncUrl || !id) return;
    /* text/plain schválně: prohlížeč tak požadavek pošle rovnou, bez
       předletu, který Apps Script neumí odbavit. Odpověď nečteme –
       výsledek si skript zapíše zpátky do databáze. */
    fetch(KB.gsyncUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ id: id })
    }).catch(err => console.warn("Zápis do Tabulek se neozval:", err));
};

KB.zpetnePovoleni = {};

/** Povolení zpětného zápisu – celá mapa { uid: "do kdy" } najednou. */
KB.ulozZpetnePovoleni = async (mapa) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(metaDoc("zpetne"), {
        povoleni: mapa || {},
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    KB.zapisAktivitu("vykaz", "změnil povolení zpětného zápisu");
};

KB.ulozGsyncUrl = async (url) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(metaDoc("gsync"), {
        url: String(url || "").trim(),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
};

let gsyncOdber = null;

/** Stavy zápisů do tabulek – čte je jen report, tedy manažeři. */
KB.watchGsync = async () => {
    if (gsyncOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || gsyncOdber) return;
    gsyncOdber = onSnapshot(query(gsyncCol(), orderBy("ms", "desc"), limit(60)),
        (snapshot) => {
            KB.gsync = [];
            snapshot.forEach(d => KB.gsync.push({ id: d.id, ...d.data() }));
            emit("gsync", KB.gsync);
        }, (err) => console.error("Chyba čtení stavů zápisu do Tabulek:", err));
};

/** Uloží zápis i s penězi – volá stránka správce. */
KB.saveVykaz = async (id, data) => {
    if (authReady) await authReady;
    requireDb();

    const zaznam = zaznamPayload(data);
    const sazba = Math.max(0, Number(data.sazba) || 0);
    const castky = KB.spocitejCastky(zaznam, sazba);

    KB.zapisAktivitu("vykaz", "uložil výkaz " + (zaznam.datum || "") +
        " – " + (zaznam.zakazka || ""));
    await setDoc(vykazDoc(id), zaznam, { merge: true });
    await setDoc(castkaDoc(id), Object.assign({
        sazba: sazba,
        // pár údajů navíc, aby se dalo v částkách hledat i bez druhé kolekce
        uid: zaznam.uid, datum: zaznam.datum, zakazka: zaznam.zakazka,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, castky), { merge: true });
    KB.posliDoSheets(id);
    return id;
};

/**
 * Peníze k zápisu. `castkaPrace` je čistě hodiny × sazba – z ní se počítá
 * průměrná sazba, takže ji paušály nesmí ředit. `castka` je to, co zápis
 * celkem stojí, a ta se sčítá v přehledech i v čerpání rozpočtu.
 */
KB.spocitejCastky = (zaznam, sazba) => {
    const zaokrouhli = (x) => Math.round(x * 100) / 100;
    const prace = zaokrouhli((Number(zaznam.hodiny) || 0) * (Number(sazba) || 0));
    const obedKc = zaznam.obed ? OBED_KC : 0;
    const dopravaKc = zaokrouhli((Number(zaznam.km) || 0) * KM_KC);
    return {
        castkaPrace: prace,
        obedKc: obedKc,
        dopravaKc: dopravaKc,
        castka: zaokrouhli(prace + obedKc + dopravaKc)
    };
};

/**
 * Zápis zaměstnance – jen čas, žádné peníze. Sazbu k němu doplní správce,
 * do té doby je zápis v přehledu za nula korun.
 */
KB.saveMujVykaz = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    if (!uid) throw new Error("Není kdo zapisuje.");
    const zaznam = zaznamPayload(Object.assign({}, data, { uid: uid }));
    KB.zapisAktivitu("vykaz", "uložil výkaz " + (zaznam.datum || "") +
        " – " + (zaznam.zakazka || ""));
    await setDoc(vykazDoc(id), zaznam, { merge: true });
    KB.posliDoSheets(id);
    return id;
};

KB.deleteVykaz = async (id) => {
    if (authReady) await authReady;
    requireDb();
    // co se maže, se do historie píše PŘED smazáním – potom už není co číst
    const z = KB.vykazy.find(v => v.id === id);
    await deleteDoc(vykazDoc(id));
    await deleteDoc(castkaDoc(id)).catch(() => {});
    KB.zapisAktivitu("vykaz", "smazal výkaz " + (z ? (z.datum || "") + " – " +
        (z.osoba || "") + " (" + (z.nazev || "") + ")" : id));
};

/**
 * Tajné číselníky výkazů (sazby lidí, rozpočty zakázek). Zapisuje se jen to,
 * co volající opravdu předá, ať úprava rozpočtu neshodí uložené sazby.
 */
KB.saveVykazNastaveni = async (patch) => {
    if (authReady) await authReady;
    requireDb();

    const payload = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    ["cinnosti", "technologie", "sazby", "rozpocty"].forEach(klic => {
        if (patch[klic] !== undefined) payload[klic] = patch[klic];
    });
    await setDoc(vykazyMeta(), payload, { merge: true });
    /* Změna sazeb a rozpočtů jsou peníze – v historii nesmí chybět,
       i když se z logu nepozná konkrétní číslo (na to je záloha). */
    KB.zapisAktivitu("vykaz", "změnil nastavení výkazů (" +
        Object.keys(patch).join(", ") + ")");
};

/**
 * Netajná část číselníku zakázek – názvy, projekty uvnitř zakázky a firmy.
 * Leží v `meta/zakazky` vedle skupin úkolů, aby si je u svého výkazu mohl
 * vybrat i zaměstnanec. Zapisuje se přírůstkově ze stejného důvodu jako výše.
 */
/**
 * Jednorázový přesun zákaznické databáze z veřejného číselníku do `private`
 * (bezpečnostní audit 1. 9. 2026). Nejdřív zkopíruje, ověří a teprve pak
 * maže – kdyby se to rozbilo v půlce, data pořád leží na původním místě.
 * Pouští se ručně z konzole, spustit jde opakovaně.
 */
KB.presunFirmyDoPrivate = async () => {
    if (authReady) await authReady;
    requireDb();
    const verejne = await getDoc(metaDoc("zakazky"));
    const data = verejne.exists() ? verejne.data() : {};
    const mapa = (data.firmaMap && typeof data.firmaMap === "object") ? data.firmaMap : null;
    const detail = (data.firmyDetail && typeof data.firmyDetail === "object") ? data.firmyDetail : null;
    if (!mapa && !detail) return { presunuto: false, duvod: "ve veřejném číselníku už nic není" };

    await KB.ulozFirmyDetail({
        firmaMap: mapa || {}, firmyDetail: detail || {}
    });
    // ověření, že to na novém místě opravdu je
    const nove = await getDoc(firmyDetailDoc());
    const n = nove.exists() ? nove.data() : {};
    if (Object.keys(n.firmaMap || {}).length !== Object.keys(mapa || {}).length ||
        Object.keys(n.firmyDetail || {}).length !== Object.keys(detail || {}).length) {
        return { presunuto: false, duvod: "kopie nesedí, veřejné se nemaže" };
    }
    await setDoc(metaDoc("zakazky"), {
        firmaMap: deleteField(), firmyDetail: deleteField()
    }, { merge: true });
    KB.zapisAktivitu("navod", "přesunul zákaznické údaje (firmy a jejich projekty) do neveřejné části");
    return { presunuto: true, firem: Object.keys(detail || {}).length,
             projektu: Object.keys(mapa || {}).length };
};

let firmyOdber = null;

/** Zákaznická databáze – jen pro manažerské stránky (faktury, firmy, správa). */
KB.watchFirmyDetail = async () => {
    if (firmyOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || firmyOdber) return;
    firmyOdber = onSnapshot(firmyDetailDoc(), (snap) => {
        const data = snap.exists() ? snap.data() : {};
        KB.firmaMap = (data.firmaMap && typeof data.firmaMap === "object") ? data.firmaMap : {};
        KB.firmyDetail = (data.firmyDetail && typeof data.firmyDetail === "object")
            ? data.firmyDetail : {};
        emit("firmy-detail", KB.firmyDetail);
    }, (err) => console.error("Chyba čtení zákaznických údajů:", err));
};

/** Zápis zákaznických údajů – míří do `private`, ne do veřejného číselníku. */
KB.ulozFirmyDetail = async (patch) => {
    if (authReady) await authReady;
    requireDb();
    const payload = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    ["firmaMap", "firmyDetail"].forEach(klic => {
        if (patch[klic] !== undefined) payload[klic] = patch[klic];
    });
    await setDoc(firmyDetailDoc(), payload, { merge: true });
};

KB.saveCiselnikZakazek = async (patch) => {
    if (authReady) await authReady;
    requireDb();

    const payload = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    ["names", "closed", "groups", "projekty", "firmy",
     "budget", "oblibeneIds"].forEach(klic => {
        if (patch[klic] !== undefined) payload[klic] = patch[klic];
    });
    await setDoc(metaDoc("zakazky"), payload, { merge: true });
    /* Zákaznické údaje jdou do `private` – volající je pořád posílá spolu
       se zbytkem číselníku, přesměruje se to tady na jednom místě. */
    if (patch.firmaMap !== undefined || patch.firmyDetail !== undefined) {
        await KB.ulozFirmyDetail(patch);
    }
};

/* ----------------------------------------------------------- projekty ----
   Hlavička projektu je v `private/projekty/seznam` – zaměstnanec dostane
   jen ty, kde je v poli `lide`. Peníze (příjmy, výdaje, rozpočet) jsou
   v `private/projekty/finance` pod stejným {id} a čtou je jen manažeři –
   stejný trik jako u výkazů, protože pravidla neumí schovat jednotlivá pole.

   Hlavička: { cislo:"2024-007", nazev, firma, manazer:uid, zacatek:"2024-01-10",
               konec:"", stav:"bezi", priorita:"nizka|stredni|vysoka|resit-okamzite",
               uzavreno:false, lide:[uid], poznamka }                        */

function sledujProjekty(jenSve) {
    if (!db || !auth || !auth.currentUser) return;
    const zdroj = jenSve
        ? query(projektyCol(), where("lide", "array-contains", auth.currentUser.uid))
        : projektyCol();
    projektyOdber = onSnapshot(zdroj, (snapshot) => {
        KB.projektyDocs = [];
        snapshot.forEach(d => KB.projektyDocs.push({ id: d.id, ...d.data() }));
        KB.projektyDocs.sort((a, b) => (a.cislo || "9999").localeCompare(b.cislo || "9999")
            || (a.nazev || "").localeCompare(b.nazev || "", "cs"));
        emit("projekty-docs", KB.projektyDocs);
    }, (err) => console.error("Chyba čtení projektů:", err));
}

/** Živý přenos všech projektů – pro manažery. */
KB.watchProjekty = async () => {
    projektyChteno = "vse";
    if (projektyRezim === "vse") return;
    if (authReady) await authReady;
    if (projektyRezim === "vse") return;
    if (projektyOdber) { try { projektyOdber(); } catch (e) {} projektyOdber = null; }
    projektyRezim = "vse";
    sledujProjekty(false);
};

/** Živý přenos projektů, ke kterým je člověk přiřazený. */
KB.watchMojeProjekty = async () => {
    if (projektyRezim) return;
    projektyChteno = "moje";
    if (authReady) await authReady;
    if (projektyRezim) return;
    projektyRezim = "moje";
    sledujProjekty(true);
};

KB.newProjektId = () => "prj_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

/**
 * Uloží do projektu jen vyjmenovaná pole (merge) – na šablony TO-DO
 * a podobné části, které se neupravují ve formuláři Údajů. saveProjekt
 * se na tohle nehodí: skládá celý dokument a nevyplněná pole by vynuloval.
 */
KB.ulozProjektCasti = async (id, patch) => {
    if (authReady) await authReady;
    requireDb();
    /* `zpetne`: projekt bez uzávěrky – zpětné doplnění hodin (2026-027).
       Nemá zaškrtávátko; zapíná se ručně a jednou na něm bude stát
       obrazovka „manažer povolí zpětný zápis". */
    const povolena = ["sablony", "technologie", "zpetne", "bezSheets"];
    const payload = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    povolena.forEach(klic => {
        if (patch[klic] !== undefined) payload[klic] = patch[klic];
    });
    await setDoc(projektDoc(id), payload, { merge: true });
};

KB.saveProjekt = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    // manažerů může být víc; `manazer` zůstává kvůli starším záznamům
    const manazeri = Array.isArray(data.manazeri) ? data.manazeri
        : (data.manazer ? [data.manazer] : []);
    await setDoc(projektDoc(id), {
        cislo:    data.cislo || "",
        nazev:    data.nazev || "Bez názvu",
        firma:    data.firma || "",
        /* Objednatel platí fakturu, zákazník je ten, pro koho je práce
           nakonec — u subdodávek to není totéž. */
        objednatel: data.objednatel || "",
        zakaznik:   data.zakaznik || "",
        /* Rodinné domy a drobné zakázky se nedělí na budovy, patra ani
           technologie; v Plnění se jim místo matice ukáže souhrn práce. */
        jednoduchy: data.jednoduchy === true,
        manazeri: manazeri,
        manazer:  manazeri[0] || "",
        zacatek:  data.zacatek || "",
        konec:    data.konec || "",
        stav:     data.stav || "",             // volný text: „kreslí se G61" apod.
        /* Fáze zakázky (poptávka → fakturace). Poslední z nich projekt
           uzavírá, `uzavreno` se z ní odvozuje ve Správě. */
        faze:     data.faze || "",
        priorita: data.priorita || "stredni",
        uzavreno: data.uzavreno === true,
        lide:     Array.isArray(data.lide) ? data.lide : [],
        /* kdo z přiřazených dělá kterou technologii: { uid: ["TER", "VZT"] }
           – z toho se počítají průměrné sazby na technologii */
        lideTech: (data.lideTech && typeof data.lideTech === "object") ? data.lideTech : {},
        poznamka: data.poznamka || "",
        createdMs: data.createdMs || Date.now(),
        createdBy: data.createdBy || window.KB_USER || "",
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    KB.zapisAktivitu("projekt", "uložil projekt " + (data.nazev || ""));
    return id;
};

/** Peníze projektu – zapisují a čtou jen manažeři. */
KB.saveProjektFinance = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(projektFinanceDoc(id), {
        prijmy: Math.max(0, Number(data.prijmy) || 0),
        vydaje: Math.max(0, Number(data.vydaje) || 0),
        rozpocetKc: Math.max(0, Number(data.rozpocetKc) || 0),
        rozpocetHodiny: Math.max(0, Number(data.rozpocetHodiny) || 0),
        /* Externí náklady – co na zakázce stojí peníze, ale není to ničí
           odpracovaná hodina (geodet, tisk, doprava od subdodavatele).
           Všechno bez DPH, jako zbytek webu. */
        naklady: Array.isArray(data.naklady) ? data.naklady.map(n => ({
            id:        String(n.id || ""),
            dodavatel: String(n.dodavatel || "").slice(0, 120),
            popis:     String(n.popis || "").slice(0, 200),
            castka:    Math.max(0, Number(n.castka) || 0),
            datum:     String(n.datum || ""),
            kdo:       String(n.kdo || ""),
            ms:        Number(n.ms) || 0
        })) : [],
        poznamka: data.poznamka || "",
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
};

KB.loadProjektFinance = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(projektFinanceDoc(id));
    return snap.exists() ? snap.data() : null;
};

KB.deleteProjekt = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(projektDoc(id));
    await deleteDoc(projektFinanceDoc(id)).catch(() => {});
};


/* ------------------------------------------------------------- faktury ----
   Fakturační středisko. Faktura nese částky, proto leží CELÁ v `private`
   a čtou i píší ji jen manažeři – kryje ji spodní zachytávací pravidlo pro
   `private/{document=**}` (správce), takže nové nasazení pravidel není
   kvůli fakturám potřeba.

     private/faktury/seznam/{id}       faktura (přijatá i vydaná) vč. částek
     private/faktury/meta/nastaveni    naše fakturační údaje pro tisk

   Faktura: { typ:"prijata|vydana", cislo, protistrana, ico, dic, adresa,
              projekt (název – stejně jako u výkazů), castkaBez, dphSazba,
              castkaDph, castkaCelkem, vs, vystaveno:"2026-08-21", duzp,
              splatnost, uhrazeno:"", stav:"nova|zarazena|schvalena|zaplacena",
              polozky:[{ popis, mnozstvi, mj, cena, dph }], cesta (kde na
              disku leží PDF), poznamka }                                   */

const fakturyCol = () => collection(db, "artifacts", APP_ID, "private", "faktury", "seznam");
const fakturaDoc = (id) => doc(db, "artifacts", APP_ID, "private", "faktury", "seznam", id);
const fakturyNastaveniDoc = () => doc(db, "artifacts", APP_ID, "private", "faktury", "meta", "nastaveni");

let fakturyOdber = null;

/** Živý přenos faktur – volají ho jen manažerské stránky. */
KB.watchFaktury = async () => {
    if (fakturyOdber) return;
    if (authReady) await authReady;
    if (fakturyOdber || !db || !auth || !auth.currentUser) return;
    fakturyOdber = onSnapshot(fakturyCol(), (snapshot) => {
        KB.faktury = [];
        snapshot.forEach(d => KB.faktury.push({ id: d.id, ...d.data() }));
        // nejnovější nahoře; bez data vystavení dozadu
        KB.faktury.sort((a, b) => (b.vystaveno || "").localeCompare(a.vystaveno || "")
            || (b.createdMs || 0) - (a.createdMs || 0));
        emit("faktury", KB.faktury);
    }, (err) => console.error("Chyba čtení faktur:", err));
};

KB.newFakturaId = () => "fak_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

KB.saveFaktura = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(fakturaDoc(id), {
        typ:          data.typ === "vydana" ? "vydana" : "prijata",
        cislo:        data.cislo || "",
        protistrana:  data.protistrana || "",
        ico:          data.ico || "",
        dic:          data.dic || "",
        adresa:       data.adresa || "",
        projekt:      data.projekt || "",
        castkaBez:    Number(data.castkaBez) || 0,
        dphSazba:     Number(data.dphSazba) || 0,
        castkaDph:    Number(data.castkaDph) || 0,
        castkaCelkem: Number(data.castkaCelkem) || 0,
        vs:           data.vs || "",
        vystaveno:    data.vystaveno || "",
        duzp:         data.duzp || "",
        splatnost:    data.splatnost || "",
        uhrazeno:     data.uhrazeno || "",
        stav:         data.stav || "nova",
        polozky:      Array.isArray(data.polozky) ? data.polozky : [],
        cesta:        data.cesta || "",
        poznamka:     data.poznamka || "",
        createdMs:    data.createdMs || Date.now(),
        createdBy:    data.createdBy || window.KB_USER || "",
        updatedMs:    Date.now(),
        updatedBy:    window.KB_USER || ""
    }, { merge: true });
    // do aktivit schválně bez částek – stačí, co se stalo a k čemu
    KB.zapisAktivitu("faktura", "uložil fakturu " + (data.cislo || "(bez čísla)") +
        (data.projekt ? " k projektu " + data.projekt : ""));
    return id;
};

KB.deleteFaktura = async (id, cislo) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(fakturaDoc(id));
    KB.zapisAktivitu("faktura", "smazal fakturu " + (cislo || ""));
};

KB.loadFakturaNastaveni = async () => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(fakturyNastaveniDoc());
    return snap.exists() ? snap.data() : {};
};

KB.saveFakturaNastaveni = async (data) => {
    if (authReady) await authReady;
    requireDb();
    const payload = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    ["nazev", "adresa", "ico", "dic", "banka", "ucet", "registrace", "rada"].forEach(klic => {
        if (data[klic] !== undefined) payload[klic] = String(data[klic] || "");
    });
    if (data.ostry !== undefined) payload.ostry = data.ostry === true;
    await setDoc(fakturyNastaveniDoc(), payload, { merge: true });
};

/** Jednorázové načtení rozpočtů zakázek (bez odběru všech výkazů) – pro
    souhrn čerpání ve fakturách. Číselník smí číst jen manažer. */
KB.loadRozpocty = async () => {
    if (authReady) await authReady;
    requireDb();
    try {
        const snap = await getDoc(vykazyMeta());
        const data = snap.exists() ? snap.data() : {};
        return (data.rozpocty && typeof data.rozpocty === "object") ? data.rozpocty : {};
    } catch (err) { return {}; }
};

/* -------------------------------------------------------------- úkoly ----
   Úkol = kus práce s budgetem hodin, přiřazený konkrétním lidem. Postup se
   zapisuje do TO-DO položek (dřív „postup práce"). Zaměstnanec smí podle
   pravidel měnit jen `todo` a `stav` – na to je KB.ulozUkolPostup, který
   nic jiného neposílá.

   Úkol: { projektId, projekt (název – ať se výpis obejde bez druhého čtení),
           nazev, druh:"ArcGIS|Focení|Skeny|Tabulky", technologie:"SLN",
           budova:"G61", patro:"1NP", prirazeni:[uid], termin:"2026-09-30",
           budgetHodin: 120, stav:"otevreny|hotovo",
           todo:[{ id, text, pct, by, ms }], poznamka }                     */

function sledujUkoly(jenSve) {
    if (!db || !auth || !auth.currentUser) return;
    const zdroj = jenSve
        ? query(ukolyCol(), where("prirazeni", "array-contains", auth.currentUser.uid))
        : ukolyCol();
    ukolyOdber = onSnapshot(zdroj, (snapshot) => {
        KB.ukoly = [];
        snapshot.forEach(d => KB.ukoly.push({ id: d.id, ...d.data() }));
        // nejbližší termín nahoře, bez termínu na konec
        KB.ukoly.sort((a, b) => (a.termin || "9999").localeCompare(b.termin || "9999"));
        emit("ukoly", KB.ukoly);
    }, (err) => console.error("Chyba čtení úkolů:", err));
}

/* ------------------------------------------------------ budgety úkolů ----
   Budget a rezerva úkolu v hodinách. Vedlejší dokument se stejným {id} jako
   úkol – v dokumentu úkolu být nesmí, protože ten čte každý člen a pravidla
   neumí schovat pole. Kolekce leží v `private`, kam vidí jen manažeři
   (spodní pravidlo pro `private/{document=**}`), takže zaměstnanec budget
   neuvidí ani dotazem mimo web. */

const ukolBudgetyCol = () => collection(db, "artifacts", APP_ID, "private", "ukoly", "budgety");
const ukolBudgetDoc = (id) => doc(db, "artifacts", APP_ID, "private", "ukoly", "budgety", id);

let ukolBudgetyOdber = null;

/** Živý přenos budgetů úkolů – volají ho jen manažerské stránky. */
KB.watchUkolyBudgety = async () => {
    if (ukolBudgetyOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || ukolBudgetyOdber) return;
    ukolBudgetyOdber = onSnapshot(ukolBudgetyCol(), (snapshot) => {
        KB.ukolBudgety = {};
        snapshot.forEach(d => { KB.ukolBudgety[d.id] = d.data(); });
        emit("ukoly-budgety", KB.ukolBudgety);
    }, (err) => console.error("Chyba čtení budgetů úkolů:", err));
};

KB.ulozUkolBudget = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    /* Budget úkolu je v PENĚZÍCH (změna 19. 8. večer) – hodiny se u úkolů
       nezapisují, každý má jinou hodinovku a pletlo by se to. Starší pole
       budgetHodin/rezervaHodin se ignorují. */
    await setDoc(ukolBudgetDoc(id), {
        budgetKc:  Math.max(0, Number(data.budgetKc) || 0),
        rezervaKc: Math.max(0, Number(data.rezervaKc) || 0),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    const ukolBudgetu = (KB.ukoly || []).find(x => x.id === id);
    KB.zapisAktivitu("ukol", "změnil budget úkolu " +
        (ukolBudgetu ? ukolBudgetu.nazev : id));
};

/** Živý přenos všech úkolů – pro manažery. */
KB.watchUkoly = async () => {
    ukolyChteno = "vse";
    if (ukolyRezim === "vse") return;
    if (authReady) await authReady;
    if (ukolyRezim === "vse") return;
    if (ukolyOdber) { try { ukolyOdber(); } catch (e) {} ukolyOdber = null; }
    ukolyRezim = "vse";
    sledujUkoly(false);
};

/** Živý přenos úkolů přiřazených přihlášenému. */
KB.watchMojeUkoly = async () => {
    if (ukolyRezim) return;
    ukolyChteno = "moje";
    if (authReady) await authReady;
    if (ukolyRezim) return;
    ukolyRezim = "moje";
    sledujUkoly(true);
};

KB.newUkolId = () => "ukl_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

/** Uloží celý úkol – manažerská cesta (pravidla pustí jen správce). */
KB.saveUkol = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(ukolDoc(id), {
        importId:  data.importId || "",     // odkud byl převzat ze starého postupu práce
        projektId: data.projektId || "",
        projekt:   data.projekt || "",
        nazev:     data.nazev || "Bez názvu",
        druh:      data.druh || "",
        technologie: data.technologie || "",
        budova:    data.budova || "",
        patro:     data.patro || "",
        prirazeni: Array.isArray(data.prirazeni) ? data.prirazeni : [],
        termin:    data.termin || "",
        /* POZOR: budget úkolu se sem NEZAPISUJE. Dokument úkolu čte každý
           člen (a přiřazený vždy) a databáze neumí schovat jednotlivé pole –
           budget a rezerva proto leží ve vedlejším dokumentu
           `private/ukoly/budgety/{id}`, který čtou jen manažeři.
           Stejný trik jako výkazy (zaznamy × castky). */
        stav:      data.stav || "otevreny",
        todo:      Array.isArray(data.todo) ? data.todo : [],
        poznamka:  data.poznamka || "",
        createdMs: data.createdMs || Date.now(),
        createdBy: data.createdBy || window.KB_USER || "",
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    KB.zapisAktivitu("ukol", "uložil úkol " + (data.nazev || "") +
        (data.projekt ? " (" + data.projekt + ")" : ""));
    return id;
};

/**
 * Zápis postupu přiřazeným člověkem. Posílá se JEN todo a stav – přesně
 * tolik, kolik pravidla databáze zaměstnanci dovolí; kdyby se přibalilo
 * cokoliv dalšího, databáze celý zápis odmítne.
 */
/** Manažerské potvrzení hotového úkolu – zaměstnanec označí hotovo,
    manažer po kontrole potvrdí. Zaměstnanci pole `potvrzeno` pravidla
    zapsat nedovolí (smí jen todo a stav). */
KB.potvrdUkol = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(ukolDoc(id), {
        potvrzeno: true,
        potvrdil: window.KB_USER || "",
        potvrzenoMs: Date.now(),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    const ukol = KB.ukoly.find(u => u.id === id);
    KB.zapisAktivitu("ukol", "potvrdil hotový úkol" + (ukol ? " " + ukol.nazev : ""));
};

KB.ulozUkolPostup = async (id, todo, stav, zmena, popis) => {
    if (authReady) await authReady;
    requireDb();
    const ukol = KB.ukoly.find(u => u.id === id);
    const payload = {
        todo: Array.isArray(todo) ? todo : [],
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    };
    if (stav !== undefined) payload.stav = stav;
    /* Historie zapsání přímo v úkolu: kdo, kdy, z kolika na kolik procent.
       Drží se posledních 80 kroků – starší nikdo nedohledává a dokument
       nesmí bobtnat donekonečna. Aktivity ji nenahradí: ty čte jen manažer,
       kdežto historii úkolu si rozklikne i přiřazený zaměstnanec. */
    if (zmena && zmena.text) {
        const stara = (ukol && Array.isArray(ukol.historie)) ? ukol.historie : [];
        payload.historie = stara.concat([{
            ms: Date.now(), kdo: window.KB_USER || "",
            text: String(zmena.text).slice(0, 120),
            z: Number(zmena.z) || 0, na: Number(zmena.na) || 0
        }]).slice(-80);
    }
    await setDoc(ukolDoc(id), payload, { merge: true });
    /* `popis` posílá stránka úkolů u oprav a mazání položek – v reportu
       pak stojí „opravil TO-DO …", ne matoucí „zapsal postup". */
    KB.zapisAktivitu("postup", (popis || "zapsal postup") +
        (ukol ? " u úkolu " + ukol.nazev : "") +
        (zmena && zmena.text
            ? " – " + (Number(zmena.z) || 0) + "->" + (Number(zmena.na) || 0) + "% " + zmena.text
            : "") +
        (stav === "hotovo" ? " – hotovo" : ""));
};

KB.deleteUkol = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(ukolDoc(id));
    await deleteDoc(ukolBudgetDoc(id)).catch(() => {});   // vedlejší dokument s budgetem
};

/* ----------------------------------------------------------- kalendář ----
   Událost: { typ:"udalost|dovolena|nemoc|skoleni", uid, osoba,
              od:"2026-08-20", do:"2026-08-22", celyDen:true,
              odCas:"", doCas:"", text, zdroj:"vykaz"|"" }
   Dovolené a nemoci sem zapisuje i formulář výkazu, ať je plánování vidět
   na jednom místě. `zdroj` říká, odkud záznam přišel. */

KB.newUdalostId = () => "kal_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

/** Potvrzení dovolené manažerem – jen příznak, událost se nemění. */
KB.potvrdDovolenou = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(kalendarDoc(id), {
        potvrzeno: true,
        potvrdil: window.KB_USER || "",
        potvrzenoMs: Date.now()
    }, { merge: true });
    const u = (KB.kalendar || []).find(x => x.id === id);
    const DRUH = { dovolena: "dovolenou", volno: "volno", nemoc: "nemoc", skoleni: "školení" };
    KB.zapisAktivitu("kalendar", "potvrdil " + (DRUH[(u || {}).typ] || "dovolenou") +
        (u ? " – " + (u.osoba || "?") + " (" + (u.od || "") +
            (u.do && u.do !== u.od ? " až " + u.do : "") + ")" : ""));
};

KB.saveUdalost = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    const uid = data.uid || KB.currentUid();
    await setDoc(kalendarDoc(id), {
        typ:     data.typ || "udalost",
        uid:     uid,
        osoba:   data.osoba || window.KB_USER || "",
        od:      data.od || "",
        do:      data.do || data.od || "",
        celyDen: data.celyDen !== false,
        odCas:   data.odCas || "",
        doCas:   data.doCas || "",
        text:    data.text || "",
        zdroj:   data.zdroj || "",
        /* U absence z výkazu si držíme, ze kterého zápisu vznikla – z kalendáře
           se pak dá skočit rovnou na jeho opravu. Mazat se smí jen tam, aby
           nezůstal výkaz bez události nebo naopak. */
        vykazId: data.vykazId || "",
        /* Komu akce patří. Prázdné pole = celé firmě; jinak jen vypsaným
           lidem (a tomu, kdo ji založil). Není to zámek – kalendář čte
           každý člen, je to jen úklid v zobrazení (Michal 1. 9. 2026). */
        proUids: Array.isArray(data.proUids) ? data.proUids : [],
        /* "" | "den" | "tyden" | "mesic" – kdy se má ozvat připomenutí
           do Quick TO-DO. Vzkaz zakládá hlídka v prohlížeči, ne server. */
        pripomenout: data.pripomenout || "",
        pripomenout2: data.pripomenout2 || "",
        /* Dovolenou musí potvrdit manažer. Nová (i přeuložená – změněné
           datum znamená schvalovat znovu) začíná nepotvrzená; potvrzuje
           KB.potvrdDovolenou z dlaždice na nástěnce. */
        potvrzeno: data.potvrzeno === true,
        createdMs: data.createdMs || Date.now(),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    /* Rychlý zápis (HO, volno, dovolená z pásu) se v Reportu má poznat
       na první pohled – „uložil událost homeoffice" nikomu nic neřekne
       (přání Michala 1. 9. 2026). */
    const NAZEV_TYPU = { homeoffice: "home office", volno: "volno",
                         dovolena: "dovolenou", doktor: "doktora",
                         nemoc: "nemoc", skoleni: "školení" };
    const nazev = NAZEV_TYPU[data.typ] || (data.typ || "událost");
    const rozsah = (data.od || "") + (data.do && data.do !== data.od ? "–" + data.do : "");
    KB.zapisAktivitu("kalendar", (data.zdroj === "panel"
            ? "nahlásil v Rychlém zápisu " + nazev
            : "uložil do kalendáře " + nazev) +
        (rozsah ? " na " + rozsah : "") + (data.osoba ? " – " + data.osoba : ""));
    return id;
};

KB.deleteUdalost = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const u = (KB.kalendar || []).find(x => x.id === id);
    await deleteDoc(kalendarDoc(id));
    KB.zapisAktivitu("kalendar", "smazal událost " + (u ? (u.typ || "") + " " +
        (u.od || "") + (u.osoba ? " – " + u.osoba : "") : id));
};

/* ---------------------------------------------------------------- záloha --
   Provozní data (projekty, úkoly, výkazy, kalendář, číselníky) do jednoho
   JSON a zpátky. Návody a tabule tu schválně nejsou – ty umí starý export
   na stránce Uživatelé a nesou obrázky, které by soubor nafoukly.

   Obnova PŘEPISUJE dokumenty ze souboru; co v souboru není, v databázi
   zůstane. Je to tedy „vrátit, co se pokazilo", ne „vrátit čas". */

const ZALOHA_CESTY = [
    ["projekty",         ["private", "projekty", "seznam"]],
    ["projekty-finance", ["private", "projekty", "finance"]],
    ["ukoly",            ["private", "ukoly", "seznam"]],
    ["vykazy",           ["private", "vykazy", "zaznamy"]],
    ["vykazy-castky",    ["private", "vykazy", "castky"]],
    ["vykazy-ciselniky", ["private", "vykazy", "ciselniky"]],
    ["kalendar",         ["public", "data", "kalendar"]],
    ["meta",             ["public", "data", "meta"]]
];

KB.exportZaloha = async (onProgress) => {
    if (authReady) await authReady;
    requireDb();

    const kolekce = {};
    for (const [nazev, cesta] of ZALOHA_CESTY) {
        if (onProgress) onProgress(nazev);
        const snap = await getDocs(collection(db, "artifacts", APP_ID, cesta[0], cesta[1], cesta[2]));
        const dokumenty = {};
        snap.forEach(d => { dokumenty[d.id] = d.data(); });
        kolekce[nazev] = dokumenty;
    }
    return {
        _info: "Záloha provozních dat Pasport Kaňa (bez návodů, tabulí a hesel).",
        _vytvoreno: new Date().toISOString(),
        _kdo: window.KB_USER || "",
        kolekce: kolekce
    };
};

KB.obnovZalohu = async (zaloha, onProgress) => {
    if (authReady) await authReady;
    requireDb();
    if (!zaloha || !zaloha.kolekce) throw new Error("Tohle není soubor se zálohou.");

    let zapsano = 0;
    for (const [nazev, cesta] of ZALOHA_CESTY) {
        const dokumenty = zaloha.kolekce[nazev];
        if (!dokumenty) continue;
        const idcka = Object.keys(dokumenty);
        for (let i = 0; i < idcka.length; i++) {
            if (onProgress && i % 20 === 0) onProgress(nazev + " " + (i + 1) + "/" + idcka.length);
            await setDoc(doc(db, "artifacts", APP_ID, cesta[0], cesta[1], cesta[2], idcka[i]),
                dokumenty[idcka[i]]);
            zapsano++;
        }
    }
    KB.zapisAktivitu("vykaz", "obnovil data ze zálohy z " + (zaloha._vytvoreno || "?") +
        " (" + zapsano + " dokumentů)");
    return zapsano;
};

/* ------------------------------------------------------------------- logy */

/* ------------------------------------------------------------ přehledy ---
   Souhrny spočítané z historických excelových výkazů. Leží ve Firestore,
   a ne v souboru na webu, schválně: repozitář je VEŘEJNÝ, takže cokoliv
   uloženého v něm by si přečetl kdokoliv na světě. Takhle je to za
   přihlášením a za pravidly, která pouštějí dál jen správce. */

KB.loadPrehled = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(prehledDoc(id));
    return snap.exists() ? snap.data() : null;
};

KB.savePrehled = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(prehledDoc(id), {
        data: JSON.stringify(data),      // jeden blob, ať se to nepere s limity na pole
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    });
};

KB.logLogin = async (name) => {
    try {
        if (authReady) await authReady;
        requireDb();
        await addDoc(collection(db, "artifacts", APP_ID, "public", "data", "logs"), {
            userName: name,
            uid: KB.currentUid(),
            action: "login",
            /* `ms` je tu vedle serverTimestamp schválně: podle něj se dá
               řadit hned při zápisu, kdežto serverTimestamp dorazí až
               ze serveru a chvíli je prázdný. */
            ms: Date.now(),
            timestamp: serverTimestamp()
        });
    } catch (err) {
        console.warn("Log se nepodařilo zapsat.", err);
    }
};

/* Historie přihlášení. Řadí se podle `ms`, takže staré záznamy bez tohohle
   pole se nenačtou – ty vznikly před zavedením historie a nikomu nechybí. */
let logyOdber = null;

KB.watchLogy = async () => {
    if (logyOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || logyOdber) return;
    logyOdber = onSnapshot(
        query(collection(db, "artifacts", APP_ID, "public", "data", "logs"),
            orderBy("ms", "desc"), limit(60)),
        (snapshot) => {
            KB.logy = [];
            snapshot.forEach(d => KB.logy.push({ id: d.id, ...d.data() }));
            emit("logy", KB.logy);
        }, (err) => console.error("Chyba čtení přihlášení:", err));
};

/* ----------------------------------------------------------- příručka ---
   Text stránky „Jak web používat". Leží v public/data/meta/prirucka
   (čtou členové, zapisují správci – viz firestore.rules), takže si ho
   Michal upraví přímo na webu a nikdo kvůli tomu nesahá do kódu. */

KB.nactiPrirucku = async () => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(metaDoc("prirucka"));
    return snap.exists() ? (snap.data() || {}) : {};
};

KB.ulozPrirucku = async (html) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(metaDoc("prirucka"), {
        html: String(html || ""),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    });
    KB.zapisAktivitu("navod", "upravil příručku Jak web používat");
};

/* --------------------------------------------------------- postup dne ---
   Denní záznam práce: pár screenshotů a věta k tomu. Hlavní smysl je
   u home office – manažer vidí, že se práce hýbe, aniž by musel volat.
   Dokument na člověka a den (id `uid_datum`), obrázky v podkolekci. */

const postupCol = () => collection(db, "artifacts", APP_ID, "private", "postup", "zaznamy");
const postupDoc = (id) => doc(db, "artifacts", APP_ID, "private", "postup", "zaznamy", id);
const postupObrazky = (id) => collection(db, "artifacts", APP_ID, "private", "postup", "zaznamy", id, "obrazky");
const postupObrazek = (id, n) => doc(db, "artifacts", APP_ID, "private", "postup", "zaznamy", id, "obrazky", String(n));

KB.postupy = [];
let postupOdber = null;

KB.postupId = (uid, datum) => uid + "_" + datum;

/** Posledních 14 dní: manažer všechny, ostatní jen sebe (víc pravidla nedají). */
KB.watchPostupy = async () => {
    if (postupOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || postupOdber) return;
    const od = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const ja = KB.users.find(u => u.id === auth.currentUser.uid);
    const manazer = ja && ["hlavni-spravce", "majitel", "spravce", "asistentka"].indexOf(ja.role) !== -1;
    const dotaz = manazer
        ? query(postupCol(), where("datum", ">=", od))
        : query(postupCol(), where("uid", "==", auth.currentUser.uid));
    postupOdber = onSnapshot(dotaz, (snap) => {
        KB.postupy = [];
        snap.forEach(d => KB.postupy.push({ id: d.id, ...d.data() }));
        emit("postupy", null);
    }, (err) => console.error("Chyba čtení postupu:", err));
};

KB.ulozPostup = async (datum, patch) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    await setDoc(postupDoc(KB.postupId(uid, datum)), Object.assign({
        uid: uid,
        osoba: window.KB_USER || "",
        datum: datum,
        ms: Date.now()
    }, patch || {}), { merge: true });
};

KB.pridejPostupObrazek = async (datum, dataUrl) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    const id = KB.postupId(uid, datum);
    await KB.ulozPostup(datum, {});          // rodič musí existovat kvůli právům
    const n = "img_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    await setDoc(postupObrazek(id, n), { data: dataUrl, ms: Date.now() });
    await KB.ulozPostup(datum, { pocet: increment(1) });
    return n;
};

KB.nactiPostupObrazky = async (zaznamId) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(postupObrazky(zaznamId));
    const ven = [];
    snap.forEach(d => ven.push({ id: d.id, ...d.data() }));
    ven.sort((a, b) => (a.ms || 0) - (b.ms || 0));
    return ven;
};

KB.smazPostupObrazek = async (zaznamId, imgId) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(postupObrazek(zaznamId, imgId));
    const [uid, datum] = [zaznamId.split("_")[0], zaznamId.slice(zaznamId.indexOf("_") + 1)];
    if (uid === KB.currentUid()) await KB.ulozPostup(datum, { pocet: increment(-1) });
};

/* -------------------------------------------------------------- plány ---
   Podklady pater (PDF/obrázek) se společnými značkami. Obrázek leží
   v databázi po kouscích jako u tabule – žádné nové úložiště. Značky
   jsou vlastní dokumenty a chodí živě: parta na patře vidí tečky
   ostatních během vteřiny.

     private/plany/slozky/{id}               { nazev, rodic, ms, kdo }
     private/plany/soubory/{id}              { nazev, slozka, sirka, vyska,
                                               kousku, ms, kdo }
     private/plany/soubory/{id}/kousky/{n}   { data }   (base64, ~0,7 MB)
     private/plany/soubory/{id}/znacky/{zid} { x, y, stav, pozn, kdo, ms } */

const planySlozkyCol = () => collection(db, "artifacts", APP_ID, "private", "plany", "slozky");
const planySlozkaDoc = (id) => doc(db, "artifacts", APP_ID, "private", "plany", "slozky", id);
const planyCol = () => collection(db, "artifacts", APP_ID, "private", "plany", "soubory");
const planDoc = (id) => doc(db, "artifacts", APP_ID, "private", "plany", "soubory", id);
const planKousky = (id) => collection(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "kousky");
const planKousek = (id, n) => doc(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "kousky", String(n));
const planDlazdice = (id, klic) => doc(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "dlazdice", klic);
const planDlazdiceCol = (id) => collection(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "dlazdice");
const planZnacky = (id) => collection(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "znacky");
const planZnacka = (id, zid) => doc(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "znacky", zid);

KB.planySlozky = [];
KB.planySoubory = [];
KB.znackyPlanu = [];            // značky právě otevřeného plánu

let planyOdbery = [];

KB.watchPlany = async () => {
    if (planyOdbery.length) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || planyOdbery.length) return;
    planyOdbery.push(onSnapshot(planySlozkyCol(), (snap) => {
        KB.planySlozky = [];
        snap.forEach(d => KB.planySlozky.push({ id: d.id, ...d.data() }));
        KB.planySlozky.sort((a, b) => (a.nazev || "").localeCompare(b.nazev || "", "cs"));
        emit("plany", null);
    }, (err) => console.error("Chyba čtení složek plánů:", err)));
    planyOdbery.push(onSnapshot(planyCol(), (snap) => {
        KB.planySoubory = [];
        snap.forEach(d => KB.planySoubory.push({ id: d.id, ...d.data() }));
        KB.planySoubory.sort((a, b) => (b.ms || 0) - (a.ms || 0));
        emit("plany", null);
    }, (err) => console.error("Chyba čtení plánů:", err)));
};

KB.ulozSlozkuPlanu = async (nazev, rodic) => {
    if (authReady) await authReady;
    requireDb();
    const id = "psl_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    await setDoc(planySlozkaDoc(id), {
        nazev: String(nazev || "").slice(0, 80),
        rodic: rodic || "",
        ms: Date.now(),
        kdo: window.KB_USER || ""
    });
    return id;
};

/** Smaže složku – jen prázdnou, ať nikdo omylem neshodí patro plánů. */
KB.smazSlozkuPlanu = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const maObsah = KB.planySoubory.some(f => f.slozka === id) ||
        KB.planySlozky.some(f => f.rodic === id);
    if (maObsah) throw new Error("Složka není prázdná.");
    await deleteDoc(planySlozkaDoc(id));
};

const PLAN_KOUSEK = 700000;      // znaků base64 na dokument (limit je 1 MB)

/**
 * Uloží plán: náhled po kouscích a k tomu detailní DLAŽDICE (jako mapy).
 * Výkres formátu A0 se do jednoho JPEGu nevejde – při přiblížení byl
 * rozkostičkovaný. Dlaždice nesou plné rozlišení a prohlížeč si stahuje
 * jen ty, na které se člověk zrovna dívá.
 *
 * meta.dlazdice = [{ klic:"x_y", data, w, h }], meta.dlazScale = kolikrát
 * je detail větší než náhled, meta.dlazT = velikost dlaždice v px.
 */
KB.ulozPlanSoubor = async (meta, dataUrl, hlaseni) => {
    if (authReady) await authReady;
    requireDb();
    const id = "pln_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const kousku = Math.ceil(dataUrl.length / PLAN_KOUSEK);
    for (let n = 0; n < kousku; n++) {
        await setDoc(planKousek(id, n),
            { data: dataUrl.slice(n * PLAN_KOUSEK, (n + 1) * PLAN_KOUSEK) });
    }
    const dlazdice = meta.dlazdice || [];
    for (let i = 0; i < dlazdice.length; i++) {
        const d = dlazdice[i];
        await setDoc(planDlazdice(id, d.klic), { data: d.data, w: d.w, h: d.h });
        if (hlaseni) hlaseni("Ukládám detail " + (i + 1) + "/" + dlazdice.length + "…");
    }
    await setDoc(planDoc(id), {
        nazev: String(meta.nazev || "Plán").slice(0, 120),
        slozka: meta.slozka || "",
        sirka: Number(meta.sirka) || 0,
        vyska: Number(meta.vyska) || 0,
        kousku: kousku,
        dlazScale: Number(meta.dlazScale) || 0,
        dlazT: Number(meta.dlazT) || 0,
        dlazdic: dlazdice.length,
        ms: Date.now(),
        kdo: window.KB_USER || ""
    });
    KB.zapisAktivitu("navod", "nahrál plán " + (meta.nazev || ""));
    return id;
};

/** Jedna detailní dlaždice – stahuje se, až když je vidět. */
KB.nactiPlanDlazdici = async (planId, klic) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(planDlazdice(planId, klic));
    return snap.exists() ? snap.data() : null;
};

KB.nactiPlanObrazek = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(planKousky(id));
    const kousky = [];
    snap.forEach(d => { kousky[Number(d.id)] = (d.data() || {}).data || ""; });
    return kousky.join("");
};

/* Paleta barev značek – patří k PLÁNU (značky jsou společné, takže i
   jejich barvy a popisky musí všichni vidět stejně). Prázdné pole
   znamená výchozí trojici chybí / vyfoceno / hotovo. */
KB.ulozPlanPaletu = async (planId, paleta) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(planDoc(planId), {
        paleta: Array.isArray(paleta) ? paleta.slice(0, 10).map(x => ({
            b: String(x.b || "#888888").slice(0, 12),
            p: String(x.p || "").slice(0, 30)
        })) : []
    }, { merge: true });
};

KB.smazPlan = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const znacky = await getDocs(planZnacky(id));
    for (const d of znacky.docs) await deleteDoc(d.ref);
    const kousky = await getDocs(planKousky(id));
    for (const d of kousky.docs) await deleteDoc(d.ref);
    const dlazdice = await getDocs(planDlazdiceCol(id));
    for (const d of dlazdice.docs) await deleteDoc(d.ref);
    await deleteDoc(planDoc(id));
    KB.zapisAktivitu("navod", "smazal plán");
};

let znackyOdber = null;

/** Živé značky jednoho otevřeného plánu; zavřením se odběr ruší. */
KB.watchZnacky = async (planId) => {
    if (znackyOdber) { try { znackyOdber(); } catch (e) {} znackyOdber = null; }
    KB.znackyPlanu = [];
    if (!planId) { emit("znacky", null); return; }
    if (authReady) await authReady;
    requireDb();
    znackyOdber = onSnapshot(planZnacky(planId), (snap) => {
        KB.znackyPlanu = [];
        snap.forEach(d => KB.znackyPlanu.push({ id: d.id, ...d.data() }));
        emit("znacky", null);
    }, (err) => console.error("Chyba čtení značek:", err));
};

KB.ulozZnacku = async (planId, zid, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(planZnacka(planId, zid), {
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        stav: Number(data.stav) || 0,
        vel: Number(data.vel) || 26,
        text: String(data.text || "").slice(0, 3).toUpperCase(),
        pozn: String(data.pozn || "").slice(0, 200),
        kdo: data.kdo || window.KB_USER || "",
        uid: data.uid || KB.currentUid(),
        ms: data.ms || Date.now()
    }, { merge: true });
};

KB.smazZnacku = async (planId, zid) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(planZnacka(planId, zid));
};

emit("boot");
