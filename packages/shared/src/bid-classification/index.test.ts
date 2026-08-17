import { describe, it, expect } from 'vitest';

import {
  sizeBandFromFte,
  classifyBid,
  assessBid,
  activeEscalations,
  addBusinessDays,
  allowedGatesForClass,
  isGateOutcomeValid,
  GATE_KEYS,
  GATE_LABELS,
  GATE_OUTCOMES,
  GOVERNANCE_BY_CLASS,
  BID_LIFECYCLE,
  LESSONS_LEARNED_SLA_BUSINESS_DAYS,
  RACI_MATRIX,
  BID_CLASSES,
  type SizeBand,
  type CommitmentLevel,
  type BidClass,
} from './index.js';

describe('sizeBandFromFte', () => {
  // Boundaries are upper-inclusive: ≤1 XS · 1–5 S · 5–10 M · 10–30 BD · >30 GC.
  // These edges drive the whole governance path, so they must not drift.
  it.each<[number, SizeBand]>([
    [0, 'XS'],
    [1, 'XS'],
    [1.5, 'S'],
    [5, 'S'],
    [5.1, 'M'],
    [10, 'M'],
    [10.5, 'BD'],
    [30, 'BD'],
    [31, 'GC'],
    [500, 'GC'],
  ])('fte=%s → %s', (fte, band) => {
    expect(sizeBandFromFte(fte)).toBe(band);
  });

  it('treats non-finite / negative FTE as XS (fail-safe, not a crash)', () => {
    expect(sizeBandFromFte(-3)).toBe('XS');
    expect(sizeBandFromFte(Number.NaN)).toBe('XS');
  });
});

describe('classifyBid matrix', () => {
  // The full 5×4 matrix verbatim from the playbook §3. A wrong cell routes a bid
  // to the wrong committee/validators — this is the most safety-critical table.
  const matrix: Record<SizeBand, Record<CommitmentLevel, BidClass>> = {
    XS: { low: 'C0', medium: 'C1', high: 'C1', xhigh: 'C2' },
    S: { low: 'C1', medium: 'C1', high: 'C2', xhigh: 'C3' },
    M: { low: 'C1', medium: 'C2', high: 'C2', xhigh: 'C3' },
    BD: { low: 'C2', medium: 'C2', high: 'C3', xhigh: 'C4' },
    GC: { low: 'C2', medium: 'C3', high: 'C4', xhigh: 'C4' },
  };
  for (const band of Object.keys(matrix) as SizeBand[]) {
    for (const commitment of Object.keys(matrix[band]) as CommitmentLevel[]) {
      it(`${band} × ${commitment} → ${matrix[band][commitment]}`, () => {
        expect(classifyBid(band, commitment)).toBe(matrix[band][commitment]);
      });
    }
  }
});

describe('governance model', () => {
  it('has a governance entry for every class with sane duration bounds', () => {
    for (const c of BID_CLASSES) {
      const g = GOVERNANCE_BY_CLASS[c];
      expect(g.bidClass).toBe(c);
      expect(g.estDurationDays[0]).toBeLessThanOrEqual(g.estDurationDays[1]);
    }
  });

  it('C0 has no committee (SM/CoE-led) while C1–C4 do', () => {
    expect(GOVERNANCE_BY_CLASS.C0.committee).toHaveLength(0);
    for (const c of ['C1', 'C2', 'C3', 'C4'] as BidClass[]) {
      expect(GOVERNANCE_BY_CLASS[c].committee.length).toBeGreaterThan(0);
    }
  });

  it('C4 runs the 3-gate strategic model and requires CEO sign-off', () => {
    expect(GOVERNANCE_BY_CLASS.C4.gates).toEqual([
      'Strategy Validation',
      'Proposal Review',
      'Pricing & Bid Validation',
    ]);
    expect(GOVERNANCE_BY_CLASS.C4.finalValidators.join(' ')).toContain('CEO');
    expect(GOVERNANCE_BY_CLASS.C4.specialRules.length).toBeGreaterThan(0);
  });

  it('C1–C3 collapse to the Go/No-Go → Bid/No-Bid two-gate model', () => {
    for (const c of ['C1', 'C2', 'C3'] as BidClass[]) {
      expect(GOVERNANCE_BY_CLASS[c].gates).toEqual(['Go/No-Go', 'Bid/No-Bid']);
    }
  });
});

