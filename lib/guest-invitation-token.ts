import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';
const schema=z.object({kind:z.enum(['event','booking']),id:z.string().uuid(),propertyId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),expires:z.number().int().positive()});
export type GuestInvitationReference=z.infer<typeof schema>;
const compactPrefix='v2_';
function key(secret:string,version:string){if(!secret)throw Error('INVITATION_SECRET_MISSING');return Buffer.from(hkdfSync('sha256',secret,'void-anchae',version,32));}
function uuid(bytes:Buffer){const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
export function sealInvitation(ref:GuestInvitationReference,secret:string){
 const valid=schema.parse(ref);
 const legacyProperty=!z.string().uuid().safeParse(valid.propertyId).success;
 // Fixed binary payload: kind (1), reservation UUID (16), property UUID (16), expiry ms (8).
 // Keep the full random nonce and authentication tag; shortening never truncates cryptography.
 const propertyBytes=Buffer.from(valid.propertyId,'utf8');
 const payload=Buffer.alloc(legacyProperty?25+propertyBytes.length:41);
 payload[0]=valid.kind==='event'?0:1;
 Buffer.from(valid.id.replaceAll('-',''),'hex').copy(payload,1);
 if(legacyProperty){
  payload.writeBigUInt64BE(BigInt(valid.expires),17);
  propertyBytes.copy(payload,25);
 }else{
  Buffer.from(valid.propertyId.replaceAll('-',''),'hex').copy(payload,17);
  payload.writeBigUInt64BE(BigInt(valid.expires),33);
 }
 const version=legacyProperty?'guest-invitation-v3':'guest-invitation-v2';
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret,version),iv);cipher.setAAD(Buffer.from(version));
 const encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
 return (legacyProperty?'v3_':compactPrefix)+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function openInvitation(token:string,secret:string,now=Date.now()):GuestInvitationReference|null{
 if(!/^[A-Za-z0-9_-]{60,1024}$/.test(token))return null;
 // Try legacy decoding too: a random v1 token could coincidentally start with "v2_".
 for(const format of /^v[23]_/.test(token)?[Number(token[1]),1]:[1]){
  try{
   const compact=format!==1;
   const encoded=compact?token.slice(compactPrefix.length):token;
   const raw=Buffer.from(encoded,'base64url');
   if(raw.toString('base64url')!==encoded||(format===2&&raw.length!==69)||(format===3&&(raw.length<54||raw.length>181)))continue;
   const version=`guest-invitation-v${format}`;
   const cipher=createDecipheriv('aes-256-gcm',key(secret,version),raw.subarray(0,12));cipher.setAAD(Buffer.from(version));cipher.setAuthTag(raw.subarray(12,28));
   const decoded=Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]);
   if(compact&&decoded[0]>1)continue;
   const ref=schema.parse(compact?{kind:decoded[0]===0?'event':'booking',id:uuid(decoded.subarray(1,17)),propertyId:format===3?decoded.subarray(25).toString('utf8'):uuid(decoded.subarray(17,33)),expires:Number(decoded.readBigUInt64BE(format===3?17:33))}:JSON.parse(decoded.toString('utf8')));
   return ref.expires>now?ref:null;
  }catch{ /* Malformed, tampered or signed with another key. */ }
 }
 return null;
}
