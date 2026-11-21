#!/usr/bin/env node
// Generira agent token. Token se ispiše JEDNOM; u bazu ide samo hash.
// Upotreba: TOKEN_PEPPER=... node scripts/novi-token.mjs <zakupac> <agent> [alati|*] [izlaz.sql]
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [zakupac, agent, alati = '*', izlaz] = process.argv.slice(2);
const pepper = process.env.TOKEN_PEPPER ?? '';
if (!zakupac || !agent) { console.error('Upotreba: node scripts/novi-token.mjs <zakupac> <agent> [alati|*] [izlaz.sql]'); process.exit(1); }
if (!pepper) console.error('UPOZORENJE: TOKEN_PEPPER nije postavljen (u redu samo za lokalni razvoj).');

const token = 'pl_' + randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(pepper + token).digest('hex');
const esc = (s) => s.replaceAll("'", "''");
const sql = `INSERT INTO agent_tokeni (id, tenant_id, hash, agent, dopusteni_alati) VALUES ('${randomUUID()}', '${esc(zakupac)}', '${hash}', '${esc(agent)}', '${esc(alati)}');\n`;

if (izlaz) writeFileSync(izlaz, sql); else process.stdout.write(`-- SQL:\n${sql}\n`);
console.log(`TOKEN (spremi odmah, više se ne može pročitati): ${token}`);
