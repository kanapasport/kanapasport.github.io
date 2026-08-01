/* Převod TTF -> WOFF1 (zlib je v Node, žádná externí knihovna).
   WOFF1 = stejné tabulky jako TTF, jen zabalené zlibem + jiná hlavička.
   Podporuje ho každý prohlížeč od iOS 5 / Chrome 6 výš.            */

const fs = require("fs");
const zlib = require("zlib");

function convert(inPath, outPath, dropTables = []) {
    const src = fs.readFileSync(inPath);
    const dv = new DataView(src.buffer, src.byteOffset, src.length);

    const flavor = dv.getUint32(0);
    const numAll = dv.getUint16(4);

    // původní adresář tabulek
    let entries = [];
    for (let i = 0; i < numAll; i++) {
        const o = 12 + i * 16;
        entries.push({
            tag: src.toString("ascii", o, o + 4),
            checksum: dv.getUint32(o + 4),
            offset: dv.getUint32(o + 8),
            length: dv.getUint32(o + 12)
        });
    }
    entries = entries.filter(e => dropTables.indexOf(e.tag) === -1);
    entries.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));   // WOFF chce vzestupně podle tagu

    const pad4 = (n) => (n + 3) & ~3;
    const numTables = entries.length;
    const totalSfntSize = 12 + numTables * 16 + entries.reduce((s, e) => s + pad4(e.length), 0);

    // data tabulek – zabalit, pokud to pomůže
    let offset = 44 + numTables * 20;
    const blocks = [];
    for (const e of entries) {
        const raw = src.subarray(e.offset, e.offset + e.length);
        const packed = zlib.deflateSync(raw, { level: 9 });
        const use = packed.length < raw.length ? packed : raw;
        e.woffOffset = offset;
        e.compLength = use.length;
        blocks.push(use);
        offset += pad4(use.length);
    }
    const totalLength = offset;

    const out = Buffer.alloc(totalLength, 0);
    out.write("wOFF", 0, "ascii");
    out.writeUInt32BE(flavor, 4);
    out.writeUInt32BE(totalLength, 8);
    out.writeUInt16BE(numTables, 12);
    out.writeUInt16BE(0, 14);
    out.writeUInt32BE(totalSfntSize, 16);
    out.writeUInt16BE(1, 20);   // majorVersion
    out.writeUInt16BE(0, 22);   // minorVersion
    // metaOffset/Length/OrigLength a privOffset/Length zůstávají nulové

    entries.forEach((e, i) => {
        const o = 44 + i * 20;
        out.write(e.tag, o, "ascii");
        out.writeUInt32BE(e.woffOffset, o + 4);
        out.writeUInt32BE(e.compLength, o + 8);
        out.writeUInt32BE(e.length, o + 12);
        out.writeUInt32BE(e.checksum, o + 16);
    });
    entries.forEach((e, i) => blocks[i].copy(out, e.woffOffset));

    fs.writeFileSync(outPath, out);
    return { from: src.length, to: out.length, tables: numTables };
}

const jobs = [
    ["C:/Users/Michal/Desktop/PRACE/CAD/_Standardizace/FONTY/lato.semibold.ttf", "assets/fonts/lato-semibold.woff"],
    ["C:/Users/Michal/Desktop/PRACE/CAD/_Standardizace/FONTY/lato.black.ttf", "assets/fonts/lato-black.woff"]
];

fs.mkdirSync("assets/fonts", { recursive: true });
for (const [from, to] of jobs) {
    const r = convert(from, to);
    console.log(to.padEnd(30), (r.from / 1024).toFixed(0) + " kB TTF ->", (r.to / 1024).toFixed(0) + " kB WOFF (" +
        Math.round(r.to / r.from * 100) + " %), tabulek: " + r.tables);
}
