import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext.jsx'
import { checkPassword, isValidEmail } from '../lib/validation'

const PW_RULE_KEYS = {
  length: 'login.pwLength',
  upper: 'login.pwUpper',
  lower: 'login.pwLower',
  number: 'login.pwNumber',
  special: 'login.pwSpecial',
}

export default function Login() {
  const { t } = useTranslation()
  const { signInWithGoogle, signInWithEmail, registerWithEmail, error, clearError } = useAuth()

  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [touched, setTouched] = useState(false)

  const isRegister = mode === 'register'
  const pw = checkPassword(password)
  const emailOk = isValidEmail(email)
  const canSubmit = isRegister
    ? emailOk && pw.valid && name.trim().length > 0
    : emailOk && password.length > 0

  function switchMode(next) {
    setMode(next)
    setTouched(false)
    clearError()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setSubmitting(true)
    if (isRegister) {
      await registerWithEmail(email.trim(), password, name.trim())
    } else {
      await signInWithEmail(email.trim(), password)
    }
    setSubmitting(false)
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-5">
      {/* Scanline overlay */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-40">
        <div className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-brand-500/10 to-transparent animate-scan" />
      </div>

      <div className="relative w-full max-w-sm rounded-2xl border border-brand-500/30 bg-ink-850/80 p-8 shadow-neon-soft backdrop-blur-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <h1 className="brand-font animate-flicker text-6xl text-brand-300">Vortx</h1>
          <p className="mt-2 font-mono text-xs uppercase tracking-widest text-neon-pink">
            {t('login.tagline')}
          </p>
        </div>

        {/* Mode tabs */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-brand-500/20 bg-ink-900/60 p-1">
          <TabButton active={!isRegister} onClick={() => switchMode('login')}>
            {t('login.tabLogin')}
          </TabButton>
          <TabButton active={isRegister} onClick={() => switchMode('register')}>
            {t('login.tabRegister')}
          </TabButton>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          {isRegister && (
            <div>
              <label className="label mb-1.5">{t('login.name')}</label>
              <input
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('login.namePlaceholder')}
                className="input"
                autoComplete="name"
              />
            </div>
          )}

          <div>
            <label className="label mb-1.5">{t('login.email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tucorreo@ejemplo.com"
              className="input"
              autoComplete="email"
            />
            {touched && !emailOk && (
              <p className="mt-1 text-xs text-neon-red">{t('login.emailInvalid')}</p>
            )}
          </div>

          <div>
            <label className="label mb-1.5">{t('login.password')}</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input pr-10"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-brand-300"
                title={showPassword ? t('login.hide') : t('login.show')}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>

            {/* Password requirements (only when registering) */}
            {isRegister && password.length > 0 && (
              <ul className="mt-2 grid grid-cols-1 gap-1">
                {pw.results.map((r) => (
                  <li
                    key={r.key}
                    className={`flex items-center gap-1.5 text-xs ${r.ok ? 'text-brand-300' : 'text-slate-500'}`}
                  >
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${r.ok ? 'bg-brand-400 shadow-[0_0_6px_rgba(0,240,255,0.8)]' : 'bg-slate-600'}`} />
                    {t(PW_RULE_KEYS[r.key])}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-neon-red/40 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? t('login.processing') : isRegister ? t('login.createAccount') : t('login.enter')}
          </button>
        </form>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-brand-500/20" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{t('login.or')}</span>
          <span className="h-px flex-1 bg-brand-500/20" />
        </div>

        <button
          onClick={signInWithGoogle}
          className="btn w-full border border-brand-400/50 bg-ink-900/80 text-slate-100 hover:bg-ink-800 hover:shadow-neon"
        >
          <GoogleIcon />
          {t('login.continueGoogle')}
        </button>

        <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-widest text-slate-500">
          {t('login.dataEncrypted')}
        </p>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg py-2 text-sm font-semibold uppercase tracking-wide transition ${
        active ? 'bg-brand-500/15 text-brand-300 neon-text' : 'text-slate-400 hover:text-brand-200'
      }`}
    >
      {children}
    </button>
  )
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.4 36 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.4 4.3M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.3-.6" />
    </svg>
  )
}
