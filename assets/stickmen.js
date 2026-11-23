/* The stick men on the front screen: who they are, what they do and what they say.
   One list, used by the homepage (to play them) and the admin page (to edit them).
   Edits made on the admin page are saved in the site's database (key "stickmen") and laid over these defaults,
   so if the database can't be reached the homepage still works with what is written here.

   Each man has:  id, name, does (what he does), agent (which agent he is: the name shown when he is on the main
   page), slots (the things he says, each a list of lines; one is picked at random each time).
   Custom men added on the admin page are { id, name, does, agent, lines:[...], enabled }.

   THE ROSTER. Every few minutes one agent is "due on the main page". Only that agent's stick men can appear on the
   homepage, under that agent's name, and on the agents page that agent walks to the wormhole just before their turn,
   goes through, is missing while they are on, and comes back out at the end. The homepage and the agents page work
   out who is due from the same clock and the same saved settings, so they always agree without talking to each other.
   An agent of "*" means whoever is due. */
(() => {
  // every agent on the agents page, in the order they are listed
  const AGENTS = ['NORMAL', 'LLOYD', 'MASTERPIECE', 'OLD SCHOOL', 'FRANKIE', 'GCHQ', 'QUIZZY RASCAL', 'OATIE MAN', 'ENGINEER', 'HANDBOOK', 'BORING', 'BIN LID',
    'MR. PARTICULAR', 'JACK MAN', 'SNOOPY', 'BLOG-HEAD', 'MONKEY MONKEY', 'FISH FISH', 'FISH', 'CODPIECE', 'ABNORMAL', 'WIFEO'];
  const SLOT = 180000, LEAD = 22000, RETURN = 24000;   // a turn lasts 3 minutes; they set off 22s before, and have 24s to get back to their desk after
  const DEFAULTS = [
    { id: 'peek', agent: '*', name: 'The Agents who pop up', does: 'Now and then an agent pops up in the bottom of the screen with a speech bubble, mostly when you skip, rewind or fast-forward a track, or on a big breakdown. He stays for about three and a half seconds.',
      slots: [
        { key: 'next', when: 'You skip to the next track (press N)', lines: ['Hey, I was listening to that!', 'Don’t change my track!', 'Oi! That was my favourite.', 'Rude.', 'I was just getting into that one.', 'Skip? SKIP?!'] },
        { key: 'prev', when: 'You go back a track (press P)', lines: ['Again? Fair enough.', 'Rewind! Good call.', 'This one again? Fine by me.'] },
        { key: 'seek', when: 'You drag the track scrubber', lines: ['Don’t fast-forward my track!', 'Skipping the build-up? Criminal.', 'You’ve missed the best bit.', 'No skipping the breakdown!'] },
        { key: 'scut', when: 'A scut monkey moment', lines: ['Time for a scut monkey.'] },
        { key: 'break', when: 'A big breakdown in the music', lines: ['This breakdown though!', 'Goosebumps. Actual goosebumps.', 'Hands in the air for this bit!', 'I’m not crying, you’re crying.', 'Wait for it… wait for it…', 'This is my favourite bit!', 'Somebody hold my tea.', 'Here it comes!', 'I love this tune so much.'] },
        { key: 'idle', when: 'Out of nowhere, every few minutes while music plays', lines: ['Continue.', 'Carry on.', 'Nice choice.', 'Is this one of Normal’s picks?', 'I’m on my break. Don’t tell Normal.', 'Turn it up!', 'Just checking you’re still here.', 'Great tune!', 'As you were.'] }
      ] },
    { id: 'chair', agent: 'NORMAL', name: 'Chair Dancer', does: 'On a big breakdown he walks on carrying a chair over his head, puts it down, climbs on it and dances with his hands in the air.',
      slots: [{ key: 'say', when: 'Once he is dancing on the chair', lines: ['I just don’t care!', 'I JUST DON’T CARE!', 'I just don’t caaaare!'] }] },
    { id: 'uv', agent: 'OLD SCHOOL', name: 'UV Painter', does: 'Pops up, pulls a pot of UV paint out of his pocket, paints glowing stripes on his face one at a time, then jumps about with his arms up.',
      slots: [{ key: 'say', when: 'Once the paint is on', lines: ['Woohoo!', 'WOOHOO!', 'Woooohooo!'] }] },
    { id: 'poo', agent: 'BIN LID', name: 'Loo Dasher', does: 'Dances without a care in the world, then it hits him. He sprints for the toilet, runs straight past it, skids, and turns to the screen. Little brown bits drop out of his bottom onto the floor, he dances over the evidence, then runs off shouting about the perfect crime.',
      slots: [
        { key: 'panic', when: 'The moment it hits him', lines: ['Oh no, I need a poo!'] },
        { key: 'late', when: 'After he has missed the loo', lines: ['Oops, too late.'] },
        { key: 'crime', when: 'Running away at the end', lines: ['Perfect crime.'] }
      ] },
    { id: 'pot', agent: 'FRANKIE', name: 'Pan Drummer (Frankie’s pick)', does: 'Has a saucepan on his head and bangs it with a spoon on the beat of the music, with a BONG each time. After four bangs he takes it off, throws it up in the air and shouts the line below. It lands on the floor with a CLANG.',
      slots: [
        { key: 'say', when: 'While he is banging it', lines: ['Yeah, freaking out, freaking out!'] },
        { key: 'throw', when: 'When he throws it in the air', lines: ['Sounds great!'] }
      ] },
    { id: 'cat', agent: 'FRANKIE', name: 'Cat Stroker (Frankie and his tiger baby)', does: 'Looks around for his cat, it strolls in, he gives it a long stroke, and it wanders off again.',
      slots: [
        { key: 'look', when: 'Looking for the cat', lines: ['Where’s my tiger baby?'] },
        { key: 'found', when: 'The cat arrives', lines: ['There’s my tiger baby!'] }
      ] },
    { id: 'family', agent: 'WIFEO', name: 'The Family (Agent Wifeo, the kids and the cats)', does: 'A main player, on the front screen every few minutes (and on the agents page all the time). Agent Wifeo strolls on looking for James because she wants kisses, with Frankie, Jack Man, baby Oatie Man, Aragon and Tiger Baby trotting along behind her. The little ones ask where Daddy is, and Daddy (Agent Normal, the DJ, with his headphones) hurries on and says he loves them all, with a flurry of hearts. Then they all do some funny dancing together before they go. Not tied to the roster: she turns up whoever is due.',
      slots: [
        { key: 'find', when: 'Wifeo comes on', lines: ['Has anybody seen James? I want kisses!'] },
        { key: 'kisses', when: 'Blowing kisses', lines: ['Mwah! Mwah! Kisses for everyone!', 'Kisses! Come on, James! KISSES!'] },
        { key: 'daddy1', when: 'The first little one asks', lines: ['Where’s Daddy? Is he playing?'] },
        { key: 'daddy2', when: 'The second little one asks', lines: ['Is he DJing?'] },
        { key: 'daddy3', when: 'Wifeo has an idea', lines: ['Let’s go watch Daddy!'] },
        { key: 'record', when: 'Daddy hurries on', lines: ['I love you boys, I love you babe!'] },
        { key: 'love', when: 'A little one, as they leave', lines: ['I love you, Mum.', 'I love you, Mum. A LOT.', 'Love you, Mum!'] },
        { key: 'silly', when: 'While they trot along', lines: ['Mum, wait for us!', 'Are we nearly there?', 'I’m a train! Choo choo!', 'Mum, Aragon’s eating my sock'] },
        { key: 'baby', when: 'The baby', lines: ['Da-da! DA-DA!', 'Goo goo! Mama!', 'Ba ba ba!'] }
      ] },
    { id: 'corner', name: 'The little stick man in the corner', does: 'The small white stick man at the bottom left of the screen. Click him and one of the others above (or one of your own below) comes on at random. He doesn’t say anything himself.', slots: [] }
  ];

  const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 120);
  const cleanAgent = a => { a = String(a == null ? '' : a).toUpperCase().trim(); return a === '*' || AGENTS.includes(a) ? a : ''; };
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
          const o = { enabled: m.enabled !== false, agent: cleanAgent(m.agent), slots: {} };
          if (m.slots && typeof m.slots === 'object') for (const k of Object.keys(m.slots)) { const l = cleanLines(m.slots[k]); if (l.length) o.slots[k] = l; }
          c.men[clean(id, 30)] = o;
        }
        if (Array.isArray(saved.custom)) c.custom = saved.custom.slice(0, 40).map((m, i) => ({
          id: clean(m && m.id, 30) || 'custom' + i, agent: cleanAgent(m && m.agent) || AGENTS[0], name: clean(m && m.name, 40) || 'New stick man', does: clean(m && m.does, 300),
          enabled: !(m && m.enabled === false), lines: cleanLines(m && m.lines)
        }));
      }
      SM.cfg = c;
    },
    AGENTS, SLOT, LEAD, RETURN, loaded: false,
    // which agent a man is: the one you picked on the admin page, or his default
    agentOf(id) { const m = SM.cfg.men[id], d = DEFAULTS.find(x => x.id === id); return (m && m.agent) || (d && d.agent) || '*'; },
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

    // ── the roster ──
    // Who can be due: every agent that has at least one stick man switched on. If nobody does, everybody can be.
    candidates() {
      const set = new Set();
      DEFAULTS.forEach(d => { const a = SM.agentOf(d.id); if (d.id !== 'corner' && d.id !== 'family' && SM.on(d.id) && a !== '*') set.add(a); });   // the family is always about: it doesn't take a turn
      SM.customs().forEach(m => set.add(m.agent));
      const c = AGENTS.filter(a => set.has(a));
      return c.length ? c : AGENTS.slice();
    },
    // the agent due in slot n: everyone gets a turn in a shuffled order, and nobody goes twice running
    dutyIn(n) {
      const c = SM.candidates(), L = c.length;
      if (L === 1) return c[0];
      if (L === 2) return c[((n % 2) + 2) % 2];
      const order = e => {
        let seed = (e * 2654435761 + L * 40503) >>> 0;
        const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const a = c.slice(); for (let i = L - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
      };
      const e = Math.floor(n / L), i = ((n % L) + L) % L, a = order(e);
      if (i < 2 && a[0] === order(e - 1)[L - 1]) [a[0], a[1]] = [a[1], a[0]];
      return a[i];
    },
    // who is due now, who is next, and when each turn starts and ends
    duty(now) {
      now = now == null ? Date.now() : now;
      const n = Math.floor(now / SLOT);
      return { agent: SM.dutyIn(n), next: SM.dutyIn(n + 1), start: n * SLOT, end: (n + 1) * SLOT, left: (n + 1) * SLOT - now };
    },
    // where an agent is in their trip to the main page: here (at their desk), going (setting off for the wormhole),
    // away (on the main page) or back (just come out of the wormhole). `left` and `since` count down and up in seconds.
    status(agent, now) {
      now = now == null ? Date.now() : now;
      const n = Math.floor(now / SLOT), into = now - n * SLOT;
      if (SM.dutyIn(n) === agent) return { state: 'away' };
      if (SM.dutyIn(n + 1) === agent && SLOT - into < LEAD) return { state: 'going', left: (SLOT - into) / 1000 };
      if (SM.dutyIn(n - 1) === agent && into < RETURN) return { state: 'back', since: into / 1000 };
      return { state: 'here' };
    },
    // is this man allowed on the homepage right now? (switched on, and his agent is the one due)
    here(id) { return SM.on(id) && (SM.agentOf(id) === '*' || SM.agentOf(id) === SM.duty().agent); },
    // the agent whose name is shown on a man: his own agent, or whoever is due if he is set to "*"
    who(id) { const a = SM.agentOf(id); return a === '*' ? SM.duty().agent : a; },
    customsHere() { const a = SM.duty().agent; return SM.customs().filter(m => m.agent === a); },
    async load() {
      try {
        const r = await fetch('https://ynhyylnsbvmdasyyalcg.supabase.co/rest/v1/jn_site_settings?key=eq.stickmen&select=value',
          { headers: { apikey: 'sb_publishable_hc4qj9_jLSC388ntEKhaLA_RBlGvA1v' }, cache: 'no-store' });
        if (!r.ok) return;
        const [row] = await r.json();
        if (row && row.value) SM.apply(row.value);
      } catch (e) { /* the defaults above are fine */ }
      finally { SM.loaded = true; }
    }
  };
  window.JN_STICK = SM;
  SM.ready = SM.load();
})();
