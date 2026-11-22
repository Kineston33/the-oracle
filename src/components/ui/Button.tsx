import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet';
type Size = 'sm' | 'md' | 'lg';

interface Shared {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconPosition?: 'leading' | 'trailing';
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

function classes({ variant = 'primary', size = 'md', fullWidth, className }: Shared): string {
  return [styles.button, styles[variant], styles[size], fullWidth ? styles.full : '', className]
    .filter(Boolean)
    .join(' ');
}

function Content({ icon, iconPosition = 'trailing', children }: Pick<Shared, 'icon' | 'iconPosition' | 'children'>) {
  return (
    <>
      {icon && iconPosition === 'leading' ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.label}>{children}</span>
      {icon && iconPosition === 'trailing' ? <span className={styles.icon}>{icon}</span> : null}
    </>
  );
}

export function Button({
  variant,
  size,
  icon,
  iconPosition = 'trailing',
  fullWidth,
  className,
  children,
  type = 'button',
  ...rest
}: Shared & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={classes({ variant, size, fullWidth, className, children })}
      {...rest}
    >
      <Content icon={icon} iconPosition={iconPosition}>
        {children}
      </Content>
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  icon,
  iconPosition = 'trailing',
  fullWidth,
  className,
  children,
  ...rest
}: Shared & LinkProps) {
  return (
    <Link className={classes({ variant, size, fullWidth, className, children })} {...rest}>
      <Content icon={icon} iconPosition={iconPosition}>
        {children}
      </Content>
    </Link>
  );
}
