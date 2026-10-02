import LaundryWorkspace from '@/components/LaundryWorkspace';
import Link from 'next/link';
export default function Page(){return <div className="max-w-4xl mx-auto"><Link href="/admin/inventory?mode=send" className="mb-4 inline-flex min-h-11 items-center text-sm text-stone-700 underline underline-offset-4">세탁 보낸 수량 빠르게 기록</Link><LaundryWorkspace/></div>;}
