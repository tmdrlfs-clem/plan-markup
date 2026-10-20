// Writes fixtures/btx/synthetic.btx: a small Revu-style tool set with made-up
// content only (no client data), shaped like the real files: UTF-8 BOM, CRLF,
// every Title/ID/Data/Raw value hex of a zlib stream, BBObjPtr references,
// stream padding before `endstream`, a group with a Child.
// Usage: node scripts/spike-btx/make-synthetic.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/btx/synthetic.btx");

const ID = {
  stampForm: "SYNTHSTAMPFORMAA",
  nestedForm: "SYNTHNESTEDFORMA",
  font: "SYNTHFONTHELVAAA",
  fontDescriptor: "SYNTHFONTDESCAAA",
};
for (const id of Object.values(ID)) if (!/^[A-Z]{16}$/.test(id)) throw new Error(`bad id ${id}`);

const hexZ = (data) => zlib.deflateSync(Buffer.from(data, "latin1"), { level: 9 }).toString("hex");
const ref = (id) => `/BBObjPtr_${id}`;
const utf16Hex = (s) => `<feff${[...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")}>`;

/** A dictionary + stream body like Revu writes it: padding newlines before endstream. */
function streamObject(dictBody, content, { flate = false } = {}) {
  const data = flate ? zlib.deflateSync(Buffer.from(content, "latin1")) : Buffer.from(content, "latin1");
  const filter = flate ? "/Filter/FlateDecode" : "";
  return `<</Length ${data.length}${dictBody}${filter}>>\nstream\n${data.toString("latin1")}${"\n".repeat(12)}endstream`;
}

// Helvetica-like widths for codes 32..90 (approximate; the glyphs come from the standard font).
const widths = Array.from({ length: 90 - 32 + 1 }, (_, i) => (i === 0 ? 278 : 667)).join(" ");

const resources = {
  [ID.stampForm]: streamObject(
    `/Type/XObject/Subtype/Form/FormType 1/BBox[100 200 140 220]/Matrix[1 0 0 1 -100 -200]` +
      `/Resources<</ProcSet[/PDF/Text]/XObject<</Fm0${ref(ID.nestedForm)}>>/Font<</F1${ref(ID.font)}>>>>`,
    "q\n1 0 0 RG\n1 w\n100.5 200.5 39 19 re\nS\n/Fm0 Do\nBT\n/F1 8 Tf\n1 0 0 rg\n104 207 Td\n(HEAD) Tj\nET\nQ\n",
    { flate: true },
  ),
  [ID.nestedForm]: streamObject(
    `/Type/XObject/Subtype/Form/FormType 1/BBox[100 200 140 220]/Resources<</ProcSet[/PDF]>>`,
    "0 0 1 rg\n130 205 6 10 re\nf\n",
  ),
  [ID.font]:
    `<</Type/Font/Subtype/TrueType/BaseFont/Helvetica/FirstChar 32/LastChar 90` +
    `/Widths[${widths}]/Encoding/WinAnsiEncoding/FontDescriptor${ref(ID.fontDescriptor)}>>`,
  [ID.fontDescriptor]:
    `<</Type/FontDescriptor/FontName/Helvetica/Flags 32/FontBBox[-166 -225 1000 931]` +
    `/ItalicAngle 0/Ascent 718/Descent -207/CapHeight 718/StemV 88>>`,
};

