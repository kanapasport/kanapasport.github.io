/* Přesčas a absence: částečná absence skutečnými hodinami, náhradní volno
   čerpá přesčas (Volno = −8), absence na státní svátek se nepočítá a nečerpá
   dovolenou, OSVČ a student fond nemají, chybějící pracovní dny, přesčas
   z doby před webem, víkend. Pouští SKUTEČNÝ kód z assets/js/vykazy.js
   (`V.zustatek`, `V.hodinyKFondu`, `V.chybejiciDny`, `V.maFond`,
   `V.prescasVeden`, `V.pracovniDnyIso`, `V.podezreleZapisy`) nad
   podvrženými daty – ne kopii logiky.

   PATŘÍ DO: D:\CLAUDE_PRACOVNI\NASTROJE\web\testy\test_prescas_absence.js
   (nahrazuje starší verzi z 14. 10. 2026; ve worktree leží v _testy\,
   protože mimo něj agent zapisovat nesmí).

   Kopie webu: proměnná WEB_BASE nebo 1. argument; bez nich kopie, ve které
   test leží (..\ od složky testu, když tam je assets\js\vykazy.js), jinak
   hlavní kopie:
     set WEB_BASE=D:\…\kopie_webu
     "C:\Program Files\FARO\SCENE\LidarOS\node\node.exe" test_prescas_absence.js */
const fs = require("fs");
const path = require("path");
const zadano = process.env.WEB_BASE || process.argv[2] || "";
const vedle = path.resolve(__dirname, "..");
const KOREN = zadano || (fs.existsSync(path.join(vedle, "assets", "js", "vykazy.js")) ? vedle
    : "D:\\CLAUDE_PRACOVNI\\NASTROJE\\web\\WEB_pasportkana_2.0");
const CESTA = path.join(KOREN, "assets", "js", "vykazy.js");

/* vykazy.js je IIFE, která si věší V na window – stačí mu tedy podvrhnout
   okno a pár funkcí, které z něj používá. Svátky se zapínají po jednom
   (`svatky[iso] = název`), výchozí kalendář je bez nich. */
const svatky = {};
const okno = {
    KB: { vykazy: [], zustatky: {}, users: [], ukoly: [], vykazyOknoOd: "" },
    KBUI: {
        svatek: (iso) => svatky[iso] || "",
        // stejný vzorec jako UI.typUvazku v ui.js
        typUvazku: (u) => (u && u.typ) || ((u && u.role === "student") ? "student" : "zamestnanec"),
        esc: (x) => x, kc: (x) => x, toast: () => {}
    },
    document: { addEventListener: () => {}, querySelectorAll: () => [],
                getElementById: () => null, createElement: () => ({ style: {}, click: () => {} }) },
    localStorage: { getItem: () => null, setItem: () => {} },
    URL: { createObjectURL: () => "", revokeObjectURL: () => {} }
};
okno.window = okno;

const kod = fs.readFileSync(CESTA, "utf8");
new Function("window", "document", "localStorage", "URL", kod)(
    okno, okno.document, okno.localStorage, okno.URL);
const V = okno.V || okno.KBVYK;
if (!V || !V.zustatek || !V.hodinyKFondu || !V.chybejiciDny || !V.maFond || !V.pracovniDnyIso) {
    console.error("V.zustatek / V.hodinyKFondu / V.chybejiciDny / V.maFond / V.pracovniDnyIso se nenačetly z " + CESTA);
    process.exit(1);
}
console.log("kopie webu: " + KOREN);

let chyb = 0;
function je(nazev, skutek, cekano) {
    const a = JSON.stringify(skutek), b = JSON.stringify(cekano);
    if (a === b) { console.log("ok   " + nazev); return; }
    chyb++;
    console.error("CHYBA " + nazev + "\n   je: " + a + "\n   má: " + b);
}

