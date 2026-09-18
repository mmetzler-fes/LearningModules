import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';

/**
 * Markiert Routen, die auch dann erreichbar bleiben, wenn der Benutzer sein
 * Initialpasswort noch nicht geändert hat – im Wesentlichen der
 * Passwortwechsel selbst.
 */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);
