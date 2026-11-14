// Vercel-functie: stuurt leesverzoeken door naar de API van Intervals.icu.
// Nodig omdat de browser de API van Intervals.icu niet rechtstreeks mag aanspreken (CORS).
// De API-sleutel komt van de app (Authorization-header) en wordt hier niet bewaard of gelogd.
// Alleen GET: activiteiten en wellness van een atleet (oldest/newest), en de hartslagreeks van één activiteit (types).

const ALLOWED_PATH = /^(athlete\/[A-Za-z0-9_-]{1,32}\/(activities|wellness)|activity\/[A-Za-z0-9_-]{1,40}\/streams)$/;
const TYPES = /^[a-z_]{1,20}(,[a-z_]{1,20}){0,3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Alleen GET' });
    return;
  }
  const { path, oldest, newest, types } = req.query || {};
  if (typeof path !== 'string' || !ALLOWED_PATH.test(path)) {
    res.status(400).json({ error: 'Ongeldig pad' });
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || !/^Basic [A-Za-z0-9+/=]+$/.test(auth)) {
    res.status(401).json({ error: 'API-sleutel ontbreekt' });
    return;
  }
  const params = new URLSearchParams();
  if (typeof oldest === 'string' && DATE.test(oldest)) params.set('oldest', oldest);
  if (typeof newest === 'string' && DATE.test(newest)) params.set('newest', newest);
  if (typeof types === 'string' && TYPES.test(types) && path.startsWith('activity/')) params.set('types', types);

  try {
    const r = await fetch(`https://intervals.icu/api/v1/${path}?${params}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    const body = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'Intervals.icu niet bereikbaar' });
  }
};
