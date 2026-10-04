import {
  Injectable, Logger, OnModuleDestroy, NotFoundException, ForbiddenException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import type { Response } from 'express';
import { TopicLink } from '../core/entities/topic-link.entity';
import { User } from '../core/entities/user.entity';
import { Result } from '../core/entities/result.entity';
import { LinksService, contestSettingsOf } from '../links/links.service';
import { CompanionService } from '../companion/companion.service';
import { forStudents } from '../core/public/student-view';
import { baseUrl, renderQr } from '../core/share/link-url';

/**
 * Aufgabentypen, die der Browser selbst bewertet (siehe answer-eval.js).
 * Alles andere – Freitext, Aufnahmen, reine Informationen – bleibt in
 * der Quiz-Arena außen vor.
 */
const GRADABLE_TYPES = new Set([
  'multipleChoice', 'trueFalse', 'fillInTheBlanks', 'markTheWords', 'dragTheWords',
  'dictation', 'dragAndDrop', 'flashcards', 'arithmeticQuiz', 'branchingScenario',
]);

const MAX_PLAYERS = 100;
const MAX_NAME = 40;
/** Antworten, die kurz nach Ablauf eintreffen (Netz, automatisches Abschicken), zählen noch. */
const GRACE_MS = 1500;
/** Eine Quiz-Arena, in der so lange niemand etwas tut, wird aufgeräumt. */
const IDLE_MS = 4 * 60 * 60 * 1000;
const HEARTBEAT_MS = 20 * 1000;

type Phase = 'lobby' | 'question' | 'reveal' | 'podium';

interface RoundAnswer {
  points: number;
  correctness: number;
  isCorrect: boolean;
  ms: number;
  userAnswer: string;
  correctAnswer: string;
}

interface Player {
  id: string;
  secret: string;
  name: string;
  score: number;
  answers: Array<RoundAnswer | undefined>;
  streams: Set<Response>;
  ip: string | null;
}

interface Question {
  module: any;
  topicId: string;
  topicTitle: string;
  seconds: number;
}

interface Session {
  linkId: string;
  linkName: string;
  ownerId: string;
  phase: Phase;
  index: number;
  questions: Question[];
  startedAt: number;
  deadline: number;
  players: Map<string, Player>;
  kicked: Set<string>;
  hostStreams: Set<Response>;
  maxPoints: number;
  sound: boolean;
  soundUrl: string | null;
  joinUrl: string;
  qrSvg: string | null;
  timer: NodeJS.Timeout | null;
  saved: boolean;
  lastActivity: number;
}

/**
 * Punkte einer Antwort wie bei Kahoot: Richtigkeit² × Zeitfaktor × Maximum.
 * Der Zeitfaktor fällt linear von 1 (sofort) auf 0,5 (bei Ablauf) – wer
 * spät, aber richtig antwortet, bekommt also noch die Hälfte.
 */
export function contestPoints(correctness: number, ms: number, seconds: number, maxPoints: number): number {
  const r = Math.min(1, Math.max(0, correctness));
  if (r <= 0) return 0;
  const t = Math.min(1, Math.max(0, ms / (seconds * 1000)));
  return Math.round(maxPoints * r * r * (1 - t / 2));
}

function send(res: Response, event: string, data: any) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Verbindung schon weg – wird beim "close" aufgeräumt.
  }
}

/**
 * Quiz-Arena: Wartebereich, synchrone Fragen, Bestenliste, Siegertreppchen.
 *
 * Eine laufende Quiz-Arena lebt nur im Arbeitsspeicher (eine je Link). Sie ist
 * eine Sache von einer Schulstunde; startet der Server neu, öffnet die
 * Lehrkraft den Wartebereich einfach erneut. Gespeichert wird erst das
 * Endergebnis – als Eintrag je Schüler in der Ergebnisliste.
 *
 * Die Zeit misst der Server: vom Start der Frage bis zum Eingang der Antwort.
 * Die Richtigkeit bewertet der Browser des Schülers, genau wie im Quiz.
 */
