import { NextcloudClient, parseNextcloudBase, parsePropfind, safeFolderName, shareFileUrl } from './nextcloud-api';
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

describe('Nextcloud-Client', () => {
  it('nutzt für WebDAV die Benutzer-ID aus der Anmeldung, nicht den Anmeldenamen', async () => {
    const { calls, fetchImpl } = fakeCloud([
      [/GET .*cloud\/user/, () => ({ status: 200, body: { ocs: { data: { id: 'mmuster', 'display-name': 'Max Muster' } } } })],
      [/MKCOL/, () => ({ status: 405 })],
    ]);
    const nc = new NextcloudClient('https://c.de', 'max@schule.de', 'pw', null, fetchImpl);
    expect(await nc.userInfo()).toEqual({ id: 'mmuster', displayName: 'Max Muster' });
    await nc.ensureFolder(['LM', 'Bilder']);
    expect(calls.filter((c) => c.method === 'MKCOL').map((c) => c.url)).toEqual([
      'https://c.de/remote.php/dav/files/mmuster/LM',
      'https://c.de/remote.php/dav/files/mmuster/LM/Bilder',
    ]);
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from('max@schule.de:pw').toString('base64')}`);
    expect(calls[0].init.redirect).toBe('manual');
  });

  it('verwendet eine vorhandene Lesefreigabe, aber keine mit Schreibrecht', async () => {
    const { calls, fetchImpl } = fakeCloud([
      [/GET .*shares/, () => ({ status: 200, body: { ocs: { data: [
        { share_type: 3, permissions: 15, token: 'SCHREIB' },
        { share_type: 3, permissions: 1, token: 'NURLESEN' },
      ] } } })],
    ]);
    const nc = new NextcloudClient('https://c.de', 'u', 'pw', 'u', fetchImpl);
    expect(await nc.ensureReadShare(['LM', 'Bilder'])).toBe('NURLESEN');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('legt sonst eine reine Lesefreigabe an', async () => {
    const { calls, fetchImpl } = fakeCloud([
      [/GET .*shares/, () => ({ status: 200, body: { ocs: { data: [{ share_type: 3, permissions: 31, token: 'X' }] } } })],
      [/POST .*shares/, () => ({ status: 200, body: { ocs: { data: { token: 'NEU' } } } })],
    ]);
    const nc = new NextcloudClient('https://c.de', 'u', 'pw', 'u', fetchImpl);
    expect(await nc.ensureReadShare(['LM', 'Bilder'])).toBe('NEU');
    const post = calls.find((c) => c.method === 'POST')!;
    expect(Object.fromEntries(new URLSearchParams(post.init.body))).toEqual({ path: '/LM/Bilder', shareType: '3', permissions: '1' });
  });

  it('meldet ein falsches App-Passwort verständlich', async () => {
    const { fetchImpl } = fakeCloud([[/cloud\/user/, () => ({ status: 401 })]]);
    await expect(new NextcloudClient('https://c.de', 'u', 'falsch', null, fetchImpl).userInfo()).rejects.toThrow(/App-Passwort/);
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
