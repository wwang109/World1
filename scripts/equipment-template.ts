import { readFileSync, writeFileSync } from 'node:fs';
import { assertEquipmentDocument } from '../src/data/validateEquipmentContent';

const canonical = new URL('../src/data/content/equipment.v1.json', import.meta.url);
const target = new URL('../docs/templates/equipment.v1.template.json', import.meta.url);
const document: unknown = JSON.parse(readFileSync(canonical, 'utf8'));
assertEquipmentDocument(document);
const expected = JSON.stringify({ ...document, status: 'generated_template_mirror', notes: ['Generated from src/data/content/equipment.v1.json; edit the canonical catalog, then run npm run content:equipment-template.', ...document.notes] }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== expected) throw new Error('equipment template is stale; run npm run content:equipment-template');
  console.log('equipment template current');
} else {
  writeFileSync(target, expected);
  console.log('equipment template generated');
}
