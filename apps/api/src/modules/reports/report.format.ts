import type { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ReportTable {
  title: string;
  subtitle: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

/** Spreadsheet formula injection guard for user-controlled text. */
const safeCell = (v: string | number): string | number => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

async function toXlsx(t: ReportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.title.slice(0, 31));
  ws.addRow([t.title]).font = { bold: true, size: 14 };
  ws.addRow([t.subtitle]);
  ws.addRow([]);
  const head = ws.addRow(t.columns);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  for (const row of t.rows) ws.addRow(row.map(safeCell));
  ws.columns.forEach((c) => (c.width = 18));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toPdf(t: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).fillColor('#1d4ed8').text(t.title);
    doc.fontSize(9).fillColor('#444444').text(t.subtitle).moveDown(0.5);
    const width = doc.page.width - 60;
    const colW = width / Math.max(t.columns.length, 1);
    const drawRow = (cells: Array<string | number>, bold: boolean) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(bold ? '#1d4ed8' : '#111111');
      const heights = cells.map((c, i) => doc.heightOfString(String(c), { width: colW - 4 }) + (i ? 0 : 0));
      const h = Math.max(...heights, 10) + 4;
      if (y + h > doc.page.height - 30) {
        doc.addPage();
        return drawRow(cells, bold);
      }
      cells.forEach((c, i) => doc.text(String(c), 30 + i * colW, y, { width: colW - 4 }));
      doc.y = y + h;
      doc.x = 30;
    };
    drawRow(t.columns, true);
    if (!t.rows.length) doc.font('Helvetica').text('No records for the selected filters.');
    for (const row of t.rows) drawRow(row, false);
    doc.end();
  });
}

export async function sendReport(res: Response, t: ReportTable, format: 'json' | 'xlsx' | 'pdf', name: string): Promise<void> {
  if (format === 'json') {
    res.json({ data: t });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.xlsx"`);
    res.send(await toXlsx(t));
    return;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.pdf"`);
  res.send(await toPdf(t));
}
