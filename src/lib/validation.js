// Password policy: min 8 chars, at least one uppercase, one lowercase,
// one number and one special character.
export const PASSWORD_RULES = [
  { key: 'length', label: 'Mínimo 8 caracteres', test: (v) => v.length >= 8 },
  { key: 'upper', label: 'Una mayúscula', test: (v) => /[A-Z]/.test(v) },
  { key: 'lower', label: 'Una minúscula', test: (v) => /[a-z]/.test(v) },
  { key: 'number', label: 'Un número', test: (v) => /[0-9]/.test(v) },
  {
    key: 'special',
    label: 'Un carácter especial',
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
]

export function checkPassword(value = '') {
  const results = PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(value) }))
  return { results, valid: results.every((r) => r.ok) }
}

export function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

// --- Numeric input sanitizer -------------------------------------------------
// Clamp/shape a raw text-input value for a bounded decimal field. Returns the
// cleaned string to feed back into a controlled input (not a number), so the
// field can never hold an out-of-range or malformed value while typing.
//   maxIntDigits  max digits before the decimal point
//   maxDecimals   max digits after the decimal point (0 = integer only)
//   max           optional hard upper bound on the numeric value
// Empty string passes through (lets the user clear the field).
export function sanitizeDecimal(raw, { maxIntDigits = 3, maxDecimals = 3, max } = {}) {
  if (raw === '' || raw == null) return ''
  // Keep only digits and a single dot.
  let s = String(raw).replace(/[^\d.]/g, '')
  const firstDot = s.indexOf('.')
  if (firstDot !== -1) {
    // drop any extra dots after the first
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
  }
  let [intPart = '', decPart] = s.split('.')
  intPart = intPart.slice(0, maxIntDigits)
  const hasDot = s.includes('.')
  let out = intPart
  if (hasDot && maxDecimals > 0) {
    out = intPart + '.' + (decPart ?? '').slice(0, maxDecimals)
  } else if (hasDot && maxDecimals === 0) {
    out = intPart // decimals not allowed
  }
  // Enforce the numeric ceiling without blocking an in-progress value.
  if (max != null && out !== '' && out !== '.') {
    const n = Number(out)
    if (Number.isFinite(n) && n > max) return String(max)
  }
  return out
}

// Integer-only convenience wrapper.
export function sanitizeInteger(raw, { maxDigits = 3, max } = {}) {
  return sanitizeDecimal(raw, { maxIntDigits: maxDigits, maxDecimals: 0, max })
}

// --- Shared field limits for body weight + composition metrics ---------------
// Passed to sanitizeDecimal. Kept here so WeightReminder (Home) and the Account
// "Peso y cuerpo" section stay in sync.
export const WEIGHT_LIMIT = { maxIntDigits: 3, maxDecimals: 3, max: 200 } // kg
export const COMP_LIMITS = {
  bodyFatPct: { maxIntDigits: 3, maxDecimals: 1, max: 100 }, // %
  muscleMassKg: { maxIntDigits: 3, maxDecimals: 3, max: 200 }, // kg
  visceralFat: { maxIntDigits: 2, maxDecimals: 0, max: 60 }, // level (integer)
  bmrKcal: { maxIntDigits: 4, maxDecimals: 0, max: 9999 }, // kcal (integer)
}
