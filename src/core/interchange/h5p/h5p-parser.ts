import * as path from 'path';
import AdmZip from 'adm-zip';

function h5pUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function stripHtml(html: any): string {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractMediaImage(media: any, h5pImages: Record<string, string>): string {
  if (!media || typeof media !== 'object') return '';
  const imagePath = media.path || (media.params && media.params.file && media.params.file.path) || '';
  if (!imagePath) return '';
  const fileName = path.basename(imagePath);
  return h5pImages[fileName] || '';
}

function convertH5pToNative(machineName: string, params: any, h5pImages: Record<string, string> = {}): any {
  switch (machineName) {
    case 'H5P.MultiChoice': {
      const question = stripHtml(params.question || '');
      const answers = (params.answers || []).map((a: any) => ({
        text: stripHtml(a.text || ''),
        correct: !!a.correct,
        tip: a.tipsAndFeedback ? stripHtml(a.tipsAndFeedback.tip || '') : '',
      }));
      const behaviour = params.behaviour || {};
      const correctCount = answers.filter((a: any) => a.correct).length;
      const singleAnswer =
        behaviour.singleAnswer !== undefined
          ? !!behaviour.singleAnswer
          : correctCount <= 1;
      return {
        type: 'multipleChoice',
        content: {
          question,
          imageUrl: extractMediaImage(params.media, h5pImages),
          answers,
          singleAnswer,
          randomAnswers: !!behaviour.randomAnswers,
          enableRetry: behaviour.enableRetry !== false,
          enableSolutionsButton: behaviour.enableSolutionsButton !== false,
          passPercentage: Number(behaviour.passPercentage) || 100,
        },
      };
    }

    case 'H5P.Blanks': {
      // params.text = rich-text task description; params.questions = array of blank sentences
      const taskDescription = stripHtml(params.text || '');
      const rawQuestions = Array.isArray(params.questions) ? params.questions : [];
      const questions = rawQuestions.map((q: any) => ({ text: stripHtml(q) }));
      return {
        type: 'fillInTheBlanks',
        content: {
          taskDescription,
          imageUrl: extractMediaImage(params.media, h5pImages),
          questions: questions.length > 0 ? questions : [{ text: '' }],
          caseSensitive: !!(params.behaviour && params.behaviour.caseSensitive),
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          enableSolutionsButton: !(params.behaviour && params.behaviour.enableSolutionsButton === false),
          showSolutionsRequiresInput: !(params.behaviour && params.behaviour.showSolutionsRequiresInput === false),
        },
      };
    }

    case 'H5P.TrueFalse': {
      const question = stripHtml(params.question || '');
      const correctAnswer = params.correct === true || params.correct === 'true' ? 'true' : 'false';
      const feedbackCorrect = stripHtml(params.feedbackOnCorrect || 'Richtig!');
      const feedbackWrong = stripHtml(params.feedbackOnWrong || 'Leider falsch.');
      return {
        type: 'trueFalse',
        content: {
          imageUrl: extractMediaImage(params.media, h5pImages),
          questions: [{ question, correctAnswer, feedbackCorrect, feedbackWrong }],
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          enableSolutionsButton: !(params.behaviour && params.behaviour.enableSolutionsButton === false),
        },
      };
    }

    case 'H5P.Essay': {
      return {
        type: 'essay',
        content: {
          taskDescription: stripHtml(params.question || params.taskDescription || ''),
          imageUrl: extractMediaImage(params.media, h5pImages),
          sampleSolution: (params.solution && params.solution.sample) || '',
          minChars: Number(params.behaviour && params.behaviour.minimumLength) || 0,
          inputFieldSize: Number(params.behaviour && params.behaviour.inputFieldSize) || 10,
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          ignoreScoring: !(params.behaviour && params.behaviour.ignoreScoring === false),
          pointsHost: Number(params.behaviour && params.behaviour.pointsHost) || 1,
        },
      };
    }

    case 'H5P.DragText': {
      return {
        type: 'dragTheWords',
        content: {
          taskDescription: stripHtml(params.taskDescription || ''),
          imageUrl: extractMediaImage(params.media, h5pImages),
          textField: params.textField || '',
          distractors: stripHtml(params.distractors || ''),
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          enableSolutionsButton: !(params.behaviour && params.behaviour.enableSolutionsButton === false),
          instantFeedback: !!(params.behaviour && params.behaviour.instantFeedback),
        },
      };
    }

    case 'H5P.MarkTheWords': {
      return {
        type: 'markTheWords',
        content: {
          taskDescription: stripHtml(params.taskDescription || ''),
          imageUrl: extractMediaImage(params.media, h5pImages),
          textField: params.textField || '',
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          enableSolutionsButton: !(params.behaviour && params.behaviour.enableSolutionsButton === false),
        },
      };
    }

    case 'H5P.DragQuestion': {
      const taskDesc = stripHtml(
        (params.question && params.question.settings && params.question.settings.taskDescription) || ''
      );
      const settings = (params.question && params.question.settings) || {};
      const taskData = (params.question && params.question.task) || {};
      const elements: any[] = Array.isArray(taskData.elements) ? taskData.elements : [];
      const dropZones: any[] = Array.isArray(taskData.dropZones) ? taskData.dropZones : [];
      // Fläche in px; Breite/Höhe von Elementen und Zonen stehen in em (16 px).
      const W = Number(settings.size && settings.size.width) || 620;
      const H = Number(settings.size && settings.size.height) || 310;
      const EM = 16;

      const isImage = (el: any) => String((el.type && el.type.library) || '').startsWith('H5P.Image');
      const imageOf = (el: any) => {
        const p = el.type && el.type.params && el.type.params.file && el.type.params.file.path;
        const f = p ? path.basename(p) : '';
        return f && h5pImages[f] ? h5pImages[f] : '';
      };
      const textOf = (el: any, i: number) => {
        const p = (el.type && el.type.params) || {};
        if (isImage(el)) return stripHtml(p.alt || (el.type.metadata && el.type.metadata.title) || '') || `Bild ${i + 1}`;
        return stripHtml(p.text || '') || `Element ${i + 1}`;
      };
      // Feststehend = auf keine Zone ziehbar (Hintergrund, Beschriftungen).
      const isFixed = (el: any) => !Array.isArray(el.dropZones) || el.dropZones.length === 0;

      const backgroundPath =
        (settings.background && settings.background.path) ||
        (settings.background && settings.background.originalImage && settings.background.originalImage.path) ||
        '';
      const backgroundFile = backgroundPath ? path.basename(backgroundPath) : '';
      let backgroundImage = backgroundFile && h5pImages[backgroundFile] ? h5pImages[backgroundFile] : '';
      // Unser H5P-Export legt das Bild als feststehendes Element oben über
      // die ganze Breite (Elemente starten darunter). Dann zählen Lage und
      // Größe der Zonen relativ zu diesem Bild.
      let bgIndex = -1;
      let imageH = H;
      if (!backgroundImage) {
        bgIndex = elements.findIndex((el) => isFixed(el) && isImage(el) && imageOf(el)
          && (Number(el.x) || 0) < 1 && (Number(el.y) || 0) < 1 && (Number(el.width) || 0) * EM >= 0.9 * W);
        if (bgIndex >= 0) {
          backgroundImage = imageOf(elements[bgIndex]);
          imageH = Math.min(H, (Number(elements[bgIndex].height) || 0) * EM) || H;
        }
      }
      const pctOfImageY = (yPct: number) => (yPct * H) / imageH;
      // Auf das Raster des Editors (Viertelprozent)
      const round = (v: number) => Math.round(v * 4) / 4;

      // Feststehende Karten links neben einer Zone (Liste, Paare) gehören zu ihr.
      const cards = new Map<number, { text?: string; image?: string }>();
      elements.forEach((el, i) => {
        if (i === bgIndex || !isFixed(el)) return;
        const top = Number(el.y) || 0;
        const bottom = top + ((Number(el.height) || 0) * EM * 100) / H;
        const k = dropZones.findIndex((dz) => {
          const zTop = Number(dz.y) || 0;
          const zBottom = zTop + ((Number(dz.height) || 0) * EM * 100) / H;
          return (Number(dz.x) || 0) > (Number(el.x) || 0) && zTop < bottom && zBottom > top;
        });
        if (k < 0) return;
        const card = cards.get(k) || {};
        if (isImage(el)) card.image = card.image || imageOf(el);
        else card.text = card.text || stripHtml((el.type && el.type.params && el.type.params.text) || '');
        cards.set(k, card);
      });

      const mappedDropZones = dropZones.map((dz: any, i: number) => {
        const correctIndices = Array.isArray(dz.correctElements) ? dz.correctElements : [];
        let correctDraggable = '';
        if (correctIndices.length > 0) {
          const firstIdx = parseInt(correctIndices[0], 10);
          if (!isNaN(firstIdx) && elements[firstIdx]) correctDraggable = textOf(elements[firstIdx], firstIdx);
        }
        const card = cards.get(i) || {};
        const image = card.image || '';
        return {
          label: stripHtml(dz.label || '') || card.text || `Zone ${i + 1}`,
          x: Math.round(Number(dz.x) || 0),
          y: Math.round(bgIndex >= 0 ? pctOfImageY(Number(dz.y) || 0) : Number(dz.y) || 0),
          width: round(((Number(dz.width) || 0) * EM * 100) / W) || 20,
          height: round(((Number(dz.height) || 0) * EM * 100) / imageH) || 20,
          correctDraggable, // Set this side of the mapping too
          imageUrl: image,
          // Nur das Bild gezeigt, Name verborgen
          hideText: !!image && dz.showLabel === false,
        };
      });

      const draggables = elements
        .map((el: any, i: number) => {
          if (isFixed(el)) return null;
          const correctZoneIdx = dropZones.findIndex(
            (dz: any) => Array.isArray(dz.correctElements) && dz.correctElements.includes(String(i))
          );
          const imageUrl = isImage(el) ? imageOf(el) : '';
          return {
            text: textOf(el, i),
            // H5P "unbegrenzt": jedes Ziehen erzeugt eine Kopie.
            multiple: !!el.multiple,
            correctZone:
              correctZoneIdx >= 0 && mappedDropZones[correctZoneIdx]
                ? mappedDropZones[correctZoneIdx].label
                : '',
            imageUrl,
            hideText: !!imageUrl,
          };
        })
        .filter((d: any) => d && d.text.trim());

      // Jede Zone mit Karte und höchstens einem richtigen Element: Paare.
      const pairs = !backgroundImage && dropZones.length > 0
        && dropZones.every((dz: any, i: number) => cards.has(i) && (dz.correctElements || []).length <= 1);

      return {
        type: 'dragAndDrop',
        content: {
          taskDescription: taskDesc, backgroundImage, layout: pairs ? 'pairs' : '',
          dropZones: mappedDropZones, draggables,
        },
      };
    }

    default:
      return null; // No native mapping — keep as h5p_native
  }
}

export function processH5pBuffer(buffer: Buffer, fileName: string, importMode: string = 'native'): any {
  let entries: { [key: string]: any };
  
  try {
    const zip = new AdmZip(buffer);
    entries = {};
    for (const entry of zip.getEntries()) {
      entries[entry.entryName] = entry.getData();
    }
  }

  catch (e) { return { success: false, error: 'Ungültige H5P-Datei: ' + e.message }; }

  if (!entries['h5p.json']) return { success: false, error: 'h5p.json fehlt in der H5P-Datei' };
  let h5pMeta;
  try { h5pMeta = JSON.parse(entries['h5p.json'].toString('utf8')); }
  catch { return { success: false, error: 'Fehler beim Lesen von h5p.json' }; }

  if (!entries['content/content.json']) return { success: false, error: 'content/content.json fehlt in der H5P-Datei' };
  let contentData;
  try { contentData = JSON.parse(entries['content/content.json'].toString('utf8')); }
  catch { return { success: false, error: 'Fehler beim Lesen von content/content.json' }; }

  const mimeByExt: { [key: string]: string } = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };
  const h5pImages: { [key: string]: string } = {};
  for (const [entryName, entryData] of Object.entries(entries)) {
    if (entryName.startsWith('content/images/')) {
      const imgName = path.basename(entryName);
      const ext = path.extname(imgName).toLowerCase().slice(1);
      h5pImages[imgName] = `data:${mimeByExt[ext] || 'image/png'};base64,${(entryData as Buffer).toString('base64')}`;
    }
  }

  const mainLibrary = h5pMeta.mainLibrary || '';
  const baseName = path.basename(fileName, '.h5p');
  const topicTitle = h5pMeta.title || h5pMeta.extraTitle || baseName;
  const rawItems = mainLibrary === 'H5P.QuestionSet'
    ? (Array.isArray(contentData.questions) ? contentData.questions : []).map((q: any, idx: number) => ({
        title: (q.metadata && q.metadata.title) || `Aufgabe ${idx + 1}`,
        library: q.library || '',
      }))
    : [{ title: topicTitle, library: mainLibrary }];
  const h5pRawSummary = { mainLibrary, itemCount: rawItems.length, items: rawItems };

  if (importMode === 'raw') {
    const topic = {
      id: 'topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      title: topicTitle,
      description: `Als H5P-Projekt importiert (${mainLibrary})`,
      selected: false,
      createdAt: new Date().toISOString(),
      modules: [],
      h5pImages,
      h5pMeta: { mainLibrary, title: topicTitle },
      h5pRawSummary,
      h5pImportMode: 'raw',
      h5pRawPackage: { fileName, dataBase64: buffer.toString('base64'), importedAt: new Date().toISOString() },
      permissions: { visibleTo: 'all' },
    };
    return { success: true, topic, importMode: 'raw' };
  }

  const modules = [];
  if (mainLibrary === 'H5P.QuestionSet') {
    for (const q of (Array.isArray(contentData.questions) ? contentData.questions : [])) {
      const machineName = (q.library || '').split(' ')[0];
      const converted = convertH5pToNative(machineName, q.params || {}, h5pImages);
      const sourceSubContentId = q.subContentId || h5pUuid();
      modules.push({
        id: 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        title: (q.metadata && q.metadata.title) || 'Aufgabe',
        type: converted ? converted.type : 'h5p_native',
        description: (q.metadata && q.metadata.contentType) || machineName.replace('H5P.', ''),
        content: converted ? converted.content : { library: q.library || '', machineName, params: q.params || {}, subContentId: sourceSubContentId },
        h5pSource: { library: q.library || '', machineName, params: q.params || {}, metadata: q.metadata || {}, subContentId: sourceSubContentId },
        moduleSelected: true, createdAt: new Date().toISOString(),
      });
    }
  } else {
    const converted = convertH5pToNative(mainLibrary, contentData, h5pImages);
    const sourceSubContentId = h5pUuid();
    modules.push({
      id: 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      title: h5pMeta.title || h5pMeta.extraTitle || baseName,
      type: converted ? converted.type : 'h5p_native',
      description: mainLibrary.replace('H5P.', ''),
      content: converted ? converted.content : { library: mainLibrary, machineName: mainLibrary, params: contentData, subContentId: sourceSubContentId },
      h5pSource: { library: mainLibrary, machineName: mainLibrary, params: contentData,
        metadata: { contentType: mainLibrary.replace('H5P.', ''), title: topicTitle, extraTitle: topicTitle, license: 'U', authors: [], changes: [] },
        subContentId: sourceSubContentId },
      moduleSelected: true, createdAt: new Date().toISOString(),
    });
  }

  const topic = {
    id: 'topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    title: topicTitle,
    description: `Importiert aus H5P (${mainLibrary})`,
    selected: false,
    createdAt: new Date().toISOString(),
    modules,
    h5pImages,
    h5pMeta: { mainLibrary, title: topicTitle },
    h5pImportMode: 'native',
    permissions: { visibleTo: 'all' },
  };
  return { success: true, topic, importMode: 'native' };
}
