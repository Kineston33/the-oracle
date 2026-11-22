import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { CrystalSphere } from '@/components/oracle/CrystalSphere';
import styles from './NavBar.module.css';

export interface NavItem {
  to: string;
  label: string;
  index: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/explore', label: 'Explore', index: '01' },
  { to: '/predictions', label: 'Predictions', index: '02' },
  { to: '/trends', label: 'Trends', index: '03' },
  { to: '/about', label: 'About', index: '04' },
];

export function NavBar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuId = useId();
  const location = useLocation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Condense the bar once the page has moved.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Body scroll lock + Escape + focus trap while the mobile panel is open.
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
    }, 40);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open]);

  // Close the panel if the viewport grows past the mobile breakpoint.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 921px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return (
    <header className={[styles.header, scrolled ? styles.scrolled : ''].filter(Boolean).join(' ')}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand} aria-label="THE ORACLE — home">
          <span className={styles.mark}>
            <CrystalSphere size="compact" />
          </span>
          <span className={styles.wordmark}>
            <span className={styles.wordmarkMain}>THE ORACLE</span>
            <span className={styles.wordmarkSub}>Forecasting intelligence</span>
          </span>
        </Link>

        <nav className={styles.desktopNav} aria-label="Primary">
          <ul className={styles.navList}>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    [styles.navLink, isActive ? styles.active : ''].filter(Boolean).join(' ')
                  }
                >
                  <span className={styles.navIndex} aria-hidden="true">
                    {item.index}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.actions}>
          <Link to="/predictions" className={styles.archiveLink}>
            <span className={styles.archiveDot} aria-hidden="true" />
            Public archive
          </Link>
          <button
            ref={buttonRef}
            type="button"
            className={styles.menuButton}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div
        id={menuId}
        ref={panelRef}
        className={[styles.panel, open ? styles.panelOpen : ''].filter(Boolean).join(' ')}
        hidden={!open}
      >
        <nav aria-label="Mobile primary">
          <ul className={styles.panelList}>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    [styles.panelLink, isActive ? styles.panelLinkActive : '']
                      .filter(Boolean)
                      .join(' ')
                  }
                >
                  <span className={styles.panelIndex} aria-hidden="true">
                    {item.index}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.panelFooter}>
          <p className={styles.panelNotice}>
            Illustrative archive. No official predictions have been published yet.
          </p>
        </div>
      </div>
      {open ? (
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close navigation menu"
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />
      ) : null}
    </header>
  );
}
