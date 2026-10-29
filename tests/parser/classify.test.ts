// Transaction classification table (design §3.4, US-09, E16, E17).
import { describe, expect, it } from 'vitest';
import { classifyDescription } from '../../src/parser/classify';
import { cleanSchemeName, normaliseSchemeName, parseSchemeHeader } from '../../src/parser/schemeName';
import { parseCasDate, parseNumber } from '../../src/parser/textExtract';

describe('classifyDescription', () => {
  const cases: Array<[string, string]> = [
    ['Systematic Investment (12)', 'sip'], ['SIP Purchase', 'sip'], ['Purchase - Systematic (Instalment 3)', 'sip'],
    ['Purchase - via myCAMS', 'purchase'], ['Purchase-BSE', 'purchase'], ['Additional Purchase - Online', 'purchase'], ['NFO Subscription', 'purchase'],
    ['Switch In - From Lens Sample Large Cap Fund - Direct Plan - Growth', 'switch_in'], ['Switch-In From X', 'switch_in'], ['STP In - From X', 'switch_in'],
    ['Switch Out - To Lens Sample Midcap Opportunities Fund - Direct Plan - Growth', 'switch_out'], ['Switch-Out To X', 'switch_out'], ['STP Out - To X', 'switch_out'],
    ['Redemption - via Online', 'redemption'], ['Systematic Withdrawal (1)', 'redemption'], ['SWP Redemption', 'redemption'],
    ['IDCW Payout', 'dividend_payout'], ['Dividend Paid', 'dividend_payout'], ['IDCW Reinvestment', 'dividend_reinvest'], ['Dividend Reinvested', 'dividend_reinvest'],
    ['*** Stamp Duty ***', 'stamp_duty'], ['*** STT Paid ***', 'stt_tds'], ['TDS on Dividend', 'stt_tds'],
    ['Systematic Investment (7) - Reversal', 'reversal'], ['Purchase - Rejected (Cheque Dishonoured)', 'reversal'], ['Purchase - via myCAMS - Reversed', 'reversal'],
    ['Creation of Units - Segregated Portfolio 1', 'segregated'], ['Segregated Portfolio - Units Credited', 'segregated'],
    ['Bonus Units Allotted', 'unit_adjustment'], ['Transfer In - Change of Broker', 'unit_adjustment'], ['Merger of schemes', 'unit_adjustment'],
    ['Lien Marked - Loan Against Units', 'unknown'],
  ];
  for (const [desc, kind] of cases) it(`${desc} -> ${kind}`, () => expect(classifyDescription(desc)).toBe(kind));

  it('bare IDCW: units > 0 with amount ≈ units x NAV -> reinvest, otherwise payout (E17)', () => {
    expect(classifyDescription('IDCW', { units: 10.5, amount: 1050, nav: 100 })).toBe('dividend_reinvest');
    expect(classifyDescription('IDCW', { units: undefined, amount: 1050, nav: 100 })).toBe('dividend_payout');
    expect(classifyDescription('IDCW', { units: 0, amount: 1050, nav: 100 })).toBe('dividend_payout');
    expect(classifyDescription('Dividend', { units: 1, amount: 1050, nav: 100 })).toBe('dividend_payout');
  });
  it('is case- and whitespace-insensitive', () => {
    expect(classifyDescription('  systematic   investment (1) ')).toBe('sip');
  });
});

describe('scheme header parsing', () => {
  it('CAMS style: code prefix, advisor and registrar removed; ISIN on the next line', () => {
    const p = parseSchemeHeader('LCG-Lens Sample Large Cap Fund - Direct Plan - Growth (Advisor: DIRECT) Registrar : CAMS');
    expect(p).toEqual({ name: 'Lens Sample Large Cap Fund - Direct Plan - Growth', advisor: 'DIRECT', registrar: 'CAMS' });
    expect(parseSchemeHeader('ISIN: INF000S01LC6')).toEqual({ name: '', isin: 'INF000S01LC6' });
    expect(parseSchemeHeader('128TSDGG-Axis Long Term Equity Fund - Direct Growth (Advisor: INA000000000) Registrar : CAMS').name).toBe('Axis Long Term Equity Fund - Direct Growth');
  });
  it('KFintech style: ISIN, advisor and registrar on one line, no name', () => {
    const p = parseSchemeHeader('ISIN: INF000S01SM0 (Advisor: DIRECT) Registrar : KFINTECH');
    expect(p).toEqual({ name: '', isin: 'INF000S01SM0', advisor: 'DIRECT', registrar: 'KFINTECH' });
  });
  it('keeps plan and option, strips trailing separators and codes', () => {
    expect(cleanSchemeName('VD01-Lens Sample Value Discovery Fund - Regular Plan - Growth -')).toBe('Lens Sample Value Discovery Fund - Regular Plan - Growth');
    expect(normaliseSchemeName('Lens Sample Value Discovery Fund - Regular Plan - Growth')).toBe('lens sample value discovery fund regular plan growth');
  });
});

describe('lexers', () => {
  it('parses Indian grouping, parentheses and minus signs (E50)', () => {
    expect(parseNumber('2,31,291.09')).toEqual({ value: 231291.09, decimals: 2 });
    expect(parseNumber('(1,234.50)')).toEqual({ value: -1234.5, decimals: 2 });
    expect(parseNumber('-1,234.5678')).toEqual({ value: -1234.5678, decimals: 4 });
    expect(parseNumber('0.000')).toEqual({ value: 0, decimals: 3 });
    expect(parseNumber('10-Feb-2016')).toBeNull();
    expect(parseNumber('INR 12.00')).toBeNull();
  });
  it('parses dd-Mon-yyyy and dd/mm/yyyy and rejects impossible dates (V-8)', () => {
    expect(parseCasDate('10-Feb-2016')).toBe('2016-02-10');
    expect(parseCasDate('29/02/2024')).toBe('2024-02-29');
    expect(parseCasDate('29-Feb-2023')).toBeNull();
    expect(parseCasDate('31-Apr-2023')).toBeNull();
    expect(parseCasDate('10-Foo-2016')).toBeNull();
    expect(parseCasDate('10-Feb-1989')).toBeNull();
  });
});

describe('classifyDescription: redemption / purchase rows that mention IDCW, TDS or stamp duty (review finding D)', () => {
  const cases: Array<[string, string]> = [
    ['Redemption - IDCW Payout Option', 'redemption'],
    ['Redemption (Less TDS)', 'redemption'],
    ['Redemption - Dividend Option', 'redemption'],
    ['Redemption less STT', 'redemption'],
    ['Purchase - IDCW Reinvestment Option', 'purchase'],
    ['Systematic Investment (3) - IDCW Option', 'sip'],
    ['Purchase (Net of Stamp Duty)', 'purchase'],
    // pure levy / dividend rows must not change
    ['*** Stamp Duty ***', 'stamp_duty'], ['Stamp Duty on Purchase', 'stamp_duty'], ['*** STT Paid ***', 'stt_tds'],
    ['TDS on Dividend', 'stt_tds'], ['IDCW Payout', 'dividend_payout'], ['IDCW', 'dividend_payout'], ['Dividend Reinvested', 'dividend_reinvest'],
  ];
  for (const [desc, kind] of cases) it(`${desc} -> ${kind}`, () => expect(classifyDescription(desc)).toBe(kind));
});
