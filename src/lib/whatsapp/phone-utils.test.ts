import { describe, expect, it } from "vitest";
import {
  brPhoneLookupKeys,
  isRecipientNotAllowedError,
  isValidE164,
  normalizeBrPhone,
  normalizePhone,
  phoneVariants,
  phonesMatch,
  sanitizePhoneForMeta,
} from "./phone-utils";

describe("normalizeBrPhone", () => {
  it("adds 55 to an 11-digit mobile typed without the country code", () => {
    expect(normalizeBrPhone("(81) 99999-1234")).toBe("5581999991234");
    expect(normalizeBrPhone("11999991234")).toBe("5511999991234");
  });

  it("adds 55 to a 10-digit landline", () => {
    expect(normalizeBrPhone("(11) 3333-4444")).toBe("551133334444");
  });

  it("keeps numbers that already carry the 55", () => {
    expect(normalizeBrPhone("5511999991234")).toBe("5511999991234");
    expect(normalizeBrPhone("+55 (11) 99999-1234")).toBe("5511999991234");
    expect(normalizeBrPhone("551133334444")).toBe("551133334444");
  });

  it("decides by length, never by prefix: DDD 55 still gets the country code", () => {
    // Santa Maria/RS — começa com 55 mas é DDD, não DDI.
    expect(normalizeBrPhone("55999221234")).toBe("5555999221234");
  });

  it("drops a trunk 0 before the DDD", () => {
    expect(normalizeBrPhone("011999991234")).toBe("5511999991234");
  });

  it("trusts a + prefix as an international number", () => {
    expect(normalizeBrPhone("+1 415 555 1212")).toBe("14155551212");
    expect(normalizeBrPhone("+351 912 345 678")).toBe("351912345678");
  });

  it("returns empty for empty input", () => {
    expect(normalizeBrPhone("")).toBe("");
  });
});

describe("brPhoneLookupKeys", () => {
  it("returns the canonical key first and the legacy no-55 key second", () => {
    expect(brPhoneLookupKeys("81999991234")).toEqual(["5581999991234", "81999991234"]);
    expect(brPhoneLookupKeys("+55 81 99999-1234")).toEqual(["5581999991234", "81999991234"]);
  });

  it("returns only the number itself for non-Brazilian numbers", () => {
    expect(brPhoneLookupKeys("+1 415 555 1212")).toEqual(["14155551212"]);
  });

  it("returns nothing for empty input", () => {
    expect(brPhoneLookupKeys("")).toEqual([]);
  });
});

describe("sanitizePhoneForMeta", () => {
  it("strips +, spaces, and dashes leaving only digits", () => {
    expect(sanitizePhoneForMeta("+370 639 49836")).toBe("37063949836");
    expect(sanitizePhoneForMeta("+1 (415) 555-1212")).toBe("14155551212");
  });

  it("returns an empty string for falsy input", () => {
    expect(sanitizePhoneForMeta("")).toBe("");
    // Defensive: existing call sites occasionally pass through nullable
    // contact phones. The function early-returns on the falsy check.
    expect(sanitizePhoneForMeta(undefined as unknown as string)).toBe("");
  });

  it("is idempotent on already-sanitized input", () => {
    const cleaned = "14155551212";
    expect(sanitizePhoneForMeta(cleaned)).toBe(cleaned);
  });
});

describe("normalizePhone", () => {
  it("matches sanitizePhoneForMeta byte-for-byte (shared canonical form)", () => {
    const samples = ["+370 12345", "abc-555-DEF", "", "0044 7000 0000 0000"];
    for (const s of samples) {
      expect(normalizePhone(s)).toBe(sanitizePhoneForMeta(s));
    }
  });
});

