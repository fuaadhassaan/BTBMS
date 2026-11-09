/* Who can sign in, and which console each ID opens.

   Only the ID and its roles live here. Passwords are checked by the
   console itself (console-app.js, via staff.js), so there is one copy of that
   rule rather than two. Passengers never sign in, so they are not here. */

export const ROLES = {
  admin: { label: 'Admin', accent: '#ff4d4d', text: '#ffd6d6', page: 'admin.html' },
  cmanager: { label: 'Counter Manager', accent: '#ff4d4d', text: '#ffd6d6', page: 'cmanager.html' }
};

export const ACCOUNTS = {
  AD1: { roles: ['admin'] },
  CM1: { roles: ['cmanager'] }
};

/* The keys the landing page and the consoles share. */
export const HANDOFF_KEY = 'btbms.handoff';
export const SIGNIN_ERROR_KEY = 'btbms.signin-error';