describe('escalations are orthogonal to class', () => {
  it('fire only for their trigger flags', () => {
    expect(activeEscalations({})).toHaveLength(0);
    expect(activeEscalations({ highRisk: true }).map((e) => e.id)).toEqual(['high_risk']);
    expect(
      activeEscalations({ marginBelow25: true, multiGeoOrBrand: true }).map((e) => e.id),
    ).toEqual(['low_margin', 'multi_geo_brand']);
  });

  it('do not change the computed class (a high-risk small deal stays its size-based class)', () => {
    const plain = assessBid(3, 'low');
    const risky = assessBid(3, 'low', { highRisk: true });
    expect(risky.bidClass).toBe(plain.bidClass); // class unchanged
    expect(risky.escalations).toHaveLength(1); // but escalation is recorded
  });
});

describe('assessBid end to end', () => {
  it('a >30 FTE xhigh-commitment strategic deal is C4', () => {
    const a = assessBid(45, 'xhigh', { multiGeoOrBrand: true });
    expect(a.sizeBand).toBe('GC');
    expect(a.bidClass).toBe('C4');
    expect(a.governance.gates).toHaveLength(3);
    expect(a.escalations.map((e) => e.id)).toContain('multi_geo_brand');
  });

  it('a single-FTE low-commitment deal is C0 (no committee)', () => {
    const a = assessBid(1, 'low');
    expect(a.bidClass).toBe('C0');
    expect(a.governance.committee).toHaveLength(0);
  });
});

