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
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
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

const bus = new EventTarget();
const KB = {
    guides: [],
    tasks: [],
    zakazky: [],            // číselník zakázek – aby se překlepem nezakládaly nové
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
const imagesCol = (guideId) => collection(db, "artifacts", APP_ID, "public", "data", "guides", guideId, "images");
const imageDoc = (guideId, imgId) => doc(db, "artifacts", APP_ID, "public", "data", "guides", guideId, "images", imgId);

/* ------------------------------------------------------------------ start */

try {
    const app = initializeApp(FIREBASE_CONFIG);
    auth = getAuth(app);
    db = getFirestore(app);

    authReady = signInAnonymously(auth).catch(err => {
        console.error("Anonymní přihlášení k Firebase selhalo:", err);
        setStatus("offline");
        throw err;
    });

    onAuthStateChanged(auth, (user) => {
        if (!user) return;
        onSnapshot(guidesCol(), (snapshot) => {
            KB.guides = [];
            snapshot.forEach(d => KB.guides.push({ id: d.id, ...d.data() }));
            KB.guides.sort((a, b) => (b.updatedMs || 0) - (a.updatedMs || 0));
            KB.ready = true;
            setStatus("online");
            emit("guides", KB.guides);
        }, (err) => {
            console.error("Chyba čtení databáze:", err);
            setStatus("offline");
        });

        onSnapshot(tasksCol(), (snapshot) => {
            KB.tasks = [];
            snapshot.forEach(d => KB.tasks.push({ id: d.id, ...d.data() }));
            // nejbližší termín nahoře, úkoly bez termínu na konec
            KB.tasks.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
            emit("tasks", KB.tasks);
        }, (err) => console.error("Chyba čtení úkolů:", err));

        onSnapshot(metaDoc("zakazky"), (snap) => {
            const names = snap.exists() ? snap.data().names : null;
            KB.zakazky = Array.isArray(names) ? names : [];
            emit("zakazky", KB.zakazky);
        }, (err) => console.error("Chyba čtení zakázek:", err));
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
 *   { zakazka, title, owner, deadline: "2026-07-31",
 *     subtasks: [{ id, title, percent, by, ms }],
 *     notes:    [{ id, subtaskId, text, author, ms }] }
 * Poznámky jsou uvnitř dokumentu – je jich málo a načtou se rovnou se seznamem.
 */
KB.saveTask = async (id, data) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(taskDoc(id), {
        zakazka:  data.zakazka || "",
        title:    data.title || "Bez názvu",
        owner:    data.owner || "",
        deadline: data.deadline || "",
        subtasks: data.subtasks || [],
        notes:    data.notes || [],
        createdBy: data.createdBy || window.KB_USER || "",
        createdMs: data.createdMs || Date.now(),
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
    return id;
};

/** Uloží číselník zakázek (jeden dokument se seznamem názvů). */
KB.saveZakazky = async (names) => {
    if (authReady) await authReady;
    requireDb();
    await setDoc(metaDoc("zakazky"), {
        names: names,
        updatedMs: Date.now(),
        updatedBy: window.KB_USER || ""
    }, { merge: true });
};

KB.deleteTask = async (id) => {
    if (authReady) await authReady;
    requireDb();
    await deleteDoc(taskDoc(id));
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
