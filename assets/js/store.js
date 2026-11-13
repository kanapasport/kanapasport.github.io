/* ==========================================================================
   Datová vrstva – Firebase Firestore.
   Zůstáváme u Firebase (funguje a umí živou synchronizaci). Projekt je na
   tarifu Blaze: čtení nad denní limit zdarma (50 tis.) se platí, proto se
   má číst co nejmíň. Obrázky návodů leží v podkolekci, aby hlavní dokument
   návodu zůstal malý a seznam se načítal rychle.

   Struktura v databázi:
     artifacts/{APP_ID}/public/data/guides/{guideId}              ← text návodu
     artifacts/{APP_ID}/public/data/guides/{guideId}/images/{id}  ← obrázek (base64)
     artifacts/{APP_ID}/public/data/tasks/{taskId}                ← úkol ze zakázky
     artifacts/{APP_ID}/public/data/logs/{autoId}                 ← záznamy přihlášení

     artifacts/{APP_ID}/private/vykazy/zaznamy/{id}               ← odpracovaný čas
     artifacts/{APP_ID}/private/vykazy/castky/{id}                ← sazba a částka
     artifacts/{APP_ID}/private/vykazy/ciselniky/nastaveni        ← sazby, rozpočty
     artifacts/{APP_ID}/private/vyplaty/mesice/{uid}_{RRRR-MM}    ← výplata měsíce (DPP, OSVČ…)

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
    terminate, clearIndexedDbPersistence, waitForPendingWrites,
    collection, doc, getDoc, getDocs, setDoc as setDocSdk, updateDoc as updateDocSdk,
    deleteDoc as deleteDocSdk, deleteField,
    increment, arrayUnion, arrayRemove, writeBatch as writeBatchSdk, runTransaction,
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

/* Upozornění z webu (Firebase Cloud Messaging) – VEŘEJNÝ klíč Web Push
   z konzole Firebase (Nastavení projektu → Cloud Messaging → Web Push
   certificates → Key pair). Stejně jako apiKey nahoře není tajný: jen říká
   prohlížeči, od koho smí upozornění přijímat; posílat jde jen se
   soukromým klíčem, a ten má Google a Apps Script. Prázdný = upozornění
   z webu se teprve chystají – karta na stránce Upozornění ukáže
   „Připravuje se.“ a nic z toho se nevolá. */
const PUSH_VAPID = "BKEYzFbAiOuZkvHodwybuiMiGCSGQ4mfkKDZ7q7ufRE-yYzbm8vgT0_xVsmE7UZpoJq_CJBg4YkBfrAreU4egGo";

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
    zakazkySeznam: [],      // jmenný seznam zakázek (číslo + název) pro všechny
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
    vybaveni: [],           // přístroje k zapůjčení (public/data/meta/vybaveni) – až po otevření panelu
    vybaveniRezervace: [],  // rezervace přístrojů, které ještě neskončily
    cinnosti: DEFAULT_CINNOSTI.slice(),
    technologie: DEFAULT_TECHNOLOGIE.slice(),
    sazby: {},              // výchozí hodinová sazba člověka: { uid: 100 }
    rozpocty: {},           // rozpočet zakázky: { "Zakázka A": { kc: 100, hodiny: 100 } }
    status: "connecting",   // connecting | online | offline
    offlineFronta: false,   // true = zápisy bez signálu čekají v trvalé frontě prohlížeče
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
let fbApp = null;               // aplikace Firebase – potřebuje ji až upozornění z webu (getMessaging)

/* Bez signálu (v terénu – rešerše 19. 10. 2026, bod 29). Firestore zápis
   bez připojení hned uloží do fronty v prohlížeči (IndexedDB) a po připojení
   ho odešle sám, i když se stránka mezitím zavře. Jeho slib se ale splní až
   po potvrzení serverem – stránka by do té doby visela na „Odesílám…"
   a člověk by klikal znovu (dvakrát zadaný vzkaz). Bez signálu se proto čeká
   jen na uložení do fronty: první odběr dokumentu přijde až po něm (SDK
   vyřizuje vše popořadě); dávka a výjimky mají pojistku 3 s. Jen s trvalou
   mezipamětí – v paměti (Safari) by zápis zavřením stránky zmizel, tam se
   dál čeká na server. Online se nemění nic. */
function poZapisu(slib, ref) {
    if (navigator.onLine !== false || !KB.offlineFronta) return slib;
    slib.catch(err => {
        console.warn("Změnu udělanou bez signálu databáze nepřijala:", err);
        if (err && err.code === "permission-denied" && window.KBUI) {
            window.KBUI.toast("Změnu udělanou bez signálu databáze po připojení odmítla.", "error");
        }
    });
    return new Promise((hotovo, chyba) => {
        let stop = null;
        let konec = false;
        const dost = (err) => {
            if (konec) return;
            konec = true;
            clearTimeout(pojistka);
            if (stop) stop();
            if (err) chyba(err); else hotovo();
        };
        const pojistka = setTimeout(() => dost(), 3000);
        slib.then(() => dost(), dost);
        if (ref) {
            stop = onSnapshot(ref, () => dost(), () => dost());
            if (konec) stop();
        }
    });
}
const setDoc = (ref, ...dalsi) => poZapisu(setDocSdk(ref, ...dalsi), ref);
const updateDoc = (ref, ...dalsi) => poZapisu(updateDocSdk(ref, ...dalsi), ref);
const deleteDoc = (ref) => poZapisu(deleteDocSdk(ref), ref);
const writeBatch = (databaze) => {
    const davka = writeBatchSdk(databaze);
    const odeslat = davka.commit.bind(davka);
    davka.commit = () => poZapisu(odeslat(), null);
    return davka;
};
/* Apps Script si zápis čte z databáze – bez signálu se mu ozve až po odeslání fronty. */
const poOdeslani = () => (navigator.onLine === false && db)
    ? waitForPendingWrites(db).catch(() => {}) : Promise.resolve();

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
/* Screenshoty vzkazu leží stejně jako u poznámek v podkolekci – v dokumentu
   by se velký obrázek nevešel a stahoval by se s každým vzkazem. Na vzkazu
   samotném zůstává jen malý náhled (`nahled`) a počet (`obrazku`). */
const quickObrazkyCol = (id) =>
    collection(db, "artifacts", APP_ID, "osobni", "quicktodo", "seznam", id, "obrazky");
const quickObrazekDoc = (id, n) =>
    doc(db, "artifacts", APP_ID, "osobni", "quicktodo", "seznam", id, "obrazky", String(n));
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
    mojeCastkyOdber = null;
    KB.mojeCastkyPrisly = false;
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
/* Hlídač dat (22. 9. 2026): když po přihlášení nedorazí seznam lidí, řekne
   to web nahlas. Dřív člověk viděl jen holou stránku bez projektů a výkazů
   a chyba byla jen v konzoli, kterou na iPhonu nikdo neotevře. */
let hlidacDat = null;
function chybaDat(zprava) {
    KB.dataChyba = zprava || "";
    emit("data-chyba", KB.dataChyba);
}
const popisChyby = (err) => (err && (err.code || err.message)) || String(err || "");

const zrusProjektyUkoly = () => {
    if (projektyOdber) { try { projektyOdber(); } catch (e) {} projektyOdber = null; }
    if (ukolyOdber) { try { ukolyOdber(); } catch (e) {} ukolyOdber = null; }
    projektyRezim = ""; ukolyRezim = "";
};

try {
    const app = initializeApp(FIREBASE_CONFIG);
    fbApp = app;

    /* WebKit (Safari): IndexedDB tam umí potichu VISET a je na ní postavená
       jak mezipaměť dat, tak ukládání přihlášení. Bez tohohle obcházení na
       iPadu 29. 8. napřed nechodila data, a po odhlášení nešlo ani přihlásit
       (session se neměla kam zapsat). iPad se hlásí jako „MacIntel", pozná
       se podle dotykových bodů.
       Do 22. 9. 2026 se obchvat zapínal JEN na dotyku – Safari na Macu je
       ale stejné jádro, zůstal na IndexedDB a lidem v něm nešly výkazy ani
       projekty. Safari se pozná podle výrobce prohlížeče: hlásí „Apple
       Computer, Inc." (na iOS i Chrome a Firefox, protože tam jiné jádro
       být nesmí), Chrome „Google Inc.", Firefox nic. */
    const webkitApple = navigator.vendor === "Apple Computer, Inc." ||
        (navigator.maxTouchPoints > 1 &&
            /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent));
    KB.webkitObchvat = webkitApple;

    /* ve WebKitu se přihlášení ukládá do localStorage (spolehlivé),
       jinde zůstává výchozí IndexedDB */
    auth = webkitApple
        ? initializeAuth(app, { persistence: browserLocalPersistence })
        : getAuth(app);
    /* Trvalá mezipaměť v prohlížeči (IndexedDB). Web je několik
       samostatných stránek, ne jedna aplikace – bez ní si každé otevření
       stránky přečte všechny kolekce znovu a Firestore počítá čtení za
       každý doručený dokument. S ní se odběr obnoví z disku a ze serveru
       přijde jen to, co se mezitím změnilo. Tohle byla hlavní příčina
       66 tisíc čtení za den při 634 zápisech (25. 8. 2026). V říjnu 2026 je
       to i s mezipamětí ~173 tis. čtení denně – nejvíc ujídají odběry, které
       stránka nepotřebuje (rešerše 19. 10. 2026, část Technika).

       `persistentMultipleTabManager` hlídá víc otevřených záložek naráz;
       kde IndexedDB není (anonymní okno, starý prohlížeč), se tiše
       spadne zpátky na paměťovou mezipaměť. */
    /* Data ve WebKitu (viz `webkitApple` výš): bez trvalé mezipaměti a přes
       long-polling, se kterým má WebKit menší potíže než se streamováním.
       Stojí to víc čtení (každé otevření stránky čte znovu), ale Safari
       používá jen pár lidí. */
    try {
        db = webkitApple
            ? initializeFirestore(app, { experimentalForceLongPolling: true })
            : initializeFirestore(app, {
                localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
            });
        KB.offlineFronta = !webkitApple;
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
            zrusVybaveni();
            zrusVybaveniPolozky();
            if (tasksOdber) { try { tasksOdber(); } catch (e) {} tasksOdber = null; }
            KB.pritomnost = [];
            if (aktivityOdber) { try { aktivityOdber(); } catch (e) {} aktivityOdber = null; }
            if (logyOdber) { try { logyOdber(); } catch (e) {} logyOdber = null; }
            quickOdbery.forEach(stop => { try { stop(); } catch (e) {} });
            quickOdbery = []; quickPrijate = []; quickPrijateSkupina = [];
            quickOdeslane = []; KB.quicktodo = [];
            quickPrislo.skupina = quickPrislo.prijate = quickPrislo.odeslane = false;
            zrusPoznamky();
            KB.guides = []; KB.tasks = []; KB.users = []; KB.boards = []; KB.auta = [];
            KB.vykazy = []; syroveZaznamy = []; syroveCastky = {};
            KB.vykazyPrisly = false;
            KB.projektyDocs = []; KB.ukoly = []; KB.kalendar = []; KB.porady = [];
            KB.zustatky = {}; KB.poradyKomentare = []; KB.upozorneni = null;
            KB.pokladna = [];
            KB.ready = true;
            clearTimeout(hlidacDat);
            if (KB.dataChyba) chybaDat("");
            setStatus("odhlasen");
            emit("guides", KB.guides);
            emit("users", KB.users);
            return;
        }
        zrusOdbery();
        clearTimeout(hlidacDat);
        hlidacDat = setTimeout(() => {
            if (!KB.users.length) chybaDat("Databáze do 20 sekund neposlala data.");
        }, 20000);
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
            chybaDat("Návody se nenačetly (" + popisChyby(err) + ").");
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
            clearTimeout(hlidacDat);
            if (KB.dataChyba) chybaDat("");          // data dorazila – lišta pryč
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
            /* Teprve teď je jasné, jestli si člověk fakturuje sám – když
               ano a výkazy už poslouchá, přidají se k nim i jeho částky. */
            sledujMojeCastky();
        }, (err) => {
            console.error("Chyba čtení uživatelů:", err);
            chybaDat("Seznam lidí se nenačetl (" + popisChyby(err) + ").");
        }));

        /* Milníky leží v jednom dokumentu jako pole. Je jich pár desítek
           a hlavně: `meta/…` smí zapisovat jen správce, takže se tím rovnou
           řeší i to, kdo je může měnit – bez dalších pravidel v databázi. */
        /* Povolení zpětného zápisu: { uid: { plati, od, dny, kdo, ms } }.
           Platí jen v den `plati` (do půlnoci) a odemyká buď jednotlivé
           `dny`, nebo všechno `od` zvoleného data (Michal 22. 9. 2026).
           Starší podoba je jen datum „do kdy" – ta odemyká všechny dny.
           Leží v meta (čtou všichni členové – zaměstnanec podle toho projde
           uzávěrkou), zapisuje správce. Odebrání = prázdný řetězec (hluboký
           merge klíče nemaže). Výklad je ve vykazy.html u `zpetneZaznam`. */
        odbery.push(onSnapshot(metaDoc("zpetne"), (snap) => {
            const data = snap.exists() ? (snap.data() || {}) : {};
            KB.zpetnePovoleni = (data.povoleni && typeof data.povoleni === "object")
                ? data.povoleni : {};
            emit("zpetne", KB.zpetnePovoleni);
        }, () => { /* bez dokumentu prostě nikdo povolení nemá */ }));

        /* Tvrdá čára uzávěrky výkazů: `odIso` = první den, který zůstává
           otevřený. Starší dny nemanažer nezaloží, neopraví ani nesmaže –
           hlídají to pravidla (`uzaverkaOd()`); prohlížeč to jen ukazuje
           dopředu, ať člověk nenarazí až na chybu z databáze. */
        odbery.push(onSnapshot(metaDoc("uzaverka"), (snap) => {
            KB.uzaverkaOd = snap.exists() ? String((snap.data() || {}).odIso || "") : "";
            emit("uzaverka", KB.uzaverkaOd);
        }, () => { /* bez dokumentu žádná čára */ }));

        odbery.push(onSnapshot(metaDoc("gsync"), (snap) => {
            const url = String((snap.exists() ? (snap.data() || {}).url : "") || "");
            /* web na tuhle adresu posílá ID token – jen skutečný Apps Script (audit 10. 11. 2026, Michal 12. 11. 2026, Iris) */
            KB.gsyncUrl = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url) ? url : "";
            if (url && !KB.gsyncUrl) console.warn("meta/gsync: adresa není Apps Script – zápis do Tabulek vypnutý");
            emit("gsync-url", KB.gsyncUrl);
        }, () => { /* adresa nemusí být nastavená – zápis se pak jen nespustí */ }));

        /* Odkaz na sdílenou zkratku do iPhonu (okno Nastavit telefon u Info
           k zakázkám). Jen sdílený odkaz na iCloud – web podle něj posílá
           lidi z webu dál a vykresluje QR (Michal 13. 11. 2026). */
        odbery.push(onSnapshot(metaDoc("zkratka"), (snap) => {
            const url = String((snap.exists() ? (snap.data() || {}).url : "") || "");
            KB.zkratkaUrl = ZKRATKA_URL_TVAR.test(url) ? url : "";
            if (url && !KB.zkratkaUrl) console.warn("meta/zkratka: adresa není sdílená zkratka z iCloudu – odkaz se neukáže");
            emit("zkratka-url", KB.zkratkaUrl);
        }, () => { /* odkaz nemusí být nastavený – okno pak řekne, ať se člověk ozve správci */ }));

        KB.watchMilniky();

        // kdo co potvrzuje (Nastavení → Potvrzování) – tlačítka Potvrdit na stránkách
        odbery.push(sledujPotvrzovani());

        /* Jmenný seznam zakázek – holý výtah (číslo + název) pro všechny.
           Projekty samotné leží v `private` a zaměstnanec přečte jen ty
           svoje; tohle je to, co v Evidenci zakázek hledají očima. */
        odbery.push(onSnapshot(metaDoc("zakazky-seznam"), (snap) => {
            const data = snap.exists() ? (snap.data() || {}) : {};
            KB.zakazkySeznam = Array.isArray(data.polozky) ? data.polozky : [];
            KB.zakazkySeznamMs = Number(data.ms) || 0;
            emit("zakazky-seznam", KB.zakazkySeznam);
        }, () => { /* dokument nemusí existovat, než ho manažer poprvé uloží */ }));

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
        naplanujObnovuPush();

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
            druh: druh,                 // projekt | ukol | postup | vykaz | kalendar | auto | vybaveni
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
/* Které ze tří dotazů už odpověděly – hlídka opakování rozhoduje až nad
   úplným seznamem, jinak by kopii, kterou zrovna nevidí, založila znovu. */
const quickPrislo = { skupina: false, prijate: false, odeslane: false };

function slejQuick() {
    const mapa = new Map();
    quickPrijate.concat(quickPrijateSkupina, quickOdeslane).forEach(q => mapa.set(q.id, q));
    KB.quicktodo = Array.from(mapa.values())
        .sort((a, b) => (a.hotovo ? 1 : 0) - (b.hotovo ? 1 : 0)
            || (a.doKdy || "9999").localeCompare(b.doKdy || "9999")
            || (b.ms || 0) - (a.ms || 0));
    emit("quicktodo", KB.quicktodo);
    hlidkaOpakovaniQuick();
}

/**
 * Další Quick TO-DO opakované řady po splnění. Zakládá ho ZADAVATEL –
 * pravidla pustí založit vzkaz jen pod vlastním `odKoho`. Splní-li ho
 * adresát, kopii založí prohlížeč zadavatele, jakmile má web otevřený
 * (hlídka níž; Quick TO-DO poslouchá každá stránka). Idempotentní: pevné
 * id kopie, kontrola v načtených vzkazech, pak `nasledovnikId`.
 * @returns {Promise<string>} id kopie, nebo ""
 */
KB.zalozDalsiQuick = async (q) => {
    if (authReady) await authReady;
    const uid = KB.currentUid();
    if (!db || !q || !uid || q.odKoho !== uid || q.hotovo !== true || q.nasledovnikId) return "";
    const n = nasledovnikQuick(q, Date.now());
    if (!n || zakladaNasledovnika.has(n.id)) return "";
    zakladaNasledovnika.add(n.id);
    try {
        // zadavatel vidí všechny své vzkazy (dotaz odKoho), takže hotová kopie by tu byla
        if (!(KB.quicktodo || []).some(x => x.id === n.id)) await KB.saveQuickTodo(n.id, n.data);
        await setDoc(quickDoc(q.id), { nasledovnikId: n.id }, { merge: true });
        return n.id;
    } finally {
        zakladaNasledovnika.delete(n.id);
    }
};

function hlidkaOpakovaniQuick() {
    if (!quickPrislo.skupina || !quickPrislo.prijate || !quickPrislo.odeslane) return;
    const uid = KB.currentUid();
    if (!uid) return;
    (KB.quicktodo || []).forEach(q => {
        if (!q.opakovani || q.odKoho !== uid || q.hotovo !== true || q.nasledovnikId) return;
        KB.zalozDalsiQuick(q).catch(err => console.warn("Další opakovaný Quick TO-DO se nezaložil:", err));
    });
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
        quickPrislo.skupina = true;
        slejQuick();
    }, (err) => console.error("Chyba čtení Quick TO-DO:", err)));
    quickOdbery.push(onSnapshot(query(quickCol(), where("proUid", "==", uid)), (s) => {
        quickPrijate = []; s.forEach(d => quickPrijate.push({ id: d.id, ...d.data() }));
        quickPrislo.prijate = true;
        slejQuick();
    }, (err) => console.error("Chyba čtení Quick TO-DO:", err)));
    quickOdbery.push(onSnapshot(query(quickCol(), where("odKoho", "==", uid)), (s) => {
        quickOdeslane = []; s.forEach(d => quickOdeslane.push({ id: d.id, ...d.data() }));
        quickPrislo.odeslane = true;
        slejQuick();
    }, (err) => console.error("Chyba čtení Quick TO-DO:", err)));
};

KB.newQuickId = () => "qt_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

KB.saveQuickTodo = async (id, data, volby) => {
    if (authReady) await authReady;
    requireDb();

    /* Jeden vzkaz = jeden dokument, i když je pro víc lidí. Dřív se zakládal
       zvlášť pro každého, takže se v přehledu objevil čtyřikrát a splnění
       jednoho o ostatních nevědělo. `proUids` drží všechny adresáty;
       `proUid` zůstává kvůli starším záznamům a je v něm ten první. */
    const komu = Array.isArray(data.proUids) && data.proUids.length
        ? data.proUids.slice()
        : [data.proUid || KB.currentUid()];
    // oznámení (druh "info") nemá termín, „co nejdříve" ani opakování
    const info = data.druh === "info";

    const zapis = {
        text:    String(data.text || "").slice(0, 300),
        proUids: komu,
        proUid:  komu[0],
        odKoho:  data.odKoho || KB.currentUid(),
        odKohoJmeno: data.odKohoJmeno || window.KB_USER || "",
        doKdy:   info ? "" : (data.doKdy || ""),
        /* „Co nejdříve" je zvláštní stav, ne datum – kdo neví, do kdy to má
           být, by jinak musel vymyslet termín, který stejně nic neznamená.
           Řadí se před všechny termíny. */
        asap:    !info && data.asap === true,
        projekt: data.projekt || "",       // nepovinná vazba na projekt
        /* DVA ZPŮSOBY SPLNĚNÍ (Michal 3. 9. 2026):
             "" (společný)  jeden odškrtne za všechny – vzkaz zhasne partě
             "kazdy"        každý si škrtá sám, hotovo je pro toho, kdo je
                            v `hotoviUids`; zadavatel vidí, kolik jich už má
           Společný zůstává výchozí, protože takhle to fungovalo dosud. */
        rezim:   data.rezim === "kazdy" ? "kazdy" : "",
        hotoviUids: Array.isArray(data.hotoviUids) ? data.hotoviUids.slice(0, 40) : [],
        hotovo:  data.hotovo === true,
        // u společného vzkazu je potřeba vědět, kdo ho odškrtl za všechny
        hotovoKdo: data.hotovoKdo || "",
        hotovoMs:  data.hotovoMs || 0,
        // nepovinná vazba na poznámku – vzkaz pak nese odkaz „Otevřít"
        poznamka: data.poznamka || "",
        // vzkaz hlídky výkazů: "tyden" (oranžově) | "minuly" (červeně)
        hlidka: data.hlidka || "",
        ms:      data.ms || Date.now()
    };

    /* Náhled a počet obrázků se zapisují JEN když je volající opravdu posílá.
       Komentáře se odsud nezapisují vůbec – přibývají přes `arrayUnion`.
       Kdyby je přepisoval každý zápis vzkazu, odškrtnutí „Splněno" ze
       staršího okna by smazalo komentář, který mezitím někdo přidal
       (Michal 4. 9. 2026). */
    if ("nahled" in data) zapis.nahled = String(data.nahled || "").slice(0, 90000);
    if ("obrazku" in data) zapis.obrazku = Number(data.obrazku) || 0;
    /* „Beru na vědomí" se stejně jako komentáře dopisuje zvlášť (arrayUnion),
       aby ho odškrtnutí ze staršího okna nesmazalo. */
    if ("vzaliUids" in data) {
        zapis.vzaliUids = Array.isArray(data.vzaliUids) ? data.vzaliUids.slice(0, 40) : [];
    }
    /* Žádost o zpětný zápis (22. 9. 2026): vzkaz manažerům nese den, na
       který chce člověk zapsat. Podle toho ji manažer najde v okně Zpětný
       zápis a vyřídí jedním kliknutím. Kdo žádá, je `odKoho`. */
    if (data.zadostZpetne && /^\d{4}-\d{2}-\d{2}$/.test(data.zadostZpetne.datum || "")) {
        zapis.zadostZpetne = {
            datum: data.zadostZpetne.datum,
            duvod: String(data.zadostZpetne.duvod || "").slice(0, 160)
        };
    }
    /* Nahlášení chyby u výkazu (13. 10. 2026): vlastní zápis jde opravit jen
       do půlnoci dne zápisu, potom na něj člověk jen kouká. Vzkaz proto nese,
       kterého zápisu se týká, ať ho manažer nemusí hledat podle data. */
    if (data.opravaVykazu && data.opravaVykazu.id) {
        zapis.opravaVykazu = {
            id: String(data.opravaVykazu.id).slice(0, 60),
            datum: String(data.opravaVykazu.datum || "").slice(0, 10)
        };
    }
    /* Opakování (21. 10. 2026) – jen když ho volající posílá. Odškrtnutí
       posílá celý vzkaz zpátky, takže se nic neztratí; kdo vzkaz zakládá
       bez opakování, nic navíc nezapíše. Další kopii po splnění zakládá
       KB.zalozDalsiQuick. */
    if ("opakovani" in data) zapis.opakovani = !info && jeOpakovani(data.opakovani) ? data.opakovani : "";
    /* Druh vzkazu (22. 10. 2026): "" = úkol (Splněno), "info" = oznámení
       (Beru na vědomí – stejné pole jako splnění). Jen když ho volající
       posílá: odškrtnutí posílá celý vzkaz zpátky, takže se zachová, a starší
       vzkazy bez pole pozná KBUI.jeOznameni podle textu. */
    /* "milnikTodo" (3. 11. 2026) = „aktualizuj TO-DO u úkolů odevzdaného
       milníku“ (KB.zalozTodoMilniku) – plní se jako úkol (Splněno), jen
       podle druhu a `milnikId` se pozná, ke kterému milníku patří. */
    /* "kratkyDen" (Michal 12. 11. 2026) = hlídka krátkého dne (ui.js): den, kdy má
       zaměstnanec zapsáno pod 8 h – nese `datum` a `chybi` (hodiny do 8) pro tlačítko
       „Zapsat Volno“. Jen u tohoto druhu. */
    if ("druh" in data) zapis.druh = info ? "info"
        : (data.druh === "milnikTodo" || data.druh === "kratkyDen" ? data.druh : "");
    if (data.druh === "kratkyDen") {
        zapis.datum = /^\d{4}-\d{2}-\d{2}$/.test(data.datum || "") ? data.datum : "";
        zapis.chybi = Math.max(0, Math.min(8, Number(data.chybi) || 0));
    }
    if ("milnikId" in data) zapis.milnikId = String(data.milnikId || "").slice(0, 80);
    if ("opakovaniDen" in data) zapis.opakovaniDen = Number(data.opakovaniDen) || 0;
    if ("opakovaniKoren" in data) zapis.opakovaniKoren = String(data.opakovaniKoren || "").slice(0, 80);
    if ("opakovanyZ" in data) zapis.opakovanyZ = String(data.opakovanyZ || "").slice(0, 80);
    /* Odkazy „#projekt / #úkol" v textu (22. 10. 2026) – jen když přijdou;
       tvar hlídá KBUI.cisteOdkazy (ui.js je na stránce vždy před store.js). */
    if ("odkazy" in data && window.KBUI) zapis.odkazy = window.KBUI.cisteOdkazy(data.odkazy);

    await setDoc(quickDoc(id), zapis, { merge: true });
    // hromadné založení (KB.zalozTodoMilniku) si zapíše jeden souhrnný řádek samo
    if (volby && volby.bezAktivity) return id;
    /* Od 21. 8. jde do aktivit i text vzkazu – Michal chce v reportech
       vidět, o jaký vzkaz šlo. Vzkaz tím pádem čtou i manažeři. */
    KB.zapisAktivitu("quicktodo", (data.hotovo === true
        ? (info ? "vzal na vědomí oznámení: " : "splnil quick to-do: ")
        : (info ? "poslal oznámení (" : "zadal quick to-do (") + komu.length + " lidem): ") +
        String(data.text || "").slice(0, 150),
        data.hlidka ? "Systém" : null);
    return id;
};

KB.deleteQuickTodo = async (id) => {
    if (authReady) await authReady;
    requireDb();
    // obrázky napřed – po smazání vzkazu už na ně nikdo nemá právo
    const obrazky = await getDocs(quickObrazkyCol(id)).catch(() => null);
    if (obrazky) { for (const d of obrazky.docs) await deleteDoc(d.ref); }
    await deleteDoc(quickDoc(id));
};

/**
 * Přidá vzkazu screenshot. `nahled` je zmenšená podoba pro dlaždici –
 * posílá se u prvního obrázku, ať je na vzkazu hned vidět, že něco nese.
 * `ms` se schválně nemění: podle něj se vzkazy řadí a ohlašují jako nové.
 */
KB.pridejQuickObrazek = async (id, dataUrl, nahled) => {
    if (authReady) await authReady;
    requireDb();
    const n = "img_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    await setDoc(quickObrazekDoc(id, n), { data: dataUrl, ms: Date.now() });
    const patch = { obrazku: increment(1) };
    if (nahled) patch.nahled = String(nahled).slice(0, 90000);
    await setDoc(quickDoc(id), patch, { merge: true });
    return n;
};

KB.nactiQuickObrazky = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(quickObrazkyCol(id));
    const ven = [];
    snap.forEach(d => ven.push({ id: d.id, ...d.data() }));
    ven.sort((a, b) => (a.ms || 0) - (b.ms || 0));
    return ven;
};

/**
 * „Beru na vědomí" – vzkaz, který se neplní, jen se o něm ví. Zůstane
 * v seznamu (na rozdíl od splněného), jen zešedne, spadne dolů a přestane
 * svítit v odznaku. Hodí se na připomínky akcí: „vím o tom, uvidím to
 * v kalendáři" (Michal 16. 9. 2026).
 */
KB.quickVzetiNaVedomi = async (id, vzal) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    if (!uid) throw new Error("Není kdo bere na vědomí.");
    await setDoc(quickDoc(id), {
        vzaliUids: vzal ? arrayUnion(uid) : arrayRemove(uid)
    }, { merge: true });
};

/**
 * „Odložit na zítra / na pondělí" (rešerše 19. 10. 2026, bod 26). Osobní:
 * `odlozeno.{uid}` = ms, kdy se vzkaz tomu člověku vrátí; 0 = zrušit.
 * Pole se jako „beru na vědomí" dopisuje zvlášť – saveQuickTodo ho nezná,
 * takže ho odškrtnutí ani úprava vzkazu nesmaže.
 */
KB.odlozQuick = async (id, doMs) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    if (!uid || !id) throw new Error("Není kdo odkládá.");
    const ms = Number(doMs) || 0;
    await setDoc(quickDoc(id), { odlozeno: { [uid]: ms > 0 ? ms : deleteField() } }, { merge: true });
};

/** Komentář ke vzkazu – stejně jako u poznámek, ať se dá odpovědět na místě. */
KB.pridejQuickKomentar = async (id, text) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(quickDoc(id), {
        komentare: arrayUnion({
            uid: KB.currentUid(),
            jmeno: window.KB_USER || "",
            text: String(text || "").slice(0, 500),
            ms: Date.now()
        })
    }, { merge: true });
};

/* ------------------------------------------------- poznámky = konverzace ---
   Od 21. 10. 2026 jsou Poznámky chat (přání Michala): LIST je KONVERZACE
   a POZNÁMKA je ZPRÁVA. Data se nestěhovala – staré listy a poznámky se
   samy ukážou jako konverzace a zprávy, staré komentáře jako odpovědi.
   Jako Quick TO-DO leží mimo `private` – nevidí je ani manažer, jen
   účastníci konverzace.

     osobni/poznamky/listy/{id}      konverzace { nazev, uid = zakladatel,
                                     jmeno, sdileni = ostatní účastníci, ms,
                                     posledniMs/Uid/Jmeno/Text/Id (dlaždice
                                     a odznak nepřečtených), ztlumili [uid],
                                     precteno { uid: ms } – kam až kdo četl }
     osobni/poznamky/zaznamy/{id}    zpráva { listId, listNazev, text, uid =
                                     autor, jmeno, sdileni = VŠICHNI účastníci
                                     (podle toho ji databáze vydá), createdMs,
                                     ms, nahled, obrazku, stav? (0 řeší se,
                                     1 splněno), typ? ("udalost": akce, kdo),
                                     odpovedNa? { id, uid, jmeno, text },
                                     preposlano? { jmeno, ms } }
     osobni/poznamky/zaznamy/{id}/obrazky/{n}   screenshoty (JPEG base64)

   Upozornění (ntfy, e-mail) rozesílá Apps Script (KB.ohlasZpravu níž) –
   čte konverzaci a zprávu servisním účtem (pravidla: rozesilac()), bere
   účastníky z `uid` + `sdileni`, vynechá `ztlumili` a podle `precteno`
   může poskládat souhrn nepřečteného.

   Čas zprávy je `createdMs` a už se nemění. Stará poznámka ho nemá – její
   `ms` se posouvalo při každé úpravě; nepřečtená proto nikdy není (jinak
   by po přechodu na chat svítilo všechno, co kdy kdo napsal). */

const poznListyCol = () => collection(db, "artifacts", APP_ID, "osobni", "poznamky", "listy");
const poznListDoc = (id) => doc(db, "artifacts", APP_ID, "osobni", "poznamky", "listy", id);
const poznCol = () => collection(db, "artifacts", APP_ID, "osobni", "poznamky", "zaznamy");
const poznDoc = (id) => doc(db, "artifacts", APP_ID, "osobni", "poznamky", "zaznamy", id);
const poznObrazky = (id) => collection(db, "artifacts", APP_ID, "osobni", "poznamky", "zaznamy", id, "obrazky");
const poznObrazek = (id, n) => doc(db, "artifacts", APP_ID, "osobni", "poznamky", "zaznamy", id, "obrazky", String(n));

KB.poznListy = [];
KB.poznamky = [];
KB.poznPrecteno = {};       // listId → ms, kam až jsem v konverzaci četl (z `precteno` konverzací)
KB.poznNeprecteno = 0;      // konverzací s nepřečtenou zprávou (bez ztlumených) – odznak v liště
KB.poznNacteno = false;     // dorazily konverzace i zprávy (stránka Poznámky)
let poznOdbery = [];        // zprávy – jen stránka Poznámky
let poznHlavyOdbery = [];   // konverzace (s přečteno) – každá stránka (odznak)
const poznPrectenoHned = {}; // přečteno zapsané z tohoto okna, než ho databáze vrátí
const poznKusy = { listyMoje: [], listySdilene: [], zaznamyMoje: [], zaznamySdilene: [] };
const poznPrislo = {};      // který odběr už poslal první snímek

/** Účastníci konverzace: zakladatel + `sdileni`, bez prázdných a dvojic. */
KB.poznUcastnici = (l) => {
    const ven = [];
    [l && l.uid].concat((l && Array.isArray(l.sdileni)) ? l.sdileni : [])
        .forEach(u => { if (u && typeof u === "string" && ven.indexOf(u) === -1) ven.push(u); });
    return ven;
};

/** Kdy zpráva vznikla – nová má `createdMs`, stará poznámka jen `ms`. */
KB.poznCas = (z) => Number(z && (z.createdMs || z.ms)) || 0;

/** Ztlumil jsem si konverzaci? (`ztlumili` = pole uid; snese i mapu.) */
KB.poznZtlumena = (l, uid) => {
    const z = l && l.ztlumili;
    const kdo = uid || KB.currentUid();
    if (Array.isArray(z)) return z.indexOf(kdo) !== -1;
    if (z && typeof z === "object" && z[kdo]) return z[kdo] === true || Number(z[kdo]) > Date.now();
    return false;
};

/** Je v konverzaci zpráva, kterou jsem nečetl? Pozná se už z hlavičky. */
KB.poznMaNove = (l) => {
    const uid = KB.currentUid();
    return !!l && !!l.posledniUid && l.posledniUid !== uid &&
        Number(l.posledniMs) > (Number(KB.poznPrecteno[l.id]) || 0);
};

/** Nepřečtené zprávy konverzace – jen nové zprávy od ostatních. */
KB.poznNeprecteneZpravy = (listId) => {
    const uid = KB.currentUid();
    const od = Number(KB.poznPrecteno[listId]) || 0;
    return (KB.poznamky || []).filter(z => z.listId === listId && z.uid !== uid &&
        z.typ !== "udalost" && Number(z.createdMs) > od);
};

function slejPoznamky() {
    const uid = KB.currentUid();
    const listy = new Map(), zaznamy = new Map();
    poznKusy.listyMoje.concat(poznKusy.listySdilene).forEach(l => listy.set(l.id, l));
    poznKusy.zaznamyMoje.concat(poznKusy.zaznamySdilene).forEach(z => zaznamy.set(z.id, z));
    KB.poznListy = Array.from(listy.values()).sort((a, b) => (a.ms || 0) - (b.ms || 0));
    // přečteno: z konverzace, a dokud se nevrátí z databáze, i to právě zapsané
    const precteno = {};
    KB.poznListy.forEach(l => {
        const p = (l.precteno && typeof l.precteno === "object") ? Number(l.precteno[uid]) || 0 : 0;
        const kdy = Math.max(p, Number(poznPrectenoHned[l.id]) || 0);
        if (kdy) precteno[l.id] = kdy;
    });
    KB.poznPrecteno = precteno;
    // zprávy v pořadí, jak se psaly (chat čte shora dolů)
    KB.poznamky = Array.from(zaznamy.values()).sort((a, b) => KB.poznCas(a) - KB.poznCas(b));
    KB.poznNeprecteno = KB.poznListy.filter(l => KB.poznMaNove(l) && !KB.poznZtlumena(l, uid)).length;
    KB.poznNacteno = !!(poznPrislo.listyMoje && poznPrislo.listySdilene &&
        poznPrislo.zaznamyMoje && poznPrislo.zaznamySdilene);
    emit("poznamky", null);
    emit("pozn-neprecteno", KB.poznNeprecteno);
}

/* Pravidla umí dotaz povolit nebo zakázat, ne ho profiltrovat – proto
   vždy dva dotazy (moje / sdílené se mnou) a slepení podle id. */
function sledujPozn(kam, klic, dotaz) {
    kam.push(onSnapshot(dotaz, (s) => {
        poznKusy[klic] = [];
        s.forEach(d => poznKusy[klic].push({ id: d.id, ...d.data() }));
        poznPrislo[klic] = true;
        slejPoznamky();
    }, (err) => console.error("Chyba čtení poznámek:", err)));
}

/**
 * Hlavičky konverzací (i s „přečteno do") – malé dokumenty, poslouchá je
 * každá stránka kvůli odznaku nepřečtených v liště (ui.js). Zprávy samotné
 * až KB.watchPoznamky na stránce Poznámky.
 */
KB.watchPoznHlavy = async () => {
    if (poznHlavyOdbery.length) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || poznHlavyOdbery.length) return;
    const uid = auth.currentUser.uid;
    sledujPozn(poznHlavyOdbery, "listyMoje", query(poznListyCol(), where("uid", "==", uid)));
    sledujPozn(poznHlavyOdbery, "listySdilene", query(poznListyCol(), where("sdileni", "array-contains", uid)));
};

KB.watchPoznamky = async () => {
    KB.watchPoznHlavy();
    if (poznOdbery.length) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || poznOdbery.length) return;
    const uid = auth.currentUser.uid;
    sledujPozn(poznOdbery, "zaznamyMoje", query(poznCol(), where("uid", "==", uid)));
    sledujPozn(poznOdbery, "zaznamySdilene", query(poznCol(), where("sdileni", "array-contains", uid)));
};

function zrusPoznamky() {
    poznOdbery.concat(poznHlavyOdbery).forEach(stop => { try { stop(); } catch (e) {} });
    poznOdbery = []; poznHlavyOdbery = [];
    poznKusy.listyMoje = []; poznKusy.listySdilene = [];
    poznKusy.zaznamyMoje = []; poznKusy.zaznamySdilene = [];
    Object.keys(poznPrislo).forEach(k => { delete poznPrislo[k]; });
    Object.keys(poznPrectenoHned).forEach(k => { delete poznPrectenoHned[k]; });
    KB.poznListy = []; KB.poznamky = []; KB.poznPrecteno = {};
    KB.poznNeprecteno = 0; KB.poznNacteno = false;
    emit("pozn-neprecteno", 0);
}

