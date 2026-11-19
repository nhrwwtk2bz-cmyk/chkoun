const QR=require('../public/qr.js');
const texts=process.argv.slice(2);
const out=texts.map(t=>{const q=QR.encode(t);return {t,size:q.size,v:q.version,m:q.modules.map(r=>r.map(x=>x?1:0).join('')).join('\n')};});
console.log(JSON.stringify(out));