/** Nachystá zápisy jednoho člověka a spočítá zůstatek k `doIso`. */
function prescasZa(zapisy, odIso, doIso, zustatek) {
    okno.KB.zustatky = { u1: Object.assign({ odIso: odIso, prescasPred: 0, narok: 0, cerpanoPred: 0 }, zustatek || {}) };
    okno.KB.vykazy = zapisy.map((z, i) => Object.assign({ id: "z" + i, uid: "u1" }, z));
    /* V.dnesISO() bere skutečné dnes – test proto staví období tak, aby
       `doIso` byl pracovní den v minulosti a fond se dal spočítat ručně. */
    const puvodniDnes = V.dnesISO;
    V.dnesISO = () => doIso;
    const v = V.zustatek("u1");
    V.dnesISO = puvodniDnes;
    return v;
}

/* Středa 2026-10-14 – jeden pracovní den, fond 8 h. */
const DEN = "2026-10-14";

console.log("--- jeden pracovní den, fond 8 h ---");
je("osm hodin práce = bez přesčasu",
   prescasZa([{ datum: DEN, hodiny: 8 }], DEN, DEN).prescas, 0);

/* Částečná absence: doktor 1,5 h ráno + 6,5 h práce = osmihodinový den. */
je("doktor 1,5 h + práce 6,5 h = bez přesčasu",
   prescasZa([
       { datum: DEN, hodiny: 1.5, absence: true, zakazka: "Doktor" },
       { datum: DEN, hodiny: 6.5 }
   ], DEN, DEN).prescas, 0);

je("celodenní dovolená = bez přesčasu",
   prescasZa([{ datum: DEN, hodiny: 8, absence: true, zakazka: "Dovolená" }], DEN, DEN).prescas, 0);

je("nemoc celý den = bez přesčasu",
   prescasZa([{ datum: DEN, hodiny: 8, absence: true, zakazka: "Nemoc" }], DEN, DEN).prescas, 0);

je("školení 8,5 h se počítá celé",
   prescasZa([{ datum: DEN, hodiny: 8.5, absence: true, zakazka: "Školení" }], DEN, DEN).prescas, 0.5);

je("práce přes osm hodin dělá přesčas",
   prescasZa([{ datum: DEN, hodiny: 10 }], DEN, DEN).prescas, 2);

console.log("\n--- náhradní volno čerpá přesčas (Michal 26. 10. 2026) ---");
je("celý den volna = −8 (hodiny volna se k fondu nepřičítají)",
   prescasZa([{ datum: DEN, hodiny: 8, absence: true, zakazka: "Volno" }], DEN, DEN).prescas, -8);
je("půlden volna a nic víc = −8, ne −4 (volno nic nenahrazuje)",
   prescasZa([{ datum: DEN, hodiny: 4, absence: true, zakazka: "Volno" }], DEN, DEN).prescas, -8);
je("půlden volna + 4 h práce = −4",
   prescasZa([
       { datum: DEN, hodiny: 4, absence: true, zakazka: "Volno" },
       { datum: DEN, hodiny: 4 }
   ], DEN, DEN).prescas, -4);
je("volno s naběhaným přesčasem: +8 z dřívějška − 8 = 0",
   prescasZa([{ datum: DEN, hodiny: 8, absence: true, zakazka: "Volno" }], DEN, DEN, { prescasPred: 8 }).prescas, 0);
je("volno dovolenou nečerpá",
   prescasZa([{ datum: DEN, hodiny: 8, absence: true, zakazka: "Volno" }], DEN, DEN, { narok: 20 }).zbyva, 20);
je("hodinyKFondu: práce celá, doktor celý, volno nula (i podle názvu bez příznaku), prázdno nula",
   [V.hodinyKFondu({ hodiny: 7.5 }), V.hodinyKFondu({ hodiny: 1.5, absence: true, zakazka: "Doktor" }),
    V.hodinyKFondu({ hodiny: 8, absence: true, zakazka: "Volno" }), V.hodinyKFondu({ hodiny: 8, zakazka: "Volno" }),
    V.hodinyKFondu(null)],
   [7.5, 1.5, 0, 0, 0]);