const novePoznId = (pred) => pred + Date.now() + "_" + Math.floor(Math.random() * 1000);
const poznKonverzace = (lid) => (KB.poznListy || []).find(l => l.id === lid) || null;

/** Zprávy konverzace, které smím číst. Na stránce Poznámky jsou živé
    v paměti; jinde (nebo dřív, než dorazily) se dotáhnou dvěma dotazy. */
async function zpravyKonverzace(lid) {
    if (poznOdbery.length && KB.poznNacteno) return (KB.poznamky || []).filter(z => z.listId === lid);
    const uid = KB.currentUid();
    const [a, b] = await Promise.all([
        getDocs(query(poznCol(), where("uid", "==", uid))),
        getDocs(query(poznCol(), where("sdileni", "array-contains", uid)))
    ]);
    const m = new Map();
    [a, b].forEach(s => s.forEach(d => m.set(d.id, { id: d.id, ...d.data() })));
    return Array.from(m.values()).filter(z => z.listId === lid);
}

/**
 * Srovná čtenáře zpráv (`sdileni`) dávkou po 400 zápisech (limit dávky je
 * 500). Když dávka neprojde (zpráva mezitím zmizela – update na neexistující
 * dokument shodí celou dávku), zkusí se zprávy po jedné.
 */
async function srovnejCtenare(zpravy, zmena) {
    for (let i = 0; i < zpravy.length; i += 400) {
        const kus = zpravy.slice(i, i + 400);
        try {
            const davka = writeBatch(db);
            kus.forEach(z => davka.update(poznDoc(z.id), { sdileni: zmena }));
            await davka.commit();
        } catch (err) {
            console.warn("Dávka čtenářů neprošla, zkouším po jedné:", err);
            for (const z of kus) {
                await updateDoc(poznDoc(z.id), { sdileni: zmena })
                    .catch(e => console.warn("Zpráva " + z.id + " se nesrovnala:", e));
            }
        }
    }
}

/** Záznam do časové osy („X přidal(a) Y"). Píše ho účastník sám za sebe. */
async function zapisUdalost(l, ucastnici, akce, kdo) {
    const id = novePoznId("pz_");
    const ted = Date.now();
    const jmena = (kdo || []).map(u => {
        const c = (KB.users || []).find(x => x.id === u);
        return c ? ((c.first || "") + " " + (c.last || "")).trim() : "";
    }).filter(Boolean).join(", ");
    const veta = { pridal: "přidal(a) do konverzace: ", odebral: "odebral(a) z konverzace: ",
                   opustil: "opustil(a) konverzaci" }[akce] || "";
    await setDoc(poznDoc(id), {
        listId: l.id, listNazev: String(l.nazev || "").slice(0, 80),
        typ: "udalost", akce: akce, kdo: (kdo || []).slice(0, 50),
        text: (veta + (akce === "opustil" ? "" : jmena)).slice(0, 300),
        uid: KB.currentUid(), jmeno: window.KB_USER || "",
        sdileni: ucastnici, createdMs: ted, ms: ted, obrazku: 0
    });
    return id;
}

/** Vzkaz do Quick TO-DO lidem, kteří do konverzace právě přibyli – jen
    tehdy, ne u každé zprávy (o zprávách dá vědět KB.ohlasZpravu). */
function ohlasPridani(nazev, uids, zpravaId) {
    if (!uids || !uids.length) return;
    KB.saveQuickTodo(KB.newQuickId(), {
        text: "Přidal tě do konverzace „" + String(nazev || "bez názvu").slice(0, 80) + "“ v Chatu.",
        proUids: uids.slice(),
        druh: "info", rezim: "kazdy",       // oznámení – každý bere na vědomí sám
        poznamka: zpravaId || ""
    }).catch(err => console.warn("Vzkaz o přidání do konverzace se nezapsal:", err));
}

/** Nová konverzace; `uids` = kdo v ní bude kromě mě (může být nikdo). */
KB.zalozKonverzaci = async (nazev, uids) => {
    if (authReady) await authReady;
    requireDb();
    const ja = KB.currentUid();
    const lide = (uids || []).filter((u, i, a) => u && u !== ja && a.indexOf(u) === i).slice(0, 49);
    const lid = novePoznId("pzl_");
    const l = {
        nazev: String(nazev || "").trim().slice(0, 80) || "Konverzace",
        uid: ja, jmeno: window.KB_USER || "",
        sdileni: lide, ztlumili: [], ms: Date.now()
    };
    await setDoc(poznListDoc(lid), l);
    if (lide.length) {
        let udalost = "";
        try { udalost = await zapisUdalost({ id: lid, ...l }, [ja].concat(lide), "pridal", lide); }
        catch (err) { console.warn("Záznam o přidání se nezapsal:", err); }
        ohlasPridani(l.nazev, lide, udalost);
    }
    return lid;
};

/** Přejmenování – jen zakladatel (hlídají pravidla). */
KB.prejmenujKonverzaci = async (lid, nazev) => {
    if (authReady) await authReady;
    requireDb();
    await updateDoc(poznListDoc(lid), { nazev: String(nazev || "").trim().slice(0, 80) || "Konverzace" });
};

/**
 * Přidá lidi do konverzace. Smí každý účastník, nejen zakladatel – stejně
 * jako dřív smělo jít upozornění u poznámky komukoliv. Nový člověk uvidí
 * i historii: všem zprávám, které vidím, se čtenáři srovnají s účastníky.
 * Vrací, kolik lidí opravdu přibylo.
 */
KB.pridejDoKonverzace = async (lid, uids) => {
    if (authReady) await authReady;
    requireDb();
    const l = poznKonverzace(lid);
    if (!l) throw new Error("Konverzace není načtená.");
    const ted = KB.poznUcastnici(l);
    const novi = (uids || []).filter((u, i, a) => u && a.indexOf(u) === i && ted.indexOf(u) === -1);
    if (!novi.length) return 0;
    if (ted.length + novi.length > 50) throw new Error("V konverzaci může být nejvýš 50 lidí.");
    await updateDoc(poznListDoc(lid), { sdileni: arrayUnion(...novi) });
    // účastníky beru znovu z databáze – mohl je mezitím měnit i někdo jiný
    const cerstva = await getDoc(poznListDoc(lid));
    const lCerstva = cerstva.exists() ? { id: lid, ...cerstva.data() } : { ...l, sdileni: (l.sdileni || []).concat(novi) };
    const vsichni = KB.poznUcastnici(lCerstva);
    const zpravy = await zpravyKonverzace(lid);
    await srovnejCtenare(zpravy.filter(z => vsichni.some(u => (z.sdileni || []).indexOf(u) === -1)),
        arrayUnion(...vsichni));
    let udalost = "";
    try { udalost = await zapisUdalost(lCerstva, vsichni, "pridal", novi); }
    catch (err) { console.warn("Záznam o přidání se nezapsal:", err); }
    ohlasPridani(lCerstva.nazev, novi, udalost);
    return novi.length;
};

/** Odebrání člověka – jen zakladatel. Odebraný přestane vidět i historii. */
KB.odeberZKonverzace = async (lid, uid) => {
    if (authReady) await authReady;
    requireDb();
    const l = poznKonverzace(lid);
    if (!l || l.uid !== KB.currentUid()) throw new Error("Odebírat smí jen zakladatel konverzace.");
    if (!uid || uid === l.uid) return;
    await updateDoc(poznListDoc(lid), { sdileni: arrayRemove(uid) });
    const zbyli = KB.poznUcastnici(l).filter(u => u !== uid);
    try { await zapisUdalost(l, zbyli, "odebral", [uid]); }
    catch (err) { console.warn("Záznam o odebrání se nezapsal:", err); }
    const zpravy = await zpravyKonverzace(lid);
    await srovnejCtenare(zpravy.filter(z => (z.sdileni || []).indexOf(uid) !== -1), arrayRemove(uid));
};

/** Opustit konverzaci (účastník; zakladatel ji místo toho smaže). */
KB.opustKonverzaci = async (lid) => {
    if (authReady) await authReady;
    requireDb();
    const ja = KB.currentUid();
    const l = poznKonverzace(lid);
    if (!l) throw new Error("Konverzace není načtená.");
    if (l.uid === ja) throw new Error("Zakladatel konverzaci neopouští – může ji smazat.");
    // záznam ještě jako účastník – potom už by ho databáze nepustila
    try { await zapisUdalost(l, KB.poznUcastnici(l), "opustil", [ja]); }
    catch (err) { console.warn("Záznam o odchodu se nezapsal:", err); }
    const zpravy = await zpravyKonverzace(lid);
    await srovnejCtenare(zpravy.filter(z => (z.sdileni || []).indexOf(ja) !== -1), arrayRemove(ja));
    await updateDoc(poznListDoc(lid), { sdileni: arrayRemove(ja) });
};

/** Ztlumit upozornění (ntfy, e-mail i odznak v liště) – každý jen sám sebe. */
KB.ztlumKonverzaci = async (lid, ztlumit) => {
    if (authReady) await authReady;
    requireDb();
    const ja = KB.currentUid();
    await updateDoc(poznListDoc(lid), { ztlumili: ztlumit ? arrayUnion(ja) : arrayRemove(ja) });
};

/**
 * Přečteno do `ms` (čas poslední zprávy, kterou jsem viděl – ne hodiny
 * tohohle počítače). Jen dopředu. Leží v konverzaci jako `precteno.{uid}`:
 * účastníci tak vidí, kdo co četl, a Apps Script z toho může poskládat
 * souhrn. Každý smí zapsat jen svůj klíč (pravidla).
 */
KB.oznacPrecteno = async (lid, ms) => {
    if (authReady) await authReady;
    requireDb();
    const kdy = Number(ms) || 0;
    if (!lid || !kdy || (Number(KB.poznPrecteno[lid]) || 0) >= kdy) return;
    // hned v paměti – odznak zhasne bez čekání na databázi
    poznPrectenoHned[lid] = kdy;
    slejPoznamky();
    await updateDoc(poznListDoc(lid), { ["precteno." + KB.currentUid()]: kdy });
};

const kratce = (v, n) => String(v == null ? "" : v).slice(0, n);

/** Na co zpráva odpovídá: { id, uid, jmeno, text ≤ 100 znaků } – kopie úryvku,
    ať citace přežije i smazání originálu. Pravidla obsah nehlídají, proto
    jen holé řetězce s oříznutou délkou (kreslí se vždy přes esc). */
function cistaOdpoved(o) {
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !o.id) return null;
    return { id: kratce(o.id, 100), uid: kratce(o.uid, 128), jmeno: kratce(o.jmeno, 80), text: kratce(o.text, 100) };
}

/** Přeposlaná zpráva nese jen autora a čas originálu – NIKDY název
    konverzace, odkud je (cílovou konverzaci můžou číst jiní lidé). */
function cistePreposlani(p) {
    if (!p || typeof p !== "object") return null;
    return { jmeno: kratce(p.jmeno, 80), ms: Number(p.ms) || 0 };
}

/**
 * Odešle zprávu: text a/nebo screenshoty (data URL z UI.zmensiObrazek),
 * `nahled` = malý náhled prvního obrázku, `odpovedNa` (rychlá odpověď)
 * a `preposlano` (přeposlání) – viz funkce výš. Vrací id zprávy.
 */
KB.posliZpravu = async (lid, data) => {
    if (authReady) await authReady;
    requireDb();
    const d = data || {};
    const l = poznKonverzace(lid);
    if (!l) throw new Error("Konverzace není načtená.");
    const ja = KB.currentUid();
    const ucastnici = KB.poznUcastnici(l);
    if (ucastnici.indexOf(ja) === -1) throw new Error("V téhle konverzaci nejsi.");
    const text = String(d.text || "").trim().slice(0, 4000);
    const fotky = (d.obrazky || []).filter(x => typeof x === "string" && x).slice(0, 10);
    if (!text && !fotky.length) return "";
    const id = novePoznId("pz_");
    const ted = Date.now();
    // odkazy „#projekt / #úkol" – pole jen u zprávy, která nějaký má
    const odkazy = window.KBUI ? window.KBUI.cisteOdkazy(d.odkazy) : [];
    const odpovedNa = cistaOdpoved(d.odpovedNa);
    const preposlano = cistePreposlani(d.preposlano);
    await setDoc(poznDoc(id), Object.assign({
        listId: lid, listNazev: String(l.nazev || "").slice(0, 80),
        text: text, uid: ja, jmeno: window.KB_USER || "",
        // čtenáři = přesně účastníci konverzace (pravidla to hlídají)
        sdileni: ucastnici, createdMs: ted, ms: ted,
        nahled: String(d.nahled || "").slice(0, 90000), obrazku: fotky.length
    }, odkazy.length ? { odkazy: odkazy } : {},
       odpovedNa ? { odpovedNa: odpovedNa } : {},
       preposlano ? { preposlano: preposlano } : {}));
    for (let i = 0; i < fotky.length; i++) {
        await setDoc(poznObrazek(id, "img_" + ted + "_" + i), { data: fotky[i], ms: ted + i });
    }
    // dlaždice a odznak nepřečtených u ostatních; vlastní zpráva je přečtená
    poznPrectenoHned[lid] = Math.max(Number(poznPrectenoHned[lid]) || 0, ted);
    await updateDoc(poznListDoc(lid), {
        posledniMs: ted, posledniUid: ja, posledniJmeno: window.KB_USER || "",
        posledniText: (text || "📷 Obrázek").slice(0, 140), posledniId: id,
        ["precteno." + ja]: ted
    }).catch(err => console.warn("Poslední zpráva konverzace se nezapsala:", err));
    KB.ohlasZpravu(lid, id);
    return id;
};

/**
 * Upozornění na novou zprávu (ntfy do mobilu, e-mail) – vyřizuje Apps
 * Script (`meta/gsync`), stejná cesta jako zápis zakázky do evidence.
 * Bez čekání a bez čtení odpovědi: zpráva je uložená tak jako tak.
 * Skript z tokenu pozná odesílatele a zprávu i konverzaci si přečte
 * sám (smlouva je u funkce v gas/).
 */
KB.ohlasZpravu = async (listId, zpravaId) => {
    if (!KB.gsyncUrl || !listId || !zpravaId) return;
    await poOdeslani();
    let token = "";
    try { token = await auth.currentUser.getIdToken(); } catch (err) { /* bez tokenu skript nic nepošle */ }
    try {
        fetch(KB.gsyncUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ akce: "zprava", token: token, listId: listId, zpravaId: zpravaId })
        }).catch(err => console.warn("Upozornění na zprávu se neozvalo:", err));
    } catch (err) { console.warn("Upozornění na zprávu se neodeslalo:", err); }
};

/** Štítek zprávy: 0 = řeší se, 1 = splněno, cokoliv jiného = bez štítku.
    Smí každý účastník (jako dřív „vyřešeno" u poznámky). */
KB.stavZpravy = async (id, stav) => {
    if (authReady) await authReady;
    requireDb();
    await updateDoc(poznDoc(id), { stav: (stav === 0 || stav === 1) ? stav : deleteField() });
};

/** Oprava textu – jen autor. */
KB.upravZpravu = async (id, text) => {
    if (authReady) await authReady;
    requireDb();
    await updateDoc(poznDoc(id), { text: String(text || "").slice(0, 4000), upraveno: Date.now() });
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

/** Smaže zprávu i s obrázky (autor, nebo zakladatel konverzace). */
KB.smazPoznamku = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const obrazky = await getDocs(poznObrazky(id));
    for (const d of obrazky.docs) await deleteDoc(d.ref);
    await deleteDoc(poznDoc(id));
};

/** Smaže konverzaci se všemi zprávami, které vidím (jen zakladatel). Zprávy
    napřed – po smazání konverzace by na ně zakladatel neměl právo. */
KB.smazPoznList = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const zpravy = await zpravyKonverzace(id);
    for (const z of zpravy) {
        try { await KB.smazPoznamku(z.id); }
        catch (err) { console.warn("Zpráva " + z.id + " se nesmazala:", err); }
    }
    await deleteDoc(poznListDoc(id));
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
    /* Autor návodu podle uid (audit 10. 11. 2026, A1-10): pravidla pouští
       úpravu jen autorovi a správci, ale poznají ho jen z `createdUid`.
       Zapisuje se jen při založení – starší návody bez něj dál upraví
       každý člen (doplnit ho zpětně by úpravu zamklo tomu, kdo ho doplnil). */
    if (!(KB.guides || []).some(g => g && g.id === id)) payload.createdUid = KB.currentUid() || "";
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
   Harmonogram odevzdání – celá příloha smlouvy, ne pár termínů. Manažer
   vidí všechno a zveřejňuje postupně; zaměstnanec vidí zveřejněné milníky
   i kolegů, ale TERMÍN jen u svých (Michal 8. 10. 2026).

   Dřív to bylo pole v jednom dokumentu `public/data/meta/milniky`. To tohle
   neumí ze dvou důvodů: do `public/data` vidí každý člen a níž se čtení
   nedá odebrat, a jeden dokument nejde zamknout po řádcích. Proto dva
   dokumenty se stejným {id} mimo `public`, stejný trik jako u výkazů:

     private/milniky/seznam/{id}    co milník je   → manažer vše, člen jen zveřejněné
     private/milniky/terminy/{id}   termín         → manažer vše, člen jen svůj

   Kdo smí termín číst, stojí v poli `kdoVidiTermin`: prázdné = nezveřejněno,
   jinak UID zpracovatelů. Jedno pole tak zastane zveřejnění i omezení na
   vlastníka — a dotaz `array-contains` se obejde bez složeného indexu
   (pravidla nejsou filtr, dotaz si o svoje musí říct sám).

   Stránky dostávají pořád stejný tvar položky jako dřív
   ({ id, cinnost, owners, napln, datum, zakazka, hotovo… }), jen s termínem
   jen tam, kde na něj člověk má. Nástěnka, kalendář ani pás se proto
   neměnily; milník se skrytým termínem je pro ně „bez data" a navíc nese
   `terminSkryty`, ať se to nespálí s milníkem, který termín opravdu nemá. */

const milnikSeznamCol = () => collection(db, "artifacts", APP_ID, "private", "milniky", "seznam");
const milnikTerminCol = () => collection(db, "artifacts", APP_ID, "private", "milniky", "terminy");
const milnikSeznamDoc = (id) => doc(db, "artifacts", APP_ID, "private", "milniky", "seznam", id);
const milnikTerminDoc = (id) => doc(db, "artifacts", APP_ID, "private", "milniky", "terminy", id);

let milnikySeznam = {};      // id -> milník ze zveřejněných
let milnikyPostup = {};      // id -> milník z mojí technologie (i nezveřejněný)
let syroveTerminy = {};      // id -> termín, jen ty, na které mám právo
let syrovePuvodni = {};      // id -> původní termín (štítek „posunuto“ na stránce Milníky)
let milnikyOdbery = [];

/**
 * Kdo na téhle technologii dělá – ti uvidí její milníky jako svůj postup,
 * i když ještě nejsou zveřejněné. Termín u nich stejně nedostanou; jde
 * o to, aby člověk věděl, co po jeho profesi přijde (Michal 8. 10. 2026).
 *
 * Technologie se porovnává CELÁ. „STAVBA + SLN" je společný milník obou
 * profesí, ne důvod, aby stavař viděl ve svém postupu všechny elektro
 * milníky; kdo je na společném milníku zpracovatel, ten ho ve svém postupu
 * má přes zpracovatele.
 */
function postupLide(cinnost, vsechny) {
    const klic = String(cinnost || "").trim();
    const kdo = [];
    (vsechny || []).forEach(m => {
        if (String(m.cinnost || "").trim() !== klic) return;
        (m.zpracovatele || m.owners || []).forEach(uid => {
            if (kdo.indexOf(uid) === -1) kdo.push(uid);
        });
    });
    return kdo;
}

KB.newMilnikId = () => "mil_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

/** Slepí milník s termínem do tvaru, na který jsou stránky zvyklé. */
function slijMilniky() {
    const uid = (auth && auth.currentUser) ? auth.currentUser.uid : "";
    const manazer = jsemManazer();
    /* Dvě hromádky: zveřejněné milníky (vidí je každý) a milníky mojí
       technologie (i nezveřejněné). Můžou se překrývat, proto klíč podle id. */
    const vse = Object.assign({}, milnikyPostup, milnikySeznam);
    KB.milniky = Object.keys(vse).map(id => vse[id]).map(m => {
        const zpracovatele = Array.isArray(m.zpracovatele) ? m.zpracovatele : [];
        const muj = !!uid && zpracovatele.indexOf(uid) !== -1;
        const termin = syroveTerminy[m.id] || "";
        return Object.assign({}, m, {
            owners: zpracovatele,
            zakazka: m.projekt || "",
            datum: termin,
            // původní termín (před posuny) – stránka Milníky z něj dělá štítek „posunuto“
            terminPuvodni: termin ? (syrovePuvodni[m.id] || "") : "",
            // termín existuje, ale není pro mě – ne totéž co milník bez termínu
            terminSkryty: !termin && !manazer && !muj,
            /* Tenhle milník mám jen jako výhled své profese – v běžných
               pohledech nemá co dělat, patří do „Můj postup". */
            jenPostup: !manazer && m.zverejneno === false
        });
    }).sort((a, b) => (Number(a.poradi) || 0) - (Number(b.poradi) || 0));
    emit("milniky", KB.milniky);
}

/** Odběr podle role: manažer celý harmonogram, člen jen zveřejněné. */
KB.watchMilniky = async () => {
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser) return;
    if (pockejNaRoli(KB.watchMilniky)) return;
    milnikyOdbery.forEach(zavri => { try { zavri(); } catch (err) { /* už zavřený */ } });
    milnikyOdbery = [];

    const uid = auth.currentUser.uid;
    const manazer = jsemManazer();
    const dotazSeznam = manazer ? milnikSeznamCol()
        : query(milnikSeznamCol(), where("zverejneno", "==", true));
    const dotazTerminy = manazer ? milnikTerminCol()
        : query(milnikTerminCol(), where("kdoVidiTermin", "array-contains", uid));

    milnikyOdbery.push(onSnapshot(dotazSeznam, (snap) => {
        milnikySeznam = {};
        snap.forEach(d => { milnikySeznam[d.id] = { id: d.id, ...d.data() }; });
        slijMilniky();
    }, (err) => console.error("Chyba čtení milníků:", err)));

    /* Druhý dotaz: milníky mojí technologie, i nezveřejněné. Pravidla nejsou
       filtr, takže si o ně musí říct dotaz sám – a `array-contains` na jednom
       poli se obejde bez složeného indexu. Manažer má všechno z prvního. */
    if (!manazer) {
        milnikyOdbery.push(onSnapshot(
            query(milnikSeznamCol(), where("kdoVidiPostup", "array-contains", uid)), (snap) => {
                milnikyPostup = {};
                snap.forEach(d => { milnikyPostup[d.id] = { id: d.id, ...d.data() }; });
                slijMilniky();
            }, (err) => console.error("Chyba čtení postupu milníků:", err)));
    }

    milnikyOdbery.push(onSnapshot(dotazTerminy, (snap) => {
        syroveTerminy = {};
        syrovePuvodni = {};
        snap.forEach(d => {
            const t = d.data() || {};
            syroveTerminy[d.id] = t.termin || "";
            syrovePuvodni[d.id] = t.terminPuvodni || "";
        });
        slijMilniky();
    }, (err) => console.error("Chyba čtení termínů milníků:", err)));
};

/** Co z položky patří do kterého dokumentu. */
function milnikDoDvou(item, puvodni, vsechny) {
    const p = puvodni || {};
    const zpracovatele = Array.isArray(item.owners) ? item.owners
        : (Array.isArray(item.zpracovatele) ? item.zpracovatele : []);
    const zverejneno = item.zverejneno === true;
    /* Vlastní zpracovatelé tam musí být vždycky – i když se milník zrovna
       nepočítá do seznamu, ze kterého se parta technologie skládá. */
    const kdoVidiPostup = postupLide(item.cinnost, vsechny || KB.milniky || [])
        .concat(zpracovatele).filter((u, i, pole) => pole.indexOf(u) === i);
    const razitko = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    return {
        zpracovatele: zpracovatele,
        seznam: Object.assign({
            cinnost: String(item.cinnost || "").slice(0, 60),
            napln: String(item.napln || "").slice(0, 600),
            skupina: String(item.skupina || p.skupina || "").slice(0, 80),
            poznamka: String(item.poznamka || "").slice(0, 300),
            projekt: String(item.zakazka || item.projekt || "").slice(0, 160),
            zpracovatele: zpracovatele,
            zverejneno: zverejneno,
            // kdo tuhle technologii dělá – ten milník uvidí i před zveřejněním
            kdoVidiPostup: kdoVidiPostup,
            poradi: Number(item.poradi) || Number(p.poradi) || 0,
            stav: String(item.stav || p.stav || "planovano"),
            // úprava milníku nesmí shodit značku „splněno"
            hotovo: !!item.hotovo,
            hotovoKdo: item.hotovoKdo || "",
            hotovoMs: Number(item.hotovoMs) || 0,
            potvrzeno: item.potvrzeno !== false,
            potvrdil: item.potvrdil || "",
            potvrzenoMs: Number(item.potvrzenoMs) || 0
        }, razitko),
        termin: Object.assign({
            termin: String(item.datum || "").slice(0, 10),
            terminPuvodni: String(item.terminPuvodni || p.terminPuvodni || item.datum || "").slice(0, 10),
            // nezveřejněný termín nemá číst nikdo kromě manažera
            kdoVidiTermin: zverejneno ? zpracovatele : []
        }, razitko)
    };
}

/** Založení i úprava milníku – jen manažer. */
KB.ulozMilnik = async (item) => {
    if (authReady) await authReady;
    requireDb();
    const id = item.id || KB.newMilnikId();
    const puvodni = (KB.milniky || []).find(m => m.id === id);
    /* Uložený milník se do seznamu započítá rovnou – jinak by si u nově
       přiřazeného člověka sám sebe do `kdoVidiPostup` nedoplnil. */
    const vsechny = (KB.milniky || []).filter(m => m.id !== id)
        .concat([Object.assign({}, item, { id: id })]);
    const casti = milnikDoDvou(item, puvodni, vsechny);
    await setDoc(milnikSeznamDoc(id), casti.seznam, { merge: true });
    await setDoc(milnikTerminDoc(id), casti.termin, { merge: true });
    await KB.srovnejPostupy(vsechny);
    return id;
};

/**
 * Když se u milníku změní zpracovatelé, změní se i to, kdo tu technologii
 * dělá – a ostatní milníky téže technologie o tom nevědí. Tohle je srovná;
 * zapisuje jen ty, kterým se seznam opravdu změnil (obvykle žádný).
 * @returns {Promise<number>} kolik milníků se srovnalo
 */
KB.srovnejPostupy = async (vsechny) => {
    if (authReady) await authReady;
    requireDb();
    const seznam = vsechny || KB.milniky || [];
    const zmenene = seznam.filter(m => {
        const maji = (m.kdoVidiPostup || []).slice().sort().join(",");
        return postupLide(m.cinnost, seznam).slice().sort().join(",") !== maji;
    });
    if (!zmenene.length) return 0;
    const davka = writeBatch(db);
    zmenene.slice(0, 400).forEach(m => {
        davka.update(milnikSeznamDoc(m.id), {
            kdoVidiPostup: postupLide(m.cinnost, seznam),
            updatedMs: Date.now(), updatedBy: window.KB_USER || ""
        });
    });
    await davka.commit();
    return zmenene.length;
};

/**
 * Zveřejnění milníku. Termín se zpřístupní jen zpracovatelům – kolega
 * uvidí, že milník existuje a čí je, ne ale kdy ho má odevzdat.
 */
KB.zverejniMilnik = async (id, zverejnit) => {
    if (authReady) await authReady;
    requireDb();
    const m = (KB.milniky || []).find(x => x.id === id);
    if (!m) return;
    const razitko = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    await updateDoc(milnikSeznamDoc(id), Object.assign({ zverejneno: !!zverejnit }, razitko));
    // merge, ne update – u ručně založeného milníku nemusí termín ještě existovat
    await setDoc(milnikTerminDoc(id), Object.assign(
        { kdoVidiTermin: zverejnit ? (m.owners || []) : [] }, razitko), { merge: true });
};

/**
 * Termín a/nebo zveřejnění několika milníků jednou dávkou – hromadná změna
 * termínu a „Zveřejnit s termínem…" na stránce Milníky (Michal 20. 10. 2026).
 *   zmeny: [{ id, termin }]  termin "YYYY-MM-DD"; bez pole termin zůstává
 *   volby.zverejnit: true    milník zveřejní, termín pustí zpracovatelům
 *                            a orazítkuje `zverejnenoMs` (štítek „nový")
 * Původní termín se neztrácí: `terminPuvodni` zůstává, a kde ještě není,
 * uloží se do něj termín před změnou. Proto se termíny nejdřív přečtou –
 * KB.milniky je nemá (slijMilniky bere jen `termin`).
 * @returns {Promise<{zapsano: number, puvodni: Object<string, string>}>}
 */
KB.nastavMilniky = async (zmeny, volby) => {
    if (authReady) await authReady;
    requireDb();
    const zverejnit = !!(volby && volby.zverejnit);
    const seznam = (Array.isArray(zmeny) ? zmeny : []).filter(z => z && z.id);
    const ted = Date.now();
    const razitko = { updatedMs: ted, updatedBy: window.KB_USER || "" };
    const puvodni = {};
    await Promise.all(seznam.filter(z => typeof z.termin === "string").map(async (z) => {
        const snap = await getDoc(milnikTerminDoc(z.id));
        const d = snap.exists() ? (snap.data() || {}) : {};
        puvodni[z.id] = String(d.terminPuvodni || d.termin || z.termin || "").slice(0, 10);
    }));
    let zapsano = 0;
    // milník = až dva zápisy, dávka unese 500
    for (let i = 0; i < seznam.length; i += 200) {
        const davka = writeBatch(db);
        seznam.slice(i, i + 200).forEach(z => {
            const m = (KB.milniky || []).find(x => x.id === z.id) || {};
            const termin = Object.assign({}, razitko);
            if (typeof z.termin === "string") {
                termin.termin = z.termin.slice(0, 10);
                termin.terminPuvodni = puvodni[z.id];
            }
            if (zverejnit) {
                termin.kdoVidiTermin = (m.owners || []).slice();
                davka.update(milnikSeznamDoc(z.id), Object.assign({
                    zverejneno: true, zverejnenoMs: ted, zverejnil: window.KB_USER || ""
                }, razitko));
            }
            davka.set(milnikTerminDoc(z.id), termin, { merge: true });
            zapsano += 1;
        });
        await davka.commit();
    }
    if (zapsano) {
        KB.zapisAktivitu("milnik", (zverejnit ? "zveřejnil " : "změnil termín – ") +
            zapsano + (zapsano === 1 ? " milník" : (zapsano < 5 ? " milníky" : " milníků")));
    }
    return { zapsano: zapsano, puvodni: puvodni };
};

KB.smazMilnik = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(milnikSeznamDoc(id));
    await deleteDoc(milnikTerminDoc(id)).catch(() => { /* termín nemusel vzniknout */ });
};

/** Odškrtnutí „splněno" – svůj milník si odškrtne i řadový člen. */
KB.ulozSplneniMilniku = async (id, patch) => {
    if (authReady) await authReady;
    requireDb();
    const m = (KB.milniky || []).find(x => x.id === id);
    /* „Vrátit mezi rozdělané" shodí i „připraveno k odevzdání" (Michal 12. 11. 2026);
       kdo chce stav zachovat (Zpět na stránce), pošle `pripraveno` sám. */
    if (patch && patch.hotovo === false && m && m.hotovo === true && m.pripraveno === true &&
        !("pripraveno" in patch)) {
        patch = Object.assign({}, patch, { pripraveno: false, pripravenoKdo: "", pripravenoMs: 0 });
    }
    await updateDoc(milnikSeznamDoc(id), Object.assign({}, patch, {
        updatedMs: Date.now(), updatedBy: window.KB_USER || ""
    }));
    /* Milník potvrzený manažerem (potvrzení odškrtnutí od kolegy i manažerovo
       vlastní odškrtnutí, které platí rovnou) odškrtne i úkol, který z něj
       vznikl přes „Udělat úkoly z milníků" (`milnikId`). `potvrzeno: true`
       pravidla pustí jen manažerovi. Chyba úkolu nesmí shodit milník. */
    const splneny = patch && patch.hotovo !== false && (patch.hotovo === true || !!(m && m.hotovo));
    if (patch && patch.potvrzeno === true && splneny && jsemManazer()) {
        await KB.dokonciUkolyMilniku(id)
            .catch(err => console.warn("Úkol z milníku se neodškrtl:", err));
    }
    /* Odškrtnutí, které čeká na potvrzení (zpracovatel, neurčený manažer),
       ohlásí hned push těm, kdo milníky potvrzují (Michal 3. 11. 2026).
       Odškrtnutí od potvrzovatele platí rovnou (potvrzeno: true) – to ne;
       stejně tak milník, který už na potvrzení čekal. */
    if (patch && patch.hotovo === true && patch.potvrzeno === false &&
        !(m && m.hotovo === true && m.potvrzeno === false)) {
        KB.ohlasPotvrzeni({ udalost: "ceka", druh: "milniky", id: id, uid: KB.currentUid() });
    }
    /* Hotový milník má mít hotové úkoly (Michal, Iris 3. 11. 2026): odevzdání
       založí zpracovatelům Quick TO-DO „aktualizuj TO-DO u úkolů…“. Znovu při
       potvrzení manažerem – zaměstnanec párování nepřečte (je v private), takže
       u něj vzniká jen z návrhu; co už má nesplněné, se nezdvojí. Vrácení
       (i „Zpět“ hned po odškrtnutí) uklidí ty, které jsem k milníku založil já.
       Nic z toho nesmí shodit uložení milníku. */
    if (m && patch && patch.hotovo !== false) {
        const odevzdano = patch.hotovo === true && m.hotovo !== true;
        const potvrzeno = patch.potvrzeno === true && m.hotovo === true && m.potvrzeno === false;
        if (odevzdano || potvrzeno) {
            const beh = KB.pripomenTodoMilniku(Object.assign({}, m, patch, { id: id }))
                .catch(err => { console.warn("Quick TO-DO k milníku se nezaložil:", err); return null; });
            milnikTodoBezi.set(id, beh);
        }
    } else if (m && patch && patch.hotovo === false && m.hotovo === true) {
        await uklidTodoMilniku(id).catch(err => console.warn("Quick TO-DO k vrácenému milníku zůstal:", err));
    }
};

/**
 * Úkoly navázané na milník (`milnikId`) označí hotové a rovnou potvrzené –
 * potvrdil je manažer tím, že potvrdil milník. TO-DO jdou na 100 % stejně
 * jako u „Označit hotové". Hledá se dotazem do databáze, ne v `KB.ukoly`:
 * stránka nemusí mít načtené úkoly všech. Jen manažer.
 * @returns {Promise<number>} kolik úkolů se odškrtlo
 */
KB.dokonciUkolyMilniku = async (milnikId) => {
    if (authReady) await authReady;
    requireDb();
    if (!milnikId || !jsemManazer()) return 0;
    const snap = await getDocs(query(ukolyCol(), where("milnikId", "==", milnikId)));
    const kdo = window.KB_USER || "";
    let hotovo = 0;
    for (const d of snap.docs) {
        const u = d.data() || {};
        if (u.stav === "hotovo" && u.potvrzeno === true) continue;
        const ted = Date.now();
        await setDoc(ukolDoc(d.id), {
            todo: (Array.isArray(u.todo) ? u.todo : []).map(t =>
                (t && t.vypnuto !== true && (Number(t.pct) || 0) !== 100)
                    ? Object.assign({}, t, { pct: 100, by: kdo, ms: ted }) : t),
            stav: "hotovo",
            potvrzeno: true, potvrdil: kdo, potvrzenoMs: ted,
            updatedMs: ted, updatedBy: kdo
        }, { merge: true });
        KB.zapisAktivitu("ukol", "odškrtl úkol " + (u.nazev || d.id) + " – milník je potvrzený");
        hotovo++;
    }
    return hotovo;
};

/** Manažer potvrzuje milník, který si přiřazený člověk odškrtl sám. */
KB.potvrdMilnik = async (id) => {
    const m = (KB.milniky || []).find(x => x.id === id);
    await KB.ulozSplneniMilniku(id, {
        potvrzeno: true,
        potvrdil: window.KB_USER || "",
        potvrzenoMs: Date.now()
    });
    KB.zapisAktivitu("milnik", "potvrdil splněný milník" + (m && m.cinnost ? " " + m.cinnost : ""));
    // push tomu, kdo milník odškrtl (Michal 3. 11. 2026)
    KB.ohlasPotvrzeni({ udalost: "potvrzeno", druh: "milniky", id: id, uid: zadatelMilniku(m) });
};

/** Kdo milník odškrtl (žadatel potvrzení): `hotovoKdo` je jméno, uid se dohledá
    v seznamu lidí; jinak jediný zpracovatel. "" = nevíme. */
function zadatelMilniku(m) {
    if (!m) return "";
    const uid = uidPodleJmena(m.hotovoKdo);
    if (uid) return uid;
    const lide = (Array.isArray(m.owners) ? m.owners : (Array.isArray(m.zpracovatele) ? m.zpracovatele : []))
        .filter(Boolean);
    return lide.length === 1 ? lide[0] : "";
}

/**
 * Odmítnutí splněného milníku (Michal 3. 11. 2026): vrátí ho mezi rozdělané
 * (splnění i potvrzení pryč, stejně jako „Vrátit" na stránce Milníky)
 * a zapíše `vraceno { kdo, ms, duvod }`. Navázané úkoly zůstanou, jak jsou.
 * Kdo milník odškrtl, a zpracovatelé dostanou oznámení (Quick TO-DO) s důvodem,
 * žadatel navíc push. Zrušit splnění cizího milníku smí jen ten, kdo milníky
 * potvrzuje (firestore.rules, milnikRusi).
 */
KB.vratMilnik = async (id, duvod) => {
    if (authReady) await authReady;
    requireDb();
    const text = cistyDuvod(duvod);
    if (!id || !text) throw new Error("Chybí důvod vrácení.");
    let m = (KB.milniky || []).find(x => x.id === id) || null;
    if (!m) {
        const snap = await getDoc(milnikSeznamDoc(id));
        m = snap.exists() ? Object.assign({ id: id }, snap.data()) : null;
    }
    if (!m) throw new Error("Milník už neexistuje.");
    const zadatel = zadatelMilniku(m);
    const kdo = window.KB_USER || "";
    const ted = Date.now();
    await KB.ulozSplneniMilniku(id, {
        hotovo: false, hotovoKdo: "", hotovoMs: 0,
        potvrzeno: false, potvrdil: "", potvrzenoMs: 0,
        // vrácený milník už připravený k odevzdání není (Michal 12. 11. 2026)
        pripraveno: false, pripravenoKdo: "", pripravenoMs: 0,
        vraceno: { kdo: kdo, ms: ted, duvod: text }
    });
    const nazev = [m.cinnost, m.napln].filter(Boolean).join(" – ") || "bez názvu";
    KB.zapisAktivitu("milnik", "vrátil milník " + nazev + " mezi rozdělané – " + text);
    const ja = KB.currentUid();
    const komu = [zadatel].concat(Array.isArray(m.owners) ? m.owners : (m.zpracovatele || []))
        .filter((u, i, a) => u && u !== ja && a.indexOf(u) === i);
    if (komu.length) {
        await KB.saveQuickTodo(KB.newQuickId(), {
            text: "Milník „" + nazev + "“ nebyl potvrzen – vrácen mezi rozdělané: " + text,
            proUids: komu, projekt: m.zakazka || m.projekt || "",
            druh: "info", rezim: "kazdy"          // oznámení – bere se na vědomí
        }).catch(err => console.warn("Oznámení o vrácení milníku neodešlo:", err));
    }
    KB.ohlasPotvrzeni({ udalost: "zamitnuto", druh: "milniky", id: id, uid: zadatel });
};

