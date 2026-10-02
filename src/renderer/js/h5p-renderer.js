import { videoSourceOf } from './video.js';
import { normalizeBranching } from './branching.js';
import { audioSourceOf, scoreDictation, dictationOptions } from './dictation.js';
import { normalizeShareUrl, sanitizeModuleDescriptionHtml, sanitizeWorksheetHtml, escapeHtml, escapeAttr, hexTint, showContextMenu, attachPointerDrag } from './utils.js';

/**
 * Nur http(s) einbetten. Ohne diese Schranke landeten `javascript:`- oder
 * `data:`-Adressen aus einem Modulfeld direkt im src eines Rahmens.
 */
function safeHttpUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.origin);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

/**
 * Eingebetteter Rahmen für Webseiten.
 *
 * Der Sandkasten bleibt eng: Ein fremder Auftritt soll unsere Seite weder
 * verlassen noch übernehmen können.
 */
function embeddedFrame(url, height, title, extraStyle = '') {
  return `<iframe src="${escapeAttr(url)}" title="${escapeAttr(title)}"
    style="display:block; width:100%; height:${Number(height) || 600}px; border:0; ${extraStyle}"
    sandbox="allow-scripts allow-popups allow-forms allow-downloads"
    referrerpolicy="no-referrer" loading="lazy"></iframe>`;
}

// ==================== H5P RENDERER ====================

/** Modultypen, deren Vorschau breiter als Fließtext sein darf. */
const WIDE_TYPES = new Set(['dragAndDrop', 'imageHotspots', 'video', 'worksheet', 'coursePresentation',
  'branchingScenario', 'iframeEmbedder', 'collage']);

export class H5pRenderer {

  // ------ Public API ------

  renderPreview(mod, typeDef, container, options = {}) {
    let content = mod.content || {};
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch (e) {
        content = {};
      }
    }
    const wrapper = document.createElement('div');
    // Text bleibt schmal (lange Zeilen lesen sich schlecht); bildlastige
    // Aufgaben dürfen die Breite großer Bildschirme nutzen.
    wrapper.style.maxWidth = WIDE_TYPES.has(mod.type) ? 'none' : '800px';
    wrapper.style.margin = '0 auto';

    const header = document.createElement('div');
    header.innerHTML = `
      <div style="text-align:center; margin-bottom:24px;">
        <span style="font-size:3rem;">${typeDef.icon || '📦'}</span>
        <h3 style="margin-top:8px;">${escapeHtml(mod.title)}</h3>
        <p style="color:var(--text-secondary); font-size:0.9rem;">${typeDef.name} — ${typeDef.category || ''}</p>
      </div>
    `;
    wrapper.appendChild(header);

    if (mod.description) {
      const desc = document.createElement('div');
      desc.className = 'module-description-content';
      desc.style.cssText = 'margin-bottom:20px; color:var(--text-secondary);';
      desc.innerHTML = sanitizeModuleDescriptionHtml(mod.description);
      wrapper.appendChild(desc);
    }

