import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import styles from './Footer.module.css';

const NAV_GROUPS = [
  {
    title: 'Product',
    links: [
      { to: '/explore', label: 'Explore' },
      { to: '/predictions', label: 'Predictions' },
      { to: '/trends', label: 'Trends' },
    ],
  },
  {
    title: 'Principles',
    links: [
      { to: '/about', label: 'Philosophy' },
      { to: '/about#methodology', label: 'Methodology' },
      { to: '/about#limitations', label: 'Limitations' },
    ],
  },
  {
    title: 'The record',
    links: [
      { to: '/predictions?status=open', label: 'Open predictions' },
      { to: '/predictions?status=resolved', label: 'Resolved' },
      { to: '/predictions?status=annulled', label: 'Annulled' },
    ],
  },
];

export function Footer() {
  const year = new Date().getUTCFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.rule} aria-hidden="true" />
      <div className={styles.inner}>
        <div className={styles.brandColumn}>
          <p className={styles.brand}>THE ORACLE</p>
          <p className={styles.tagline}>See what&apos;s coming.</p>
          <p className={styles.statement}>
            A structured architecture for verifiable future questions and
            auditable public records.
          </p>
          <Link to="/explore" className={styles.cta}>
            Ask a question
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>

        <div className={styles.linkColumns}>
          {NAV_GROUPS.map((group) => (
            <nav key={group.title} className={styles.column} aria-label={group.title}>
              <p className={styles.columnTitle}>{group.title}</p>
              <ul className={styles.linkList}>
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to} className={styles.link}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className={styles.bottom}>
        <p className={styles.fine}>
          © {year} THE ORACLE. Architecture and protocol for structured future
          questions and verifiable public records.
        </p>
        <p className={styles.fine}>
          Platform in active development — designed for proposition formalization
          and cryptographic payload verification.
        </p>
      </div>
    </footer>
  );
}
