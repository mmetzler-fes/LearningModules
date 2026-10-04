import { scoreDictation, dictationOptions } from './dictation.js';

// ==================== AUSWERTUNG EINER AUFGABE ====================

/**
 * Aufgabentypen, die sich automatisch bewerten lassen. Nur sie taugen für
 * die Lernbegleitung (mehrere Versuche) und die Quiz-Arena; Freitext,
 * Audio-Aufnahme und reine Informationen bewertet kein Automat.
 */
export const GRADABLE_TYPES = new Set([
  'multipleChoice', 'trueFalse', 'fillInTheBlanks', 'markTheWords', 'dragTheWords',
  'dictation', 'dragAndDrop', 'flashcards', 'arithmeticQuiz', 'branchingScenario',
]);

/**
 * Aufgaben, die sich nach dem Abschicken nicht mehr ändern lassen (Kopfrechnen
 * läuft durch, ein Szenario endet). Für einen weiteren Versuch werden sie neu
 * aufgebaut.
 */
export const ONE_SHOT_TYPES = new Set(['arithmeticQuiz', 'branchingScenario']);

/**
 * Liest die Antwort aus der Ansicht einer Aufgabe und bewertet sie.
 * `root` ist das Element, in dem die Aufgabe aufgebaut wurde.
 *
 * Ergebnis: isCorrect, points (0 bis 1; null bei reinen Informationen),
 * userAnswer, correctAnswer und ggf. score als lesbare Auswertung.
 */