/**
 * „Připraveno k odevzdání" – stav mezi rozdělaným a Splněno (Michal 12. 11. 2026).
 * Smí zpracovatel zveřejněného milníku i manažer. Pravidla pustí členovi jen
 * výslovné `potvrzeno: false` (stejně jako u splnění), proto ho pošle, když
 * dokument pole nemá nebo má jiné.
 */
KB.oznacPripraveno = async (id, ano) => {
    if (authReady) await authReady;
    requireDb();
    const m = (KB.milniky || []).find(x => x.id === id);
    const kdo = window.KB_USER || "";
    const ted = Date.now();
    const zapis = {
        pripraveno: !!ano, pripravenoKdo: ano ? kdo : "", pripravenoMs: ano ? ted : 0,
        updatedMs: ted, updatedBy: kdo
    };
    if (!jsemManazer() && !(m && m.potvrzeno === false)) zapis.potvrzeno = false;
    await updateDoc(milnikSeznamDoc(id), zapis);
    const nazev = m ? [m.cinnost, m.napln].filter(Boolean).join(" – ") : "";
    KB.zapisAktivitu("milnik", (ano ? "označil milník jako připravený k odevzdání"
        : "zrušil u milníku „připraveno k odevzdání“") + (nazev ? " " + nazev : ""));
    if (!ano) return;                       // zrušení nikomu nic neposílá
    /* Upozornění (Michal 12. 11. 2026): komu, určuje Nastavení → Potvrzování,
       řádek „Připraveno k odevzdání" (druhy.pripraveno.lide). Prázdné =
       hlavní správce + kdo potvrzuje milníky. Odkaz na milník Quick TO-DO
       neumí (odkazy jen projekt/úkol), proto je cesta v textu. */
    const ja = KB.currentUid();
    const p = KB.potvrzovani && KB.potvrzovani.druhy;
    const urceni = p && p.pripraveno ? p.pripraveno.lide : [];
    const aktivni = (KB.users || []).filter(u => u.active !== false);
    const komu = (urceni.length ? urceni
        : aktivni.filter(u => u.role === "hlavni-spravce").map(u => u.id)
            .concat(p && p.milniky ? p.milniky.lide : []))
        .filter((uid, i, a) => uid && uid !== ja && a.indexOf(uid) === i && aktivni.some(u => u.id === uid));
    if (!komu.length) return;
    const projekt = m ? (m.zakazka || m.projekt || "") : "";
    await KB.saveQuickTodo(KB.newQuickId(), {
        text: "Milník " + (nazev || "bez názvu") + (projekt ? " (" + projekt + ")" : "") +
            " je připravený k odevzdání: " + (kdo || "?") + " · Milníky" + (projekt ? " → " + projekt : ""),
        proUids: komu, projekt: projekt,
        druh: "info", rezim: "kazdy"          // oznámení – bere se na vědomí
    }).catch(err => console.warn("Upozornění na připravený milník neodešlo:", err));
    KB.ohlasPotvrzeni({ udalost: "pripraveno", druh: "milniky", id: id, uid: ja });   // push hned
};

/**
 * Hromadné nahrání harmonogramu. Píše po dávkách, protože jedna dávka
 * Firestore unese 500 zápisů a milník jsou zápisy dva.
 * @returns {Promise<number>} kolik milníků se uložilo
 */
KB.importMilniky = async (polozky) => {
    if (authReady) await authReady;
    requireDb();
    const seznam = Array.isArray(polozky) ? polozky : [];
    let hotovo = 0;
    for (let i = 0; i < seznam.length; i += 200) {
        const davka = writeBatch(db);
        seznam.slice(i, i + 200).forEach(p => {
            const id = p.id || KB.newMilnikId();
            const casti = milnikDoDvou(Object.assign({}, p, {
                owners: p.zpracovatele || p.owners || [],
                hotovo: p.stav === "hotovo",
                datum: p.termin || p.datum || ""
            }), null, seznam);
            davka.set(milnikSeznamDoc(id), casti.seznam, { merge: true });
            davka.set(milnikTerminDoc(id), casti.termin, { merge: true });
            hotovo++;
        });
        await davka.commit();
    }
    KB.zapisAktivitu("milnik", "nahrál harmonogram – " + hotovo + " milníků");
    return hotovo;
};

/* ------------------------------------------ párování milníků s úkoly ----
   Které úkoly (a tím výkazy) patří k milníku. Stroj to navrhne sám
   (V.parovaniMilniku ve vykazy.js – technologie, budova a patro z náplně),
   jenže náplň je volný text ze smlouvy, takže je to jen návrh. Co manažer
   na stránce Vyhodnocení milníků odsouhlasí, uloží se sem a od té doby
   platí to, ne návrh (Michal 29. 10. 2026). Dokument má stejné {id} jako
   milník; smazaný dokument = zase jen návrh.

     private/milniky/parovani/{milnikId} = { projektId, ukoly: [ukolId…],
       zpusob, navrh: [ukolId…] (co navrhl stroj v době potvrzení),
       polozky?: { ukolId: [todoId…] } (od 3. 11. 2026 – milník bere jen
       tyto položky TO-DO úkolu; úkol bez klíče = celý úkol, pole chybí =
       všechny úkoly celé), potvrdil, potvrzenoMs, updatedMs, updatedBy }

   Pravidla: spadá pod záchytné `private/{kolekce}/{document=**}` – čte
   i píše jen správce; vedle výkazů a peněz tu nikdo jiný nemá co dělat.
   Tvar pravidla nehlídají, `polozky` tedy nic nemění.
   Na `ukol.milnikId` ani na dotažení úkolů po potvrzení milníku
   (KB.dokonciUkolyMilniku, zatím jen VZT) se tu nesahá. */

const parovaniCol = () => collection(db, "artifacts", APP_ID, "private", "milniky", "parovani");
const parovaniDoc = (id) => doc(db, "artifacts", APP_ID, "private", "milniky", "parovani", id);

KB.parovaniMilniku = {};        // milnikId → potvrzené párování (jen manažer)
KB.parovaniPrislo = false;      // dorazil už první snímek? (do té doby stránka neví, co je potvrzené)
let parovaniOdber = null;

/** Živý odběr potvrzených párování – jen manažer. `cb(mapa)` po každé změně (nepovinné). */
KB.watchParovaniMilniku = async (cb) => {
    if (typeof cb === "function") {
        KB.on("milniky-parovani", (e) => cb(e.detail));
        if (KB.parovaniPrislo) cb(KB.parovaniMilniku);
    }
    const spust = async () => {
        if (parovaniOdber) return;
        if (authReady) await authReady;
        if (!db || !auth || !auth.currentUser || parovaniOdber) return;
        // role se pozná až ze seznamu lidí – kdo se zeptá dřív, počká
        if (pockejNaRoli(spust)) return;
        if (!jsemManazer()) return;
        parovaniOdber = onSnapshot(parovaniCol(), (snap) => {
            KB.parovaniMilniku = {};
            snap.forEach(d => { KB.parovaniMilniku[d.id] = d.data(); });
            KB.parovaniPrislo = true;
            emit("milniky-parovani", KB.parovaniMilniku);
        }, (err) => console.error("Chyba čtení párování milníků:", err));
    };
    await spust();
};

/** Krátký popis milníku do historie aktivit. */
const popisMilniku = (id) => {
    const m = (KB.milniky || []).find(x => x.id === id);
    return m ? [m.cinnost, String(m.napln || "").slice(0, 60)].filter(Boolean).join(" – ") : id;
};

/**
 * Potvrdí (uloží) párování milníku s úkoly. Dokument se zapisuje celý
 * (bez merge): `polozky` je mapa a merge by klíč úkolu, který se vrátil
 * na „celý úkol“, nechal ležet. `data.polozky` = { ukolId: [todoId] } jen
 * u úkolů z `ukoly`; prázdný výběr se neukládá. `volby.bezAktivity` =
 * hromadné potvrzení si zapíše jeden souhrnný řádek samo.
 */
KB.ulozParovaniMilniku = async (milnikId, data, volby) => {
    if (authReady) await authReady;
    requireDb();
    if (!milnikId) return;
    const d = data || {};
    const idcka = (pole, max) => (Array.isArray(pole) ? pole : []).map(String)
        .filter((x, i, a) => x && a.indexOf(x) === i).slice(0, max || 300).map(x => x.slice(0, 120));
    const ted = Date.now();
    const kdo = window.KB_USER || "";
    const ukoly = idcka(d.ukoly);
    const zapis = {
        projektId: String(d.projektId || "").slice(0, 80),
        ukoly: ukoly,
        zpusob: String(d.zpusob || "rucne").slice(0, 20),
        navrh: idcka(d.navrh),
        potvrdil: String(d.potvrdil || kdo).slice(0, 80),
        potvrzenoMs: Number(d.potvrzenoMs) || ted,
        updatedMs: ted,
        updatedBy: kdo
    };
    const polozky = {};
    if (d.polozky && typeof d.polozky === "object") {
        ukoly.forEach(id => {
            const p = idcka(d.polozky[id], 200);
            if (Array.isArray(d.polozky[id]) && p.length) polozky[id] = p;
        });
    }
    if (Object.keys(polozky).length) zapis.polozky = polozky;
    await setDoc(parovaniDoc(milnikId), zapis);
    if (!(volby && volby.bezAktivity)) {
        KB.zapisAktivitu("milnik", "potvrdil párování milníku " + popisMilniku(milnikId) +
            " (" + ukoly.length + (ukoly.length === 1 ? " úkol)" : (ukoly.length > 1 && ukoly.length < 5 ? " úkoly)" : " úkolů)")));
    }
};

/** Zruší potvrzení – milník se zase páruje podle návrhu. */
KB.smazParovaniMilniku = async (milnikId, volby) => {
    if (authReady) await authReady;
    requireDb();
    if (!milnikId) return;
    await deleteDoc(parovaniDoc(milnikId));
    if (!(volby && volby.bezAktivity)) {
        KB.zapisAktivitu("milnik", "zrušil potvrzení párování milníku " + popisMilniku(milnikId));
    }
};

/* ------------------------------- Quick TO-DO k odevzdanému milníku ----
   Hotový milník má mít hotové úkoly (Michal, Iris 3. 11. 2026). Po
   odevzdání milníku dostane každý jeho zpracovatel (a přiřazení lidé
   nehotových úkolů) JEDNO Quick TO-DO „Milník … je odevzdaný: aktualizuj
   TO-DO u úkolů …“ – text a adresáty skládá V.milnikTodoPlan (vykazy.js).
   Vzkaz má pevné id `qt_mt_<milník>_<uid>`, jeden na milník a člověka,
   takže se nezdvojí ani mezi lidmi, kteří si vzkazy navzájem nevidí:
     vidím ho a je nesplněný → nic,
     vidím ho a je splněný   → otevře se znovu (nové odevzdání po vrácení),
     nevidím ho              → založí se; patří-li cizímu autorovi a jinému
                               adresátovi, databáze zápis odmítne (měnit smí
                               jen autor a adresát) = ten člověk ho už má.
   Volá se z KB.ulozSplneniMilniku (stránka Milníky i nabídka na nástěnce)
   a z tlačítka „Připomenout TO-DO u hotových milníků“ (Vyhodnocení milníků). */

const milnikTodoId = (milnikId, uid) => "qt_mt_" + String(milnikId) + "_" + String(uid);
const milnikTodoBezi = new Map();      // milnikId → běžící založení („Zpět“ na něj počká)
const quickHotovoPro = (q, uid) => q.rezim === "kazdy"
    ? (Array.isArray(q.hotoviUids) ? q.hotoviUids : []).indexOf(uid) !== -1 : q.hotovo === true;

/** Má člověk k milníku nesplněné Quick TO-DO, které vidím? (náhled „Připomenout…“; cizí nevidím) */
KB.maMilnikTodo = (milnikId, uid) => {
    const q = (KB.quicktodo || []).find(x => x.id === milnikTodoId(milnikId, uid));
    return !!q && !quickHotovoPro(q, String(uid));
};

/**
 * Plán Quick TO-DO k milníku: spárované úkoly (potvrzené párování, když ho
 * smím číst – zaměstnanec ne, ten vezme návrh z náplně), z nich nehotové
 * a vzkazy po lidech.
 *   m  milník ve tvaru KB.milniky ({ id, cinnost, napln, zakazka, owners, hotovo, potvrzeno })
 * @returns {Promise<{ nehotovych: number, vzkazy: [{ milnikId, projekt, uid, text, odkazy, ukoly }] }>}
 */
KB.planTodoMilniku = async (m) => {
    const V = window.KBVYK;
    if (!m || !m.id || !V || !V.parovaniMilniku || !V.milnikTodoPlan) return { nehotovych: 0, vzkazy: [] };
    let potvrzene = KB.parovaniPrislo ? (KB.parovaniMilniku[m.id] || null) : undefined;
    if (potvrzene === undefined) {
        potvrzene = null;
        if (jsemManazer()) {
            try {
                const s = await getDoc(parovaniDoc(m.id));
                potvrzene = s.exists() ? s.data() : null;
            } catch (err) { potvrzene = null; }
        }
    }
    const nazev = String(m.zakazka || "").replace(/\s+/g, " ").trim();
    const p = (KB.projektyDocs || []).find(x => String(x.nazev || "").replace(/\s+/g, " ").trim() === nazev) ||
        { id: "", nazev: nazev };
    const ukoly = V.ukolyZakazky(p.nazev || nazev, p.id, KB.ukoly || []).slice();
    // potvrzený úkol, který stránka načtený nemá, se dočte (úkoly čte každý člen)
    const chybi = potvrzene && Array.isArray(potvrzene.ukoly)
        ? potvrzene.ukoly.map(String).filter(id => !ukoly.some(u => u.id === id)) : [];
    for (const id of chybi.slice(0, 50)) {
        const zPameti = (KB.ukoly || []).find(u => u.id === id);
        if (zPameti) { ukoly.push(zPameti); continue; }
        try {
            const s = await getDoc(ukolDoc(id));
            if (s.exists()) ukoly.push(Object.assign({}, s.data(), { id: id }));
        } catch (err) { /* smazaný nebo nečitelný úkol se vynechá */ }
    }
    const par = V.parovaniMilniku(m, ukoly, V.osyProjektu(p), { potvrzene: potvrzene });
    /* Potvrzený milník manažer dotáhne i s úkolem, který z něj vznikl
       (KB.dokonciUkolyMilniku, VZT) – o ten se vzkaz neposílá. */
    const dotazene = m.hotovo === true && m.potvrzeno === true && jsemManazer();
    const plan = V.milnikTodoPlan(m, par.ukoly.filter(u => !(dotazene && u.milnikId === m.id)), par.polozky);
    // vyřazený účet by vzkaz nikdy neviděl
    const naWebu = (uid) => !(KB.users || []).length ||
        (KB.users || []).some(u => u.id === uid && u.active !== false);
    return {
        nehotovych: plan.nehotove.length,
        vzkazy: plan.vzkazy.filter(v => naWebu(v.uid))
            .map(v => Object.assign({ milnikId: m.id, projekt: nazev }, v))
    };
};

/**
 * Založí Quick TO-DO z plánu (KB.planTodoMilniku nebo stránka Vyhodnocení
 * milníků) – viz výklad nad milnikTodoId. Do historie aktivit jeden řádek.
 *   vzkazy  [{ milnikId, uid, text, odkazy, projekt }]
 * @returns {Promise<{ zalozeno: string[], obnoveno: string[], preskoceno: number, chyb: number }>}
 */
KB.zalozTodoMilniku = async (vzkazy) => {
    if (authReady) await authReady;
    requireDb();
    const out = { zalozeno: [], obnoveno: [], preskoceno: 0, chyb: 0 };
    const milniky = new Set();
    for (const v of (Array.isArray(vzkazy) ? vzkazy : [])) {
        if (!v || !v.milnikId || !v.uid || !v.text) continue;
        const qid = milnikTodoId(v.milnikId, v.uid);
        const data = {
            text: String(v.text), proUids: [String(v.uid)], projekt: v.projekt || "",
            druh: "milnikTodo", milnikId: v.milnikId, odkazy: v.odkazy || [],
            rezim: "", hotoviUids: [], hotovo: false
        };
        let q = (KB.quicktodo || []).find(x => x.id === qid) || null;
        if (!q) {
            try {
                const s = await getDoc(quickDoc(qid));
                q = s.exists() ? Object.assign({}, s.data(), { id: qid }) : null;
            } catch (err) { q = null; }      // nevidím ho: neexistuje, nebo je cizí
        }
        try {
            if (q && !quickHotovoPro(q, String(v.uid))) { out.preskoceno++; continue; }
            if (q) {
                // splněný z dřívějška – autor a adresáti se měnit nesmí (pravidla)
                await KB.saveQuickTodo(qid, Object.assign(data, {
                    odKoho: q.odKoho, odKohoJmeno: q.odKohoJmeno || "",
                    proUids: Array.isArray(q.proUids) && q.proUids.length ? q.proUids : data.proUids
                }), { bezAktivity: true });
                out.obnoveno.push(qid);
            } else {
                await KB.saveQuickTodo(qid, data, { bezAktivity: true });
                out.zalozeno.push(qid);
            }
            milniky.add(v.milnikId);
        } catch (err) {
            if (err && err.code === "permission-denied") out.preskoceno++;     // má ho už od kolegy
            else { out.chyb++; console.warn("Quick TO-DO k milníku se nezaložil:", err); }
        }
    }
    const n = out.zalozeno.length + out.obnoveno.length;
    if (n) {
        KB.zapisAktivitu("quicktodo", "zadal quick to-do „aktualizuj TO-DO“ " + (milniky.size === 1
            ? "k odevzdanému milníku " + popisMilniku(Array.from(milniky)[0])
            : "k " + milniky.size + " odevzdaným milníkům") + " (" + n + (n === 1 ? " vzkaz)" : n < 5 ? " vzkazy)" : " vzkazů)"));
    }
    return out;
};

/** Po odevzdání milníku: plán + založení (KB.ulozSplneniMilniku). */
KB.pripomenTodoMilniku = async (m) => {
    const plan = await KB.planTodoMilniku(m);
    return plan.vzkazy.length ? KB.zalozTodoMilniku(plan.vzkazy)
        : { zalozeno: [], obnoveno: [], preskoceno: 0, chyb: 0 };
};

/**
 * Milník se vrátil mezi rozdělané (Zpět hned po odškrtnutí, Vrátit,
 * Odmítnout): nesplněné Quick TO-DO „aktualizuj TO-DO“, které jsem k němu
 * založil já, zmizí – milník už odevzdaný není. Cizí se nesahá.
 */
async function uklidTodoMilniku(milnikId) {
    const beh = milnikTodoBezi.get(milnikId);
    milnikTodoBezi.delete(milnikId);
    const vysledek = beh ? await beh : null;
    const ja = KB.currentUid();
    const ids = new Set(vysledek ? vysledek.zalozeno : []);
    (KB.quicktodo || []).forEach(q => {
        if (q && q.druh === "milnikTodo" && q.milnikId === milnikId && q.odKoho === ja &&
            !quickHotovoPro(q, (q.proUids || [])[0])) ids.add(q.id);
    });
    for (const qid of ids) {
        await KB.deleteQuickTodo(qid).catch(err => console.warn("Quick TO-DO k milníku se nesmazal:", err));
    }
}

/* ------------------------------------------------------------- uživatelé --
   Seznam lidí, kteří mají na web přístup, a jejich role. Spravuje ho hlavní
   správce. Přihlašuje Firebase Auth (e-mail + heslo); hesla v databázi
   nejsou ani jako otisk (uklizeno 1. 9. 2026). Roli čtou pravidla databáze
   z users/{uid}, takže to, co tu stojí, je skutečná hranice přístupu. */

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
    /* Výkaz po půlhodinách: člověk místo příchodu a odchodu vybírá rovnou
       počet hodin (kolega, Michal 14. 9. 2026). */
    if (data.vykazPulhodiny !== undefined) payload.vykazPulhodiny = data.vykazPulhodiny === true;
    /* Momentálně nepracuje: účet zůstává živý (člověk se přihlásí a vidí
       svoje), ale v nabídkách lidí padá dolů a hlídka výkazů ho nechá být
       (Michal 16. 9. 2026). Pozastavení účtu je něco jiného – to je
       `active: false` a to se s ním ani nepřihlásí. */
    if (data.nepracuje !== undefined) payload.nepracuje = data.nepracuje === true;
    // komu se nemá připomínat nezapsaný výkaz (majitelé, brigádníci…)
    if (data.bezHlidky !== undefined) payload.bezHlidky = data.bezHlidky === true;
    /* Doba dohody u DPP a DPČ (Michal 3. 11. 2026) – nepovinné ISO datum,
       prázdné = neuvedeno. Jen když ho volající předá. */
    ["dohodaOd", "dohodaDo"].forEach(k => {
        if (data[k] !== undefined) payload[k] = /^\d{4}-\d{2}-\d{2}$/.test(String(data[k] || "")) ? String(data[k]) : "";
    });
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

/* Odhlášení tlačítkem uklidí i kopii dat v prohlížeči. Firestore drží
   načtené dokumenty v IndexedDB (výkazy, u manažera i faktury a sazby)
   a na sdíleném počítači by je po odhlášení našel další člověk v nástrojích
   prohlížeče (rešerše 19. 10. 2026). Smazat jde jen zavřenou databázi,
   takže stránka se potom musí načíst znovu – to dělá UI.logout. Když je
   web otevřený ještě v jiné záložce, drží kopii ta a smazání se nepovede;
   proběhne při odhlášení z poslední záložky. */
KB.odhlasACisti = async () => {
    await signOut(auth).catch(() => {});
    if (!db) return;
    try {
        await terminate(db);
        await clearIndexedDbPersistence(db);
    } catch (err) {
        console.warn("Kopie dat v prohlížeči se nesmazala (web je otevřený i v jiné záložce?):", err);
    }
};
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
   Ruční export celé databáze do jednoho JSON souboru, včetně obrázků
   u návodů a obsahu tabulí. Skutečné zálohy (PITR a plánované zálohy) se
   zapínají v konzoli Firebase – k 19. 10. 2026 jsou vypnuté.
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

/* ------------------------------------------------------------ vybavení ----
   Přístroje k zapůjčení (skenery, dálkoměry, notebooky…) a jejich
   rezervace. Panel je v pásu vedle Správy aut (assets/js/vybaveni.js).

     public/data/meta/vybaveni              seznam přístrojů { seznam: [{ id,
                                            nazev, druh, poznamka, aktivni }] }
                                            – zapisuje jen manažer (pravidlo
                                            pro `meta`), v kódu žádný není
     public/data/vybaveni/{id}              rezervace { pristrojId, pristroj,
                                            od, do, uid, jmeno, projektId,
                                            projekt, poznamka, zapsalUid, ms }
     public/data/vybaveni-dny/{přístroj_den}  zámek dne { pristrojId, den,
                                            rezId, uid, jmeno }

   Rezervace vidí celá firma (jako auta), ať se lidé nedomlouvají přes hlavu
   toho druhého.

   Proč zámky po dnech: „žádná jiná rezervace se nepřekrývá" se ve Firestore
   nedá zeptat – pravidla ani transakce neumí dotaz. Umí ale hlídat jeden
   dokument: zámek má id přístroj + den, takže druhá rezervace na týž den by
   musela založit dokument, který už existuje. Rezervace se proto ukládá
   TRANSAKCÍ spolu se všemi svými zámky. Transakce zámky napřed přečte (a
   řekne, kdo přístroj ten den má); kdyby je mezi čtením a zápisem založil
   někdo jiný, Firestore transakci zopakuje a kolizi najde. Pravidla navíc
   nedovolí zámek přepsat – ani z konzole, ani manažerovi.               */

const vybaveniCol = () => collection(db, "artifacts", APP_ID, "public", "data", "vybaveni");
const vybaveniDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "vybaveni", id);
const vybaveniDenDoc = (pristrojId, den) =>
    doc(db, "artifacts", APP_ID, "public", "data", "vybaveni-dny", pristrojId + "_" + den);

/* Nejdelší rezervace ve dnech. Co den, to zámek, a transakce je čte
   všechny – na delší zápůjčku se rezervace rozdělí. */
const VYBAVENI_MAX_DNU = 92;
KB.VYBAVENI_MAX_DNU = VYBAVENI_MAX_DNU;

const ISO_DEN = /^\d{4}-\d{2}-\d{2}$/;
// id přístroje je kus cesty k zámku – nesmí v něm být lomítko ani nic divného
const ID_PRISTROJE = /^[A-Za-z0-9-]{1,40}$/;

/** Dny od–do včetně jako ISO řetězce. Počítá se v UTC, ať změna času nic
    neposune. Neplatné datum nebo obrácený rozsah = prázdné pole; delší
    rozsah se utne o den za limitem (volající pozná, že je moc dlouhý). */
function dnyRozsahu(od, doKdy) {
    const dny = [];
    if (!ISO_DEN.test(od || "") || !ISO_DEN.test(doKdy || "") || doKdy < od) return dny;
    const d = new Date(od + "T00:00:00Z");
    const konec = new Date(doKdy + "T00:00:00Z");
    if (isNaN(d) || isNaN(konec) || d.toISOString().slice(0, 10) !== od ||
        konec.toISOString().slice(0, 10) !== doKdy) return dny;
    while (d <= konec && dny.length <= VYBAVENI_MAX_DNU) {
        dny.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return dny;
}
KB.dnyRozsahu = dnyRozsahu;

function chybaVybaveni(kod, zprava, navic) {
    const e = new Error(zprava);
    e.kod = kod;
    return Object.assign(e, navic || {});
}

let vybaveniOdbery = [];
function zrusVybaveni() {
    vybaveniOdbery.forEach(stop => { try { stop(); } catch (e) {} });
    vybaveniOdbery = [];
    KB.vybaveni = []; KB.vybaveniRezervace = [];
    KB.vybaveniPrislo = false;
}

/** Odběr seznamu přístrojů a rezervací – řekne si o něj až otevřený panel. */
KB.watchVybaveni = async () => {
    if (vybaveniOdbery.length) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || vybaveniOdbery.length) return;
    const t = new Date();
    const dnes = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") +
        "-" + String(t.getDate()).padStart(2, "0");
    vybaveniOdbery.push(onSnapshot(metaDoc("vybaveni"), (snap) => {
        const data = snap.exists() ? snap.data() : {};
        KB.vybaveni = (Array.isArray(data.seznam) ? data.seznam : [])
            .filter(p => p && typeof p.id === "string" && ID_PRISTROJE.test(p.id))
            .map(p => ({
                id: p.id,
                nazev: String(p.nazev || ""),
                druh: String(p.druh || ""),
                poznamka: String(p.poznamka || ""),
                aktivni: p.aktivni !== false
            }));
        KB.vybaveniPrislo = true;
        emit("vybaveni", KB.vybaveni);
    }, (err) => console.error("Chyba čtení vybavení:", err)));
    /* Jen rezervace, které ještě neskončily. Staré zůstávají v databázi
       jako historie, panel je ale nepotřebuje a každá by se platila. */
    vybaveniOdbery.push(onSnapshot(query(vybaveniCol(), where("do", ">=", dnes)), (snapshot) => {
        KB.vybaveniRezervace = [];
        snapshot.forEach(d => KB.vybaveniRezervace.push({ id: d.id, ...d.data() }));
        KB.vybaveniRezervace.sort((a, b) => String(a.od || "").localeCompare(String(b.od || "")) ||
            (a.ms || 0) - (b.ms || 0));
        emit("vybaveni", KB.vybaveni);
    }, (err) => console.error("Chyba čtení rezervací vybavení:", err)));
};

KB.newPristrojId = () => "pr" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
KB.newVybaveniId = () => "vyb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

/** Přidá nebo upraví přístroj v seznamu (jen manažer – hlídá pravidlo pro
    `meta`). Transakcí: dva manažeři naráz si seznam nepřepíšou. */
KB.ulozPristroj = async (data) => {
    if (authReady) await authReady;
    requireDb();
    const id = data.id || KB.newPristrojId();
    if (!ID_PRISTROJE.test(id)) throw chybaVybaveni("pristroj", "Neplatný přístroj.");
    const polozka = {
        id: id,
        nazev: String(data.nazev || "").trim().slice(0, 80),
        druh: String(data.druh || "").trim().slice(0, 40),
        poznamka: String(data.poznamka || "").trim().slice(0, 200),
        aktivni: data.aktivni !== false
    };
    if (!polozka.nazev) throw chybaVybaveni("nazev", "Přístroj musí mít název.");
    let novy = true;
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(metaDoc("vybaveni"));
        const seznam = snap.exists() && Array.isArray(snap.data().seznam) ? snap.data().seznam.slice() : [];
        const i = seznam.findIndex(p => p && p.id === id);
        novy = i === -1;
        if (novy) seznam.push(polozka); else seznam[i] = polozka;
        tx.set(metaDoc("vybaveni"), { seznam: seznam, ms: Date.now(), updatedBy: window.KB_USER || "" });
    });
    KB.zapisAktivitu("vybaveni", (novy ? "přidal přístroj " : "upravil přístroj ") + polozka.nazev +
        (polozka.aktivni ? "" : " (vyřazený z nabídky)"));
    return id;
};

/** Smaže přístroj ze seznamu. Rezervace se tím nemažou – web proto mazání
    nepustí, dokud má přístroj nějakou budoucí rezervaci. */
KB.smazPristroj = async (id) => {
    if (authReady) await authReady;
    requireDb();
    let nazev = "";
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(metaDoc("vybaveni"));
        const seznam = snap.exists() && Array.isArray(snap.data().seznam) ? snap.data().seznam : [];
        const pryc = seznam.find(p => p && p.id === id);
        nazev = pryc ? String(pryc.nazev || "") : "";
        tx.set(metaDoc("vybaveni"), {
            seznam: seznam.filter(p => !(p && p.id === id)),
            ms: Date.now(), updatedBy: window.KB_USER || ""
        });
    });
    KB.zapisAktivitu("vybaveni", "smazal přístroj " + nazev);
};

/**
 * Uloží rezervaci přístroje – novou (`id` prázdné) i úpravu existující.
 * data: { pristrojId, pristroj, od, do, projektId, projekt, poznamka }.
 * Přístroj se úpravou nemění (na jiný přístroj = zrušit a rezervovat znovu).
 *
 * Když je přístroj v některý den obsazený, vyhodí chybu s `kod: "kolize"`
 * a `kolize: [{ den, jmeno, uid, rezId, pristrojId, sirotek }]` – `sirotek`
 * = zámek, jehož rezervace už neexistuje (smazaná mimo web).
 */
KB.ulozRezervaciVybaveni = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    const od = String(data.od || "");
    const doKdy = String(data.do || data.od || "");
    const dny = dnyRozsahu(od, doKdy);
    if (!dny.length) throw chybaVybaveni("datum", "Zkontroluj datum od a do.");
    if (dny.length > VYBAVENI_MAX_DNU) {
        throw chybaVybaveni("dlouha", "Rezervace může mít nejvýš " + VYBAVENI_MAX_DNU +
            " dní – na delší dobu ji rozděl.");
    }
    const rezId = id || KB.newVybaveniId();
    const ja = auth.currentUser.uid;

    const ulozeno = await runTransaction(db, async (tx) => {
        let stara = null;
        if (id) {
            const s = await tx.get(vybaveniDoc(id));
            if (!s.exists()) throw chybaVybaveni("zmizela", "Rezervace mezitím zmizela – někdo ji zrušil.");
            stara = s.data();
        }
        const pristrojId = stara ? String(stara.pristrojId || "") : String(data.pristrojId || "");
        if (!ID_PRISTROJE.test(pristrojId)) throw chybaVybaveni("pristroj", "Neznámý přístroj.");
        const stareDny = stara ? dnyRozsahu(stara.od, stara.do) : [];
        const ubrat = stareDny.filter(d => dny.indexOf(d) === -1);

        /* Transakce musí nejdřív všechno přečíst a teprve pak zapisovat.
           Čtou se zámky VŠECH dnů nové rezervace (ne jen přidaných) – chybějící
           zámek u vlastní rezervace se tím sám doplní. */
        const zamky = await Promise.all(dny.map(d => tx.get(vybaveniDenDoc(pristrojId, d))));
        const zamkyUbrat = await Promise.all(ubrat.map(d => tx.get(vybaveniDenDoc(pristrojId, d))));

        const kolize = [];
        zamky.forEach((z, i) => {
            if (!z.exists() || z.data().rezId === rezId) return;
            const zd = z.data();
            kolize.push({ den: dny[i], pristrojId: pristrojId, rezId: String(zd.rezId || ""),
                          uid: String(zd.uid || ""), jmeno: String(zd.jmeno || "") });
        });
        if (kolize.length) {
            const rezervace = Array.from(new Set(kolize.map(k => k.rezId).filter(Boolean)));
            const existuje = {};
            const snimky = await Promise.all(rezervace.map(r => tx.get(vybaveniDoc(r))));
            snimky.forEach((s, i) => { existuje[rezervace[i]] = s.exists(); });
            kolize.forEach(k => { k.sirotek = !k.rezId || !existuje[k.rezId]; });
            throw chybaVybaveni("kolize", "Přístroj je v té době rezervovaný.", { kolize: kolize });
        }

        const uid = stara ? String(stara.uid || "") : ja;
        const jmeno = stara ? String(stara.jmeno || "") : (window.KB_USER || "");
        const ted = Date.now();
        zamkyUbrat.forEach((z, i) => {
            if (z.exists() && z.data().rezId === rezId) tx.delete(vybaveniDenDoc(pristrojId, ubrat[i]));
        });
        zamky.forEach((z, i) => {
            // existující zámek je jen vlastní (cizí = kolize výš) – přepsat ho pravidla nedovolí
            if (z.exists()) return;
            tx.set(vybaveniDenDoc(pristrojId, dny[i]), {
                pristrojId: pristrojId, den: dny[i], rezId: rezId, uid: uid, jmeno: jmeno, ms: ted
            });
        });
        const zaznam = {
            pristrojId: pristrojId,
            pristroj: String(data.pristroj || (stara && stara.pristroj) || "").slice(0, 80),
            od: od,
            do: doKdy,
            projektId: String(data.projektId || ""),
            projekt: data.projektId ? String(data.projekt || "").slice(0, 160) : "",
            poznamka: String(data.poznamka || "").trim().slice(0, 200),
            uid: uid,
            jmeno: jmeno,
            zapsalUid: stara ? String(stara.zapsalUid || stara.uid || "") : ja,
            ms: stara ? (Number(stara.ms) || ted) : ted,
            upravenoMs: ted,
            upravil: window.KB_USER || ""
        };
        tx.set(vybaveniDoc(rezId), zaznam);
        return zaznam;
    });

    KB.zapisAktivitu("vybaveni", (id ? "upravil rezervaci " : "rezervoval ") + ulozeno.pristroj +
        " na " + od + (doKdy !== od ? " – " + doKdy : "") +
        (ulozeno.jmeno && ulozeno.jmeno !== window.KB_USER ? " – " + ulozeno.jmeno : ""));
    return rezId;
};

/** Zruší rezervaci i s jejími zámky (jednou transakcí). Smí autor a manažer. */
KB.zrusRezervaciVybaveni = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const rez = await runTransaction(db, async (tx) => {
        const s = await tx.get(vybaveniDoc(id));
        if (!s.exists()) return null;
        const r = s.data();
        const pristrojId = String(r.pristrojId || "");
        const dny = ID_PRISTROJE.test(pristrojId) ? dnyRozsahu(r.od, r.do) : [];
        const zamky = await Promise.all(dny.map(d => tx.get(vybaveniDenDoc(pristrojId, d))));
        zamky.forEach((z, i) => {
            if (z.exists() && z.data().rezId === id) tx.delete(vybaveniDenDoc(pristrojId, dny[i]));
        });
        tx.delete(vybaveniDoc(id));
        return r;
    });
    if (rez) {
        KB.zapisAktivitu("vybaveni", "zrušil rezervaci " + (rez.pristroj || "") + " na " + rez.od +
            (rez.do && rez.do !== rez.od ? " – " + rez.do : "") +
            (rez.jmeno && rez.jmeno !== window.KB_USER ? " – " + rez.jmeno : ""));
    }
    return rez;
};

/** Uvolní osiřelé zámky (rezervace k nim už neexistuje – smazaná mimo web).
    Smí manažer a ten, na koho zámek zní. kolize = pole z chyby „kolize". */
KB.uvolniZamkyVybaveni = async (kolize) => {
    if (authReady) await authReady;
    requireDb();
    for (const k of (kolize || [])) {
        if (!k || !k.sirotek || !ID_PRISTROJE.test(k.pristrojId || "") || !ISO_DEN.test(k.den || "")) continue;
        await deleteDoc(vybaveniDenDoc(k.pristrojId, k.den));
    }
};

/* ------------------------------------------ odbavená upozornění -----------
   Manažer si u upozornění na nástěnce odklikne „V pořádku" (noční směna,
   domluvená výpomoc…). Leží to v `private`, kam vidí jen manažeři – jsou
   to poznámky o cizích výkazech, ne firemní číselník.

   Od 21. 10. 2026 má každý manažer VLASTNÍ dokument pod svým uid:
     private/kontrola/manazeri/{uid}   { klice: [...], kdo, updatedMs }
   Odkliknutí si tak pamatuje ten, kdo ho udělal, a zapisuje se po jednom
   klíči (arrayUnion/arrayRemove). Dřív to byl jeden společný dokument,
   který se ukládal celý – dva manažeři si ho uměli navzájem přepsat.
   Nástěnka ukazuje SJEDNOCENÍ všech: co odklikl jeden, nemusí procházet
   druhý, a u položky je vidět kdo. Starý společný dokument
   `private/kontrola/seznam/vyrizeno` se už jen čte – co v něm je, zůstává
   odbavené, a „Vrátit" z něj klíč umí vyndat. */

const kontrolaStaryDoc = () => doc(db, "artifacts", APP_ID, "private", "kontrola", "seznam", "vyrizeno");
const kontrolaManazeriCol = () => collection(db, "artifacts", APP_ID, "private", "kontrola", "manazeri");
const kontrolaManazerDoc = (uid) => doc(db, "artifacts", APP_ID, "private", "kontrola", "manazeri", uid);

KB.kontrolaOk = {};             // klíč → [kdo ho odklikl]
KB.kontrolaOdlozeno = {};       // klíč → ms návratu; jen MOJE odložení (pole `odlozeno` vlastního dokumentu)
KB.kontrolaOkPrislo = false;
let kontrolaOkOdber = null;
let kontrolaOkDocs = {};        // uid manažera → { klice, kdo }
let kontrolaOkStare = [];       // klíče ze starého společného dokumentu

function slijKontrolaOk() {
    const mapa = {};
    const pridej = (klic, kdo) => {
        const seznam = mapa[klic] || (mapa[klic] = []);
        if (kdo && seznam.indexOf(kdo) === -1) seznam.push(kdo);
    };
    kontrolaOkStare.forEach(k => pridej(String(k), ""));
    Object.keys(kontrolaOkDocs).forEach(uid =>
        kontrolaOkDocs[uid].klice.forEach(k => pridej(String(k), kontrolaOkDocs[uid].kdo)));
    KB.kontrolaOk = mapa;
    KB.kontrolaOkPrislo = true;
    emit("kontrola-ok", mapa);
}