console.log("\n--- celý týden dovolené nesmí shodit přesčas do mínusu ---");
const tyden = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]
    .map(d => ({ datum: d, hodiny: 8, absence: true, zakazka: "Dovolená" }));
je("pět dní dovolené = nula",
   prescasZa(tyden, "2026-10-12", "2026-10-16").prescas, 0);
je("...a čerpá pět dní nároku",
   prescasZa(tyden, "2026-10-12", "2026-10-16").dovolenaDnu, 5);

console.log("\n--- státní svátek: absence se nepočítá a nečerpá nárok ---");
/* Středa 28. 10. 2026 – Den vzniku samostatného československého státu. */
const SVATEK = "2026-10-28";
svatky[SVATEK] = "Den vzniku samostatného československého státu";
const tydenSeSvatkem = ["2026-10-26", "2026-10-27", SVATEK, "2026-10-29", "2026-10-30"];
je("pracovní dny týdne přes 28. 10. jsou čtyři (svátek se přeskočí)",
   V.pracovniDnyIso("2026-10-26", "2026-10-30"), ["2026-10-26", "2026-10-27", "2026-10-29", "2026-10-30"]);
je("fond týdne přes svátek = 32 h", V.fondHodin("2026-10-26", "2026-10-30"), 32);
je("pracovní dny: obráceně nebo jen víkend = nic",
   [V.pracovniDnyIso("2026-10-16", "2026-10-12"), V.pracovniDnyIso("2026-10-17", "2026-10-18")], [[], []]);
const dovolenaPresSvatek = prescasZa(
    tydenSeSvatkem.map(d => ({ datum: d, hodiny: 8, absence: true, zakazka: "Dovolená" })),
    "2026-10-26", "2026-10-30", { narok: 20 });
je("dovolená pět dní přes svátek: přesčas 0 (4 × 8 proti fondu 32)", dovolenaPresSvatek.prescas, 0);
je("...a čerpá jen čtyři dny nároku", [dovolenaPresSvatek.dovolenaDnu, dovolenaPresSvatek.zbyva], [4, 16]);
const jenSvatek = prescasZa([{ datum: SVATEK, hodiny: 8, absence: true, zakazka: "Dovolená" }], SVATEK, SVATEK, { narok: 20 });
je("dovolená jen na svátek: 0 h, fond 0, nárok nedotčený",
   [jenSvatek.prescas, jenSvatek.fond, jenSvatek.dovolenaDnu, jenSvatek.zbyva], [0, 0, 0, 20]);
je("absenceNaSvatek pozná absenci podle příznaku i názvu, práci ne",
   [V.absenceNaSvatek({ datum: SVATEK, absence: true, zakazka: "Nemoc" }), V.absenceNaSvatek({ datum: SVATEK, zakazka: "Volno" }),
    V.absenceNaSvatek({ datum: SVATEK, hodiny: 8 }), V.absenceNaSvatek({ datum: DEN, absence: true, zakazka: "Nemoc" })],
   [true, true, false, false]);
je("práce na svátek je celá přesčas (fond je nula)",
   prescasZa([{ datum: SVATEK, hodiny: 8 }], SVATEK, SVATEK).prescas, 8);
je("hodinyKFondu: dovolená na svátek nula, práce na svátek celá",
   [V.hodinyKFondu({ datum: SVATEK, hodiny: 8, absence: true, zakazka: "Dovolená" }), V.hodinyKFondu({ datum: SVATEK, hodiny: 6 })],
   [0, 6]);

