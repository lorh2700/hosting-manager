const fs = require('node:fs');
const path = require('node:path');
const {createHmac} = require('node:crypto');
const QRCode = require('qrcode');
const rows = [
 ['70X0HKDJasPU3RQj67aU','안온재','anon','ANONJAE'],
 ['oKWKVQqLy7uENyHUwljr','운와당','unwadang','UNWADANG'],
 ['Z4jFeng2zG9WpAhWtow3','화연재','hwayeonjae','HWAYEONJAE'],
 ['c830c242-d1d5-4af1-9f68-43e2f5ae486a','별하재','byulha','BYULHAJAE'],
 ['5plQsEOe9sTHzSsMS0pc','도원재','dowonjae','DOWONJAE'],
];
(async () => {
 if (!process.env.JWT_SECRET) throw new Error('Signing configuration missing');
 const cards=[];
 for(const [id,name,slug,en] of rows){
  const encoded=Buffer.from(id).toString('base64url');
  const sig=createHmac('sha256',process.env.JWT_SECRET).update(`void-guest-checkout-v1:${encoded}`).digest('base64url');
  const token=`${encoded}.${sig}`;
  // Never open the guest page: it automatically confirms departure. Status is read-only.
  const response=await fetch('https://voidanchae.com/api/public/guest-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'status',token}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();
  if(!response.ok || result.propertyName!==name) throw new Error(`QR validation failed for ${name}: ${response.status}`);
  const url=`https://voidanchae.com/guest-checkout#${token}`;
  const qr=QRCode.create(url,{errorCorrectionLevel:'M'});
  cards.push({name,slug,en,url,size:qr.modules.size,matrix:Array.from(qr.modules.data)});
  console.log(`${name}: production signature and property verified (read-only)`);
 }
 fs.writeFileSync(path.join(__dirname,'checkout-card-data.json'),JSON.stringify(cards));
})().catch(e=>{console.error(e.message);process.exit(1)});