/** Odbavená upozornění všech manažerů – jen manažer (databáze jinak odmítne). */
KB.watchKontrolaOk = async () => {
    if (kontrolaOkOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || kontrolaOkOdber) return;
    if (pockejNaRoli(KB.watchKontrolaOk)) return;
    if (!jsemManazer() || kontrolaOkOdber) return;
    kontrolaOkOdber = onSnapshot(kontrolaManazeriCol(), (snap) => {
        kontrolaOkDocs = {};
        KB.kontrolaOdlozeno = {};
        const ja = KB.currentUid();
        snap.forEach(d => {
            const x = d.data() || {};
            kontrolaOkDocs[d.id] = { klice: Array.isArray(x.klice) ? x.klice : [], kdo: String(x.kdo || "") };
            // odložení je osobní – cizí dokumenty ho nesou taky, ale nečtou se
            if (d.id === ja && x.odlozeno && typeof x.odlozeno === "object") KB.kontrolaOdlozeno = x.odlozeno;
        });
        slijKontrolaOk();
    }, (err) => console.error("Chyba čtení odbavených upozornění:", err));
    try {
        const snap = await getDoc(kontrolaStaryDoc());
        const data = snap.exists() ? snap.data() : {};
        kontrolaOkStare = Array.isArray(data.klice) ? data.klice.map(String) : [];
        slijKontrolaOk();
    } catch (err) { console.warn("Starý seznam odbavených upozornění:", err); }
};

/** „V pořádku" – klíč do vlastního dokumentu přihlášeného manažera. */
KB.oznacKontrolaOk = async (klic) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    if (!uid || !klic) return;
    await setDoc(kontrolaManazerDoc(uid), {
        klice: arrayUnion(String(klic)),
        kdo: window.KB_USER || "",
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
};

/** „Vrátit" – klíč zmizí ze všech seznamů, kde je (i ze starého společného). */
KB.zrusKontrolaOk = async (klic) => {
    if (authReady) await authReady;
    requireDb();
    if (!klic) return;
    const k = String(klic);
    const razitko = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    const kde = Object.keys(kontrolaOkDocs).filter(uid => kontrolaOkDocs[uid].klice.indexOf(k) !== -1);
    /* vlastní dokument vždycky – „Zpět" hned po „V pořádku" nesmí čekat,
       až odběr pošle čerstvý stav */
    const ja = KB.currentUid();
    if (ja && kde.indexOf(ja) === -1) kde.push(ja);
    for (const uid of kde) {
        await setDoc(kontrolaManazerDoc(uid), Object.assign({ klice: arrayRemove(k) }, razitko), { merge: true });
    }
    if (kontrolaOkStare.indexOf(k) !== -1) {
        await setDoc(kontrolaStaryDoc(), Object.assign({ klice: arrayRemove(k) }, razitko), { merge: true });
        kontrolaOkStare = kontrolaOkStare.filter(x => x !== k);       // starý se neposlouchá živě
        slijKontrolaOk();
    }
};

/**
 * „Odložit na zítra / na pondělí" u upozornění (rešerše bod 26) – vedle
 * odkliknutí ve vlastním dokumentu manažera: `odlozeno.{klíč}` = ms návratu,
 * 0 = zrušit. Prošlá odložení se při tom uklidí, ať mapa neroste.
 */
KB.odlozKontrolu = async (klic, doMs) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    if (!uid || !klic) throw new Error("Není co odložit.");
    const ms = Number(doMs) || 0;
    const odlozeno = {};
    Object.keys(KB.kontrolaOdlozeno || {}).forEach(k => {
        if (!(Number(KB.kontrolaOdlozeno[k]) > Date.now())) odlozeno[k] = deleteField();
    });
    odlozeno[String(klic)] = ms > 0 ? ms : deleteField();
    await setDoc(kontrolaManazerDoc(uid), { odlozeno: odlozeno }, { merge: true });
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

/* ------------------------------------------- dopočet částek k výkazům ----
   Zaměstnanec zapisuje jen čas – peníze psát nesmí a pravidla mu to
   nedovolí. Sazbu k jeho zápisu měl „doplnit správce", jenže na to nikdy
   nebyl žádný mechanismus: záznam zůstal za nula korun, v přehledech
   nebyl vidět a do osobního výkazu v Tabulkách šel bez taxy, takže
   sloupec „Odpracováno za" zůstal prázdný (našlo se 2. 9. 2026).

   Tohle to dopočítá z manažerova prohlížeče: chybí-li k záznamu dokument
   s částkou, založí se podle sazby toho člověka; když zaměstnanec zápis
   dodatečně upravil, přepočítá se částka, ale RUČNĚ NASTAVENÁ SAZBA
   zůstává (manažer ji u konkrétního zápisu mohl schválně změnit).
   Absence má sazbu nula schválně – proplácet se nemá.                    */

const DAVKA_CASTEK = 60;      // víc než dost na den; zbytek dojede příště
/* Zápis změněný před méně než dvěma minutami se nechává být: ten, kdo ho
   změnil (formulář manažera, robot, Apps Script), k němu částku právě dopisuje
   a odběr částek ji ještě nemusel dostat – dopočet by ji předběhl a přepsal
   starými čísly (RD Vrbice, 9. 11. 2026: přepsáno vteřinu po ruční opravě). */
const DOPOCET_PRODLEVA_MS = 2 * 60 * 1000;

/** Částku založil automat (dopočet z prohlížeče nebo Apps Script), ne člověk. */
KB.castkaAutomaticka = (c) => {
    const kdo = String((c && c.updatedBy) || "").trim();
    return !kdo || kdo === "dopočet" || kdo === "zápis";
};

KB.doplnCastky = async () => {
    if (!db || !auth || !auth.currentUser) return null;
    if (!KB.sazbyPrisly || vykazyRezim !== "vse") return null;   // jen manažer

    const chybiSazba = new Set();
    const kUlozeni = [];

    for (const z of syroveZaznamy) {
        const c = syroveCastky[z.id];
        /* Placené školení (absencePlacena) je absence, za kterou se platí:
           sazbu dostane jako práce – stejně jako prepocti() ve výkazech
           a sazbaZapisu_ v Apps Scriptu. Bez toho ho dopočet zapsal za nulu
           a ve Výplatách chybělo (3. 11. 2026). */
        const jeAbsence = z.absence === true && z.absencePlacena !== true;
        if (Date.now() - Number(z.updatedMs || 0) < DOPOCET_PRODLEVA_MS) continue;   // čerstvá změna – počká
        /* Před čárou uzávěrky zapíše částku jen hlavní správce (pravidla od 12. 11.
           2026) – jinak by odmítnuté zápisy zabraly dávku a novější by nedošly. */
        if (KB.uzaverkaOd && String(z.datum || "") < KB.uzaverkaOd && mojeRole() !== "hlavni-spravce") continue;
        /* Platí sazba člověka z Nastavení; když má projekt nastavenou
           vlastní sazbu pro toho člověka, vyhrává ta (Michal 2. 9. 2026). */
        const proj = ((KB.rozpocty || {})[z.zakazka] || {}).sazby || {};
        const sazbaZCiselniku = jeAbsence ? 0
            : (Number(proj[z.uid]) || Number(KB.sazby[z.uid]) || 0);

        if (!c) {
            if (!jeAbsence && !sazbaZCiselniku) { chybiSazba.add(z.uid); continue; }
            kUlozeni.push({ z: z, sazba: sazbaZCiselniku });
            continue;
        }
        /* Částku, kterou nastavil člověk (manažer ve formuláři nebo ručně),
           dopočet NIKDY nepřepisuje – je konečná (Michal 9. 11. 2026: „ať to
           nedělá“). Přepočítat smí jen částku, kterou založil sám („dopočet“)
           nebo Apps Script („zápis“), a jen když zaměstnanec zápis potom změnil
           (opravené hodiny, oběd, kilometry). Když ručně nastavená částka
           neodpovídá hodinám, ukáže to Upozornění pro kontrolu (druh „castka“). */
        if (!KB.castkaAutomaticka(c)) continue;
        if (Number(z.updatedMs || 0) > Number(c.updatedMs || 0)) {
            /* Držená sazba zůstává; nula u placeného zápisu (práce, placené
               školení) není historie, ale rozbitý stav – dohledá se znovu
               (Davidovo školení 7. 10., 9. 11. 2026). */
            const drzena = Number(c.sazba) > 0 ? Number(c.sazba) : sazbaZCiselniku;
            if (!jeAbsence && !drzena) { chybiSazba.add(z.uid); continue; }
            kUlozeni.push({ z: z, sazba: drzena });
        }
        if (kUlozeni.length >= DAVKA_CASTEK) break;
    }
    if (!kUlozeni.length) {
        return { doplneno: 0, doplnene: [], chybiSazba: [...chybiSazba] };
    }

    let hotovo = 0;
    /* Hláška o dopočtu má říct, ČÍ výkaz a k jakému dni se doplnil – samotné
       „u 3 výkazů" se nedalo s ničím spojit (Michal 4. 9. 2026). */
    const doplnene = [];
    for (const polozka of kUlozeni.slice(0, DAVKA_CASTEK)) {
        const z = polozka.z;
        try {
            await setDoc(castkaDoc(z.id), Object.assign({
                sazba: polozka.sazba,
                uid: z.uid, datum: z.datum, zakazka: z.zakazka,
                updatedMs: Date.now(),
                updatedBy: "dopočet"
            }, KB.spocitejCastky(z, polozka.sazba)), { merge: true });
            /* Do Tabulek se řádek musí přepsat znovu – hodinová
               synchronizace se řídí datem změny ZÁZNAMU, a ten se
               nezměnil, takže sloupec s taxou by zůstal prázdný. */
            KB.posliDoSheets(z.id);
            hotovo++;
            doplnene.push({ uid: z.uid || "", osoba: z.osoba || "", datum: z.datum || "" });
        } catch (err) { console.warn("Částka se nedopočítala:", z.id, err); }
    }
    if (hotovo) {
        KB.zapisAktivitu("vykaz",
            "dopočítal částky u " + hotovo + " výkazů podle sazeb lidí", "Systém");
    }
    return { doplneno: hotovo, doplnene: doplnene, chybiSazba: [...chybiSazba] };
};

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

    /* Peníze k dotaženému období: manažerovi všechny, tomu, kdo si
       fakturuje sám, jeho vlastní. Zaměstnanci žádné. */
    if (!jenSve) {
        const snapC = await getDocs(query(castkyCol(), ...meze));
        snapC.forEach(d => { starsiCastky[d.id] = d.data(); });
    } else if (KB.fakturujeSi()) {
        const snapC = await getDocs(query(castkyCol(),
            where("uid", "==", auth.currentUser.uid), ...meze));
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

/* ------------------------------------- vlastní částky OSVČ a studentů ----
   Zaměstnanec má domluvenou měsíční výplatu a hodinovka mu nic neříká.
   OSVČ a student na dohodu si podle odpracovaných hodin píšou fakturu –
   bez částek by ji neměli z čeho vystavit (Michal 2. 9. 2026). Dostanou
   proto SVOJI část kolekce `castky`; cizí jim pravidla nepustí.

   Typ spolupráce se pozná až ze seznamu lidí, a ten chodí vlastním
   odběrem. Nasazení se proto zkouší z obou stran – odsud i z odběru lidí –
   a `mojeCastkyOdber` hlídá, že se nasadí nejvýš jednou. */
let mojeCastkyOdber = null;

/* Dokud databáze částky opravdu nevydá, tváří se stránka jako dřív. Bez
   toho by se po nasazení webu, ale PŘED nasazením pravidel, ukázaly OSVČ
   sloupce s penězi a v nich samé nuly. */
KB.mojeCastkyPrisly = false;

/** Typ spolupráce přihlášeného. Stejné odvození jako UI.typUvazku. */
KB.mujTyp = () => {
    const uid = (auth && auth.currentUser) ? auth.currentUser.uid : "";
    const ja = uid ? (KB.users || []).find(u => u.id === uid) : null;
    if (!ja) return "";
    return ja.typ || (ja.role === "student" ? "student" : "zamestnanec");
};

/** Fakturuje si člověk práci sám? Pak u svého výkazu vidí i peníze. */
KB.fakturujeSi = () => ["osvc", "dpp", "dpc", "student"].indexOf(KB.mujTyp()) !== -1;

function sledujMojeCastky() {
    if (mojeCastkyOdber || vykazyRezim !== "moje") return;
    if (!db || !auth || !auth.currentUser) return;
    if (!(KB.users || []).length || !KB.fakturujeSi()) return;

    mojeCastkyOdber = onSnapshot(
        query(castkyCol(), where("uid", "==", auth.currentUser.uid)), (snapshot) => {
            syroveCastky = {};
            snapshot.forEach(d => { syroveCastky[d.id] = d.data(); });
            KB.mojeCastkyPrisly = true;
            spojVykazy();
        }, (err) => console.error("Chyba čtení vlastních částek:", err));
    vykazyOdbery.push(mojeCastkyOdber);
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

    if (jenSve) {
        /* Zaměstnanci částky ani sazby nepatří. OSVČ a student si ale práci
           fakturují sami, takže svoje peníze vidět musí – viz níž. */
        sledujMojeCastky();
        return;
    }

    vykazyOdbery.push(onSnapshot(
        query(castkyCol(), where("datum", ">=", KB.vykazyOknoOd)), (snapshot) => {
        syroveCastky = {};
        snapshot.forEach(d => { syroveCastky[d.id] = d.data(); });
        // částky dorazily (Výplaty bez nich nepočítají – vyšly by nuly)
        KB.castkyPrisly = true;
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
        // limit DPP pro stránku Výplaty: { limitHodinRok, hraniceKcMesic } (V.limitDpp)
        KB.dppNastaveni = (data.dpp && typeof data.dpp === "object") ? data.dpp : {};
        // text výzvy OSVČ k faktuře { predmet, text } – null = výchozí (V.VYZVA_VYCHOZI), 12. 11. 2026
        KB.vyzvaFaktura = (data.vyzvaFaktura && typeof data.vyzvaFaktura === "object") ? data.vyzvaFaktura : null;
        /* Bez tohohle příznaku by dopočet částek běžel s prázdným
           číselníkem a všem by zapsal nulovou sazbu. */
        KB.sazbyPrisly = true;
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
        /* Popis si podle vybraných pater a technologií doplňuje web. Příznak
           říká, že do něj nikdo nesáhl rukou – při další úpravě se tedy smí
           přepsat na to, co zápis obsahuje teď (Michal 4. 9. 2026). */
        nazevAuto: data.nazevAuto === true,
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
        /* Patro i technologie můžou být dvě nebo tři, spojené do „1PP, 2PP".
           Vedle nich podíl práce v procentech („50,50"): v plnění projektu
           se peníze zápisu dělí podíl patra × podíl technologie
           (Michal 4. 9. 2026). Prázdné = rovným dílem. */
        patro:    data.patro || "",
        podilPatra: data.podilPatra || "",
        podilTech:  data.podilTech || "",
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
        /* Placené školení: absence, u které se sazba přesto počítá.
           Domluva je mezi člověkem a majitelem, web ji neověřuje –
           drží jen příznak, podle kterého se nenuluje sazba
           (Michal 13. 10. 2026). Čte ho i Apps Script u výkazů. */
        absencePlacena: data.absencePlacena === true,
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

/* `akce` nepovinně: bez ní zápis řádku jako dřív ({ id }); s ní (od 12. 11.
   2026 jen "smazat" – smazaný zápis zmizí i ze sešitu, Michal v Iris) jde
   i ID token přihlášeného, protože mazání skript pustí jen manažerovi nebo
   vlastníkovi sešitu a sám si ověří, že zápis v databázi opravdu není. */
KB.posliDoSheets = (id, akce) => {
    if (!KB.gsyncUrl || !id) return;
    /* text/plain schválně: prohlížeč tak požadavek pošle rovnou, bez
       předletu, který Apps Script neumí odbavit. Odpověď nečteme –
       výsledek si skript zapíše zpátky do databáze. */
    poOdeslani().then(async () => {
        const telo = { id: id };
        if (akce) telo.akce = String(akce);
        /* token i u základní akce – skript ho zatím jen zaloguje, později bez něj odmítne (audit 10. 11. 2026, Michal 12. 11. 2026, Iris) */
        try { telo.token = await auth.currentUser.getIdToken(); } catch (err) { /* bez tokenu jde jen { id } jako dřív */ }
        return fetch(KB.gsyncUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(telo)
        });
    }).catch(err => console.warn("Zápis do Tabulek se neozval:", err));
};

/**
 * Opis nové zakázky do Evidence zakázek v Tabulkách Google.
 *
 * Posílá se stejnou cestou jako výkazy (`meta/gsync`), jen s `akce:"zakazka"`.
 * Odpověď se nečte – skript si výsledek zapíše zpátky k projektu do pole
 * `evidence`, takže je ve Správě vidět, jestli to prošlo.
 */
KB.posliZakazkuDoEvidence = async (projekt) => {
    if (!KB.gsyncUrl || !projekt || !projekt.cislo) return;
    await poOdeslani();
    /* Adresu skriptu zná každý člen, proto skript (od v284) pustí jen
       manažera, pozná ho podle ID tokenu, a údaje zakázky si přečte sám
       z databáze. Pole níž se posílají dál jen kvůli starší verzi skriptu. */
    let token = "";
    try { token = await auth.currentUser.getIdToken(); } catch (err) { /* bez tokenu skript zápis odmítne */ }
    fetch(KB.gsyncUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
            akce: "zakazka",
            id: projekt.id || "",
            token: token,
            cislo: projekt.cislo || "",
            nazev: projekt.nazev || "",
            objednatel: projekt.objednatel || "",
            // sloupec E „řeší:" – kdo zakázku bude dělat
            resi: projekt.resi || "",
            // sloupec F – datum poptání
            poptano: projekt.poptano || projekt.datumPoptani || ""
        })
    }).catch(err => console.warn("Zápis zakázky do evidence se neozval:", err));
};

KB.zpetnePovoleni = {};
KB.uzaverkaOd = "";

/**
 * Uzávěrka výkazů. `odIso` je první den, který zůstává otevřený
 * („2026-10-01" = září je uzavřené); prázdný řetězec čáru zruší.
 * Zapisuje manažer (pravidla pro meta) – dopředu; zpátky (odemknout
 * měsíc) jen hlavní správce. Uzavřený měsíc pak opravuje jen hlavní
 * správce (od 12. 11. 2026, Iris) – zaměstnanec ani se zpětným povolením,
 * manažer taky ne; zbývá „Nahlásit chybu" a stránka Uzávěrka měsíce.
 */
KB.ulozUzaverku = async (odIso, popis) => {
    if (authReady) await authReady;
    requireDb();
    const od = String(odIso || "");
    if (od && !/^\d{4}-\d{2}-\d{2}$/.test(od)) throw new Error("Neplatné datum uzávěrky.");
    await setDoc(metaDoc("uzaverka"), {
        odIso: od,
        kdo: window.KB_USER || "",
        ms: Date.now()
    });
    KB.zapisAktivitu("vykaz", popis || (od ? "uzavřel výkazy před " + od : "zrušil uzávěrku výkazů"));
};

/**
 * Povolení zpětného zápisu. Posílá se JEN to, co se mění – { uid: záznam }.
 * Merge ostatní lidi nechá být, takže se dva manažeři, kteří povolují
 * zároveň, navzájem nepřepíšou. Zrušení = { uid: "" }.
 */
KB.ulozZpetnePovoleni = async (mapa, popis) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(metaDoc("zpetne"), {
        povoleni: mapa || {},
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    KB.zapisAktivitu("vykaz", popis || "změnil povolení zpětného zápisu");
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
    // smazaný zápis i ze sešitu – jinak tam řádek zůstane navždy (Michal 12. 11. 2026, Iris)
    KB.posliDoSheets(id, "smazat");
};

/**
 * Tajné číselníky výkazů (sazby lidí, rozpočty zakázek). Zapisuje se jen to,
 * co volající opravdu předá, ať úprava rozpočtu neshodí uložené sazby.
 */
/* ------------------------------------------------- vlastní sazba ----
   Kdo si fakturuje sám (OSVČ, student), potřebuje svou sazbu vidět i PŘI
   PSANÍ výkazu, ne až u uloženého zápisu – jinak mu formulář slibuje nulu.
   Číselník `vykazy/ciselniky/nastaveni` mu ukázat nejde: je to jeden
   dokument se sazbami všech lidí a s rozpočty zakázek, a pravidla neumí
   schovat jednotlivé pole. Proto se sazba každého zrcadlí do jeho vlastního
   dokumentu, na který právo má (Michal 13. 10. 2026).

   Zrcadlo se přepisuje celé při každém uložení Nastavení. Dopočítávat jen
   rozdíly by znamenalo pamatovat si, co se změnilo, a první nesrovnalosti
   by si nikdo nevšiml – sazba v zrcadle je jen pro zobrazení, závazná je
   pořád ta, kterou k zápisu dopíše manažerský skript. */
const sazbaDoc = (uid) => doc(db, "artifacts", APP_ID, "private", "sazby", "lide", uid);

KB.mojeSazba = null;        // { zakladni, projekty: { "Zakázka": kc } }
let mojeSazbaOdber = null;

/** Zrcadlo sazeb po lidech. Volá se z uložení Nastavení; chyba nesmí
    shodit samotné uložení, proto se jen zaloguje. */
KB.zrcadliSazby = async (sazby, rozpocty) => {
    if (!db) return;
    /* Zaměstnanci zrcadlo nedostanou vůbec. Hodinovka se jim schválně
       nikde neukazuje (mají domluvenou měsíční výplatu) a co v databázi
       není, to se nemůže omylem odemknout ani špatným pravidlem. */
    const siFakturuje = (uid) => {
        const u = (KB.users || []).find(x => x.id === uid);
        if (!u) return false;
        const typ = u.typ || (u.role === "student" ? "student" : "zamestnanec");
        return ["osvc", "dpp", "dpc", "student"].indexOf(typ) !== -1;
    };
    const lide = {};
    Object.keys(sazby || {}).forEach(uid => {
        lide[uid] = { zakladni: Number(sazby[uid]) || 0, projekty: {} };
    });
    Object.keys(rozpocty || {}).forEach(nazev => {
        const proj = (rozpocty[nazev] || {}).sazby || {};
        Object.keys(proj).forEach(uid => {
            if (!lide[uid]) lide[uid] = { zakladni: 0, projekty: {} };
            lide[uid].projekty[nazev] = Number(proj[uid]) || 0;
        });
    });
    const razitko = Date.now();
    for (const uid of Object.keys(lide)) {
        if (!siFakturuje(uid)) continue;
        try {
            await setDoc(sazbaDoc(uid), Object.assign({ ms: razitko }, lide[uid]));
        } catch (err) {
            console.warn("Sazba se nezrcadlila:", uid, err);
        }
    }
};

/** Odběr vlastní sazby – jen pro toho, kdo si fakturuje sám. */
KB.watchMojeSazba = async () => {
    if (mojeSazbaOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || mojeSazbaOdber) return;
    if (pockejNaRoli(KB.watchMojeSazba)) return;
    if (!KB.fakturujeSi()) return;
    mojeSazbaOdber = onSnapshot(sazbaDoc(auth.currentUser.uid), (snap) => {
        KB.mojeSazba = snap.exists() ? snap.data() : null;
        emit("moje-sazba", KB.mojeSazba);
    }, (err) => console.error("Chyba čtení vlastní sazby:", err));
};

KB.saveVykazNastaveni = async (patch) => {
    if (authReady) await authReady;
    requireDb();

    const payload = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    ["cinnosti", "technologie", "sazby", "rozpocty"].forEach(klic => {
        if (patch[klic] !== undefined) payload[klic] = patch[klic];
    });
    /* Limit DPP (stránka Výplaty, mění finance): hodin za rok (výchozí 300)
       a měsíční hranice příjmu pro odvody v Kč – null = zatím nenastavená,
       hlídají se jen hodiny. */
    if (patch.dpp !== undefined) {
        const d = patch.dpp || {};
        const limit = Number(d.limitHodinRok);
        const hranice = (d.hraniceKcMesic === null || d.hraniceKcMesic === "" || d.hraniceKcMesic === undefined)
            ? 0 : Number(d.hraniceKcMesic);
        payload.dpp = {
            limitHodinRok: limit > 0 ? Math.round(limit) : 300,
            hraniceKcMesic: hranice > 0 ? Math.round(hranice) : null
        };
    }
    await setDoc(vykazyMeta(), payload, { merge: true });
    /* Změna sazeb a rozpočtů jsou peníze – v historii nesmí chybět,
       i když se z logu nepozná konkrétní číslo (na to je záloha). */
    KB.zapisAktivitu("vykaz", "změnil nastavení výkazů (" +
        Object.keys(patch).join(", ") + ")");
    /* Zrcadlo sazeb se srovná po každém uložení, které se sazeb týká.
       Záměrně BEZ `await` v cestě uložení: je to doplněk pro zobrazení
       a jeho selhání nesmí vypadat jako neuložené nastavení. */
    if (patch.sazby !== undefined || patch.rozpocty !== undefined) {
        KB.zrcadliSazby(patch.sazby || KB.sazby, patch.rozpocty || KB.rozpocty)
            .catch(err => console.warn("Zrcadlo sazeb se neobnovilo:", err));
    }
};

/**
 * Schválení čerpání rozpočtu = „čerpání v tomhle stavu jsem vzal na vědomí“
 * (Michal 3. 11. 2026). Leží u rozpočtu zakázky:
 *   rozpocty[název].schvaleno = { pct, kc, ms, kdo }
 * Kdy se čerpání hlásí znovu, říká V.rozpocetHlasit (vykazy.js) – stejně ho
 * opisuje Apps Script v týdenním souhrnu. Zapisuje se JEN tohle pole přes
 * slučování (mapa do hloubky, název zakázky je klíč mapy, ne cesta pole –
 * tečka v názvu tedy nevadí), ne celý číselník přes saveVykazNastaveni,
 * který by poslal kopii všech rozpočtů z paměti. Smí to, kdo smí rozpočty
 * nastavovat: manažer (vykaz.view; v pravidlech spravce() nad private/**).
 */
KB.schvalRozpocet = async (nazev, stav) => {
    if (authReady) await authReady;
    requireDb();
    nazev = String(nazev || "");
    if (!nazev || !(KB.rozpocty || {})[nazev]) throw new Error("Zakázka nemá rozpočet.");
    const pct = Number(stav && stav.pct);
    if (!(stav && stav.pct !== null && stav.pct !== "") || !isFinite(pct)) throw new Error("Neplatné čerpání.");
    const schvaleno = {
        pct: Math.round(pct * 10) / 10,
        kc: Math.round(Number(stav.kc) || 0),
        ms: Date.now(),
        kdo: window.KB_USER || ""
    };
    await setDoc(vykazyMeta(), { rozpocty: { [nazev]: { schvaleno: schvaleno } } }, { merge: true });
    KB.zapisAktivitu("vykaz", "schválil čerpání rozpočtu " + Math.round(pct) + " % – " + nazev);
    return schvaleno;
};

/** Zrušení schválení – čerpání se zase hlásí podle prahů 80 / 100 %. */
KB.zrusSchvaleniRozpoctu = async (nazev) => {
    if (authReady) await authReady;
    requireDb();
    nazev = String(nazev || "");
    if (!nazev || !(KB.rozpocty || {})[nazev]) throw new Error("Zakázka nemá rozpočet.");
    await setDoc(vykazyMeta(), { rozpocty: { [nazev]: { schvaleno: deleteField() } } }, { merge: true });
    KB.zapisAktivitu("vykaz", "zrušil schválení čerpání rozpočtu – " + nazev);
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
               uzavreno:false, lide:[uid], poznamka,
               stavProjektu, stavHistorie (týdenní semafor, KB.ulozStavProjektu) } */

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
    /* `slozkaP` sem patří proto, že stav složky na P: zapisuje nástroj na
       PC a uložení Údajů na webu by ho jinak vynulovalo – `saveProjekt`
       dokument skládá znovu (Michal 8. 10. 2026). */
    const povolena = ["sablony", "technologie", "zpetne", "bezSheets", "slozkaP", "zkratka"];
    const payload = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    povolena.forEach(klic => {
        if (patch[klic] !== undefined) payload[klic] = patch[klic];
    });
    await setDoc(projektDoc(id), payload, { merge: true });
};

/**
 * Týdenní stav projektu – semafor a pár vět (rešerše 22, jen manažer).
 * Leží přímo v hlavičce projektu, ne v podkolekci: Gantt, nástěnka i Apps
 * Script projekty čtou tak jako tak, takže stav dostanou bez dalšího čtení
 * a bez nových pravidel (zápis do hlavičky smí jen manažer).
 *   stavProjektu: { kod, text, ms, uid, jmeno }   poslední zápis
 *   stavHistorie: [ … ]                           posledních 26 (půl roku), nejnovější první
 * Transakce: dva manažeři naráz si historii nepřepíšou. `saveProjekt` tahle
 * pole nevypisuje (merge), takže je uložení Údajů nesmaže.
 */
KB.ulozStavProjektu = async (id, kod, text) => {
    if (authReady) await authReady;
    requireDb();
    if (!id) throw new Error("Chybí projekt.");
    if (!(window.KBUI && window.KBUI.STAVY_PROJEKTU || []).some(s => s.kod === kod)) {
        throw new Error("Neznámý stav projektu.");
    }
    const zapis = {
        kod: kod,
        text: String(text || "").trim().slice(0, 600),
        ms: Date.now(),
        uid: KB.currentUid() || "",
        jmeno: window.KB_USER || ""
    };
    let nazev = "";
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(projektDoc(id));
        if (!snap.exists()) throw new Error("Projekt v databázi není.");
        const d = snap.data() || {};
        nazev = d.nazev || "";
        const historie = Array.isArray(d.stavHistorie) ? d.stavHistorie : [];
        tx.update(projektDoc(id), {
            stavProjektu: zapis,
            stavHistorie: [zapis].concat(historie).slice(0, 26),
            updatedMs: zapis.ms,
            updatedBy: window.KB_USER || ""
        });
    });
    KB.zapisAktivitu("projekt", "aktualizoval stav projektu " + nazev);
    return zapis;
};

