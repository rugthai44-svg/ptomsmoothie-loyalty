const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 8080;

http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const reqUrl = url.parse(req.url, true);
  const targetUrl = reqUrl.query.url;

  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Missing URL query parameter "?url="');
    return;
  }

  try {
    const parsedTarget = url.parse(targetUrl);
    
    // Copy incoming headers and delete Host header to let node client handle it
    const headers = { ...req.headers };
    delete headers.host;
    
    const options = {
      hostname: parsedTarget.hostname,
      port: parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
      path: parsedTarget.path,
      method: req.method,
      headers: headers
    };

    const client = parsedTarget.protocol === 'https:' ? https : http;

    const proxyReq = client.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`Proxy Request Error to ${targetUrl}:`, err);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Proxy Target Error: ${err.message}`);
    });

    req.pipe(proxyReq);
  } catch (err) {
    console.error('Proxy Server Critical Failure:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Proxy Error: ${err.message}`);
  }
}).listen(PORT, () => {
  console.log(`[CORS Proxy] Local CORS Proxy server is running at http://localhost:${PORT}`);
});
