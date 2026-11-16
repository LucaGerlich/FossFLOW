// Steady traffic with a quiet gap every 40 requests, so idle periods show on the map.
const URL_TARGET = 'http://web:3000/api/checkout';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`load: calling ${URL_TARGET}`);
for (let count = 1; ; count++) {
  try {
    const res = await fetch(URL_TARGET);
    await res.arrayBuffer();
  } catch {
    // The demo keeps going whatever happens.
  }
  await sleep(300 + Math.random() * 1200);
  if (count % 40 === 0) await sleep(15000);
}
