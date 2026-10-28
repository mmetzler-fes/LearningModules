import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Live-Verbindung zu den Schüler-Geräten eines Klassennotizbuchs
 * (Server-Sent Events, wie die Quiz-Arena): „📡 An Klasse senden“ öffnet ein
 * Modul bei allen, „👣 Folgen“ lässt sie dem 📍-Merker der Lehrkraft folgen.
 * Nur im Speicher – nach einem Neustart ist „Folgen“ aus und die Geräte
 * verbinden sich von selbst neu.
 */
export interface LiveTarget {
  linkId: string;
  moduleId: string;
  title: string;
}

const HEARTBEAT_MS = 25_000;

function send(res: Response, event: string, data: unknown) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Verbindung schon weg – wird beim "close" aufgeräumt.
  }
}

@Injectable()
export class ClassbookLive implements OnModuleDestroy {
  private readonly streams = new Map<string, Set<Response>>();
  private readonly following = new Set<string>();
  private readonly heartbeat = setInterval(() => {
    for (const set of this.streams.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch { /* egal */ } }
  }, HEARTBEAT_MS);

  onModuleDestroy() {
    clearInterval(this.heartbeat);
  }

  /** Gerät verbinden; gleich danach der Stand (Folgen an? wohin?). */
  open(classId: string, res: Response, marker: LiveTarget | null) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx puffert sonst und die Ereignisse kämen in Schüben an.
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    let set = this.streams.get(classId);
    if (!set) this.streams.set(classId, (set = new Set()));
    set.add(res);
    res.on('close', () => {
      set!.delete(res);
      if (!set!.size) this.streams.delete(classId);
    });
    send(res, 'state', this.state(classId, marker));
  }

  /** Verbundene Geräte der Klasse. */
  online(classId: string): number {
    return this.streams.get(classId)?.size || 0;
  }

  isFollowing(classId: string): boolean {
    return this.following.has(classId);
  }

  private state(classId: string, marker: LiveTarget | null) {
    const follow = this.following.has(classId);
    return { follow, marker: follow ? marker : null };
  }

  private broadcast(classId: string, event: string, data: unknown): number {
    const set = this.streams.get(classId);
    for (const res of set || []) send(res, event, data);
    return set?.size || 0;
  }

  /** Modul bei allen öffnen. Ergebnis: erreichte Geräte. */
  sendModule(classId: string, target: LiveTarget): number {
    return this.broadcast(classId, 'send', target);
  }

  /** Folgen an/aus – bzw. neuer Merker, während Folgen an ist. */
  setFollow(classId: string, on: boolean, marker: LiveTarget | null): number {
    if (on) this.following.add(classId); else this.following.delete(classId);
    return this.broadcast(classId, 'state', this.state(classId, marker));
  }

  markerChanged(classId: string, marker: LiveTarget | null): void {
    if (this.following.has(classId)) this.broadcast(classId, 'state', this.state(classId, marker));
  }
}
