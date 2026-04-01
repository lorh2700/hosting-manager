import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get('propertyId');
  
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
  }
  
  const channels = db.channels.filter((c) => c.propertyId === propertyId);
  return NextResponse.json(channels);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { id, propertyId, name, importUrl, exportUrl, isActive } = body;
  
  if (!propertyId || !name) {
    return NextResponse.json({ error: 'propertyId and name are required' }, { status: 400 });
  }
  
  const newId = id || crypto.randomUUID();
  const newChannel = {
    id: newId,
    propertyId,
    name,
    importUrl: importUrl || '',
    exportUrl: exportUrl || `/api/export/${newId}.ics`,
    isActive: isActive !== undefined ? isActive : true,
  };
  
  db.channels.push(newChannel);
  return NextResponse.json(newChannel, { status: 201 });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { id, name, importUrl, isActive } = body;
  
  const channelIndex = db.channels.findIndex((c) => c.id === id);
  if (channelIndex === -1) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  }
  
  db.channels[channelIndex] = {
    ...db.channels[channelIndex],
    name: name !== undefined ? name : db.channels[channelIndex].name,
    importUrl: importUrl !== undefined ? importUrl : db.channels[channelIndex].importUrl,
    isActive: isActive !== undefined ? isActive : db.channels[channelIndex].isActive,
  };
  
  return NextResponse.json(db.channels[channelIndex]);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  
  const channelIndex = db.channels.findIndex((c) => c.id === id);
  if (channelIndex === -1) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  }
  
  db.channels.splice(channelIndex, 1);
  return NextResponse.json({ success: true });
}
