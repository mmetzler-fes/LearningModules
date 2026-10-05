import { issueTicket, readTicket } from './student-ticket';

describe('Schülerausweis', () => {
  it('gilt für seinen Link', () => {
    const t = issueTicket('link1', 'stud1', 'Adrian Albrecht');
    expect(readTicket(t, 'link1')).toMatchObject({ s: 'stud1', n: 'Adrian Albrecht' });
    expect(readTicket(t, 'link2')).toBeNull();
  });

  it('lässt sich nicht verändern', () => {
    const [payload, mac] = issueTicket('link1', 'stud1', 'A').split('.');
    const forged = Buffer.from(JSON.stringify({ l: 'link1', s: 'stud2', n: 'B', e: Date.now() + 1e6 })).toString('base64url');
    expect(readTicket(`${forged}.${mac}`, 'link1')).toBeNull();
    expect(readTicket(`${payload}.x${mac.slice(1)}`, 'link1')).toBeNull();
    expect(readTicket('kaputt', 'link1')).toBeNull();
  });

  it('läuft ab', () => {
    const t = issueTicket('link1', 'stud1', 'A', Date.now() - 13 * 3600 * 1000);
    expect(readTicket(t, 'link1')).toBeNull();
  });
});
