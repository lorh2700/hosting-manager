import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

function parseICalDate(dateStr: string) {
  // Remove any non-alphanumeric characters just in case
  const cleanStr = dateStr.replace(/[^0-9A-Z]/gi, '');
  
  if (cleanStr.length >= 8) {
    const year = cleanStr.substring(0, 4);
    const month = cleanStr.substring(4, 6);
    const day = cleanStr.substring(6, 8);
    
    if (cleanStr.length >= 14) {
      const hour = cleanStr.substring(9, 11);
      const minute = cleanStr.substring(11, 13);
      const second = cleanStr.substring(13, 15);
      const isUTC = cleanStr.endsWith('Z');
      
      if (isUTC) {
        return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
      } else {
        return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
      }
    }
    
    return `${year}-${month}-${day}`;
  }
  
  return dateStr;
}

function parseSimpleICS(icsData: string) {
  const events = [];
  const lines = icsData.split(/\r?\n/);
  let currentEvent: any = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (i + 1 < lines.length && (lines[i + 1].startsWith(' ') || lines[i + 1].startsWith('\t'))) {
      i++;
      line += lines[i].substring(1);
    }

    if (line === 'BEGIN:VEVENT') {
      currentEvent = {};
    } else if (line === 'END:VEVENT') {
      if (currentEvent) {
        events.push(currentEvent);
        currentEvent = null;
      }
    } else if (currentEvent) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > -1) {
        let key = line.substring(0, colonIdx);
        const value = line.substring(colonIdx + 1);
        
        const paramIdx = key.indexOf(';');
        if (paramIdx > -1) {
          key = key.substring(0, paramIdx);
        }
        
        if (key === 'DTSTART') {
          currentEvent.start = parseICalDate(value);
        } else if (key === 'DTEND') {
          currentEvent.end = parseICalDate(value);
        } else if (key === 'SUMMARY') {
          currentEvent.summary = value;
        } else if (key === 'UID') {
          currentEvent.uid = value;
        } else if (key === 'DESCRIPTION') {
          // iCal uses literal \n or \N for newlines
          currentEvent.description = value.replace(/\\[nN]/g, '\n');
        }
      }
    }
  }
  return events;
}

const ALLOWED_ICAL_HOSTNAMES = [
  'www.airbnb.co.kr',
  'airbnb.co.kr',
  'www.airbnb.com',
  'airbnb.com',
  'ical.booking.com',
  'beds24.com',
  'www.beds24.com',
  'stayfolio.com',
  'www.stayfolio.com',
  'ycs.agoda.com',
  'ical.agoda.com',
];

function isAllowedICalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_ICAL_HOSTNAMES.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { propertyId, channels } = body;

  if (!propertyId || !channels || !Array.isArray(channels)) {
    return NextResponse.json({ error: 'propertyId and channels array are required' }, { status: 400 });
  }

  const allEvents = [];

  for (const channel of channels) {
    if (!channel.importUrl) continue;
    if (!isAllowedICalUrl(channel.importUrl)) {
      console.error(`Blocked disallowed importUrl: ${channel.importUrl}`);
      continue;
    }
    try {
      const response = await fetch(channel.importUrl);
      if (!response.ok) {
        console.error(`Failed to fetch iCal for ${channel.name}: ${response.statusText}`);
        continue;
      }
      const icsData = await response.text();
      const parsedEvents = parseSimpleICS(icsData);
      
      for (const event of parsedEvents) {
        if (event.start && event.end) {
          const summaryStr = typeof event.summary === 'string' ? event.summary : (event.summary as any)?.val;
          const uidStr = typeof event.uid === 'string' ? event.uid : (event.uid as any)?.val || uuidv4();
          const descStr = typeof event.description === 'string' ? event.description : (event.description as any)?.val;
          
          allEvents.push({
            id: uuidv4(),
            propertyId,
            channelId: channel.id,
            title: summaryStr || `${channel.name} 예약`,
            start: typeof event.start === 'string' ? event.start : new Date(event.start as Date).toISOString(),
            end: typeof event.end === 'string' ? event.end : new Date(event.end as Date).toISOString(),
            type: 'reservation',
            originalUid: uidStr,
            description: descStr || '',
            createdAt: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      console.error(`Failed to parse channel ${channel.name}:`, error);
    }
  }

  return NextResponse.json({ success: true, events: allEvents });
}
