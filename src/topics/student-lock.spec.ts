import { lockedModuleIds, withoutLocked } from './student-lock';

const doc = (id: string, kind: string, embeds: string[] = [], extra = {}) => ({
  id, type: 'document', content: { kind, spec: { content: embeds.map((module) => ({ type: 'quiz', module })) } }, ...extra,
});
const quiz = (id: string, extra = {}) => ({ id, type: 'multipleChoice', content: {}, ...extra });
const ids = (s: Set<string>) => [...s].sort();

describe('Sperre für Schüler', () => {
  it('Art „Klassenarbeit“ sperrt samt eingebetteter Quizze, Arbeitsblatt nicht', () => {
    const mods = [doc('ka', 'klassenarbeit', ['q1']), doc('ab', 'arbeitsblatt', ['q2']), quiz('q1'), quiz('q2'), quiz('frei')];
    expect(ids(lockedModuleIds({}, mods, true))).toEqual(['ka', 'q1']);
    expect(withoutLocked({}, mods, true).map((m) => m.id)).toEqual(['ab', 'q2', 'frei']);
  });
  it('„kind“ am Quiz zählt nicht, Inhalt als JSON-Text schon', () => {
    expect(ids(lockedModuleIds({}, [quiz('q', { content: { kind: 'klassenarbeit' } })], true))).toEqual([]);
    const asText = { id: 'd', type: 'document', content: JSON.stringify({ kind: 'klassenarbeit' }) };
    expect(ids(lockedModuleIds({}, [asText], true))).toEqual(['d']);
  });
  it('Nur Lehrkraft: am Modul, am Lernthema, Untermodule mit', () => {
    expect(ids(lockedModuleIds({}, [quiz('a', { teacherOnly: true }), quiz('b')], true))).toEqual(['a']);
    expect(ids(lockedModuleIds({ teacherOnly: true }, [quiz('a'), quiz('b')], true))).toEqual(['a', 'b']);
    expect(ids(lockedModuleIds({}, [quiz('a', { teacherOnly: true }), quiz('k', { parentId: 'a' })], true))).toEqual(['a', 'k']);
  });
  it('Quiz in der Arbeit und im Übungsblatt bleibt gesperrt', () => {
    const mods = [doc('ka', 'klassenarbeit', ['q']), doc('ab', 'arbeitsblatt', ['q']), quiz('q')];
    expect(ids(lockedModuleIds({}, mods, true))).toEqual(['ka', 'q']);
  });
  it('Freigabe öffnet die Arbeit samt Quizzen, aber nur für Links der Eigentümerin', () => {
    const mods = [doc('ka', 'klassenarbeit', ['q'], { studentRelease: true }), quiz('q')];
    expect(ids(lockedModuleIds({}, mods, true))).toEqual([]);
    expect(ids(lockedModuleIds({}, mods, false))).toEqual(['ka', 'q']);
  });
  it('Freigegebene Arbeit im gesperrten Lernthema: nur sie mit ihren Quizzen', () => {
    const mods = [doc('ka', 'klassenarbeit', ['q'], { studentRelease: true }), quiz('q'), quiz('r')];
    expect(ids(lockedModuleIds({ teacherOnly: true }, mods, true))).toEqual(['r']);
  });
  it('Quiz in einer freigegebenen und einer gesperrten Arbeit bleibt gesperrt', () => {
    const mods = [doc('a', 'klassenarbeit', ['q'], { studentRelease: true }), doc('b', 'klassenarbeit', ['q']), quiz('q')];
    expect(ids(lockedModuleIds({}, mods, true))).toEqual(['b', 'q']);
  });
  it('Freigabe ohne Sperre öffnet kein eingebettetes, anders gesperrtes Quiz', () => {
    const mods = [doc('ab', 'arbeitsblatt', ['q'], { studentRelease: true }), quiz('q', { teacherOnly: true })];
    expect(ids(lockedModuleIds({}, mods, true))).toEqual(['q']);
  });
});

describe('Sperre: Freigabe je Klasse', () => {
  const topic = { teacherOnly: false };
  const mods = [{ id: 'a', teacherOnly: true }, { id: 'a1', parentId: 'a' }, { id: 'b' }];
  it('zeigt das Modul nur auf dem Link, der es freigibt', () => {
    expect([...lockedModuleIds(topic, mods, true)].sort()).toEqual(['a', 'a1']);
    expect([...lockedModuleIds(topic, mods, true, undefined, new Set(['a']))]).toEqual([]);
  });
  it('auf dem Link einer anderen Lehrkraft gilt sie nicht', () => {
    expect([...lockedModuleIds(topic, mods, false, undefined, new Set(['a']))].sort()).toEqual(['a', 'a1']);
  });
  it('auch ein ganz gesperrtes Lernthema lässt sich modulweise freigeben', () => {
    expect([...lockedModuleIds({ teacherOnly: true }, [{ id: 'a' }, { id: 'b' }], true, undefined, new Set(['a']))]).toEqual(['b']);
  });
});
