const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

// ---------- In‑memory storage (replace with a DB for production) ----------
const sessions = new Map();   // sessionId -> { step1: bool, step2: bool, key: string, expiresAt: Date }
const keys     = new Map();   // key -> { expiresAt: Date }

const KEY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------- Helpers ----------
function createSession() {
  const id = crypto.randomBytes(16).toString('hex');
  sessions.set(id, { step1: false, step2: false, key: null, expiresAt: null });
  return id;
}

function generateKey() {
  // 16‑byte hex key (32 characters)
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

function getSession(id) {
  return sessions.get(id);
}

// ---------- 1. Front page – shows the two steps ----------
app.get('/', (req, res) => {
  const sessionId = createSession();
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>LootLabs Key System</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 1rem; }
    .step { border: 1px solid #ccc; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .step.done { background: #e8f5e9; border-color: #4caf50; }
    .step.locked { opacity: .5; pointer-events: none; }
    button { padding: .6rem 1.2rem; font-size: 1rem; cursor: pointer; }
    #keyBox { font-size: 1.4rem; font-weight: bold; background: #f5f5f5; padding: 1rem; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Get your key</h1>
  <p>Complete both steps below. Each step opens a LootLabs task.</p>

  <div id="step1" class="step ${session.step1 ? 'done' : ''}">
    <h2>Step 1</h2>
    <button onclick="window.open('https://LOOTLABS_LINK_STEP1', '_blank')">Open Step 1</button>
    <span id="step1Status">${session.step1 ? '✅ Completed' : '⏳ Waiting'}</span>
  </div>

  <div id="step2" class="step ${!session.step1 ? 'locked' : (session.step2 ? 'done' : '')}">
    <h2>Step 2</h2>
    <button onclick="window.open('https://LOOTLABS_LINK_STEP2', '_blank')">Open Step 2</button>
    <span id="step2Status">${session.step2 ? '✅ Completed' : '⏳ Waiting'}</span>
  </div>

  <div id="keyArea" style="display:none;">
    <h2>Your key</h2>
    <div id="keyBox"></div>
    <p>This key expires in 24 hours.</p>
  </div>

  <script>
    // Poll the server every 2 seconds to update step status
    const sessionId = '${sessionId}';
    async function poll() {
      const r = await fetch('/api/status?session=' + sessionId);
      const data = await r.json();
      // Update UI
      document.getElementById('step1').className = 'step ' + (data.step1 ? 'done' : '');
      document.getElementById('step2').className = 'step ' + (!data.step1 ? 'locked' : (data.step2 ? 'done' : ''));
      document.getElementById('step1Status').textContent = data.step1 ? '✅ Completed' : '⏳ Waiting';
      document.getElementById('step2Status').textContent = data.step2 ? '✅ Completed' : '⏳ Waiting';
      if (data.key) {
        document.getElementById('keyArea').style.display = 'block';
        document.getElementById('keyBox').textContent = data.key;
      }
    }
    setInterval(poll, 2000);
    poll();
  </script>
</body>
</html>
  `.replace(/\$\{session\.step1\}/g, String(false)) // placeholder; real values come from polling
   .replace(/\$\{session\.step2\}/g, String(false)));
});

// ---------- 2. Status endpoint used by the front‑end ----------
app.get('/api/status', (req, res) => {
  const sessionId = req.query.session;
  const s = getSession(sessionId);
  if (!s) return res.status(404).json({ error: 'Unknown session' });
  res.json({
    step1: s.step1,
    step2: s.step2,
    key: s.key,
  });
});

// ---------- 3. LootLabs Postback endpoint ----------
// LootLabs will call: /api/lootlabs/postback?click_id=...&ip=...&unique_id=...
// The `click_id` is the `puid` value you attach to each LootLabs link.
app.get('/api/lootlabs/postback', (req, res) => {
  const { click_id, ip, unique_id } = req.query;
  if (!click_id) return res.status(400).send('Missing click_id');

  // `click_id` is the session ID (or a token you embed in the LootLabs link).
  const s = getSession(click_id);
  if (!s) return res.status(404).send('Unknown session');

  // Determine which step was just completed.
  // In production you would use two different `puid` values for Step 1 and Step 2.
  // For simplicity we assume the first postback = Step 1, the second = Step 2.
  if (!s.step1) {
    s.step1 = true;
  } else if (!s.step2) {
    s.step2 = true;
    // Both steps done → generate key after a random 2–4 s delay
    const delay = 2000 + Math.random() * 2000; // 2–4 seconds
    setTimeout(() => {
      const key = generateKey();
      const expiresAt = new Date(Date.now() + KEY_TTL_MS);
      s.key = key;
      s.expiresAt = expiresAt;
      keys.set(key, { expiresAt });
    }, delay);
  }

  // LootLabs expects a 200 response
  res.sendStatus(200);
});

// ---------- 4. Success URL (user lands here after finishing a LootLabs task) ----------
app.get('/api/lootlabs/success', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html><body style="font-family: sans-serif; text-align:center; padding:2rem;">
  <h2>Task completed!</h2>
  <p>Return to the key page – your progress will update automatically.</p>
  <a href="/">← Back to key page</a>
</body></html>
  `);
});

// ---------- 5. Optional: validate a key (for your game / app) ----------
app.get('/api/validate', (req, res) => {
  const { key } = req.query;
  const record = keys.get(key);
  if (!record) return res.status(404).json({ valid: false, reason: 'not found' });
  if (new Date() > record.expiresAt) {
    keys.delete(key);
    return res.status(410).json({ valid: false, reason: 'expired' });
  }
  res.json({ valid: true, expiresAt: record.expiresAt });
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Key system listening on port ${PORT}`));
