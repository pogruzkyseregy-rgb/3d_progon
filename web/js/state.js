// Чистая логика тамагочи: без DOM и без three.js, поэтому её можно тестировать в Node.

export const STAT_KEYS = ['fullness', 'mood', 'energy', 'affection'];
export const MAX_OFFLINE_MINUTES = 12 * 60;

const clamp = (v) => Math.max(0, Math.min(100, v));

// Изменение в минуту: когда бодрствует и когда спит
const AWAKE_RATE = { fullness: -1.0, mood: -0.6, energy: -0.5, affection: -0.15 };
const SLEEP_RATE = { fullness: -0.6, mood: -0.2, energy: 5, affection: -0.05 };

export const ACTIONS = {
  fish: {
    label: 'Рыба',
    effects: { fullness: 30, mood: 5 },
    needs: { maxFullness: 90 },
    msg: 'Ням! Вкусная рыбка',
  },
  berry: {
    label: 'Ягода',
    effects: { fullness: 12, mood: 10, affection: 2 },
    needs: { maxFullness: 95 },
    msg: 'Сладкая ягодка!',
  },
  cake: {
    label: 'Пирожное',
    effects: { fullness: 18, mood: 22, energy: -4 },
    needs: { maxFullness: 85 },
    msg: 'Пирожное! Я счастлива',
  },
  play: {
    label: 'Играть',
    effects: { mood: 20, energy: -15, fullness: -6 },
    needs: { minEnergy: 15 },
    msg: 'Ура, давай играть!',
  },
  dance: {
    label: 'Танец',
    effects: { mood: 14, energy: -12, affection: 3, fullness: -4 },
    needs: { minEnergy: 20 },
    msg: 'Смотри, как я танцую!',
  },
  pet: {
    label: 'Гладить',
    effects: { affection: 3, mood: 3 },
    needs: {},
    msg: '',
  },
};

export function createState(now = Date.now()) {
  return { fullness: 80, mood: 80, energy: 90, affection: 40, sleeping: false, lastUpdate: now };
}

// Пересчитывает показатели за прошедшее время. Офлайн-прогресс ограничен 12 часами.
export function tick(state, now = Date.now()) {
  const minutes = Math.min(Math.max((now - state.lastUpdate) / 60000, 0), MAX_OFFLINE_MINUTES);
  const s = { ...state, lastUpdate: now };
  if (minutes === 0) return s;

  const rate = s.sleeping ? SLEEP_RATE : AWAKE_RATE;
  for (const k of STAT_KEYS) s[k] = clamp(s[k] + rate[k] * minutes);

  if (!s.sleeping) {
    if (s.fullness < 25) s.mood = clamp(s.mood - 0.8 * minutes);
    if (s.energy < 20) s.mood = clamp(s.mood - 0.4 * minutes);
    if (s.energy <= 0) s.sleeping = true; // совсем без сил — засыпает сама
  } else if (s.energy >= 100) {
    s.sleeping = false; // выспалась
  }
  return s;
}

// Возвращает { state, msg, ok }. ok=true только если действие применено.
export function applyAction(state, name, now = Date.now()) {
  const s = tick(state, now);

  if (name === 'sleep') {
    if (s.sleeping) {
      if (s.energy < 60) return { state: s, msg: 'Ещё хочу спать…', ok: false };
      s.sleeping = false;
      return { state: s, msg: 'Доброе утро!', ok: true };
    }
    s.sleeping = true;
    return { state: s, msg: 'Тсс… спокойной ночи', ok: true };
  }

  const action = ACTIONS[name];
  if (!action) return { state: s, msg: '', ok: false };
  if (s.sleeping) return { state: s, msg: 'Тсс… Аврора спит', ok: false };

  const { needs } = action;
  if (needs.maxFullness != null && s.fullness > needs.maxFullness) {
    return { state: s, msg: 'Я сыта, спасибо', ok: false };
  }
  if (needs.minEnergy != null && s.energy < needs.minEnergy) {
    return { state: s, msg: 'Я слишком устала…', ok: false };
  }

  for (const [k, v] of Object.entries(action.effects)) s[k] = clamp(s[k] + v);
  return { state: s, msg: action.msg, ok: true };
}

// Короткое состояние для подписи и реакции модели
export function moodOf(s) {
  if (s.sleeping) return { id: 'sleep', text: 'Zzz…' };
  if (s.fullness < 25) return { id: 'hungry', text: 'Я голодная…' };
  if (s.energy < 20) return { id: 'tired', text: 'Я устала…' };
  if (s.mood < 30) return { id: 'sad', text: 'Мне грустно…' };
  if (s.mood >= 70) return { id: 'happy', text: 'Мне хорошо!' };
  return { id: 'ok', text: 'Привет!' };
}

// Читает сохранение. Любой мусор → новая игра.
export function parseState(raw, now = Date.now()) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return createState(now);
    const base = createState(now);
    for (const k of STAT_KEYS) if (Number.isFinite(o[k])) base[k] = clamp(o[k]);
    base.sleeping = o.sleeping === true;
    if (Number.isFinite(o.lastUpdate)) base.lastUpdate = Math.min(o.lastUpdate, now);
    return tick(base, now);
  } catch {
    return createState(now);
  }
}
