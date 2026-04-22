#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvFile(path.join(repoRoot, '.env.local'));
loadEnvFile(path.join(repoRoot, '.env'));

const needle = process.argv[2] ?? 'Mufaddal';

const { Client } = pg;
const client = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL })
  : new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

await client.connect();
try {
  console.log(`\n=== events matching "${needle}" ===`);
  const events = await client.query(
    `SELECT e.id, e.property_id, e.title, e.start_date, e.end_date, e.original_uid, e.source, e.type, p.name AS property
     FROM events e
     LEFT JOIN properties p ON p.id = e.property_id
     WHERE e.title ILIKE '%' || $1 || '%'
     ORDER BY e.start_date DESC`,
    [needle]
  );
  if (!events.rowCount) console.log('  (none)');
  for (const r of events.rows) {
    console.log(`  [${r.id}] ${r.property ?? '?'} ${r.start_date}→${r.end_date} title="${r.title}" origUid=${r.original_uid} src=${r.source} type=${r.type}`);
  }

  console.log(`\n=== bookings matching "${needle}" ===`);
  const bookings = await client.query(
    `SELECT b.id, b.property_id, b.name, b.check_in, b.check_out, b.status, b.source, p.name AS property
     FROM bookings b
     LEFT JOIN properties p ON p.id = b.property_id
     WHERE b.name ILIKE '%' || $1 || '%'
     ORDER BY b.check_in DESC`,
    [needle]
  );
  if (!bookings.rowCount) console.log('  (none)');
  for (const r of bookings.rows) {
    console.log(`  [${r.id}] ${r.property ?? '?'} ${r.check_in}→${r.check_out} name="${r.name}" status=${r.status} src=${r.source}`);
  }

  console.log(`\n=== messages matching "${needle}" (by guest_name) ===`);
  const msgs = await client.query(
    `SELECT m.id, m.event_id, m.property_id, m.guest_name, m.sender, m.source, m.beds24_booking_id, m.created_at, left(m.text, 80) AS preview
     FROM messages m
     WHERE m.guest_name ILIKE '%' || $1 || '%'
     ORDER BY m.created_at DESC
     LIMIT 50`,
    [needle]
  );
  if (!msgs.rowCount) console.log('  (none)');
  for (const r of msgs.rows) {
    console.log(`  [${r.created_at.toISOString()}] eventId=${r.event_id ?? 'NULL'} propId=${r.property_id ?? 'NULL'} beds24=${r.beds24_booking_id ?? '-'} ${r.sender}: ${r.preview}`);
  }

  // If we found events, look up their messages too
  if (events.rowCount) {
    const eventIds = events.rows.map(e => e.id);
    console.log(`\n=== messages linked to matched event ids ===`);
    const linkedMsgs = await client.query(
      `SELECT m.id, m.event_id, m.property_id, m.guest_name, m.sender, m.source, m.created_at, left(m.text, 80) AS preview
       FROM messages m
       WHERE m.event_id = ANY($1::text[])
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [eventIds]
    );
    if (!linkedMsgs.rowCount) console.log('  (none)');
    for (const r of linkedMsgs.rows) {
      console.log(`  [${r.created_at.toISOString()}] eventId=${r.event_id} guest=${r.guest_name} ${r.sender}: ${r.preview}`);
    }
  }

  // If we found bookings, look up their messages too
  if (bookings.rowCount) {
    const bookingIds = bookings.rows.map(b => b.id);
    console.log(`\n=== messages whose event_id matches booking id ===`);
    const bkMsgs = await client.query(
      `SELECT m.id, m.event_id, m.guest_name, m.sender, m.created_at, left(m.text, 80) AS preview
       FROM messages m
       WHERE m.event_id = ANY($1::text[])
       ORDER BY m.created_at DESC`,
      [bookingIds]
    );
    if (!bkMsgs.rowCount) console.log('  (none — messages not linked to any of these booking ids)');
    for (const r of bkMsgs.rows) {
      console.log(`  [${r.created_at.toISOString()}] eventId=${r.event_id} guest=${r.guest_name} ${r.sender}: ${r.preview}`);
    }
  }
} finally {
  await client.end();
}
