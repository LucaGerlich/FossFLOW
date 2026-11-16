'use strict';
// Instrumentation comes only from the OTEL_* env and NODE_OPTIONS set in compose.yml.
const http = require('node:http');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createTable() {
  for (;;) {
    try {
      await pool.query(
        'create table if not exists orders (id serial primary key, member_id int not null, created_at timestamptz not null default now())'
      );
      return;
    } catch {
      await sleep(2000);
    }
  }
}

async function placeOrder() {
  const id = 1 + Math.floor(Math.random() * 5000);
  const res = await fetch(`http://members-api:4010/members/${id}?email=member${id}@example.com`);
  if (!res.ok) throw new Error(`members-api answered ${res.status}`);
  await res.arrayBuffer();
  await pool.query('insert into orders (member_id) values ($1)', [id]);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && pathname === '/order') {
    try {
      await placeOrder();
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } catch {
      res.writeHead(502).end();
    }
    return;
  }
  res.writeHead(404).end();
});

createTable().then(() => {
  server.listen(4020, () => console.log('shop listening on 4020'));
});
