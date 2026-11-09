/* Shared by the public pages (search, results, seat booking):
   the Dhaka clock, the dark/light switch and the top bar's glass. */

(() => {
  const THEME_KEY = 'btbms-theme';

  /* ---- clock ---- */
  const clock = document.getElementById('clock');
  if (clock) {
    const format = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const tick = () => { clock.textContent = format.format(new Date()); };
    tick();
    setInterval(tick, 1000);
  }

  /* ---- theme (the same key as the landing page) ---- */
  function applyTheme(name) {
    const theme = name === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const label = theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('title', label);
      button.setAttribute('aria-label', label);
    });
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* private window: applies here, just not remembered */
    }
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  applyTheme(document.documentElement.getAttribute('data-theme'));

  /* ---- top bar turns to glass once the page moves ---- */
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const mark = () => topbar.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', mark, { passive: true });
    mark();
  }
})();
