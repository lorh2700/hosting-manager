import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';
const schema=z.object({kind:z.enum(['event','booking']),id:z.string().uuid(),propertyId:z.string().uuid(),expires:z.number().int().positive()});
export type GuestInvitationReference=z.infer<typeof schema>;
function key(secret:string){if(!secret)throw Error('INVITATION_SECRET_MISSING');return Buffer.from(hkdfSync('sha256',secret,'void-anchae','guest-invitation-v1',32));}
export function sealInvitation(ref:GuestInvitationReference,secret:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);cipher.setAAD(Buffer.from('guest-invitation-v1'));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(schema.parse(ref)),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function openInvitation(token:string,secret:string,now=Date.now()):GuestInvitationReference|null{
 try{if(!/^[A-Za-z0-9_-]{60,1024}$/.test(token))return null;const raw=Buffer.from(token,'base64url');const cipher=createDecipheriv('aes-256-gcm',key(secret),raw.subarray(0,12));cipher.setAAD(Buffer.from('guest-invitation-v1'));cipher.setAuthTag(raw.subarray(12,28));const decoded=Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]);const ref=schema.parse(JSON.parse(decoded.toString('utf8')));return ref.expires>now?ref:null;}catch{return null;}
}
