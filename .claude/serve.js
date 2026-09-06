const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
http.createServer((req, res) => {
  const file = path.join(root, req.url === '/' ? 'index.html' : req.url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(file);
    const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'}[ext] || 'text/plain';
    res.writeHead(200, {'Content-Type': mime});
    res.end(data);
  });
}).listen(5500);
