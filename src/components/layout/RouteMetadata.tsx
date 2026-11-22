import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { findRecord } from '@/data/records';

/**
 * Per-route document metadata.
 *
 * The app is a single-page shell, so without this every route shares the title
 * declared in index.html — which makes a browser full of tabs unreadable and
 * leaves shared links without context. Titles and descriptions are derived from
 * the same route table the UI uses, so they cannot drift out of sync.
 *
 * The canonical URL is rewritten rather than duplicated: index.html declares one
 * so a static crawl still has a value, and this keeps it pointed at the route
 * the visitor is actually on.
 */

const SITE = 'THE ORACLE';
const SUFFIX = "See what's coming.";

/** Origin used for canonical and social URLs. Placeholder until launch. */
const ORIGIN = 'https://the-oracle.example';

interface Meta {
  title: string;
  description: string;
}

const STATIC_META: Record<string, Meta> = {
  '/': {
    title: `${SITE} — ${SUFFIX}`,
    description:
      "A public archive of official predictions. Explore the future, discover emerging signals, and read the record of what was forecast and what happened.",
  },
  '/explore': {
    title: `Explore a question — ${SITE}`,
    description:
      'Write a question about the future and see how it reads: matched vocabulary, a resolution checklist, and a draft canonical form. No forecast is produced.',
  },
  '/predictions': {
    title: `The prediction archive — ${SITE}`,
    description:
      'Every official prediction, on the record. Filter the archive by status, category or search, and read each one with its published probability intact.',
  },
  '/trends': {
    title: `Emerging signals — ${SITE}`,
    description:
      'Signals that are moving before the consensus catches up, with direction, velocity and the evidence behind each one.',
  },
  '/about': {
    title: `Method and limitations — ${SITE}`,
    description:
      'How THE ORACLE works, what it refuses to claim, and the limitations that stay published alongside the record.',
  },
};

const NOT_FOUND_META: Meta = {
  title: `Page not found — ${SITE}`,
  description: 'This path has no record. Return to the archive or ask a question.',
};

function metaFor(pathname: string): Meta {
  // The record id is read from the path rather than useParams, because this
  // component renders beside <Routes> rather than inside a matched route.
  const recordMatch = /^\/predictions\/([^/]+)\/?$/.exec(pathname);
  if (recordMatch) {
    const record = findRecord(decodeURIComponent(recordMatch[1]));
    if (record) {
      return {
        // Includes the record id: a tab or a shared link should identify which
        // revision of which question it points at, not just the headline.
        title: `${record.id} — ${record.title} · ${SITE}`,
        description: `Published ${record.publishedAt.slice(0, 10)} at ${Math.round(
          record.probability * 100,
        )}%. Status: ${record.status}. Read the question, its resolution criteria and the evidence it was sealed with.`,
      };
    }
    return NOT_FOUND_META;
  }

  return STATIC_META[pathname] ?? NOT_FOUND_META;
}

function setMeta(selector: string, attribute: 'name' | 'property', key: string, value: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', value);
}

export function RouteMetadata() {
  const { pathname } = useLocation();

  useEffect(() => {
    const { title, description } = metaFor(pathname);
    const url = `${ORIGIN}${pathname}`;

    document.title = title;

    setMeta('meta[name="description"]', 'name', 'description', description);
    setMeta('meta[property="og:title"]', 'property', 'og:title', title);
    setMeta('meta[property="og:description"]', 'property', 'og:description', description);
    setMeta('meta[property="og:url"]', 'property', 'og:url', url);
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }, [pathname]);

  return null;
}
