import {
  soleDocument,
  docTitleFollowingTopic,
  topicTitleFollowingDoc,
} from './sole-document';

const doc = { id: 'd', type: 'document', title: 'Ohmsches Gesetz' };
const quiz = { id: 'q', type: 'multipleChoice', title: 'Quiz' };

describe('Lernthema mit genau einem Dokument', () => {
  it('erkennt das eine Dokument, Quizze und Untermodule zählen nicht', () => {
    expect(soleDocument([doc, quiz])?.id).toBe('d');
    expect(soleDocument([quiz])).toBeNull();
    expect(soleDocument([doc, { id: 'd2', type: 'attachment' }])).toBeNull();
    expect(
      soleDocument([doc, { id: 'k', type: 'document', parentId: 'd' }])?.id,
    ).toBe('d');
  });

  it('Umbenennen des Lernthemas zieht das Dokument mit, wenn beide gleich hießen', () => {
    expect(
      docTitleFollowingTopic([doc, quiz], 'Ohmsches Gesetz', 'Ohm'),
    ).toEqual({ id: 'd', title: 'Ohm' });
    expect(docTitleFollowingTopic([doc], 'Anderer Titel', 'Ohm')).toBeNull();
    expect(
      docTitleFollowingTopic(
        [doc, { ...doc, id: 'd2' }],
        'Ohmsches Gesetz',
        'Ohm',
      ),
    ).toBeNull();
    expect(
      docTitleFollowingTopic([doc], 'Ohmsches Gesetz', undefined),
    ).toBeNull();
    expect(docTitleFollowingTopic([doc], 'Ohmsches Gesetz', '  ')).toBeNull();
  });

  it('Umbenennen des einzigen Dokuments zieht das Lernthema mit – auch wenn die Titel vorher abwichen', () => {
    expect(
      topicTitleFollowingDoc(
        'Ohmsches Gesetz',
        [doc, quiz],
        'd',
        'Ohmsches Gesetz',
        'Ohm',
      ),
    ).toBe('Ohm');
    expect(
      topicTitleFollowingDoc('Thema', [doc], 'd', 'Ohmsches Gesetz', 'Ohm'),
    ).toBe('Ohm');
    expect(
      topicTitleFollowingDoc('Ohm', [doc], 'd', 'Ohmsches Gesetz', 'Ohm'),
    ).toBeNull();
    expect(
      topicTitleFollowingDoc('Quiz', [doc, quiz], 'q', 'Quiz', 'Neu'),
    ).toBeNull();
    expect(
      topicTitleFollowingDoc(
        'Ohmsches Gesetz',
        [doc],
        'd',
        'Ohmsches Gesetz',
        'Ohmsches Gesetz',
      ),
    ).toBeNull();
  });
});
