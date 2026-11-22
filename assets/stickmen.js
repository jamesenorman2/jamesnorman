/* The stick men on the front screen: who they are, what they do and what they say.
   One list, used by the homepage (to play them) and the admin page (to edit them).
   Edits made on the admin page are saved in the site's database (key "stickmen") and laid over these defaults,
   so if the database can't be reached the homepage still works with what is written here.

   Each man has:  id, name, does (what he does), slots (the things he says, each a list of lines; one is picked
   at random each time).  Custom men added on the admin page are { id, name, does, lines:[...], enabled }. */
(() => {
  const DEFAULTS = [
    { id: 'peek', name: 'The Agents who pop up', does: 'Now and then an agent pops up in the bottom of the screen with a speech bubble, mostly when you skip, rewind or fast-forward a track, or on a big breakdown. He stays for about three and a half seconds.',
      slots: [
        { key: 'next', when: 'You skip to the next track (press N)', lines: ['Hey, I was listening to that!', 'Don’t change my track!', 'Oi! That was my favourite.', 'Rude.', 'I was just getting into that one.', 'Skip? SKIP?!'] },
        { key: 'prev', when: 'You go back a track (press P)', lines: ['Again? Fair enough.', 'Rewind! Good call.', 'This one again? Fine by me.'] },
        { key: 'seek', when: 'You drag the track scrubber', lines: ['Don’t fast-forward my track!', 'Skipping the build-up? Criminal.', 'You’ve missed the best bit.', 'No skipping the breakdown!'] },
        { key: 'scut', when: 'A scut monkey moment', lines: ['Time for a scut monkey.'] },
        { key: 'break', when: 'A big breakdown in the music', lines: ['This breakdown though!', 'Goosebumps. Actual goosebumps.', 'Hands in the air for this bit!', 'I’m not crying, you’re crying.', 'Wait for it… wait for it…', 'This is my favourite bit!', 'Somebody hold my tea.', 'Here it comes!', 'I love this tune so much.'] },
        { key: 'idle', when: 'Out of nowhere, every few minutes while music plays', lines: ['Continue.', 'Carry on.', 'Nice choice.', 'Is this one of Normal’s picks?', 'I’m on my break. Don’t tell Normal.', 'Turn it up!', 'Just checking you’re still here.', 'Great tune!', 'As you were.'] },
        { key: 'names', when: 'The names he can have on his label (shown as “AGENT …”)', lines: ['NORMAL', 'MONKEY MONKEY', 'FISH FISH', 'MASTERPIECE', 'LLOYD', 'JACK MAN', 'FRANKIE', 'CODPIECE', 'FISH', 'GCHQ', 'BORING', 'OLD SCHOOL', 'BLOG-HEAD', 'SNOOPY', 'MR. PARTICULAR', 'QUIZZY RASCAL', 'HANDBOOK', 'ENGINEER', 'OATIE MAN', 'BIN LID'] }
      ] },
    { id: 'chair', name: 'Chair Dancer', does: 'On a big breakdown he walks on carrying a chair over his head, puts it down, climbs on it and dances with his hands in the air.',
      slots: [{ key: 'say', when: 'Once he is dancing on the chair', lines: ['I just don’t care!', 'I JUST DON’T CARE!', 'I just don’t caaaare!'] }] },
    { id: 'uv', name: 'UV Painter', does: 'Pops up, pulls a pot of UV paint out of his pocket, paints glowing stripes on his face one at a time, then jumps about with his arms up.',
      slots: [{ key: 'say', when: 'Once the paint is on', lines: ['Woohoo!', 'WOOHOO!', 'Woooohooo!'] }] },
    { id: 'poo', name: 'Loo Dasher', does: 'Dances without a care in the world, then it hits him. He sprints for the toilet, runs straight past it, skids, and turns to the screen.',
      slots: [
        { key: 'panic', when: 'The moment it hits him', lines: ['Oh no, I need a poo!'] },
        { key: 'late', when: 'After he has missed the loo', lines: ['Oops, too late.'] }
      ] },
    { id: 'pot', name: 'Pot Drummer (Frankie’s pick)', does: 'Has a cooking pot on his head and bangs it with a spoon on every beat of the music, with a BONG each time.',
      slots: [{ key: 'say', when: 'Partway through the drumming', lines: ['Yeah, freaking out, freaking out!'] }] },
    { id: 'cat', name: 'Cat Stroker (Frankie and his tiger baby)', does: 'Looks around for his cat, it strolls in, he gives it a long stroke, and it wanders off again.',
      slots: [
        { key: 'look', when: 'Looking for the cat', lines: ['Where’s my tiger baby?'] },
        { key: 'found', when: 'The cat arrives', lines: ['There’s my tiger baby!'] },
        { key: 'stroke', when: 'While he strokes it', lines: ['Yeah, freaking out, freaking out.'] }
      ] },
    { id: 'corner', name: 'The little stick man in the corner', does: 'The small white stick man at the bottom left of the screen. Click him and one of the others above (or one of your own below) comes on at random. He doesn’t say anything himself.', slots: [] }
  ];

  const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 120);
  const cleanLines = a => (Array.isArray(a) ? a : []).map(x => clean(x, 120)).filter(Boolean).slice(0, 60);

  const SM = {
    DEFAULTS,
    cfg: { men: {}, custom: [] },
    // Lay the saved edits over the defaults. Anything missing or broken falls back to the defaults.
    apply(saved) {
      const c = { men: {}, custom: [] };
      if (saved && typeof saved === 'object') {
        if (saved.men && typeof saved.men === 'object') for (const id of Object.keys(saved.men)) {
          const m = saved.men[id]; if (!m || typeof m !== 'object') continue;
          const o = { enabled: m.enabled !== false, slots: {} };
          if (m.slots && typeof m.slots === 'object') for (const k of Object.keys(m.slots)) { const l = cleanLines(m.slots[k]); if (l.length) o.slots[k] = l; }
          c.men[clean(id, 30)] = o;
        }
        if (Array.isArray(saved.custom)) c.custom = saved.custom.slice(0, 40).map((m, i) => ({
          id: clean(m && m.id, 30) || 'custom' + i, name: clean(m && m.name, 40) || 'New stick man', does: clean(m && m.does, 300),
          enabled: !(m && m.enabled === false), lines: cleanLines(m && m.lines)
        }));
      }
      SM.cfg = c;
    },
    on(id) { const m = SM.cfg.men[id]; return !m || m.enabled !== false; },
    lines(id, key) {
      const m = SM.cfg.men[id], saved = m && m.slots[key];
      if (saved && saved.length) return saved;
      const d = DEFAULTS.find(x => x.id === id), s = d && d.slots.find(x => x.key === key);
      return s ? s.lines : [];
    },
    say(id, key) { const l = SM.lines(id, key); return l.length ? l[Math.floor(Math.random() * l.length)] : ''; },
    // The extra men added on the admin page, ready to play (enabled, with at least one thing to say).
    customs() { return SM.cfg.custom.filter(m => m.enabled && m.lines.length); },
    async load() {
      try {
        const r = await fetch('https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1/jn_site_settings?key=eq.stickmen&select=value',
          { headers: { apikey: 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v' }, cache: 'no-store' });
        if (!r.ok) return;
        const [row] = await r.json();
        if (row && row.value) SM.apply(row.value);
      } catch (e) { /* the defaults above are fine */ }
    }
  };
  window.JN_STICK = SM;
  SM.ready = SM.load();
})();
