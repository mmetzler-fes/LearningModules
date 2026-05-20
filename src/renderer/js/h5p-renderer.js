import { sanitizeModuleDescriptionHtml, escapeHtml, escapeAttr, hexToRgba } from './utils.js';

// ==================== H5P RENDERER ====================

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
    wrapper.style.maxWidth = '800px';
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

    const previewEl = this.createTypePreview(mod.type, content, options);
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
          body.textContent = panel.content || '';
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
            tfTrue.disabled = true; tfFalse.disabled = true;
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
          if (tfResults[tfIdx] !== null) return;
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
        let autoScrollInterval = null;
        const startAutoScroll = (e) => {
          const main = document.getElementById('mainContent');
          if (!main) return;
          const rect = main.getBoundingClientRect();
          const topDist = e.clientY - rect.top;
          const bottomDist = rect.bottom - e.clientY;
          const threshold = 60;
          let speed = 0;
          if (topDist < threshold && topDist > -threshold) speed = -15;
          else if (bottomDist < threshold && bottomDist > -threshold) speed = 15;
          if (speed !== 0 && !autoScrollInterval) {
            autoScrollInterval = setInterval(() => { main.scrollTop += speed; }, 20);
          } else if (speed === 0 && autoScrollInterval) {
            clearInterval(autoScrollInterval); autoScrollInterval = null;
          }
        };
        const stopAutoScroll = () => {
          if (autoScrollInterval) { clearInterval(autoScrollInterval); autoScrollInterval = null; }
          document.removeEventListener('dragover', startAutoScroll);
        };

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
                dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dtw-drop-hover'); });
                dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dtw-drop-hover'); });
                dropZone.addEventListener('drop', (e) => {
                  e.preventDefault();
                  dropZone.classList.remove('dtw-drop-hover');
                  const word = e.dataTransfer.getData('text/plain');
                  const srcId = e.dataTransfer.getData('application/dtw-src');
                  if (dropZone.dataset.currentWord) returnWordToBank(dropZone.dataset.currentWord, wordBank);
                  dropZone.textContent = word;
                  dropZone.dataset.currentWord = word;
                  dropZone.classList.add('dtw-drop-filled');
                  const srcEl = wordBank.querySelector(`[data-dtw-id="${srcId}"]`);
                  if (srcEl) srcEl.classList.add('dtw-chip-used');
                  const fromZone = e.dataTransfer.getData('application/dtw-from-zone');
                  if (fromZone) {
                    const prevZone = textArea.querySelector(`.dtw-drop-zone[data-drop-idx="${fromZone}"]`);
                    if (prevZone && prevZone !== dropZone) { prevZone.textContent = ''; prevZone.dataset.currentWord = ''; prevZone.classList.remove('dtw-drop-filled'); }
                  }
                });
                dropZone.setAttribute('draggable', 'false');
                dropZone.addEventListener('mousedown', () => { if (dropZone.dataset.currentWord) dropZone.setAttribute('draggable', 'true'); });
                dropZone.addEventListener('dragstart', (e) => {
                  if (!dropZone.dataset.currentWord) { e.preventDefault(); return; }
                  e.dataTransfer.setData('text/plain', dropZone.dataset.currentWord);
                  e.dataTransfer.setData('application/dtw-src', '');
                  e.dataTransfer.setData('application/dtw-from-zone', dropZone.dataset.dropIdx);
                  e.dataTransfer.effectAllowed = 'move';
                  document.addEventListener('dragover', startAutoScroll);
                });
                dropZone.addEventListener('dragend', () => { dropZone.setAttribute('draggable', 'false'); stopAutoScroll(); });
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

        const shuffled = [...draggableWords].sort(() => Math.random() - 0.5);
        shuffled.forEach((word, i) => {
          const chip = document.createElement('span');
          chip.className = 'dtw-chip'; chip.textContent = word;
          chip.setAttribute('draggable', 'true'); chip.dataset.dtwId = `chip_${i}`;
          chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', word); e.dataTransfer.setData('application/dtw-src', chip.dataset.dtwId); e.dataTransfer.effectAllowed = 'move'; document.addEventListener('dragover', startAutoScroll); });
          chip.addEventListener('dragend', stopAutoScroll);
          wordBank.appendChild(chip);
        });

        function returnWordToBank(word, bank) {
          const chips = bank.querySelectorAll('.dtw-chip');
          for (const c of chips) {
            if (c.textContent === word && c.classList.contains('dtw-chip-used')) { c.classList.remove('dtw-chip-used'); break; }
          }
        }

        wordBank.addEventListener('dragover', (e) => e.preventDefault());
        wordBank.addEventListener('drop', (e) => {
          e.preventDefault();
          const fromZone = e.dataTransfer.getData('application/dtw-from-zone');
          const word = e.dataTransfer.getData('text/plain');
          if (fromZone) {
            const prevZone = textArea.querySelector(`.dtw-drop-zone[data-drop-idx="${fromZone}"]`);
            if (prevZone) { prevZone.textContent = ''; prevZone.dataset.currentWord = ''; prevZone.classList.remove('dtw-drop-filled'); }
            returnWordToBank(word, wordBank);
          }
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
        const sentences = content.sentences || [];
        div.innerHTML = `
          <div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
            <p style="margin-bottom:16px; font-weight:600;">Diktat — Schreiben Sie die gehörten Sätze:</p>
            <div id="dictArea"></div>
            ${suppressFeedback ? '' : '<button class="btn btn-primary btn-sm" style="margin-top:16px;" id="dictCheck">Überprüfen</button><div id="dictFeedback" style="margin-top:12px;"></div>'}
          </div>`;
        const dictArea = div.querySelector('#dictArea');
        sentences.forEach((s, i) => {
          const row = document.createElement('div');
          row.style.marginBottom = '12px';
          row.innerHTML = `<label style="font-size:0.85rem; color:var(--text-secondary);">Satz ${i + 1}:</label><input type="text" class="dict-input" data-answer="${escapeAttr(s.text || '')}" style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:4px; margin-top:4px;">`;
          dictArea.appendChild(row);
        });
        const dictCheckBtn = div.querySelector('#dictCheck');
        if (dictCheckBtn) {
          dictCheckBtn.addEventListener('click', () => {
            const inputs = dictArea.querySelectorAll('.dict-input');
            let correct = 0;
            inputs.forEach((inp) => {
              const match = inp.value.trim().toLowerCase() === inp.dataset.answer.toLowerCase();
              inp.style.borderColor = match ? 'green' : 'red';
              if (match) correct++;
            });
            div.querySelector('#dictFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${inputs.length} richtig</span>`;
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

        div.addEventListener('dragover', (e) => e.preventDefault());
        div.addEventListener('drop', (e) => e.preventDefault());

        dragsEl.addEventListener('dragover', (e) => e.preventDefault());
        dragsEl.addEventListener('drop', (e) => {
          e.preventDefault();
          const dragId = e.dataTransfer.getData('text/plain');
          const dragBtn = div.querySelector(`[data-drag-id="${dragId}"]`);
          if (dragBtn) {
            const isClone = dragBtn.dataset.dragId.split('-').length > 2;
            if (isClone) {
              dragBtn.remove();
            } else {
              dragBtn.dataset.currentZone = '';
              dragBtn.classList.remove('placed');
              dragsEl.appendChild(dragBtn);
            }
          }
        });

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
          zoneEl.style.background = hexToRgba(color, 0.25);
          zoneEl.dataset.zone = z.label;
          zoneEl.innerHTML = `<span class="dnd-player-zone-label" style="background:${color}">${escapeHtml(z.label)}</span><div class="dnd-player-zone-items" data-zone="${escapeAttr(z.label)}"></div>`;
          zoneEl.addEventListener('dragover', (e) => { e.preventDefault(); zoneEl.classList.add('dnd-zone-hover'); });
          zoneEl.addEventListener('dragleave', () => { zoneEl.classList.remove('dnd-zone-hover'); });
          zoneEl.addEventListener('drop', (e) => {
            e.preventDefault(); zoneEl.classList.remove('dnd-zone-hover');
            const dragId = e.dataTransfer.getData('text/plain');
            const dragBtn = div.querySelector(`[data-drag-id="${dragId}"]`);
            if (dragBtn) {
              let elToPlace = dragBtn;
              if (dragBtn.dataset.multiple === 'true' && dragBtn.parentElement === dragsEl && typeof dragBtn.cloneSelf === 'function') elToPlace = dragBtn.cloneSelf();
              elToPlace.dataset.currentZone = z.label;
              zoneEl.querySelector('.dnd-player-zone-items').appendChild(elToPlace);
              elToPlace.classList.add('placed');
            }
          });
          if (hasImage) canvasEl.appendChild(zoneEl);
          else div.querySelector('#dndZonesLegacy').appendChild(zoneEl);
        });

        drags.forEach((d, i) => {
          let cloneCounter = 0;
          const createDraggableNode = (isClone = false) => {
            const drag = document.createElement('div');
            drag.className = 'dnd-player-drag'; drag.textContent = d.text; drag.draggable = true;
            drag.dataset.dragId = isClone ? `drag-${i}-${++cloneCounter}` : `drag-${i}`;
            drag.dataset.correctZone = d.correctZone || ''; drag.dataset.currentZone = '';
            drag.dataset.multiple = d.multiple ? 'true' : 'false';
            drag.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', drag.dataset.dragId); drag.classList.add('dragging'); drag.dataset.preventClick = 'true'; });
            drag.addEventListener('dragend', () => { drag.classList.remove('dragging'); setTimeout(() => drag.dataset.preventClick = 'false', 100); });
            drag.addEventListener('click', (e) => {
              if (drag.dataset.preventClick === 'true') return;
              const currentZone = drag.dataset.currentZone || '';
              const zoneNames = zones.map((z) => z.label);
              if (d.multiple && !isClone && drag.parentElement === dragsEl) {
                if (zones.length > 0) { const clone = createDraggableNode(true); clone.dataset.currentZone = zoneNames[0]; clone.classList.add('placed'); const zItems = (hasImage ? canvasEl : div.querySelector('#dndZonesLegacy')).querySelector(`.dnd-player-zone[data-zone="${escapeAttr(zoneNames[0])}"] .dnd-player-zone-items`); if (zItems) zItems.appendChild(clone); }
                return;
              }
              const currentIdx = zoneNames.indexOf(currentZone);
              const nextIdx = (currentIdx + 1) % (zoneNames.length + 1);
              if (nextIdx >= zoneNames.length) {
                if (isClone) { drag.remove(); } else { drag.dataset.currentZone = ''; drag.classList.remove('placed'); dragsEl.appendChild(drag); }
              } else {
                drag.dataset.currentZone = zoneNames[nextIdx]; drag.classList.add('placed');
                const zoneItemsEl = (hasImage ? canvasEl : div.querySelector('#dndZonesLegacy')).querySelector(`.dnd-player-zone[data-zone="${escapeAttr(zoneNames[nextIdx])}"] .dnd-player-zone-items`);
                if (zoneItemsEl) zoneItemsEl.appendChild(drag);
              }
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
              let correct = 0;
              zoneEls.forEach((z, idx) => {
                const zoneData = zones.find((zz) => zz.label === z.dataset.zone);
                const expected = zoneData?.correctDraggable || '';
                const items = z.querySelectorAll('.dnd-player-drag.placed');
                const defaultColor = colors[idx % colors.length];
                let hasCorrect = false; let anyWrong = false;
                if (items.length === 0) { if (expected) anyWrong = true; }
                else {
                  for (const item of items) {
                    const isMatchByText = expected && item.textContent === expected;
                    const isMatchByZone = item.dataset.correctZone === z.dataset.zone;
                    if (isMatchByText || isMatchByZone) hasCorrect = true;
                    else anyWrong = true;
                  }
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
        const url = content.url || '';
        if (url) {
          div.innerHTML = `
            <p style="margin-bottom:8px; font-size:0.85rem; color:var(--text-secondary);">Eingebettete Seite: ${escapeHtml(url)}</p>
            <div style="border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden; background:#fff; text-align:center; padding:40px;">
              <p>IFrame-Vorschau ist in der Desktop-App aus Sicherheitsgründen eingeschränkt.</p>
              <p style="margin-top:8px;"><strong>URL:</strong> ${escapeHtml(url)}</p>
              <p style="margin-top:4px;"><strong>Größe:</strong> ${content.width || 800}×${content.height || 600}px</p>
            </div>`;
        } else { div.textContent = 'Keine URL definiert.'; }
        break;
      }

      case 'imageHotspots': {
        const hotspots = content.hotspots || [];
        div.innerHTML = `
          <div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
            <div style="position:relative; width:100%; height:300px; background:#e2e8f0; border-radius:var(--radius-sm); overflow:hidden;">
              ${hotspots.map((h) => `<div style="position:absolute; left:${h.posX || 50}%; top:${h.posY || 50}%; transform:translate(-50%,-50%); width:30px; height:30px; background:var(--accent); border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; font-size:0.8rem;" title="${escapeAttr(h.title || '')}">📌</div>`).join('')}
            </div>
            <div style="margin-top:16px;">
              ${hotspots.map((h) => `<div style="margin-bottom:8px; padding:8px 12px; background:var(--bg-secondary); border-radius:var(--radius-sm); border:1px solid var(--border);"><strong>${escapeHtml(h.title || '')}</strong><br/><span style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(h.content || '')}</span></div>`).join('')}
            </div>
          </div>`;
        break;
      }

      case 'collage': {
        const images = content.images || [];
        div.innerHTML = `
          <div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
            <p style="margin-bottom:12px;"><strong>Layout:</strong> ${content.layout || 'Standard'}</p>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
              ${images.map((img) => `<div style="background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:16px; text-align:center;"><div style="font-size:2rem; margin-bottom:8px;">🖼️</div><p style="font-size:0.85rem;">${escapeHtml(img.imageUrl || 'Kein Bild')}</p><p style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(img.alt || '')}</p></div>`).join('')}
            </div>
          </div>`;
        break;
      }

      case 'audioRecorder': {
        div.innerHTML = `
          <div style="padding:30px; text-align:center; background:var(--bg-primary); border-radius:var(--radius-md);">
            ${content.instruction ? `<p style="margin-bottom:20px;">${escapeHtml(content.instruction)}</p>` : ''}
            <div style="font-size:4rem; margin-bottom:16px;">🎙️</div>
            <p style="color:var(--text-secondary);">Audio Recorder Vorschau</p>
            <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:8px;">Max. Aufnahmedauer: ${content.maxDuration || 60}s</p>
          </div>`;
        break;
      }

      case 'branchingScenario': {
        const startScreen = content.startScreen || {};
        const steps = content.steps || [];
        div.innerHTML = `
          <div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
            <div style="text-align:center; margin-bottom:24px;">
              <h3>${escapeHtml(startScreen.title || 'Branching Scenario')}</h3>
              ${startScreen.subtitle ? `<p style="color:var(--text-secondary);">${escapeHtml(startScreen.subtitle)}</p>` : ''}
            </div>
            <div>
              ${steps.map((s, i) => `<div style="padding:12px 16px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); margin-bottom:8px;"><strong>Schritt ${i + 1}: ${escapeHtml(s.stepTitle || '')}</strong>${s.stepContent ? `<p style="font-size:0.85rem; margin-top:4px;">${escapeHtml(s.stepContent)}</p>` : ''}</div>`).join('')}
            </div>
          </div>`;
        break;
      }

      case 'video': {
        div.innerHTML = `
          <div style="padding:30px; text-align:center; background:var(--bg-primary); border-radius:var(--radius-md);">
            <div style="font-size:4rem; margin-bottom:16px;">🎬</div>
            <h3>${escapeHtml(content.title || 'Video')}</h3>
            <p style="margin-top:8px; color:var(--text-secondary);">Quelle: ${escapeHtml(content.videoUrl || 'Nicht definiert')}</p>
          </div>`;
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
