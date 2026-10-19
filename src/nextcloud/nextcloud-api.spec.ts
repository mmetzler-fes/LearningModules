import { ShareClient, parseNextcloudBase, parsePropfind, safeFolderName, shareFileUrl } from './nextcloud-api';
import { imageFileName, mapDataImages } from './nextcloud.service';

describe('Nextcloud: Adressen und Namen', () => {
  it('nimmt auch eine kopierte Browser-Adresse, aber nur https', () => {
    expect(parseNextcloudBase('https://cloud.schule.de/')).toBe('https://cloud.schule.de');
    expect(parseNextcloudBase('https://cloud.schule.de/index.php/apps/files/?dir=/Bilder')).toBe('https://cloud.schule.de');
    expect(parseNextcloudBase('https://schule.de/nextcloud/apps/files/')).toBe('https://schule.de/nextcloud');
    expect(parseNextcloudBase('https://schule.de/nextcloud/s/AbC123')).toBe('https://schule.de/nextcloud');
    expect(parseNextcloudBase('http://cloud.schule.de')).toBeNull();
    expect(parseNextcloudBase('https://user:pw@cloud.schule.de')).toBeNull();
    expect(parseNextcloudBase('kein link')).toBeNull();
  });

  it('macht aus Thementiteln Ordnernamen und aus Bildern Dateinamen', () => {
    expect(safeFolderName('Englisch: Reisen / A1')).toBe('Englisch Reisen A1');
    expect(safeFolderName('  ../ ')).toBe('Ohne-Titel');
    expect(imageFileName('Flughafen Foto.JPG', 'image/jpeg')).toBe('Flughafen-Foto.jpg');
    expect(imageFileName('', 'image/png')).toBe('bild.png');
  });

  it('baut die öffentliche Lese-URL einer Datei', () => {
    expect(shareFileUrl('https://c.de', 'Tok1', 'Englisch Reisen', 'gate 1.jpg'))
      .toBe('https://c.de/s/Tok1/download?path=%2FEnglisch%20Reisen&files=gate%201.jpg');
  });

  it('liest PROPFIND-Antworten mit beliebigem Namensraum-Kürzel', () => {
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/remote.php/dav/files/u/LM/Bilder/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
      <d:response><d:href>/remote.php/dav/files/u/LM/Bilder/Englisch%20Reisen/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
      <d:response><d:href>/remote.php/dav/files/u/LM/Bilder/gate.jpg</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontenttype>image/jpeg</d:getcontenttype><d:getcontentlength>1234</d:getcontentlength></d:prop></d:propstat></d:response>
    </d:multistatus>`;
    expect(parsePropfind(xml, 'https://c.de/remote.php/dav/files/u/LM/Bilder')).toEqual([
      { name: 'Englisch Reisen', isFolder: true, contentType: '', size: 0, modified: '' },
      { name: 'gate.jpg', isFolder: false, contentType: 'image/jpeg', size: 1234, modified: '' },
    ]);
  });
});

/** Simulierte Nextcloud: zeichnet Anfragen auf und antwortet nach Regeln. */
function fakeCloud(rules: Array<[RegExp, (url: string, init: any) => { status: number; body?: any }]>) {
  const calls: Array<{ method: string; url: string; init: any }> = [];
  const fetchImpl: any = async (url: string, init: any) => {
    calls.push({ method: init.method, url, init });
    const rule = rules.find(([re]) => re.test(`${init.method} ${url}`));
    const r = rule ? rule[1](url, init) : { status: 404 };
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(text), text: async () => text };
  };
  return { calls, fetchImpl };
}

describe('Freigabe-Client (nur der freigegebene Ordner, kein Konto)', () => {
  it('findet den WebDAV-Weg: erst klassisch, sonst der neuere', async () => {
    const { calls, fetchImpl } = fakeCloud([
      [/PROPFIND https:\/\/c\.de\/public\.php\/webdav\//, () => ({ status: 404 })],
      [/PROPFIND https:\/\/c\.de\/public\.php\/dav\/files\/Tok1\//, () => ({ status: 207, body: '<d:multistatus xmlns:d="DAV:"/>' })],
    ]);
    const nc = new ShareClient('https://c.de', 'Tok1', 'geheim', 'classic', fetchImpl);
    expect(await nc.detectMode()).toBe('files');
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from('Tok1:geheim').toString('base64')}`);
    expect(calls[1].init.headers.Authorization).toBe(`Basic ${Buffer.from('anonymous:geheim').toString('base64')}`);
    expect(calls.every((c) => c.init.redirect === 'manual')).toBe(true);
  });

  it('arbeitet nur relativ zum freigegebenen Ordner', async () => {
    const { calls, fetchImpl } = fakeCloud([[/MKCOL/, () => ({ status: 405 })], [/PUT/, () => ({ status: 201 })]]);
    const nc = new ShareClient('https://c.de', 'Tok1', 'pw', 'classic', fetchImpl);
    await nc.ensureFolder(['Bilder', 'Englisch Reisen']);
    await nc.put(['Bilder', 'Englisch Reisen', 'gate.jpg'], Buffer.from('x'), 'image/jpeg');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'MKCOL https://c.de/public.php/webdav/Bilder',
      'MKCOL https://c.de/public.php/webdav/Bilder/Englisch%20Reisen',
      'PUT https://c.de/public.php/webdav/Bilder/Englisch%20Reisen/gate.jpg',
    ]);
  });

  it('meldet falsches Passwort und fehlendes Schreibrecht verständlich', async () => {
    const wrong = fakeCloud([[/PROPFIND/, () => ({ status: 401 })]]);
    await expect(new ShareClient('https://c.de', 'T', 'falsch', 'classic', wrong.fetchImpl).detectMode()).rejects.toThrow(/Passwort der Freigabe/);
    const readOnly = fakeCloud([[/PUT/, () => ({ status: 403 })]]);
    await expect(new ShareClient('https://c.de', 'T', 'pw', 'classic', readOnly.fetchImpl).put(['a.png'], Buffer.from('x'), 'image/png'))
      .rejects.toThrow(/Hochladen und Bearbeiten erlauben/);
  });
});

describe('Vorschlag aus dem Admin-Backup', () => {
  it('leitet die Adresse aus Freigabelink oder WebDAV-Adresse ab', () => {
    expect(parseNextcloudBase('https://cloud.schule.de/s/AbC123XyZ')).toBe('https://cloud.schule.de');
    expect(parseNextcloudBase('https://cloud.schule.de/remote.php/dav/files/admin/Backups/')).toBe('https://cloud.schule.de');
    expect(parseNextcloudBase('https://schule.de/nc/index.php/s/AbC123')).toBe('https://schule.de/nc');
  });
});

describe('Gespeicherte Bilder (data:) finden und ersetzen', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  it('ersetzt ganze Feldwerte und Bilder mitten im HTML, sonst nichts', () => {
    const content = { imageUrl: png, html: `<p>Text</p><img src="${png}" class="ws-float-left"><p>data:image/ im Text</p>`, n: 3, list: [{ aImage: png }, { aText: 'x' }] };
    const out = mapDataImages(content, () => 'https://c.de/bild.png');
    expect(out).toEqual({
      imageUrl: 'https://c.de/bild.png',
      html: '<p>Text</p><img src="https://c.de/bild.png" class="ws-float-left"><p>data:image/ im Text</p>',
      n: 3,
      list: [{ aImage: 'https://c.de/bild.png' }, { aText: 'x' }],
    });
    expect(content.imageUrl).toBe(png); // Original unverändert
  });
});
