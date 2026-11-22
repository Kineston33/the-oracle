import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

/**
 * End-to-end journeys through the real component tree. These assert the product
 * story holds together, not just that individual components render.
 */

function launch(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('journey: visitor asks a question', () => {
  it('reads the question, saves a draft, and reopens it from the notebook', async () => {
    const user = userEvent.setup();
    launch('/');

    const question = 'Will annual global EV sales exceed 30 million before 2030?';
    await user.type(screen.getByLabelText(/your question/i), question);
    await user.click(screen.getByRole('button', { name: /consult the oracle/i }));

    // The reading panel appears and echoes the question verbatim.
    expect(
      await screen.findByRole('heading', { name: /what your question contains/i }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(question).length).toBeGreaterThan(0);

    // It finds the related archive record rather than inventing an answer.
    const related = await screen.findByRole('link', {
      name: /annual global sales of battery-electric/i,
    });
    expect(related).toBeInTheDocument();

    // Saving puts the question in the notebook.
    await user.click(screen.getByRole('button', { name: /save this draft/i }));
    expect(await screen.findByRole('button', { name: /saved to your notebook/i })).toBeInTheDocument();

    const notebook = screen.getByRole('complementary');
    expect(
      within(notebook).getAllByRole('button', { name: new RegExp(question.slice(0, 30)) }).length,
    ).toBeGreaterThan(0);
  });

  it('shows the resolution checklist so the visitor learns what a question needs', async () => {
    launch('/explore?q=Will%20fusion%20power%20reach%20the%20grid%20by%202035%3F');
    await screen.findByRole('heading', { name: /what your question contains/i }, { timeout: 3000 });

    expect(screen.getByRole('heading', { name: /resolution checklist/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /draft canonical form/i })).toBeInTheDocument();
    expect(screen.getByText(/31 December 2035/)).toBeInTheDocument();
  });
});

describe('journey: reading the archive', () => {
  it('filters to resolved records, opens one, and sees probability beside outcome', async () => {
    const user = userEvent.setup();
    launch('/predictions');

    const statusSelect = await screen.findByLabelText(/^status$/i, {}, { timeout: 3000 });
    await user.selectOptions(statusSelect, 'resolved');

    // Only resolved records remain.
    expect(screen.getByText(/2 of 10 records/i)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /mauna loa co₂ above 430 ppm/i }));

    expect(await screen.findByRole('heading', { level: 1, name: /mauna loa/i })).toBeInTheDocument();
    // The original probability survives the resolution.
    expect(screen.getAllByText('71%').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /^resolution$/i })).toBeInTheDocument();
    // The payload, the link and the chain all verify for this record.
    await screen.findByText(/reproduces the digest the record declares/i, {}, { timeout: 3000 });
    const panel = screen.getByRole('region', { name: /integrity record/i });
    const text = panel.textContent ?? '';
    expect(text).toMatch(/Sealed payload verified/);
    expect(text).toMatch(/Event chain verified/);
  });

  it('tells a visitor plainly when a record is illustrative', async () => {
    launch('/predictions/ORC-2025-0002');
    await screen.findByRole('heading', { level: 1, name: /frontier training run/i });

    expect(screen.getAllByText(/illustrative record/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/fabricated to demonstrate the archive/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no external link/i).length).toBeGreaterThan(0);
  });
});

describe('journey: verifying a record', () => {
  it('explains the limits of the digest while confirming it matches', async () => {
    launch('/predictions/ORC-2025-0004');
    await screen.findByRole('heading', { level: 1, name: /lunar south pole/i });

    // Verification is reported per layer, never as one undifferentiated pass.
    await screen.findByText(/reproduces the digest the record declares/i, {}, { timeout: 3000 });
    const panel = screen.getByRole('region', { name: /integrity record/i });
    const text = panel.textContent ?? '';
    expect(text).toMatch(/Sealed payload verified/);
    expect(text).toMatch(/Publication event verified/);
    expect(text).toMatch(/Event chain verified/);

    // The panel must not overclaim: it says what the digest does not prove.
    // Point 2: the digest shows consistency, never when it existed.
    expect(text).toMatch(/reproduces the digest declared in the record/i);
    expect(text).toMatch(/does not show when that digest came to exist/i);
    expect(text).toMatch(/proves the forecast was correct/i);
    expect(text).toMatch(/no external witness or transparency log has countersigned/i);
    // And it names which payload definition the digest actually covers.
    expect(text).toMatch(/whole record, outcome included/i);
    // Consistency is explicitly distinguished from third-party attestation.
    expect(text).toMatch(/not third-party attestation/i);
  });
});

describe('journey: exploring trends', () => {
  it('narrows the index and keeps the illustrative warning visible', async () => {
    const user = userEvent.setup();
    launch('/trends');

    expect(await screen.findByText(/these numbers are not measurements/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^climate\s*\d+$/i }));
    expect(screen.getByText(/of 9 signals/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^velocity$/i }));
    expect(screen.getByRole('button', { name: /^velocity$/i })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('journey: understanding the product', () => {
  it('lets a sceptical reader find the limitations from the homepage', async () => {
    const user = userEvent.setup();
    launch('/');

    await user.click(screen.getByRole('link', { name: /read the full methodology/i }));

    expect(
      await screen.findByRole('heading', { level: 1, name: /a forecast is only worth something/i }),
    ).toBeInTheDocument();

    // The in-page navigation reaches the limitations section.
    expect(screen.getAllByRole('link', { name: /limitations/i })[0]).toHaveAttribute(
      'href',
      '#limitations',
    );
    expect(
      screen.getByRole('heading', { name: /six things this product cannot do/i }),
    ).toBeInTheDocument();
  });
});
