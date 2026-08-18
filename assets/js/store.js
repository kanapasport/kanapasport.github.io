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
    getAuth, onAuthStateChanged,
    signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updatePassword
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { initializeApp as initializeSecondaryApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth as getSecondaryAuth, createUserWithEmailAndPassword, signOut as signOutSecondary }
    from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc,
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
const DEFAULT_CINNOSTI = ["ArcGIS", "Focení", "Skeny", "Tabulky", "Administrativa"];

/* Paušály k výkazu. Jsou to firemní čísla, ne tajemství – zaměstnanec si
   svoje stravné i kilometry spočítá sám, tak ať je vidí i ve formuláři. */
const OBED_KC = 200;      // placený oběd, když ho zápis obsahuje
const KM_KC = 5;          // cestovní náhrada za kilometr

/** Technologie – zkratky přebrané z tools/sort_photos/buildings/technologie.json. */
const DEFAULT_TECHNOLOGIE = [
    { zkratka: "STA", nazev: "Stavební prvky" },
    { zkratka: "VZT", nazev: "Vzduchotechnika" },
    { zkratka: "CHL", nazev: "Chlazení" },
    { zkratka: "UT",  nazev: "Ústřední vytápění" },
    { zkratka: "ZTI", nazev: "Zdravotně technické instalace" },
    { zkratka: "ELE", nazev: "Elektroinstalace" },
    { zkratka: "SLP", nazev: "Slaboproud" },
    { zkratka: "MAR", nazev: "Měření a regulace" },
    { zkratka: "EPS", nazev: "Elektrická požární signalizace" },
    { zkratka: "SHZ", nazev: "Stabilní hasicí zařízení" },
    { zkratka: "HAS", nazev: "Hasicí přístroje" },
    { zkratka: "VYT", nazev: "Výtahy" }
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
    projekty: {},           // části projektu: { "BioPharma": ["Etapa 1", "Etapa 2"] }
    firmaMap: {},           // projekt → firma, které se fakturuje (doplní se ve výkazu samo)
    firmyDetail: {},        // firma → { ico, kontakt, email, telefon, adresa, poznamka }
    budgetCiselnik: {},     // projekt → { budovy, patra } pro skládání úkolů
    projektyDocs: [],       // hlavičky projektů (private/projekty/seznam) – dle práv
    ukoly: [],              // úkoly s TO-DO rozpadem (private/ukoly/seznam) – dle práv
    kalendar: [],           // události, dovolené, nemoci – vidí všichni členové
    pritomnost: [],         // kdo je právě na webu: { id: uid, ms, jmeno }
    aktivity: [],           // historie kroků (kdo co uložil) – jen pro manažery
    logy: [],               // historie přihlášení (public/data/logs)
    quicktodo: [],          // rychlé vzkazy: vidí je jen autor a adresát
    cinnosti: DEFAULT_CINNOSTI.slice(),
    technologie: DEFAULT_TECHNOLOGIE.slice(),
    sazby: {},              // výchozí hodinová sazba člověka: { uid: 350 }
    rozpocty: {},           // rozpočet zakázky: { "BioPharma": { kc: 900000, hodiny: 1600 } }
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
    auth = getAuth(app);
    db = getFirestore(app);
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
            if (aktivityOdber) { try { aktivityOdber(); } catch (e) {} aktivityOdber = null; }
            if (logyOdber) { try { logyOdber(); } catch (e) {} logyOdber = null; }
            quickOdbery.forEach(stop => { try { stop(); } catch (e) {} });
            quickOdbery = []; quickPrijate = []; quickPrijateSkupina = [];
            quickOdeslane = []; KB.quicktodo = [];
            KB.guides = []; KB.tasks = []; KB.users = []; KB.boards = [];
            KB.vykazy = []; syroveZaznamy = []; syroveCastky = {};
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

        odbery.push(onSnapshot(tasksCol(), (snapshot) => {
            KB.tasks = [];
            snapshot.forEach(d => KB.tasks.push({ id: d.id, ...d.data() }));
            // nejbližší termín nahoře, úkoly bez termínu na konec
            KB.tasks.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
            emit("tasks", KB.tasks);
        }, (err) => console.error("Chyba čtení úkolů:", err)));

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
                (ja.role === "hlavni-spravce" || ja.role === "spravce");
            if (manazer && !tabuleVse) {
                tabuleVse = true;
                sledujTabuli("vse", tabuleCol());
            }
        }, (err) => console.error("Chyba čtení uživatelů:", err)));

        /* Milníky leží v jednom dokumentu jako pole. Je jich pár desítek
           a hlavně: `meta/…` smí zapisovat jen správce, takže se tím rovnou
           řeší i to, kdo je může měnit – bez dalších pravidel v databázi. */
        odbery.push(onSnapshot(metaDoc("milniky"), (snap) => {
            const data = snap.exists() ? snap.data() : {};
            KB.milniky = Array.isArray(data.items) ? data.items : [];
            emit("milniky", KB.milniky);
        }, (err) => console.error("Chyba čtení milníků:", err)));

        odbery.push(onSnapshot(metaDoc("zakazky"), (snap) => {
            const data = snap.exists() ? snap.data() : {};
            KB.zakazky = Array.isArray(data.names) ? data.names : [];
            KB.zakazkyClosed = Array.isArray(data.closed) ? data.closed : [];
            // dokud si skupiny nikdo neupravil, platí výchozí trojice
            KB.skupiny = (Array.isArray(data.groups) && data.groups.length)
                ? data.groups : KB.DEFAULT_SKUPINY.slice();
            /* Části projektu a firmy, kterým se fakturuje, leží tady a ne
               mezi tajnými čísly – zaměstnanec si je u svého výkazu musí
               umět vybrat. Tajné jsou sazby a rozpočty, ne názvy. */
            KB.projekty = (data.projekty && typeof data.projekty === "object") ? data.projekty : {};
            KB.firmy = Array.isArray(data.firmy) ? data.firmy : [];
            // propojení projekt → firma; výběr projektu pak doplní firmu sám
            KB.firmaMap = (data.firmaMap && typeof data.firmaMap === "object") ? data.firmaMap : {};
            /* Podrobnosti k firmám leží vedle jejich seznamu, ne místo něj:
               `firmy` zůstává prostým polem názvů, které čtou roletky všude
               po webu, a `firmyDetail` je k nim mapa údajů. Až se bude
               zapisovat víc, přibývá to sem a jinde se nic měnit nemusí. */
            KB.firmyDetail = (data.firmyDetail && typeof data.firmyDetail === "object")
                ? data.firmyDetail : {};
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

        /* Kdo je právě na webu. Každý přihlášený o sobě dává vědět po pěti
           minutách; za „přítomného" se bere záznam mladší deseti minut. */
        odbery.push(onSnapshot(pritomnostCol(), (snapshot) => {
            KB.pritomnost = [];
            snapshot.forEach(d => KB.pritomnost.push({ id: d.id, ...d.data() }));
            emit("pritomnost", KB.pritomnost);
        }, (err) => console.error("Chyba čtení přítomnosti:", err)));
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
   Otisk „jsem tady" se obnovuje po pěti minutách, dokud je stránka
   otevřená. Při odhlášení se časovač zastaví; starý záznam prostě
   zestárne, mazat se nemusí. */
let pritomnostCasovac = null;

function ohlasSe(user) {
    if (pritomnostCasovac) clearInterval(pritomnostCasovac);
    const zapis = () => {
        if (!auth || !auth.currentUser) return;
        setDoc(pritomnostDoc(auth.currentUser.uid), {
            ms: Date.now(),
            jmeno: window.KB_USER || ""
        }).catch(() => { /* pravidla ještě nemusí být nasazená */ });
    };
    zapis();
    pritomnostCasovac = setInterval(zapis, 5 * 60 * 1000);
}

/* ---------------------------------------------------- historie aktivit ---
   Krátký zápis „kdo co udělal" – plní se z ukládacích funkcí a čtou ho jen
   manažeři (Reporty). Nikdy nesmí shodit vlastní uložení, proto se chyby
   polykají: bez nasazených pravidel se prostě nic nezapíše. */

KB.zapisAktivitu = (druh, text) => {
    try {
        if (!db || !auth || !auth.currentUser) return;
        addDoc(aktivityCol(), {
            druh: druh,                 // projekt | ukol | postup | vykaz | kalendar
            text: String(text || "").slice(0, 200),
            uid: auth.currentUser.uid,
            jmeno: window.KB_USER || "",
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
        ms:      data.ms || Date.now()
    }, { merge: true });
    return id;
};

KB.deleteQuickTodo = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(quickDoc(id));
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

let aktivityOdber = null;

/** Posledních pár desítek kroků – jen pro manažery (pravidla). */
KB.watchAktivity = async () => {
    if (aktivityOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || aktivityOdber) return;
    aktivityOdber = onSnapshot(query(aktivityCol(), orderBy("ms", "desc"), limit(40)),
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

/* ------------------------------------------------------------- uživatelé --
   Seznam lidí, kteří mají na web přístup, a jejich role. Spravuje ho hlavní
   správce. Heslo se ukládá jen jako otisk (SHA-256 se solí), nikdy v čitelné
   podobě – i tak ale platí, že dokud běží anonymní přihlášení k Firebase
   a otevřená pravidla, je to zámek na skleněných dveřích. Skutečné oddělení
   přijde s Firebase Auth; poznámky k tomu jsou v README. */

KB.userId = (email) => String(email || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

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
    // otisk hesla se přepisuje jen tehdy, když se heslo opravdu mění
    if (data.salt) payload.salt = data.salt;
    if (data.hash) payload.hash = data.hash;
    // zašifrovaná podoba hesla pro trezor hlavního správce (viz ui.js)
    if (data.enc) payload.enc = data.enc;
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
 * Přepíše člověku heslo za správce.
 *
 * Firebase nedovolí měnit cizí heslo „shora" – umí to jen vlastník účtu.
 * Jde to ale obejít poctivě: trezor zná stávající heslo, takže se v druhé
 * instanci Firebase pod tím účtem přihlásíme a heslo změníme jeho vlastním
 * jménem. Hlavní přihlášení správce zůstane nedotčené.
 *
 * Podmínka je tedy odemčený trezor se známým starým heslem; když ho nemáme,
 * zbývá odkaz na e-mail.
 */
KB.changeUserPassword = async (email, stareHeslo, noveHeslo) => {
    const app2 = initializeSecondaryApp(FIREBASE_CONFIG, "zmena-" + Date.now());
    const auth2 = getSecondaryAuth(app2);
    try {
        const cred = await signInWithEmailAndPassword(auth2, String(email).trim(), stareHeslo);
        await updatePassword(cred.user, noveHeslo);
    } finally {
        await signOutSecondary(auth2).catch(() => {});
    }
};

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

/**
 * Nastavení trezoru na hesla – sůl pro odvození klíče a kontrolní blok,
 * podle kterého se pozná, že zadané heslo k trezoru je správné.
 * Samotné heslo k trezoru se nikam neukládá.
 */
KB.loadVault = async () => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(metaDoc("vault"));
    return snap.exists() ? snap.data() : null;
};

KB.saveVault = async (salt, check) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(metaDoc("vault"), {
        salt: salt, check: check,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    });
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
       pauza:30, hodiny:8.5, sazba:350, castka:2975, poznamka }

   `hodiny` a `castka` se ukládají dopočítané. Je to úmyslná duplicita:
   sazba se časem mění a přehled za loňský rok musí zůstat takový, jaký byl
   ve chvíli zápisu – ne přepočítaný dnešními čísly. */

/* Čas a peníze chodí ze dvou kolekcí. Držíme si je zvlášť a po každé změně
   je spojíme do jednoho pole – stránky pak pracují s jedním záznamem a je
   jim jedno, odkud která hodnota přišla. */
let syroveZaznamy = [];
let syroveCastky = {};

function spojVykazy() {
    KB.vykazy = syroveZaznamy.map(z => Object.assign(
        { sazba: 0, castka: 0 }, z, syroveCastky[z.id] || {}));
    // nejnovější nahoře; ve stejném dni se řadí podle začátku práce
    KB.vykazy.sort((a, b) => (b.datum || "").localeCompare(a.datum || "")
        || (a.od || "").localeCompare(b.od || ""));
    emit("vykazy", KB.vykazy);
}

function sledujVykazy(jenSve) {
    if (!db || !auth || !auth.currentUser) return;

    /* Pravidla nejsou filtr: kdo nesmí číst cizí zápisy, musí si o svoje říct
       dotazem, jinak Firestore odmítne celý přenos. */
    const zdroj = jenSve
        ? query(vykazyCol(), where("uid", "==", auth.currentUser.uid))
        : vykazyCol();

    vykazyOdbery.push(onSnapshot(zdroj, (snapshot) => {
        syroveZaznamy = [];
        snapshot.forEach(d => syroveZaznamy.push({ id: d.id, ...d.data() }));
        spojVykazy();
    }, (err) => {
        console.error("Chyba čtení výkazů:", err);
        emit("vykazy-chyba", err);
    }));

    if (jenSve) return;      // částky ani sazby zaměstnanci nepatří

    vykazyOdbery.push(onSnapshot(castkyCol(), (snapshot) => {
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
        poznamka: data.poznamka || "",
        createdMs: data.createdMs || Date.now(),
        createdBy: data.createdBy || window.KB_USER || "",
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    };
}

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
KB.saveCiselnikZakazek = async (patch) => {
    if (authReady) await authReady;
    requireDb();

    const payload = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    ["names", "closed", "groups", "projekty", "firmy", "firmaMap", "firmyDetail", "budget"].forEach(klic => {
        if (patch[klic] !== undefined) payload[klic] = patch[klic];
    });
    await setDoc(metaDoc("zakazky"), payload, { merge: true });
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
        manazeri: manazeri,
        manazer:  manazeri[0] || "",
        zacatek:  data.zacatek || "",
        konec:    data.konec || "",
        stav:     data.stav || "",             // volný text: „kreslí se G61" apod.
        priorita: data.priorita || "stredni",
        uzavreno: data.uzavreno === true,
        lide:     Array.isArray(data.lide) ? data.lide : [],
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
        budgetHodin: Math.max(0, Number(data.budgetHodin) || 0),
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
KB.ulozUkolPostup = async (id, todo, stav) => {
    if (authReady) await authReady;
    requireDb();
    const payload = {
        todo: Array.isArray(todo) ? todo : [],
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    };
    if (stav !== undefined) payload.stav = stav;
    await setDoc(ukolDoc(id), payload, { merge: true });
    const ukol = KB.ukoly.find(u => u.id === id);
    KB.zapisAktivitu("postup", "zapsal postup" +
        (ukol ? " u úkolu " + ukol.nazev : "") + (stav === "hotovo" ? " – hotovo" : ""));
};

KB.deleteUkol = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(ukolDoc(id));
};

/* ----------------------------------------------------------- kalendář ----
   Událost: { typ:"udalost|dovolena|nemoc|skoleni", uid, osoba,
              od:"2026-08-20", do:"2026-08-22", celyDen:true,
              odCas:"", doCas:"", text, zdroj:"vykaz"|"" }
   Dovolené a nemoci sem zapisuje i formulář výkazu, ať je plánování vidět
   na jednom místě. `zdroj` říká, odkud záznam přišel. */

KB.newUdalostId = () => "kal_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

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
        createdMs: data.createdMs || Date.now(),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    KB.zapisAktivitu("kalendar", "uložil událost " + (data.typ || "udalost") +
        " " + (data.od || "") + (data.osoba ? " – " + data.osoba : ""));
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

emit("boot");