console.log("\n--- absence na svátek v podezřelých zápisech (manažer) ---");
const DNES = "2026-11-20";                              // pátek, 28. 10. je víc než 14 dní zpátky
const podezrele = V.podezreleZapisy([
    { id: "s1", uid: "u1", datum: SVATEK, zakazka: "Dovolená", absence: true, od: "00:00", do: "23:59", hodiny: 8 },
    { id: "s2", uid: "u1", datum: SVATEK, zakazka: "Doktor", absence: true, od: "08:00", do: "09:00", hodiny: 1 },
    { id: "s3", uid: "u2", datum: SVATEK, hodiny: 8, od: "08:00", do: "16:00" },
    { id: "s4", uid: "u2", datum: "2026-10-29", zakazka: "Dovolená", absence: true, od: "00:00", do: "23:59", hodiny: 8 }
], { dnes: DNES, ukoly: [] });
const svatekHlaseni = podezrele.filter(x => x.druh === "svatek");
je("jedno hlášení za den a člověka, i starší než 14 dní", svatekHlaseni.map(x => x.klic), ["u1|" + SVATEK + "|svatek"]);
je("hlášení nese datum a název svátku",
   svatekHlaseni[0] && /28\. 10\. 2026/.test(svatekHlaseni[0].duvod) && /československého/.test(svatekHlaseni[0].duvod), true);
je("práce na svátek ani absence v běžný den se nehlásí", podezrele.filter(x => x.uid === "u2").length, 0);

console.log("\n--- OSVČ a student fond nemají ---");
je("maFond: zaměstnanec ano; OSVČ, student (typ i role), bez člověka ne",
   [V.maFond({ typ: "zamestnanec" }), V.maFond({}), V.maFond({ typ: "osvc" }), V.maFond({ typ: "student" }),
    V.maFond({ role: "student" }), V.maFond(null)],
   [true, true, false, false, false, false]);
okno.KB.users = [{ id: "u1", typ: "osvc" }, { id: "u2", typ: "zamestnanec" }, { id: "u3", typ: "zamestnanec" }];
okno.KB.zustatky = { u1: { odIso: DEN, prescasPred: 40 }, u2: { odIso: DEN }, u3: { odIso: DEN, bezPrescasu: true } };
je("prescasVeden: OSVČ ne (ani s nastaveným zůstatkem), zaměstnanec ano, vypnutý v Nastavení ne, neznámý ne",
   [V.prescasVeden("u1"), V.prescasVeden("u2"), V.prescasVeden("u3"), V.prescasVeden("nikdo")],
   [false, true, false, false]);
okno.KB.users = [];

console.log("\n--- chybějící pracovní dny ---");
/* Pondělí 12. 10. – pátek 16. 10. 2026; zápisy 12., 13. (práce) a 15. (absence). */
okno.KB.zustatky = { u1: { odIso: "2026-10-12" } };
okno.KB.vykazy = [
    { id: "a", uid: "u1", datum: "2026-10-12", hodiny: 8 },
    { id: "b", uid: "u1", datum: "2026-10-13", hodiny: 2 },
    { id: "c", uid: "u1", datum: "2026-10-15", hodiny: 8, absence: true, zakazka: "Dovolená" },
    { id: "d", uid: "u2", datum: "2026-10-14", hodiny: 8 }
];
je("chybí 14. a 16. (absence je zápis, cizí zápis se nepočítá, víkend ne)",
   V.chybejiciDny("u1", "2026-10-18"), ["2026-10-14", "2026-10-16"]);
je("do dne včetně", V.chybejiciDny("u1", "2026-10-14"), ["2026-10-14"]);
je("zadaný začátek zužuje (pozdější z obou platí)",
   [V.chybejiciDny("u1", "2026-10-16", "2026-10-15"), V.chybejiciDny("u1", "2026-10-16", "2026-10-01")],
   [["2026-10-16"], ["2026-10-14", "2026-10-16"]]);
