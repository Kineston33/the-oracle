import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import { detectCategory, detectHorizonYear, normalizeQuestion } from '@/lib/question';
import { CATEGORY_LABELS } from '@/data/records';
import styles from './QuestionComposer.module.css';

interface QuestionComposerProps {
  initialValue?: string;
  /** Called instead of navigating, when the host wants to own submission. */
  onSubmit?: (question: string) => void;
  autoFocus?: boolean;
  variant?: 'hero' | 'page';
  id?: string;
}

const MAX_LENGTH = 220;
const MIN_LENGTH = 12;

export function QuestionComposer({
  initialValue = '',
  onSubmit,
  autoFocus = false,
  variant = 'hero',
  id,
}: QuestionComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const generatedId = useId();
  const inputId = id ?? `question-${generatedId}`;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;
  const navigate = useNavigate();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const trimmed = value.trim();
  const normalized = normalizeQuestion(trimmed);
  const detected = trimmed.length > MIN_LENGTH - 1 ? detectCategory(normalized.split(/\s+/)) : { category: null };
  const horizon = trimmed.length > 0 ? detectHorizonYear(normalized) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = value.trim().replace(/\s+/g, ' ');

    if (question.length < MIN_LENGTH) {
      setError('A usable question needs at least a dozen characters. Try naming the subject and the outcome.');
      inputRef.current?.focus();
      return;
    }

    setError(null);

    if (onSubmit) {
      onSubmit(question);
      return;
    }

    const params = new URLSearchParams({ q: question });
    navigate(`/explore?${params.toString()}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  const handleChange = (next: string) => {
    setValue(next.slice(0, MAX_LENGTH));
    if (error) setError(null);
  };

  return (
    <form
      ref={formRef}
      className={[styles.form, styles[variant]].join(' ')}
      onSubmit={submit}
      noValidate
      role="search"
      aria-label="Ask the Oracle a question"
    >
      <div className={[styles.field, error ? styles.fieldError : ''].filter(Boolean).join(' ')}>
        <label htmlFor={inputId} className={styles.label}>
          Your question
        </label>

        <div className={styles.inputRow}>
          <span className={styles.promptGlyph} aria-hidden="true">
            ?
          </span>
          <textarea
            id={inputId}
            ref={inputRef}
            className={styles.input}
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask what happens next…"
            rows={1}
            maxLength={MAX_LENGTH}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={[helperId, error ? errorId : ''].filter(Boolean).join(' ')}
          />
          <button type="submit" className={styles.submit} aria-label="Consult the Oracle about this question">
            <span className={styles.submitLabel}>Consult</span>
            <span className={styles.submitIcon}>
              <ArrowUp size={16} aria-hidden="true" strokeWidth={2.1} />
            </span>
          </button>
        </div>

        <div className={styles.footer}>
          <p id={helperId} className={styles.helper}>
            {detected.category || horizon ? (
              <>
                <span className={styles.readoutChip}>
                  {detected.category ? CATEGORY_LABELS[detected.category] : 'Unclassified'}
                </span>
                <span className={styles.readoutChip}>
                  {horizon ? `Horizon ${horizon}` : 'No horizon found'}
                </span>
                <span className={styles.helperText}>Detected locally, in your browser.</span>
              </>
            ) : (
              <span className={styles.helperText}>
                Questions are read locally. Nothing leaves your browser.
              </span>
            )}
          </p>
          <span className={styles.counter} aria-hidden="true">
            {value.length}/{MAX_LENGTH}
          </span>
        </div>

        {error ? (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