KB.saveProjekt = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    // manažerů může být víc; `manazer` zůstává kvůli starším záznamům
    const manazeri = Array.isArray(data.manazeri) ? data.manazeri
        : (data.manazer ? [data.manazer] : []);
    await setDoc(projektDoc(id), {
        cislo:    data.cislo || "",
        /* Zkratka = chip v Milnících (2–5 znaků); prázdná → odvodí se z názvu. */
        zkratka:  String(data.zkratka || "").trim().toUpperCase().slice(0, 5),
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
        /* Kdy zakázka přišla jako poptávka. Vede se tu, ne až
           v Evidenci v Tabulkách – odtamtud se jen opisuje
           (Michal 9. 10. 2026). */
        datumPoptani: data.datumPoptani || "",
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
    /* Jmenný seznam pro celý tým se drží vedle – aktualizuje se tady, ať
       se o něj nikdo nemusí starat ručně. Nový projekt ještě není
       v `projektyDocs` (snapshot chodí později), proto se přidá zvlášť. */
    KB.obnovSeznamZakazek(Object.assign({ id: id }, data))
        .catch(err => console.warn("Seznam zakázek se neobnovil:", err));
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

/**
 * Hromadné přiřazení JEDNOHO člověka k projektům – opačný pohled než ve
 * Správě projektů, kde se to klikalo projekt po projektu (Michal 8. 10. 2026).
 *
 * Zapisuje jen `lide` (a uklidí po sobě `lideTech`), ne celou hlavičku:
 * `saveProjekt` dokument skládá znovu a co mu nepředáš, to vynuluje.
 * Sahá se jen na projekty, u kterých se přiřazení opravdu mění.
 *
 * @param {string} uid          komu se projekty přiřazují
 * @param {string[]} idsZapnute projekty, na kterých má být
 * @param {string} [jmeno]      do historie kroků, ať je vidět čí
 * @returns {Promise<{pridano:number, odebrano:number}>}
 */
KB.ulozProjektyCloveka = async (uid, idsZapnute, jmeno) => {
    if (authReady) await authReady;
    requireDb();
    if (!uid) return { pridano: 0, odebrano: 0 };

    const chteno = {};
    (Array.isArray(idsZapnute) ? idsZapnute : []).forEach(id => { chteno[id] = true; });
    const razitko = { updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    const zmeny = [];
    let pridano = 0, odebrano = 0;

    (KB.projektyDocs || []).forEach(p => {
        const lide = Array.isArray(p.lide) ? p.lide.slice() : [];
        const ma = lide.indexOf(uid) !== -1;
        const chce = !!chteno[p.id];
        if (ma === chce) return;
        if (chce) { lide.push(uid); pridano++; }
        else { lide.splice(lide.indexOf(uid), 1); odebrano++; }
        /* Technologie se vedou po lidech – kdo z projektu odešel, nemá v nich
           co dělat, jinak by mu tam visely napořád. */
        const tech = Object.assign({}, p.lideTech || {});
        if (!chce) delete tech[uid];
        zmeny.push({ id: p.id, data: Object.assign({ lide: lide, lideTech: tech }, razitko) });
    });

    for (let i = 0; i < zmeny.length; i += 300) {
        const davka = writeBatch(db);
        zmeny.slice(i, i + 300).forEach(z => davka.update(projektDoc(z.id), z.data));
        await davka.commit();
    }
    if (zmeny.length) {
        KB.zapisAktivitu("projekt", "upravil projekty člověka " + (jmeno || "") +
            " (přidáno " + pridano + ", odebráno " + odebrano + ")");
    }
    return { pridano: pridano, odebrano: odebrano };
};

/**
 * Přidá firmu do společného číselníku a vrátí její název.
 *
 * Dřív šlo firmu založit jedině ve Správě firem, takže kdo zakládal projekt,
 * musel odejít ze stránky – a přišel o rozepsané údaje (Michal 8. 10. 2026).
 * Firma, která už v číselníku je, se nepřidává dvakrát; vrátí se tak, jak
 * je zapsaná, aby roletka našla přesnou shodu.
 *
 * @param {string} nazev
 * @param {Object} [detail] nepovinné IČO, adresa, kontakt…
 * @returns {Promise<string>} název firmy v číselníku
 */
KB.pridejFirmu = async (nazev, detail) => {
    if (authReady) await authReady;
    requireDb();
    const jmeno = String(nazev || "").trim().slice(0, 160);
    if (!jmeno) throw new Error("Firma bez názvu.");

    const uz = (KB.firmy || []).find(f =>
        String(f).trim().toLowerCase() === jmeno.toLowerCase());
    if (uz) return uz;

    await KB.saveCiselnikZakazek({ firmy: (KB.firmy || []).concat([jmeno]) });
    if (detail && Object.keys(detail).length) {
        const vse = Object.assign({}, KB.firmyDetail || {});
        vse[jmeno] = detail;
        await KB.ulozFirmyDetail({ firmyDetail: vse });
    }
    KB.zapisAktivitu("projekt", "přidal firmu " + jmeno);
    return jmeno;
};

/**
 * Přepíše jmenný seznam zakázek, který vidí celý tým.
 *
 * Schválně obsahuje JEN číslo, název a jestli je zakázka uzavřená – nic
 * o penězích, firmě ani lidech. Projekty samotné leží v `private` a
 * zaměstnanec přečte jen ty svoje; tohle je náhrada toho, co lidé hledali
 * v Evidenci zakázek (Michal 8. 10. 2026).
 *
 * @param {Object} [navic] právě uložený projekt – snapshot ho ještě nemusí mít
 */
KB.obnovSeznamZakazek = async (navic) => {
    if (authReady) await authReady;
    requireDb();
    const podle = {};
    (KB.projektyDocs || []).forEach(p => { podle[p.id] = p; });
    if (navic && navic.id) podle[navic.id] = Object.assign({}, podle[navic.id], navic);

    const polozky = Object.keys(podle).map(id => podle[id])
        .filter(p => (p.cislo || p.nazev))
        .map(p => ({
            cislo: String(p.cislo || "").trim(),
            nazev: String(p.nazev || "").trim(),
            uzavreno: p.uzavreno === true
        }))
        .sort((a, b) => String(b.cislo).localeCompare(String(a.cislo), "cs"));

    await setDoc(metaDoc("zakazky-seznam"), {
        polozky: polozky,
        ms: Date.now(),
        updatedBy: window.KB_USER || ""
    });
    return polozky.length;
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

   Faktura: { typ:"prijata|vydana", nazev (vlastní název jako v Caflou;
              prázdný = složí se z dodavatele a čísla), cislo, protistrana, ico, dic, adresa,
              projekt (název – stejně jako u výkazů; "" = administrativní
              činnost), castkaBez, dphSazba, castkaDph, castkaCelkem,
              mena:"CZK", kurz (Kč za 1 jednotku cizí měny), vs,
              vystaveno:"2026-08-21", duzp, splatnost, uhrazeno:"",
              stav:"nova|zarazena|schvalena|zaplacena", kategorie (jen přijaté),
              druhDokladu:"faktura|uctenka|zalohova|dobropis|jine",
              zpusobUhrady:"prevod|karta|hotove|dobirka|jine",
              polozky:[{ popis, mnozstvi, mj, cena, dph }], cesta (cesta na
              disku nebo odkaz na soubor), poznamka,
              rozpisDph:[{ sazba, zaklad, dph }] – každá sazba DPH zvlášť
              (přijaté), poplatky + poplatkyPopis (mimo DPH, např. recyklační
              poplatek), zaokrouhleni; celkem = základy + DPH + poplatky
              + zaokrouhlení,
              zdroj:"inbox" + kontroly:[{ uroven, text }] – záznam připravil
              program z inboxu a čeká na kontrolu člověkem (stav "nova");
              otisk (SHA-256 PDF – import ho nezaloží dvakrát), navrhSlozka
              + navrhSoubor (kam PDF po potvrzení patří),
              potvrdil + potvrzenoMs – kdo ho zkontroloval a zařadil,
              uhradil + uhrazenoMs – kdo označil zaplaceno (dlaždice),
              qrPlatba (text platebního QR z dokladu, SPAYD) + qr { iban,
              castka, mena, vs, zprava, prijemce }, nahled { strany, celkem }
              – stránky samotné jsou v private/faktury/nahledy (viz níž),
              caflouKlic (stálý klíč záznamu z exportu Caflou) + caflou { stav:
              souhlasi|lisi|chybi|duplicita, text, nazev } – porovnání zapisuje
              načtení ze souboru; zdroj "archiv" = PDF z Google Disku bez Caflou }

     meta/nastaveni nese navíc `kategorie` – seznam kategorií výdajů, který
     si asistentka rozšiřuje sama.                                         */

const DRUHY_DOKLADU = ["faktura", "uctenka", "zalohova", "dobropis", "jine"];
const ZPUSOBY_UHRADY = ["prevod", "karta", "hotove", "dobirka", "jine"];

/** Kontroly z inboxu – jen krátké texty a úroveň, nic dalšího se neuloží. */
const cistiKontroly = (seznam) => (Array.isArray(seznam) ? seznam : []).slice(0, 30).map(k => ({
    uroven: ["chyba", "varovani", "info"].indexOf(k && k.uroven) !== -1 ? k.uroven : "info",
    text: String((k && k.text) || "").slice(0, 300)
}));

/** Údaje z QR platby (SPAYD) – jen to, co web ukazuje; celý text je v `qrPlatba`. */
const cistiQr = (q) => (q && typeof q === "object") ? {
    iban: String(q.iban || "").slice(0, 40),
    castka: Number(q.castka) || 0,
    mena: String(q.mena || "CZK").slice(0, 3),
    vs: String(q.vs || "").slice(0, 10),
    zprava: String(q.zprava || "").slice(0, 60),
    prijemce: String(q.prijemce || "").slice(0, 60)
} : {};

/** Porovnání s Caflou (zapisuje načtení ze souboru): souhlasí / liší se / chybí / duplicita. */
const cistiCaflou = (c) => (c && typeof c === "object") ? {
    stav: ["souhlasi", "lisi", "chybi", "duplicita"].indexOf(c.stav) !== -1 ? c.stav : "souhlasi",
    text: String(c.text || "").slice(0, 400),
    nazev: String(c.nazev || "").slice(0, 150),
    ms: Date.now()
} : null;

/** Rozpis DPH – nejvýš pár sazeb, jen čísla. */
const cistiRozpis = (seznam) => (Array.isArray(seznam) ? seznam : []).slice(0, 6).map(r => ({
    sazba: Number(r && r.sazba) || 0,
    zaklad: Math.round((Number(r && r.zaklad) || 0) * 100) / 100,
    dph: Math.round((Number(r && r.dph) || 0) * 100) / 100
})).filter(r => r.zaklad || r.dph);

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

KB.saveFaktura = async (id, data, volby) => {
    if (authReady) await authReady;
    requireDb();
    const mena = /^[A-Z]{3}$/.test(String(data.mena || "").toUpperCase())
        ? String(data.mena).toUpperCase() : "CZK";
    const zaznam = {
        typ:          data.typ === "vydana" ? "vydana" : "prijata",
        nazev:        String(data.nazev || "").slice(0, 150),
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
        rozpisDph:    cistiRozpis(data.rozpisDph),
        poplatky:     Number(data.poplatky) || 0,
        poplatkyPopis: String(data.poplatkyPopis || "").slice(0, 120),
        zaokrouhleni: Number(data.zaokrouhleni) || 0,
        mena:         mena,
        kurz:         mena === "CZK" ? 0 : (Number(data.kurz) || 0),
        vs:           data.vs || "",
        vystaveno:    data.vystaveno || "",
        duzp:         data.duzp || "",
        splatnost:    data.splatnost || "",
        uhrazeno:     data.uhrazeno || "",
        stav:         data.stav || "nova",
        kategorie:    String(data.kategorie || "").slice(0, 60),
        druhDokladu:  DRUHY_DOKLADU.indexOf(data.druhDokladu) !== -1 ? data.druhDokladu : "faktura",
        zpusobUhrady: ZPUSOBY_UHRADY.indexOf(data.zpusobUhrady) !== -1 ? data.zpusobUhrady : "",
        polozky:      Array.isArray(data.polozky) ? data.polozky : [],
        cesta:        data.cesta || "",
        poznamka:     data.poznamka || "",
        createdMs:    data.createdMs || Date.now(),
        createdBy:    data.createdBy || window.KB_USER || "",
        updatedMs:    Date.now(),
        updatedBy:    window.KB_USER || ""
    };
    /* Stopy po inboxu se posílají, jen když je stránka opravdu mění –
       běžné uložení formuláře je díky merge nechá, jak je. */
    if (data.zdroj !== undefined) zaznam.zdroj = String(data.zdroj || "").slice(0, 20);
    if (data.kontroly !== undefined) zaznam.kontroly = cistiKontroly(data.kontroly);
    ["otisk", "navrhSlozka", "navrhSoubor"].forEach(k => {
        if (data[k] !== undefined) zaznam[k] = String(data[k] || "").slice(0, 200);
    });
    // QR k platbě přichází jen z načtení ze souboru; formulář ho nechává, jak je
    if (data.qrPlatba !== undefined) {
        zaznam.qrPlatba = String(data.qrPlatba || "").slice(0, 600);
        zaznam.qr = zaznam.qrPlatba ? cistiQr(data.qr) : {};
    }
    if (data.caflouKlic !== undefined) zaznam.caflouKlic = String(data.caflouKlic || "").slice(0, 60);
    if (data.caflou && typeof data.caflou === "object") zaznam.caflou = cistiCaflou(data.caflou);
    if (data.potvrdit === true) {
        zaznam.potvrdil = window.KB_USER || "";
        zaznam.potvrzenoMs = Date.now();
    }
    // „sáhl na to člověk“ – formulář ano, načtení ze souboru ne; podle toho
    // smí opakované načtení záznam obnovit novým čtením programu
    zaznam.rucne = !(volby && volby.bezAktivity);
    /* Prohlédnuto: člověk viděl rozdíl proti Caflou (nebo duplicitu) a rozhodl,
       že na webu je to správně. Pamatuje si, k jakému textu rozdílu se to
       vztahuje – když příští načtení najde jiný rozdíl, jde doklad ke kontrole znovu. */
    if (data.prohlednuto && typeof data.prohlednuto === "object") {
        zaznam.prohlednuto = { kdo: window.KB_USER || "", ms: Date.now(),
            caflouText: String(data.prohlednuto.caflouText || "").slice(0, 400) };
    }
    await setDoc(fakturaDoc(id), zaznam, { merge: true });
    // do aktivit schválně bez částek – stačí, co se stalo a k čemu;
    // hromadné načtení z inboxu zapíše jeden souhrnný řádek samo
    if (!(volby && volby.bezAktivity)) {
        KB.zapisAktivitu("faktura", (data.potvrdit ? "zkontroloval a zařadil fakturu " : "uložil fakturu ") +
            (data.cislo || "(bez čísla)") + (data.projekt ? " k projektu " + data.projekt : ""));
    }
    return id;
};

/** Doplnění jednotlivých polí faktury (porovnání s Caflou, otisk a údaje z nově
    spárovaného PDF) – mění jen to, co přijde, zbytek nechává. */
KB.doplnFakturu = async (id, pole) => {
    if (authReady) await authReady;
    requireDb();
    const zaznam = { updatedMs: Date.now() };
    ["caflouKlic", "otisk", "cesta", "navrhSlozka", "navrhSoubor", "ico", "dic", "adresa", "cislo", "vs",
        "vystaveno", "duzp"].forEach(k => {
        if (pole[k] !== undefined) zaznam[k] = String(pole[k] || "").slice(0, 300);
    });
    if (pole.caflou && typeof pole.caflou === "object") zaznam.caflou = cistiCaflou(pole.caflou);
    await setDoc(fakturaDoc(id), zaznam, { merge: true });
};

/** Označení zaplacené faktury z nástěnky – mění JEN úhradu, zbytek faktury
    nechává (plné saveFaktura by prázdnými poli přepsalo ostatní údaje). */
KB.uhradFakturu = async (id, datum) => {
    if (authReady) await authReady;
    requireDb();
    const f = (KB.faktury || []).find(x => x.id === id) || {};
    await setDoc(fakturaDoc(id), {
        uhrazeno: String(datum || "").slice(0, 10),
        stav: "zaplacena",
        uhradil: window.KB_USER || "",
        uhrazenoMs: Date.now(),
        rucne: true,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    KB.zapisAktivitu("faktura", "označil fakturu " + (f.cislo || "(bez čísla)") +
        (f.protistrana ? " od " + f.protistrana : "") + " jako zaplacenou");
};

/** Vrácení úhrady z nástěnky (karta přetažená zpět mezi nezaplacené) – jen úhrada a stav. */
KB.zrusUhraduFaktury = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const f = (KB.faktury || []).find(x => x.id === id) || {};
    await setDoc(fakturaDoc(id), {
        uhrazeno: "",
        stav: "zarazena",
        rucne: true,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    KB.zapisAktivitu("faktura", "vrátil fakturu " + (f.cislo || "(bez čísla)") +
        (f.protistrana ? " od " + f.protistrana : "") + " mezi nezaplacené");
};

/** „Zkontrolováno – na webu je to správně“: rozdíl proti Caflou (nebo duplicita)
    je prohlédnutý člověkem, doklad odchází z Ke kontrole. Zbytek faktury se nemění. */
KB.prohlednutoFaktura = async (id, caflouText) => {
    if (authReady) await authReady;
    requireDb();
    const f = (KB.faktury || []).find(x => x.id === id) || {};
    await setDoc(fakturaDoc(id), {
        prohlednuto: { kdo: window.KB_USER || "", ms: Date.now(), caflouText: String(caflouText || "").slice(0, 400) },
        rucne: true,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    KB.zapisAktivitu("faktura", "zkontroloval fakturu " + (f.cislo || "(bez čísla)") +
        (f.protistrana ? " od " + f.protistrana : "") + " – na webu je správně");
};

KB.deleteFaktura = async (id, cislo) => {
    if (authReady) await authReady;
    requireDb();
    const f = (KB.faktury || []).find(x => x.id === id) || {};
    const stran = Math.min((f.nahled && f.nahled.strany) || 0, 5);
    for (let s = 1; s <= stran; s++) await deleteDoc(fakturaNahledDoc(id, s)).catch(() => {});
    await deleteDoc(fakturaDoc(id));
    KB.zapisAktivitu("faktura", "smazal fakturu " + (cislo || ""));
};

/* Náhledy stránek dokladu (JPEG) – každá strana vlastní dokument pod 1 MB,
   aby je živý přenos seznamu faktur netahal; stránka si je vyžádá až při
   otevření faktury. Ukládá je „Načíst ze souboru“ (vytezeni.py je vyrobí z PDF).
     private/faktury/nahledy/{id}       strana 1  { b64, strana, strany, celkem, ms }
     private/faktury/nahledy/{id}_p2    strana 2 …  (nejvýš 5 stran)
   Na faktuře samotné zůstává jen `nahled: { strany, celkem, ms }` + QR platba. */
const fakturaNahledDoc = (id, strana) => doc(db, "artifacts", APP_ID, "private", "faktury", "nahledy",
    strana > 1 ? id + "_p" + strana : id);

KB.ulozNahledFaktury = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    const strany = (Array.isArray(data.nahledy) ? data.nahledy : [])
        .filter(b => typeof b === "string" && b.length > 0 && b.length < 1000000).slice(0, 5);
    const celkem = Number(data.celkem) || strany.length;
    for (let i = 0; i < strany.length; i++) {
        await setDoc(fakturaNahledDoc(id, i + 1),
            { b64: strany[i], strana: i + 1, strany: strany.length, celkem: celkem, ms: Date.now() });
    }
    const meta = { updatedMs: Date.now() };
    if (strany.length) meta.nahled = { strany: strany.length, celkem: celkem, ms: Date.now() };
    if (data.qrPlatba) {
        meta.qrPlatba = String(data.qrPlatba).slice(0, 600);
        meta.qr = cistiQr(data.qr);
    }
    await setDoc(fakturaDoc(id), meta, { merge: true });
};

KB.nactiNahledFaktury = async (id, strana) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(fakturaNahledDoc(id, strana || 1));
    return snap.exists() ? snap.data() : null;
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
    if (Array.isArray(data.kategorie)) {
        // bez prázdných a bez opakování; pořadí drží, jak ho asistentka zapsala
        const videne = new Set();
        payload.kategorie = data.kategorie.map(k => String(k || "").trim().slice(0, 60))
            .filter(k => k && !videne.has(k.toLowerCase()) && videne.add(k.toLowerCase()))
            .slice(0, 40);
    }
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
           todo:[{ id, text, pct, by, ms }], poznamka,
           opakovani:"|tyden|14dni|mesic", opakovaniDen, opakovaniKoren,
           opakovanyZ, nasledovnikId }                                       */

/* ------------------------------------------ opakování a stav úkolu ----
   Čisté funkce bez databáze – test (NASTROJE\web\testy\test_opakovani.js)
   si úsek mezi značkami OPAKOVANI-ZACATEK a OPAKOVANI-KONEC vyřízne
   a pustí v Node. Nic odsud proto nesmí sahat na KB ani na Firestore.

   OPAKOVÁNÍ (rešerše 19. 10. 2026, nápad 16): úkol i Quick TO-DO může mít
   `opakovani` = "tyden" | "14dni" | "mesic". Po splnění vznikne kopie
   s DALŠÍM TERMÍNEM POČÍTANÝM OD PŮVODNÍHO TERMÍNU (ne od dne splnění)
   a s vynulovaným TO-DO. Kopie má pevné id `<kořen>_o<termín>`, takže
   ji dvojklik, druhá záložka ani druhý manažer nezaloží podruhé; starý
   záznam si navíc pamatuje `nasledovnikId`.
   U „každý měsíc" se drží den v měsíci z prvního termínu (`opakovaniDen`):
   31. 1. → 28. 2. → 31. 3., ne 28. 3. */
/* OPAKOVANI-ZACATEK */
const OPAKOVANI_DNY = { tyden: 7, "14dni": 14, mesic: 0 };
const OPAKOVANI_POPIS = { tyden: "každý týden", "14dni": "každých 14 dní", mesic: "každý měsíc" };

/** Je to platná volba opakování (prázdná = neopakuje se)? */
function jeOpakovani(op) {
    return Object.prototype.hasOwnProperty.call(OPAKOVANI_DNY, op);
}

/**
 * Další termín po `iso` podle opakování. `den` = den v měsíci, na kterém
 * měsíční opakování stojí (jinak den z `iso`). Neplatný vstup → "".
 */
function dalsiTermin(iso, op, den) {
    const s = String(iso || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !jeOpakovani(op)) return "";
    const r = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    let datum;
    if (op === "mesic") {
        const chci = Math.min(31, Math.max(1, Number(den) || d));
        // poslední den PŘÍŠTÍHO měsíce (m je 1–12, Date.UTC chce 0–11)
        const posledni = new Date(Date.UTC(r, m + 1, 0)).getUTCDate();
        datum = new Date(Date.UTC(r, m, Math.min(chci, posledni)));
    } else {
        datum = new Date(Date.UTC(r, m - 1, d + OPAKOVANI_DNY[op]));
    }
    return datum.toISOString().slice(0, 10);
}

/** Jsou všechna zapnutá TO-DO na 100 %? (Bez zapnutých položek ne.) */
function todoVseHotovo(todo) {
    const aktivni = (Array.isArray(todo) ? todo : []).filter(t => t && t.vypnuto !== true);
    return aktivni.length > 0 && aktivni.every(t => (Number(t.pct) || 0) === 100);
}

/**
 * Odhad „Celkem" (`celkem: true`) patří jen úkolu bez skutečného rozpadu.
 * Jakmile úkol dostane opravdové TO-DO položky, odhad se odebere – vedle
 * nich by se s nimi průměroval a plnění by lhalo.
 */
function bezOdhaduCelkem(todo) {
    const seznam = Array.isArray(todo) ? todo : [];
    const skutecne = seznam.filter(t => !(t && t.celkem === true));
    return skutecne.length ? skutecne : seznam;
}

/** Pevné id další kopie: kořen řady + termín. */
function idNasledovnika(puvodni, termin) {
    return String(puvodni.opakovaniKoren || puvodni.id) + "_o" + termin;
}

/** Den v měsíci, na kterém řada stojí (z prvního termínu). */
function denRady(zaznam, termin) {
    return Number(zaznam.opakovaniDen) || Number(String(termin || "").slice(8, 10)) || 0;
}

/**
 * Další úkol opakované řady: { id, data } nebo null. TO-DO se vynuluje
 * (bez poznámek a bez odhadu Celkem), vypnuté položky zůstanou vypnuté.
 * Vazba na milník se nekopíruje – milník má jen jeden úkol.
 */
function nasledovnikUkolu(u, ted, kdo) {
    if (!u || !u.id || !jeOpakovani(u.opakovani)) return null;
    const den = denRady(u, u.termin);
    const termin = dalsiTermin(u.termin, u.opakovani, den);
    if (!termin) return null;
    const todo = (Array.isArray(u.todo) ? u.todo : [])
        .filter(t => t && t.celkem !== true)
        .map((t, i) => Object.assign({ id: "td_" + ted + "_" + i, text: String(t.text || ""),
            pct: 0, by: "", ms: 0 }, t.vypnuto === true ? { vypnuto: true } : {}));
    return {
        id: idNasledovnika(u, termin),
        data: {
            importId: "", projektId: u.projektId || "", projekt: u.projekt || "",
            nazev: u.nazev || "Bez názvu", druh: u.druh || "", technologie: u.technologie || "",
            milnikId: "", budova: u.budova || "", patro: u.patro || "",
            prirazeni: Array.isArray(u.prirazeni) ? u.prirazeni.slice() : [],
            termin: termin, stav: "otevreny", todo: todo, historie: [],
            poznamka: u.poznamka || "",
            opakovani: u.opakovani, opakovaniDen: den,
            opakovaniKoren: String(u.opakovaniKoren || u.id), opakovanyZ: u.id,
            createdMs: ted, createdBy: kdo || "", updatedMs: ted, updatedBy: kdo || ""
        }
    };
}

/** Další Quick TO-DO opakované řady: { id, data } nebo null. */
function nasledovnikQuick(q, ted) {
    if (!q || !q.id || !jeOpakovani(q.opakovani)) return null;
    const den = denRady(q, q.doKdy);
    const doKdy = dalsiTermin(q.doKdy, q.opakovani, den);
    if (!doKdy) return null;
    const komu = (Array.isArray(q.proUids) && q.proUids.length) ? q.proUids.slice()
        : (q.proUid ? [q.proUid] : []);
    return {
        id: idNasledovnika(q, doKdy),
        // odkazy „#" v textu a druh vzkazu jdou s textem i do další kopie
        data: Object.assign(Array.isArray(q.odkazy) && q.odkazy.length ? { odkazy: q.odkazy } : {},
            "druh" in q ? { druh: q.druh } : {}, {
            text: q.text || "", proUids: komu, proUid: komu[0] || "",
            odKoho: q.odKoho || "", odKohoJmeno: q.odKohoJmeno || "",
            doKdy: doKdy, asap: false, projekt: q.projekt || "",
            rezim: q.rezim === "kazdy" ? "kazdy" : "",
            hotoviUids: [], hotovo: false, hotovoKdo: "", hotovoMs: 0,
            poznamka: q.poznamka || "", hlidka: "", ms: ted,
            opakovani: q.opakovani, opakovaniDen: den,
            opakovaniKoren: String(q.opakovaniKoren || q.id), opakovanyZ: q.id
        })
    };
}
/* OPAKOVANI-KONEC */

KB.OPAKOVANI_POPIS = OPAKOVANI_POPIS;
KB.dalsiTerminOpakovani = dalsiTermin;
KB.todoVseHotovo = todoVseHotovo;

/* Kopie, které se právě zakládají – druhé kolo hlídky (snapshot přijde
   dřív, než se na starý záznam zapíše `nasledovnikId`) je přeskočí. */
const zakladaNasledovnika = new Set();

/**
 * Další úkol opakované řady po splnění. Zakládá ho MANAŽER – úkoly smí
 * zakládat jen on (spodní pravidlo pro `private`) a zaměstnanec smí na
 * úkolu měnit jen `todo` a `stav`. Když úkol odškrtne zaměstnanec, kopii
 * založí prohlížeč nejbližšího manažera, který má otevřené úkoly všech
 * (nástěnka, Úkoly, Správa) – hlídka níž. Idempotentní: pevné id kopie
 * a kontrola v databázi, pak `nasledovnikId` na starém úkolu.
 * @returns {Promise<string>} id kopie, nebo "" (nic se nezaložilo)
 */
KB.zalozDalsiUkol = async (u) => {
    if (authReady) await authReady;
    if (!db || !u || u.stav !== "hotovo" || u.nasledovnikId || !jsemManazer()) return "";
    const n = nasledovnikUkolu(u, Date.now(), window.KB_USER || "");
    if (!n || zakladaNasledovnika.has(n.id)) return "";
    zakladaNasledovnika.add(n.id);
    try {
        const snap = await getDoc(ukolDoc(n.id));
        if (!snap.exists()) {
            await setDoc(ukolDoc(n.id), n.data);
            KB.zapisAktivitu("ukol", "založil další opakovaný úkol " + n.data.nazev +
                " (termín " + n.data.termin + ")", "Systém");
        }
        await setDoc(ukolDoc(u.id), { nasledovnikId: n.id }, { merge: true });
        return n.id;
    } finally {
        zakladaNasledovnika.delete(n.id);
    }
};

/** Hlídka opakovaných úkolů – běží u manažera nad tím, co má načtené. */
function hlidkaOpakovaniUkolu() {
    if (!db || !auth || !auth.currentUser || !jsemManazer()) return;
    (KB.ukoly || []).forEach(u => {
        if (!u.opakovani || u.stav !== "hotovo" || u.nasledovnikId) return;
        KB.zalozDalsiUkol(u).catch(err => console.warn("Další opakovaný úkol se nezaložil:", err));
    });
}
// role přijde se seznamem lidí – úkoly můžou dorazit dřív
KB.on("users", hlidkaOpakovaniUkolu);

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
        hlidkaOpakovaniUkolu();
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
    /* Odhad Celkem jen u úkolu bez skutečného rozpadu (viz bezOdhaduCelkem) –
       platí pro Správu, Úkoly i import, ať se to nehlídá na třech místech. */
    const todo = bezOdhaduCelkem(Array.isArray(data.todo) ? data.todo : []);
    /* Pole, která se zapisují JEN když je volající posílá. Úprava úkolu
       ve Správě nebo v Úkolech je nezná a dřív by je merge přepsal na
       prázdno – úkol z milníku tak po úpravě přišel o `milnikId`
       a potvrzení milníku by ho pak nenašlo. */
    const jenKdyzJsou = {};
    /* Z jakého milníku harmonogramu úkol vznikl. U VZT se práce nedělí
       po patrech, ale po milnících – jeden milník = jeden úkol, a podle
       tohohle pole se pozná, který už svůj úkol má, aby nevznikl dvakrát
       (Michal 9. 10. 2026). Nový úkol bez něj dostane prázdné. */
    if ("milnikId" in data) jenKdyzJsou.milnikId = data.milnikId || "";
    if ("opakovani" in data) jenKdyzJsou.opakovani = jeOpakovani(data.opakovani) ? data.opakovani : "";
    if ("opakovaniDen" in data) jenKdyzJsou.opakovaniDen = Number(data.opakovaniDen) || 0;
    /* Úkol vrácený do práce (KB.vratUkol) má TO-DO pořád na 100 % – úprava
       zadání ho nesmí sama přepnout zpátky na hotový. Hotovým se stane, až
       ho zpracovatel znovu označí (nebo až se TO-DO změní). */
    const pred = (KB.ukoly || []).find(u => u.id === id) || null;
    const vracenyBezZmeny = !!pred && pred.stav !== "hotovo" && !!pred.vraceno &&
        todoVseHotovo(Array.isArray(pred.todo) ? pred.todo : []);
    const stav = todoVseHotovo(todo) && !vracenyBezZmeny ? "hotovo" : (data.stav || "otevreny");
    await setDoc(ukolDoc(id), Object.assign({
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
        /* Všechna TO-DO na 100 % = úkol je hotový a čeká na potvrzení
           manažerem (pravidlo „sám se přepne", rešerše 19. 10. 2026). */
        stav:      stav,
        todo:      todo,
        poznamka:  data.poznamka || "",
        createdMs: data.createdMs || Date.now(),
        createdBy: data.createdBy || window.KB_USER || "",
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, jenKdyzJsou), { merge: true });
    KB.zapisAktivitu("ukol", "uložil úkol " + (data.nazev || "") +
        (data.projekt ? " (" + data.projekt + ")" : ""));
    // úkol se právě stal hotovým (a nepotvrzeným) → push potvrzovatelům
    if (stav === "hotovo" && pred && pred.stav !== "hotovo" && pred.potvrzeno !== true) {
        KB.ohlasPotvrzeni({ udalost: "ceka", druh: "ukoly", id: id, uid: KB.currentUid() });
    }
    return id;
};

/**
 * Hromadné přidání (nebo odebrání) člověka k úkolům – třeba ke všem VZT
 * úkolům projektu naráz (Michal 15. 9. 2026).
 *
 * Sahá se JEN na `prirazeni`, a to přes arrayUnion / arrayRemove. Kdyby se
 * přepisoval celý úkol, smazala by se procenta TO-DO, která mezitím někdo
 * zapsal, a ostatní přiřazení lidé by se přepsali starou kopií. Do aktivit
 * jde jeden řádek, ne dvacet.
 */
KB.hromadnePrirazeni = async (ids, uid, pridat, popis) => {
    if (authReady) await authReady;
    requireDb();
    if (!uid || !Array.isArray(ids) || !ids.length) return 0;
    let hotovo = 0;
    for (const id of ids) {
        await setDoc(ukolDoc(id), {
            prirazeni: pridat ? arrayUnion(uid) : arrayRemove(uid),
            updatedMs: Date.now(),
            updatedBy: window.KB_USER || ""
        }, { merge: true });
        hotovo++;
    }
    KB.zapisAktivitu("ukol", popis ||
        ((pridat ? "hromadně přidal člověka k úkolům (" : "hromadně odebral člověka z úkolů (") + hotovo + ")"));
    return hotovo;
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
    // žadatel podle stavu PŘED zápisem – potvrzení přepíše updatedBy
    const zadatel = zadatelUkolu(KB.ukoly.find(u => u.id === id));
    await setDoc(ukolDoc(id), {
        potvrzeno: true,
        potvrdil: window.KB_USER || "",
        potvrzenoMs: Date.now(),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    const ukol = KB.ukoly.find(u => u.id === id);
    KB.zapisAktivitu("ukol", "potvrdil hotový úkol" + (ukol ? " " + ukol.nazev : ""));
    // push tomu, kdo úkol dokončil (Michal 3. 11. 2026)
    KB.ohlasPotvrzeni({ udalost: "potvrzeno", druh: "ukoly", id: id, uid: zadatel });
};

/**
 * Kdo úkol označil hotový (žadatel potvrzení). Zaměstnanec smí do úkolu psát
 * jen todo/stav/historii, takže uid dokončení v úkolu neleží – bere se
 * poslední, kdo úkol měnil (`updatedBy`), nebo poslední zápis historie,
 * pokud je to přiřazený člověk; jinak první přiřazený. "" = nevíme.
 */
function zadatelUkolu(u) {
    if (!u) return "";
    const lide = (Array.isArray(u.prirazeni) ? u.prirazeni : []).filter(Boolean);
    const h = Array.isArray(u.historie) && u.historie.length ? u.historie[u.historie.length - 1] : null;
    for (const jmeno of [u.updatedBy, h && h.kdo]) {
        const uid = uidPodleJmena(jmeno);
        if (uid && (!lide.length || lide.indexOf(uid) !== -1)) return uid;
    }
    return lide[0] || "";
}

/**
 * Odmítnutí hotového úkolu = vrácení do práce (Michal 3. 11. 2026): stav zpět
 * na rozpracovaný, `vraceno { kdo, ms, duvod }` a řádek v historii úkolu.
 * TO-DO zůstávají, jak jsou – zpracovatel úkol po opravě znovu označí hotový
 * (Označit hotové / TO-DO) a jde to na potvrzení znovu. Přiřazení dostanou
 * oznámení (Quick TO-DO) s důvodem, žadatel navíc push. Vrátit cizí hotový
 * úkol smí jen ten, kdo úkoly potvrzuje (firestore.rules, ukolVraci).
 */
KB.vratUkol = async (id, duvod) => {
    if (authReady) await authReady;
    requireDb();
    const text = cistyDuvod(duvod);
    if (!id || !text) throw new Error("Chybí důvod vrácení.");
    let u = (KB.ukoly || []).find(x => x.id === id) || null;
    if (!u) {
        const snap = await getDoc(ukolDoc(id));
        u = snap.exists() ? Object.assign({ id: id }, snap.data()) : null;
    }
    if (!u) throw new Error("Úkol už neexistuje.");
    const zadatel = zadatelUkolu(u);
    const kdo = window.KB_USER || "";
    const ted = Date.now();
    const pct = window.KBVYK && window.KBVYK.pctUkolu ? (Number(window.KBVYK.pctUkolu(u)) || 0) : 100;
    const stara = Array.isArray(u.historie) ? u.historie : [];
    await setDoc(ukolDoc(id), Object.assign({
        stav: "otevreny",
        vraceno: { kdo: kdo, ms: ted, duvod: text },
        historie: stara.concat([{ ms: ted, kdo: kdo, text: ("vráceno do práce – " + text).slice(0, 120),
            z: pct, na: pct }]).slice(-80),
        updatedMs: ted,
        updatedBy: kdo
    }, u.potvrzeno === true ? { potvrzeno: false } : {}), { merge: true });
    KB.zapisAktivitu("ukol", "vrátil do práce úkol " + (u.nazev || id) + " – " + text);
    const ja = KB.currentUid();
    const komu = [zadatel].concat(Array.isArray(u.prirazeni) ? u.prirazeni : [])
        .filter((x, i, a) => x && x !== ja && a.indexOf(x) === i);
    if (komu.length) {
        const n = String(u.nazev || "úkol").replace(/\s+/g, " ").trim().slice(0, 120);
        await KB.saveQuickTodo(KB.newQuickId(), {
            text: "Úkol #" + n + " vrácen do práce: " + text,
            proUids: komu, projekt: u.projekt || "",
            odkazy: [{ t: "u", id: id, n: n }],
            druh: "info", rezim: "kazdy"          // oznámení – bere se na vědomí
        }).catch(err => console.warn("Oznámení o vrácení úkolu neodešlo:", err));
    }
    KB.ohlasPotvrzeni({ udalost: "zamitnuto", druh: "ukoly", id: id, uid: zadatel });
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
    /* Všechna zapnutá TO-DO na 100 % → úkol se sám přepne na hotový, tedy
       „čeká na potvrzení" manažerem (dřív se to značilo ručně tlačítkem
       Označit hotové). Hlídá se tady, ať to platí odkudkoliv se píše. */
    if (todoVseHotovo(payload.todo)) stav = "hotovo";
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
    /* Úkol se právě stal hotovým a čeká na potvrzení → push těm, kdo úkoly
       potvrzují (Michal 3. 11. 2026). Už hotový nebo potvrzený ne. */
    if (payload.stav === "hotovo" && !(ukol && (ukol.stav === "hotovo" || ukol.potvrzeno === true))) {
        KB.ohlasPotvrzeni({ udalost: "ceka", druh: "ukoly", id: id, uid: KB.currentUid() });
    }
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
    // popisek volna jednotně z ui.js (Michal 13. 11. 2026)
    const DRUH = { dovolena: "dovolenou", volno: window.KBUI.nazevAbsence("Volno").toLowerCase(), neplacene: "neplacené volno",
        nemoc: "nemoc", skoleni: "školení" };
    KB.zapisAktivitu("kalendar", "potvrdil " + (DRUH[(u || {}).typ] || "dovolenou") +
        (u ? " – " + (u.osoba || "?") + " (" + (u.od || "") +
            (u.do && u.do !== u.od ? " až " + u.do : "") + ")" : ""));
    // push žadateli (Michal 3. 11. 2026)
    KB.ohlasPotvrzeni({ udalost: "potvrzeno", druh: "nepritomnosti", id: id, uid: (u && u.uid) || "" });
};

/* ------------------------------------- upozornění na potvrzování ----
   Michal 3. 11. 2026 (Iris): „Čeká na tvé potvrzení" chodí HNED – po uložení
   žádosti o nepřítomnost (KB.saveUdalost), po označení úkolu hotovým
   (KB.ulozUkolPostup, KB.saveUkol) a po odškrtnutí milníku, které čeká na
   potvrzení (KB.ulozSplneniMilniku). Po potvrzení (KB.potvrdDovolenou,
   KB.potvrdUkol, KB.potvrdMilnik) a zamítnutí (KB.zamitniDovolenou,
   KB.vratUkol, KB.vratMilnik) se ohlásí žadateli. Rozesílá Apps Script
   (`meta/gsync`, akce "potvrzeni") stejnou cestou jako KB.ohlasZpravu:

     { akce: "potvrzeni", token, udalost: "ceka" | "potvrzeno" | "zamitnuto",
       druh: "nepritomnosti" | "ukoly" | "milniky", id, uid }

   `id` = dokument (kalendář / private/ukoly/seznam / private/milniky/seznam),
   `uid` = žadatel. Skript z těla nic nevěří: text si přečte z databáze sám,
   příjemce „čeká" určí z private/potvrzovani (+ hlavní správce, bez
   volajícího), u potvrzeno / zamítnuto pošle žadateli. Odkazy v upozornění:
   kalendar.html?udalost=, ukoly.html?otevri=, milniky.html?id=.
   Bez čekání na odpověď – uložení nikdy neblokuje, chyby jen do konzole. */
const UDALOSTI_POTVRZENI = ["ceka", "potvrzeno", "zamitnuto", "pripraveno"];
const DRUHY_OHLASU = ["nepritomnosti", "ukoly", "milniky"];
KB.ohlasPotvrzeni = async (volby) => {
    try {
        const o = volby || {};
        if (!KB.gsyncUrl || UDALOSTI_POTVRZENI.indexOf(o.udalost) === -1 ||
            DRUHY_OHLASU.indexOf(o.druh) === -1 || !o.id) return;
        await poOdeslani();
        let token = "";
        try { token = await auth.currentUser.getIdToken(); } catch (err) { /* bez tokenu skript nic nepošle */ }
        fetch(KB.gsyncUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ akce: "potvrzeni", token: token, udalost: o.udalost, druh: o.druh,
                id: String(o.id), uid: String(o.uid || "") })
        }).catch(err => console.warn("Upozornění na potvrzení se neozvalo:", err));
    } catch (err) { console.warn("Upozornění na potvrzení se neodeslalo:", err); }
};

/** uid člověka podle celého jména (tak ho píše KB_USER do hotovoKdo, updatedBy…) nebo e-mailu. */
function uidPodleJmena(jmeno) {
    const t = String(jmeno || "").trim().toLowerCase();
    if (!t) return "";
    const u = (KB.users || []).find(x =>
        ((x.first || "") + " " + (x.last || "")).trim().toLowerCase() === t ||
        String(x.email || "").toLowerCase() === t);
    return u ? u.id : "";
}

/** Důvod odmítnutí: jeden řádek, nejvýš 300 znaků (vejde se do oznámení). */
const cistyDuvod = (duvod) => String(duvod || "").replace(/\s+/g, " ").trim().slice(0, 300);

/** „10. 11." / „10.–12. 11." / „28. 10.–3. 11." – rozsah do oznámení. */
function rozsahKratce(od, doKdy) {
    const c = (iso) => String(iso || "").split("-").map(Number);
    const [r1, m1, d1] = c(od);
    if (!d1) return "";
    if (!doKdy || doKdy === od) return d1 + ". " + m1 + ".";
    const [r2, m2, d2] = c(doKdy);
    if (!d2) return d1 + ". " + m1 + ".";
    return r1 === r2 && m1 === m2
        ? d1 + ".–" + d2 + ". " + m2 + "."
        : d1 + ". " + m1 + ".–" + d2 + ". " + m2 + ".";
}

/* Nepřítomnosti, které se potvrzují, a jak se jmenuje jejich zakázka ve výkazu
   (vykazy.html, TYP_ABSENCE). Jinde (index.html POTVRZOVANE) stejné tři druhy. */
const NEPRITOMNOST_ZAKAZKA = { dovolena: "Dovolená", volno: "Volno", neplacene: "Neplacené volno" };
const NEPRITOMNOST_NEBYLA = { dovolena: "nebyla potvrzena", volno: "nebylo potvrzeno",
    neplacene: "nebylo potvrzeno" };

/**
 * Zamítnutí nepřítomnosti (Michal 3. 11. 2026). Událost v kalendáři zůstane –
 * přeškrtnutá, se štítkem „zamítnuto" a důvodem (`zamitnuto, zamitl,
 * zamitnutoMs, duvod`) – a v přehledech nepřítomností se nepočítá. Záznamy
 * výkazu té absence se smažou (i s částkou), nic jiného. Žadatel dostane
 * oznámení (Quick TO-DO) a push. Smí jen ten, kdo nepřítomnosti potvrzuje
 * (firestore.rules: `zamitnuto` z ne na ano jen smiPotvrdit).
 *
 * Vazba události na výkaz (vykazy.html, planKalendareAbsenci): Rychlý zápis
 * (`zdroj: "panel"`) = jeden záznam `vykazId`; z výkazu (`zdroj: "vykaz"`) =
 * záznamy téhož člověka se zakázkou té absence ve dnech od–do, mimo záznamy
 * Rychlého zápisu (ty mají vlastní události). Dny se hledají dotazem jen
 * na `datum` (jednopolový index, žádný složený) a člověk se filtruje tady.
 * @returns {Promise<number>} kolik záznamů výkazu se smazalo
 */
KB.zamitniDovolenou = async (id, duvod) => {
    if (authReady) await authReady;
    requireDb();
    const text = cistyDuvod(duvod);
    if (!id || !text) throw new Error("Chybí důvod zamítnutí.");
    let u = (KB.kalendar || []).find(x => x.id === id) || null;
    if (!u) {
        const snap = await getDoc(kalendarDoc(id));
        u = snap.exists() ? Object.assign({ id: id }, snap.data()) : null;
    }
    if (!u) throw new Error("Událost už v kalendáři není.");
    const kdo = window.KB_USER || "";
    const ted = Date.now();
    await setDoc(kalendarDoc(id), {
        zamitnuto: true, zamitl: kdo, zamitnutoMs: ted, duvod: text,
        potvrzeno: false, updatedMs: ted, updatedBy: kdo
    }, { merge: true });

    // záznamy výkazu té absence
    const zakazka = NEPRITOMNOST_ZAKAZKA[u.typ] || "";
    const patri = (z) => !!z && z.uid === u.uid && String(z.zakazka || "").trim() === zakazka;
    const smazat = new Set();
    if (zakazka && u.uid) {
        if (u.vykazId) {
            const snap = await getDoc(vykazDoc(u.vykazId)).catch(() => null);
            if (snap && snap.exists() && patri(snap.data())) smazat.add(u.vykazId);
        }
        if (u.zdroj === "vykaz" && u.od) {
            const snap = await getDocs(query(vykazyCol(),
                where("datum", ">=", u.od), where("datum", "<=", u.do || u.od)));
            snap.forEach(d => {
                const z = d.data() || {};
                if (patri(z) && z.zdroj !== "panel") smazat.add(d.id);
            });
        }
    }
    const idcka = Array.from(smazat);
    for (let i = 0; i < idcka.length; i += 200) {          // záznam = dva zápisy, dávka unese 500
        const davka = writeBatch(db);
        idcka.slice(i, i + 200).forEach(zid => {
            davka.delete(vykazDoc(zid));
            davka.delete(castkaDoc(zid));
        });
        await davka.commit();
    }

    const nazev = window.KBUI.nazevAbsence(zakazka) || "Nepřítomnost";
    const kdy = rozsahKratce(u.od, u.do);
    const KOHO = { dovolena: "dovolenou", volno: window.KBUI.nazevAbsence("Volno").toLowerCase(),
        neplacene: "neplacené volno" };
    KB.zapisAktivitu("kalendar", "zamítl " + (KOHO[u.typ] || "nepřítomnost") + " – " + (u.osoba || "?") +
        (kdy ? " (" + kdy + ")" : "") + (idcka.length ? ", smazáno záznamů výkazu: " + idcka.length : "") +
        " – " + text);
    if (u.uid && u.uid !== KB.currentUid()) {
        await KB.saveQuickTodo(KB.newQuickId(), {
            text: nazev + (kdy ? " " + kdy : "") + " " + (NEPRITOMNOST_NEBYLA[u.typ] || "nebyla potvrzena") +
                ": " + text,
            proUids: [u.uid],
            druh: "info", rezim: "kazdy"          // oznámení – bere se na vědomí
        }).catch(err => console.warn("Oznámení o zamítnutí neodešlo:", err));
    }
    KB.ohlasPotvrzeni({ udalost: "zamitnuto", druh: "nepritomnosti", id: id, uid: u.uid || "" });
    return idcka.length;
};

/* ---------------------------------------------- kdo co potvrzuje ----
   Michal 3. 11. 2026 (model A, „tvrdě"): v Nastavení → Potvrzování se
   u každého druhu zaškrtne, kteří manažeři ho potvrzují – stejně pro
   všechny lidi, žádný „nadřízený u člověka". Prázdný seznam (nebo
   chybějící dokument) = platí dřívější stav, potvrdí kdokoli s právem
   vykaz.view. Vyplněný = jen zaškrtnutí a hlavní správce – a hlídá to
   i databáze (firestore.rules, funkce smiPotvrdit).

     private/potvrzovani/nastaveni/hlavni
       { druhy: { nepritomnosti: { lide: [uid…] }, ukoly: { lide },
                  milniky: { lide }, zpetne: { lide } }, updatedMs, updatedBy }

   Čte každý člen (stránky podle toho ukazují tlačítko, nebo „Potvrzuje:
   …"), zapisuje jen hlavní správce. Klíče druhů jsou PEVNÉ – čte je
   i dlaždice „Čeká na tvé rozhodnutí" na nástěnce. Odběr se zakládá
   s ostatními společnými odběry po přihlášení (sledujPotvrzovani). */
/* POTVRZOVANI-STORE-ZACATEK */
// pripraveno = komu přijde upozornění „milník připravený k odevzdání" (nic se tím nepotvrzuje)
KB.DRUHY_POTVRZENI = ["nepritomnosti", "ukoly", "milniky", "zpetne", "pripraveno"];
/** null = dokument ještě nedorazil (platí dřívější stav). */
KB.potvrzovani = null;

/** Dokument v jednotném tvaru: každý druh má pole `lide` (jen neprázdná uid, bez opakování). */
function cistePotvrzovani(data) {
    const druhy = {};
    KB.DRUHY_POTVRZENI.forEach(klic => {
        const d = data && data.druhy && typeof data.druhy === "object" ? data.druhy[klic] : null;
        const lide = d && Array.isArray(d.lide) ? d.lide : [];
        druhy[klic] = { lide: lide.filter((uid, i) => typeof uid === "string" && uid && lide.indexOf(uid) === i) };
    });
    return {
        druhy: druhy,
        updatedMs: Number(data && data.updatedMs) || 0,
        updatedBy: String((data && data.updatedBy) || "")
    };
}
/* POTVRZOVANI-STORE-KONEC */

const potvrzovaniDoc = () => doc(db, "artifacts", APP_ID, "private", "potvrzovani", "nastaveni", "hlavni");

/** Odběr nastavení potvrzování – vrací funkci, která ho zruší (patří do `odbery`). */
function sledujPotvrzovani() {
    return onSnapshot(potvrzovaniDoc(), (snap) => {
        KB.potvrzovani = cistePotvrzovani(snap.exists() ? snap.data() : null);
        emit("potvrzovani", KB.potvrzovani);
    }, (err) => {
        /* Dokud nejsou nasazená pravidla, čte ho jen manažer – ostatním
           tiše platí dřívější stav (KB.potvrzovani zůstává null). */
        console.warn("Nastavení potvrzování se nenačetlo:", err && err.code ? err.code : err);
    });
}

/** Posluchač změn; když už data jsou, zavolá se hned. */
KB.watchPotvrzovani = (cb) => {
    if (typeof cb !== "function") return;
    KB.on("potvrzovani", (event) => cb(event.detail));
    if (KB.potvrzovani) cb(KB.potvrzovani);
};

/** Uložení z Nastavení (jen hlavní správce). `druhy` = { klíč: { lide: [uid] } }; chybějící druh = nikdo. */
KB.ulozPotvrzovani = async (druhy) => {
    if (authReady) await authReady;
    requireDb();
    const cista = cistePotvrzovani({ druhy: druhy || {} }).druhy;
    await setDoc(potvrzovaniDoc(), {
        druhy: cista,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    });
    KB.zapisAktivitu("nastaveni", "změnil, kdo co potvrzuje (" +
        KB.DRUHY_POTVRZENI.map(k => k + " " + cista[k].lide.length).join(", ") + ")");
};

KB.saveUdalost = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    const uid = data.uid || KB.currentUid();
    // jak událost vypadala před uložením (upozornění „čeká na potvrzení", zamítnutí)
    const pred = (KB.kalendar || []).find(x => x.id === id) || null;
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
        /* Zkrácená dovolená si potvrzení nese dál – u nově založené části
           (rozdělená dovolená) i s tím, kdo ji potvrdil (22. 9. 2026). */
        ...(data.potvrzeno === true && data.potvrdil
            ? { potvrdil: data.potvrdil, potvrzenoMs: data.potvrzenoMs || Date.now() } : {}),
        /* Odkud se potvrzení převzalo (id potvrzené události téhož člověka).
           Když nepřítomnosti potvrzují jen určení, pustí databáze převzaté
           potvrzení jen s tímhle odkazem (firestore.rules, kalendarPrevzato). */
        ...(data.potvrzeno === true && data.potvrzenoZ ? { potvrzenoZ: String(data.potvrzenoZ) } : {}),
        /* Přeuložení zamítnuté žádosti (oprava v kalendáři) = žádost znovu:
           zamítnutí se zruší a jde to na potvrzení od začátku. */
        ...(pred && pred.zamitnuto === true
            ? { zamitnuto: deleteField(), zamitl: deleteField(), zamitnutoMs: deleteField(), duvod: deleteField() }
            : {}),
        createdMs: data.createdMs || Date.now(),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    /* Rychlý zápis (HO, volno, dovolená z pásu) se v Reportu má poznat
       na první pohled – „uložil událost homeoffice" nikomu nic neřekne
       (přání Michala 1. 9. 2026). */
    const NAZEV_TYPU = { homeoffice: "home office", volno: window.KBUI.nazevAbsence("Volno").toLowerCase(),
                         neplacene: "neplacené volno",
                         dovolena: "dovolenou", doktor: "doktora",
                         nemoc: "nemoc", skoleni: "školení" };
    const nazev = NAZEV_TYPU[data.typ] || (data.typ || "událost");
    const rozsah = (data.od || "") + (data.do && data.do !== data.od ? "–" + data.do : "");
    KB.zapisAktivitu("kalendar", (data.zdroj === "panel"
            ? "nahlásil v Rychlém zápisu " + nazev
            : "uložil do kalendáře " + nazev) +
        (rozsah ? " na " + rozsah : "") + (data.osoba ? " – " + data.osoba : ""));
    /* Nová (nebo změněná) žádost o nepřítomnost, která čeká na potvrzení →
       push těm, kdo nepřítomnosti potvrzují. Jednou za událost – vícedenní
       dovolená z výkazu je jedna událost přes celý rozsah. Přeuložení beze
       změny dnů a druhu (oprava textu, převzaté potvrzení) nic neposílá. */
    const typ = data.typ || "udalost";
    const od = data.od || "", doKdy = data.do || data.od || "";
    if (data.potvrzeno !== true && NEPRITOMNOST_ZAKAZKA[typ] &&
        (!pred || pred.potvrzeno === true || pred.zamitnuto === true || pred.typ !== typ ||
         (pred.od || "") !== od || (pred.do || pred.od || "") !== doKdy)) {
        KB.ohlasPotvrzeni({ udalost: "ceka", druh: "nepritomnosti", id: id, uid: uid });
    }
    return id;
};

KB.deleteUdalost = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const u = (KB.kalendar || []).find(x => x.id === id);
    await deleteDoc(kalendarDoc(id));
    KB.zapisAktivitu("kalendar", "smazal událost " + (u ? window.KBUI.nazevTypuUdalosti(u.typ || "", u.typ || "").toLowerCase() + " " +
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

/* ------------------------------------------------------ role u odběrů ---
   Některé odběry se rozhodují podle role: manažer čte celou kolekci, ostatní
   jen svoje. Role se ale pozná ze seznamu lidí a ten dorazí až po přihlášení.
   Kdo se zeptal dřív, dostal dotaz pro členy a cizí data mu chyběla celou
   relaci – takhle 25. 9. zmizely nezveřejněné porady a 1. 10. všechny
   nastavené dovolené v Nastavení. Proto se čeká. */

const MANAZERSKE_ROLE = ["hlavni-spravce", "majitel", "spravce", "asistentka"];

function jsemManazer() {
    const ja = (KB.users || []).find(u => u.id === ((auth && auth.currentUser) || {}).uid);
    return !!ja && MANAZERSKE_ROLE.indexOf(ja.role) !== -1;
}

/** true = role ještě není známá, odběr se odloží a zavolá se znovu. */
function pockejNaRoli(znovu) {
    if ((KB.users || []).length) return false;
    const az = () => { KB.off("users", az); znovu(); };
    KB.on("users", az);
    return true;
}

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
/* Živý odběr drží 14 dní. Starší týdny a celý přehled jednoho člověka se
   dotahují na vyžádání a drží se stranou – odběr si `KB.postupy` přepisuje
   čerstvými daty a dotažené by z nich jinak zmizely (Michal 25. 9. 2026). */
let postupyZive = [];
let postupyNavic = [];

function slijPostupy() {
    const mapa = new Map();
    postupyNavic.forEach(z => mapa.set(z.id, z));
    postupyZive.forEach(z => mapa.set(z.id, z));       // živé mají přednost
    KB.postupy = Array.from(mapa.values());
}

/** Manažer vidí cizí postupy, ostatní jen svoje (pravidla nejsou filtr). */
const postupManazer = jsemManazer;

KB.postupId = (uid, datum) => uid + "_" + datum;

/** Posledních 14 dní: manažer všechny, ostatní jen sebe (víc pravidla nedají). */
KB.watchPostupy = async () => {
    if (postupOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || postupOdber) return;
    if (pockejNaRoli(KB.watchPostupy)) return;
    const od = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    KB.postupyOknoOd = od;
    const dotaz = postupManazer()
        ? query(postupCol(), where("datum", ">=", od))
        : query(postupCol(), where("uid", "==", auth.currentUser.uid));
    postupOdber = onSnapshot(dotaz, (snap) => {
        postupyZive = [];
        snap.forEach(d => postupyZive.push({ id: d.id, ...d.data() }));
        slijPostupy();
        emit("postupy", null);
    }, (err) => console.error("Chyba čtení postupu:", err));
};

/**
 * Dotáhne postupy za období (pro listování přehledu po týdnech dozadu).
 * Vrací počet záznamů. Jednorázový dotaz, žádný další odběr – starší
 * týdny se nemění a platit za jejich hlídání nemá smysl.
 */
KB.nactiPostupyRozsah = async (od, doKdy) => {
    if (authReady) await authReady;
    requireDb();
    const zacatek = String(od || "").slice(0, 10);
    const konec = String(doKdy || "9999-12-31").slice(0, 10);
    if (!zacatek) return 0;
    const meze = [where("datum", ">=", zacatek), where("datum", "<=", konec)];
    const dotaz = postupManazer()
        ? query(postupCol(), ...meze)
        : query(postupCol(), where("uid", "==", auth.currentUser.uid), ...meze);
    const snap = await getDocs(dotaz);
    const nove = [];
    snap.forEach(d => nove.push({ id: d.id, ...d.data() }));
    const znam = new Set(postupyNavic.map(z => z.id));
    nove.forEach(z => { if (!znam.has(z.id)) postupyNavic.push(z); });
    slijPostupy();
    emit("postupy", null);
    return nove.length;
};

/** Všechny postupy jednoho člověka – podklad pro jeho celkový přehled. */
KB.nactiPostupyCloveka = async (uid) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(query(postupCol(), where("uid", "==", uid)));
    const ven = [];
    snap.forEach(d => ven.push({ id: d.id, ...d.data() }));
    const znam = new Set(postupyNavic.map(z => z.id));
    ven.forEach(z => { if (!znam.has(z.id)) postupyNavic.push(z); });
    slijPostupy();
    emit("postupy", null);
    return ven.sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
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

/* ---------------------------------------------------- info k zakázkám ---
   Poznámky z terénu k zakázkám, i nadiktované z telefonu (Michal 12. 11. 2026, Iris).

     private/infozakazky/zaznamy/{iz_…}  { uid, jmeno, text, projektId, projektNazev,
                                           autoPrirazeno, lide, odkud, vyrizeno, vyrizenoKdo,
                                           vyrizenoMs, createdMs, ms, upravilUid, upravilJmeno }
     private/infozakazky/klice/{otisk}   { uid, jmeno, ms, kdo } – klíč zkratky v telefonu

   `lide` = autor + lidé zakázky: člen čte jedním dotazem array-contains svoje
   i sdílené (pravidla nejsou filtr), manažer celou kolekci. Klíč zkratky se
   nikde neukládá, jen jeho otisk SHA-256 – Apps Script podle něj pozná autora. */

const infoCol = () => collection(db, "artifacts", APP_ID, "private", "infozakazky", "zaznamy");
const infoDoc = (id) => doc(db, "artifacts", APP_ID, "private", "infozakazky", "zaznamy", id);
const kliceCol = () => collection(db, "artifacts", APP_ID, "private", "infozakazky", "klice");
const klicDoc = (otisk) => doc(db, "artifacts", APP_ID, "private", "infozakazky", "klice", otisk);
const INFO_TEXT_MAX = 4000;

KB.infozakazky = [];
let infoOdber = null;

KB.watchInfozakazky = async () => {
    if (infoOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || infoOdber) return;
    if (pockejNaRoli(KB.watchInfozakazky)) return;
    const dotaz = jsemManazer()
        ? infoCol()
        : query(infoCol(), where("lide", "array-contains", auth.currentUser.uid));
    infoOdber = onSnapshot(dotaz, (snap) => {
        KB.infozakazky = [];
        snap.forEach(d => KB.infozakazky.push({ id: d.id, ...d.data() }));
        emit("infozakazky", KB.infozakazky);
    }, (err) => console.error("Chyba čtení Info k zakázkám:", err));
};

KB.newInfoId = () => "iz_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

/** Kdo poznámku uvidí: autor + lidé zakázky (z KB.projektyDocs), bez opakování. */
KB.lideInfo = (projektId, autorUid) => {
    const p = projektId ? (KB.projektyDocs || []).find(x => x.id === projektId) : null;
    const ven = autorUid ? [autorUid] : [];
    ((p && Array.isArray(p.lide)) ? p.lide : []).forEach(u => { if (u && ven.indexOf(u) === -1) ven.push(u); });
    return ven;
};

const infoNazevProjektu = (projektId) =>
    String(((projektId && (KB.projektyDocs || []).find(x => x.id === projektId)) || {}).nazev || "");

/** Nová poznámka z webu. Vrací id. */
KB.pridejInfo = async ({ text, projektId, autoPrirazeno } = {}) => {
    if (authReady) await authReady;
    requireDb();
    const t = String(text || "").trim().slice(0, INFO_TEXT_MAX);
    if (!t) throw new Error("Prázdný text poznámky.");
    const uid = KB.currentUid();
    const pid = String(projektId || "");
    const nazev = infoNazevProjektu(pid);
    const ted = Date.now();
    const id = KB.newInfoId();
    await setDoc(infoDoc(id), {
        uid: uid,
        jmeno: window.KB_USER || "",
        text: t,
        projektId: pid,
        projektNazev: nazev,
        autoPrirazeno: !!pid && autoPrirazeno === true,
        lide: KB.lideInfo(pid, uid),
        odkud: "web",
        vyrizeno: false,
        vyrizenoKdo: "",
        vyrizenoMs: 0,
        createdMs: ted,
        ms: ted
    });
    KB.zapisAktivitu("info", "zapsal info k zakázce " + (nazev || "nezařazeno") + ": " + t.slice(0, 120));
    return id;
};

/** Ruční přiřazení zakázky ("" = Nezařazeno); lidé se přepočítají, autor zůstává. */
KB.priradInfo = async (id, projektId) => {
    if (authReady) await authReady;
    requireDb();
    let z = (KB.infozakazky || []).find(x => x.id === id);
    if (!z) { const s = await getDoc(infoDoc(id)); z = s.exists() ? s.data() : null; }
    if (!z) throw new Error("Poznámka nenalezena.");
    const pid = String(projektId || "");
    // updateDoc, ne merge celého dokumentu – pravidla hlídají, která pole se mění
    await updateDoc(infoDoc(id), {
        projektId: pid,
        projektNazev: infoNazevProjektu(pid),
        autoPrirazeno: false,
        lide: KB.lideInfo(pid, z.uid),
        ms: Date.now()
    });
};

/** Úprava textu – pravidla ji pustí jen autorovi (a manažerovi). */
KB.upravInfoText = async (id, text) => {
    if (authReady) await authReady;
    requireDb();
    const t = String(text || "").trim().slice(0, INFO_TEXT_MAX);
    if (!t) throw new Error("Prázdný text poznámky.");
    await updateDoc(infoDoc(id), {
        text: t,
        upravilUid: KB.currentUid(),
        upravilJmeno: window.KB_USER || "",
        ms: Date.now()
    });
};

/** Vyřízeno (ano = true) / vrátit mezi nevyřízené (ano = false). */
KB.vyridInfo = async (id, ano) => {
    if (authReady) await authReady;
    requireDb();
    const ted = Date.now();
    await updateDoc(infoDoc(id), {
        vyrizeno: !!ano,
        vyrizenoKdo: ano ? (window.KB_USER || "") : "",
        vyrizenoMs: ano ? ted : 0,
        ms: ted
    });
};

/* Klíč zkratky v telefonu: zkratka iPhonu nemá přihlášení Firebase, tak se
   Apps Scriptu prokazuje klíčem. Ukáže se jen jednou (vrací ho vydejKlicZkratky),
   v databázi je jen otisk. Bez zkreslení: 256 je násobek 32 znaků abecedy. */
const KLIC_ABECEDA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function otiskKlice(klic) {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(klic));
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function smazKliceCloveka(uid) {
    const snap = await getDocs(query(kliceCol(), where("uid", "==", uid)));
    const ids = [];
    snap.forEach(d => ids.push(d.id));
    for (const id of ids) await deleteDoc(klicDoc(id));
    return ids.length;
}

/** Vydá nový klíč (dřívější přestane platit). Vrací klíč – ukázat jen jednou. */
KB.vydejKlicZkratky = async (uid, jmeno) => {
    if (authReady) await authReady;
    requireDb();
    if (!uid || typeof uid !== "string") throw new Error("Chybí člověk.");
    const bajty = crypto.getRandomValues(new Uint8Array(26));
    const klic = Array.from(bajty).map(b => KLIC_ABECEDA[b % KLIC_ABECEDA.length]).join("");
    const otisk = await otiskKlice(klic);
    await smazKliceCloveka(uid);
    await setDoc(klicDoc(otisk), { uid: uid, jmeno: String(jmeno || ""), ms: Date.now(), kdo: window.KB_USER || "" });
    KB.zapisAktivitu("info", "vydal klíč pro zkratku v telefonu: " + String(jmeno || uid));
    return klic;
};

/** Zruší klíč člověka. Vrací počet smazaných. */
KB.zrusKlicZkratky = async (uid) => {
    if (authReady) await authReady;
    requireDb();
    if (!uid || typeof uid !== "string") return 0;
    const n = await smazKliceCloveka(uid);
    if (n) KB.zapisAktivitu("info", "zrušil klíč pro zkratku v telefonu");
    return n;
};

/* Nastavit telefon (Michal 13. 11. 2026): vlastní zkratku iPhonu podepsat
   nejde, takže se sdílí jedna hotová odkazem na iCloud a klíč si do ní každý
   vloží sám při přidání. Adresa leží v `public/data/meta/zkratka`
   { url, ms, kdo } – čte ji každý člen, zapisuje jen hlavní správce. */
const ZKRATKA_URL_TVAR = /^https:\/\/www\.icloud\.com\/shortcuts\/[A-Za-z0-9]{8,64}\/?$/;
KB.zkratkaUrl = "";             // odkaz na sdílenou zkratku z meta/zkratka ("" = nenastavený)

/** Uloží odkaz na zkratku; prázdný řetězec ho zruší. Pustí jen hlavního správce (pravidla). */
KB.ulozZkratkuUrl = async (url) => {
    if (authReady) await authReady;
    requireDb();
    const u = String(url || "").trim();
    if (u && !ZKRATKA_URL_TVAR.test(u)) throw new Error("Odkaz musí být sdílená zkratka z iCloudu.");
    await setDoc(metaDoc("zkratka"), {
        url: u,
        ms: Date.now(),
        kdo: window.KB_USER || ""
    }, { merge: true });
};

/** Vlastní klíč – vydá si ho každý sám pro sebe. Vrací klíč, ukázat jen jednou. */
KB.vytvorMujKlicZkratky = async () => {
    if (authReady) await authReady;
    const uid = KB.currentUid();
    if (!uid) throw new Error("Nejsi přihlášený.");
    // stejný zápis jako u hlavního správce, jen pro sebe (`kdo` je taky on)
    return KB.vydejKlicZkratky(uid, window.KB_USER || "");
};

/** Můj klíč: { ms, kdo } | null. Jeden dotaz – člen přečte jen svoje klíče. */
KB.mamKlicZkratky = async () => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    if (!uid) return null;
    const snap = await getDocs(query(kliceCol(), where("uid", "==", uid)));
    let ven = null;
    snap.forEach(d => {
        const k = d.data() || {};
        if (!ven || (k.ms || 0) > ven.ms) ven = { ms: k.ms || 0, kdo: k.kdo || "" };
    });
    return ven;
};

/** Kdo má klíč: { [uid]: { ms, kdo } } (jednorázově, nejnovější vyhrává). */
KB.nactiKliceZkratky = async () => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(kliceCol());
    const ven = {};
    snap.forEach(d => {
        const k = d.data() || {};
        if (!k.uid || (ven[k.uid] && ven[k.uid].ms >= (k.ms || 0))) return;
        ven[k.uid] = { ms: k.ms || 0, kdo: k.kdo || "" };
    });
    return ven;
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
     private/plany/soubory/{id}/znacky/{zid}
       { x, y, tvar, w, h, uhel, stav, vel, pruh, text, pozn, kdo, uid, ms } */

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

/* Plán patří k zakázce (Michal 13. 11. 2026, Iris, varianta B): hlavička nese
   `projektId, projektNazev, budova, patro, lide, uid`. `lide` = autor + lidé
   zakázky (stejně jako Info k zakázkám, KB.lideInfo) – člen čte jen plány, kde
   je v `lide`, a plány bez zakázky (`projektId == ""`); manažer všechno.
   Pravidla nejsou filtr, proto má člen dva dotazy a slévají se podle id. */
KB.watchPlany = async () => {
    if (planyOdbery.length) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || planyOdbery.length) return;
    if (pockejNaRoli(KB.watchPlany)) return;
    planyOdbery.push(onSnapshot(planySlozkyCol(), (snap) => {
        KB.planySlozky = [];
        snap.forEach(d => KB.planySlozky.push({ id: d.id, ...d.data() }));
        KB.planySlozky.sort((a, b) => (a.nazev || "").localeCompare(b.nazev || "", "cs"));
        emit("plany", null);
    }, (err) => console.error("Chyba čtení složek plánů:", err)));
    const dotazy = jsemManazer() ? [planyCol()] : [
        query(planyCol(), where("lide", "array-contains", auth.currentUser.uid)),
        query(planyCol(), where("projektId", "==", ""))
    ];
    const casti = dotazy.map(() => []);
    dotazy.forEach((dotaz, i) => planyOdbery.push(onSnapshot(dotaz, (snap) => {
        casti[i] = [];
        snap.forEach(d => casti[i].push({ id: d.id, ...d.data() }));
        const podleId = new Map();
        casti.forEach(c => c.forEach(f => podleId.set(f.id, f)));
        KB.planySoubory = Array.from(podleId.values());
        KB.planySoubory.sort((a, b) => (b.ms || 0) - (a.ms || 0));
        emit("plany", null);
    }, (err) => console.error("Chyba čtení plánů:", err))));
};

/** Zakázka, budova a patro plánu (+ kdo ho vidí). Mění manažer – hlídají pravidla. */
KB.ulozPlanZarazeni = async (planId, z) => {
    if (authReady) await authReady;
    requireDb();
    const plan = (KB.planySoubory || []).find(f => f.id === planId) || {};
    const pid = String((z && z.projektId) || "");
    const zmena = {
        projektId: pid,
        projektNazev: infoNazevProjektu(pid),
        budova: String((z && z.budova) || "").trim().slice(0, 40),
        patro: String((z && z.patro) || "").trim().slice(0, 40),
        lide: pid ? KB.lideInfo(pid, plan.uid || "") : []
    };
    if (z && z.nazev) zmena.nazev = String(z.nazev).trim().slice(0, 120);
    await updateDoc(planDoc(planId), zmena);
};

/** Srovná `lide` plánů s lidmi jejich zakázek (po změně party v projektu).
    Volá manažerská stránka Plánů; zapisuje jen to, co se opravdu liší. */
KB.srovnejLidiPlanu = async () => {
    if (!jsemManazer()) return 0;
    let n = 0;
    for (const f of (KB.planySoubory || [])) {
        /* plán z doby před zakázkami nemá pole vůbec – člen se ptá na
           `projektId == ""`, a to pole bez hodnoty nenajde */
        if (!("projektId" in f)) {
            await updateDoc(planDoc(f.id), { projektId: "", lide: [] });
            n++;
            continue;
        }
        if (!f.projektId || !(KB.projektyDocs || []).some(p => p.id === f.projektId)) continue;
        const maji = KB.lideInfo(f.projektId, f.uid || "");
        const ted = Array.isArray(f.lide) ? f.lide : [];
        if (maji.length === ted.length && maji.every(u => ted.indexOf(u) !== -1)) continue;
        await updateDoc(planDoc(f.id), { lide: maji });
        n++;
    }
    return n;
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
    const pid = String(meta.projektId || "");
    const uid = KB.currentUid();
    await setDoc(planDoc(id), {
        nazev: String(meta.nazev || "Plán").slice(0, 120),
        slozka: pid ? "" : (meta.slozka || ""),
        // zakázka, budova, patro – podle nich se plán řadí a kdo ho vidí
        projektId: pid,
        projektNazev: infoNazevProjektu(pid),
        budova: String(meta.budova || "").trim().slice(0, 40),
        patro: String(meta.patro || "").trim().slice(0, 40),
        lide: pid ? KB.lideInfo(pid, uid) : [],
        uid: uid,
        sirka: Number(meta.sirka) || 0,
        vyska: Number(meta.vyska) || 0,
        kousku: kousku,
        dlazScale: Number(meta.dlazScale) || 0,
        dlazT: Number(meta.dlazT) || 0,
        dlazdic: dlazdice.length,
        // karta v seznamu – jen malý JPEG z canvasu, nic jiného (jde do <img src>)
        miniatura: miniaturaPlanu(meta.miniatura),
        ms: Date.now(),
        kdo: window.KB_USER || ""
    });
    KB.zapisAktivitu("navod", "nahrál plán " + (meta.nazev || ""));
    return id;
};

const miniaturaPlanu = (url) =>
    (typeof url === "string" && /^data:image\/jpeg;base64,/.test(url) && url.length < 120000) ? url : "";

/** Miniatura dodatečně (plán nahraný dřív, než karty měly obrázek). Pravidla
    ji pustí jen manažerovi – člen u hlavičky mění jen paletu a hladiny. */
KB.ulozPlanMiniaturu = async (planId, url) => {
    if (authReady) await authReady;
    requireDb();
    const m = miniaturaPlanu(url);
    if (m) await updateDoc(planDoc(planId), { miniatura: m });
};

/** Přejmenování plánu nebo složky (manažer – hlídají pravidla). */
KB.prejmenujPlan = async (druh, id, nazev) => {
    if (authReady) await authReady;
    requireDb();
    const n = String(nazev || "").trim();
    if (!n) return;
    await updateDoc(druh === "plan" ? planDoc(id) : planySlozkaDoc(id),
        { nazev: n.slice(0, druh === "plan" ? 120 : 80) });
};

/** Vrstva plánu z PC nástroje (`vrstvy/mistnosti` = obrysy místností z GDB
    a převod do S-JTSK, NASTROJE\web\plany_z_gdb). Vrací objekt, nebo null. */
KB.nactiPlanVrstvu = async (planId, druh) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDoc(doc(db, "artifacts", APP_ID, "private", "plany", "soubory", planId, "vrstvy", druh));
    if (!snap.exists()) return null;
    try { return JSON.parse((snap.data() || {}).data || "null"); } catch (err) { return null; }
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

/* ----------------------------------------------------- fotky v BPH ---
   Přehled, kolik fotek leží v BPH u které místnosti a technologie.
   Data vznikají mimo web (sken složky s fotkami) a nahrávají se sem
   hotová jedním souborem – nedá se to poskládat z toho, co web ví.

   Uloží se jako JEDEN text, ne jako 1 073 dokumentů: nikdo se v tom
   nedotazuje, stránka si vždycky vezme celý přehled a přebere si ho
   sama. Dlouhý text se krájí na kousky stejně jako obrázky plánů.

   Schválně pod `private/` – na webu je to za přihlášením a stejně tak
   to má být i v databázi. Do veřejného repozitáře ta data nepatří.

     private/fotkybph/meta/prehled     { kousku, ms, kdo, datum, datumSkenu }
     private/fotkybph/kousky/{n}       { data }                              */

const FOTKY_KOUSEK = 300000;     // znaků na dokument (limit dokumentu je 1 MB)
const fotkyMetaDoc = () => doc(db, "artifacts", APP_ID, "private", "fotkybph", "meta", "prehled");
const fotkyKouskyCol = () => collection(db, "artifacts", APP_ID, "private", "fotkybph", "kousky");
const fotkyKousek = (n) => doc(db, "artifacts", APP_ID, "private", "fotkybph", "kousky", String(n));

/** Celý přehled. Vrací `null`, když ještě nikdo nic nenahrál. */
KB.nactiFotkyBph = async () => {
    if (authReady) await authReady;
    requireDb();
    const meta = await getDoc(fotkyMetaDoc());
    if (!meta.exists()) return null;
    const hlavicka = meta.data() || {};
    const snap = await getDocs(fotkyKouskyCol());
    const kousky = [];
    snap.forEach(d => { kousky[Number(d.id)] = (d.data() || {}).data || ""; });
    const text = kousky.slice(0, Number(hlavicka.kousku) || kousky.length).join("");
    if (!text) return null;
    try {
        const data = JSON.parse(text);
        data.ms = hlavicka.ms || 0;
        data.kdo = hlavicka.kdo || "";
        return data;
    } catch (err) {
        return null;
    }
};

/**
 * Nahraje nový přehled. Starší kousky se musí smazat – kdyby byl nový
 * přehled kratší, zbytek toho starého by se připojil na konec a JSON
 * by se nerozebral.
 */
KB.ulozFotkyBph = async (data, hlaseni) => {
    if (authReady) await authReady;
    requireDb();
    const text = JSON.stringify(data);
    const kousku = Math.max(1, Math.ceil(text.length / FOTKY_KOUSEK));

    const stare = await getDocs(fotkyKouskyCol());
    for (const d of stare.docs) {
        if (Number(d.id) >= kousku) await deleteDoc(d.ref);
    }
    for (let n = 0; n < kousku; n++) {
        if (hlaseni) hlaseni("Ukládám část " + (n + 1) + "/" + kousku + "…");
        await setDoc(fotkyKousek(n), { data: text.slice(n * FOTKY_KOUSEK, (n + 1) * FOTKY_KOUSEK) });
    }
    await setDoc(fotkyMetaDoc(), {
        kousku: kousku,
        znaku: text.length,
        datum: String(data.datum || "").slice(0, 40),
        datumSkenu: String(data.datum_skenu || "").slice(0, 40),
        ms: Date.now(),
        kdo: window.KB_USER || ""
    });
    KB.zapisAktivitu("navod", "nahrál přehled fotek v BPH");
    return kousku;
};

/* --------------------------------------------------- POKLADNA ----------
   Hotovost v kanceláři: co přišlo, co se vydalo a komu. Vede ji asistentka,
   koukají do ní manažeři – proto sedí pod `private/`, kam pravidla pouštějí
   jen je. Zvláštní pravidlo tedy nepotřebuje.

     private/pokladna/zaznamy/{id}
       { datum:"2026-09-01", text, prijem, vydej, kategorie, uid, jmeno,
         kdo, ms, updatedMs, updatedBy,
         historie:[{ ms, kdo, uid, z:{prijem,vydej}, na:{prijem,vydej} }] }
       (historie jen po opravě částky – Michal 12. 11. 2026)

   `prijem` a `vydej` jsou dvě pole, ne jedna částka se znaménkem – přesně
   jako v papírové knize. Sčítá se pak bez přemýšlení nad znaménky a nedá
   se omylem zapsat záporný výdaj.

   Zůstatek se NIKDE neukládá: dopočítá se z celé knihy. Uložený by se
   po první opravě staršího řádku rozešel s realitou. */

const pokladnaCol = () => collection(db, "artifacts", APP_ID, "private", "pokladna", "zaznamy");
const pokladnaDoc = (id) => doc(db, "artifacts", APP_ID, "private", "pokladna", "zaznamy", id);

KB.pokladna = [];
let pokladnaOdber = null;

KB.watchPokladna = async () => {
    if (pokladnaOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || pokladnaOdber) return;
    pokladnaOdber = onSnapshot(pokladnaCol(), (snap) => {
        KB.pokladna = [];
        snap.forEach(d => KB.pokladna.push({ id: d.id, ...d.data() }));
        // nejnovější nahoře; ve stejný den drží pořadí zápisu
        KB.pokladna.sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || ""))
            || (b.ms || 0) - (a.ms || 0));
        emit("pokladna", KB.pokladna);
    }, (err) => console.error("Chyba čtení pokladny:", err));
};

KB.newPokladnaId = () => "pk_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

KB.ulozPokladnu = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    const pid = id || KB.newPokladnaId();
    const zaznam = {
        datum: String(data.datum || "").slice(0, 10),
        text: String(data.text || "").slice(0, 200),
        /* Záporná částka nedává v knize smysl – co je moc, patří na druhou
           stranu. Proto se obojí ořízne na nulu. */
        prijem: Math.max(0, Math.round((Number(data.prijem) || 0) * 100) / 100),
        vydej: Math.max(0, Math.round((Number(data.vydej) || 0) * 100) / 100),
        kategorie: String(data.kategorie || "ostatni").slice(0, 20),
        // koho se výdaj týká (oběd, jízdenka, papíry) – nepovinné
        uid: String(data.uid || "").slice(0, 60),
        jmeno: String(data.jmeno || "").slice(0, 60),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    };
    if (!id) {
        zaznam.kdo = window.KB_USER || "";
        zaznam.ms = data.ms || Date.now();
    } else {
        /* Oprava zápisu místo smazat a zapsat znovu (Michal 12. 11. 2026).
           Změněná částka se připíše do `historie` – kniha musí jít zpětně
           odsouhlasit a má být vidět, kdo a z čeho ji opravil. arrayUnion,
           ať se dva souběžné opravy nepřepíšou. V aktivitě částka není:
           aktivitu vidí i lidé bez práva na finance. */
        const stary = (KB.pokladna || []).find(x => x.id === id);
        const z = stary && { prijem: Number(stary.prijem) || 0, vydej: Number(stary.vydej) || 0 };
        if (z && (z.prijem !== zaznam.prijem || z.vydej !== zaznam.vydej)) {
            zaznam.historie = arrayUnion({
                ms: Date.now(), kdo: window.KB_USER || "",
                uid: (auth && auth.currentUser && auth.currentUser.uid) || "",
                z: z, na: { prijem: zaznam.prijem, vydej: zaznam.vydej }
            });
            KB.zapisAktivitu("pokladna", "opravil částku v pokladně " +
                (stary.datum || "") + " – " + (stary.text || ""));
        }
    }
    await setDoc(pokladnaDoc(pid), zaznam, { merge: true });
    return pid;
};

KB.smazPokladnu = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const z = (KB.pokladna || []).find(x => x.id === id);
    KB.zapisAktivitu("pokladna", "smazal z pokladny " +
        ((z && z.datum + " – " + (z.text || "")) || id));
    await deleteDoc(pokladnaDoc(id));
};

