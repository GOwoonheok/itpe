#!/usr/bin/env node
// 면접 문항(data/interview/*.json) → 엑셀(.xlsx) 내보내기.
// 무의존성 — node:zlib 로 zip 을 직접 만든다 (빌드 도구 도입 금지 제약 준수).
//
//   node scripts/export-interview-xlsx.mjs            → data/면접자료/면접자료_YYYYMMDD.xlsx
//   node scripts/export-interview-xlsx.mjs <출력경로>  → 지정 경로로 저장
//
// 앱이 쓰지 않는 확장 필드(block/kind/prob/followupGuard/pitfall/keywords)도
// 있으면 컬럼으로 함께 내보낸다. 없으면 빈 칸.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IV_DIR = path.join(ROOT, 'data', 'interview');

// ── zip (store/deflate) ────────────────────────────────────────────
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();
function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}
function dosTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}
function zip(entries, when) {
    const { time, date } = dosTime(when);
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, content] of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        const deflated = zlib.deflateRawSync(raw, { level: 9 });
        const useDeflate = deflated.length < raw.length;
        const data = useDeflate ? deflated : raw;
        const method = useDeflate ? 8 : 0;
        const crc = crc32(raw);

        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(0x0800, 6); // UTF-8 파일명 플래그
        lh.writeUInt16LE(method, 8);
        lh.writeUInt16LE(time, 10);
        lh.writeUInt16LE(date, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(data.length, 18);
        lh.writeUInt32LE(raw.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        lh.writeUInt16LE(0, 28);
        locals.push(lh, nameBuf, data);

        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0x0800, 8);
        ch.writeUInt16LE(method, 10);
        ch.writeUInt16LE(time, 12);
        ch.writeUInt16LE(date, 14);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(data.length, 20);
        ch.writeUInt32LE(raw.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);
        ch.writeUInt32LE(0, 38); // external attrs
        ch.writeUInt32LE(offset, 42);
        centrals.push(ch, nameBuf);

        offset += lh.length + nameBuf.length + data.length;
    }
    const localBuf = Buffer.concat(locals);
    const centralBuf = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(localBuf.length, 16);
    return Buffer.concat([localBuf, centralBuf, eocd]);
}

// ── xlsx ───────────────────────────────────────────────────────────
const esc = (s) =>
    String(s == null ? '' : s)
        // 엑셀이 거부하는 제어문자 제거 (탭/개행은 유지)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