export function collectAnswer(mod, root) {
  const content = mod.content || {};
  const result = {
    moduleId: mod.id, moduleTitle: mod.title, moduleType: mod.type,
    isCorrect: false, userAnswer: '', correctAnswer: '',
  };

  switch (mod.type) {
    case 'multipleChoice': {
      const inputs = root.querySelectorAll('input[name="mc-answer"]');
      const selected = []; const correctList = [];
      let correctDecisions = 0; let totalDecisions = 0;
      inputs.forEach((inp, i) => {
        if (inp.checked) selected.push(i);
        if (inp.dataset.correct === 'true') correctList.push(i);
        if (inp.checked === (inp.dataset.correct === 'true')) correctDecisions++;
        totalDecisions++;
      });
      result.userAnswer = selected.map((i) => (content.answers || [])[i]?.text || i).join(', ');
      result.correctAnswer = correctList.map((i) => (content.answers || [])[i]?.text || i).join(', ');
      result.isCorrect = totalDecisions > 0 && correctDecisions === totalDecisions;
      // Teilpunkte nur bei Mehrfachauswahl: jedes falsche Kreuz hebt ein
      // richtiges auf, sonst brächte schon „nichts ankreuzen“ Punkte.
      if (!content.singleAnswer && correctList.length > 0) {
        const hits = selected.filter((i) => correctList.includes(i)).length;
        const wrongHits = selected.length - hits;
        result.points = Math.max(0, hits - wrongHits) / correctList.length;
        const pct = Math.round(result.points * 100);
        result.score = `Richtig: ${pct}% | Falsch: ${100 - pct}%`;
      }
      break;
    }
    case 'trueFalse': {
      const tfQs = content.questions || [content];
      let tfCorrect = 0; const ua = []; const ca = [];
      tfQs.forEach((q) => {
        if (q._userAnswer === q.correctAnswer) tfCorrect++;
        ua.push(q._userAnswer === 'true' ? 'Wahr' : q._userAnswer === 'false' ? 'Falsch' : '—');
        ca.push(q.correctAnswer === 'true' ? 'Wahr' : 'Falsch');
      });
      result.isCorrect = tfCorrect === tfQs.length;
      result.userAnswer = ua.join(', '); result.correctAnswer = ca.join(', ');
      if (tfQs.length > 0) {
        const pct = Math.round((tfCorrect / tfQs.length) * 100);
        result.score = `Richtig: ${pct}% | Falsch: ${100 - pct}%`;
      }
      break;
    }
    case 'fillInTheBlanks': {
      const inputs = root.querySelectorAll('input[data-answer]');
      let correct = 0; const answers = [];
      inputs.forEach((inp) => {
        const expected = inp.dataset.answer; const given = inp.value.trim();
        const alts = expected.split('/').map((a) => a.trim()).filter(Boolean);
        const match = alts.some((alt) => content.caseSensitive ? given === alt : given.toLowerCase() === alt.toLowerCase());
        if (match) correct++;
        answers.push(given);
      });
      result.userAnswer = answers.join(', ');
      result.correctAnswer = Array.from(inputs).map((i) => i.dataset.answer.split('/')[0].trim()).join(', ');
      result.isCorrect = correct === inputs.length && inputs.length > 0;
      if (inputs.length > 0) {
        result.points = correct / inputs.length;
        const pct = Math.round(result.points * 100);
        result.score = `Richtig: ${pct}% | Falsch: ${100 - pct}%`;
      }
      break;
    }
    case 'essay': {
      const textarea = root.querySelector('#essayAnswer');
      const text = textarea ? textarea.value.trim() : '';
      const minChars = Number(content.minChars) || 0;
      result.userAnswer = text || '—'; result.correctAnswer = content.sampleSolution || 'Freitextantwort';
      result.isCorrect = minChars <= 0 ? text.length > 0 : text.length >= minChars;
      result.score = `${text.length} Zeichen`;
      break;
    }
    case 'arithmeticQuiz': {
      // Das Ergebnis steht am Bereich selbst – auch in der Klassenarbeit, in
      // der der Text "x / y" bewusst nicht angezeigt wird.
      const area = root.querySelector('.quiz-area[data-total]');
      if (area) {
        const got = Number(area.dataset.correct) || 0;
        const total = Number(area.dataset.total) || 0;
        result.userAnswer = `${got}/${total}`; result.correctAnswer = `${total}/${total}`;
        result.isCorrect = total > 0 && got === total;
        if (total > 0) result.points = got / total;
      } else {
        result.userAnswer = 'nicht bis zum Ende gerechnet';
      }
      break;
    }
    case 'markTheWords': {
      const spans = root.querySelectorAll('#wordsArea span');
      let correct = 0; let total = 0; const ua = []; const ca = [];
      spans.forEach((s) => {
        const isTarget = s.dataset.correct === 'true'; const isSel = s.classList.contains('selected');
        if (isTarget) { total++; ca.push(s.textContent); }
        if (isSel) { ua.push(s.textContent); if (isTarget) correct++; }
      });
      result.userAnswer = ua.length ? ua.join(', ') : 'Keine markiert';
      result.correctAnswer = ca.join(', ');
      result.isCorrect = correct === total && total > 0;
      break;
    }
    case 'dragTheWords': {
      const zones = root.querySelectorAll('.dtw-drop-zone');
      let correct = 0; const ua = []; const ca = [];
      zones.forEach((z) => {
        const current = (z.dataset.currentWord || '').trim(); const expected = z.dataset.correctWord;
        if (current.toLowerCase() === expected.toLowerCase()) correct++;
        ua.push(current || '(leer)'); ca.push(expected);
      });
      result.userAnswer = ua.join(', '); result.correctAnswer = ca.join(', ');
      result.percent = zones.length > 0 ? Math.round((correct / zones.length) * 100) : 0;
      result.isCorrect = correct === zones.length && zones.length > 0;
      break;
    }
    case 'dictation': {
      // Wortweise wie in der Anzeige (dictation.js): Punkte = Anteil
      // fehlerfreier Wörter.
      const sentences = (content.sentences || []).filter((s) => s && String(s.text || '').trim());
      const answers = [...root.querySelectorAll('.dict-input')].map((inp) => inp.value);
      const score = scoreDictation(sentences, answers, dictationOptions(content));
      result.userAnswer = answers.map((a) => a.trim()).join(' | ');
      result.correctAnswer = sentences.map((s) => s.text).join(' | ');
      result.isCorrect = score.total > 0 && score.mistakes === 0;
      if (score.total > 0) {
        result.points = score.points;
        const pct = Math.round(score.points * 100);
        result.score = `${score.good}/${score.total} Wörter richtig (${pct}%), ${score.mistakes} Fehler`;
      }
      break;
    }
    case 'audioRecorder': {
      // Bewertet wird die Aufnahme von der Lehrkraft; hier zählt nur, ob abgegeben wurde.
      const player = root.querySelector('.rec-player');
      const file = player?.dataset.submitted || '';
      result.isCorrect = !!file;
      result.points = file ? 1 : 0;
      result.userAnswer = file ? `Aufnahme abgegeben: ${file}` : 'keine Aufnahme abgegeben';
      result.correctAnswer = '—';
      result.score = file ? 'abgegeben' : 'nicht abgegeben';
      break;
    }
    case 'branchingScenario': {
      // Bewertung = Prozentwert des erreichten Endes; ohne Ende 0 Punkte.
      const player = root.querySelector('.bs-player');
      if (player && player.dataset.done) {
        const score = Number(player.dataset.score) || 0;
        let path = [];
        try { path = JSON.parse(player.dataset.path || '[]'); } catch (_) {}
        result.points = score / 100;
        result.isCorrect = score >= 100;
        result.userAnswer = path.join(' → ');
        result.score = `Ende erreicht: ${score} %`;
      } else {
        result.points = 0;
        result.userAnswer = 'nicht bis zu einem Ende gespielt';
        result.score = 'kein Ende erreicht';
      }
      result.correctAnswer = '—';
      break;
    }
    case 'dragAndDrop': {
      const draggablesDef = content.draggables || []; const zonesDef = content.dropZones || [];
      // Pro Zone genau ein Soll-Wert, sonst kann die Aufgabe nie vollständig
      // "richtig" werden. Die Zonen-Seite (im Editor gepflegt) ist
      // maßgeblich; die Ziehbare-Element-Seite füllt nur Zonen auf, die dort
      // noch keinen Wert haben, und nur für Zonen, die es noch gibt – sonst
      // zählen veraltete correctZone-Verweise als zusätzliche, unerfüllbare
      // Anforderung mit.
      const zoneLabels = new Set(zonesDef.map((z) => z.label));
      // Zonen mit derselben (nicht-leeren) Gruppen-ID sind untereinander
      // vertauschbar, z. B. die zwei gleichwertigen Eingänge eines
      // Oder-Gatters. Ohne Gruppe zählt weiterhin nur die eigene Zone.
      const zoneGroup = new Map(zonesDef.map((z) => [z.label, z.group || '']));
      const expectedMappings = [];
      zonesDef.forEach((z) => { if (z.correctDraggable) expectedMappings.push({ zone: z.label, text: z.correctDraggable }); });
      draggablesDef.forEach((d) => { if (d.correctZone && zoneLabels.has(d.correctZone) && !expectedMappings.find((m) => m.zone === d.correctZone)) expectedMappings.push({ zone: d.correctZone, text: d.text }); });
      const dragEls = root.querySelectorAll('.dnd-player-drag');
      let correct = 0; let incorrect = 0; const placements = [];
      const satisfiedDefs = new Set();
      dragEls.forEach((el) => {
        const currentZone = el.dataset.currentZone || ''; const text = el.textContent;
        const isMultipleSource = el.dataset.multiple === 'true' && !currentZone;
        if (currentZone) {
          const currentGroup = zoneGroup.get(currentZone) || '';
          const matchIdx = expectedMappings.findIndex((m, idx) => {
            if (satisfiedDefs.has(idx) || m.text !== text) return false;
            if (m.zone === currentZone) return true;
            const targetGroup = zoneGroup.get(m.zone) || '';
            return !!currentGroup && currentGroup === targetGroup;
          });
          if (matchIdx !== -1) { satisfiedDefs.add(matchIdx); correct++; } else { incorrect++; }
          placements.push(`${text} → ${currentZone}`);
        } else if (!isMultipleSource) { placements.push(`${text} → (nicht zugeordnet)`); }
      });
      result.userAnswer = placements.join(', ');
      result.correctAnswer = expectedMappings.map((m) => `${m.text} → ${m.zone}`).join(', ');
      result.isCorrect = expectedMappings.length > 0 && correct === expectedMappings.length && incorrect === 0;
      // Teilpunkte je richtig abgelegtem Begriff. Falsch abgelegte vergrößern
      // den Nenner, damit wahlloses Verteilen aller Begriffe nicht belohnt wird.
      const denominator = Math.max(expectedMappings.length, correct + incorrect);
      if (denominator > 0) {
        result.points = correct / denominator;
        const pct = Math.round(result.points * 100);
        result.score = `Richtig: ${pct}% | Falsch: ${100 - pct}%`;
      }
      break;
    }
    case 'flashcards': {
      const cards = content.cards || []; let correct = 0; const answers = [];
      cards.forEach((card) => {
        const user = (card._userAnswer || '').trim(); const expected = card.answer || '';
        const alts = expected.split('/').map((a) => a.trim().toLowerCase()).filter(Boolean);
        const ok = alts.includes(user.toLowerCase());
        if (ok) correct++;
        answers.push(`${user || '—'} (${ok ? '✓' : '✗'})`);
      });
      result.userAnswer = `${correct}/${cards.length} richtig`; result.correctAnswer = `${cards.length}/${cards.length}`;
      result.isCorrect = correct === cards.length && cards.length > 0;
      break;
    }
    default: {
      result.isCorrect = true; result.userAnswer = 'Angesehen'; result.correctAnswer = '—';
      break;
    }
  }
  // Reine Informationen (z. B. ein Arbeitsblatt zum Lesen) sind keine Aufgabe.
  // Sie zählten sonst als gelöst und hoben die Prozentzahl, ohne dass
  // jemand etwas beantwortet hätte.
  if ((H5P_TYPES[mod.type] || {}).informational) {
    result.informational = true;
    result.isCorrect = true;
    result.userAnswer = 'Gelesen';
    result.correctAnswer = '';
    result.points = null;
    return result;
  }
  // Punkte dieser Aufgabe (0 bis 1). Aufgabentypen ohne Teilpunkte zählen ganz oder gar nicht.
  if (result.points === undefined) result.points = result.isCorrect ? 1 : 0;
  return result;
}