const items = [
  {
    name: "Synthetic head",
    type: "Bluebeam.PDF.Annotations.AnnotationBRXStamp",
    resources: [ID.stampForm, ID.nestedForm, ID.font, ID.fontDescriptor],
    raw:
      `<</TmpScaleX 1/TmpScaleY 1/TmpBorderIndicator true/IT/StampSnapshot/AP<</N${ref(ID.stampForm)}>>` +
      `/Rotation 0/Subj(Synthetic head)/Subtype/Stamp/Rect[0 0 40 20]/F 4/C[1 0 0]>>`,
    x: 0,
    y: 0,
    index: 0,
  },
  {
    name: "Synthetic sounder",
    type: "Bluebeam.PDF.Annotations.AnnotationCircle",
    raw:
      `<</IC[1 1 0]/RD[1 1 1 1]/TempBBox[0 0 24 16]/FillOpacity 0.5/Subj${utf16Hex("Synthetic sounder")}` +
      `/Subtype/Circle/Rect[0 0 24 16]/F 4/C[1 0 0]/BS<</W 2/S/D/Type/Border/D[3 2]>>>>`,
    x: 0,
    y: 0,
    index: 1,
  },
  {
    name: "Synthetic group",
    type: "Bluebeam.PDF.Annotations.AnnotationCircle",
    raw:
      `<</RD[1.5 1.5 1.5 1.5]/TempBBox[0 0 20 20]/Subj(Synthetic ring)/TempRT/Group/TempIRT/SYNTHGROUPAAAAAA` +
      `/TempGroupNestingName/SYNTHRINGAAAAAAA/Subtype/Circle/Rect[0 0 20 20]/F 4/C[0 0 1]/BS<</W 3/S/S/Type/Border>>>>`,
    x: 1.5,
    y: 1.5,
    index: 2,
    children: [
      {
        type: "Bluebeam.PDF.Annotations.AnnotationCircle",
        raw:
          `<</IC[0 0 1]/RD[0 0 0 0]/TempBBox[0 0 8 8]/Subj(Synthetic dot)/TempNameID/SYNTHGROUPAAAAAA` +
          `/TempGroupNestingName/SYNTHDOTAAAAAAAA/Subtype/Circle/Rect[0 0 8 8]/F 4/C[0 0 1]/BS<</W 0/S/S/Type/Border>>>>`,
        x: -4.5,
        y: -4.5,
        index: 3,
      },
    ],
  },
  {
    name: "Synthetic pipe",
    type: "Bluebeam.PDF.Annotations.AnnotationPolyline",
    raw:
      `<</Vertices[4 4 14 16 24 6 34 18]/IC[0 0.5 0]/Subj(Synthetic pipe)/Subtype/PolyLine` +
      `/Rect[0 0 38 22]/F 4/C[0 0.5 0]/BS<</W 2/S/S/Type/Border>>>>`,
    x: 4,
    y: 4,
    index: 4,
  },
  {
    name: "Synthetic arrow",
    type: "Bluebeam.PDF.Annotations.AnnotationLine",
    raw:
      `<</L[4 10 40 10]/LE[/None/OpenArrow]/Subj(Synthetic arrow)/Subtype/Line` +
      `/Rect[0 0 44 20]/F 4/C[0 0 0]/BS<</W 1.5/S/S/Type/Border>>>>`,
    x: 4,
    y: 10,
    index: 5,
  },
];

export function makeSyntheticBtx() {
  const L = [];
  L.push('<?xml version="1.0" encoding="utf-8"?>');
  L.push('<BluebeamRevuToolSet Version="1">');
  L.push(`  <Title>${hexZ("Synthetic Tools")}</Title>`);
  for (const it of items) {
    L.push('  <ToolChestItem Version="1">');
    for (const id of it.resources ?? []) {
      L.push("    <Resources>");
      L.push(`      <ID>${hexZ(id)}</ID>`);
      L.push(`      <Data>${hexZ(resources[id])}</Data>`);
      L.push("    </Resources>");
    }
    L.push(`    <Name>${it.name}</Name>`);
    L.push(`    <Type>${it.type}</Type>`);
    L.push(`    <Raw>${hexZ(it.raw)}</Raw>`);
    L.push(`    <X>${it.x}</X>`);
    L.push(`    <Y>${it.y}</Y>`);
    L.push(`    <Index>${it.index}</Index>`);
    for (const c of it.children ?? []) {
      L.push("    <Child>");
      L.push(`      <Type>${c.type}</Type>`);
      L.push(`      <Raw>${hexZ(c.raw)}</Raw>`);
      L.push(`      <X>${c.x}</X>`);
      L.push(`      <Y>${c.y}</Y>`);
      L.push(`      <Index>${c.index}</Index>`);
      L.push("    </Child>");
    }
    L.push("    <Mode>drawing</Mode>");
    L.push("  </ToolChestItem>");
  }
  L.push("</BluebeamRevuToolSet>");
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(L.join("\r\n") + "\r\n", "utf8")]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, makeSyntheticBtx());
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
}