describe("phonesMatch", () => {
  it("returns true for exact digit matches", () => {
    expect(phonesMatch("+37063949836", "37063949836")).toBe(true);
  });

  it("matches across trunk-prefix variants by last-8 fallback", () => {
    // Lithuanian trunk-0 variant. Last 8 digits ("63949836") collide.
    expect(phonesMatch("370063949836", "37063949836")).toBe(true);
  });

  it("rejects mismatched numbers", () => {
    expect(phonesMatch("+37063949836", "+37063949837")).toBe(false);
  });

  it("rejects very short inputs that would false-positive on tail match", () => {
    // Only 7 digits — the last-8 fallback is gated to len>=8 on both
    // sides to avoid declaring "12345" and "67890-12345" a match.
    expect(phonesMatch("1234567", "1234567")).toBe(true);
    expect(phonesMatch("1234567", "9991234567")).toBe(false);
  });

  it("ignores formatting noise on both sides", () => {
    expect(phonesMatch("+370 6 394 9836", "37063949836")).toBe(true);
    expect(phonesMatch("(415) 555-1212", "+1 415-555-1212")).toBe(true);
  });
});

describe("isValidE164", () => {
  it("accepts numbers 7–15 digits with optional + and non-zero start", () => {
    expect(isValidE164("+37063949836")).toBe(true);
    expect(isValidE164("37063949836")).toBe(true);
    expect(isValidE164("+1234567")).toBe(true); // 7 digits — lower bound
    expect(isValidE164("+123456789012345")).toBe(true); // 15 digits — upper bound
  });

  it("rejects numbers that start with 0 in international form", () => {
    expect(isValidE164("+0123456")).toBe(false);
    expect(isValidE164("0044700000000")).toBe(false);
  });

  it("rejects too-short and too-long inputs", () => {
    expect(isValidE164("+123456")).toBe(false); // 6 digits
    expect(isValidE164("+1234567890123456")).toBe(false); // 16 digits
  });

  it("rejects strings with non-digit characters", () => {
    expect(isValidE164("+1-415-555-1212")).toBe(false);
    expect(isValidE164("+1 4155551212")).toBe(false);
    expect(isValidE164("abc12345678")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidE164("")).toBe(false);
  });
});

describe("phoneVariants", () => {
  it("returns an empty list for empty input", () => {
    expect(phoneVariants("")).toEqual([]);
  });

  it("always lists the original number first", () => {
    const out = phoneVariants("37063949836");
    expect(out[0]).toBe("37063949836");
  });

  it("inserts a trunk 0 after each plausible country-code length", () => {
    // Input "37063949836" — CC-1 → "3" + "0" + "7063949836",
    //                       CC-3 → "370" + "0" + "63949836".
    // CC-2 is skipped because "063949836" already starts with 0.
    const out = phoneVariants("37063949836");
    expect(out).toEqual(
      expect.arrayContaining([
        "37063949836",
        "307063949836",
        "370063949836",
      ]),
    );
  });

  it("removes a leading 0 after the country code when present", () => {
    // Input "370063949836" — CC-2 strips one leading 0 from
    // "0063949836" → "37" + "063949836" = "37063949836". Only one zero
    // comes off per pass; that's what the live retry loop needs.
    const out = phoneVariants("370063949836");
    expect(out).toContain("370063949836");
    expect(out).toContain("37063949836");
  });

  it("deduplicates variants that collapse to the same digits", () => {
    const out = phoneVariants("37063949836");
    expect(new Set(out).size).toBe(out.length);
  });

  it("returns just the original when the number is too short for any CC slice", () => {
    // 1-char input is shorter than all ccLen values; both loops skip.
    expect(phoneVariants("1")).toEqual(["1"]);
  });
});

describe("isRecipientNotAllowedError", () => {
  it("matches Meta error code 131030", () => {
    expect(
      isRecipientNotAllowedError(
        "(#131030) Recipient phone number not in allowed list",
      ),
    ).toBe(true);
  });

  it("matches the human-readable English variants", () => {
    expect(isRecipientNotAllowedError("not in allowed list")).toBe(true);
    expect(isRecipientNotAllowedError("recipient not in the allowed list")).toBe(
      true,
    );
    // Case-insensitive on the human text.
    expect(isRecipientNotAllowedError("NOT IN ALLOWED LIST")).toBe(true);
  });

  it("does not false-positive on unrelated Meta errors", () => {
    expect(isRecipientNotAllowedError("(#100) Invalid parameter")).toBe(false);
    expect(isRecipientNotAllowedError("template name does not exist")).toBe(
      false,
    );
    expect(isRecipientNotAllowedError("")).toBe(false);
  });
});
