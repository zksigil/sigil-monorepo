import {
  computeCheckDigit,
  correctNationality,
  normalizeMRZLine,
  parseMRZLine2,
  parseMRZFromOCRText,
  allChecksPass,
} from '../mrzParser';

// ICAO 9303-3 Appendix A.1 canonical TD3 line 2.
const ICAO_LINE_2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

describe('computeCheckDigit', () => {
  it('matches ICAO 9303-3 Appendix A.1 reference values', () => {
    expect(computeCheckDigit('L898902C3')).toBe('6');  // document number
    expect(computeCheckDigit('740812')).toBe('2');     // date of birth
    expect(computeCheckDigit('120415')).toBe('9');     // expiry
  });

  it('returns "0" for an empty string', () => {
    expect(computeCheckDigit('')).toBe('0');
  });

  it('returns null when input contains a non-MRZ character', () => {
    expect(computeCheckDigit('ABC*')).toBeNull();
  });
});

describe('normalizeMRZLine', () => {
  it('uppercases and strips whitespace', () => {
    expect(normalizeMRZLine('l898902c3 6 uto')).toBe('L898902C36UTO');
  });

  it('coerces dots and hyphens to filler', () => {
    expect(normalizeMRZLine('L898902C36UTO.<.<')).toBe('L898902C36UTO<<<<');
    expect(normalizeMRZLine('AB-CD')).toBe('AB<CD');
  });

  it('drops characters outside the MRZ alphabet', () => {
    expect(normalizeMRZLine('L8(99)*02C3')).toBe('L89902C3');
  });
});

describe('correctNationality', () => {
  it('returns valid codes unchanged', () => {
    expect(correctNationality('USA')).toBe('USA');
    expect(correctNationality('GBR')).toBe('GBR');
    expect(correctNationality('JPN')).toBe('JPN');
    expect(correctNationality('UTO')).toBe('UTO'); // ICAO test code
  });

  it('snaps the OCR misread "OSA" to "USA"', () => {
    expect(correctNationality('OSA')).toBe('USA');
  });

  it('leaves the candidate alone when no neighbour or multiple neighbours exist', () => {
    expect(correctNationality('ZZZ')).toBe('ZZZ'); // no neighbour
    // "OBR" sits at edit distance 1 from both GBR and LBR — ambiguous, leave it.
    expect(correctNationality('OBR')).toBe('OBR');
    // "JPM" sits at edit distance 1 from both JPN and JAM — ambiguous.
    expect(correctNationality('JPM')).toBe('JPM');
  });

  it('returns inputs of the wrong length unchanged', () => {
    expect(correctNationality('US')).toBe('US');
    expect(correctNationality('USAA')).toBe('USAA');
  });
});

describe('parseMRZLine2', () => {
  it('parses the ICAO reference line and validates all check digits', () => {
    const result = parseMRZLine2(ICAO_LINE_2);
    expect(result).not.toBeNull();
    expect(result!.fields).toEqual({
      documentNumber: 'L898902C3',
      nationality: 'UTO',
      dateOfBirth: '740812',
      dateOfExpiry: '120415',
    });
    expect(result!.checks).toEqual({
      documentNumber: true,
      dateOfBirth: true,
      dateOfExpiry: true,
    });
    expect(allChecksPass(result!.checks)).toBe(true);
  });

  it('returns null when the line is shorter than 44 chars', () => {
    expect(parseMRZLine2('TOO_SHORT')).toBeNull();
  });

  it('parses fields but flags failed check digits when one is wrong', () => {
    // Replace doc-number check digit (position 9) with a deliberately-wrong digit.
    const corrupted = ICAO_LINE_2.substring(0, 9) + '0' + ICAO_LINE_2.substring(10);
    const result = parseMRZLine2(corrupted);
    expect(result).not.toBeNull();
    expect(result!.checks.documentNumber).toBe(false);
    expect(result!.checks.dateOfBirth).toBe(true);
    expect(result!.checks.dateOfExpiry).toBe(true);
    expect(allChecksPass(result!.checks)).toBe(false);
  });

  it('rejects lines with a non-numeric date field', () => {
    // Position 13–18 is DOB; replace with letters.
    const broken = ICAO_LINE_2.substring(0, 13) + 'ABCDEF' + ICAO_LINE_2.substring(19);
    expect(parseMRZLine2(broken)).toBeNull();
  });

  it('strips filler chars from short document numbers', () => {
    // "AB12<<<<<" with valid doc check
    const docRaw = 'AB12<<<<<';
    const docCheck = computeCheckDigit(docRaw);
    const dob = '740812';
    const dobCheck = computeCheckDigit(dob);
    const expiry = '120415';
    const expiryCheck = computeCheckDigit(expiry);
    const line = `${docRaw}${docCheck}UTO${dob}${dobCheck}M${expiry}${expiryCheck}<<<<<<<<<<<<<<00`;
    expect(line.length).toBe(44);

    const result = parseMRZLine2(line);
    expect(result).not.toBeNull();
    expect(result!.fields.documentNumber).toBe('AB12');
    expect(result!.checks.documentNumber).toBe(true);
  });
});

describe('parseMRZFromOCRText', () => {
  it('finds the MRZ line among noise', () => {
    const lines = [
      'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', // line 1 (we ignore it)
      'Some unrelated text from the page',
      ICAO_LINE_2,
      'More garbage',
    ];
    const result = parseMRZFromOCRText(lines);
    expect(result).not.toBeNull();
    expect(result!.fields.documentNumber).toBe('L898902C3');
    expect(allChecksPass(result!.checks)).toBe(true);
  });

  it('prefers a line where check digits validate over one where they do not', () => {
    const corrupted = ICAO_LINE_2.substring(0, 9) + '0' + ICAO_LINE_2.substring(10);
    const result = parseMRZFromOCRText([corrupted, ICAO_LINE_2]);
    expect(result).not.toBeNull();
    expect(allChecksPass(result!.checks)).toBe(true);
    expect(result!.fields.documentNumber).toBe('L898902C3');
  });

  it('falls back to a parsed-but-failing line when no clean parse exists', () => {
    const corrupted = ICAO_LINE_2.substring(0, 9) + '0' + ICAO_LINE_2.substring(10);
    const result = parseMRZFromOCRText([corrupted]);
    expect(result).not.toBeNull();
    expect(allChecksPass(result!.checks)).toBe(false);
  });

  it('returns null when no candidate parses at all', () => {
    expect(parseMRZFromOCRText(['random', 'garbage', 'lines'])).toBeNull();
  });

  it('corrects common OCR digit-letter substitutions before parsing', () => {
    // Swap the leading "L" with itself (alpha at pos 0 is fine), then make
    // position 13 an "S" instead of "7" — toDigit should map it back.
    const ocrish = 'L898902C36UTOS40812' + ICAO_LINE_2.substring(19);
    const result = parseMRZFromOCRText([ocrish]);
    expect(result).not.toBeNull();
    expect(result!.fields.dateOfBirth).toBe('540812');
  });
});