/* ------------------------------------------- UPOZORNĚNÍ NA E-MAIL -------
   Co komu chodí mimo web. Nastavení je osobní: čte a mění ho vlastník,
   manažer ho vidí (ať se dá poradit, proč někomu nic nechodí), ale
   rozesílku samotnou dělá Apps Script – web je jen stránka v prohlížeči
   a odesílat poštu neumí.

     private/upozorneni/lide/{uid}   { zapnuto, volby:{klic:true}, ms }
   Stejný dokument nese i nastavení Vlastní nástěnky (`nastenka`,
   KB.ulozNastenku) – čte se tímhle odběrem, druhý se nezakládá. */

const upozDoc = (uid) => doc(db, "artifacts", APP_ID, "private", "upozorneni", "lide", uid);

KB.upozorneni = null;
let upozOdber = null;

/* Stav rozesílání – otisk posledního běhu Apps Scriptu. Leží ve veřejné
   části, takže ho vidí každý; nastavení samotné zůstává osobní. */
KB.upozorneniStav = null;
let upozStavOdber = null;

KB.watchUpozorneniStav = async () => {
    if (upozStavOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || upozStavOdber) return;
    upozStavOdber = onSnapshot(metaDoc("upozorneni"), (d) => {
        KB.upozorneniStav = d.exists() ? d.data() : null;
        emit("upozorneni-stav", KB.upozorneniStav);
    }, (err) => console.error("Chyba čtení stavu rozesílání:", err));
};

KB.watchUpozorneni = async () => {
    if (upozOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || upozOdber) return;
    upozOdber = onSnapshot(upozDoc(auth.currentUser.uid), (d) => {
        KB.upozorneni = d.exists() ? d.data() : null;
        emit("upozorneni", KB.upozorneni);
    }, (err) => console.error("Chyba čtení upozornění:", err));
};

KB.ulozUpozorneni = async (data) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    if (!uid) throw new Error("Není kdo ukládá.");
    const volby = {};
    Object.keys(data.volby || {}).slice(0, 40).forEach(k => {
        volby[String(k).slice(0, 40)] = (data.volby || {})[k] === true;
    });
    await setDoc(upozDoc(uid), {
        zapnuto: data.zapnuto !== false,
        volby: volby,
        /* E-mail se sem opisuje schválně: rozesílací skript pak nemusí
           sahat do seznamu lidí a stačí mu jedna kolekce. */
        email: (KB.users.find(u => u.id === uid) || {}).email || "",
        jmeno: window.KB_USER || "",
        ms: Date.now()
    }, { merge: true });
};


/* Upozornění do mobilu přes ntfy (stránka Upozornění). `tema` = tajný
   název tématu na ntfy.sh – kdo ho zná, čte; prázdné = vypnuto.
   `ostatni` = posílat do mobilu i krátké ohlášení k e-mailům (výchozí ano).
   Ukládá se jen to, co v datech je – `zapnuto` ani `volby` e-mailů se
   nemění. Rozesílá Apps Script (gas/Upozorneni.gs). */
KB.ulozNtfy = async (data) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    if (!uid) throw new Error("Není kdo ukládá.");
    const zapis = { ntfyMs: Date.now() };
    if ("tema" in data) {
        const tema = String(data.tema || "");
        if (tema && !/^[A-Za-z0-9_-]{12,64}$/.test(tema)) throw new Error("Neplatné téma.");
        zapis.ntfyTema = tema;
    }
    if ("ostatni" in data) zapis.ntfyOstatni = data.ostatni !== false;
    await setDoc(upozDoc(uid), zapis, { merge: true });
};

