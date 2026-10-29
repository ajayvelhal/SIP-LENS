// Review finding G: the parser keeps its own roundTo (layering forbids importing calculations/money). Pin them together.
import { describe, expect, it } from 'vitest';
import { roundTo as parserRoundTo } from '../../src/parser/casParser';
import { roundTo as moneyRoundTo } from '../../src/calculations/money';

describe('parser roundTo stays identical to calculations/money roundTo', () => {
  const values = [0, 0.005, 1.005, 2.675, -1.005, 1234.5678, -1234.5678, 0.0005, 99999.99999, 1e-7, 123456789.125, -0.0049999];
  for (const dp of [0, 2, 3, 4, 6]) {
    it(`dp=${dp}`, () => { for (const v of values) expect(parserRoundTo(v, dp)).toBe(moneyRoundTo(v, dp)); });
  }
});
