import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import styles from './Field.module.css';

interface SearchFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Visually hides the label but keeps it available to screen readers. */
  hideLabel?: boolean;
  hint?: ReactNode;
  resultSummary?: ReactNode;
  className?: string;
}

export function SearchField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hideLabel,
  hint,
  resultSummary,
  className,
}: SearchFieldProps) {
  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <label className={hideLabel ? 'sr-only' : styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.control}>
        <Search className={styles.searchIcon} size={15} aria-hidden="true" strokeWidth={1.8} />
        <input
          id={id}
          type="search"
          className={styles.input}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {value ? (
          <button
            type="button"
            className={styles.clear}
            onClick={() => onChange('')}
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <div aria-live="polite" className={styles.summary}>
        {resultSummary}
      </div>
    </div>
  );
}