    const previewEl = this.createTypePreview(mod.type, content, { ...options, moduleId: mod.id, title: mod.title });
    wrapper.appendChild(previewEl);
    container.appendChild(wrapper);
  }

  renderModuleImage(content, options = {}) {
    if (!content || !content.imageUrl) return '';
    const marginBottom = options.marginBottom || '16px';
    return `
      <div style="margin-bottom:${marginBottom};">
        <img src="${content.imageUrl}" alt="Modulbild"
          style="display:block; max-width:100%; max-height:320px; object-fit:contain;
                 border-radius:var(--radius-md); border:1px solid var(--border); background:var(--bg-primary);" />
      </div>
    `;
  }

  // ------ Type Preview Factory ------

  createTypePreview(type, content, options = {}) {
    const suppressFeedback = !!(options.quizMode && options.examMode);
    const div = document.createElement('div');

    const globalNextBtn = document.getElementById('btnQuizNext');
    if (globalNextBtn) globalNextBtn.disabled = false;

    switch (type) {

      case 'accordion': {
        const panels = content.panels || [];
        for (const panel of panels) {
          const details = document.createElement('details');
          details.style.cssText = 'margin-bottom:8px; border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden;';
          const summary = document.createElement('summary');
          summary.style.cssText = 'padding:12px 16px; cursor:pointer; font-weight:600; background:var(--bg-primary);';
          summary.textContent = panel.title || '';
          const body = document.createElement('div');
          body.style.cssText = 'padding:12px 16px;';
          // Formatiert (neu) oder reiner Text (ältere Module).
          const text = panel.content || '';
          if (/<\/?[a-z][\s\S]*>/i.test(text)) {
            body.className = 'worksheet-content';
            body.innerHTML = sanitizeWorksheetHtml(text);
          } else {
            body.style.whiteSpace = 'pre-line';
            body.textContent = text;
          }
          details.appendChild(summary);
          details.appendChild(body);
          div.appendChild(details);
        }
        break;
      }

      case 'arithmeticQuiz': {
        div.innerHTML = `
          <div style="text-align:center; padding:30px; background:var(--accent-light); border-radius:var(--radius-md);">
            <p><strong>Rechenart:</strong> ${content.arithmeticType || 'Addition'}</p>
            <p><strong>Max. Zahl:</strong> ${content.maxNumber || 10}</p>
            <p><strong>Fragen:</strong> ${content.numQuestions || 10}</p>
            ${content.timeLimit ? `<p><strong>Zeitlimit:</strong> ${content.timeLimit}s</p>` : ''}
            <button class="btn btn-primary" style="margin-top:16px;"
              onclick="this.parentElement.querySelector('.quiz-area').style.display='block'; this.style.display='none';">
              Quiz starten
            </button>
            <div class="quiz-area" style="display:none; margin-top:20px;"></div>
          </div>
        `;
        this.startArithmeticQuiz(div.querySelector('.quiz-area'), content, suppressFeedback);
        break;
      }

      case 'multipleChoice': {
        const q = content.question || 'Keine Frage definiert';
        const answers = content.answers || [];
        div.innerHTML = `
          <div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
            ${this.renderModuleImage(content)}
            <div style="font-weight:600; margin-bottom:16px;">${sanitizeModuleDescriptionHtml(q)}</div>
            <div class="mc-answers"></div>
            ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" style="margin-top:16px;" id="mcCheck">Überprüfen</button><div id="mcFeedback" style="margin-top:12px;"></div>'}
          </div>`;
        const answersEl = div.querySelector('.mc-answers');
        const isSingle = content.singleAnswer;
        answers.forEach((a, i) => {
          const row = document.createElement('div');
          row.style.cssText = 'margin-bottom:8px; display:flex; align-items:center; gap:8px;';
          const input = document.createElement('input');
          input.type = isSingle ? 'radio' : 'checkbox';
          input.name = 'mc-answer';
          input.value = i;
          input.dataset.correct = a.correct ? 'true' : 'false';
          const label = document.createElement('label');
          label.innerHTML = sanitizeModuleDescriptionHtml(a.text);
          row.appendChild(input);
          row.appendChild(label);
          answersEl.appendChild(row);
        });
        const mcCheckBtn = div.querySelector('#mcCheck');
        if (mcCheckBtn) {
          mcCheckBtn.addEventListener('click', () => {
            const inputs = answersEl.querySelectorAll('input');
            let allCorrect = true;
            inputs.forEach((inp) => {
              const isCorrect = inp.dataset.correct === 'true';
              if (inp.checked !== isCorrect) allCorrect = false;
              inp.parentElement.style.color = inp.checked
                ? (isCorrect ? 'green' : 'red')
                : (isCorrect ? 'orange' : '');
            });
            div.querySelector('#mcFeedback').innerHTML = allCorrect
              ? '<span style="color:green; font-weight:600;">✓ Richtig!</span>'
              : '<span style="color:red; font-weight:600;">✗ Nicht ganz richtig. Versuchen Sie es nochmal.</span>';
          });
        }
        break;
      }

      case 'trueFalse': {
        let tfQuestions = content.questions || [content];
        if (content.randomOrder) {
          tfQuestions = [...tfQuestions];
          for (let i = tfQuestions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tfQuestions[i], tfQuestions[j]] = [tfQuestions[j], tfQuestions[i]];
          }
        }
        if (tfQuestions.length === 0) { div.textContent = 'Keine Fragen definiert.'; break; }

        let tfIdx = 0;
        div.innerHTML = `
          <div class="tf-player">
            <div class="tf-progress"><span id="tfProgress">Frage 1 von ${tfQuestions.length}</span></div>
            <div class="tf-card">
              ${this.renderModuleImage(content, { marginBottom: '20px' })}
              <p id="tfQuestion" class="tf-question"></p>
              <div class="tf-buttons">
                <button class="btn btn-secondary tf-btn" id="tfTrue" data-val="true">Wahr</button>
                <button class="btn btn-secondary tf-btn" id="tfFalse" data-val="false">Falsch</button>
              </div>
              <div id="tfFeedback" class="tf-feedback"></div>
            </div>
            <div class="tf-nav">
              <button class="btn btn-secondary btn-sm" id="tfPrev">← Zurück</button>
              <span id="tfScore" class="tf-score"></span>
              <button class="btn btn-secondary btn-sm" id="tfNext">Weiter →</button>
            </div>
          </div>`;

        const tfQuestion = div.querySelector('#tfQuestion');
        const tfFeedback = div.querySelector('#tfFeedback');
        const tfProgress = div.querySelector('#tfProgress');
        const tfScore    = div.querySelector('#tfScore');
        const tfTrue     = div.querySelector('#tfTrue');
        const tfFalse    = div.querySelector('#tfFalse');
        const tfResults  = tfQuestions.map(() => null);

        if (tfQuestions.length > 1) {
          const nb = document.getElementById('btnQuizNext');
          if (nb) nb.disabled = true;
        }

        const updateTfScore = () => {
          if (suppressFeedback) { tfScore.textContent = ''; return; }
          const answered = tfResults.filter((r) => r !== null).length;
          const correct  = tfResults.filter((r) => r === true).length;
          tfScore.textContent = answered > 0 ? `${correct}/${answered} richtig` : '';
        };

        const showTfQuestion = () => {
          if (tfIdx === tfQuestions.length - 1) {
            const nb = document.getElementById('btnQuizNext');
            if (nb) nb.disabled = false;
          }
          const q = tfQuestions[tfIdx];
          tfQuestion.textContent = q.question || '';
          tfProgress.textContent = `Frage ${tfIdx + 1} von ${tfQuestions.length}`;
          if (tfResults[tfIdx] !== null) {
            // In exam mode: keep buttons enabled to allow changing answer before moving on
            tfTrue.disabled = suppressFeedback ? false : true;
            tfFalse.disabled = suppressFeedback ? false : true;
            tfTrue.classList.remove('tf-selected'); tfFalse.classList.remove('tf-selected');
            if (q._userAnswer === 'true') tfTrue.classList.add('tf-selected');
            if (q._userAnswer === 'false') tfFalse.classList.add('tf-selected');
            if (suppressFeedback) {
              tfFeedback.innerHTML = ''; tfFeedback.className = 'tf-feedback';
            } else {
              const correct = tfResults[tfIdx];
              tfFeedback.innerHTML = correct
                ? `<span class="tf-correct">✓ ${escapeHtml(q.feedbackCorrect || 'Richtig!')}</span>`
                : `<span class="tf-wrong">✗ ${escapeHtml(q.feedbackWrong || 'Leider falsch.')}</span>`;
              tfFeedback.className = 'tf-feedback ' + (correct ? 'tf-feedback-correct' : 'tf-feedback-wrong');
            }
          } else {
            tfTrue.disabled = false; tfFalse.disabled = false;
            tfTrue.classList.remove('tf-selected'); tfFalse.classList.remove('tf-selected');
            tfFeedback.innerHTML = ''; tfFeedback.className = 'tf-feedback';
          }
          updateTfScore();
        };

        const handleTfAnswer = (val) => {
          if (tfResults[tfIdx] !== null && !suppressFeedback) return;
          const q = tfQuestions[tfIdx];
          q._userAnswer = val;
          tfResults[tfIdx] = q.correctAnswer === val;
          showTfQuestion();
        };

        tfTrue.addEventListener('click', () => handleTfAnswer('true'));
        tfFalse.addEventListener('click', () => handleTfAnswer('false'));
        div.querySelector('#tfPrev').addEventListener('click', () => { if (tfIdx > 0) { tfIdx--; showTfQuestion(); } });
        div.querySelector('#tfNext').addEventListener('click', () => { if (tfIdx < tfQuestions.length - 1) { tfIdx++; showTfQuestion(); } });
        showTfQuestion();
        break;
      }

      case 'dialogCards':
      case 'flashcards': {
        const cards = content.cards || [];
        if (cards.length === 0) { div.textContent = 'Keine Karten definiert.'; break; }
        const frontKey   = type === 'dialogCards' ? 'front' : 'question';
        const backKey    = type === 'dialogCards' ? 'back'  : 'answer';
        const isFlashcards = type === 'flashcards';

        if (isFlashcards) {
          let idx = 0;
          div.innerHTML = `
            <div class="fc-player">
              <div class="fc-card">
                <div id="fcImage" class="fc-image"></div>
                <div id="fcQuestion" class="fc-question"></div>
                <div class="fc-answer-row">
                  <input type="text" id="fcInput" class="fc-input" placeholder="Antwort eingeben…" autocomplete="off" />
                  <button class="btn btn-primary btn-sm" id="fcCheck">Prüfen</button>
                </div>
                <div id="fcFeedback" class="fc-feedback"></div>
              </div>
              <div class="fc-nav">
                <button class="btn btn-secondary btn-sm" id="fcPrev">← Zurück</button>
                <span id="fcCounter" class="fc-counter">1 / ${cards.length}</span>
                <span id="fcScore" class="fc-score"></span>
                <button class="btn btn-secondary btn-sm" id="fcNext">Weiter →</button>
              </div>
            </div>`;

          const fcImage    = div.querySelector('#fcImage');
          const fcQuestion = div.querySelector('#fcQuestion');
          const fcInput    = div.querySelector('#fcInput');
          const fcCheck    = div.querySelector('#fcCheck');
          const fcFeedback = div.querySelector('#fcFeedback');
          const fcCounter  = div.querySelector('#fcCounter');
          const fcScore    = div.querySelector('#fcScore');
          const cardResults = cards.map(() => null);

          const updateScore = () => {
            if (suppressFeedback) { fcScore.textContent = ''; return; }
            const answered = cardResults.filter((r) => r !== null).length;
            const correct  = cardResults.filter((r) => r === true).length;
            fcScore.textContent = answered > 0 ? `${correct}/${answered} richtig` : '';
          };

          const showFeedback = (correct, answer) => {
            if (suppressFeedback) { fcFeedback.innerHTML = '<span style="font-weight:600;">Antwort gespeichert.</span>'; fcFeedback.className = 'fc-feedback'; return; }
            if (correct) { fcFeedback.innerHTML = '<span class="fc-correct">✅ Richtig!</span>'; fcFeedback.className = 'fc-feedback fc-feedback-correct'; }
            else { fcFeedback.innerHTML = `<span class="fc-wrong">❌ Falsch.</span> Richtige Antwort: <strong>${escapeHtml(answer)}</strong>`; fcFeedback.className = 'fc-feedback fc-feedback-wrong'; }
          };

          const showCard = () => {
            const card = cards[idx];
            if (card.imageUrl) { fcImage.innerHTML = `<img src="${card.imageUrl}" />`; fcImage.style.display = ''; }
            else { fcImage.innerHTML = ''; fcImage.style.display = 'none'; }
            fcQuestion.textContent = card[frontKey] || '';
            fcCounter.textContent = `${idx + 1} / ${cards.length}`;
            if (cardResults[idx] !== null) {
              fcInput.value = card._userAnswer || '';
              fcInput.disabled = true; fcCheck.disabled = true;
              showFeedback(cardResults[idx], card[backKey]);
            } else {
              fcInput.value = ''; fcInput.disabled = false; fcCheck.disabled = false;
              fcFeedback.innerHTML = ''; fcFeedback.className = 'fc-feedback';
            }
            updateScore();
          };

          fcCheck.addEventListener('click', () => {
            const userAnswer = fcInput.value.trim();
            if (!userAnswer) return;
            const correctAnswer = cards[idx][backKey] || '';
            const alternatives = correctAnswer.split('/').map((a) => a.trim().toLowerCase()).filter(Boolean);
            const isCorrect = alternatives.includes(userAnswer.toLowerCase());
            cardResults[idx] = isCorrect;
            cards[idx]._userAnswer = userAnswer;
            fcInput.disabled = true; fcCheck.disabled = true;
            showFeedback(isCorrect, correctAnswer);
            updateScore();
          });

          fcInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !fcCheck.disabled) fcCheck.click(); });
          div.querySelector('#fcPrev').addEventListener('click', () => { if (idx > 0) { idx--; showCard(); } });
          div.querySelector('#fcNext').addEventListener('click', () => { if (idx < cards.length - 1) { idx++; showCard(); } });
          showCard();

        } else {
          // dialogCards: click-to-flip
          let idx = 0;
          let flipped = false;
          div.innerHTML = `
            <div class="dc-player">
              <div class="dc-card">
                <div id="dcImage" class="dc-image"></div>
                <div id="dcAudio" class="dc-audio"></div>
                <div id="cardDisplay" class="dc-display">${escapeHtml(cards[0][frontKey] || '')}</div>
                <p class="dc-hint">Klicken zum Umdrehen</p>
                <div id="dcTip" class="dc-tip"></div>
              </div>
              <div class="dc-nav">
                <button class="btn btn-secondary btn-sm" id="cardPrev">← Zurück</button>
                <span id="cardCounter" class="dc-counter">1 / ${cards.length}</span>
                <button class="btn btn-secondary btn-sm" id="cardNext">Weiter →</button>
              </div>
            </div>`;

          const cardDisplay = div.querySelector('#cardDisplay');
          const cardCounter = div.querySelector('#cardCounter');
          const dcImage     = div.querySelector('#dcImage');
          const dcAudio     = div.querySelector('#dcAudio');
          const dcTip       = div.querySelector('#dcTip');

          const showCardMedia = (card) => {
            if (card.imageUrl) { dcImage.innerHTML = `<img src="${card.imageUrl}" />`; dcImage.style.display = ''; }
            else { dcImage.innerHTML = ''; dcImage.style.display = 'none'; }
            if (card.audioUrl) {
              dcAudio.innerHTML = ''; dcAudio.style.display = '';
              const audioEl = document.createElement('audio');
              audioEl.controls = true;
              audioEl.style.cssText = 'width:100%;max-width:320px;';
              audioEl.src = card.audioUrl;
              dcAudio.appendChild(audioEl);
              audioEl.addEventListener('error', () => {
                dcAudio.innerHTML = '';
                let playing = false; let audioCtx = null;
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'btn btn-secondary btn-sm'; btn.textContent = '▶️ Audio abspielen';
                btn.addEventListener('click', async () => {
                  if (playing) { if (audioCtx) { audioCtx.close(); audioCtx = null; } playing = false; btn.textContent = '▶️ Audio abspielen'; return; }
                  try {
                    audioCtx = new AudioContext();
                    const resp = await fetch(card.audioUrl);
                    const arrayBuf = await resp.arrayBuffer();
                    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
                    const sourceNode = audioCtx.createBufferSource();
                    sourceNode.buffer = audioBuf;
                    sourceNode.connect(audioCtx.destination);
                    sourceNode.start(0);
                    playing = true; btn.textContent = '⏹️ Stoppen';
                    sourceNode.onended = () => { playing = false; btn.textContent = '▶️ Audio abspielen'; if (audioCtx) { audioCtx.close(); audioCtx = null; } };
                  } catch (_) { btn.textContent = '❌ Audio nicht abspielbar'; btn.disabled = true; }
                });
                dcAudio.appendChild(btn);
              }, { once: true });
            } else { dcAudio.innerHTML = ''; dcAudio.style.display = 'none'; }
            if (card.tip) { dcTip.innerHTML = `<span class="dc-tip-icon" title="${escapeAttr(card.tip)}">💡 Hinweis</span>`; dcTip.style.display = ''; }
            else { dcTip.style.display = 'none'; }
          };

          if (cards.length > 1) { const nb = document.getElementById('btnQuizNext'); if (nb) nb.disabled = true; }

          const updateCard = () => {
            if (idx === cards.length - 1) { const nb = document.getElementById('btnQuizNext'); if (nb) nb.disabled = false; }
            flipped = false;
            cardDisplay.textContent = cards[idx][frontKey] || '';
            cardDisplay.style.background = 'var(--accent-light)';
            cardCounter.textContent = `${idx + 1} / ${cards.length}`;
            showCardMedia(cards[idx]);
          };

          showCardMedia(cards[0]);
          cardDisplay.addEventListener('click', () => {
            flipped = !flipped;
            cardDisplay.textContent = flipped ? (cards[idx][backKey] || '') : (cards[idx][frontKey] || '');
            cardDisplay.style.background = flipped ? '#dcfce7' : 'var(--accent-light)';
          });
          div.querySelector('#cardPrev').addEventListener('click', () => { if (idx > 0) { idx--; updateCard(); } });
          div.querySelector('#cardNext').addEventListener('click', () => { if (idx < cards.length - 1) { idx++; updateCard(); } });
        }
        break;
      }

      case 'fillInTheBlanks': {
        const questions = content.questions || [];
        div.innerHTML = `
          <div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
            ${content.taskDescription ? `<div style="margin-bottom:16px;">${sanitizeModuleDescriptionHtml(content.taskDescription)}</div>` : ''}
            ${this.renderModuleImage(content)}
            <div id="blanksArea"></div>
            <div style="display:flex; align-items:center; gap:12px; margin-top:16px;">
              ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" id="blanksCheck">Überprüfen</button>'}
              <button class="btn btn-secondary btn-sm" id="blanksNext">Weiter →</button>
            </div>
            ${suppressFeedback ? '' : '<div id="blanksFeedback" style="margin-top:12px;"></div>'}
          </div>`;
        const blanksArea = div.querySelector('#blanksArea');
        const answerMap = [];
        questions.forEach((q) => {
          const p = document.createElement('div');
          p.style.marginBottom = '12px';
          p.innerHTML = sanitizeModuleDescriptionHtml(q.text || '');
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false);
          const textNodes = [];
          let node;
          while ((node = walker.nextNode())) textNodes.push(node);
          textNodes.forEach((textNode) => {
            const parts = textNode.nodeValue.split(/(\*[^*]+\*)/g);
            if (parts.length > 1) {
              const fragment = document.createDocumentFragment();
              parts.forEach((part) => {
                const match = part.match(/^\*(.+)\*$/);
                if (match) {
                  const answer = match[1];
                  const input = document.createElement('input');
                  input.type = 'text';
                  input.style.cssText = 'width:120px; padding:4px 8px; border:1px solid var(--border); border-radius:4px; margin:0 4px;';
                  input.dataset.answer = answer;
                  answerMap.push({ answer, inputEl: input });
                  fragment.appendChild(input);
                } else if (part) {
                  fragment.appendChild(document.createTextNode(part));
                }
              });
              textNode.parentNode.replaceChild(fragment, textNode);
            }
          });
          blanksArea.appendChild(p);
        });
        const blanksCheckBtn = div.querySelector('#blanksCheck');
        if (blanksCheckBtn) {
          blanksCheckBtn.addEventListener('click', () => {
            let correct = 0;
            answerMap.forEach(({ answer, inputEl }) => {
              const userVal = inputEl.value.trim();
              const alternatives = answer.split('/').map((a) => a.trim()).filter(Boolean);
              const match = alternatives.some((alt) => content.caseSensitive ? userVal === alt : userVal.toLowerCase() === alt.toLowerCase());
              inputEl.style.borderColor = match ? 'green' : 'red';
              if (match) correct++;
            });
            div.querySelector('#blanksFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${answerMap.length} richtig</span>`;
          });
        }
        const blanksNextBtn = div.querySelector('#blanksNext');
        if (blanksNextBtn) {
          blanksNextBtn.addEventListener('click', () => { const nb = document.getElementById('btnQuizNext'); if (nb) nb.click(); });
        }
        break;
      }

      case 'essay': {
        const minChars = Number(content.minChars) || 0;
        const rows = Number(content.inputFieldSize) || 10;
        div.innerHTML = `
          <div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
            ${content.taskDescription ? `<p style="margin-bottom:16px;">${escapeHtml(content.taskDescription)}</p>` : ''}
            ${this.renderModuleImage(content)}
            <textarea id="essayAnswer" rows="${rows}" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-sm); resize:vertical;"></textarea>
            <div style="display:flex; align-items:center; gap:12px; margin-top:12px; flex-wrap:wrap;">
              ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" id="essayCheck">Überprüfen</button>'}
              ${minChars > 0 ? `<span style="font-size:0.85rem; color:var(--text-secondary);">Min. ${minChars} Zeichen</span>` : ''}
              <span id="essayCounter" style="font-size:0.85rem; color:var(--text-secondary);">0 Zeichen</span>
            </div>
            ${suppressFeedback ? '' : '<div id="essayFeedback" style="margin-top:12px;"></div>'}
            ${!suppressFeedback && content.sampleSolution ? `<details style="margin-top:12px;"><summary style="cursor:pointer;">Musterlösung anzeigen</summary><div style="margin-top:8px; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); white-space:pre-wrap;">${escapeHtml(content.sampleSolution)}</div></details>` : ''}
          </div>`;

        const essayInput   = div.querySelector('#essayAnswer');
        const essayCounter = div.querySelector('#essayCounter');
        const essayFeedback = div.querySelector('#essayFeedback');
        essayInput.addEventListener('input', () => { essayCounter.textContent = `${(essayInput.value || '').trim().length} Zeichen`; });
        const essayCheckBtn = div.querySelector('#essayCheck');
        if (essayCheckBtn) {
          essayCheckBtn.addEventListener('click', () => {
            const len = (essayInput.value || '').trim().length;
            const ok = minChars <= 0 ? len > 0 : len >= minChars;
            essayInput.style.borderColor = ok ? 'green' : 'red';
            essayFeedback.innerHTML = ok
              ? '<span style="color:green; font-weight:600;">✓ Antwort erfasst.</span>'
              : `<span style="color:red; font-weight:600;">✗ Bitte mindestens ${minChars} Zeichen eingeben.</span>`;
          });
        }
        break;
      }

      case 'dragTheWords': {
        div.innerHTML = `
          <div class="dtw-container">
            ${content.taskDescription ? `<div class="dtw-description">${sanitizeModuleDescriptionHtml(content.taskDescription)}</div>` : ''}
            ${this.renderModuleImage(content)}
            <div class="dtw-text-area" id="dtwTextArea"></div>
            <div class="dtw-word-bank" id="dtwWordBank"></div>
            ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" style="margin-top:16px;" id="dtwCheck">Überprüfen</button><div id="dtwFeedback" style="margin-top:12px;"></div>'}
          </div>`;

        const textArea = div.querySelector('#dtwTextArea');
        const wordBank = div.querySelector('#dtwWordBank');
        const draggableWords = [];
        let dropIdx = 0;
        textArea.innerHTML = sanitizeModuleDescriptionHtml(content.textField || '');

        const walker2 = document.createTreeWalker(textArea, NodeFilter.SHOW_TEXT, null, false);
        const textNodes2 = [];
        let node2;
        while ((node2 = walker2.nextNode())) textNodes2.push(node2);

        textNodes2.forEach((textNode) => {
          const parts = textNode.nodeValue.split(/(\*[^*]+\*)/g);
          if (parts.length > 1) {
            const fragment = document.createDocumentFragment();
            parts.forEach((part) => {
              const match = part.match(/^\*(.+)\*$/);
              if (match) {
                const correctWord = match[1];
                draggableWords.push(correctWord);
                const dropZone = document.createElement('span');
                dropZone.className = 'dtw-drop-zone';
                dropZone.dataset.correctWord = correctWord;
                dropZone.dataset.dropIdx = dropIdx++;
                fragment.appendChild(dropZone);
              } else if (part) {
                const staticSpan = document.createElement('span');
                staticSpan.className = 'dtw-static-text';
                staticSpan.textContent = part;
                staticSpan.setAttribute('unselectable', 'on');
                staticSpan.style.userSelect = 'none';
                staticSpan.style.webkitUserSelect = 'none';
                fragment.appendChild(staticSpan);
              }
            });
            textNode.parentNode.replaceChild(fragment, textNode);
          }
        });

        function returnWordToBank(word, bank) {
          const chips = bank.querySelectorAll('.dtw-chip');
          for (const c of chips) {
            if (c.textContent === word && c.classList.contains('dtw-chip-used')) { c.classList.remove('dtw-chip-used'); break; }
          }
        }

        const clearZone = (zone) => {
          zone.textContent = ''; zone.dataset.currentWord = ''; zone.classList.remove('dtw-drop-filled');
        };

        // Wort in eine Luecke legen. Ein dort liegendes Wort geht zurueck in
        // die Wortbank; kommt das Wort aus einer anderen Luecke, wird diese frei.
        const fillZone = (zone, word, { chip = null, fromZone = null } = {}) => {
          if (zone === fromZone) return;
          if (zone.dataset.currentWord) returnWordToBank(zone.dataset.currentWord, wordBank);
          zone.textContent = word; zone.dataset.currentWord = word; zone.classList.add('dtw-drop-filled');
          if (chip) chip.classList.add('dtw-chip-used');
          if (fromZone) clearZone(fromZone);
        };

        const removeFromZone = (zone) => {
          const word = zone.dataset.currentWord;
          if (!word) return;
          clearZone(zone);
          returnWordToBank(word, wordBank);
        };

        const zoneAt = (target) => {
          const zone = target && target.closest('.dtw-drop-zone');
          return zone && textArea.contains(zone) ? zone : null;
        };

        // Pointer-Events statt HTML5-Drag&Drop: Auf dem iPad bewegt der Finger
        // ein Wort sofort, ohne vorher lange zu druecken.
        let hoverZone = null;
        const onHover = (target) => {
          const zone = zoneAt(target);
          if (zone === hoverZone) return;
          if (hoverZone) hoverZone.classList.remove('dtw-drop-hover');
          if (zone) zone.classList.add('dtw-drop-hover');
          hoverZone = zone;
        };
        const scrollContainer = document.getElementById('mainContent');
        const openRemoveMenu = (zone, x, y) => showContextMenu(x, y, [
          { label: '✕ Wort entfernen', danger: true, onClick: () => removeFromZone(zone) },
        ]);

        // Ablenkwoerter landen gemischt mit den richtigen Woertern in der
        // Wortbank, gehoeren aber zu keiner Luecke. Schreibweise wie in H5P:
        // *Mond* *Wolke*; ohne Sternchen gilt Komma bzw. Zeilenumbruch als Trenner.
        const distractorText = content.distractors || '';
        const markedDistractors = [...distractorText.matchAll(/\*([^*]+)\*/g)].map((m) => m[1]);
        const distractors = (markedDistractors.length ? markedDistractors : distractorText.split(/[,\n]/))
          .map((w) => w.trim()).filter(Boolean);

        const shuffled = [...draggableWords, ...distractors];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        shuffled.forEach((word) => {
          const chip = document.createElement('span');
          chip.className = 'dtw-chip'; chip.textContent = word;
          attachPointerDrag(chip, {
            scrollContainer, onHover,
            onDrop: (target) => { const zone = zoneAt(target); if (zone) fillZone(zone, word, { chip }); },
          });
          wordBank.appendChild(chip);
        });

        // Gefuellte Luecken lassen sich weiterziehen oder zurueck in die
        // Wortbank ziehen; Rechtsklick bzw. langes Druecken entfernt das Wort.
        textArea.querySelectorAll('.dtw-drop-zone').forEach((zone) => {
          const filled = () => !!zone.dataset.currentWord;
          attachPointerDrag(zone, {
            scrollContainer, onHover,
            canDrag: filled,
            onDrop: (target) => {
              const toZone = zoneAt(target);
              if (toZone) fillZone(toZone, zone.dataset.currentWord, { fromZone: zone });
              else if (target.closest('.dtw-word-bank') === wordBank) removeFromZone(zone);
            },
            canLongPress: filled,
            onLongPress: (x, y) => openRemoveMenu(zone, x, y),
          });
          zone.addEventListener('contextmenu', (e) => {
            if (!filled()) return;
            e.preventDefault();
            openRemoveMenu(zone, e.clientX, e.clientY);
          });
        });

        const dtwCheckBtn = div.querySelector('#dtwCheck');
        if (dtwCheckBtn) {
          dtwCheckBtn.addEventListener('click', () => {
            const zones = textArea.querySelectorAll('.dtw-drop-zone');
            let correct = 0;
            zones.forEach((z) => {
              z.classList.remove('dtw-correct', 'dtw-wrong', 'dtw-missing');
              const current = (z.dataset.currentWord || '').trim();
              const expected = z.dataset.correctWord;
              if (current.toLowerCase() === expected.toLowerCase()) { z.classList.add('dtw-correct'); correct++; }
              else if (current) { z.classList.add('dtw-wrong'); }
              else { z.classList.add('dtw-missing'); }
            });
            div.querySelector('#dtwFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${zones.length} richtig</span>`;
          });
        }
        break;
      }

      case 'markTheWords': {
        div.innerHTML = `
          <div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
            ${content.taskDescription ? `<div style="margin-bottom:16px;">${sanitizeModuleDescriptionHtml(content.taskDescription)}</div>` : ''}
            ${this.renderModuleImage(content)}
            <div id="wordsArea" style="line-height:2.2;"></div>
            ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" style="margin-top:16px;" id="wordsCheck">Überprüfen</button><div id="wordsFeedback" style="margin-top:12px;"></div>'}
          </div>`;
        const wordsArea = div.querySelector('#wordsArea');
        const correctWords = [];
        const makeWordSpan = (word, isCorrect) => {
          const span = document.createElement('span');
          span.style.cssText = 'display:inline-block; padding:4px 8px; margin:2px; border-radius:4px; cursor:pointer; border:1px solid transparent;';
          span.textContent = word;
          span.dataset.correct = isCorrect ? 'true' : 'false';
          if (isCorrect) correctWords.push(span);
          span.addEventListener('click', () => {
            span.classList.toggle('selected');
            span.style.background = span.classList.contains('selected') ? 'var(--accent-light)' : '';
            span.style.borderColor = span.classList.contains('selected') ? 'var(--accent)' : 'transparent';
          });
          return span;
        };
        const parts = (content.textField || '').split(/\*([^*]+)\*/g);
        parts.forEach((part, pi) => {
          if (pi % 2 === 0) {
            const lines = part.split(/\n/);
            lines.forEach((line, li) => {
              if (li > 0) wordsArea.appendChild(document.createElement('br'));
              const indent = line.match(/^[\t ]*/)[0].replace(/\t/g, '    ');
              if (indent.length > 0) { const spacer = document.createElement('span'); spacer.style.cssText = `display:inline-block; width:${indent.length * 0.5}em;`; wordsArea.appendChild(spacer); }
              line.trim().split(/\s+/).filter(Boolean).forEach((word) => { wordsArea.appendChild(makeWordSpan(word, false)); });
            });
          } else {
            wordsArea.appendChild(makeWordSpan(part, true));
          }
        });
        const wordsCheckBtn = div.querySelector('#wordsCheck');
        if (wordsCheckBtn) {
          wordsCheckBtn.addEventListener('click', () => {
            const allSpans = wordsArea.querySelectorAll('span');
            let correct = 0;
            allSpans.forEach((s) => {
              const isCorrect = s.dataset.correct === 'true';
              const isSelected = s.classList.contains('selected');
              if (isSelected && isCorrect) { s.style.background = '#dcfce7'; correct++; }
              else if (isSelected && !isCorrect) { s.style.background = '#fef2f2'; }
              else if (!isSelected && isCorrect) { s.style.background = '#fef9c3'; }
              s.style.borderColor = 'transparent';
            });
            div.querySelector('#wordsFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${correctWords.length} korrekte Wörter markiert</span>`;
          });
        }
        break;
      }

      case 'coursePresentation': {
        const slides = content.slides || [];
        if (slides.length === 0) { div.textContent = 'Keine Folien definiert.'; break; }
        let sIdx = 0;
        div.innerHTML = `
          <div style="background:var(--bg-primary); border-radius:var(--radius-md); padding:24px; min-height:300px;">
            <div id="slideContent" style="min-height:200px;"></div>
            <div style="margin-top:20px; display:flex; justify-content:center; gap:12px; align-items:center;">
              <button class="btn btn-secondary btn-sm" id="slidePrev">← Zurück</button>
              <span id="slideCounter">1 / ${slides.length}</span>
              <button class="btn btn-secondary btn-sm" id="slideNext">Weiter →</button>
            </div>
          </div>`;
        const slideContent = div.querySelector('#slideContent');
        const slideCounter = div.querySelector('#slideCounter');
        if (slides.length > 1) { const nb = document.getElementById('btnQuizNext'); if (nb) nb.disabled = true; }
        const updateSlide = () => {
          if (sIdx === slides.length - 1) { const nb = document.getElementById('btnQuizNext'); if (nb) nb.disabled = false; }
          const slide = slides[sIdx];
          slideContent.innerHTML = `<h3 style="margin-bottom:12px;">${escapeHtml(slide.slideTitle || '')}</h3><div>${slide.slideContent || ''}</div>`;
          slideCounter.textContent = `${sIdx + 1} / ${slides.length}`;
        };
        updateSlide();
        div.querySelector('#slidePrev').addEventListener('click', () => { if (sIdx > 0) { sIdx--; updateSlide(); } });
        div.querySelector('#slideNext').addEventListener('click', () => { if (sIdx < slides.length - 1) { sIdx++; updateSlide(); } });
        break;
      }

      case 'dictation': {
        const sentences = (content.sentences || []).filter((s) => s && String(s.text || '').trim());
        const opts = dictationOptions(content);
        const maxPlays = Math.max(0, Number(content.maxPlays) || 0);
        const slow = content.slowPlayback !== false;
        div.innerHTML = `
          <div class="dict-player">
            <p class="dict-instructions">${escapeHtml(content.instructions || 'Hör dir jeden Satz an und schreibe ihn auf.')}</p>
            <div class="dict-area"></div>
            ${suppressFeedback ? '' : '<div class="dict-actions"><button class="btn btn-primary btn-sm dict-check">Überprüfen</button></div><div class="dict-feedback"></div>'}
          </div>`;
        const area = div.querySelector('.dict-area');

        // Nur ein Satz spielt zur Zeit – ein neuer Klick hält den vorigen an.
        // active: { audio | null (= Sprachausgabe), paused, idle() }
        let active = null;
        const stopAll = () => {
          if (!active) return;
          const a = active;
          active = null;
          if (a.audio) { try { a.audio.pause(); a.audio.currentTime = 0; } catch (_) {} }
          else if (window.speechSynthesis) window.speechSynthesis.cancel();
          a.idle();
        };

        sentences.forEach((s, i) => {
          const src = audioSourceOf(s);
          const row = document.createElement('div');
          row.className = 'dict-row';
          row.innerHTML = `
            <div class="dict-row-head">
              <span class="dict-num">${i + 1}.</span>
              <button type="button" class="btn btn-secondary btn-sm dict-play" title="Satz anhören">▶ Anhören</button>
              ${slow ? '<button type="button" class="btn btn-secondary btn-sm dict-slow" title="Langsamer anhören">🐢 Langsam</button>' : ''}
              <button type="button" class="btn btn-secondary btn-sm dict-pause hidden" title="Anhalten / weiter">⏸ Pause</button>
              <button type="button" class="btn btn-secondary btn-sm dict-stop hidden" title="Beenden">⏹ Stopp</button>
              <span class="dict-plays hint"></span>
              <span class="dict-error hint"></span>
            </div>
            <textarea class="dict-input" rows="2" spellcheck="false" autocapitalize="off" autocorrect="off"
              aria-label="Satz ${i + 1}" placeholder="Hier schreiben …"></textarea>
            <div class="dict-result hidden"></div>`;
          area.appendChild(row);

          let plays = 0;
          const playsEl = row.querySelector('.dict-plays');
          const errorEl = row.querySelector('.dict-error');
          const buttons = [...row.querySelectorAll('.dict-play, .dict-slow')];
          const showPlays = () => {
            if (!maxPlays) return;
            const left = Math.max(0, maxPlays - plays);
            playsEl.textContent = left ? `noch ${left}× anhören` : 'nicht mehr anhörbar';
            buttons.forEach((b) => { b.disabled = !left; });
          };
          showPlays();

          const pauseBtn = row.querySelector('.dict-pause');
          const stopBtn = row.querySelector('.dict-stop');
          const failMsg = '⚠️ Die Audio-Datei lässt sich nicht abspielen – bitte der Lehrkraft Bescheid geben.';
          // Pause und Stopp nur, solange dieser Satz läuft.
          const setPlaying = (on) => {
            pauseBtn.classList.toggle('hidden', !on);
            stopBtn.classList.toggle('hidden', !on);
            pauseBtn.textContent = '⏸ Pause';
            row.classList.toggle('dict-playing', on);
          };
          const idle = () => setPlaying(false);
          const finished = (me) => { if (active === me) { active = null; idle(); } };

          // Im Seitenbaum (unsichtbar), damit das Quiz beim Weiterblättern
          // auch diesen Ton anhält.
          let audio = null;
          if (src) {
            audio = document.createElement('audio');
            audio.preload = 'none';
            audio.hidden = true;
            audio.src = src;
            audio.addEventListener('error', () => { errorEl.textContent = failMsg; stopAll(); });
            row.appendChild(audio);
          }

          const play = (rate) => {
            if (maxPlays && plays >= maxPlays) return;
            stopAll();
            errorEl.textContent = '';
            if (audio) {
              const me = { audio, paused: false, idle };
              active = me;
              audio.onended = () => finished(me);
              audio.currentTime = 0;
              audio.playbackRate = rate;
              audio.preservesPitch = true;
              setPlaying(true);
              audio.play().then(() => { plays++; showPlays(); }).catch(() => {
                errorEl.textContent = failMsg;
                finished(me);
              });
            } else if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
              // Ohne Aufnahme liest der Browser den Satz vor.
              const u = new SpeechSynthesisUtterance(s.text);
              u.lang = content.language || 'de-DE';
              u.rate = rate;
              const voice = window.speechSynthesis.getVoices().find((v) => v.lang === u.lang)
                || window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(u.lang.slice(0, 2)));
              if (voice) u.voice = voice;
              const me = { audio: null, paused: false, idle };
              active = me;
              u.onend = () => finished(me);
              u.onerror = () => finished(me);
              setPlaying(true);
              window.speechSynthesis.speak(u);
              plays++;
              showPlays();
            } else {
              errorEl.textContent = '⚠️ Dieser Browser kann nichts vorlesen, und es ist keine Audio-Datei hinterlegt.';
            }
          };
          row.querySelector('.dict-play').addEventListener('click', () => play(1));
          row.querySelector('.dict-slow')?.addEventListener('click', () => play(0.7));

          // Anhalten und Weiter – zählt nicht als weiteres Anhören.
          pauseBtn.addEventListener('click', () => {
            const me = active;
            if (!me || me.idle !== idle) return;
            if (me.paused) {
              if (me.audio) me.audio.play().catch(() => {}); else window.speechSynthesis.resume();
              me.paused = false;
              pauseBtn.textContent = '⏸ Pause';
            } else {
              if (me.audio) me.audio.pause(); else window.speechSynthesis.pause();
              me.paused = true;
              pauseBtn.textContent = '▶ Weiter';
            }
          });
          stopBtn.addEventListener('click', () => { if (active && active.idle === idle) stopAll(); });
        });

        // Ergebnis je Satz: richtige Wörter grün, falsche rot mit Korrektur,
        // fehlende und überzählige gekennzeichnet.
        const renderResult = (el, r) => {
          const html = r.ops.map((op) => {
            if (op.type === 'ok') return `<span class="dict-ok">${escapeHtml(op.given)}</span>`;
            if (op.type === 'wrong') return `<span class="dict-wrong"><s>${escapeHtml(op.given)}</s> <b>${escapeHtml(op.expected)}</b></span>`;
            if (op.type === 'missing') return `<span class="dict-missing" title="fehlt">${escapeHtml(op.expected)}</span>`;
            return `<span class="dict-extra" title="zu viel"><s>${escapeHtml(op.given)}</s></span>`;
          }).join(' ');
          el.innerHTML = `${html} <span class="dict-count">${r.mistakes ? `– ${r.mistakes} Fehler` : '✓ fehlerfrei'}</span>`;
          el.classList.remove('hidden');
        };

        const checkBtn = div.querySelector('.dict-check');
        if (checkBtn) {
          const inputs = [...area.querySelectorAll('.dict-input')];
          checkBtn.addEventListener('click', () => {
            if (checkBtn.dataset.mode === 'retry') {
              // Noch einmal: Eingaben bleiben, Markierungen verschwinden.
              area.querySelectorAll('.dict-result').forEach((el) => el.classList.add('hidden'));
              inputs.forEach((inp) => { inp.disabled = false; });
              div.querySelector('.dict-feedback').innerHTML = '';
              checkBtn.textContent = 'Überprüfen';
              delete checkBtn.dataset.mode;
              return;
            }
            stopAll();
            const score = scoreDictation(sentences, inputs.map((inp) => inp.value), opts);
            score.results.forEach((r, idx) => renderResult(area.querySelectorAll('.dict-result')[idx], r));
            inputs.forEach((inp) => { inp.disabled = true; });
            const pct = Math.round(score.points * 100);
            div.querySelector('.dict-feedback').innerHTML =
              `<strong>${score.good} von ${score.total} Wörtern richtig (${pct} %)</strong>` +
              (score.mistakes ? ` · ${score.mistakes} Fehler` : ' – alles richtig! 🎉');
            if (content.tryAgain !== false && score.mistakes) {
              checkBtn.textContent = '↻ Noch einmal';
              checkBtn.dataset.mode = 'retry';
            } else checkBtn.disabled = true;
          });
        }
        break;
      }

      case 'dragAndDrop': {
        const hasImage = !!content.backgroundImage;
        const zones    = content.dropZones   || [];
        const drags    = content.draggables  || [];
        const colors   = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'];

        div.innerHTML = `
          <div class="dnd-player">
            ${content.taskDescription ? `<div class="dnd-player-desc" style="margin-bottom:16px;">${sanitizeModuleDescriptionHtml(content.taskDescription)}</div>` : ''}
            <div class="dnd-player-draggables" id="dndDraggables"></div>
            <div class="dnd-player-canvas-wrap">
              ${hasImage
                ? `<div class="dnd-player-canvas" id="dndCanvas"><img src="${content.backgroundImage}" class="dnd-player-img" draggable="false" /></div>`
                : `<div class="dnd-player-canvas dnd-player-no-img" id="dndCanvas"><div id="dndZonesLegacy"></div></div>`}
            </div>
            <div style="display:flex; align-items:center; gap:12px; margin-top:16px;">
              ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" id="dndCheck">Überprüfen</button>'}
              <button class="btn btn-secondary btn-sm" id="dndNext">Weiter →</button>
            </div>
            ${suppressFeedback ? '' : '<div id="dndFeedback" style="margin-top:12px;"></div>'}
          </div>`;

        const canvasEl = div.querySelector('#dndCanvas');
        const dragsEl  = div.querySelector('#dndDraggables');

        // Abgelegtes Element zurueck in die Ablage; Kopien mehrfach
        // verwendbarer Elemente (drag-<i>-<n>) verschwinden einfach.
        const returnToBank = (dragBtn) => {
          const isClone = dragBtn.dataset.dragId.split('-').length > 2;
          if (isClone) {
            dragBtn.remove();
          } else {
            dragBtn.dataset.currentZone = '';
            dragBtn.classList.remove('placed');
            // An den ursprünglichen Platz in der Ablage, nicht ans Ende –
            // sonst wechselt die Reihenfolge mit jedem Zurücklegen.
            const idx = (el) => Number(el.dataset.dragId.split('-')[1]);
            const before = [...dragsEl.querySelectorAll(':scope > .dnd-player-drag')].find((el) => idx(el) > idx(dragBtn));
            dragsEl.insertBefore(dragBtn, before || null);
          }
        };

        const placeInZone = (dragBtn, zoneEl) => {
          let elToPlace = dragBtn;
          if (dragBtn.dataset.multiple === 'true' && dragBtn.parentElement === dragsEl && typeof dragBtn.cloneSelf === 'function') elToPlace = dragBtn.cloneSelf();
          elToPlace.dataset.currentZone = zoneEl.dataset.zone;
          zoneEl.querySelector('.dnd-player-zone-items').appendChild(elToPlace);
          elToPlace.classList.add('placed');
        };

        const zoneAt = (target) => {
          const zoneEl = target && target.closest('.dnd-player-zone');
          return zoneEl && div.contains(zoneEl) ? zoneEl : null;
        };

        // Einrasten: die Zone unter dem Zeiger, sonst die naechste Zone, deren
        // Rand hoechstens SNAP px vom Zeiger oder von der Mitte des gezogenen
        // Elements entfernt ist. Zonen sind oft nur ca. 1 cm gross und der
        // Finger verdeckt sie - genau treffen muss man deshalb nicht.
        const DND_SNAP_PX = { touch: 48, pen: 36, mouse: 28 };
        const snapZone = (target, info) => {
          if (!target || target.closest('.dnd-player-draggables') === dragsEl) return null;
          const direct = zoneAt(target);
          if (direct || !info) return direct;
          const snap = DND_SNAP_PX[info.pointerType] ?? 36;
          const points = [[info.x, info.y]];
          if (info.rect) points.push([info.rect.left + info.rect.width / 2, info.rect.top + info.rect.height / 2]);
          let best = null, bestDist = Infinity;
          div.querySelectorAll('.dnd-player-zone').forEach((zoneEl) => {
            const r = zoneEl.getBoundingClientRect();
            points.forEach(([px, py]) => {
              const dist = Math.hypot(Math.max(r.left - px, 0, px - r.right), Math.max(r.top - py, 0, py - r.bottom));
              if (dist <= snap && dist < bestDist) { best = zoneEl; bestDist = dist; }
            });
          });
          return best;
        };

        const openRemoveMenu = (drag, x, y) => showContextMenu(x, y, [
          { label: '✕ Element entfernen', danger: true, onClick: () => returnToBank(drag) },
        ]);

        zones.forEach((z, i) => {
          const zoneEl = document.createElement('div');
          zoneEl.className = 'dnd-player-zone';
          const color = colors[i % colors.length];
          if (hasImage && z.x !== undefined) {
            zoneEl.style.left = z.x + '%'; zoneEl.style.top = z.y + '%';
            zoneEl.style.width = (z.width || 20) + '%'; zoneEl.style.height = (z.height || 15) + '%';
          } else {
            zoneEl.style.position = 'relative'; zoneEl.style.minHeight = '50px'; zoneEl.style.marginBottom = '8px';
          }
          zoneEl.style.borderColor = color;
          zoneEl.style.color = color;
          // Deckend, nicht transparent: Die Zonen liegen ueber dem Diagramm,
          // und dort steht die Loesung oft schon angeschrieben. Durchscheinen
          // wuerde die Aufgabe verraten.
          zoneEl.style.background = hexTint(color, 0.25);
          zoneEl.dataset.zone = z.label;
          zoneEl.innerHTML = `<span class="dnd-player-zone-label" style="background:${color}">${escapeHtml(z.label)}</span><div class="dnd-player-zone-items" data-zone="${escapeAttr(z.label)}"></div>`;
          // Die ganze belegte Zone ist Anfasser fuer ihr Element: Abgelegte
          // Elemente sind klein und ragen oft ueber die Zone hinaus, mit dem
          // Finger trifft man sonst leicht nur die Zone. Das Antippen wird als
          // pointerdown an das (zuletzt) abgelegte Element weitergereicht; die
          // weiteren Bewegungen verfolgt attachPointerDrag ueber window.
          const placedIn = () => { const items = zoneEl.querySelectorAll('.dnd-player-drag.placed'); return items[items.length - 1] || null; };
          zoneEl.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.dnd-player-drag')) return;
            const item = placedIn();
            if (!item) return;
            item.dispatchEvent(new PointerEvent('pointerdown', {
              pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
              button: e.button, buttons: e.buttons, clientX: e.clientX, clientY: e.clientY, bubbles: true,
            }));
          });
          zoneEl.addEventListener('contextmenu', (e) => {
            const item = placedIn();
            if (!item || e.target.closest('.dnd-player-drag')) return;
            e.preventDefault();
            openRemoveMenu(item, e.clientX, e.clientY);
          });
          if (hasImage) canvasEl.appendChild(zoneEl);
          else div.querySelector('#dndZonesLegacy').appendChild(zoneEl);
        });

        drags.forEach((d, i) => {
          let cloneCounter = 0;
          const createDraggableNode = (isClone = false) => {
            const drag = document.createElement('div');
            drag.className = 'dnd-player-drag'; drag.textContent = d.text;
            drag.dataset.dragId = isClone ? `drag-${i}-${++cloneCounter}` : `drag-${i}`;
            drag.dataset.correctZone = d.correctZone || ''; drag.dataset.currentZone = '';
            drag.dataset.multiple = d.multiple ? 'true' : 'false';
            // Pointer-Events statt HTML5-Drag&Drop: Auf dem iPad bewegt der
            // Finger das Element sofort, ohne vorher lange zu druecken.
            let hoverZone = null;
            attachPointerDrag(drag, {
              scrollContainer: document.getElementById('mainContent'),
              onHover: (target, info) => {
                const zoneEl = snapZone(target, info);
                if (zoneEl === hoverZone) return;
                if (hoverZone) hoverZone.classList.remove('dnd-zone-hover');
                if (zoneEl) zoneEl.classList.add('dnd-zone-hover');
                hoverZone = zoneEl;
              },
              onDrop: (target, info) => {
                const zoneEl = snapZone(target, info);
                if (zoneEl) placeInZone(drag, zoneEl);
                // Abgelegtes Element neben alle Zonen gezogen: zurueck in die
                // Ablage. So laesst es sich auch per Finger einfach entfernen.
                else if (drag.classList.contains('placed')) returnToBank(drag);
              },
              // iPadOS kennt kein Kontextmenue: langes Druecken ersetzt den Rechtsklick
              canLongPress: () => drag.classList.contains('placed'),
              onLongPress: (x, y) => openRemoveMenu(drag, x, y),
            });
            // Antippen tut bewusst nichts: Abgelegt wird durch Ziehen, entfernt
            // durch Herausziehen oder ueber das Kontextmenue (langes Druecken).
            // Ein Antippen mit Wirkung loeste beim Nachruecken auf dem iPad zu
            // leicht ungewollt etwas aus.
            // Falsch abgelegt? Rechtsklick -> entfernen
            drag.addEventListener('contextmenu', (e) => {
              if (!drag.classList.contains('placed')) return;
              e.preventDefault();
              openRemoveMenu(drag, e.clientX, e.clientY);
            });
            if (!isClone) drag.cloneSelf = () => createDraggableNode(true);
            return drag;
          };
          dragsEl.appendChild(createDraggableNode(false));
        });

        if (!suppressFeedback) {
          const dndCheckBtn = div.querySelector('#dndCheck');
          if (dndCheckBtn) {
            dndCheckBtn.addEventListener('click', () => {
              const zoneEls = (hasImage ? canvasEl : div.querySelector('#dndZonesLegacy')).querySelectorAll('.dnd-player-zone');
              // Zonen mit derselben (nicht-leeren) Gruppen-ID sind untereinander
              // vertauschbar (z. B. die zwei gleichwertigen Eingänge eines
              // Oder-Gatters) – dieselbe Regel wie bei der Endauswertung.
              const zoneLabelSet = new Set(zones.map((z) => z.label));
              const zoneGroup = new Map(zones.map((z) => [z.label, z.group || '']));
              const expected = [];
              zones.forEach((z) => { if (z.correctDraggable) expected.push({ zone: z.label, text: z.correctDraggable }); });
              drags.forEach((d) => { if (d.correctZone && zoneLabelSet.has(d.correctZone) && !expected.find((m) => m.zone === d.correctZone)) expected.push({ zone: d.correctZone, text: d.text }); });
              const used = new Set();
              const itemOk = new Map();
              zoneEls.forEach((z) => {
                const zoneLabel = z.dataset.zone;
                const group = zoneGroup.get(zoneLabel) || '';
                z.querySelectorAll('.dnd-player-drag.placed').forEach((item) => {
                  const matchIdx = expected.findIndex((m, i) => !used.has(i) && m.text === item.textContent && (m.zone === zoneLabel || (group && group === (zoneGroup.get(m.zone) || ''))));
                  itemOk.set(item, matchIdx !== -1);
                  if (matchIdx !== -1) used.add(matchIdx);
                });
              });
              let correct = 0;
              zoneEls.forEach((z, idx) => {
                const zoneLabel = z.dataset.zone;
                const group = zoneGroup.get(zoneLabel) || '';
                const items = z.querySelectorAll('.dnd-player-drag.placed');
                const defaultColor = colors[idx % colors.length];
                let hasCorrect = false; let anyWrong = false;
                if (items.length === 0) {
                  // Eine leere Zone einer Gruppe kann in Ordnung sein, wenn das
                  // Gruppen-Soll bereits über eine andere Zone erfüllt wurde.
                  if (expected.some((m) => m.zone === zoneLabel) && !group) anyWrong = true;
                } else {
                  items.forEach((item) => { if (itemOk.get(item)) hasCorrect = true; else anyWrong = true; });
                }
                if (hasCorrect && !anyWrong) { z.style.borderColor = 'green'; correct++; }
                else if (anyWrong) { z.style.borderColor = 'red'; }
                else { z.style.borderColor = defaultColor; }
              });
              const dndFeedback = div.querySelector('#dndFeedback');
              if (dndFeedback) dndFeedback.innerHTML = `<span style="font-weight:600;">${correct} von ${zones.length} richtig</span>`;
            });
          }
          const dndNextBtn = div.querySelector('#dndNext');
          if (dndNextBtn) dndNextBtn.addEventListener('click', () => { const nb = document.getElementById('btnQuizNext'); if (nb) nb.click(); });
        }
        break;
      }

      case 'iframeEmbedder': {
        // Der Platzhalter hier stammte aus der Desktop-App. Im Browser gibt
        // es diese Einschränkung nicht – eingebettet wird jetzt wirklich.
        const url = safeHttpUrl(content.url);
        if (!content.url) { div.textContent = 'Keine URL definiert.'; break; }
        if (!url) {
          div.innerHTML = `<p style="color:var(--danger, #b91c1c);">Nur Adressen mit http:// oder https:// können eingebettet werden.</p>`;
          break;
        }
        const width = Number(content.width) > 0 ? Number(content.width) : 800;
        const height = Number(content.height) > 0 ? Number(content.height) : 600;
        div.innerHTML = `
          <div style="border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden; background:#fff;">
            ${embeddedFrame(url, height, 'Eingebettete Seite', `max-width:${width}px;`)}
          </div>
          <p style="margin-top:8px; font-size:0.85rem;">
            <a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">In neuem Tab öffnen ↗</a>
          </p>`;
        break;
      }

      case 'worksheet': {
        const html = sanitizeWorksheetHtml(content.html || '');
        div.innerHTML = html.trim()
          ? `<div class="worksheet-content module-description-content">${html}</div>`
          : '<p style="color:var(--text-secondary);">Noch kein Inhalt.</p>';
        break;
      }

      case 'imageHotspots': {
        const hotspots = (content.hotspots || []).filter((h) => h && (h.title || h.content));
        const src = content.imageFile || normalizeShareUrl(content.imageUrl);
        div.innerHTML = `
          <div class="hs-player">
            ${src ? `
            <div class="hs-stage">
              <img class="hs-img" src="${escapeAttr(src)}" alt="${escapeAttr(content.imageAlt || '')}" draggable="false" />
              ${hotspots.map((h, i) => `
                <button type="button" class="hs-marker" data-i="${i}" style="left:${Number(h.posX ?? 50)}%; top:${Number(h.posY ?? 50)}%"
                  aria-label="${escapeAttr(h.title || `Punkt ${i + 1}`)}">${i + 1}</button>`).join('')}
              <div class="hs-popup hidden" role="dialog"></div>
            </div>
            <p class="hs-hint hint">Tippe auf die Punkte, um mehr zu erfahren. <span class="hs-progress"></span></p>`
            : '<p class="hint">Für dieses Modul ist kein Bild hinterlegt.</p>'}
          </div>`;
        if (!src) break;

        const stage = div.querySelector('.hs-stage');
        const popup = div.querySelector('.hs-popup');
        const progress = div.querySelector('.hs-progress');
        const seen = new Set();
        const showProgress = () => {
          if (hotspots.length) progress.textContent = `(${seen.size} von ${hotspots.length} angesehen)`;
        };
        showProgress();
        div.querySelector('.hs-img').addEventListener('error', () => {
          stage.innerHTML = '<p class="dict-error">⚠️ Das Bild lässt sich nicht laden – bitte der Lehrkraft Bescheid geben.</p>';
        });

        const close = () => {
          popup.classList.add('hidden');
          stage.querySelectorAll('.hs-marker.active').forEach((m) => m.classList.remove('active'));
        };
        // Die Blase öffnet zur Bildmitte hin, damit sie nicht über den Rand ragt.
        const open = (i) => {
          const h = hotspots[i];
          const x = Number(h.posX ?? 50);
          const y = Number(h.posY ?? 50);
          popup.innerHTML = `
            <button type="button" class="hs-close" aria-label="Schließen">✕</button>
            ${h.title ? `<strong>${escapeHtml(h.title)}</strong>` : ''}
            ${h.content ? `<p>${escapeHtml(h.content).replace(/\n/g, '<br>')}</p>` : ''}`;
          popup.style.left = `${x}%`;
          popup.style.top = `${y}%`;
          popup.dataset.h = x > 55 ? 'left' : 'right';
          popup.dataset.v = y > 60 ? 'up' : 'down';
          popup.classList.remove('hidden');
          popup.querySelector('.hs-close').addEventListener('click', close);
          stage.querySelectorAll('.hs-marker').forEach((m) => m.classList.toggle('active', Number(m.dataset.i) === i));
          const marker = stage.querySelector(`.hs-marker[data-i="${i}"]`);
          marker.classList.add('seen');
          seen.add(i);
          showProgress();
        };
        stage.querySelectorAll('.hs-marker').forEach((m) => m.addEventListener('click', (e) => {
          e.stopPropagation();
          const i = Number(m.dataset.i);
          if (m.classList.contains('active')) close(); else open(i);
        }));
        stage.addEventListener('click', (e) => { if (!popup.contains(e.target)) close(); });
        break;
      }

      case 'collage': {
        // Bestehende Collagen (neue entstehen mit "🧩 Bild zusammenstellen").
        const images = (content.images || []).filter((img) => img && img.imageUrl);
        const cols = { '1-1': '1fr 1fr', '1-2': '1fr 2fr', '2-1': '2fr 1fr', '1-1-1': '1fr 1fr 1fr', '2x2': '1fr 1fr' }[content.layout] || '1fr 1fr';
        div.innerHTML = images.length
          ? `<div class="collage-grid" style="grid-template-columns:${cols}">${images.map((img) => `
              <figure class="collage-item"><img src="${escapeAttr(normalizeShareUrl(img.imageUrl))}" alt="${escapeAttr(img.alt || '')}" loading="lazy" />
                ${img.alt ? `<figcaption>${escapeHtml(img.alt)}</figcaption>` : ''}</figure>`).join('')}</div>`
          : '<p class="hint">Keine Bilder hinterlegt.</p>';
        break;
      }

      case 'audioRecorder': {
        const maxSec = Math.min(600, Math.max(5, Number(content.maxDuration) || 60));
        const up = options.upload || {};
        const canUpload = !!content.uploadConfigured || !!content.uploadUrl;
        const inRun = !!(up.linkToken || up.quickToken);
        // Vorschau der Lehrkraft: Probe-Abgabe in die eigene Ablage (Adresse aus dem Modul).
        const authToken = sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token');
        const canPreviewUpload = !inRun && !!content.uploadUrl && !!authToken;
        div.innerHTML = `
          <div class="rec-player">
            ${content.instruction ? `<p class="rec-instruction">${escapeHtml(content.instruction).replace(/\n/g, '<br>')}</p>` : ''}
            <div class="rec-controls">
              <button type="button" class="btn btn-primary rec-start">🎙 Aufnahme starten</button>
              <button type="button" class="btn btn-danger rec-stop hidden">⏹ Stopp</button>
              <span class="rec-time">0:00 / ${Math.floor(maxSec / 60)}:${String(maxSec % 60).padStart(2, '0')}</span>
            </div>
            <div class="rec-review hidden">
              <audio class="rec-audio" controls></audio>
              <div class="rec-actions">
                <button type="button" class="btn btn-secondary btn-sm rec-redo">↻ Neu aufnehmen</button>
                ${canUpload ? '<button type="button" class="btn btn-primary btn-sm rec-submit">⬆ Abgeben</button>' : ''}
              </div>
            </div>
            <p class="rec-status hint">${canUpload
              ? (inRun ? 'Nimm deine Antwort auf, hör sie dir an und gib sie dann ab.'
                : canPreviewUpload ? 'Vorschau: Eine Abgabe landet als „Vorschau_…“ in deiner Ablage.'
                : 'Vorschau: Aufnehmen und Anhören klappen; hochgeladen wird nur im Schüler-Durchlauf über einen Link.')
              : 'Für diese Aufgabe ist keine Ablage eingerichtet – die Aufnahme bleibt auf diesem Gerät.'}</p>
          </div>`;
        const root = div.querySelector('.rec-player');
        const q = (sel) => root.querySelector(sel);
        const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        let recorder = null;
        let chunks = [];
        let blob = null;
        let timer = null;
        let started = 0;
        const status = (msg, err) => { q('.rec-status').textContent = msg; q('.rec-status').classList.toggle('dict-error', !!err); };

        const stop = () => { if (recorder && recorder.state !== 'inactive') recorder.stop(); };
        q('.rec-start').addEventListener('click', async () => {
          if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            status('Dieser Browser kann nicht aufnehmen.', true);
            return;
          }
          let stream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (_) {
            status('Kein Zugriff aufs Mikrofon – bitte im Browser erlauben (Schloss-Symbol in der Adresszeile).', true);
            return;
          }
          // Opus/WebM (Chrome, Firefox) oder MP4/AAC (Safari, iPad)
          const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
          recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
          chunks = [];
          recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
          recorder.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            clearInterval(timer);
            blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
            q('.rec-audio').src = URL.createObjectURL(blob);
            q('.rec-review').classList.remove('hidden');
            q('.rec-stop').classList.add('hidden');
            q('.rec-start').classList.add('hidden');
            status(canUpload && (inRun || canPreviewUpload) ? 'Hör dir die Aufnahme an. Passt sie, klick auf „Abgeben“.' : 'Aufnahme fertig.');
          };
          recorder.start(1000);
          started = Date.now();
          q('.rec-start').classList.add('hidden');
          q('.rec-stop').classList.remove('hidden');
          root.classList.add('recording');
          status('🔴 Aufnahme läuft …');
          timer = setInterval(() => {
            const sec = (Date.now() - started) / 1000;
            q('.rec-time').textContent = `${fmt(sec)} / ${fmt(maxSec)}`;
            if (sec >= maxSec) stop();
          }, 250);
        });
        q('.rec-stop').addEventListener('click', () => { root.classList.remove('recording'); stop(); });
        q('.rec-redo').addEventListener('click', () => {
          blob = null;
          q('.rec-review').classList.add('hidden');
          q('.rec-start').classList.remove('hidden');
          q('.rec-time').textContent = `0:00 / ${fmt(maxSec)}`;
          status('Neue Aufnahme – die vorige wird verworfen.');
        });
        q('.rec-submit')?.addEventListener('click', async () => {
          if (!blob) return;
          if (!inRun && !canPreviewUpload) { status('Vorschau: Hochgeladen wird nur im Schüler-Durchlauf über einen Link.', true); return; }
          const btn = q('.rec-submit');
          btn.disabled = true;
          status('Wird hochgeladen …');
          const form = new FormData();
          form.append('file', blob, 'aufnahme');
          let url = '/api/public/recording';
          const headers = {};
          if (inRun) {
            form.append('moduleId', options.moduleId || '');
            form.append('studentName', up.studentName || '');
            if (up.linkToken) form.append('linkToken', up.linkToken);
            if (up.quickToken) form.append('quickToken', up.quickToken);
          } else {
            url = '/api/topics/recording-preview';
            headers.Authorization = `Bearer ${authToken}`;
            form.append('uploadUrl', content.uploadUrl);
            form.append('uploadPassword', content.uploadPassword || '');
            form.append('title', options.title || content.title || 'Aufnahme');
          }
          try {
            const res = await fetch(url, { method: 'POST', body: form, headers });
            // Ein vorgeschalteter Proxy antwortet bei Fehlern oft mit HTML statt JSON.
            const data = await res.json().catch(() => ({}));
            if (res.status === 413) throw new Error('Die Aufnahme ist zu groß für den Server (Upload-Grenze des Proxys, z. B. client_max_body_size).');
            if (!res.ok || !data.success) throw new Error(data.message || `Fehler ${res.status}`);
            root.dataset.submitted = data.fileName;
            status(inRun ? '✅ Abgegeben. Du kannst neu aufnehmen und erneut abgeben – die Lehrkraft bekommt dann beide.'
              : `✅ Probe-Abgabe angekommen: „${data.fileName}“.`);
          } catch (err) {
            status(`⚠️ Abgeben hat nicht geklappt: ${err.message}`, true);
          } finally {
            btn.disabled = false;
          }
        });
        break;
      }

      case 'branchingScenario': {
        const data = normalizeBranching(content);
        const byId = new Map(data.steps.map((st) => [st.id, st]));
        div.innerHTML = '<div class="bs-player"></div>';
        const root = div.querySelector('.bs-player');
        // Weg des Schülers: [{ id, label }] – für Zurück und für die Auswertung.
        let path = [];
        const finish = (st) => {
          root.dataset.done = '1';
          root.dataset.score = String(st.score);
          root.dataset.path = JSON.stringify(path.map((p) => p.label).filter(Boolean));
        };
        const showStart = () => {
          path = [];
          delete root.dataset.done;
          root.innerHTML = `
            <div class="bs-start">
              <h3>${escapeHtml(data.startScreen.title || 'Entscheidungsszenario')}</h3>
              ${data.startScreen.subtitle ? `<p>${escapeHtml(data.startScreen.subtitle)}</p>` : ''}
              <button type="button" class="btn btn-primary bs-go">▶ Starten</button>
            </div>`;
          root.querySelector('.bs-go').addEventListener('click', () => show(data.steps[0]?.id, null));
        };
        const show = (id, label) => {
          const st = byId.get(id);
          if (!st) { root.innerHTML = '<p class="hint">Dieser Weg ist noch nicht fertig – bitte der Lehrkraft Bescheid geben.</p>'; return; }
          path.push({ id, label });
          const body = st.content ? `<div class="bs-content worksheet-content">${sanitizeWorksheetHtml(st.content)}</div>` : '';
          if (st.kind === 'end') {
            finish(st);
            const tone = st.score >= 80 ? 'good' : st.score >= 40 ? 'mid' : 'bad';
            root.innerHTML = `
              <div class="bs-step bs-end bs-${tone}">
                ${st.title ? `<h3>${escapeHtml(st.title)}</h3>` : ''}
                ${body}
                ${st.feedback ? `<p class="bs-feedback">${escapeHtml(st.feedback)}</p>` : ''}
                ${suppressFeedback ? '' : `<div class="bs-score"><div class="bs-score-bar" style="width:${st.score}%"></div><span>${st.score} %</span></div>`}
                <p class="bs-path hint">Dein Weg: ${path.filter((p) => p.label).map((p) => escapeHtml(p.label)).join(' → ') || '—'}</p>
                ${suppressFeedback ? '' : '<button type="button" class="btn btn-secondary btn-sm bs-restart">↻ Von vorn</button>'}
              </div>`;
            root.querySelector('.bs-restart')?.addEventListener('click', showStart);
            return;
          }
          root.innerHTML = `
            <div class="bs-step">
              ${st.title ? `<h3>${escapeHtml(st.title)}</h3>` : ''}
              ${body}
              <div class="bs-choices">${st.choices.map((ch, i) =>
                `<button type="button" class="btn btn-secondary bs-choice" data-i="${i}">${escapeHtml(ch.label)}</button>`).join('')}</div>
              ${data.allowBack && path.length > 1 ? '<button type="button" class="btn btn-sm bs-back">↩ Zurück</button>' : ''}
            </div>`;
          root.querySelectorAll('.bs-choice').forEach((b) => b.addEventListener('click', () => {
            const ch = st.choices[Number(b.dataset.i)];
            show(ch.next, ch.label);
          }));
          root.querySelector('.bs-back')?.addEventListener('click', () => {
            path.pop();
            const prev = path.pop();
            show(prev.id, prev.label);
          });
        };
        if (data.steps.length) showStart();
        else root.innerHTML = '<p class="hint">Noch keine Schritte angelegt.</p>';
        break;
      }

      case 'video': {
        const v = videoSourceOf(content.videoUrl);
        const start = Math.max(0, Math.floor(Number(content.startAt) || 0));
        const title = content.title ? `<h3 class="video-title">${escapeHtml(content.title)}</h3>` : '';
        let player = '';
        if (!v) {
          player = '<p class="hint">Für dieses Modul ist kein Video-Link hinterlegt.</p>';
        } else if (v.kind === 'youtube' || v.kind === 'vimeo') {
          const params = new URLSearchParams();
          let src;
          if (v.kind === 'youtube') {
            if (start) params.set('start', String(start));
            if (content.autoplay) { params.set('autoplay', '1'); params.set('mute', '1'); }
            if (content.loop) { params.set('loop', '1'); params.set('playlist', v.id); }
            params.set('rel', '0');
            src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?${params}`;
          } else {
            if (content.autoplay) { params.set('autoplay', '1'); params.set('muted', '1'); }
            if (content.loop) params.set('loop', '1');
            params.set('dnt', '1');
            src = `https://player.vimeo.com/video/${encodeURIComponent(v.id)}?${params}${start ? `#t=${start}s` : ''}`;
          }
          player = `<div class="video-frame"><iframe src="${escapeAttr(src)}" title="${escapeAttr(content.title || 'Video')}"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
        } else if (v.kind === 'file') {
          // Automatisch abspielen erlauben Browser nur stumm.
          player = `<video class="video-player" controls playsinline preload="metadata" src="${escapeAttr(v.src)}"
            ${content.autoplay ? 'autoplay muted' : ''} ${content.loop ? 'loop' : ''}></video>
            <p class="video-error dict-error hidden">⚠️ Das Video lässt sich nicht abspielen.
              Bei Nextcloud: Freigabe ohne Passwort und ohne „Download verbergen“.
              <a href="${escapeAttr(v.src)}" target="_blank" rel="noopener noreferrer">Video direkt öffnen</a></p>`;
        } else {
          player = `<p class="hint">Dieser Link lässt sich nicht direkt einbetten.</p>
            <p><a class="btn btn-secondary btn-sm" href="${escapeAttr(v.src)}" target="_blank" rel="noopener noreferrer">🎬 Video in neuem Tab öffnen</a></p>`;
        }
        div.innerHTML = `<div class="video-module">${title}${player}</div>`;
        const video = div.querySelector('video.video-player');
        if (video) {
          if (start) video.addEventListener('loadedmetadata', () => { try { video.currentTime = start; } catch (_) {} }, { once: true });
          video.addEventListener('error', () => div.querySelector('.video-error')?.classList.remove('hidden'));
        }
        break;
      }

      case 'h5p_native': {
        const H5P_LIB_NAMES = {
          'H5P.MultiChoice':{ name: 'Multiple Choice', icon: '🔘' },'H5P.Blanks':{ name: 'Fill in the Blanks', icon: '✏️' },
          'H5P.DragQuestion':{ name: 'Drag and Drop', icon: '🎯' },'H5P.TrueFalse':{ name: 'Wahr / Falsch', icon: '✅' },
          'H5P.Essay':{ name: 'Essay', icon: '📝' },'H5P.MarkTheWords':{ name: 'Wörter markieren', icon: '🔤' },
          'H5P.DragText':{ name: 'Text sortieren', icon: '📘' },'H5P.Summary':{ name: 'Zusammenfassung', icon: '📋' },
          'H5P.QuestionSet':{ name: 'Fragen-Set', icon: '📚' },'H5P.CoursePresentation':{ name: 'Präsentation', icon: '📊' },
          'H5P.InteractiveVideo':{ name: 'Interaktives Video', icon: '🎬' },'H5P.Flashcards':{ name: 'Lernkarten', icon: '🃏' },
          'H5P.Accordion':{ name: 'Accordion', icon: '📂' },'H5P.ImageHotspots':{ name: 'Bild-Hotspots', icon: '🗺️' },
          'H5P.AdvancedText':{ name: 'Text', icon: '📄' },'H5P.Image':{ name: 'Bild', icon: '🖼️' },
        };
        const machineName = content.machineName || (content.library || '').split(' ')[0];
        const libInfo = H5P_LIB_NAMES[machineName] || { name: machineName.replace('H5P.', '') || 'H5P-Inhalt', icon: '🌐' };
        const params = content.params || {};
        let questionHtml = ''; let extraInfo = '';
        if (machineName === 'H5P.MultiChoice') { questionHtml = params.question || ''; const answers = params.answers || []; extraInfo = `${answers.length} Antwortmöglichkeit(en), ${answers.filter((a) => a.correct).length} korrekt`; }
        else if (machineName === 'H5P.Blanks') { questionHtml = params.text || (Array.isArray(params.questions) ? params.questions[0] || '' : ''); extraInfo = `${(questionHtml.match(/\*[^*]+\*/g) || []).length} Lücke(n)`; }
        else if (machineName === 'H5P.TrueFalse') { questionHtml = params.question || ''; extraInfo = `Richtige Antwort: ${params.correct === 'true' ? 'Wahr' : 'Falsch'}`; }
        else if (machineName === 'H5P.Essay') { questionHtml = params.question || params.taskDescription || ''; }
        else if (machineName === 'H5P.DragQuestion') { questionHtml = (params.question && params.question.settings && params.question.settings.questionTitle) || params.taskDescription || ''; const elements = (params.question && params.question.task && params.question.task.elements) || []; const dzones = (params.question && params.question.task && params.question.task.dropZones) || []; extraInfo = `${elements.length} Element(e), ${dzones.length} Zielzone(n)`; }
        else if (machineName === 'H5P.MarkTheWords') { questionHtml = params.taskDescription || ''; }
        else if (machineName === 'H5P.DragText') { questionHtml = params.taskDescription || ''; }
        div.innerHTML = `
          <div class="h5p-native-preview">
            <div class="h5p-native-header">
              <span class="h5p-native-icon">${libInfo.icon}</span>
              <div class="h5p-native-meta">
                <span class="h5p-native-type-label">${escapeHtml(libInfo.name)}</span>
                <span class="h5p-native-lib-label">${escapeHtml(content.library || '')}</span>
              </div>
            </div>
            ${questionHtml ? `<div class="h5p-native-question">${questionHtml}</div>` : ''}
            ${extraInfo ? `<p class="h5p-native-extra">${escapeHtml(extraInfo)}</p>` : ''}
            <p class="h5p-native-note">⚠️ Nativer H5P-Inhalt — Vorschau zeigt Rohdaten. Für vollständige Wiedergabe H5P exportieren und in einem H5P-fähigen System öffnen.</p>
          </div>`;
        break;
      }

      default: {
        div.innerHTML = `
          <div style="padding:30px; text-align:center; color:var(--text-secondary);">
            <p>Vorschau für diesen Modultyp wird noch entwickelt.</p>
            <pre style="text-align:left; margin-top:16px; padding:12px; background:var(--bg-primary); border-radius:var(--radius-sm); font-size:0.8rem; overflow:auto;">${escapeHtml(JSON.stringify(content, null, 2))}</pre>
          </div>`;
      }
    }

    return div;
  }

  // ------ Arithmetic Quiz ------

  startArithmeticQuiz(container, content, suppressFeedback) {
    if (!container) return;
    const type = content.arithmeticType || 'addition';
    const max  = content.maxNumber   || 10;
    const num  = content.numQuestions || 10;

    const questions = [];
    for (let i = 0; i < num; i++) {
      const a = Math.floor(Math.random() * max) + 1;
      const b = Math.floor(Math.random() * max) + 1;
      let op, answer;
      switch (type) {
        case 'subtraction':   op = '−'; answer = a - b; break;
        case 'multiplication': op = '×'; answer = a * b; break;
        case 'division':      op = '÷'; answer = Math.round((a * b) / b * 100) / 100; break;
        default:              op = '+'; answer = a + b;
      }
      const displayA = type === 'division' ? a * b : a;
      questions.push({ display: `${displayA} ${op} ${b} = ?`, answer: type === 'division' ? a : answer });
    }

    let qIdx = 0;
    let score = 0;

    if (questions.length > 1) { const nb = document.getElementById('btnQuizNext'); if (nb) nb.disabled = true; }

    const render = () => {
      if (qIdx >= questions.length - 1) { const nb = document.getElementById('btnQuizNext'); if (nb) nb.disabled = false; }
      if (qIdx >= questions.length) {
        container.innerHTML = suppressFeedback
          ? '<h3>Alle Fragen beantwortet.</h3>'
          : `<h3>Ergebnis: ${score} / ${questions.length}</h3>`;
        return;
      }
      container.innerHTML = `
        <p style="font-size:1.3rem; font-weight:600; margin-bottom:12px;">${questions[qIdx].display}</p>
        <input type="number" id="quizAnswer" style="padding:8px 12px; border:1px solid var(--border); border-radius:4px; width:120px; text-align:center; font-size:1.1rem;" autofocus>
        <button class="btn btn-primary btn-sm" style="margin-left:8px;" id="quizSubmit">→</button>
        <p style="margin-top:8px; font-size:0.85rem; color:var(--text-secondary);">Frage ${qIdx + 1} von ${questions.length}${suppressFeedback ? '' : ` — Punkte: ${score}`}</p>
      `;
      container.querySelector('#quizSubmit').addEventListener('click', () => {
        const val = parseFloat(container.querySelector('#quizAnswer').value);
        if (val === questions[qIdx].answer) score++;
        qIdx++;
        render();
      });
      container.querySelector('#quizAnswer').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') container.querySelector('#quizSubmit').click();
      });
    };

    render();
  }
}
