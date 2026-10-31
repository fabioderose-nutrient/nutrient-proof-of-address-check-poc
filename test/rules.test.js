// Offline tests of the matching rules. No API call: the extraction output is written by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDate, checkProofOfAddress, compareAddress, compareNames, normalizePostcode } from "../src/rules.js";

test("names: titles, case, accents and initials", () => {
  assert.equal(compareNames("Eleanor Mary Whitcombe", "Mrs Eleanor M Whitcombe").status, "pass");
  assert.equal(compareNames("José Álvarez Romero", "MR JOSE ALVAREZ ROMERO").status, "pass");
  assert.equal(compareNames("Thomas Andrew Whitfield", "WHITFIELD, Mr T A").status, "pass");
  assert.equal(compareNames("Siobhan O'Neill", "Ms S ONEILL").status, "pass");
});

test("names: short form or spelling difference goes to review", () => {
  assert.equal(compareNames("Katherine Ashdown", "Ms Kate Ashdown").status, "review");
  assert.equal(compareNames("Eleanor Whitcombe", "Mrs Elenor Whitcombe").status, "review");
  assert.equal(compareNames("Eleanor Mary Whitcombe", "Mrs Mary Whitcombe").status, "review");
});

test("names: another person is rejected", () => {
  assert.equal(compareNames("Eleanor Mary Whitcombe", "Mrs Margaret Whitcombe").status, "fail");
  assert.equal(compareNames("Eleanor Whitcombe", "Mr Owen Pritchard").status, "fail");
});

test("addresses: abbreviations, flats and capitals", () => {
  const doc = { lines: ["Flat 3", "27 Kingsmere Road", "Ashbury"], town: "Halverton" };
  const app = { addressLine1: "Flat 3, 27 Kingsmere Rd", addressLine2: "Ashbury", town: "Halverton" };
  assert.equal(compareAddress(app, doc).status, "pass");
  assert.equal(
    compareAddress(
      { addressLine1: "14 Saint Albans Ave", addressLine2: "Millbrook", town: "Halverton" },
      { lines: ["14 ST ALBANS AVENUE", "MILLBROOK"], town: "HALVERTON" },
    ).status,
    "pass",
  );
  assert.equal(
    compareAddress({ addressLine1: "Apartment 2, 9 Orchard Ct", addressLine2: "Mill Ln", town: "Halverton" }, {
      lines: ["Flat 2", "9 Orchard Court", "Mill Lane"],
      town: "Halverton",
    }).status,
    "pass",
  );
});

test("addresses: flat and house number differences", () => {
  const doc = { lines: ["27 Kingsmere Road"], town: "Halverton" };
  assert.equal(compareAddress({ addressLine1: "Flat 3, 27 Kingsmere Road", town: "Halverton" }, doc).status, "review");
  assert.equal(
    compareAddress({ addressLine1: "Flat 4, 27 Kingsmere Road", town: "Halverton" }, { lines: ["Flat 3", "27 Kingsmere Road"], town: "Halverton" }).status,
    "fail",
  );
  assert.equal(compareAddress({ addressLine1: "29 Kingsmere Road", town: "Halverton" }, doc).status, "fail");
  assert.equal(compareAddress({ addressLine1: "27 Larch Street", town: "Dunmore" }, doc).status, "fail");
});

test("postcodes are compared without spaces or case", () => {
  assert.equal(normalizePostcode(" hv4 7qt"), normalizePostcode("HV47QT"));
});

test("dates: 3-month window", () => {
  assert.equal(checkDate("2026-10-28", "2026-10-06").status, "pass");
  assert.equal(checkDate("2026-10-28", "2026-07-28").status, "pass");
  assert.equal(checkDate("2026-10-28", "2026-07-27").status, "fail");
  assert.equal(checkDate("2026-10-28", "2026-05-11").status, "fail");
  assert.equal(checkDate("2026-10-28", "2026-11-02").status, "review");
  assert.equal(checkDate("2026-10-28", undefined).status, "review");
  assert.equal(checkDate("2026-05-31", "2026-02-28").status, "pass");
});

const applicant = {
  fullName: "Eleanor Mary Whitcombe",
  addressLine1: "Flat 3, 27 Kingsmere Rd",
  addressLine2: "Ashbury",
  town: "Halverton",
  postcode: "HV4 7QT",
  applicationDate: "2026-10-28",
};

function cite(match = "id_match", groundedness = 0.99) {
  return { match, pageIndex: 0, pageNumber: 1, bbox: { x: 10, y: 10, width: 50, height: 10 }, citation: { status: "cited", confidence: { groundedness } } };
}

function output(overrides = {}, metaOverrides = {}) {
  return {
    data: {
      document_type: "utility_bill",
      issuer_name: "Larkfield Energy Ltd",
      holder_name: "Mrs Eleanor M Whitcombe",
      holder_address: { lines: ["Flat 3", "27 Kingsmere Road", "Ashbury"], town: "Halverton", postcode: "HV4 7QT" },
      document_date: "2026-10-06",
      account_reference: "8041 2277 935",
      ...overrides,
    },
    metadata: {
      document_type: cite(),
      issuer_name: cite(),
      holder_name: cite(),
      holder_address: { lines: [cite(), cite(), cite()], town: cite(), postcode: cite() },
      document_date: cite(),
      account_reference: cite(),
      ...metaOverrides,
    },
    pages: [{ page: 1, width: 596, height: 842 }],
  };
}

test("decision: accept when everything matches", () => {
  const result = checkProofOfAddress(applicant, output());
  assert.equal(result.decision, "accept");
  assert.equal(result.checks.find((c) => c.id === "name").evidence[0].page, 1);
});

test("decision: reject an old document", () => {
  assert.equal(checkProofOfAddress(applicant, output({ document_date: "2026-05-11" })).decision, "reject");
});

test("decision: reject a type that is not accepted", () => {
  assert.equal(checkProofOfAddress(applicant, output({ document_type: "mobile_phone_bill" })).decision, "reject");
});

test("decision: review when a key value is not grounded", () => {
  const result = checkProofOfAddress(applicant, output({}, { holder_name: cite("fuzzy_match", 0.4) }));
  assert.equal(result.decision, "review");
});

test("decision: reject a different postcode", () => {
  const result = checkProofOfAddress(applicant, output({ holder_address: { lines: ["Flat 3", "27 Kingsmere Road"], town: "Halverton", postcode: "HV4 7QX" } }));
  assert.equal(result.decision, "reject");
});
