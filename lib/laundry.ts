import { z } from 'zod';

export const laundryDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;},'날짜를 확인해주세요.');
const quantity = z.number().int().min(0).max(10000);
export const laundryItem = z.object({name:z.string().trim().min(1).max(60),sent:quantity,received:quantity.default(0),damaged:quantity.default(0),rewash:quantity.default(0)}).refine(i=>i.received<=i.sent && i.damaged+i.rewash<=i.received,'입고 및 불량 수량을 확인해주세요.');
export const laundryItems = z.array(laundryItem).min(1).max(30).refine(items=>new Set(items.map(i=>i.name)).size===items.length,'품목 이름이 중복됩니다.').refine(items=>items.some(i=>i.sent>0),'수량을 입력해주세요.');
export type LaundryItem = z.infer<typeof laundryItem>;
export const createLaundry = z.object({id:z.string().uuid(),propertyId:z.string().min(1),pickupDate:laundryDate,deliveryDate:laundryDate,vendor:z.string().trim().min(1).max(100),vendorPhone:z.string().trim().max(40).default(''),notes:z.string().max(2000).default(''),items:laundryItems}).refine(v=>v.deliveryDate>=v.pickupDate,'배송일은 수거일 이후여야 합니다.').refine(v=>v.items.every(i=>i.received===0&&i.damaged===0&&i.rewash===0),'신규 건은 입고 수량이 0이어야 합니다.');
export function laundryStatus(items:LaundryItem[]) {return items.every(i=>i.received===i.sent)?'completed':items.some(i=>i.received>0)?'partial':'collected';}
export function receiveLaundry(items:LaundryItem[], incoming:{name:string;quantity:number;damaged:number;rewash:number}[]) {
  if(!incoming.some(i=>i.quantity>0))throw Error('입고 수량을 입력해주세요.');
  if(new Set(incoming.map(i=>i.name)).size!==incoming.length)throw Error('품목이 중복됩니다.');
  const result=items.map(i=>({...i}));
  for(const entry of incoming){const item=result.find(i=>i.name===entry.name);if(!item)throw Error('등록되지 않은 품목입니다.');
    if(![entry.quantity,entry.damaged,entry.rewash].every(n=>Number.isInteger(n)&&n>=0&&n<=10000)||entry.damaged+entry.rewash>entry.quantity)throw Error('입고 및 불량 수량을 확인해주세요.');
    item.received+=entry.quantity;item.damaged+=entry.damaged;item.rewash+=entry.rewash;
    if(item.received>item.sent)throw Error('보낸 수량보다 많이 입고할 수 없습니다. 수량 정정을 이용해주세요.');
  }return result;
}
export const LAUNDRY_LABELS:Record<string,string>={scheduled:'수거 예정',collected:'수거 완료',washing:'세탁 중',shipping:'배송 중',partial:'부분 입고',completed:'입고 완료',cancelled:'취소'};