describe('lifecycle + RACI integrity', () => {
  it('has exactly the 10 canonical stages in order across Shape/Build/Deliver', () => {
    expect(BID_LIFECYCLE).toHaveLength(10);
    expect(BID_LIFECYCLE.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(BID_LIFECYCLE[0].mission).toBe('Shape');
    expect(BID_LIFECYCLE[2].mission).toBe('Build'); // Stage 3 = Bid Office entry
  });

  it('marks the four named governance gates in the RACI matrix', () => {
    const gates = RACI_MATRIX.filter((a) => a.isGate).map((a) => a.activity);
    expect(gates).toEqual([
      'Go/No-Go Decision',
      'Strategy Validation',
      'Offer Review & Validation',
      'Pricing Strategy & Bid Validation',
    ]);
  });

  it('gives Bid Office a primary role (R/A/RA) on every gate — "first to engage, last to exit"', () => {
    // Bid Office is RA on Go/No-Go, Strategy, and Offer Review, but only R on
    // Pricing Strategy & Bid Validation (Business is Accountable there — they
    // own pricing). Either way Bid Office is never merely Consulted/Informed.
    for (const gate of RACI_MATRIX.filter((a) => a.isGate)) {
      expect(['R', 'A', 'RA']).toContain(gate.marks.bidOffice);
    }
  });
});

describe('gate vocabulary', () => {
  it('labels and outcome sets cover every gate key exactly once', () => {
    expect(Object.keys(GATE_LABELS).sort()).toEqual([...GATE_KEYS].sort());
    expect(Object.keys(GATE_OUTCOMES).sort()).toEqual([...GATE_KEYS].sort());
  });

  // WHY this matters: resolveStandingDecision only reads go/no_go/bid/no_bid.
  // A `{ go_no_go, approved }` row produces no readable signal, and because the
  // stage gate looks at only the LATEST go_no_go/bid_no_bid row, that unreadable
  // row HIDES an earlier no-go and lets a killed bid advance. The pairing must
  // be rejected at the API, so the pairing table is the thing under test.
  it('binds each gate to the outcomes it can actually decide', () => {
    expect(isGateOutcomeValid('go_no_go', 'go')).toBe(true);
    expect(isGateOutcomeValid('go_no_go', 'no_go')).toBe(true);
    expect(isGateOutcomeValid('go_no_go', 'approved')).toBe(false);
    expect(isGateOutcomeValid('bid_no_bid', 'bid')).toBe(true);
    expect(isGateOutcomeValid('bid_no_bid', 'go')).toBe(false);
    expect(isGateOutcomeValid('strategy_validation', 'approved')).toBe(true);
    expect(isGateOutcomeValid('strategy_validation', 'bid')).toBe(false);
  });

  it('every gate outcome maps to a decidable signal (no silent-hole pairs)', () => {
    for (const gate of GATE_KEYS) {
      expect(GATE_OUTCOMES[gate].length).toBeGreaterThan(0);
      for (const outcome of GATE_OUTCOMES[gate]) {
        expect(isGateOutcomeValid(gate, outcome)).toBe(true);
      }
    }
  });
});

describe('allowedGatesForClass', () => {
  it('offers a class only its own gates, plus the lifecycle Stage-3 Go/No-Go', () => {
    // C1–C3 run Go/No-Go then Bid/No-Bid. Strategy Validation is a C4 gate:
    // recording one on a C1 is a process error, not a preference.
    expect(allowedGatesForClass('C1')).toEqual(['go_no_go', 'bid_no_bid']);
    expect(allowedGatesForClass('C1')).not.toContain('strategy_validation');
    expect(allowedGatesForClass('C4')).toEqual([
      'go_no_go',
      'strategy_validation',
      'proposal_review',
      'pricing_bid_validation',
    ]);
    // C0 has no committee — Bid Office only quality-checks it.
    expect(allowedGatesForClass('C0')).toEqual(['go_no_go', 'quality_check']);
  });

  it('accepts any gate while the bid is unclassified (classification is optional)', () => {
    expect(allowedGatesForClass(null)).toEqual(GATE_KEYS);
    expect(allowedGatesForClass(undefined)).toEqual(GATE_KEYS);
  });

  it('never offers a gate the class table does not define for that class', () => {
    for (const cls of BID_CLASSES) {
      const classGates = GOVERNANCE_BY_CLASS[cls].gateKeys;
      for (const gate of allowedGatesForClass(cls)) {
        // go_no_go is the lifecycle Stage-3 checkpoint, allowed everywhere.
        if (gate === 'go_no_go') continue;
        expect(classGates).toContain(gate);
      }
    }
  });
});

describe('Stage 10 SLA arithmetic', () => {
  it('skips weekends when adding business days', () => {
    // 2026-08-13 is a Thursday. +5 business days = Thursday 2026-08-20.
    expect(addBusinessDays(new Date('2026-08-13T00:00:00Z'), 5).toISOString().slice(0, 10)).toBe(
      '2026-08-20',
    );
    // Friday +1 lands on Monday, not Saturday.
    expect(addBusinessDays(new Date('2026-08-14T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe(
      '2026-08-17',
    );
    // Saturday +1 lands on Monday.
    expect(addBusinessDays(new Date('2026-08-15T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe(
      '2026-08-17',
    );
  });

  it('is a no-op for zero or negative days', () => {
    const d = new Date('2026-08-13T00:00:00Z');
    expect(addBusinessDays(d, 0).toISOString()).toBe(d.toISOString());
    expect(addBusinessDays(d, -3).toISOString()).toBe(d.toISOString());
  });

  it('holds the playbook deadline at 5 business days', () => {
    expect(LESSONS_LEARNED_SLA_BUSINESS_DAYS).toBe(5);
  });
});
