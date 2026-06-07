import { describe, it, expect } from "vitest";
import { parseCsv, csvToCaseInputs } from "@/lib/csv-import";

describe("parseCsv", () => {
  it("parses a simple grid", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    const rows = parseCsv('name,note\n"Doe, John","hi, there"');
    expect(rows[1]).toEqual(["Doe, John", "hi, there"]);
  });

  it('unescapes "" inside quoted fields', () => {
    const rows = parseCsv('q\n"she said ""hi"""');
    expect(rows[1]).toEqual(['she said "hi"']);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves embedded newlines inside quoted fields", () => {
    const rows = parseCsv('h\n"line1\nline2"');
    expect(rows[1]).toEqual(["line1\nline2"]);
  });
});

describe("csvToCaseInputs header aliases", () => {
  it("maps account/amount/risk aliases to canonical fields", () => {
    const csv = "account,amount,risk,description\nACC-1,12500,85,Suspicious wire";
    const inputs = csvToCaseInputs(csv);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].account_id).toBe("ACC-1");
    expect(inputs[0].exposure).toBe(12500);
    expect(inputs[0].fraud_prob).toBe(85);
    expect(inputs[0].reason).toBe("Suspicious wire");
  });

  it("parses currency-formatted amounts when quoted", () => {
    const csv = 'account,amount,risk\nACC-1,"$12,500",85';
    const inputs = csvToCaseInputs(csv);
    expect(inputs[0].exposure).toBe(12500);
  });

  it("recognizes acct/value/score aliases", () => {
    const csv = "acct,value,score\nACC-7,40000,55";
    const inputs = csvToCaseInputs(csv);
    expect(inputs[0].account_id).toBe("ACC-7");
    expect(inputs[0].exposure).toBe(40000);
    expect(inputs[0].fraud_prob).toBe(55);
  });
});

describe("csvToCaseInputs severity fallback from risk score", () => {
  it("uses an explicit valid severity", () => {
    const csv = "account,severity,risk\nACC-1,REVIEW,90";
    expect(csvToCaseInputs(csv)[0].severity).toBe("REVIEW");
  });
  it("falls back to CRITICAL for risk >= 80", () => {
    const csv = "account,risk\nACC-1,90";
    expect(csvToCaseInputs(csv)[0].severity).toBe("CRITICAL");
  });
  it("falls back to HIGH for risk 50-79", () => {
    const csv = "account,risk\nACC-1,60";
    expect(csvToCaseInputs(csv)[0].severity).toBe("HIGH");
  });
  it("falls back to REVIEW for risk < 50", () => {
    const csv = "account,risk\nACC-1,30";
    expect(csvToCaseInputs(csv)[0].severity).toBe("REVIEW");
  });
  it("falls back to HIGH (default prob 60) when no risk column", () => {
    const csv = "account\nACC-1";
    expect(csvToCaseInputs(csv)[0].severity).toBe("HIGH");
  });
});

describe("csvToCaseInputs row filtering", () => {
  it("skips rows with no account id", () => {
    const csv = "account,risk\nACC-1,80\n,55\nACC-2,40";
    const inputs = csvToCaseInputs(csv);
    expect(inputs.map((i) => i.account_id)).toEqual(["ACC-1", "ACC-2"]);
  });

  it("returns [] when fewer than 2 non-empty rows", () => {
    expect(csvToCaseInputs("account,risk")).toEqual([]);
    expect(csvToCaseInputs("")).toEqual([]);
    expect(csvToCaseInputs("account,risk\n\n   \n")).toEqual([]);
  });
});

describe("csvToCaseInputs list + default handling", () => {
  it("splits evidence on | and ; but keeps natural commas", () => {
    const csv = 'account,evidence\nACC-1,"item one, with comma|item two;item three"';
    const inputs = csvToCaseInputs(csv);
    expect(inputs[0].evidence).toEqual([
      "item one, with comma",
      "item two",
      "item three",
    ]);
  });

  it("splits triggered rules on comma, pipe and semicolon", () => {
    const csv = 'account,rules\nACC-1,"R1, R2|R3;R4"';
    const inputs = csvToCaseInputs(csv);
    expect(inputs[0].triggered_rules).toEqual(["R1", "R2", "R3", "R4"]);
  });

  it("defaults sla_hours to 48 when absent", () => {
    const csv = "account\nACC-1";
    expect(csvToCaseInputs(csv)[0].sla_hours).toBe(48);
  });
});
