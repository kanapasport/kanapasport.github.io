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
    onSnapshot, serverTimestamp, addDoc
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

const bus = new EventTarget();
const KB = {
    DEFAULT_SKUPINY: DEFAULT_SKUPINY,
    guides: [],
    tasks: [],
    zakazky: [],            // číselník zakázek – aby se překlepem nezakládaly nové
    zakazkyClosed: [],      // uzavřené zakázky (v dlaždici zelené)
    skupiny: DEFAULT_SKUPINY.slice(),   // skupiny úkolů uvnitř zakázky
    users: [],              // lidé, kteří mají na web přístup, a jejich role
    milniky: [],            // termíny odevzdání po činnostech
    boards: [],             // tabule na nápady – jen hlavičky, obsah se dotahuje zvlášť
    status: "connecting",   // connecting | online | offline
    ready: false
};
window.KB = KB;

KB.on = (event, handler) => bus.addEventListener(event, handler);
const emit = (event, detail) => bus.dispatchEvent(new CustomEvent(event, { detail }));

let db = null;
let auth = null;
let authReady = null;

const guidesCol = () => collection(db, "artifacts", APP_ID, "public", "data", "guides");
const guideDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "guides", id);
const tasksCol = () => collection(db, "artifacts", APP_ID, "public", "data", "tasks");
const taskDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "tasks", id);
const metaDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "meta", id);
const boardsCol = () => collection(db, "artifacts", APP_ID, "public", "data", "boards");
const boardDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "boards", id);
/* obsah tabule je zvlášť, aby seznam tabulí zůstal lehký */
const boardBody = (id) => doc(db, "artifacts", APP_ID, "public", "data", "boards", id, "content", "data");
const boardImages = (id) => collection(db, "artifacts", APP_ID, "public", "data", "boards", id, "images");
const boardImage = (id, imgId) => doc(db, "artifacts", APP_ID, "public", "data", "boards", id, "images", imgId);
const usersCol = () => collection(db, "artifacts", APP_ID, "public", "data", "users");
const userDoc = (id) => doc(db, "artifacts", APP_ID, "public", "data", "users", id);
const imagesCol = (guideId) => collection(db, "artifacts", APP_ID, "public", "data", "guides", guideId, "images");
const imageDoc = (guideId, imgId) => doc(db, "artifacts", APP_ID, "public", "data", "guides", guideId, "images", imgId);

/* ------------------------------------------------------------------ start */

/* Odběry se navazují až po přihlášení a při odhlášení se zase ruší,
   aby po člověku nezůstal otevřený poslech dat. */
let odbery = [];
const zrusOdbery = () => { odbery.forEach(stop => { try { stop(); } catch (e) {} }); odbery = []; };

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
            KB.guides = []; KB.tasks = []; KB.users = []; KB.boards = [];
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

        odbery.push(onSnapshot(boardsCol(), (snapshot) => {
            KB.boards = [];
            snapshot.forEach(d => KB.boards.push({ id: d.id, ...d.data() }));
            KB.boards.sort((a, b) => (b.updatedMs || 0) - (a.updatedMs || 0));
            emit("boards", KB.boards);
        }, (err) => console.error("Chyba čtení tabulí:", err)));

        odbery.push(onSnapshot(usersCol(), (snapshot) => {
            KB.users = [];
            snapshot.forEach(d => KB.users.push({ id: d.id, ...d.data() }));
            KB.users.sort((a, b) => (a.last || "").localeCompare(b.last || "", "cs"));
            emit("users", KB.users);
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
            emit("zakazky", KB.zakazky);
        }, (err) => console.error("Chyba čtení zakázek:", err)));
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
    await setDoc(boardDoc(id), {
        title: data.title || "Bez názvu",
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || "",
        createdMs: data.createdMs || Date.now(),
        createdBy: data.createdBy || window.KB_USER || ""
    }, { merge: true });
    return id;
};

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

/* ------------------------------------------------------------------- logy */

KB.logLogin = async (name) => {
    try {
        if (authReady) await authReady;
        requireDb();
        await addDoc(collection(db, "artifacts", APP_ID, "public", "data", "logs"), {
            userName: name, action: "login", timestamp: serverTimestamp()
        });
    } catch (err) {
        console.warn("Log se nepodařilo zapsat.", err);
    }
};

emit("boot");
