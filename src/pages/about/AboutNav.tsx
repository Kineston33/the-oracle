import styles from './AboutNav.module.css';

export interface AboutSection {
  id: string;
  label: string;
}

export const ABOUT_SECTIONS: AboutSection[] = [
  { id: 'philosophy', label: 'Philosophy' },
  { id: 'methodology', label: 'Methodology' },
  { id: 'transparency', label: 'Transparency' },
  { id: 'limitations', label: 'Limitations' },
  { id: 'roadmap', label: 'Roadmap' },
];

export function AboutNav({ active }: { active: string }) {
  return (
    <nav className={styles.nav} aria-label="On this page">
      <p className={styles.navLabel}>On this page</p>
      <ul className={styles.navList}>
        {ABOUT_SECTIONS.map((section, index) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={[styles.navLink, active === section.id ? styles.active : '']
                .filter(Boolean)
                .join(' ')}
              aria-current={active === section.id ? 'true' : undefined}
            >
              <span className={styles.navIndex}>{String(index + 1).padStart(2, '0')}</span>
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