/* Vlastní nástěnka (Michal 3. 11. 2026): které dlaždice manažer ve třetím
   režimu nástěnky vidí, v jaké barvě a v jakém pořadí. Leží ve stejném
   osobním dokumentu jako upozornění – píše si ho každý sám (pravidla
   `upozorneni/lide/{uid}` beze změny) a čte ho KB.watchUpozorneni, takže
   nastavení platí na všech zařízeních. Zapisuje se jen pole `nastenka`,
   e-mailové volby ani zařízení se nemění.
     nastenka: { dlazdice: { <id>: { zap, barva: "#rrggbb" | "", poradi } }, sloupce: 2 | 3 | 4, updatedMs }
   Id jen ve tvaru id dlaždice (w + písmena a číslice, nejvýš 40), barva jen
   #rrggbb přes KBUI.barva – které id stránka opravdu použije, hlídá ještě
   nástěnka sama (bere jen dlaždice, které na ní jsou). */
KB.ulozNastenku = async (nastaveni) => {
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    if (!uid) throw new Error("Není kdo ukládá.");
    const vstup = nastaveni && nastaveni.dlazdice && typeof nastaveni.dlazdice === "object"
        ? nastaveni.dlazdice : {};
    const dlazdice = {};
    Object.keys(vstup).slice(0, 40).forEach(id => {
        if (!/^w[A-Za-z0-9]{1,40}$/.test(id)) return;
        const d = vstup[id] && typeof vstup[id] === "object" ? vstup[id] : {};
        const barva = window.KBUI ? window.KBUI.barva(d.barva, "") : "";
        const zapis = { zap: d.zap !== false, barva: /^#[0-9a-f]{6}$/i.test(barva) ? barva.toLowerCase() : "" };
        if (typeof d.poradi === "number" && isFinite(d.poradi)) {
            zapis.poradi = Math.max(0, Math.min(99, Math.round(d.poradi)));
        }
        dlazdice[id] = zapis;
    });
    const nastenka = { dlazdice: dlazdice, updatedMs: Date.now() };
    // počet sloupců Vlastního režimu (3. 11. 2026) – jen 2, 3 nebo 4, cizí hodnota se zahodí
    const sloupce = nastaveni ? nastaveni.sloupce : null;
    if (sloupce === 2 || sloupce === 3 || sloupce === 4) nastenka.sloupce = sloupce;
    await setDoc(upozDoc(uid), { nastenka: nastenka }, { merge: true });
};

/** Zkušební pípnutí do mobilu PŘES Apps Script (ne z prohlížeče) – vrátí {ok, kod, chyba}.
    Ukáže, jestli ntfy.sh bere zprávy ze serverů Googlu, odkud chodí ohlášení zpráv. */
KB.zkouskaNtfyServer = () => zkouskaPresServer("ntfyZkouska");

/* Zkouška přes Apps Script – ntfy i upozornění z webu chodí stejnou cestou.
   Text/plain kvůli tomu, aby prohlížeč neposílal předlet (Apps Script ho neumí). */
async function zkouskaPresServer(akce) {
    if (authReady) await authReady;
    if (!KB.gsyncUrl) return { ok: false, chyba: "adresa skriptu není nastavená" };
    const token = await auth.currentUser.getIdToken();
    const odp = await fetch(KB.gsyncUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ akce: akce, token: token })
    });
    return await odp.json();
}

/** Přehled doručování do mobilu (zapisuje Apps Script, čte jen správce): řádky od nejnovějšího. */
KB.ntfyStav = async () => {
    if (authReady) await authReady;
    requireDb();
    const s = await getDoc(doc(db, "artifacts", APP_ID, "private", "upozorneni", "ntfy", "stav"));
    return s.exists() && Array.isArray(s.data().radky) ? s.data().radky : [];
};

/* ------------------------------------------- UPOZORNĚNÍ Z WEBU (FCM) -----
   Upozornění do mobilu a počítače přímo z webu přes Firebase Cloud
   Messaging – bez aplikace ntfy, kterou bezplatný ntfy.sh ze serverů Googlu
   nebere (250 zpráv denně na IP, Google ji sdílí → 429). ntfy zůstává jako
   záloha. Posílá Apps Script, web jen:
     • přihlásí zařízení k odběru a uloží jeho adresu (token FCM),
     • upozornění ukáže a po kliknutí otevře (sw.js, push a notificationclick).

     private/upozorneni/lide/{uid}
       push:   { "<zid>": { token, ms, zarizeni } }
       pushMs  kdy se seznam zařízení naposledy změnil
       ntfyOstatni  (už existuje) i krátká ohlášení k e-mailům – platí pro push i ntfy

   `zid` = id zařízení, které si vymyslí prohlížeč (z + 12 znaků a–z0–9)
   a pamatuje v localStorage – podle něj se pozná „toto zařízení“ a obnova
   přepíše jen svůj řádek. `zarizeni` je jen hrubý popis („Android · Chrome“),
   nic osobního. Neplatné tokeny maže Apps Script sám (smaže `push.<zid>`).
   Token se nepíše do konzole ani do aktivit.

   iPhone a iPad: upozornění z webu umí jen web přidaný na plochu (iOS 16.4+),
   v Safari samotném PushManager vůbec není. A Safari zahodí žádost
   o povolení, která nepřijde přímo z kliknutí – proto KB.pushZapnout NENÍ
   async a requestPermission zavolá dřív, než na cokoliv čeká. */
const PUSH_ZID_KLIC = "kb_push_zid";
const PUSH_OBNOVA_KLIC = "kb_push_obnova";
const PUSH_ZID_VZOR = /^z[a-z0-9]{12}$/;
const PUSH_OBNOVA_MS = 24 * 60 * 60 * 1000;
/* Adresa je složená schválně: sw.js si z textu skriptů vybírá celé adresy
   Firebase a ukládá je předem pro práci bez signálu. Messaging tam nepatří –
   stahuje se jen po kliknutí na Zapnout a při obnově tokenu. */
const PUSH_SDK = "https://www.gstatic.com/firebasejs/11.6.1/firebase-" + "messaging.js";

const PUSH_HLASKY = {
    nastaveni: "Upozornění z webu se teprve připravují.",
    "ios-plocha": "Na iPhonu a iPadu to jde jen z webu přidaného na plochu.",
    nepodporuje: "Tenhle prohlížeč upozornění z webu neumí.",
    zakazano: "Upozornění jsou pro tento web zakázaná. Povol je v nastavení prohlížeče nebo telefonu a zkus to znovu.",
    nepovoleno: "Upozornění jsi nepovolil. Zkus to znovu a v okně prohlížeče dej Povolit.",
    sw: "Web se ještě nenačetl celý. Obnov stránku a zkus to znovu.",
    sdk: "Nepodařilo se načíst část webu pro upozornění. Zkontroluj připojení a zkus to znovu.",
    token: "Prohlížeč nedostal adresu pro upozornění. Zkus to za chvíli znovu.",
    ulozeni: "Uložení se nepovedlo. Zkus to znovu."
};
function pushChyba(kod, navic) {
    const e = new Error(PUSH_HLASKY[kod] + (navic ? " (" + navic + ")" : ""));
    e.kod = kod;
    return e;
}

const ctiUloziste = (klic) => { try { return localStorage.getItem(klic) || ""; } catch (err) { return ""; } };
const zapisUloziste = (klic, hodnota) => {
    try { if (hodnota) localStorage.setItem(klic, hodnota); else localStorage.removeItem(klic); }
    catch (err) { /* úložiště nejde (anonymní okno) – zařízení se pozná jen do zavření */ }
};

const jeIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const jeZPlochy = () => navigator.standalone === true ||
    !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

/** Id tohoto zařízení, nebo "" (tady ještě nezapnuto, nebo odebráno). */
KB.pushMojeZid = () => {
    const zid = ctiUloziste(PUSH_ZID_KLIC);
    return PUSH_ZID_VZOR.test(zid) ? zid : "";
};

/** Nové id zařízení: „z“ + 12 znaků a–z0–9 bez zkreslení (252 = 7 × 36). */
function novaZid() {
    const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
    let zid = "z";
    while (zid.length < 13) {
        const bajty = new Uint8Array(16);
        crypto.getRandomValues(bajty);
        for (const b of bajty) if (b < 252 && zid.length < 13) zid += abc[b % 36];
    }
    return zid;
}

/** Hrubý popis zařízení do seznamu („iPhone · aplikace“, „PC · Chrome“) – nic osobního. */
function popisZarizeni() {
    const ua = navigator.userAgent || "";
    const typ = jeIos() ? (/iPhone|iPod/.test(ua) ? "iPhone" : "iPad")
        : /Android/i.test(ua) ? "Android"
        : /Macintosh|Mac OS X/.test(ua) ? "Mac" : "PC";
    const kde = jeZPlochy() ? "aplikace"
        : /Edg(A|iOS)?\//.test(ua) ? "Edge"
        : /OPR\//.test(ua) ? "Opera"
        : /SamsungBrowser/.test(ua) ? "Samsung"
        : /Firefox|FxiOS/.test(ua) ? "Firefox"
        : /Chrome|CriOS/.test(ua) ? "Chrome"
        : /Safari/.test(ua) ? "Safari" : "prohlížeč";
    return typ + " · " + kde;
}

/**
 * Umí tohle zařízení upozornění z webu? `duvod` říká stránce, co ukázat:
 *   "nastaveni"   chybí klíč PUSH_VAPID (teprve se připravuje),
 *   "ios-plocha"  iPhone/iPad v Safari – web se musí přidat na plochu,
 *   "nepodporuje" prohlížeč to neumí,
 *   "zakazano"    upozornění pro web jsou v prohlížeči / telefonu zakázaná.
 * iOS se kontroluje před podporou: v Safari mimo plochu PushManager chybí
 * a „neumí to“ by tam byla špatná rada.
 */
KB.pushPodpora = () => {
    if (!PUSH_VAPID) return { umi: false, duvod: "nastaveni" };
    if (jeIos() && !jeZPlochy()) return { umi: false, duvod: "ios-plocha" };
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator) ||
        typeof PushManager === "undefined") return { umi: false, duvod: "nepodporuje" };
    if (Notification.permission === "denied") return { umi: false, duvod: "zakazano" };
    return { umi: true, duvod: "" };
};

/** Zařízení přihlášeného člověka (bez tokenů – stránka je nepotřebuje): toto první, pak od nejnovějšího. */
KB.pushZarizeni = () => {
    const p = (KB.upozorneni && KB.upozorneni.push && typeof KB.upozorneni.push === "object")
        ? KB.upozorneni.push : {};
    const moje = KB.pushMojeZid();
    return Object.keys(p)
        .filter(zid => PUSH_ZID_VZOR.test(zid) && p[zid] && p[zid].token)
        .map(zid => ({ zid: zid, zarizeni: String(p[zid].zarizeni || ""), ms: Number(p[zid].ms) || 0, moje: zid === moje }))
        .sort((a, b) => (Number(b.moje) - Number(a.moje)) || (b.ms - a.ms));
};

/* Firebase Messaging až ve chvíli, kdy je potřeba. */
let pushSdk = null;
const nactiPushSdk = () => pushSdk ||
    (pushSdk = import(PUSH_SDK).catch(err => { pushSdk = null; throw err; }));

/** Registrace sw.js (ukazuje upozornění). Bez service workeru by se čekalo věčně. */
function pushRegistrace() {
    let casovac = null;
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, chyba) => { casovac = setTimeout(() => chyba(pushChyba("sw")), 15000); })
    ]).finally(() => clearTimeout(casovac));
}

/** Token FCM tohoto zařízení (odběr vznikne, když ještě není). */
async function ziskejPushToken() {
    const reg = await pushRegistrace();
    let fm;
    try { fm = await nactiPushSdk(); } catch (err) { throw pushChyba("sdk"); }
    if (!(await fm.isSupported())) throw pushChyba("nepodporuje");
    try {
        return await fm.getToken(fm.getMessaging(fbApp), { vapidKey: PUSH_VAPID, serviceWorkerRegistration: reg });
    } catch (err) {
        throw pushChyba("token", err && err.code);
    }
}

/* Hluboký merge přepíše jen řádek tohoto zařízení, ostatní zůstanou. */
const ulozPushToken = (uid, zid, token) => {
    const ted = Date.now();
    return setDoc(upozDoc(uid), {
        push: { [zid]: { token: String(token), ms: ted, zarizeni: popisZarizeni() } },
        pushMs: ted
    }, { merge: true });
};

/**
 * Zapnout upozornění na tomto zařízení → slib { ok, chyba } (česká hláška).
 * Stránka ho volá JAKO PRVNÍ příkaz v obsluze kliknutí: requestPermission
 * tu běží synchronně, až potom se na cokoliv čeká (viz iOS výš).
 */
KB.pushZapnout = () => {
    const podpora = KB.pushPodpora();
    if (!podpora.umi) return Promise.resolve({ ok: false, chyba: PUSH_HLASKY[podpora.duvod] });
    const povoleni = new Promise(hotovo => {
        // starší Safari umí jen zpětné volání, novější prohlížeče slib – vezme se, co přijde dřív
        const v = Notification.requestPermission(hotovo);
        if (v && typeof v.then === "function") v.then(hotovo, () => hotovo("default"));
    }).catch(() => "default");
    return dokonciPush(povoleni).then(() => ({ ok: true, chyba: "" }), (err) => {
        console.warn("Upozornění z webu se nezapnula:", (err && (err.kod || err.code)) || "chyba");
        return { ok: false, chyba: (err && err.kod) ? err.message
            : "Zapnutí se nepovedlo (" + ((err && (err.code || err.message)) || "chyba") + ")." };
    });
};

async function dokonciPush(povoleni) {
    const stav = await povoleni;
    if (stav !== "granted") throw pushChyba(stav === "denied" ? "zakazano" : "nepovoleno");
    if (authReady) await authReady;
    requireDb();
    const uid = KB.currentUid();
    const token = await ziskejPushToken();
    if (!token) throw pushChyba("token");
    const zid = KB.pushMojeZid() || novaZid();
    zapisUloziste(PUSH_ZID_KLIC, zid);
    try { await ulozPushToken(uid, zid, token); } catch (err) { throw pushChyba("ulozeni", err && err.code); }
    zapisUloziste(PUSH_OBNOVA_KLIC, String(Date.now()));     // token je čerstvý – obnova až za den
}

/** Odebrat zařízení ze seznamu. U tohoto zařízení i zrušit odběr v prohlížeči (chyby jen do konzole). */
KB.pushOdebrat = async (zid) => {
    zid = String(zid || "");
    if (!PUSH_ZID_VZOR.test(zid)) throw new Error("Neplatné zařízení.");
    if (authReady) await authReady;
    requireDb();
    await updateDoc(upozDoc(KB.currentUid()), { ["push." + zid]: deleteField(), pushMs: Date.now() });
    if (zid !== KB.pushMojeZid()) return;
    // zapomenout id – jinak by ho tady stránka dál měla za „toto zařízení“
    zapisUloziste(PUSH_ZID_KLIC, "");
    zapisUloziste(PUSH_OBNOVA_KLIC, "");
    if (!PUSH_VAPID || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
        const reg = await pushRegistrace();
        const fm = await nactiPushSdk();
        const m = fm.getMessaging(fbApp);
        /* getToken tu jen předá messagingu náš sw.js (token už je, vrátí ho
           z IndexedDB) – deleteToken by si jinak sám registroval
           firebase-messaging-sw.js, který na webu není. */
        await fm.getToken(m, { vapidKey: PUSH_VAPID, serviceWorkerRegistration: reg });
        await fm.deleteToken(m);
    } catch (err) {
        console.warn("Odběr upozornění v prohlížeči se nezrušil:", (err && (err.code || err.kod)) || "chyba");
    }
};

/** Zkušební upozornění přes Apps Script na všechna zařízení → { ok, zarizeni, doruceno, chyba }. */
KB.zkouskaPush = () => zkouskaPresServer("pushZkouska");

/* Obnova tokenu. Token FCM se časem mění (prohlížeč obnoví odběr, SDK ho
   po týdnu přegeneruje) a se starým by upozornění tiše přestala chodit.
   Po přihlášení se proto nejvýš jednou za den zeptá a změněný přepíše –
   jen tam, kde upozornění povolená jsou a zařízení pořád je v seznamu
   (odebrané odjinud se samo nevrací). Pár sekund po načtení, ať nezdržuje
   stránku; chyby jen do konzole. */
let pushObnovaNaplanovana = false;
function naplanujObnovuPush() {
    if (pushObnovaNaplanovana || !PUSH_VAPID) return;
    pushObnovaNaplanovana = true;
    setTimeout(() => {
        obnovPushToken().catch(err => console.warn("Obnova upozornění z webu se nepovedla:",
            (err && (err.kod || err.code)) || "chyba"));
    }, 4000);
}

async function obnovPushToken() {
    if (typeof Notification === "undefined" || Notification.permission !== "granted" ||
        !("serviceWorker" in navigator)) return;
    const zid = KB.pushMojeZid();
    if (!zid || Date.now() - (Number(ctiUloziste(PUSH_OBNOVA_KLIC)) || 0) < PUSH_OBNOVA_MS) return;
    const uid = KB.currentUid();
    if (!db || !uid) return;
    zapisUloziste(PUSH_OBNOVA_KLIC, String(Date.now()));     // i po chybě až zítra, ne na každé stránce
    const snap = await getDoc(upozDoc(uid));
    const ulozene = snap.exists() ? ((snap.data() || {}).push || {})[zid] : null;
    if (!ulozene) return;
    const token = await ziskejPushToken();
    if (token && token !== ulozene.token) await ulozPushToken(uid, zid, token);
}

/* ------------------------------------------- ZŮSTATKY DOVOLENÉ ----------
   Kolik komu zbývá dovolené a kolik má naběháno přesčasů. Web nemá
   historii z doby před sebou, takže se u každého člověka nastaví, OD KDY
   počítá a s čím do toho jde – nárok na rok, dny už vyčerpané a hodiny
   přesčasu. Bez toho by všichni začali na nule a čísla by lhala.

     private/vykazy/zustatky/{uid}
       { narok:20, cerpanoPred:5, prescasPred:12.5, odIso:"2026-09-01", pozn }

   Svůj zůstatek vidí každý – je to jeho nárok a má si ho hlídat. Cizí
   a zápis jen manažer (firestore.rules). */

const zustatekDoc = (uid) => doc(db, "artifacts", APP_ID, "private", "vykazy", "zustatky", uid);
const zustatkyCol = () => collection(db, "artifacts", APP_ID, "private", "vykazy", "zustatky");

KB.zustatky = {};               // uid -> nastavení
let zustatkyOdber = null;

/**
 * Manažer poslouchá zůstatky všech, ostatní jenom svůj – pravidla nejsou
 * filtr, dotaz na celou kolekci by zaměstnanci odmítla celý.
 */
KB.watchZustatky = async () => {
    if (zustatkyOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || zustatkyOdber) return;
    /* Bez téhle pojistky viděl manažer v Nastavení prázdné dovolené:
       odběr se zapnul dřív, než dorazil seznam lidí, takže si řekl jen
       o svůj vlastní zůstatek (Michal 1. 10. 2026). */
    if (pockejNaRoli(KB.watchZustatky)) return;
    const manazer = jsemManazer();
    const prijmi = (snap) => {
        KB.zustatky = {};
        snap.forEach(d => { KB.zustatky[d.id] = d.data(); });
        emit("zustatky", KB.zustatky);
    };
    zustatkyOdber = manazer
        ? onSnapshot(zustatkyCol(), prijmi,
            (err) => console.error("Chyba čtení zůstatků:", err))
        : onSnapshot(zustatekDoc(auth.currentUser.uid), (d) => {
            KB.zustatky = d.exists() ? { [d.id]: d.data() } : {};
            emit("zustatky", KB.zustatky);
        }, (err) => console.error("Chyba čtení zůstatku:", err));
};

KB.ulozZustatek = async (uid, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(zustatekDoc(uid), {
        narok: Math.max(0, Number(data.narok) || 0),
        cerpanoPred: Math.max(0, Number(data.cerpanoPred) || 0),
        prescasPred: Number(data.prescasPred) || 0,
        /* Komu se přesčas nevede (kancelář, vedení) – hodiny na web nepíše,
           tak by mu věčně svítil mínus ve výši celého fondu. Dovolenou má
           dál (Michal 8. 10. 2026). */
        bezPrescasu: data.bezPrescasu === true,
        odIso: String(data.odIso || "").slice(0, 10),
        pozn: String(data.pozn || "").slice(0, 200),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
};

/* ------------------------------------------------------------ VÝPLATY ----
   DPP, DPČ, OSVČ a student (Michal 3. 11. 2026, Iris): kolik komu za měsíc
   vychází, kolik se mu proplatilo a kolik zbývá. Jeden dokument na člověka
   a měsíc – stejné rozhraní čte Apps Script (sešit, sloupce U a V):

     private/vyplaty/mesice/{uid}_{RRRR-MM}
       { uid, mesic: "2026-10", typ: "dpp"|"dpc"|"osvc"|"student",
         hodiny, prace, obedy, km, skoleniPlacene,     // z výkazů (Kč, hodiny)
         bonusy: [{ kc, poznamka, kdo, ms }], bonusCelkem,
         narok,              // prace + obedy + km + skoleniPlacene + bonusCelkem
         prenos,             // zbyva předchozího měsíce (0 bez dokumentu)
         kVyplate,           // narok + prenos
         proplaceno: [{ kc, datum, kdo, poznamka, ms }], proplacenoCelkem,
         zbyva,              // kVyplate − proplacenoCelkem
         uzavreno: { ms, kdo } | null, odemknul: { ms, kdo } | null,
         spocitanoMs, spocitalKdo,
         poznamkaUcetni,     // text pro mzdovou účetní ≤ 300 (všichni, 12. 11. 2026)
         vyzva: { ms, kdo, komu, predmet } }   // výzva OSVČ k faktuře – píše jen Apps Script

     Zaměstnanec (HPP, 12. 11. 2026): typ "zamestnanec", navíc mzda (Kč z historie
     private/mzdy/lide k měsíci) a mzdaOd; narok = mzda + bonusCelkem; prace, obedy,
     km, skoleniPlacene = 0; hodiny = odpracované (V.vyplataMesice).

   Počítá stránka vyplaty.html (V.vyplataMesice ve vykazy.js). Čte finance
   (hlavní správce, majitel, asistentka), vlastník svoje (dotaz uid == já)
   a rozesílací účet; píše jen finance. Uzavřený měsíc (`uzavreno`) smí
   měnit a odemknout jen hlavní správce – a dokud je uzavřený, nikdo jiný
   nezmění ani zápisy a částky toho člověka v tom měsíci (firestore.rules,
   mesicOtevreny). */

const vyplatyCol = () => collection(db, "artifacts", APP_ID, "private", "vyplaty", "mesice");
const vyplataDoc = (id) => doc(db, "artifacts", APP_ID, "private", "vyplaty", "mesice", id);
const FINANCE_ROLE = ["hlavni-spravce", "majitel", "asistentka"];

KB.vyplaty = [];                // dokumenty měsíců (id = uid_RRRR-MM), nejnovější měsíc první
KB.vyplatyPrisly = false;
let vyplatyOdber = null;

/** Finance poslouchá všechny měsíce všech, ostatní jen svoje (pravidla nejsou filtr). */
KB.watchVyplaty = async () => {
    if (vyplatyOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || vyplatyOdber) return;
    if (pockejNaRoli(KB.watchVyplaty)) return;
    if (vyplatyOdber) return;
    const ja = (KB.users || []).find(u => u.id === auth.currentUser.uid);
    const finance = !!ja && ja.active !== false && FINANCE_ROLE.indexOf(ja.role) !== -1;
    const dotaz = finance ? vyplatyCol() : query(vyplatyCol(), where("uid", "==", auth.currentUser.uid));
    vyplatyOdber = onSnapshot(dotaz, (snap) => {
        KB.vyplaty = [];
        snap.forEach(d => KB.vyplaty.push(Object.assign({ id: d.id }, d.data())));
        KB.vyplaty.sort((a, b) => String(b.mesic || "").localeCompare(String(a.mesic || "")) ||
            String(a.uid || "").localeCompare(String(b.uid || "")));
        KB.vyplatyPrisly = true;
        emit("vyplaty", KB.vyplaty);
    }, (err) => {
        console.error("Chyba čtení výplat:", err);
        emit("vyplaty-chyba", err);
    });
};

/**
 * Uloží dokument měsíce (slučováním). `data` je buď objekt polí, nebo
 * funkce (starý dokument | null) → nová pole: ta běží v transakci, ať se
 * dvě proplacení nebo dva bonusy zapsané naráz nepřepíšou. Funkce může
 * vrátit null = nic neukládat. Po uložení se ohlásí Apps Scriptu
 * (KB.ohlasVyplatu – sešit). Vrací uložená pole (nebo null).
 */
KB.ulozVyplatu = async (uid, mesic, data) => {
    if (authReady) await authReady;
    requireDb();
    uid = String(uid || "");
    mesic = String(mesic || "");
    if (!uid || uid.indexOf("/") !== -1 || !/^\d{4}-\d{2}$/.test(mesic)) throw new Error("Neplatný měsíc výplaty.");
    const ref = vyplataDoc(uid + "_" + mesic);
    let ulozeno = null;
    if (typeof data === "function") {
        ulozeno = await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const nove = data(snap.exists() ? snap.data() : null);
            if (!nove) return null;
            const pole = Object.assign({}, nove, { uid: uid, mesic: mesic });
            if (pole.poznamkaUcetni !== undefined) pole.poznamkaUcetni = String(pole.poznamkaUcetni || "").slice(0, 300);
            tx.set(ref, pole, { merge: true });
            return pole;
        });
    } else if (data && typeof data === "object") {
        ulozeno = Object.assign({}, data, { uid: uid, mesic: mesic });
        if (ulozeno.poznamkaUcetni !== undefined) ulozeno.poznamkaUcetni = String(ulozeno.poznamkaUcetni || "").slice(0, 300);
        await setDoc(ref, ulozeno, { merge: true });
    }
    if (ulozeno) KB.ohlasVyplatu({ uid: uid, mesic: mesic });
    return ulozeno;
};

/**
 * Ohlášení změny výplaty Apps Scriptu – zapíše do osobního sešitu člověka
 * do měsíčního řádku sloupce U „Proplaceno“ a V „Zbývá“. Stejná cesta jako
 * KB.ohlasZpravu (`meta/gsync`): tělo { akce: "vyplata", token, uid, mesic },
 * skript z tokenu pozná, kdo volá, a čísla si přečte z dokumentu sám.
 * Bez čekání a bez čtení odpovědi – nikdy neblokuje ani neshodí uložení.
 */
KB.ohlasVyplatu = async (zprava) => {
    try {
        const uid = String((zprava && zprava.uid) || "");
        const mesic = String((zprava && zprava.mesic) || "");
        if (!KB.gsyncUrl || !uid || !/^\d{4}-\d{2}$/.test(mesic)) return;
        await poOdeslani();
        let token = "";
        try { token = await auth.currentUser.getIdToken(); } catch (err) { /* bez tokenu skript nic nezapíše */ }
        fetch(KB.gsyncUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ akce: "vyplata", token: token, uid: uid, mesic: mesic })
        }).catch(err => console.warn("Ohlášení výplaty se neozvalo:", err));
    } catch (err) { console.warn("Ohlášení výplaty se neodeslalo:", err); }
};

/**
 * Výzva OSVČ k faktuře (Michal 12. 11. 2026, Iris) – e-mail pošle Apps Script
 * (akce "vyzvaFaktura"; text z ciselniky/nastaveni.vyzvaFaktura, data z dokumentu
 * výplaty) a výsledek dopíše do dokumentu výplaty jako `vyzva: { ms, kdo, komu,
 * predmet }`. Odpověď se nečte. Vrací false, když nebylo kam poslat.
 */
KB.posliVyzvuFaktury = async (uid, mesic) => {
    try {
        uid = String(uid || "");
        mesic = String(mesic || "");
        if (!KB.gsyncUrl || !uid || uid.indexOf("/") !== -1 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mesic)) return false;
        await poOdeslani();
        let token = "";
        try { token = await auth.currentUser.getIdToken(); } catch (err) { /* bez tokenu skript výzvu neodešle */ }
        fetch(KB.gsyncUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ akce: "vyzvaFaktura", uid: uid, mesic: mesic, token: token })
        }).catch(err => console.warn("Výzva k faktuře se neozvala:", err));
        return true;
    } catch (err) {
        console.warn("Výzva k faktuře se neodeslala:", err);
        return false;
    }
};

/** Text výzvy k faktuře (finance) → ciselniky/nastaveni.vyzvaFaktura { predmet, text, updatedMs, updatedBy }. */
KB.ulozVyzvuText = async (sablona) => {
    if (authReady) await authReady;
    requireDb();
    if (FINANCE_ROLE.indexOf(mojeRole()) === -1) throw new Error("Text výzvy mění jen finance.");
    const s = sablona || {};
    const pole = { predmet: String(s.predmet || "").slice(0, 200), text: String(s.text || "").slice(0, 5000),
        updatedMs: Date.now(), updatedBy: window.KB_USER || "" };
    await setDoc(vykazyMeta(), { vyzvaFaktura: pole }, { merge: true });
    KB.vyzvaFaktura = pole;
    KB.zapisAktivitu("vykaz", "upravil text výzvy k faktuře");
    return pole;
};

/* ------------------------------------------- mzdy zaměstnanců (finance) ----
   Michal 12. 11. 2026 (Iris): měsíční mzda HPP s historií od měsíce.

     private/mzdy/lide/{uid}
       { historie: [{ od: "RRRR-MM", kc, ms, kdo }],   // seřazená podle `od`
         updatedMs, updatedBy }

   Platí poslední položka s od <= měsíc (V.mzdaProMesic). Čte a píše jen
   finance (hlavní správce, majitel, asistentka), maže hlavní správce;
   zaměstnanec svoji mzdu na webu nevidí (firestore.rules). */

const mzdyCol = () => collection(db, "artifacts", APP_ID, "private", "mzdy", "lide");
const mzdaDoc = (uid) => doc(db, "artifacts", APP_ID, "private", "mzdy", "lide", uid);

KB.mzdy = {};                   // uid → dokument mezd
KB.mzdyPrisly = false;
let mzdyOdber = null;

/** Jen finance – ostatním by pravidla odběr stejně odmítla, tak se ani neptá. */
KB.watchMzdy = async () => {
    if (mzdyOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || mzdyOdber) return;
    if (pockejNaRoli(KB.watchMzdy)) return;
    if (mzdyOdber || FINANCE_ROLE.indexOf(mojeRole()) === -1) return;
    mzdyOdber = onSnapshot(mzdyCol(), (snap) => {
        KB.mzdy = {};
        snap.forEach(d => { KB.mzdy[d.id] = d.data(); });
        KB.mzdyPrisly = true;
        emit("mzdy", KB.mzdy);
    }, (err) => {
        console.error("Chyba čtení mezd:", err);
        emit("mzdy-chyba", err);
    });
};

/**
 * Mzda od měsíce: přidá položku, nebo nahradí tu se stejným `od`; historie
 * seřazená podle `od`. Transakcí, ať se dvě úpravy naráz nepřepíšou.
 * Vrací novou historii.
 */
KB.ulozMzdu = async (uid, odMesic, kc) => {
    if (authReady) await authReady;
    requireDb();
    uid = String(uid || "");
    odMesic = String(odMesic || "");
    const castka = Math.round(Number(kc) * 100) / 100;
    if (!uid || uid.indexOf("/") !== -1) throw new Error("Chybí člověk.");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(odMesic)) throw new Error("Neplatný měsíc „platí od“.");
    if (kc === null || kc === "" || !isFinite(castka) || castka < 0) throw new Error("Neplatná částka mzdy.");
    const kdo = window.KB_USER || "";
    const ref = mzdaDoc(uid);
    const historie = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const stara = snap.exists() && Array.isArray((snap.data() || {}).historie) ? snap.data().historie : [];
        const nova = stara.filter(x => x && x.od !== odMesic)
            .concat([{ od: odMesic, kc: castka, ms: Date.now(), kdo: kdo }])
            .sort((a, b) => String(a.od) < String(b.od) ? -1 : String(a.od) > String(b.od) ? 1 : 0);
        tx.set(ref, { historie: nova, updatedMs: Date.now(), updatedBy: kdo }, { merge: true });
        return nova;
    });
    KB.zapisAktivitu("vykaz", "změnil mzdu (platí od " + odMesic + ")");
    return historie;
};

/* ------------------------------------------ uzávěrka měsíce (finance) ----
   Snímek měsíce pro uzávěrku (Michal 12. 11. 2026, Iris): hodiny po lidech
   a zakázkách, nepřítomnosti, přesčas, chybějící a krátké dny, podezřelé
   zápisy, výplaty, rozpočty, rozdíly web × sešit. Počítá V.uzaverkaMesice
   (vykazy.js), ukazuje stránka uzaverka.html.

     private/uzaverky/mesice/{RRRR-MM}
       { mesic, od, do, stav: pripraveno | ke_kontrole | zkontrolovano | uzavreno,
         vytvorenoMs, vytvoril, vytvorilUid, lide: […], rozpocty: […], souhrn,
         sesity (plní jen Apps Script – porovnání sešitů), kontrola, uzavreno,
         odemknul, updatedMs, updatedBy }

   Nese peníze → čte a píše jen finance (hlavní správce, majitel, asistentka);
   rozesílací účet Apps Scriptu čte a mění jen `sesity`. Uzavřený snímek
   mění (a tím odemyká) jen hlavní správce – firestore.rules. */

const uzaverkyCol = () => collection(db, "artifacts", APP_ID, "private", "uzaverky", "mesice");
const uzaverkaMesiceDoc = (mesic) => doc(db, "artifacts", APP_ID, "private", "uzaverky", "mesice", mesic);

KB.uzaverky = {};               // "RRRR-MM" → dokument snímku
KB.uzaverkyPrisly = false;
let uzaverkyOdber = null;

function mojeRole() {
    const ja = (KB.users || []).find(u => u.id === ((auth && auth.currentUser) || {}).uid);
    return ja && ja.active !== false ? String(ja.role || "") : "";
}

/** "2026-10" → "2026-11-01" (první den následujícího měsíce = čára po uzavření). */
function prvniDenDalsihoMesice(mesic) {
    const r = Number(mesic.slice(0, 4)), m = Number(mesic.slice(5, 7));
    return m === 12 ? (r + 1) + "-01-01" : r + "-" + String(m + 1).padStart(2, "0") + "-01";
}

function platnyMesicUzaverky(mesic) {
    mesic = String(mesic || "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mesic)) throw new Error("Neplatný měsíc uzávěrky.");
    return mesic;
}

/** Jen finance – ostatním by pravidla odběr stejně odmítla, tak se ani neptá. */
KB.watchUzaverky = async () => {
    if (uzaverkyOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || uzaverkyOdber) return;
    if (pockejNaRoli(KB.watchUzaverky)) return;
    if (uzaverkyOdber || FINANCE_ROLE.indexOf(mojeRole()) === -1) return;
    uzaverkyOdber = onSnapshot(uzaverkyCol(), (snap) => {
        KB.uzaverky = {};
        snap.forEach(d => { KB.uzaverky[d.id] = Object.assign({ id: d.id }, d.data()); });
        KB.uzaverkyPrisly = true;
        emit("uzaverky", KB.uzaverky);
    }, (err) => {
        console.error("Chyba čtení uzávěrek:", err);
        emit("uzaverky-chyba", err);
    });
};

/**
 * Uloží snímek měsíce slučováním (pole jako `lide` se přepíšou celá).
 * `mesic` jde vždy i do dokumentu – pravidla hlídají, že sedí s id.
 * Vrací uložená pole.
 */
KB.ulozUzaverkuMesice = async (mesic, data) => {
    if (authReady) await authReady;
    requireDb();
    mesic = platnyMesicUzaverky(mesic);
    const pole = Object.assign({}, data || {}, {
        mesic: mesic,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    });
    await setDoc(uzaverkaMesiceDoc(mesic), pole, { merge: true });
    return pole;
};

/**
 * Uzavření měsíce (finance, po kontrole): (1) čára uzávěrky na první den
 * následujícího měsíce – jen dopředu, už posunutou dál nevrací; (2) výplaty
 * toho měsíce, které ještě uzavřené nejsou, se uzavřou (transakcí, ať se
 * nepřepíše souběžné proplacení); (3) snímek dostane stav „uzavreno“.
 * Pořadí schválně: čára dřív než snímek – kdyby se snímek nepovedl, zůstane
 * měsíc zamčený a jde to zopakovat. Vrací { cara, vyplat }.
 */
KB.uzavriMesic = async (mesic) => {
    if (authReady) await authReady;
    requireDb();
    mesic = platnyMesicUzaverky(mesic);
    if (FINANCE_ROLE.indexOf(mojeRole()) === -1) throw new Error("Měsíc uzavírá jen finance.");
    const kdo = window.KB_USER || "";
    const uid = KB.currentUid();
    const cara = prvniDenDalsihoMesice(mesic);

    const meta = await getDoc(metaDoc("uzaverka"));
    const ted = meta.exists() ? String((meta.data() || {}).odIso || "") : "";
    if (!(ted && ted >= cara)) {
        await KB.ulozUzaverku(cara, "uzavřel měsíc " + mesic + " – čára uzávěrky od " + cara);
    }

    // čte se z databáze, ne z KB.vyplaty – odběr výplat nemusí na stránce běžet
    const vyplaty = await getDocs(query(vyplatyCol(), where("mesic", "==", mesic)));
    let vyplat = 0;
    for (const d of vyplaty.docs) {
        const v = d.data() || {};
        if (v.uzavreno || !v.uid) continue;
        const ulozeno = await KB.ulozVyplatu(v.uid, mesic, (stary) =>
            (stary && !stary.uzavreno) ? { uzavreno: { ms: Date.now(), kdo: kdo } } : null);
        if (ulozeno) vyplat++;
    }

    await KB.ulozUzaverkuMesice(mesic, { stav: "uzavreno", uzavreno: { kdo: kdo, uid: uid, ms: Date.now() } });
    KB.zapisAktivitu("vykaz", "uzavřel měsíc " + mesic + " (uzávěrka; uzavřené výplaty: " + vyplat + ")");
    return { cara: cara, vyplat: vyplat };
};

/**
 * Odemčení uzavřeného měsíce – jen hlavní správce. Čára se vrací na první
 * den toho měsíce JEN tehdy, když stojí přesně za ním (jinak je mezitím
 * uzavřený i pozdější měsíc a vrátit ji by odemklo i ten). Snímek dostane
 * stav „zkontrolovano“ (bez kontroly „pripraveno“) a `odemknul`. Výplaty
 * se NEodemykají – ty odemyká hlavní správce na stránce Výplaty po jedné.
 * Snímek se mění dřív než čára: kdyby ho pravidla odmítla, čára zůstane.
 */
KB.odemkniMesic = async (mesic) => {
    if (authReady) await authReady;
    requireDb();
    mesic = platnyMesicUzaverky(mesic);
    if (mojeRole() !== "hlavni-spravce") throw new Error("Odemknout měsíc smí jen hlavní správce.");
    const snimek = await getDoc(uzaverkaMesiceDoc(mesic));
    const data = snimek.exists() ? (snimek.data() || {}) : {};
    await KB.ulozUzaverkuMesice(mesic, {
        stav: data.kontrola ? "zkontrolovano" : "pripraveno",
        odemknul: { kdo: window.KB_USER || "", uid: KB.currentUid(), ms: Date.now() }
    });
    const meta = await getDoc(metaDoc("uzaverka"));
    const ted = meta.exists() ? String((meta.data() || {}).odIso || "") : "";
    let cara = ted;
    if (ted === prvniDenDalsihoMesice(mesic)) {
        cara = mesic + "-01";
        await KB.ulozUzaverku(cara, "odemkl měsíc " + mesic + " – čára uzávěrky zpět na " + cara);
    }
    KB.zapisAktivitu("vykaz", "odemkl uzávěrku měsíce " + mesic);
    return { cara: cara };
};

/**
 * Porovnání osobních sešitů s webem za měsíc – udělá ho Apps Script
 * (porovnejMesic v Kod.gs) a výsledek zapíše do `sesity` snímku; odpověď
 * se nečte. Stejná cesta jako KB.ohlasVyplatu: { akce: "porovnat", mesic,
 * token }, skript pustí jen finance. Vrací false, když nebylo kam poslat.
 */
KB.porovnejSesity = async (mesic) => {
    try {
        mesic = platnyMesicUzaverky(mesic);
        if (!KB.gsyncUrl) return false;
        await poOdeslani();
        let token = "";
        try { token = await auth.currentUser.getIdToken(); } catch (err) { /* bez tokenu skript neporovná */ }
        fetch(KB.gsyncUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ akce: "porovnat", mesic: mesic, token: token })
        }).catch(err => console.warn("Porovnání sešitů se neozvalo:", err));
        return true;
    } catch (err) {
        console.warn("Porovnání sešitů se neodeslalo:", err);
        return false;
    }
};