svatky["2026-10-14"] = "zkušební svátek";
je("svátek nechybí", V.chybejiciDny("u1", "2026-10-16"), ["2026-10-16"]);
delete svatky["2026-10-14"];
je("bez data začátku nic (web historii nevede)", (() => {
    okno.KB.zustatky = {};
    return V.chybejiciDny("u1", "2026-10-16");
})(), []);
je("bez zůstatku, ale se zadaným začátkem (uzávěrka) – počítá se od něj",
   V.chybejiciDny("u1", "2026-10-16", "2026-10-12"), ["2026-10-14", "2026-10-16"]);
je("bez člověka nebo dne nic", [V.chybejiciDny("", "2026-10-16", "2026-10-12"), V.chybejiciDny("u1", "", "2026-10-12")], [[], []]);
const zapisyTydne = okno.KB.vykazy.filter(z => z.uid === "u1").map(z => Object.assign({}, z, { id: undefined }));
const seZustatkem = prescasZa(zapisyTydne, "2026-10-12", "2026-10-16");
je("zůstatek vyjmenuje chybějící dny do včerejška (16. je dnes)", seZustatkem.chybi, ["2026-10-14"]);
je("…a fond za ně běží dál: 8 + 2 + 8 − 40 = −22", seZustatkem.prescas, -22);
je("vypnutý přesčas = bez výčtu", prescasZa(zapisyTydne, "2026-10-12", "2026-10-16", { bezPrescasu: true }).chybi, []);
je("před oknem dat manažera se dny nehlásí", (() => {
    okno.KB.vykazyOknoOd = "2026-10-15";
    const r = prescasZa(zapisyTydne, "2026-10-12", "2026-10-16");
    okno.KB.vykazyOknoOd = "";
    return [r.chybi, r.neuplne];
})(), [[], true]);

console.log("\n--- přesčas z doby před webem ---");
je("prescasPred se přičte: 10 + 8 − 8 = 10",
   prescasZa([{ datum: DEN, hodiny: 8 }], DEN, DEN, { prescasPred: 10 }).prescas, 10);
je("záporný prescasPred: −5 + 10 − 8 = −3",
   prescasZa([{ datum: DEN, hodiny: 10 }], DEN, DEN, { prescasPred: -5 }).prescas, -3);
je("prescasPred jako text ze starého zápisu", prescasZa([{ datum: DEN, hodiny: 8 }], DEN, DEN, { prescasPred: "2.5" }).prescas, 2.5);

console.log("\n--- víkend ---");
const SOBOTA = "2026-10-17";
je("sobota: fond 0, práce 8 h je celá přesčas",
   [prescasZa([{ datum: SOBOTA, hodiny: 8 }], SOBOTA, SOBOTA).fond, prescasZa([{ datum: SOBOTA, hodiny: 8 }], SOBOTA, SOBOTA).prescas], [0, 8]);
je("fond pondělí–neděle = 40 h", V.fondHodin("2026-10-12", "2026-10-18"), 40);
je("týden práce + sobota 4 h = +4",
   prescasZa(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", SOBOTA]
       .map(d => ({ datum: d, hodiny: d === SOBOTA ? 4 : 8 })), "2026-10-12", "2026-10-18").prescas, 4);

console.log("\n--- co to dělalo dřív (paušální směna) ---");
/* Kdyby se absence počítala osmi hodinami bez ohledu na skutečnost, vyšel
   by den „doktor 1,5 h + práce 6,5 h" na +6,5 h. Test to hlídá, ať se to nevrátí. */
const castecna = prescasZa([
    { datum: DEN, hodiny: 1.5, absence: true, zakazka: "Doktor" },
    { datum: DEN, hodiny: 6.5 }
], DEN, DEN);
je("fond jednoho dne je osm hodin", castecna.fond, 8);
je("odpracováno se počítá bez absence", castecna.prace, 6.5);
je("přesčas není 6,5 jako dřív", castecna.prescas !== 6.5, true);

console.log(chyb ? "\n" + chyb + " chyb" : "\nvšechno sedí");
process.exit(chyb ? 1 : 0);
