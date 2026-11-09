import { collectImages, imageRef, maskImages, unmaskImages } from './ai-images';

const A = 'data:image/png;base64,AAAA';
const B = 'data:image/jpeg;base64,BBBB/+==';

describe('Bilder als Verweise für die KI', () => {
  it('ersetzt eingebettete Bilder überall durch kurze Verweise und nennt sie einmal', () => {
    const spec = { content: [{ type: 'image', src: A }, { type: 'text', text: `Siehe ![x](${B}) und nochmal ![y](${A})` }] };
    const { value, images } = maskImages(spec);
    expect(value.content[0].src).toBe(imageRef(A));
    expect(value.content[1].text).toBe(`Siehe ![x](${imageRef(B)}) und nochmal ![y](${imageRef(A)})`);
    expect(images.map((i) => [i.ref, i.mime])).toEqual([[imageRef(A), 'image/png'], [imageRef(B), 'image/jpeg']]);
    expect(spec.content[0].src).toBe(A); // Original bleibt unverändert
  });

  it('setzt sie wieder ein und meldet unbekannte', () => {
    const known = collectImages([{ spec: { content: [{ src: A }, { src: B }] } }]);
    const { value, unknown } = unmaskImages({ src: imageRef(B), t: `${imageRef(A)} lm-img:abcdefabcdef` }, known);
    expect(value).toEqual({ src: B, t: `${A} lm-img:abcdefabcdef` });
    expect(unknown).toEqual(['lm-img:abcdefabcdef']);
  });
});
