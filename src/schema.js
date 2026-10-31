// JSON Schema sent to the Data Extraction API extract endpoint.
// Only the keywords the API supports are used: type, properties, required, items,
// description, enum and format "date".

export const DOCUMENT_TYPES = {
  utility_bill: "Utility bill (electricity, gas, water, landline or broadband)",
  bank_statement: "Bank or building society statement",
  council_tax_bill: "Council tax bill",
  mortgage_statement: "Mortgage statement",
  tenancy_agreement: "Tenancy agreement",
  government_letter: "Letter from a government department or agency",
  mobile_phone_bill: "Mobile phone bill",
  credit_card_statement: "Credit card statement",
  payslip: "Payslip",
  other: "Other document",
};

export const extractionSchema = {
  type: "object",
  properties: {
    document_type: {
      type: "string",
      enum: Object.keys(DOCUMENT_TYPES),
      description:
        "Kind of document. utility_bill covers electricity, gas, water, landline and broadband bills. " +
        "Use other when none of the values fits.",
    },
    issuer_name: {
      type: "string",
      description: "Name of the company or organisation that issued the document, for example the bank, supplier or council.",
    },
    holder_name: {
      type: "string",
      description:
        "Full name of the person the document is addressed to, exactly as printed in the recipient address block, including any title or initials.",
    },
    holder_address: {
      type: "object",
      description: "Postal address of the person the document is addressed to. Never the issuer's own address.",
      properties: {
        lines: {
          type: "array",
          description:
            "Address lines as printed below the name, in order, without the name, the town and the postcode. " +
            "Keep flat or apartment numbers.",
          items: { type: "string" },
        },
        town: { type: "string", description: "Post town or city of the recipient address." },
        postcode: { type: "string", description: "Postcode of the recipient address, as printed." },
      },
      required: ["lines", "postcode"],
    },
    document_date: {
      type: "string",
      format: "date",
      description:
        "Date the document was issued: the bill date, statement date or date of issue. " +
        "Not a billing period start, a due date or a payment date. ISO format YYYY-MM-DD.",
    },
    account_reference: {
      type: "string",
      description: "Account number, customer number or reference printed on the document, as printed.",
    },
  },
  required: ["document_type", "issuer_name", "holder_name", "holder_address", "document_date"],
};

export const extractionInstructions =
  "This document was uploaded as proof of address for an identity check. " +
  "Extract the details of the person the document is addressed to. " +
  "If a field is not printed on the document, leave it out instead of guessing.";
