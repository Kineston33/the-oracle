import { describe, expect, it, vi } from 'vitest';
import {
  CORE_SCIENTIFIC_METHOD_IDS,
  DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
  SCIENTIFIC_METHOD_REGISTRY_VERSION,
  createScientificMethodRegistry,
  isValidScientificMethodId,
  validateScientificMethodDescriptor,
  type ScientificMethodDescriptor,
} from './method-registry.ts';

describe('Stage 2A-2.1 — Scientific Method Registry (src/server/method-registry.ts)', () => {
  it('registers all 7 core scientific method identifiers in deterministic order', () => {
    expect(DEFAULT_SCIENTIFIC_METHOD_REGISTRY.version).toBe(
      SCIENTIFIC_METHOD_REGISTRY_VERSION,
    );
    expect(DEFAULT_SCIENTIFIC_METHOD_REGISTRY.size).toBe(7);
    expect(DEFAULT_SCIENTIFIC_METHOD_REGISTRY.methodIds).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
      'student-t-terminal-diffusion',
      'first-passage-barrier-diffusion',
      'structural-uniform-baseline',
    ]);
    expect(DEFAULT_SCIENTIFIC_METHOD_REGISTRY.methodIds).toEqual(
      CORE_SCIENTIFIC_METHOD_IDS,
    );

    for (const id of CORE_SCIENTIFIC_METHOD_IDS) {
      expect(DEFAULT_SCIENTIFIC_METHOD_REGISTRY.has(id)).toBe(true);
      const desc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.get(id);
      expect(desc).toBeDefined();
      expect(desc?.methodId).toBe(id);
      expect(DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(id)).toBe(desc);
    }

    expect(DEFAULT_SCIENTIFIC_METHOD_REGISTRY.has('custom:unknown-method')).toBe(false);
    expect(
      DEFAULT_SCIENTIFIC_METHOD_REGISTRY.get('custom:unknown-method'),
    ).toBeUndefined();
    expect(() =>
      DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow('custom:unknown-method'),
    ).toThrow(RangeError);
  });

  it('truthfully declares hasExecutableImplementation: false and registered-specification-only for all 7 core methods in Stage 2A-2.1', () => {
    for (const desc of DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listAll()) {
      expect(desc.hasExecutableImplementation).toBe(false);
      expect(desc.implementationStatus).toBe('registered-specification-only');
    }
  });

  it('includes complete domain, assumptions, data requirements, outcome-space compatibility, horizon, cost, epistemological, and dependence metadata on every registered descriptor', () => {
    for (const desc of DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listAll()) {
      expect(desc.name.length).toBeGreaterThan(5);
      expect(desc.summary.length).toBeGreaterThan(20);
      expect(desc.domain.applicableCategories.length).toBeGreaterThan(0);
      expect(desc.domain.applicableSubdomains.length).toBeGreaterThan(0);
      expect(desc.domain.mathematicalParadigm.length).toBeGreaterThan(10);
      expect(desc.requiredData.requiredInputChannels.length).toBeGreaterThan(0);
      expect(desc.outcomeSpaceCompatibility.supportedKinds.length).toBeGreaterThan(0);
      expect(desc.outcomeSpaceCompatibility.minOutcomes).toBeGreaterThanOrEqual(2);
      expect(desc.requiredAssumptions.length).toBeGreaterThan(0);
      expect(desc.horizonConstraints.scientificJustification.length).toBeGreaterThan(10);
      // Principle F: no arbitrary calendar horizon cutoffs on core methods
      expect(desc.horizonConstraints.constrained).toBe(false);
      expect(desc.horizonConstraints.minHorizonMs).toBeUndefined();
      expect(desc.horizonConstraints.maxHorizonMs).toBeUndefined();
      expect(desc.computationalProfile.deterministic).toBe(true);
      expect(desc.computationalProfile.maxMemoryKbEstimate).toBeGreaterThan(0);
      expect(desc.epistemologicalClaims.length).toBeGreaterThan(0);
      expect(desc.knownLimitations.length).toBeGreaterThan(0);
      expect(desc.failureConditions.length).toBeGreaterThan(0);
      expect(desc.dependenceProfile.correlationGroupId.length).toBeGreaterThan(0);
      expect(desc.dependenceProfile.independenceWarning.length).toBeGreaterThan(10);
    }
  });

  it('distinguishes structural-uniform-baseline from evidence-driven models and exposes correlated method families', () => {
    const baseline = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'structural-uniform-baseline',
    );
    expect(baseline.role).toBe('structural-symmetry-baseline');
    expect(baseline.methodFamily).toBe('structural-baseline');
    expect(
      baseline.requiredData.minimumConditions.requiresVerifiableEmpiricalEvidence,
    ).toBe(false);

    for (const id of CORE_SCIENTIFIC_METHOD_IDS) {
      if (id === 'structural-uniform-baseline') continue;
      const desc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(id);
      expect(desc.role).toBe('evidence-driven-model');
      expect(
        desc.requiredData.minimumConditions.requiresVerifiableEmpiricalEvidence,
      ).toBe(true);
    }

    // Correlated Bernoulli frequency family
    const bernoulliGroup =
      DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listByCorrelationGroup(
        'bernoulli-frequency-family',
      );
    expect(bernoulliGroup.map((d) => d.methodId)).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
    ]);

    // Correlated Ito continuous diffusion family
    const diffusionGroup =
      DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listByCorrelationGroup(
        'ito-continuous-diffusion-family',
      );
    expect(diffusionGroup.map((d) => d.methodId)).toEqual([
      'student-t-terminal-diffusion',
      'first-passage-barrier-diffusion',
    ]);

    // Filter by family and outcome-space kind
    expect(
      DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listByFamily('continuous-time-hazard').map(
        (d) => d.methodId,
      ),
    ).toEqual(['poisson-gamma-hazard']);

    expect(
      DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listByOutcomeSpaceKind(
        'first-passage-before-horizon',
      ).map((d) => d.methodId),
    ).toEqual(['first-passage-barrier-diffusion']);
  });

  it('enforces deep immutability across the registry and all nested descriptors', () => {
    expect(Object.isFrozen(DEFAULT_SCIENTIFIC_METHOD_REGISTRY)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SCIENTIFIC_METHOD_REGISTRY.methodIds)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SCIENTIFIC_METHOD_REGISTRY.descriptors)).toBe(true);

    const betaBinomial = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'beta-binomial-conjugate',
    );
    expect(Object.isFrozen(betaBinomial)).toBe(true);
    expect(Object.isFrozen(betaBinomial.domain)).toBe(true);
    expect(Object.isFrozen(betaBinomial.domain.applicableCategories)).toBe(true);
    expect(Object.isFrozen(betaBinomial.requiredData)).toBe(true);
    expect(Object.isFrozen(betaBinomial.requiredData.minimumConditions)).toBe(true);
    expect(Object.isFrozen(betaBinomial.requiredAssumptions)).toBe(true);
    expect(Object.isFrozen(betaBinomial.requiredAssumptions[0])).toBe(true);
    expect(Object.isFrozen(betaBinomial.epistemologicalClaims)).toBe(true);
    expect(Object.isFrozen(betaBinomial.dependenceProfile)).toBe(true);

    expect(() => {
      (
        DEFAULT_SCIENTIFIC_METHOD_REGISTRY.descriptors as unknown as ScientificMethodDescriptor[]
      ).push(betaBinomial);
    }).toThrow(TypeError);
    expect(() => {
      (betaBinomial as unknown as { hasExecutableImplementation: boolean })
        .hasExecutableImplementation = true;
    }).toThrow(TypeError);
    expect(() => {
      (betaBinomial.domain.applicableCategories as unknown as string[]).push('invalid');
    }).toThrow(TypeError);
  });

  it('rejects duplicate method identifiers when constructing a registry', () => {
    const all = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listAll();
    expect(() => createScientificMethodRegistry([])).toThrow(RangeError);
    expect(() =>
      createScientificMethodRegistry([all[0]!, all[1]!, all[0]!]),
    ).toThrow(RangeError);
  });

  it('validates custom descriptors and rejects invalid or dishonest descriptors', () => {
    expect(isValidScientificMethodId('beta-binomial-conjugate')).toBe(true);
    expect(isValidScientificMethodId('custom:hawkes-self-exciting')).toBe(true);
    expect(isValidScientificMethodId('custom:')).toBe(false);
    expect(isValidScientificMethodId('custom:Invalid_Upper')).toBe(false);
    expect(isValidScientificMethodId(' beta-binomial-conjugate ')).toBe(false);
    expect(isValidScientificMethodId('unknown-core-id')).toBe(false);

    const baseDesc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'poisson-gamma-hazard',
    );
    const validCustom: ScientificMethodDescriptor = validateScientificMethodDescriptor({
      ...baseDesc,
      methodId: 'custom:bounded-poisson-window',
      methodFamily: 'custom-scientific-method',
      horizonConstraints: {
        constrained: true,
        minHorizonMs: 60_000,
        maxHorizonMs: 86_400_000 * 365,
        requiresPositiveExposureRateScaling: true,
        scientificJustification:
          'Validated operating window for short-to-medium horizon inhomogeneous intensity table.',
      },
      dependenceProfile: {
        ...baseDesc.dependenceProfile,
        correlatedWithMethodIds: ['poisson-gamma-hazard'],
      },
    });
    expect(validCustom.methodId).toBe('custom:bounded-poisson-window');
    expect(validCustom.horizonConstraints.constrained).toBe(true);

    const customRegistry = createScientificMethodRegistry([baseDesc, validCustom]);
    expect(customRegistry.size).toBe(2);

    // 1. Rejects false claim that an unimplemented method has an executable implementation
    expect(() =>
      validateScientificMethodDescriptor({
        ...baseDesc,
        hasExecutableImplementation: true,
        implementationStatus: 'registered-specification-only',
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateScientificMethodDescriptor({
        ...baseDesc,
        hasExecutableImplementation: false,
        implementationStatus: 'implemented-and-verified',
      }),
    ).toThrow(RangeError);

    // 2. Rejects mismatched epistemological claim kind and tag
    expect(() =>
      validateScientificMethodDescriptor({
        ...baseDesc,
        epistemologicalClaims: [
          {
            kind: 'operational-design-heuristic',
            tag: 'IME',
            statement: 'Mismatched tag',
          },
        ],
      }),
    ).toThrow(RangeError);

    // 3. Rejects invalid horizon constraints (constrained: false with minHorizonMs, or min > max)
    expect(() =>
      validateScientificMethodDescriptor({
        ...baseDesc,
        horizonConstraints: {
          constrained: false,
          minHorizonMs: 1000,
          requiresPositiveExposureRateScaling: true,
          scientificJustification: 'Invalid',
        },
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateScientificMethodDescriptor({
        ...baseDesc,
        horizonConstraints: {
          constrained: true,
          minHorizonMs: 10_000,
          maxHorizonMs: 5_000,
          requiresPositiveExposureRateScaling: true,
          scientificJustification: 'Inverted bounds',
        },
      }),
    ).toThrow(RangeError);

    // 4. Rejects structural baseline claiming requiresVerifiableEmpiricalEvidence: true
    const baselineDesc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'structural-uniform-baseline',
    );
    expect(() =>
      validateScientificMethodDescriptor({
        ...baselineDesc,
        requiredData: {
          ...baselineDesc.requiredData,
          minimumConditions: {
            ...baselineDesc.requiredData.minimumConditions,
            requiresVerifiableEmpiricalEvidence: true,
          },
        },
      }),
    ).toThrow(RangeError);

    // 5. Rejects self-reference or unknown method ID in correlatedWithMethodIds
    expect(() =>
      validateScientificMethodDescriptor({
        ...baseDesc,
        dependenceProfile: {
          ...baseDesc.dependenceProfile,
          correlatedWithMethodIds: ['poisson-gamma-hazard'],
        },
      }),
    ).toThrow(RangeError);
    expect(() =>
      createScientificMethodRegistry([
        {
          ...baseDesc,
          dependenceProfile: {
            ...baseDesc.dependenceProfile,
            correlatedWithMethodIds: ['beta-binomial-conjugate'],
          },
        },
      ]),
    ).toThrow(RangeError);
  });

  it('performs zero network requests when inspecting or constructing registries', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => {
        throw new Error('Network calls are forbidden in Stage 2A-2.1');
      });
    try {
      const all = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listAll();
      const copyReg = createScientificMethodRegistry(all);
      expect(copyReg.size).toBe(7);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
