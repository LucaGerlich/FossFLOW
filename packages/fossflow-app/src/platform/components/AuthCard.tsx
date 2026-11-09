import type { ReactNode } from 'react';

interface AuthCardProps {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}

/** Centred card for setup, sign-in, invitation and reset screens. */
export function AuthCard({ title, intro, children }: AuthCardProps) {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card__brand">FossFLOW</div>
        <h1 id="auth-title" className="auth-card__title">
          {title}
        </h1>
        {intro && <p className="auth-card__intro">{intro}</p>}
        {children}
      </section>
    </main>
  );
}

interface FieldProps {
  label: string;
  name: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
  autoFocus?: boolean;
}

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  value,
  onChange,
  hint,
  required = true,
  autoFocus
}: FieldProps) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        required={required}
        autoFocus={autoFocus}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert">
      {message}
    </p>
  );
}
