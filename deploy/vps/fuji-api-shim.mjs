// Local shim for avalanche-cli 1.9.x on Fuji. The public API (avalanchego 1.15.3) answers "the method
// platform.getBalance is not available", and the CLI calls it before every deploy. Usage:
//   ssh -i ~/.ssh/hackathon_vps -f -N -L 127.0.0.1:19650:<ofel-l1-v1-1 container IP>:9650 root@201.18.198.162
//   node deploy/vps/fuji-api-shim.mjs      then: avalanche ... --fuji --endpoint http://127.0.0.1:19651
// Only platform.getBalance goes to our own bootstrapped Fuji node (SSH tunnel on 127.0.0.1:19650, which still
// serves it); every other call, and every transaction, goes to the public Fuji API unchanged.
import http from 'node:http';
const PUBLIC = 'https://api.avax-test.network';
const OWN = 'http://127.0.0.1:19650';
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  let method = ''; try { method = JSON.parse(body.toString()).method ?? ''; } catch {}
  const base = method === 'platform.getBalance' ? OWN : PUBLIC;
  try {
    const r = await fetch(base + req.url, { method: req.method, headers: { 'content-type': req.headers['content-type'] ?? 'application/json' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const out = Buffer.from(await r.arrayBuffer());
    let m = ''; try { m = JSON.parse(body.toString()).method ?? ''; } catch {}
    console.log(`${req.method} ${req.url} ${m} -> ${base === OWN ? 'own' : 'public'} ${r.status}`);
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }); res.end(out);
  } catch (e) { console.log(`ERR ${req.url} ${e.message}`); res.writeHead(502); res.end(String(e.message)); }
}).listen(19651, '127.0.0.1', () => console.log('fuji proxy on 127.0.0.1:19651'));
