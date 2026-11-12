const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const LOOTLABS_STEP1 = 'https://LOOTLABS_LINK_STEP1';
const LOOTLABS_STEP2 = 'https://LOOTLABS_LINK_STEP2';

const KEY_TTL_MS = 24 * 60 * 60 * 1000;

const sessions = new Map();
const keys = new Map();

function createSession() {
  const id = crypto.randomBytes(16).toString('hex');
  sessions.set(id, { step1: false, step2: false, key: null, expiresAt: null });
  return id;
}

function generateKey() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

app.get('/', (req, res) => {
  const sessionId = createSession();
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Key System</title>
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
  <p>Complete both steps below.</p>

  <div id="step1" class="step locked">
    <h2>Step 1</h2>
    <button id="btn1">Open Step 1</button>
    <span id="step1Status">⏳ Waiting</span>
  </div>

  <div id="step2" class="step locked">
    <h2>Step 2</h2>
    <button id="btn2">Open Step 2</button>
    <span id="step2Status">⏳ Waiting</span>
  </div>

  <div id="keyArea" style="display:none;">
    <h2>Your key</h2>
    <div id="keyBox"></div>
    <p>This key expires in 24 hours.</p>
  </div>

  <script>
    const sessionId = '${sessionId}';
    document.getElementById('btn1').onclick = () =>
      window.open('${LOOTLABS_STEP1}&puid=step1_' + sessionId, '_blank');
    document.getElementById('btn2').onclick = () =>
      window.open('${LOOTLABS_STEP2}&puid=step2_' + sessionId, '_blank');

    async function poll() {
      const r = await fetch('/api/status?session=' + sessionId);
      const data = await r.json();
      const s1 = document.getElementById('step1');
      const s2 = document.getElementById('step2');
      if (data.step1) { s1.classList.add('done'); s1.classList.remove('locked'); }
      else { s1.classList.add('locked'); s1.classList.remove('done'); }
      if (data.step1) s2.classList.remove('locked');
      else s2.classList.add('locked');
      if (data.step2) { s2.classList.add('done'); s2.classList.remove('locked'); }
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
</html>`);
});

app.get('/api/status', (req, res) => {
  const s = sessions.get(req.query.session);
  if (!s) return res.status(404).json({ error: 'Unknown session' });
  res.json({ step1: s.step1, step2: s.step2, key: s.key });
});

app.get('/api/lootlabs/postback', (req, res) => {
  const { click_id, ip, unique_id } = req.query;
  if (!click_id) return res.status(400).send('Missing click_id');

  const [step, sessionId] = String(click_id).split('_');
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).send('Unknown session');

  if (step === 'step1') {
    s.step1 = true;
  } else if (step === 'step2') {
    if (!s.step1) return res.status(400).send('Step 1 not completed');
    s.step2 = true;
    if (!s.key) {
      const delay = 2000 + Math.random() * 2000;
      setTimeout(() => {
        const key = generateKey();
        const expiresAt = new Date(Date.now() + KEY_TTL_MS);
        s.key = key;
        s.expiresAt = expiresAt;
        keys.set(key, { expiresAt });
      }, delay);
    }
  } else {
    return res.status(400).send('Invalid step');
  }

  res.sendStatus(200);
});

app.get('/api/lootlabs/success', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><body style="font-family: sans-serif; text-align:center; padding:2rem;">
  <h2>Task completed!</h2>
  <p>Return to the key page – your progress will update automatically.</p>
  <a href="/">← Back to key page</a>
</body></html>`);
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Key system listening on port ${PORT}`));
