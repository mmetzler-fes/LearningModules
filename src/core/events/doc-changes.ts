import { EventEmitter } from 'events';

/**
 * „Bei dieser Lehrkraft haben sich Dokumente oder ihre Ordner geändert.“
 * Ein schlichter Bus statt gegenseitiger Modul-Abhängigkeiten: Themen und
 * Notebooks melden, das Nextcloud-Abbild (DocMirrorService) hört zu.
 */
export const docChanges = new EventEmitter();
docChanges.setMaxListeners(20);

export function docChanged(userId: string | null | undefined) {
  if (userId) docChanges.emit('changed', userId);
}
