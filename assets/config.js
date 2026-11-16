/* Shared settings for the tab pages. */
window.JN = {
  soundcloud: 'https://soundcloud.com/jamesnormal',
  linkedin: 'https://www.linkedin.com/in/james-norman-beng-ceng-miet-rses-4b065b1/',
  // Today's Night Shift report (runs once a day; cached until 05:00 UTC)
  async shift() {
    const r = await fetch('/api/night-shift');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
};
