import assert from 'node:assert/strict';
import test from 'node:test';
import { jsPDF } from 'jspdf';
import { addPjSignatureFields } from './pdfBranding.js';
import { getPjTimesheetSnapshot, pjPdfHoursDetails } from './pjTimesheet.js';

test('PJ report uses the São Paulo cutoff and deducts the existing break for closed shifts', () => {
  const closed = { data: '2026-11-15', entrada: '08:00:00', saida: '16:00:00', tipo_contrato: 'pj' };
  const ongoing = { data: '2026-11-16', entrada: '09:00:00' };
  const stale = { data: '2026-11-13', entrada: '09:00:00', tipo_contrato: 'pj' };
  const future = { data: '2026-11-17', entrada: '09:00:00', saida: '12:00:00', tipo_contrato: 'pj' };
  const clt = { data: '2026-11-14', entrada: '09:00:00', saida: '18:00:00', tipo_contrato: 'clt' };
  const snapshot = getPjTimesheetSnapshot([stale, clt, closed, ongoing, future], new Date('2026-11-16T15:30:00Z'), 'pj');
  assert.equal(snapshot.closedMinutes, 420);
  assert.equal(snapshot.provisionalMinutes, 210);
  assert.equal(snapshot.rows.get(ongoing).status, 'Em andamento*');
  assert.equal(snapshot.rows.get(stale).status, 'Incompleto');
  assert.equal(snapshot.rows.get(future).hideExit, true);
  assert.equal(snapshot.rows.has(clt), false);
  assert.match(pjPdfHoursDetails(snapshot)[0], /10h 30min/);
});

test('a recent PJ shift can cross midnight and old missing exits are not estimated', () => {
  const pjShift = { data: '2026-11-15', entrada: '23:30:00', tipo_contrato: 'pj' };
  const cltShift = { data: '2026-11-16', entrada: '01:00:00', tipo_contrato: 'clt' };
  const cutoff = new Date('2026-11-16T04:30:00Z');
  assert.equal(getPjTimesheetSnapshot([pjShift], cutoff, 'pj').provisionalMinutes, 120);
  assert.equal(getPjTimesheetSnapshot([pjShift, cltShift], cutoff, 'pj').provisionalMinutes, null);
  assert.equal(getPjTimesheetSnapshot([pjShift], new Date('2026-11-17T04:30:00Z'), 'pj').provisionalMinutes, null);
});

test('both digital signatures are PDF signature widgets and fit after a full timesheet', () => {
  const pdf = new jsPDF({ orientation: 'landscape' });
  addPjSignatureFields(pdf, 185);
  assert.equal(pdf.getNumberOfPages(), 2);
  const serialized = pdf.output();
  assert.equal((serialized.match(/\/FT \/Sig\b/g) ?? []).length, 2);
  assert.equal((serialized.match(/\/Subtype \/Widget\b/g) ?? []).length, 2);
  assert.match(serialized, /\/T \(Assinatura_Prestador_PJ\)/);
  assert.match(serialized, /\/T \(Assinatura_Responsavel_Empresa\)/);
  assert.match(serialized, /\/SigFlags 3/);
});
