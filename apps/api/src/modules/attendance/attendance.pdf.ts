import PDFDocument from 'pdfkit';
import type { MonthlyRegister } from '@ssms/shared';

export interface RegisterPdfInput {
  schoolName: string;
  logoDataUrl: string;
  sessionName: string;
  className: string;
  sectionName: string;
  register: MonthlyRegister;
  threshold: number;
}

const ROWS_PER_PAGE = 22;
const MARGIN = 24;
const ROW_H = 16;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Landscape A4 monthly attendance register. Repeats the header on every page and numbers pages "Page x of y". */
export function buildRegisterPdf(input: RegisterPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { register } = input;
    const usable = doc.page.width - MARGIN * 2;
    const cols = { roll: 28, adm: 52, name: 110, sum: 22, wd: 24, pct: 34 };
    const fixed = cols.roll + cols.adm + cols.name + cols.sum * 3 + cols.wd + cols.pct;
    const dayW = (usable - fixed) / register.days;

    const logo = /^data:image\/(png|jpeg);base64,/.test(input.logoDataUrl) ? Buffer.from(input.logoDataUrl.split(',')[1] ?? '', 'base64') : null;

    const drawHeader = (): number => {
      let x = MARGIN;
      if (logo) {
        try {
          doc.image(logo, MARGIN, MARGIN, { fit: [44, 44] });
          x = MARGIN + 52;
        } catch {
          x = MARGIN;
        }
      }
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#111111').text(input.schoolName, x, MARGIN, { width: usable - (x - MARGIN), lineBreak: false });
      doc.font('Helvetica').fontSize(10).fillColor('#333333').text('Monthly Attendance Register', x, MARGIN + 18, { lineBreak: false });
      doc.fontSize(9).text(`Session: ${input.sessionName}    Class: ${input.className}    Section: ${input.sectionName}    Month: ${monthTitle(register.month)}`, x, MARGIN + 32, { lineBreak: false });
      return MARGIN + 52;
    };

    const cell = (text: string, x: number, y: number, w: number, opts: { bold?: boolean; fill?: string; align?: 'left' | 'center'; color?: string } = {}) => {
      if (opts.fill) doc.rect(x, y, w, ROW_H).fill(opts.fill);
      doc.lineWidth(0.4).strokeColor('#888888').rect(x, y, w, ROW_H).stroke();
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7).fillColor(opts.color ?? '#111111');
      doc.text(text, x + 2, y + 4.5, { width: w - 4, align: opts.align ?? 'center', lineBreak: false, ellipsis: true });
    };

    const drawTableHeader = (y: number) => {
      let x = MARGIN;
      const put = (label: string, w: number) => {
        cell(label, x, y, w, { bold: true, fill: '#e5e7eb' });
        x += w;
      };
      put('Roll', cols.roll);
      put('Adm. No', cols.adm);
      put('Student Name', cols.name);
      for (let d = 1; d <= register.days; d++) put(String(d), dayW);
      put('P', cols.sum);
      put('A', cols.sum);
      put('L', cols.sum);
      put('WD', cols.wd);
      put('%', cols.pct);
    };

    type Row = { kind: 'student'; i: number } | { kind: 'totals' };
    const rows: Row[] = [...register.rows.map((_, i): Row => ({ kind: 'student', i })), { kind: 'totals' }];
    const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    const pct = (v: number | null) => (v === null ? '-' : `${v}%`);

    for (let p = 0; p < pages; p++) {
      if (p > 0) doc.addPage();
      let y = drawHeader();
      drawTableHeader(y);
      y += ROW_H;
      for (const row of rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE)) {
        let x = MARGIN;
        if (row.kind === 'totals') {
          cell('Totals', x, y, cols.roll + cols.adm + cols.name, { bold: true, fill: '#f3f4f6', align: 'left' });
          x += cols.roll + cols.adm + cols.name + dayW * register.days;
          cell(String(register.totals.present), x, y, cols.sum, { bold: true, fill: '#f3f4f6' });
          cell(String(register.totals.absent), x + cols.sum, y, cols.sum, { bold: true, fill: '#f3f4f6' });
          cell(String(register.totals.leave), x + cols.sum * 2, y, cols.sum, { bold: true, fill: '#f3f4f6' });
          cell(String(register.workingDays), x + cols.sum * 3, y, cols.wd, { bold: true, fill: '#f3f4f6' });
          cell('', x + cols.sum * 3 + cols.wd, y, cols.pct, { fill: '#f3f4f6' });
        } else {
          const s = register.rows[row.i]!;
          cell(s.rollNumber, x, y, cols.roll);
          x += cols.roll;
          cell(s.admissionNumber, x, y, cols.adm);
          x += cols.adm;
          cell(s.name, x, y, cols.name, { align: 'left' });
          x += cols.name;
          for (const c of s.cells) {
            cell(c, x, y, dayW, { fill: c === 'H' ? '#d1d5db' : undefined, color: c === 'A' ? '#b91c1c' : undefined, bold: c === 'A' });
            x += dayW;
          }
          cell(String(s.summary.present), x, y, cols.sum);
          cell(String(s.summary.absent), x + cols.sum, y, cols.sum);
          cell(String(s.summary.leave), x + cols.sum * 2, y, cols.sum);
          cell(String(register.workingDays), x + cols.sum * 3, y, cols.wd);
          const low = s.summary.percentage !== null && s.summary.percentage < input.threshold;
          cell(pct(s.summary.percentage), x + cols.sum * 3 + cols.wd, y, cols.pct, { bold: low, color: low ? '#b91c1c' : undefined });
        }
        y += ROW_H;
      }
      if (p === pages - 1) {
        doc.font('Helvetica').fontSize(8).fillColor('#333333');
        doc.text(`Legend: P = Present   A = Absent   L = Leave   H = Holiday / weekly off   Blank = not recorded   WD = working days with recorded attendance   % below ${input.threshold}% shown in red`, MARGIN, y + 8, { lineBreak: false });
        const sy = Math.min(y + 36, doc.page.height - 54);
        doc.lineWidth(0.5).strokeColor('#333333');
        for (const [label, x0] of [['Class Teacher', MARGIN + 20], ['Principal', doc.page.width / 2 - 60]] as const) {
          doc.moveTo(x0, sy).lineTo(x0 + 160, sy).stroke();
          doc.text(label, x0, sy + 3, { lineBreak: false });
        }
        doc.moveTo(doc.page.width - MARGIN - 180, sy).lineTo(doc.page.width - MARGIN - 20, sy).stroke();
        doc.text('Date', doc.page.width - MARGIN - 180, sy + 3, { lineBreak: false });
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor('#555555').text(`Page ${i + 1} of ${range.count}`, 0, doc.page.height - 16, { width: doc.page.width, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