function colName(i) {
    let s = '';
    i += 1;
    while (i > 0) {
        const r = (i - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        i = Math.floor((i - 1) / 26);
    }
    return s;
}

// styles.xml — 0:기본 1:헤더 2:본문(줄바꿈) 3:본문(가운데) 4:섹션제목
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="10"/><name val="맑은 고딕"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>
<font><sz val="10"/><name val="맑은 고딕"/></font>
<font><b/><sz val="12"/><name val="맑은 고딕"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(rows, widths, opts = {}) {
    const maxCols = Math.max(...rows.map((r) => r.length), 1);
    const cols = widths.length
        ? `<cols>${widths
              .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
              .join('')}</cols>`
        : '';
    const body = rows
        .map((row, ri) => {
            const r = ri + 1;
            const cells = row
                .map((cell, ci) => {
                    const ref = colName(ci) + r;
                    if (cell == null || cell === '') return '';
                    const style = ri === 0 && opts.header !== false ? 1 : typeof cell === 'number' ? 3 : 2;
                    if (typeof cell === 'number' && Number.isFinite(cell)) {
                        return `<c r="${ref}" s="${style}"><v>${cell}</v></c>`;
                    }
                    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`;
                })
                .join('');
            const ht = ri === 0 ? ' ht="26" customHeight="1"' : '';
            return `<row r="${r}"${ht}>${cells}</row>`;
        })
        .join('');
    const freeze =
        opts.header === false
            ? '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
            : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
    const filter =
        opts.header === false || rows.length < 2
            ? ''
            : `<autoFilter ref="A1:${colName(maxCols - 1)}${rows.length}"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colName(
        maxCols - 1
    )}${rows.length}"/>${freeze}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData>${filter}</worksheet>`;
}

function buildXlsx(sheets, when) {
    const files = [
        [
            '[Content_Types].xml',
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
    .map(
        (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
        ],
        [
            '_rels/.rels',
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
        ],
        [
            'xl/workbook.xml',
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets
                .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
                .join('')}</sheets>
</workbook>`,
        ],
        [
            'xl/_rels/workbook.xml.rels',
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
    .map(
        (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
                i + 1
            }.xml"/>`
    )
    .join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
        ],
        ['xl/styles.xml', STYLES],
        ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths || [], s.opts || {})]),
    ];
    return zip(files, when);
}

// ── 데이터 → 시트 ──────────────────────────────────────────────────
const HEADERS = [
    '번호', 'ID', '분류', '블록/도메인', '유형', '출제확률(%)', '질문',
    '① 복명복창', '② 구조화', '③ 개념', '④ 실사례', '꼬리질문 대비', '함정', '필수 키워드',
];
const WIDTHS = [6, 12, 10, 26, 10, 11, 44, 34, 34, 60, 60, 40, 30, 28];

const asList = (v) => (Array.isArray(v) ? v.filter(Boolean).map((x) => '· ' + x).join('\n') : v || '');

function toRows(items) {
    const rows = [HEADERS];
    items.forEach((it, i) => {
        rows.push([
            i + 1,
            it.id || '',
            it.category || '',
            it.block || '',
            it.kind || '',
            typeof it.prob === 'number' ? it.prob : '',
            it.question || '',
            it.restate || '',
            it.structure || '',
            it.concept || '',
            it.case || '',
            asList(it.followupGuard),
            it.pitfall || '',
            Array.isArray(it.keywords) ? it.keywords.join(', ') : it.keywords || '',
        ]);
    });
    return rows;
}

function main() {
    const manifest = JSON.parse(fs.readFileSync(path.join(IV_DIR, 'index.json'), 'utf8'));
    const cats = (manifest.categories || []).map((c) => ({
        ...c,
        items: JSON.parse(fs.readFileSync(path.join(IV_DIR, c.file), 'utf8')),
    }));

    const now = new Date();
    const stamp =
        `${now.getFullYear()}` +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');

    const outArg = process.argv[2];
    const outPath = outArg
        ? path.resolve(outArg)
        : path.join(ROOT, 'data', '면접자료', `면접자료_${stamp}.xlsx`);

    // 요약 시트
    const summary = [
        ['정보관리기술사 면접 대비 문항집', '', ''],
        ['생성일', `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, ''],
        ['', '', ''],
        ['시트', '문항 수', '설명'],
        ...cats.map((c) => [c.name, c.items.length, c.description || '']),
        ['합계', cats.reduce((a, c) => a + c.items.length, 0), ''],
        ['', '', ''],
        ['답변 구조', '', ''],
        ['① 복명복창', '질문을 되짚어 정확히 이해했음을 보이는 첫 문장', ''],
        ['② 구조화', '답변 목차를 미리 선언 — "…와 …, … 순으로 말씀드리겠습니다"', ''],
        ['③ 개념', '핵심 개념의 정의·구성요소·유형·비교. 두괄식', ''],
        ['④ 실사례', '본인 이력과 연결한 적용 사례 + 정량 근거 + 한계/개선', ''],
    ];

    const sheets = [
        { name: '요약', rows: summary, widths: [22, 18, 70], opts: { header: false } },
        ...cats.map((c) => ({ name: c.name, rows: toRows(c.items), widths: WIDTHS })),
    ];

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buildXlsx(sheets, now));

    console.log(`✔ ${outPath}`);
    cats.forEach((c) => console.log(`  - ${c.name}: ${c.items.length}문항`));
}

main();
