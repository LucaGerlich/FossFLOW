import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

let pool: Pool | undefined;
const getPool = (): Pool => (pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

export async function GET(): Promise<Response> {
  try {
    const order = await fetch('http://shop:4020/order');
    if (!order.ok) return Response.json({ error: 'shop failed' }, { status: 502 });
    const { rows } = await getPool().query<{ orders: number }>(
      'select count(*)::int as orders from orders'
    );
    return Response.json({ orders: rows[0].orders });
  } catch {
    return Response.json({ error: 'shop failed' }, { status: 502 });
  }
}