@Injectable()
export class ContestService implements OnModuleDestroy {
  private readonly logger = new Logger(ContestService.name);
  private readonly sessions = new Map<string, Session>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    private readonly linksService: LinksService,
    private readonly companionService: CompanionService,
  ) {
    // Kommentarzeilen halten Proxys davon ab, ruhige Verbindungen zu kappen.
    this.heartbeat = setInterval(() => {
      for (const s of this.sessions.values()) {
        for (const res of this.allStreams(s)) {
          try { res.write(': ping\n\n'); } catch { /* egal */ }
        }
      }
    }, HEARTBEAT_MS);
    this.sweeper = setInterval(() => this.sweep(), 10 * 60 * 1000);
    this.heartbeat.unref?.();
    this.sweeper.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.heartbeat);
    clearInterval(this.sweeper);
    for (const s of this.sessions.values()) this.close(s, 'Der Server wird neu gestartet.');
  }

  private sweep() {
    const now = Date.now();
    for (const s of [...this.sessions.values()]) {
      if (now - s.lastActivity > IDLE_MS) this.close(s, 'Die Quiz-Arena wurde wegen Inaktivität beendet.');
    }
  }

  private *allStreams(s: Session): Iterable<Response> {
    yield* s.hostStreams;
    for (const p of s.players.values()) yield* p.streams;
  }

  private close(s: Session, reason: string) {
    if (s.timer) clearTimeout(s.timer);
    for (const res of this.allStreams(s)) {
      send(res, 'closed', { reason });
      try { res.end(); } catch { /* egal */ }
    }
    this.sessions.delete(s.linkId);
  }

  // ---- Links prüfen ----

  private async checkLink(link: TopicLink | null): Promise<TopicLink> {
    if (!link) throw new NotFoundException('Dieser Link ist ungültig oder wurde zurückgezogen.');
    if (!link.active) throw new ForbiddenException('Diese Freigabe ist derzeit deaktiviert.');
    if (!link.modes.includes('contest')) {
      throw new ForbiddenException('Für diese Freigabe ist die Quiz-Arena nicht eingeschaltet.');
    }
    const owner = await this.userRepo.findOne({ where: { id: link.ownerId } });
    if (!owner || owner.active === false) throw new ForbiddenException('Dieser Link ist derzeit gesperrt.');
    return link;
  }

  private async linkByHostToken(hostToken: string): Promise<TopicLink> {
    if (!hostToken) throw new NotFoundException('Ungültiger Leitungs-Link.');
    const link = await this.linkRepo.findOne({ where: { contestHostToken: hostToken } });
    if (!link) throw new NotFoundException('Dieser Leitungs-Link ist ungültig oder wurde erneuert.');
    return this.checkLink(link);
  }

  private async linkByToken(token: string): Promise<TopicLink> {
    if (!token) throw new NotFoundException('Ungültiger Link.');
    return this.checkLink(await this.linkRepo.findOne({ where: { token } }));
  }

  /** Aufgaben des Links, die sich automatisch bewerten lassen – in Link-Reihenfolge. */
  private async loadQuestions(link: TopicLink): Promise<Question[]> {
    const cfg = contestSettingsOf(link);
    const resolved = await this.linksService.resolveModules(link);
    const out: Question[] = [];
    for (const { topic, modules } of resolved) {
      for (const m of modules) {
        if (!GRADABLE_TYPES.has(m.type)) continue;
        const { subModules: _sub, ...plain } = m as any;
        out.push({
          module: forStudents(plain),
          topicId: topic.id,
          topicTitle: topic.title,
          seconds: cfg.seconds[m.id] || cfg.defaultSeconds,
        });
      }
    }
    return out;
  }

  // ---- Leitung ----

  /** Wartebereich öffnen – oder die schon laufende Quiz-Arena wieder aufnehmen. */
  async hostOpen(hostToken: string, req: any) {
    const link = await this.linkByHostToken(hostToken);
    if (!link.token) {
      throw new ForbiddenException('Der Schüler-Link dieser Freigabe ist zurückgezogen. Bitte zuerst neu erzeugen.');
    }
    let s = this.sessions.get(link.id);
    const joinUrl = `${baseUrl(req)}/?l=${link.token}&m=contest`;
    if (!s) {
      const cfg = contestSettingsOf(link);
      const companion = await this.companionService.effectiveFor(link.ownerId);
      s = {
        linkId: link.id,
        linkName: link.name,
        ownerId: link.ownerId,
        phase: 'lobby',
        index: -1,
        questions: await this.loadQuestions(link),
        startedAt: 0,
        deadline: 0,
        players: new Map(),
        kicked: new Set(),
        hostStreams: new Set(),
        maxPoints: cfg.maxPoints,
        sound: cfg.sound,
        soundUrl: companion.soundUrl,
        joinUrl,
        qrSvg: await renderQr(joinUrl),
        timer: null,
        saved: false,
        lastActivity: Date.now(),
      };
      this.sessions.set(link.id, s);
    } else if (s.joinUrl !== joinUrl) {
      s.joinUrl = joinUrl;
      s.qrSvg = await renderQr(joinUrl);
    }
    s.lastActivity = Date.now();
    return this.hostState(s);
  }

  private async sessionForHost(hostToken: string): Promise<Session> {
    const link = await this.linkByHostToken(hostToken);
    const s = this.sessions.get(link.id);
    if (!s) throw new ConflictException('Der Wartebereich ist nicht geöffnet.');
    s.lastActivity = Date.now();
    return s;
  }

  async hostStream(hostToken: string, res: Response) {
    const s = await this.sessionForHost(hostToken);
    this.openStream(res);
    s.hostStreams.add(res);
    res.on('close', () => s.hostStreams.delete(res));
    this.sendQuestion(s, res);
    send(res, 'state', this.hostState(s));
  }

  async hostStart(hostToken: string) {
    const s = await this.sessionForHost(hostToken);
    if (s.phase !== 'lobby') throw new ConflictException('Die Quiz-Arena läuft bereits.');
    // Frisch laden: Änderungen am Link seit dem Öffnen gelten.
    const link = await this.linkByHostToken(hostToken);
    const cfg = contestSettingsOf(link);
    s.questions = await this.loadQuestions(link);
    s.maxPoints = cfg.maxPoints;
    s.sound = cfg.sound;
    s.linkName = link.name;
    if (s.questions.length === 0) {
      throw new BadRequestException('Diese Freigabe enthält keine Aufgaben, die sich automatisch bewerten lassen.');
    }
    if (s.players.size === 0) throw new BadRequestException('Es ist noch niemand im Wartebereich.');
    this.startQuestion(s, 0);
    return { success: true };
  }

  /** Während einer Frage: Zeit beenden. In der Auswertung: nächste Frage bzw. Siegerehrung. */
  async hostNext(hostToken: string) {
    const s = await this.sessionForHost(hostToken);
    if (s.phase === 'question') this.endQuestion(s);
    else if (s.phase === 'reveal') {
      if (s.index + 1 < s.questions.length) this.startQuestion(s, s.index + 1);
      else await this.finish(s);
    } else {
      throw new ConflictException('Gerade gibt es nichts weiterzuschalten.');
    }
    return { success: true };
  }

  async hostKick(hostToken: string, playerId: string) {
    const s = await this.sessionForHost(hostToken);
    const p = s.players.get(playerId);
    if (!p) throw new NotFoundException('Diesen Teilnehmer gibt es nicht.');
    s.players.delete(playerId);
    s.kicked.add(playerId);
    for (const res of p.streams) {
      send(res, 'kicked', { reason: 'Du wurdest von der Lehrkraft aus der Quiz-Arena entfernt.' });
      try { res.end(); } catch { /* egal */ }
    }
    this.maybeEndEarly(s);
    this.broadcast(s);
    return { success: true };
  }

  /** Neue Runde mit denselben Teilnehmern: zurück in den Wartebereich. */
  async hostReset(hostToken: string) {
    const s = await this.sessionForHost(hostToken);
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    s.phase = 'lobby';
    s.index = -1;
    s.saved = false;
    for (const p of s.players.values()) {
      p.score = 0;
      p.answers = [];
    }
    this.broadcast(s);
    return { success: true };
  }

  async hostClose(hostToken: string) {
    const s = await this.sessionForHost(hostToken);
    this.close(s, 'Die Lehrkraft hat die Quiz-Arena beendet.');
    return { success: true };
  }

  // ---- Teilnehmer ----

  async join(
    token: string,
    body: { studentName?: string; password?: string; playerId?: string; secret?: string },
    ip: string | null,
  ) {
    const link = await this.linkByToken(token);
    if (link.accessPassword && (body?.password || '') !== link.accessPassword) {
      throw new ForbiddenException('Falsches Passwort.');
    }
    const s = this.sessions.get(link.id);
    if (!s) {
      throw new ConflictException('Die Quiz-Arena ist noch nicht geöffnet. Warte, bis deine Lehrkraft den Wartebereich öffnet.');
    }
    s.lastActivity = Date.now();

    // Nach einem Neuladen derselbe Platz mit denselben Punkten.
    const back = body?.playerId ? s.players.get(body.playerId) : undefined;
    if (back && body.secret && back.secret === body.secret) {
      return { playerId: back.id, secret: back.secret, name: back.name, linkName: s.linkName };
    }
    if (body?.playerId && s.kicked.has(body.playerId)) {
      throw new ForbiddenException('Du wurdest von der Lehrkraft aus der Quiz-Arena entfernt.');
    }

    const name = String(body?.studentName || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (!name) throw new BadRequestException('Bitte den Namen eingeben.');
    const taken = [...s.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new ConflictException(`Der Name „${name}“ ist schon vergeben – bitte z. B. mit Nachnamen ergänzen.`);
    if (s.players.size >= MAX_PLAYERS) throw new ConflictException('Die Quiz-Arena ist voll.');

    const player: Player = {
      id: crypto.randomUUID(),
      secret: crypto.randomBytes(16).toString('base64url'),
      name,
      score: 0,
      answers: [],
      streams: new Set(),
      ip,
    };
    s.players.set(player.id, player);
    this.broadcast(s);
    return { playerId: player.id, secret: player.secret, name: player.name, linkName: s.linkName };
  }

  private async playerOf(token: string, playerId: string, secret: string): Promise<{ s: Session; p: Player }> {
    const link = await this.linkByToken(token);
    const s = this.sessions.get(link.id);
    if (!s) throw new ConflictException('Die Quiz-Arena ist beendet.');
    const p = s.players.get(playerId);
    if (!p || p.secret !== secret) {
      throw new ForbiddenException(s.kicked.has(playerId)
        ? 'Du wurdest von der Lehrkraft aus der Quiz-Arena entfernt.'
        : 'Du bist nicht (mehr) angemeldet.');
    }
    s.lastActivity = Date.now();
    return { s, p };
  }

  async playerStream(token: string, playerId: string, secret: string, res: Response) {
    const { s, p } = await this.playerOf(token, playerId, secret);
    this.openStream(res);
    p.streams.add(res);
    res.on('close', () => {
      p.streams.delete(res);
      // Wer nicht mehr verbunden ist, taucht beim Leiter als "offline" auf.
      if (s.phase === 'lobby' || s.phase === 'question') this.broadcastHost(s);
    });
    this.sendQuestion(s, res);
    send(res, 'state', this.playerState(s, p));
    this.broadcastHost(s);
  }

  async answer(
    token: string,
    body: {
      playerId?: string; secret?: string; index?: number;
      points?: number; isCorrect?: boolean; userAnswer?: any; correctAnswer?: any;
    },
  ) {
    const { s, p } = await this.playerOf(token, String(body?.playerId || ''), String(body?.secret || ''));
    const now = Date.now();
    if (s.phase !== 'question' || body?.index !== s.index) {
      throw new ConflictException('Diese Frage ist bereits vorbei.');
    }
    if (p.answers[s.index]) throw new ConflictException('Du hast schon geantwortet.');
    if (now > s.deadline + GRACE_MS) throw new ConflictException('Die Zeit ist abgelaufen.');

    const q = s.questions[s.index];
    const correctness = body?.isCorrect ? 1 : Math.min(1, Math.max(0, Number(body?.points) || 0));
    const ms = Math.min(now - s.startedAt, q.seconds * 1000);
    const points = contestPoints(correctness, ms, q.seconds, s.maxPoints);
    p.answers[s.index] = {
      points,
      correctness,
      isCorrect: correctness >= 1,
      ms,
      userAnswer: String(body?.userAnswer ?? '').slice(0, 2000),
      correctAnswer: String(body?.correctAnswer ?? '').slice(0, 2000),
    };
    p.score += points;

    if (!this.maybeEndEarly(s)) {
      // Nur der eigene Bildschirm und der Leiter müssen das sofort wissen.
      for (const res of p.streams) send(res, 'state', this.playerState(s, p));
      this.broadcastHost(s);
    }
    return { success: true };
  }

  // ---- Ablauf ----

  private startQuestion(s: Session, index: number) {
    if (s.timer) clearTimeout(s.timer);
    s.phase = 'question';
    s.index = index;
    s.startedAt = Date.now();
    s.deadline = s.startedAt + s.questions[index].seconds * 1000;
    s.timer = setTimeout(() => this.endQuestion(s), s.deadline + GRACE_MS - Date.now());
    for (const res of this.allStreams(s)) this.sendQuestion(s, res);
    this.broadcast(s);
  }

  /** Haben alle geantwortet, geht es ohne Warten in die Auswertung. */
  private maybeEndEarly(s: Session): boolean {
    if (s.phase !== 'question' || s.players.size === 0) return false;
    const all = [...s.players.values()].every((p) => p.answers[s.index]);
    if (all) this.endQuestion(s);
    return all;
  }

  private endQuestion(s: Session) {
    if (s.phase !== 'question') return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    s.phase = 'reveal';
    this.broadcast(s);
  }

  private async finish(s: Session) {
    s.phase = 'podium';
    this.broadcast(s);
    if (s.saved) return;
    s.saved = true;
    try {
      await this.saveResults(s);
    } catch (err) {
      this.logger.error(`Quiz-Arena-Ergebnisse nicht gespeichert: ${(err as Error).message}`);
    }
  }

  /** Ein Eintrag je Teilnehmer in der Ergebnisliste der Lehrkraft. */
  private async saveResults(s: Session) {
    const ranking = this.ranking(s);
    const maxScore = s.maxPoints * s.questions.length;
    const topicTitle = [...new Set(s.questions.map((q) => q.topicTitle))].join(', ');
    const rows = ranking.map((entry) => {
      const p = s.players.get(entry.id)!;
      return this.resultRepo.create({
        id: crypto.randomUUID(),
        studentName: p.name,
        teacherId: s.ownerId,
        topicId: s.questions[0]?.topicId,
        moduleId: undefined,
        score: p.score,
        maxScore,
        ipAddress: p.ip || undefined,
        linkId: s.linkId,
        linkName: s.linkName,
        mode: 'contest',
        payload: {
          topicTitle,
          linkName: s.linkName,
          percentage: maxScore > 0 ? Math.round((p.score / maxScore) * 100) : 0,
          rank: entry.rank,
          playerCount: ranking.length,
          details: s.questions.map((q, i) => {
            const a = p.answers[i];
            return {
              moduleId: q.module.id,
              moduleTitle: q.module.title,
              moduleType: q.module.type,
              isCorrect: !!a?.isCorrect,
              userAnswer: a ? a.userAnswer : 'keine Antwort',
              correctAnswer: a?.correctAnswer || '',
              score: a
                ? `${a.points} Punkte · Richtigkeit ${Math.round(a.correctness * 100)} % · ${(a.ms / 1000).toFixed(1).replace('.', ',')} s`
                : '0 Punkte · nicht beantwortet',
            };
          }),
        },
      });
    });
    if (rows.length) await this.resultRepo.save(rows);
  }

  // ---- Zustand senden ----

  private openStream(res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx puffert sonst und die Ereignisse kämen in Schüben an.
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
  }

  /** Die Aufgabe selbst geht nur einmal je Frage über die Leitung – sie kann groß sein. */
  private sendQuestion(s: Session, res: Response) {
    if (s.phase !== 'question' && s.phase !== 'reveal') return;
    const q = s.questions[s.index];
    if (!q) return;
    send(res, 'question', { index: s.index, total: s.questions.length, seconds: q.seconds, topicTitle: q.topicTitle, module: q.module });
  }

  private broadcastHost(s: Session) {
    const state = this.hostState(s);
    for (const res of s.hostStreams) send(res, 'state', state);
  }

  private broadcast(s: Session) {
    this.broadcastHost(s);
    for (const p of s.players.values()) {
      if (!p.streams.size) continue;
      const state = this.playerState(s, p);
      for (const res of p.streams) send(res, 'state', state);
    }
  }

  /** Rangliste mit gemeinsamen Plätzen bei gleicher Punktzahl. */
  private ranking(s: Session) {
    const list = [...s.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        lastPoints: s.index >= 0 ? p.answers[s.index]?.points ?? 0 : 0,
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'de'));
    let rank = 0;
    return list.map((e, i) => {
      if (i === 0 || e.score !== list[i - 1].score) rank = i + 1;
      return { ...e, rank };
    });
  }

  private common(s: Session) {
    const q = s.questions[s.index];
    const showRanking = s.phase === 'reveal' || s.phase === 'podium';
    const ranking = showRanking ? this.ranking(s) : [];
    return {
      phase: s.phase,
      linkName: s.linkName,
      index: s.index,
      total: s.questions.length,
      seconds: q?.seconds || 0,
      remainingMs: s.phase === 'question' ? Math.max(0, s.deadline - Date.now()) : 0,
      maxPoints: s.maxPoints,
      playerCount: s.players.size,
      leaderboard: ranking.slice(0, 10),
      podium: s.phase === 'podium' ? ranking.filter((e) => e.rank <= 3).slice(0, 5) : [],
    };
  }

  private hostState(s: Session) {
    const answers = s.index >= 0 ? [...s.players.values()].map((p) => p.answers[s.index]) : [];
    return {
      ...this.common(s),
      joinUrl: s.joinUrl,
      qrSvg: s.qrSvg,
      sound: s.sound,
      soundUrl: s.soundUrl,
      players: [...s.players.values()]
        .map((p) => ({
          id: p.id,
          name: p.name,
          score: p.score,
          answered: s.index >= 0 && !!p.answers[s.index],
          online: p.streams.size > 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      answeredCount: answers.filter(Boolean).length,
      roundStats: s.phase === 'reveal' ? {
        correct: answers.filter((a) => a?.isCorrect).length,
        partial: answers.filter((a) => a && !a.isCorrect && a.correctness > 0).length,
        wrong: answers.filter((a) => a && a.correctness === 0).length,
        missing: answers.filter((a) => !a).length,
      } : null,
    };
  }

  private playerState(s: Session, p: Player) {
    const mine = s.index >= 0 ? p.answers[s.index] : undefined;
    const ranking = this.ranking(s);
    const me = ranking.find((e) => e.id === p.id);
    // Ergebnis der Runde erst in der Auswertung – sonst ließe es sich während
    // der Frage am Punktestand ablesen und weitersagen.
    const settled = s.phase === 'reveal' || s.phase === 'podium';
    return {
      ...this.common(s),
      answered: !!mine,
      me: {
        id: p.id,
        name: p.name,
        score: settled ? p.score : p.score - (mine?.points ?? 0),
        rank: settled ? me?.rank || null : null,
        lastPoints: settled ? mine?.points ?? 0 : null,
        lastCorrectness: settled ? mine?.correctness ?? null : null,
      },
    };
  }
}
