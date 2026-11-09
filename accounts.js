/* The consoles, and how each role looks on the landing page.

   Who may sign in lives in the database (`staff`, see staff.js), not
   here; passwords are checked by the console. Passengers never sign in. */

export const ROLES = {
  admin: { label: 'Admin', accent: '#ff4d4d', text: '#ffd6d6', page: 'admin.html' },
  cmanager: { label: 'Counter Manager', accent: '#ff4d4d', text: '#ffd6d6', page: 'cmanager.html' },
  company: { label: 'Company Manager', accent: '#b37bff', text: '#ead9ff', page: 'company.html' }
};

/* The keys the landing page and the consoles share. */
export const HANDOFF_KEY = 'btbms.handoff';
export const SIGNIN_ERROR_KEY = 'btbms.signin-error';
