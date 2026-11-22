import { cloneElement, isValidElement, useId, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  busy?: boolean;
  small?: boolean;
}

export function Button({ variant = 'secondary', icon, busy = false, small = false, className = '', children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn--${variant}${small ? ' btn--sm' : ''}${busy ? ' is-busy' : ''} ${className}`.trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = 'secondary', icon, small = false, className = '', children, ...rest }: LinkProps & { variant?: Variant; icon?: IconName; small?: boolean }) {
  return (
    <Link className={`btn btn--${variant}${small ? ' btn--sm' : ''} ${className}`.trim()} {...rest}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Link>
  );
}

interface FieldProps {
  label: ReactNode;
  /** Keep the label for assistive tech but do not show it (when the surrounding text already names the field). */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
}

/** Labelled form control. The child receives id, aria-describedby and aria-invalid. */
export function Field({ label, hideLabel = false, hint, error, children, className = '' }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })
    : children;
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id} className={`field__label${hideLabel ? ' visually-hidden' : ''}`}>
        {label}
      </label>
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {control}
      {error && (
        <p id={errId} className="field__error" role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  );
}

interface Option<V extends string> {
  value: V;
  label: ReactNode;
  count?: number;
  icon?: IconName;
}

interface GroupProps<V extends string> {
  label: string;
  value: V;
  options: Option<V>[];
  onChange: (v: V) => void;
  className?: string;
  /** On phones, keep the chips in one row that scrolls sideways inside its own box (never the page). */
  scroll?: boolean;
}

/** Single-choice view switcher (e.g. Plan views). A group of toggle buttons with aria-pressed. */
export function SegmentedControl<V extends string>({ label, value, options, onChange, className = '' }: GroupProps<V>) {
  return (
    <div role="group" aria-label={label} className={`segmented ${className}`.trim()}>
      {options.map((o) => (
        <button key={o.value} type="button" className="segmented__btn" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={18} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Single-choice filter chips (e.g. Mine · <name>'s · Together). */
export function FilterChips<V extends string>({ label, value, options, onChange, className = '', scroll = false }: GroupProps<V>) {
  const chips = (
    <div role="group" aria-label={label} className={`filter-chips${scroll ? ' filter-chips--scroll' : ''} ${className}`.trim()}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="fchip"
          aria-pressed={o.value === value}
          onClick={(e) => {
            onChange(o.value);
            if (scroll) e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          }}
        >
          {o.value === value && <Icon name="check" size={14} />}
          <span>{o.label}</span>
          {o.count !== undefined && <span className="fchip__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
  return scroll ? <div className="chips-scroll">{chips}</div> : chips;
}

export function TextInput(props: React.ComponentProps<'input'>) {
  return <input {...props} className={`input ${props.className ?? ''}`.trim()} />;
}
export function TextArea(props: React.ComponentProps<'textarea'>) {
  return <textarea rows={3} {...props} className={`input input--area ${props.className ?? ''}`.trim()} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input input--select ${props.className ?? ''}`.trim()} />;
}