/* ------------------------------------------- kontrola týdne (manažer) ----
   Značka „zkontrolováno" u týdne člověka (rešerše 19. 10. 2026, bod 4;
   Michal schválil 21. 10. 2026). NIC NEZAMYKÁ – zámkem je uzávěrka. Jen
   říká, že manažer hodiny toho týdne prošel (hlavně u OSVČ, kteří podle
   výkazu fakturují).

     private/vykazy/kontrola/{uid}_{RRRR-Www}
       { uid, tyden: "2026-W43", pondeli: "2026-10-19", kdo, kdoUid, ms }

   Zapisuje jen manažer (spodní pravidlo pro `private`). Člověk čte jen
   SVOJE dokumenty, a to dotazem `uid == já` – pravidla nejsou filtr.
   Zrušená značka = smazaný dokument. */

const kontrolaTydnuCol = () => collection(db, "artifacts", APP_ID, "private", "vykazy", "kontrola");
const kontrolaTydneDoc = (id) => doc(db, "artifacts", APP_ID, "private", "vykazy", "kontrola", id);

KB.kontrolaTydnu = {};          // "uid_RRRR-Www" → { uid, tyden, pondeli, kdo, ms }
let kontrolaTydnuOdber = null;

KB.watchKontrolaTydnu = async () => {
    if (kontrolaTydnuOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || kontrolaTydnuOdber) return;
    if (pockejNaRoli(KB.watchKontrolaTydnu)) return;
    if (kontrolaTydnuOdber) return;
    /* Manažer drží živě stejné okno jako výkazy (OKNO_MESICU) plus týden
       rezervy – první týden okna začíná ještě v předchozím měsíci. */
    const d = new Date(oknoOd() + "T12:00:00");
    d.setDate(d.getDate() - 7);
    const od = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
    const dotaz = jsemManazer()
        ? query(kontrolaTydnuCol(), where("pondeli", ">=", od))
        : query(kontrolaTydnuCol(), where("uid", "==", auth.currentUser.uid));
    kontrolaTydnuOdber = onSnapshot(dotaz, (snap) => {
        KB.kontrolaTydnu = {};
        snap.forEach(x => { KB.kontrolaTydnu[x.id] = Object.assign({ id: x.id }, x.data()); });
        emit("kontrola-tydnu", KB.kontrolaTydnu);
    }, (err) => console.error("Chyba čtení kontroly týdnů:", err));
};

/** Značka u týdne člověka, nebo null. `tyden` = „2026-W43" (V.isoTyden). */
KB.kontrolaTydne = (uid, tyden) => (KB.kontrolaTydnu || {})[uid + "_" + tyden] || null;

/**
 * Označí týden člověka jako zkontrolovaný (`ano`), nebo značku zruší.
 * `pondeli` = „2026-10-19", `tyden` = „2026-W43" (počítá ho vykazy.js).
 */
KB.ulozKontroluTydne = async (uid, pondeli, tyden, ano, jmeno) => {
    if (authReady) await authReady;
    requireDb();
    if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(String(pondeli || "")) ||
        !/^\d{4}-W\d{2}$/.test(String(tyden || ""))) throw new Error("Neplatný týden.");
    const id = uid + "_" + tyden;
    if (ano) {
        await setDoc(kontrolaTydneDoc(id), {
            uid: uid, tyden: tyden, pondeli: pondeli,
            kdo: window.KB_USER || "", kdoUid: KB.currentUid(), ms: Date.now()
        });
    } else {
        await deleteDoc(kontrolaTydneDoc(id));
    }
    KB.zapisAktivitu("vykaz", (ano ? "označil jako zkontrolovaný týden " : "zrušil značku zkontrolováno u týdne ") +
        tyden + (jmeno ? " – " + jmeno : ""));
};

/* --------------------------------------------------------- PORADY -------
   Zápisy z porad. Čte je celý tým – je to shrnutí toho, co se domluvilo –
   ale píše je manažer; hlídají to pravidla (`private/**` je pro zápis
   manažerský a nad zápisy stojí vlastní pravidlo na čtení).

     private/porady/zapisy/{id}
       { datum:"2026-08-12", nazev, kdo, ms,
         sekce: [{ nadpis, projekt, body: [{ id, text, zaver }] }] }
     private/porady/komentare/{kid}
       { poradaId, bodId, uid, jmeno, text, ms }

   Sekce se schválně nedělí do podkolekcí: zápis je jeden dokument, čte se
   i vytiskne vcelku a i ta nejdelší porada se do limitu vejde.

   KOMENTÁŘE ale ANO, a to schválně. Napsat komentář smí každý, kdo poradu
   čte – a kdyby se přidával do pole v dokumentu zápisu, musela by pravidla
   pustit zápis celého dokumentu a kdokoliv by mohl přepsat celou poradu.
   Vlastní dokument na komentář to řeší: každý smí založit svůj a sáhnout
   jen na něj. `zaver` je naopak shrnutí diskuze a patří manažerovi, proto
   sedí přímo u bodu. (Michal 3. 9. 2026.)

   Bod byl původně jen řetězec. Aby se na něj dal navěsit komentář, musí
   mít stálé `id`; starší zápisy se převedou při prvním uložení a čtení
   snese obojí (viz `bodText` na stránce). */

const poradyCol = () => collection(db, "artifacts", APP_ID, "private", "porady", "zapisy");
const poradaDoc = (id) => doc(db, "artifacts", APP_ID, "private", "porady", "zapisy", id);

KB.porady = [];
let poradyOdber = null;

/** Manažer vidí i nezveřejněné zápisy. */
const poradyManazer = jsemManazer;

/**
 * Zápisy z porad. Manažer vidí všechny, ostatní jen zveřejněné.
 *
 * `skryto: true` = zápis se připravuje (body na příští poradu) a ostatním
 * do něj není nic po tom, dokud porada neproběhne. Pravidla nejsou filtr,
 * takže si člen musí o zveřejněné říct dotazem – a proto má KAŽDÝ zápis
 * pole `skryto` (i starý; doplní ho `KB.doplnSkrytiPorad`), jinak by
 * z dotazu vypadl (Michal 25. 9. 2026).
 */
KB.watchPorady = async () => {
    if (poradyOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || poradyOdber) return;
    if (pockejNaRoli(KB.watchPorady)) return;
    const dotaz = poradyManazer()
        ? poradyCol()
        : query(poradyCol(), where("skryto", "==", false));
    poradyOdber = onSnapshot(dotaz, (snap) => {
        KB.porady = [];
        snap.forEach(d => KB.porady.push({ id: d.id, ...d.data() }));
        // nejnovější porada nahoře – tu člověk hledá
        KB.porady.sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")));
        emit("porady", KB.porady);
    }, (err) => console.error("Chyba čtení porad:", err));
};

KB.ulozPoradu = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    const pid = id || "por_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    let poradiBodu = 0;
    const novyBodId = () => "b" + Date.now().toString(36) + (poradiBodu++).toString(36);
    const sekce = (Array.isArray(data.sekce) ? data.sekce : []).slice(0, 40).map(s => ({
        nadpis: String(s.nadpis || "").slice(0, 120),
        projekt: String(s.projekt || "").slice(0, 120),
        /* Starší zápisy mají body jako holé řetězce – převedou se tady,
           ať mají id a dá se k nim psát. */
        body: (Array.isArray(s.body) ? s.body : []).slice(0, 200).map(b => {
            const o = (b && typeof b === "object") ? b : { text: b };
            return {
                id: String(o.id || "").slice(0, 40) || novyBodId(),
                text: String(o.text || "").slice(0, 1200),
                zaver: String(o.zaver || "").slice(0, 1200)
            };
        })
    }));
    const zapis = {
        datum: String(data.datum || "").slice(0, 10),
        nazev: String(data.nazev || "").slice(0, 80) || "Porada",
        sekce: sekce,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    };
    /* Skrytí se přepisuje jen tehdy, když ho volající opravdu posílá –
       úprava zápisu nesmí omylem zveřejnit rozdělanou poradu. */
    if (!id || data.skryto !== undefined) zapis.skryto = data.skryto === true;
    if (!id) {
        zapis.kdo = window.KB_USER || "";
        zapis.uid = KB.currentUid();
        zapis.ms = Date.now();
    }
    KB.zapisAktivitu("porada", (id ? "upravil" : "založil") + " zápis z porady " +
        (zapis.datum || ""));
    await setDoc(poradaDoc(pid), zapis, { merge: true });
    return pid;
};

/** Skrýt / zveřejnit zápis z porady – sahá se jen na ten jeden příznak. */
KB.nastavSkrytiPorady = async (id, skryto) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(poradaDoc(id), {
        skryto: skryto === true,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    KB.zapisAktivitu("porada", (skryto ? "skryl" : "zveřejnil") + " zápis z porady");
};

/**
 * Doplní `skryto: false` starým zápisům. Bez toho by po přepnutí odběru
 * na dotaz `skryto == false` členům zmizely všechny porady zapsané dřív,
 * než se skrývání zavedlo. Běží v prohlížeči manažera, jednou.
 */
KB.doplnSkrytiPorad = async () => {
    if (authReady) await authReady;
    requireDb();
    if (!poradyManazer()) return 0;
    const snap = await getDocs(poradyCol());
    let doplneno = 0;
    for (const d of snap.docs) {
        if (d.data().skryto === undefined) {
            await setDoc(poradaDoc(d.id), { skryto: false }, { merge: true });
            doplneno++;
        }
    }
    return doplneno;
};

/* Komentáře k bodům porad. Drží se všechny naráz – je jich řádově
   stovky za rok a stránka je potřebuje pro počty u projektů. */
const poradyKomCol = () => collection(db, "artifacts", APP_ID, "private", "porady", "komentare");
const poradyKomDoc = (id) => doc(db, "artifacts", APP_ID, "private", "porady", "komentare", id);

KB.poradyKomentare = [];
let poradyKomOdber = null;

KB.watchPoradyKomentare = async () => {
    if (poradyKomOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || poradyKomOdber) return;
    poradyKomOdber = onSnapshot(poradyKomCol(), (snap) => {
        KB.poradyKomentare = [];
        snap.forEach(d => KB.poradyKomentare.push({ id: d.id, ...d.data() }));
        KB.poradyKomentare.sort((a, b) => (a.ms || 0) - (b.ms || 0));
        emit("porady-komentare", KB.poradyKomentare);
    }, (err) => console.error("Chyba čtení komentářů k poradám:", err));
};

KB.pridejPoradaKomentar = async (poradaId, bodId, text) => {
    if (authReady) await authReady;
    requireDb();
    const cisty = String(text || "").trim().slice(0, 1200);
    if (!cisty) return "";
    const kid = "pk_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    await setDoc(poradyKomDoc(kid), {
        poradaId: String(poradaId || ""),
        bodId: String(bodId || ""),
        uid: KB.currentUid(),
        jmeno: window.KB_USER || "",
        text: cisty,
        ms: Date.now()
    });
    return kid;
};

/** Smazat smí svůj komentář autor, cizí jen manažer (hlídají pravidla). */
KB.smazPoradaKomentar = async (kid) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(poradyKomDoc(kid));
};

KB.smazPoradu = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const p = (KB.porady || []).find(x => x.id === id);
    KB.zapisAktivitu("porada", "smazal zápis z porady " + ((p && p.datum) || id));
    // komentáře k bodům by jinak zůstaly viset u zápisu, který už není
    for (const k of (KB.poradyKomentare || []).filter(k => k.poradaId === id)) {
        await deleteDoc(poradyKomDoc(k.id)).catch(() => {});
    }
    await deleteDoc(poradaDoc(id));
};

/* Hladiny plánu. Název, barva a průhlednost jsou SPOLEČNÉ – celá parta
   je vidí stejně. Co má kdo zapnuté, si drží prohlížeč, do databáze to
   nejde: vypnutá hladina je pohled jednoho člověka, ne rozhodnutí za
   ostatní. (Michal 2. 9. 2026.) */
KB.ulozPlanHladiny = async (planId, hladiny) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(planDoc(planId), {
        hladiny: Array.isArray(hladiny) ? hladiny.slice(0, 20).map(h => ({
            id: String(h.id || "").slice(0, 40),
            nazev: String(h.nazev || "").slice(0, 40),
            barva: String(h.barva || "#23486e").slice(0, 12),
            barvaHladiny: h.barvaHladiny === true,
            pruh: Math.min(1, Math.max(0.05, Number(h.pruh) || 1))
        })).filter(h => h.id) : []
    }, { merge: true });
};

KB.smazPlan = async (id) => {
    if (authReady) await authReady;
    requireDb();
    const znacky = await getDocs(planZnacky(id));
    for (const d of znacky.docs) {
        const fotky = await getDocs(planFotky(id, d.id));
        for (const f of fotky.docs) await deleteDoc(f.ref);
        await deleteDoc(d.ref);
    }
    const kousky = await getDocs(planKousky(id));
    for (const d of kousky.docs) await deleteDoc(d.ref);
    const kdo = await getDocs(planKdoCol(id)).catch(() => null);
    if (kdo) for (const d of kdo.docs) await deleteDoc(d.ref).catch(() => {});
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
    /* includeMetadataChanges: snímek přijde i ve chvíli, kdy databáze
       potvrdí zápis – podle `hasPendingWrites` stránka ukáže, kolik změn
       ještě čeká na signál (terén bez signálu, etapa E 13. 11. 2026). */
    znackyOdber = onSnapshot(planZnacky(planId), { includeMetadataChanges: true }, (snap) => {
        KB.znackyPlanu = [];
        let ceka = 0;
        snap.forEach(d => {
            KB.znackyPlanu.push({ id: d.id, ...d.data() });
            if (d.metadata && d.metadata.hasPendingWrites) ceka++;
        });
        KB.znackyCeka = ceka;
        KB.znackyZMezipameti = !!(snap.metadata && snap.metadata.fromCache);
        emit("znacky", null);
    }, (err) => console.error("Chyba čtení značek:", err));
};

/* -------------------------------------------- kdo je právě v plánu ---
   `private/plany/soubory/{id}/kdo/{uid}` { jmeno, ms } – zapisuje se při
   otevření plánu a pak každou minutu, při zavření se smaže. Stránka
   ukazuje ty, kdo se ozvali v posledních 3 minutách. */
const planKdoCol = (id) => collection(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "kdo");
const planKdoDoc = (id, uid) => doc(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "kdo", uid);
KB.kdoVPlanu = [];
let kdoOdber = null;

KB.ohlasVPlanu = async (planId) => {
    if (authReady) await authReady;
    if (!db || !planId || !KB.currentUid()) return;
    // jen když je signál – fronta zápisů by jinak po návratu poslala staré „jsem tu"
    if (navigator.onLine === false) return;
    await setDocSdk(planKdoDoc(planId, KB.currentUid()), { jmeno: window.KB_USER || "", ms: Date.now() })
        .catch(() => { /* pravidla ještě nepublikovaná – nic se neděje */ });
};
KB.odhlasZPlanu = async (planId) => {
    if (!db || !planId || !KB.currentUid() || navigator.onLine === false) return;
    await deleteDocSdk(planKdoDoc(planId, KB.currentUid())).catch(() => {});
};
KB.watchKdoVPlanu = async (planId) => {
    if (kdoOdber) { try { kdoOdber(); } catch (e) {} kdoOdber = null; }
    KB.kdoVPlanu = [];
    if (!planId) { emit("kdovplanu", null); return; }
    if (authReady) await authReady;
    requireDb();
    kdoOdber = onSnapshot(planKdoCol(planId), (snap) => {
        KB.kdoVPlanu = [];
        snap.forEach(d => KB.kdoVPlanu.push({ id: d.id, ...d.data() }));
        emit("kdovplanu", null);
    }, () => { /* starší pravidla: bez přítomnosti */ });
};

KB.ulozZnacku = async (planId, zid, data) => {
    if (authReady) await authReady;
    requireDb();
    /* Dva tvary: kolečko (bod) a obdélník (plocha přes místnost). Obdélník
       má navíc rozměry v poměru k plánu a otočení ve stupních; ostatní pole
       jsou společná, takže výběr, barvy i mazání fungují na obojí. */
    const tvar = data.tvar === "obdelnik" ? "obdelnik" : "";
    await setDoc(planZnacka(planId, zid), {
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        tvar: tvar,
        w: tvar ? Math.min(1, Math.max(0.002, Number(data.w) || 0.08)) : 0,
        h: tvar ? Math.min(1, Math.max(0.002, Number(data.h) || 0.05)) : 0,
        uhel: tvar ? (Number(data.uhel) || 0) : 0,
        stav: Number(data.stav) || 0,
        vel: Number(data.vel) || 26,
        /* Hladina, do které značka patří (jako v CADu). Prázdné = základní,
           tam sedí všechno, co vzniklo dřív, než hladiny přibyly. */
        hl: String(data.hl || "").slice(0, 40),
        /* Průhlednost barvy 0–1. NULA znamená „podle hladiny"; chybějící
           pole = plná barva, ať se starým značkám nic nezmění. */
        pruh: data.pruh === undefined ? 1
            : (Number(data.pruh) === 0 ? 0
                : Math.min(1, Math.max(0.05, Number(data.pruh) || 1))),
        /* Do kolečka se vejdou tři znaky. Obdélník označuje místnost a
           „3S01 – Injekce zebrafish" je potřeba přečíst celé. */
        text: tvar
            ? String(data.text || "").slice(0, 40)
            : String(data.text || "").slice(0, 3).toUpperCase(),
        pozn: String(data.pozn || "").slice(0, 500),
        /* Značka jako záznam z terénu (Michal 13. 11. 2026, Iris, varianta C):
           technologie a místnost jako text (technologie z os zakázky), počet
           fotek (fotky samy v podkolekci `fotky`) a krátká historie změn –
           kdo, kdy, co; drží se posledních 20. `data.co` = popis právě
           dělané změny, do dokumentu se nepíše. */
        tech: String(data.tech || "").slice(0, 30),
        mistnost: String(data.mistnost || "").slice(0, 40),
        fotek: Math.max(0, Math.min(20, Number(data.fotek) || 0)),
        hist: historieZnacky(data),
        kdo: data.kdo || window.KB_USER || "",
        uid: data.uid || KB.currentUid(),
        ms: data.ms || Date.now()
    }, { merge: true });
};

function historieZnacky(data) {
    const stara = (Array.isArray(data.hist) ? data.hist : [])
        .filter(h => h && typeof h === "object")
        .map(h => ({ kdo: String(h.kdo || "").slice(0, 60), ms: Number(h.ms) || 0, co: String(h.co || "").slice(0, 80) }));
    if (data.co) stara.push({ kdo: window.KB_USER || "", ms: Date.now(), co: String(data.co).slice(0, 80) });
    return stara.slice(-20);
}

const planFotky = (id, zid) => collection(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "znacky", zid, "fotky");
const planFotka = (id, zid, fid) => doc(db, "artifacts", APP_ID, "private", "plany", "soubory", id, "znacky", zid, "fotky", fid);

/** Fotky jedné značky (stahují se až při otevření její karty). */
KB.nactiFotkyZnacky = async (planId, zid) => {
    if (authReady) await authReady;
    requireDb();
    const snap = await getDocs(planFotky(planId, zid));
    const ven = [];
    snap.forEach(d => ven.push({ id: d.id, ...d.data() }));
    return ven.sort((a, b) => (a.ms || 0) - (b.ms || 0));
};

/** Přidá fotku (data URL JPEG z UI.compressImage) a zvedne počet u značky. */
KB.pridejFotkuZnacky = async (planId, z, dataUrl) => {
    if (authReady) await authReady;
    requireDb();
    if (!/^data:image\/jpeg;base64,/.test(String(dataUrl)) || dataUrl.length > 900000) {
        throw new Error("Fotka je moc velká nebo není JPEG.");
    }
    const fid = "f_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    await setDoc(planFotka(planId, z.id, fid), {
        data: dataUrl, ms: Date.now(), kdo: window.KB_USER || "", uid: KB.currentUid()
    });
    await KB.ulozZnacku(planId, z.id, Object.assign({}, z, { fotek: (Number(z.fotek) || 0) + 1, co: "přidal fotku" }));
    return fid;
};

KB.smazFotkuZnacky = async (planId, z, fid) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(planFotka(planId, z.id, fid));
    await KB.ulozZnacku(planId, z.id, Object.assign({}, z,
        { fotek: Math.max(0, (Number(z.fotek) || 0) - 1), co: "smazal fotku" }));
};

KB.smazZnacku = async (planId, zid) => {
    if (authReady) await authReady;
    requireDb();
    // fotky se smažou první – bez značky by k nim už nikdo nenašel cestu
    const fotky = await getDocs(planFotky(planId, zid)).catch(() => null);
    if (fotky) for (const d of fotky.docs) await deleteDoc(d.ref).catch(() => {});
    await deleteDoc(planZnacka(planId, zid));
};

/* ------------------------------------------------------ evidence vybavení ---
   Kdo má jaký notebook, tablet, telefon, dálkoměr, klíč, oblečení, auto,
   licenci nebo e-mailový účet (Michal 10. 11. 2026, rozhodnuto v Iris).
   Jedna položka = jeden dokument, id = kód (TAB001, KLI012…). Čte a píše
   jen manažerská role – kryje to zachytávací pravidlo private/{kolekce}/**
   → spravce(); zaměstnanci stránka ukáže jen zátaras a nic neodebírá.
   Hesla k účtům sem NIKDY nepatří – jen název účtu. Nesouvisí s rezervacemi
   přístrojů (`public/data/vybaveni`, KB.watchVybaveni výš). */

const vybPolozkyCol = () => collection(db, "artifacts", APP_ID, "private", "vybaveni", "polozky");
const vybPolozkaDoc = (kod) => doc(db, "artifacts", APP_ID, "private", "vybaveni", "polozky", kod);
const KOD_POLOZKY = /^[A-Z]{2,4}\d{2,4}$/;
const HISTORIE_POLOZKY_MAX = 60;
const UCET_TYPY_VYBAVENI = ["", "apple", "android", "ms", "google"];

/* Kategorie: prefix kódu, název a pole navíc (`navic`), která má jen ta
   kategorie – stránka z nich kreslí formulář, převod z tabulky kontroluje
   kódy. `typ`: text | number | date | month | select (`moznosti`) | seznam
   (pole textů, zadává se čárkami). */
KB.KATEGORIE_VYBAVENI = [
    { klic: "tablet",   prefix: "TAB", nazev: "Tablety", zarizeni: true },
    { klic: "telefon",  prefix: "TEL", nazev: "Telefony", zarizeni: true },
    { klic: "notebook", prefix: "NTB", nazev: "Notebooky", zarizeni: true,
      navic: [{ klic: "programy", nazev: "Programy", typ: "text" }] },
    { klic: "pc",       prefix: "PC",  nazev: "Stolní PC", zarizeni: true,
      navic: [{ klic: "umisteni", nazev: "Kde stojí", typ: "text" }] },
    { klic: "dalkomer", prefix: "LAS", nazev: "Laserové dálkoměry", zarizeni: true },
    { klic: "hub",      prefix: "HUB", nazev: "USB-C huby a doky", zarizeni: true },
    { klic: "monitor",  prefix: "MON", nazev: "Monitory", zarizeni: true },
    { klic: "mys",      prefix: "MYS", nazev: "Myši a podložky", zarizeni: true },
    { klic: "ostatni",  prefix: "OST", nazev: "Ostatní", zarizeni: true },
    { klic: "auto",     prefix: "AUT", nazev: "Auta", zarizeni: true,
      navic: [{ klic: "spz", nazev: "SPZ", typ: "text" }, { klic: "stk", nazev: "STK do", typ: "date" },
              { klic: "hasiciPristroj", nazev: "Hasicí přístroj (kód)", typ: "text" }] },
    { klic: "klic",     prefix: "KLI", nazev: "Klíče",
      navic: [{ klic: "cislo", nazev: "Číslo klíče / čipu", typ: "text" },
              { klic: "dvere", nazev: "Od čeho", typ: "text" }] },
    { klic: "obleceni", prefix: "OBL", nazev: "Pracovní oblečení",
      navic: [{ klic: "artikl", nazev: "Artikl", typ: "text" }, { klic: "velikost", nazev: "Velikost", typ: "text" },
              { klic: "ks", nazev: "Kusů", typ: "number" }] },
    { klic: "hasici",   prefix: "HAS", nazev: "Hasicí přístroje",
      navic: [{ klic: "typ", nazev: "Typ", typ: "text" }, { klic: "vyrobniCislo", nazev: "Výrobní číslo", typ: "text" },
              { klic: "umisteni", nazev: "Umístění", typ: "text" }, { klic: "vyroba", nazev: "Výroba", typ: "text" },
              { klic: "kontrola", nazev: "Kontrola", typ: "month" },
              { klic: "tlakovaZkouska", nazev: "Tlaková zkouška", typ: "month" }] },
    { klic: "licence",  prefix: "LIC", nazev: "Programy a licence",
      navic: [{ klic: "program", nazev: "Program", typ: "text" }, { klic: "ucetNazev", nazev: "Účet / licence", typ: "text" },
              { klic: "platnost", nazev: "Platnost do", typ: "text" }] },
    { klic: "email",    prefix: "EML", nazev: "E-mailové účty",
      navic: [{ klic: "adresa", nazev: "Adresa", typ: "text" },
              { klic: "druh", nazev: "Druh", typ: "select", moznosti: ["osobni", "alias", "zarizeni", "byvaly"] },
              { klic: "aliasy", nazev: "Aliasy (hub, kana, admin)", typ: "seznam" },
              { klic: "cislo", nazev: "Pořadí v tabulce", typ: "text" },
              { klic: "preposilani", nazev: "Přeposílání na", typ: "text" }] }
];
KB.STAVY_VYBAVENI = ["u-cloveka", "volne", "rezerva", "firemni", "vyrazene", "ztracene", "vadne"];
KB.STAV_TEXT_VYBAVENI = { "u-cloveka": "u člověka", volne: "volné", rezerva: "rezerva", firemni: "firemní",
    vyrazene: "vyřazené", ztracene: "ztracené", vadne: "vadné" };
KB.STITKY_VYBAVENI = ["nedoplneno", "bez-uctu", "bez-stitku", "soukromy-ucet", "sim-cizi"];

KB.vybaveniPolozky = [];
KB.vybaveniPolozkyPrisly = false;
let vybPolozkyOdber = null;

function zrusVybaveniPolozky() {
    if (vybPolozkyOdber) { try { vybPolozkyOdber(); } catch (e) {} vybPolozkyOdber = null; }
    KB.vybaveniPolozky = [];
    KB.vybaveniPolozkyPrisly = false;
}

/** Odběr celé evidence – jen manažer; jinému by ho databáze zamítla, tak se ani nezkouší. */
KB.watchVybaveniPolozky = async () => {
    if (vybPolozkyOdber) return;
    if (authReady) await authReady;
    if (!db || !auth || !auth.currentUser || vybPolozkyOdber) return;
    if (pockejNaRoli(KB.watchVybaveniPolozky)) return;
    if (vybPolozkyOdber) return;
    if (!jsemManazer()) {
        KB.vybaveniPolozkyPrisly = true;
        emit("vybaveni-polozky", KB.vybaveniPolozky);
        return;
    }
    vybPolozkyOdber = onSnapshot(vybPolozkyCol(), (snap) => {
        KB.vybaveniPolozky = [];
        snap.forEach(d => KB.vybaveniPolozky.push(Object.assign({ id: d.id }, d.data())));
        KB.vybaveniPolozky.sort((a, b) =>
            String(a.kod || a.id).localeCompare(String(b.kod || b.id), "cs", { numeric: true }));
        KB.vybaveniPolozkyPrisly = true;
        emit("vybaveni-polozky", KB.vybaveniPolozky);
    }, (err) => {
        console.error("Chyba čtení evidence vybavení:", err);
        emit("vybaveni-polozky-chyba", err);
    });
};

const textPolozky = (v, n) => String(v == null ? "" : v).trim().slice(0, n || 200);
const jeIsoDen = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const dnesIsoDen = () => {
    const t = new Date();
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
};
const jmenoPodleUid = (uid) => {
    const u = (KB.users || []).find(x => x.id === uid);
    return u ? (((u.first || "") + " " + (u.last || "")).trim() || u.email || "") : "";
};

/** Kdo nebo co položku drží – text do historie a do řádku. */
KB.drzitelVybaveni = (p) => (p && (p.uzivatelJmeno || (p.uzivatel ? jmenoPodleUid(p.uzivatel) : "")))
    || KB.STAV_TEXT_VYBAVENI[(p || {}).stav] || "";

const zaznamHistorieVybaveni = (akce, text) => ({
    ms: Date.now(), uid: KB.currentUid(), jmeno: window.KB_USER || "", akce: akce, text: textPolozky(text, 200)
});

/* Dokument se skládá celý znovu (jako saveProjekt) – chybějící pole se
   vyprázdní, proto stránka posílá všechna. `navic` jen klíče kategorie.
   Stav se srovná s držitelem: s člověkem nemůže být „volné“ a naopak. */
function normalizujPolozkuVybaveni(data, stara) {
    const d = data || {};
    const kod = textPolozky(d.kod, 8).toUpperCase().replace(/[\s-]+/g, "");
    if (!KOD_POLOZKY.test(kod)) throw new Error("Kód musí být písmena a číslo, třeba TAB001.");
    const kat = KB.KATEGORIE_VYBAVENI.find(k => k.klic === d.kategorie);
    if (!kat) throw new Error("Vyber kategorii.");
    const nazev = textPolozky(d.nazev, 120);
    if (!nazev) throw new Error("Název položky nesmí být prázdný.");
    const uzivatel = textPolozky(d.uzivatel, 64).replace(/\//g, "");
    const uzivatelJmeno = textPolozky(d.uzivatelJmeno, 80) || (uzivatel ? jmenoPodleUid(uzivatel) : "");
    let stav = KB.STAVY_VYBAVENI.indexOf(d.stav) !== -1 ? d.stav : (uzivatel || uzivatelJmeno ? "u-cloveka" : "volne");
    if ((uzivatel || uzivatelJmeno) && (stav === "volne" || stav === "rezerva")) stav = "u-cloveka";
    if (!uzivatel && !uzivatelJmeno && stav === "u-cloveka") stav = "volne";
    const navic = {};
    (kat.navic || []).forEach(p => {
        const v = d.navic ? d.navic[p.klic] : undefined;
        if (p.typ === "number") navic[p.klic] = (v === "" || v == null || isNaN(Number(v))) ? null : Number(v);
        else if (p.typ === "seznam") navic[p.klic] = (Array.isArray(v) ? v : String(v || "").split(/[,;\s]+/))
            .map(x => textPolozky(x, 40)).filter(Boolean).slice(0, 20);
        else if (p.typ === "select") navic[p.klic] = (p.moznosti || []).indexOf(v) !== -1 ? v : "";
        else navic[p.klic] = textPolozky(v, 200);
    });
    return {
        kod: kod, kategorie: kat.klic, nazev: nazev,
        nick: textPolozky(d.nick, 120),
        seriove: textPolozky(d.seriove, 80),
        prislusenstvi: textPolozky(d.prislusenstvi, 200),
        prislusenstviSn: textPolozky(d.prislusenstviSn, 80),
        uzivatel: uzivatel, uzivatelJmeno: uzivatelJmeno, stav: stav,
        // „má od“ dává smysl jen u držitele – ve skladu se vyprázdní
        od: (uzivatel || uzivatelJmeno) && jeIsoDen(d.od) ? d.od : "",
        ucet: textPolozky(d.ucet, 120),
        ucetTyp: UCET_TYPY_VYBAVENI.indexOf(d.ucetTyp) !== -1 ? d.ucetTyp : "",
        telCislo: textPolozky(d.telCislo, 40),
        operator: textPolozky(d.operator, 40),
        dodavatel: textPolozky(d.dodavatel, 60),
        porizeno: textPolozky(d.porizeno, 40),
        mac: textPolozky(d.mac, 200),
        stitky: (Array.isArray(d.stitky) ? d.stitky : []).filter(s => KB.STITKY_VYBAVENI.indexOf(s) !== -1),
        poznamka: textPolozky(d.poznamka, 1000),
        navic: navic,
        historie: Array.isArray(stara && stara.historie) ? stara.historie.slice(-HISTORIE_POLOZKY_MAX) : [],
        createdMs: (stara && stara.createdMs) || Date.now(),
        createdUid: (stara && stara.createdUid) || KB.currentUid(),
        updatedMs: Date.now(),
        updatedUid: KB.currentUid()
    };
}

/**
 * Založí nebo přepíše položku (id = kód). Transakcí: čte starý dokument,
 * ať se historie nepřepíše a změna držitele se zapíše jako předání.
 * `volby.novy` = zakládá se nová – existující kód skončí chybou místo
 * tichého přepsání. Vrací uloženou položku.
 */
KB.ulozPolozkuVybaveni = async (data, volby) => {
    if (authReady) await authReady;
    requireDb();
    const kontrola = normalizujPolozkuVybaveni(data, null);     // chyby zadání ještě před transakcí
    const ref = vybPolozkaDoc(kontrola.kod);
    const ulozeno = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const stara = snap.exists() ? snap.data() : null;
        if (stara && volby && volby.novy) throw new Error("Kód " + kontrola.kod + " už v evidenci je.");
        const p = normalizujPolozkuVybaveni(data, stara);
        if (!stara) {
            p.historie = [zaznamHistorieVybaveni("zalozeno", KB.drzitelVybaveni(p))];
        } else {
            const drzelo = KB.drzitelVybaveni(stara), drzi = KB.drzitelVybaveni(p);
            /* jméno se porovnává přes držitele (text), ne přes pole – starý
               dokument s uid bez `uzivatelJmeno` není změna držitele */
            const zmenaDrzitele = (stara.uzivatel || "") !== p.uzivatel || stara.stav !== p.stav || drzelo !== drzi;
            const akce = !zmenaDrzitele ? "upraveno"
                : (p.stav === "vyrazene" || p.stav === "ztracene") ? "vyrazeno"
                : (p.uzivatel || p.uzivatelJmeno) ? "predano" : "vraceno";
            p.historie = p.historie.concat([zaznamHistorieVybaveni(akce, akce === "upraveno" ? "" : drzelo + " → " + drzi)])
                .slice(-HISTORIE_POLOZKY_MAX);
        }
        tx.set(ref, p);
        return p;
    });
    KB.zapisAktivitu("vybaveni", "Vybavení " + ulozeno.kod + " (" + ulozeno.nazev + ") uloženo");
    return ulozeno;
};

/**
 * Předání, vrácení do skladu nebo vyřazení – mění jen držitele, stav
 * a datum, zbytek položky nechá. `zmena` = { uzivatel, uzivatelJmeno,
 * stav, od, pozn }. Vrací položku po změně.
 */
KB.predejPolozkuVybaveni = async (kod, zmena) => {
    if (authReady) await authReady;
    requireDb();
    kod = textPolozky(kod, 8).toUpperCase();
    if (!KOD_POLOZKY.test(kod)) throw new Error("Neplatný kód položky.");
    const z = zmena || {};
    const ref = vybPolozkaDoc(kod);
    const vysledek = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Položka " + kod + " v evidenci není.");
        const stara = snap.data();
        const uzivatel = textPolozky(z.uzivatel, 64).replace(/\//g, "");
        const uzivatelJmeno = textPolozky(z.uzivatelJmeno, 80) || (uzivatel ? jmenoPodleUid(uzivatel) : "");
        let stav = KB.STAVY_VYBAVENI.indexOf(z.stav) !== -1 ? z.stav : (uzivatel || uzivatelJmeno ? "u-cloveka" : "volne");
        if ((uzivatel || uzivatelJmeno) && (stav === "volne" || stav === "rezerva")) stav = "u-cloveka";
        if (!uzivatel && !uzivatelJmeno && stav === "u-cloveka") stav = "volne";
        const p = {
            uzivatel: uzivatel, uzivatelJmeno: uzivatelJmeno, stav: stav,
            od: (uzivatel || uzivatelJmeno) ? (jeIsoDen(z.od) ? z.od : dnesIsoDen()) : "",
            updatedMs: Date.now(), updatedUid: KB.currentUid()
        };
        const akce = (stav === "vyrazene" || stav === "ztracene") ? "vyrazeno"
            : (uzivatel || uzivatelJmeno) ? "predano" : "vraceno";
        const text = KB.drzitelVybaveni(stara) + " → " + KB.drzitelVybaveni(Object.assign({}, stara, p))
            + (z.pozn ? " (" + textPolozky(z.pozn, 120) + ")" : "");
        p.historie = (Array.isArray(stara.historie) ? stara.historie : [])
            .concat([zaznamHistorieVybaveni(akce, text)]).slice(-HISTORIE_POLOZKY_MAX);
        tx.update(ref, p);
        return Object.assign({ id: kod }, stara, p);
    });
    KB.zapisAktivitu("vybaveni", "Vybavení " + kod + ": " + (vysledek.historie[vysledek.historie.length - 1] || {}).text);
    return vysledek;
};

/** Smazání z evidence – jen pro omyly; vyřazená věc má zůstat se stavem „vyřazené“. */
KB.smazPolozkuVybaveni = async (kod) => {
    if (authReady) await authReady;
    requireDb();
    kod = textPolozky(kod, 8).toUpperCase();
    if (!KOD_POLOZKY.test(kod)) throw new Error("Neplatný kód položky.");
    await deleteDoc(vybPolozkaDoc(kod));
    KB.zapisAktivitu("vybaveni", "Vybavení " + kod + " smazáno z evidence");
};

/** Další volný kód v prefixu (TAB → TAB018). Šířka čísla podle stávajících kódů, nejméně 3 místa. */
KB.dalsiKodVybaveni = (prefix) => {
    prefix = String(prefix || "").toUpperCase();
    let max = 0, sirka = 3;
    (KB.vybaveniPolozky || []).forEach(p => {
        const m = /^([A-Z]+)(\d+)$/.exec(String(p.kod || p.id || ""));
        if (!m || m[1] !== prefix) return;
        max = Math.max(max, Number(m[2]));
        sirka = Math.max(sirka, m[2].length);
    });
    return prefix + String(max + 1).padStart(sirka, "0");
};

emit("boot");
