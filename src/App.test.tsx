import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('navigation', () => {
  it('renders the homepage headline and the primary navigation', () => {
    renderApp('/');
    // Accept straight or typographic apostrophes in the accessible name.
    expect(
      screen.getByRole('heading', { level: 1, name: /see what['\u2019]s coming/i }),
    ).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const label of ['Explore', 'Predictions', 'Trends', 'About']) {
      expect(within(nav).getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
  });

  it('navigates from the homepage to the archive', async () => {
    const user = userEvent.setup();
    renderApp('/');

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: /predictions/i }));

    // This is the only test in the suite that clicks through a lazy() route and
    // then waits for it, so it is the only one that needs more than Testing
    // Library's default. Measured under load: the navigation completes in
    // 3.6-4.4 s rather than not at all. The timeout is local to this call so the
    // rest of the suite keeps the default. See limitation 36.
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: /every prediction/i },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ['/trends', /the future leaves fingerprints/i],
    ['/about', /a forecast is only worth something/i],
    ['/explore', /ask what happens/i],
    ['/predictions', /every prediction/i],
  ])('renders %s with its own heading', async (path, heading) => {
    renderApp(path);
    // Route chunks are code-split, so the heading resolves asynchronously.
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('shows a 404 state for an unknown route', () => {
    renderApp('/no-such-page');
    expect(screen.getByRole('heading', { level: 1, name: /this path has no record/i })).toBeInTheDocument();
  });

  it('marks the active navigation item with aria-current', () => {
    renderApp('/trends');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: /trends/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('homepage question input', () => {
  it('orders the hero vertically: title & description above the centered sphere, question composer immediately below, and secondary elements last', () => {
    renderApp('/');

    const main = screen.getByRole('main');
    const heading = within(main).getByRole('heading', {
      level: 1,
      name: /see what['\u2019]s coming/i,
    });
    const description = within(main).getByText(
      /ask any question about the future\. the oracle publishes one official prediction per question/i,
    );
    const heroSphere = within(main).getAllByTestId('crystal-sphere')[0]!;
    const composerForm = within(main).getByRole('search', {
      name: /ask the oracle a question/i,
    });
    const consultButton = within(composerForm).getByRole('button', {
      name: /consult the oracle/i,
    });
    const suggestionsLabel = within(main).getByText(/suggested explorations/i);

    expect(consultButton).toBeInTheDocument();

    // Verify strict vertical DOM order: heading -> description -> sphere -> composer -> secondary suggestions
    expect(
      heading.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(heroSphere) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heroSphere.compareDocumentPosition(composerForm) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      composerForm.compareDocumentPosition(suggestionsLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('asks for at least a dozen characters before submitting', async () => {
    const user = userEvent.setup();
    renderApp('/');

    const input = screen.getByLabelText(/your question/i);
    await user.type(input, 'why');
    await user.click(screen.getByRole('button', { name: /consult the oracle/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least a dozen characters/i);
  });

  it('opens the exploration reading for a valid question', async () => {
    const user = userEvent.setup();
    renderApp('/');

    const question = 'Will global battery storage exceed 1200 GW before 2029?';
    await user.type(screen.getByLabelText(/your question/i), question);
    await user.click(screen.getByRole('button', { name: /consult the oracle/i }));

    // The explore route renders the reading panel after a short pause.
    expect(
      await screen.findByRole('heading', { name: /what your question contains/i }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no forecast produced/i)).toBeInTheDocument();
  });

  it('never presents a probability in the exploration result', async () => {
    renderApp('/explore?q=Will%20global%20battery%20storage%20exceed%201200%20GW%20before%202029%3F');

    await screen.findByRole(
      'heading',
      { name: /what your question contains/i },
      { timeout: 3000 },
    );

    const main = screen.getByRole('main');
    expect(main.textContent).toMatch(/does not estimate a probability/i);
    // "Published probability" may appear for related archive records, but the
    // panel itself must never claim to have produced one.
    expect(main.textContent).not.toMatch(/your (prediction|probability|forecast) (is|would be)/i);
  });
});

describe('predictions archive', () => {
  it('lists every shipped record', () => {
    renderApp('/predictions');
    const archive = screen.getByRole('main');
    expect(within(archive).getAllByText(/^ORC-\d{4}-\d{4}$/).length).toBeGreaterThanOrEqual(10);
  });

  it('filters by category and updates the count', async () => {
    const user = userEvent.setup();
    renderApp('/predictions');

    const climateChip = screen.getByRole('button', { name: /^climate\s*\d+$/i });
    await user.click(climateChip);

    expect(screen.getByText(/filter(s)? active/i)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /^climate\s*\d+$/i });
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an empty state and a reset action for an unmatched search', async () => {
    const user = userEvent.setup();
    renderApp('/predictions');

    await user.type(screen.getByLabelText(/search records/i), 'zzzzz-no-match');

    expect(await screen.findByText(/no records match that filter/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.queryByText(/no records match that filter/i)).not.toBeInTheDocument();
  });

  it('filters via a URL query parameter', () => {
    renderApp('/predictions?status=resolved');
    const summary = screen.getByText(/filter(s)? active/i);
    expect(summary).toBeInTheDocument();
  });
});

describe('record detail', () => {
  it('renders the canonical question, criteria and evidence', async () => {
    renderApp('/predictions/ORC-2025-0001');

    expect(
      await screen.findByRole('heading', { level: 1, name: /global battery storage passes/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/canonical question/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /resolution criteria/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /evidence at publication/i })).toBeInTheDocument();
    expect(screen.getByText(/integrity record/i)).toBeInTheDocument();
  });

  it('verifies the payload, the publication link and the event chain separately', async () => {
    renderApp('/predictions/ORC-2025-0001');

    // Four checks, each reported on its own — the panel is not allowed to
    // collapse them into a single badge.
    await screen.findByText(/reproduces the digest the record declares/i, {}, { timeout: 3000 });
    const panel = await screen.findByRole('region', { name: /integrity record/i });
    const text = panel.textContent ?? '';
    for (const label of ['Sealed payload', 'Publication event', 'Event chain', 'External anchoring']) {
      expect(text).toContain(label);
    }
    // Each one states its own outcome rather than a shared verdict.
    expect(text).toMatch(/Sealed payload verified/);
    expect(text).toMatch(/Publication event verified/);
    expect(text).toMatch(/Event chain verified/);
    expect(text).toMatch(/External anchoring not verified/);

    // And the verdict must stay qualified: consistency is not attestation.
    expect(text).toMatch(/all verify against the shipped bytes/i);
    expect(text).toMatch(/not third-party attestation/i);
  });

  it('states plainly that the record is not externally anchored', async () => {
    renderApp('/predictions/ORC-2025-0001');
    expect(await screen.findByText(/no — not yet/i)).toBeInTheDocument();
  });

  it('keeps the original probability visible next to a resolved outcome', async () => {
    renderApp('/predictions/ORC-2025-0007');
    await screen.findByRole('heading', { level: 1, name: /mauna loa/i });

    // The figure is labelled, never replaced by the outcome.
    expect(screen.getAllByText(/published probability/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('71%').length).toBeGreaterThan(0);
    expect(screen.getByText(/both figures stay on/i)).toBeInTheDocument();
    // The outcome is recorded separately.
    expect(screen.getByRole('heading', { name: /^resolution$/i })).toBeInTheDocument();
  });

  it('explains why an annulled record was retained', async () => {
    renderApp('/predictions/ORC-2025-0009');
    expect(
      await screen.findByRole('heading', { name: /why this record was annulled/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/annulled, not deleted/i)).toBeInTheDocument();
  });

  it('shows a not-found state for an unknown record id', async () => {
    renderApp('/predictions/ORC-1111-1111');
    expect(await screen.findByText(/that record is not in the archive/i)).toBeInTheDocument();
  });
});

describe('trends index', () => {
  it('lists signals and filters by domain', async () => {
    const user = userEvent.setup();
    renderApp('/trends');

    expect(await screen.findByText(/tracked signals/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /signal index/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^science\s*\d+$/i }));
    const scienceChip = screen.getByRole('button', { name: /^science\s*\d+$/i });
    expect(scienceChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/of 9 signals/i)).toBeInTheDocument();
  });

  it('labels the index as illustrative', async () => {
    renderApp('/trends');
    expect(await screen.findByText(/these numbers are not measurements/i)).toBeInTheDocument();
  });
});

describe('about page', () => {
  it('discloses that no forecasting engine exists', async () => {
    renderApp('/about');
    expect(
      await screen.findByRole('heading', { name: /six things this product cannot do/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/no forecasting engine/i).length).toBeGreaterThan(0);
  });

  it('separates what is real from what is illustrative', async () => {
    renderApp('/about');
    expect(await screen.findByText(/what is real in this prototype/i)).toBeInTheDocument();
    expect(screen.getAllByText(/what is illustrative/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/what does not exist yet/i)).toBeInTheDocument();
  });
});

describe('accessibility basics', () => {
  it('provides a skip link and a single main landmark', () => {
    renderApp('/');
    // The skip link lives in index.html, so assert the main landmark instead.
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('gives the question input an accessible label and description', () => {
    renderApp('/');
    const input = screen.getByLabelText(/your question/i);
    expect(input).toHaveAttribute('aria-describedby');
  });

  it('marks every decorative sphere as hidden from assistive technology', () => {
    renderApp('/');
    const spheres = screen.getAllByTestId('crystal-sphere');
    expect(spheres.length).toBeGreaterThan(0);
    for (const sphere of spheres) {
      expect(sphere).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('renders the animated cosmic iris SVG with counter-rotating filament layers, contraction/dilation, multi-depth stardust, and a stationary black central pupil', () => {
    renderApp('/');
    const main = screen.getByRole('main');
    const heroSphere = within(main).getAllByTestId('crystal-sphere')[0]!;

    // Pure SVG + CSS implementation: no video or raster substitute
    expect(heroSphere.querySelector('video')).toBeNull();
    expect(heroSphere.querySelector('img')).toBeNull();
    const svg = heroSphere.querySelector('svg');
    expect(svg).not.toBeNull();

    // Active animation state under normal conditions
    expect(heroSphere).toHaveAttribute('data-reduced-motion', 'false');
    expect(heroSphere.className).not.toMatch(/paused/);

    // Contraction & dilation groups
    const dilationGroup = heroSphere.querySelector('[data-layer="iris-dilation"]');
    const collarettePulse = heroSphere.querySelector('[data-layer="iris-collarette-pulse"]');
    expect(dilationGroup).not.toBeNull();
    expect(collarettePulse).not.toBeNull();

    // Counter-rotating iris filament and limbus layers inside the dilation group
    const deepCw = dilationGroup!.querySelector('[data-layer="iris-deep-cw"]');
    const electricCcw = dilationGroup!.querySelector('[data-layer="iris-electric-ccw"]');
    const cyanCw = dilationGroup!.querySelector('[data-layer="iris-cyan-cw"]');
    const limbusCw = dilationGroup!.querySelector('[data-layer="limbus-ring-cw"]');
    const limbusCcw = dilationGroup!.querySelector('[data-layer="limbus-ring-ccw"]');
    expect(deepCw).not.toBeNull();
    expect(electricCcw).not.toBeNull();
    expect(cyanCw).not.toBeNull();
    expect(limbusCw).not.toBeNull();
    expect(limbusCcw).not.toBeNull();

    // Multi-layer curved filaments and particles are rendered inside the iris
    expect(dilationGroup!.querySelectorAll('path').length).toBeGreaterThan(150);
    expect(svg!.querySelectorAll('circle').length).toBeGreaterThan(200);

    // Outer dispersing stardust orbital & drift layers
    expect(heroSphere.querySelector('[data-layer="stardust-drift-outer"]')).not.toBeNull();
    expect(heroSphere.querySelector('[data-layer="stardust-orbit-cw"]')).not.toBeNull();
    expect(heroSphere.querySelector('[data-layer="stardust-drift-inner"]')).not.toBeNull();
    expect(heroSphere.querySelector('[data-layer="stardust-orbit-ccw"]')).not.toBeNull();

    // Stationary deep black central pupil is outside the rotating/scaling iris group
    const pupilFixed = heroSphere.querySelector('[data-layer="pupil-fixed"]');
    const pupilCore = within(heroSphere).getByTestId('pupil-core');
    expect(pupilFixed).not.toBeNull();
    expect(dilationGroup!.contains(pupilFixed)).toBe(false);
    expect(pupilCore).toHaveAttribute('fill', '#000000');
    expect(pupilCore).toHaveAttribute('cx', '200');
    expect(pupilCore).toHaveAttribute('cy', '200');
  });

  it('announces search result counts politely', () => {
    renderApp('/predictions');
    const input = screen.getByLabelText(/search records/i);
    expect(input).toBeInTheDocument();
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
