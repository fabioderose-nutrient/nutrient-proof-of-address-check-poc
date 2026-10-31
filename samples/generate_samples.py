"""Generate the fictitious proof-of-address samples and their manifest.

Every company, person, address and number below is invented. The postcodes use the
area code "HV", which does not exist.

Usage:
    pip install -r samples/requirements.txt
    python samples/generate_samples.py
"""

import json
import os
import random

import reportlab
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE_W, PAGE_H = A4

# ---------------------------------------------------------------------------
# Scenario data: what is printed on each document, what the applicant typed,
# and the decision the rules should reach.
# ---------------------------------------------------------------------------

SAMPLES = [
    {
        "file": "01-electricity-bill.pdf",
        "title": "Electricity bill",
        "printed": {
            "document_type": "utility_bill",
            "issuer_name": "Larkfield Energy Ltd",
            "holder_name": "Mrs Eleanor M Whitcombe",
            "address_lines": ["Flat 3", "27 Kingsmere Road", "Ashbury"],
            "town": "Halverton",
            "postcode": "HV4 7QT",
            "document_date": "2026-10-06",
            "account_reference": "8041 2277 935",
        },
        "applicant": {
            "fullName": "Eleanor Mary Whitcombe",
            "addressLine1": "Flat 3, 27 Kingsmere Rd",
            "addressLine2": "Ashbury",
            "town": "Halverton",
            "postcode": "HV4 7QT",
            "applicationDate": "2026-10-28",
        },
        "expected": {
            "decision": "accept",
            "note": "Middle initial on the bill, 'Rd' typed for 'Road'.",
        },
    },
    {
        "file": "02-bank-statement.pdf",
        "title": "Bank statement, first page",
        "printed": {
            "document_type": "bank_statement",
            "issuer_name": "Fernvale Bank plc",
            "holder_name": "MR JOSE ALVAREZ ROMERO",
            "address_lines": ["14 ST ALBANS AVENUE", "MILLBROOK"],
            "town": "HALVERTON",
            "postcode": "HV2 9LP",
            "document_date": "2026-10-01",
            "account_reference": "61842093",
        },
        "applicant": {
            "fullName": "José Álvarez Romero",
            "addressLine1": "14 Saint Albans Ave",
            "addressLine2": "Millbrook",
            "town": "Halverton",
            "postcode": "HV2 9LP",
            "applicationDate": "2026-10-28",
        },
        "expected": {
            "decision": "accept",
            "note": "Accents typed by the applicant, capitals and 'ST' on the statement.",
        },
    },
    {
        "file": "03-council-tax-bill.pdf",
        "title": "Council tax bill",
        "printed": {
            "document_type": "council_tax_bill",
            "issuer_name": "Halverton District Council",
            "holder_name": "Ms Kate Ashdown",
            "address_lines": ["Flat 2", "9 Orchard Court", "Mill Lane"],
            "town": "Halverton",
            "postcode": "HV1 3HD",
            "document_date": "2026-09-14",
            "account_reference": "6002 41187",
        },
        "applicant": {
            "fullName": "Katherine Ashdown",
            "addressLine1": "Apartment 2, 9 Orchard Ct",
            "addressLine2": "Mill Ln",
            "town": "Halverton",
            "postcode": "HV1 3HD",
            "applicationDate": "2026-10-28",
        },
        "expected": {
            "decision": "review",
            "note": "The bill uses the short form 'Kate'; a person confirms it is the same applicant.",
        },
    },
    {
        "file": "04-water-bill-photo.jpg",
        "title": "Phone photo of a water bill",
        "printed": {
            "document_type": "utility_bill",
            "issuer_name": "Greyfield Water Services",
            "holder_name": "Ms Priya Natarajan",
            "address_lines": ["22 Heron Way", "Eastcliff"],
            "town": "Halverton",
            "postcode": "HV3 5RS",
            "document_date": "2026-09-22",
            "account_reference": "GW-55190-3382",
        },
        "applicant": {
            "fullName": "Priya Natarajan",
            "addressLine1": "22 Heron Way",
            "addressLine2": "Eastcliff",
            "town": "Halverton",
            "postcode": "HV3 5RS",
            "applicationDate": "2026-10-28",
        },
        "expected": {
            "decision": "accept",
            "note": "Photographed at an angle, with a shadow across the page.",
        },
    },
    {
        "file": "05-old-broadband-bill.pdf",
        "title": "Broadband bill older than 3 months",
        "printed": {
            "document_type": "utility_bill",
            "issuer_name": "Northgate Broadband Ltd",
            "holder_name": "Mr Samuel Okafor",
            "address_lines": ["5 Beacon Street"],
            "town": "Halverton",
            "postcode": "HV2 4NE",
            "document_date": "2026-05-11",
            "account_reference": "NB-30418827",
        },
        "applicant": {
            "fullName": "Samuel Okafor",
            "addressLine1": "5 Beacon St",
            "addressLine2": "",
            "town": "Halverton",
            "postcode": "HV2 4NE",
            "applicationDate": "2026-10-28",
        },
        "expected": {
            "decision": "reject",
            "note": "Dated 11 May 2026, more than 3 months before the application.",
        },
    },
    {
        "file": "06-gas-bill-other-person.pdf",
        "title": "Gas bill for another person",
        "printed": {
            "document_type": "utility_bill",
            "issuer_name": "Copperleaf Gas Ltd",
            "holder_name": "Mrs Margaret Whitcombe",
            "address_lines": ["Flat 3", "27 Kingsmere Road", "Ashbury"],
            "town": "Halverton",
            "postcode": "HV4 7QT",
            "document_date": "2026-10-09",
            "account_reference": "CG 7719 0442 18",
        },
        "applicant": {
            "fullName": "Eleanor Mary Whitcombe",
            "addressLine1": "Flat 3, 27 Kingsmere Road",
            "addressLine2": "Ashbury",
            "town": "Halverton",
            "postcode": "HV4 7QT",
            "applicationDate": "2026-10-28",
        },
        "expected": {
            "decision": "reject",
            "note": "Same address and surname, but the bill is addressed to Margaret, not Eleanor.",
        },
    },
]


def long_date(iso):
    import datetime

    d = datetime.date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%B %Y')}"


# ---------------------------------------------------------------------------
# PDF helpers (ReportLab, standard fonts)
# ---------------------------------------------------------------------------


def header_band(c, name, subtitle, color):
    c.setFillColor(color)
    c.rect(0, PAGE_H - 32 * mm, PAGE_W, 32 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(18 * mm, PAGE_H - 17 * mm, name)
    c.setFont("Helvetica", 10)
    c.drawString(18 * mm, PAGE_H - 24 * mm, subtitle)


def return_address(c, lines, y):
    c.setFillColor(colors.HexColor("#555555"))
    c.setFont("Helvetica", 7.5)
    c.drawString(20 * mm, y, ", ".join(lines))


def address_block(c, sample, x, y, upper=False):
    p = sample["printed"]
    lines = [p["holder_name"], *p["address_lines"], p["town"], p["postcode"]]
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 11)
    for i, line in enumerate(lines):
        c.drawString(x, y - i * 5.2 * mm, line.upper() if upper else line)
    return y - len(lines) * 5.2 * mm


def key_values(c, rows, x, y, label_w=42 * mm, size=9.5):
    for i, (label, value) in enumerate(rows):
        c.setFont("Helvetica", size)
        c.setFillColor(colors.HexColor("#444444"))
        c.drawString(x, y - i * 5.4 * mm, label)
        c.setFont("Helvetica-Bold", size)
        c.setFillColor(colors.black)
        c.drawString(x + label_w, y - i * 5.4 * mm, value)


def table(c, x, y, widths, rows, header_color, size=9, row_h=6.4 * mm, right_from=None):
    """Draw a simple table. Columns from index right_from (default: the last one) are right-aligned."""
    right_from = len(widths) - 1 if right_from is None else right_from
    total_w = sum(widths)
    for r, row in enumerate(rows):
        top = y - r * row_h
        if r == 0:
            c.setFillColor(header_color)
            c.rect(x, top - row_h + 1.6 * mm, total_w, row_h, stroke=0, fill=1)
            c.setFillColor(colors.white)
            c.setFont("Helvetica-Bold", size)
        else:
            c.setFillColor(colors.black)
            c.setFont("Helvetica", size)
            c.setStrokeColor(colors.HexColor("#dddddd"))
            c.line(x, top - row_h + 1.6 * mm, x + total_w, top - row_h + 1.6 * mm)
        cx = x
        for i, cell in enumerate(row):
            if i >= right_from:
                c.drawRightString(cx + widths[i] - 2 * mm, top - row_h + 3.4 * mm, cell)
            else:
                c.drawString(cx + 2 * mm, top - row_h + 3.4 * mm, cell)
            cx += widths[i]
    return y - len(rows) * row_h


def footer(c, text):
    c.setFillColor(colors.HexColor("#777777"))
    c.setFont("Helvetica", 7)
    c.drawString(18 * mm, 12 * mm, text)


def new_canvas(path, title):
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle(title)
    c.setAuthor("Sample generator")
    c.setCreator("Proof of address sample generator")
    return c


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


def electricity_bill(sample, path):
    p = sample["printed"]
    c = new_canvas(path, "Electricity bill")
    header_band(c, p["issuer_name"], "Your electricity bill", colors.HexColor("#1f5f8b"))
    return_address(c, ["Larkfield House", "2 Quarry Lane", "Halverton HV9 1AA"], PAGE_H - 44 * mm)
    address_block(c, sample, 20 * mm, PAGE_H - 52 * mm)
    key_values(
        c,
        [
            ("Bill date", long_date(p["document_date"])),
            ("Account number", p["account_reference"]),
            ("Billing period", "1 September to 30 September 2026"),
            ("Tariff", "Standard Variable"),
            ("Meter", "E19K 044712"),
        ],
        112 * mm,
        PAGE_H - 52 * mm,
        label_w=32 * mm,
    )
    y = PAGE_H - 102 * mm
    c.setFont("Helvetica-Bold", 13)
    c.drawString(18 * mm, y, "Summary of your account")
    table(
        c,
        18 * mm,
        y - 4 * mm,
        [120 * mm, 54 * mm],
        [
            ["Description", "Amount"],
            ["Balance brought forward", "0.00"],
            ["Electricity used, 212 kWh at 24.50p", "51.94"],
            ["Standing charge, 30 days at 53.35p", "16.01"],
            ["VAT at 5%", "3.40"],
            ["Total charges this period", "71.35"],
            ["Paid by Direct Debit on 15 October 2026", "-71.35"],
            ["Balance", "0.00"],
        ],
        colors.HexColor("#1f5f8b"),
    )
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.black)
    text = c.beginText(18 * mm, PAGE_H - 170 * mm)
    text.setLeading(12)
    for line in [
        "Your next meter reading is due in December. Submit it online or by phone.",
        "If you are worried about paying your bill, contact us early. We can help.",
        "Emergency number for power cuts: 0800 000 0105 (fictitious).",
    ]:
        text.textLine(line)
    c.drawText(text)
    footer(c, "Larkfield Energy Ltd is a fictitious company created for this demo. Registered office: Larkfield House, Halverton HV9 1AA.")
    c.showPage()
    c.save()


def bank_statement(sample, path):
    p = sample["printed"]
    c = new_canvas(path, "Bank statement")
    green = colors.HexColor("#2e6b4f")
    c.setFillColor(green)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(18 * mm, PAGE_H - 22 * mm, p["issuer_name"].replace(" plc", ""))
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#444444"))
    c.drawString(18 * mm, PAGE_H - 28 * mm, "Fernvale Bank plc, 40 Market Square, Halverton HV1 2BX")
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 14)
    c.drawRightString(PAGE_W - 18 * mm, PAGE_H - 22 * mm, "Current account statement")
    c.setFont("Helvetica", 9)
    c.drawRightString(PAGE_W - 18 * mm, PAGE_H - 28 * mm, "Page 1 of 2")
    address_block(c, sample, 20 * mm, PAGE_H - 50 * mm)
    key_values(
        c,
        [
            ("Statement date", long_date(p["document_date"])),
            ("Statement period", "2 Sep 2026 to 1 Oct 2026"),
            ("Sort code", "30-91-47"),
            ("Account number", p["account_reference"]),
            ("Account name", "MR J ALVAREZ ROMERO"),
        ],
        112 * mm,
        PAGE_H - 50 * mm,
        label_w=32 * mm,
    )
    y = PAGE_H - 96 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(18 * mm, y, "Your transactions")
    table(
        c,
        18 * mm,
        y - 4 * mm,
        [24 * mm, 82 * mm, 22 * mm, 22 * mm, 24 * mm],
        [
            ["Date", "Description", "Paid out", "Paid in", "Balance"],
            ["02 Sep", "Balance brought forward", "", "", "1,482.16"],
            ["03 Sep", "CARD PAYMENT GREENGROCER HALVERTON", "23.40", "", "1,458.76"],
            ["05 Sep", "DIRECT DEBIT LARKFIELD ENERGY", "64.10", "", "1,394.66"],
            ["08 Sep", "STANDING ORDER RENT ORCHARD LETTINGS", "875.00", "", "519.66"],
            ["12 Sep", "TRANSFER FROM SAVINGS", "", "300.00", "819.66"],
            ["15 Sep", "CARD PAYMENT HALVERTON RAIL", "42.80", "", "776.86"],
            ["19 Sep", "CARD PAYMENT BOOKSHOP MILLBROOK", "16.99", "", "759.87"],
            ["24 Sep", "DIRECT DEBIT GREYFIELD WATER", "31.20", "", "728.67"],
            ["26 Sep", "SALARY NORTHMERE TOOLING LTD", "", "2,214.55", "2,943.22"],
            ["29 Sep", "CARD PAYMENT CORNER CAFE", "8.40", "", "2,934.82"],
            ["01 Oct", "Balance carried forward", "", "", "2,934.82"],
        ],
        green,
        size=8.5,
        right_from=2,
    )
    footer(c, "Fernvale Bank plc is a fictitious bank created for this demo. Calls may be recorded. Statement continues on page 2.")
    c.showPage()
    c.save()


def council_tax_bill(sample, path):
    p = sample["printed"]
    c = new_canvas(path, "Council tax bill")
    purple = colors.HexColor("#4b3f72")
    header_band(c, p["issuer_name"], "Council Tax bill 2026/27 - revised after a change of liability", purple)
    return_address(c, ["Council Offices", "Bridge Street", "Halverton HV1 4CT"], PAGE_H - 44 * mm)
    address_block(c, sample, 20 * mm, PAGE_H - 52 * mm)
    key_values(
        c,
        [
            ("Date of issue", long_date(p["document_date"])),
            ("Account reference", p["account_reference"]),
            ("Property reference", "HV-0091-0002-C"),
            ("Valuation band", "C"),
            ("Liable from", "1 September 2026"),
        ],
        112 * mm,
        PAGE_H - 52 * mm,
        label_w=34 * mm,
    )
    y = PAGE_H - 108 * mm
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(colors.black)
    c.drawString(18 * mm, y, "How your charge is calculated")
    table(
        c,
        18 * mm,
        y - 4 * mm,
        [120 * mm, 54 * mm],
        [
            ["Charge", "Amount"],
            ["Halverton District Council, band C", "1,394.12"],
            ["Westmoor County Council", "312.40"],
            ["Westmoor Fire and Rescue", "84.66"],
            ["Annual charge, 1 Sep 2026 to 31 Mar 2027 (7 months)", "1,045.51"],
            ["Single person discount (25%)", "-261.38"],
            ["Amount payable", "784.13"],
        ],
        purple,
    )
    c.setFont("Helvetica", 9)
    text = c.beginText(18 * mm, PAGE_H - 170 * mm)
    text.setLeading(12)
    for line in [
        "Instalments: 7 monthly payments of 112.03 on the 1st of each month, from 1 October 2026.",
        "Tell us within 21 days if anyone else aged 18 or over moves into the property.",
    ]:
        text.textLine(line)
    c.drawText(text)
    footer(c, "Halverton District Council is a fictitious authority created for this demo.")
    c.showPage()
    c.save()


def broadband_bill(sample, path):
    p = sample["printed"]
    c = new_canvas(path, "Broadband bill")
    orange = colors.HexColor("#b4532a")
    header_band(c, p["issuer_name"], "Broadband and home phone bill", orange)
    return_address(c, ["Northgate Broadband Ltd", "Unit 7, Signal Park", "Halverton HV8 2TT"], PAGE_H - 44 * mm)
    address_block(c, sample, 20 * mm, PAGE_H - 52 * mm)
    key_values(
        c,
        [
            ("Bill date", long_date(p["document_date"])),
            ("Account number", p["account_reference"]),
            ("Phone number", "01632 960 418"),
            ("Package", "Fibre 150 with anytime calls"),
        ],
        112 * mm,
        PAGE_H - 52 * mm,
        label_w=30 * mm,
    )
    y = PAGE_H - 102 * mm
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(colors.black)
    c.drawString(18 * mm, y, "Your bill this month")
    table(
        c,
        18 * mm,
        y - 4 * mm,
        [120 * mm, 54 * mm],
        [
            ["Item", "Amount"],
            ["Fibre 150 broadband, 11 May to 10 Jun 2026", "32.00"],
            ["Home phone line rental", "9.50"],
            ["Calls to mobiles", "2.18"],
            ["Total including VAT", "43.68"],
        ],
        orange,
    )
    footer(c, "Northgate Broadband Ltd is a fictitious company created for this demo.")
    c.showPage()
    c.save()


def gas_bill(sample, path):
    p = sample["printed"]
    c = new_canvas(path, "Gas bill")
    teal = colors.HexColor("#2b6f73")
    header_band(c, p["issuer_name"], "Your gas statement", teal)
    return_address(c, ["Copperleaf Gas Ltd", "Freepost HV 3381", "Halverton HV7 6GG"], PAGE_H - 44 * mm)
    address_block(c, sample, 20 * mm, PAGE_H - 52 * mm)
    key_values(
        c,
        [
            ("Statement date", long_date(p["document_date"])),
            ("Customer number", p["account_reference"]),
            ("Period", "8 Sep to 7 Oct 2026"),
            ("Meter serial", "G4A 00917733"),
        ],
        112 * mm,
        PAGE_H - 52 * mm,
        label_w=32 * mm,
    )
    y = PAGE_H - 106 * mm
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(colors.black)
    c.drawString(18 * mm, y, "Gas used")
    table(
        c,
        18 * mm,
        y - 4 * mm,
        [120 * mm, 54 * mm],
        [
            ["Description", "Amount"],
            ["Gas used, 418 kWh at 6.24p", "26.08"],
            ["Standing charge, 30 days at 31.65p", "9.50"],
            ["VAT at 5%", "1.78"],
            ["Total", "37.36"],
        ],
        teal,
    )
    footer(c, "Copperleaf Gas Ltd is a fictitious company created for this demo.")
    c.showPage()
    c.save()


# ---------------------------------------------------------------------------
# Phone photo of a letter (Pillow): render, warp, shadow, noise, JPEG
# ---------------------------------------------------------------------------


def font(name, size):
    base = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
    return ImageFont.truetype(os.path.join(base, name), size)


def render_letter_image(sample):
    p = sample["printed"]
    w, h = 1240, 1754  # A4 at 150 dpi
    img = Image.new("RGB", (w, h), (250, 249, 245))
    d = ImageDraw.Draw(img)
    blue = (28, 92, 120)
    d.rectangle([0, 0, w, 150], fill=blue)
    d.text((90, 40), p["issuer_name"], font=font("VeraBd.ttf", 46), fill="white")
    d.text((90, 100), "Your water and sewerage bill", font=font("Vera.ttf", 24), fill="white")
    d.text((90, 210), "Greyfield Water Services, Riverside Works, Halverton HV6 3WW", font=font("Vera.ttf", 17), fill=(90, 90, 90))
    y = 260
    for line in [p["holder_name"], *p["address_lines"], p["town"], p["postcode"]]:
        d.text((100, y), line, font=font("Vera.ttf", 30), fill=(20, 20, 20))
        y += 42
    kv = [
        ("Bill date", long_date(p["document_date"])),
        ("Customer reference", p["account_reference"]),
        ("Charges from", "1 April 2026 to 30 September 2026"),
    ]
    y = 270
    for label, value in kv:
        d.text((700, y), label, font=font("Vera.ttf", 22), fill=(70, 70, 70))
        d.text((700, y + 28), value, font=font("VeraBd.ttf", 24), fill=(10, 10, 10))
        y += 74
    y = 620
    d.text((90, y), "Your charges", font=font("VeraBd.ttf", 30), fill=(10, 10, 10))
    y += 60
    rows = [
        ("Water supply, 41 cubic metres", "78.31"),
        ("Sewerage, 39 cubic metres", "96.72"),
        ("Standing charges", "24.10"),
        ("Total for this period", "199.13"),
    ]
    for label, value in rows:
        d.text((90, y), label, font=font("Vera.ttf", 26), fill=(20, 20, 20))
        d.text((1050, y), value, font=font("Vera.ttf", 26), fill=(20, 20, 20), anchor="ra")
        d.line([(90, y + 42), (1150, y + 42)], fill=(200, 200, 200), width=2)
        y += 56
    y += 40
    for line in [
        "We will collect 33.19 by Direct Debit on the 1st of each month.",
        "Check for leaks: if your usage looks high, call us on 0800 000 0466 (fictitious).",
        "Greyfield Water Services is a fictitious company created for this demo.",
    ]:
        d.text((90, y), line, font=font("Vera.ttf", 22), fill=(40, 40, 40))
        y += 38
    return img


def solve(a, b):
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[pivot] = m[pivot], m[col]
        for r in range(n):
            if r != col:
                f = m[r][col] / m[col][col]
                m[r] = [x - f * y for x, y in zip(m[r], m[col])]
    return [m[i][n] / m[i][i] for i in range(n)]


def perspective_coeffs(dst, src):
    """Coefficients that map output points (dst) to input points (src) for Image.PERSPECTIVE."""
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b.append(v)
    return solve(a, b)


def phone_photo(sample, path):
    rnd = random.Random(7)
    letter = render_letter_image(sample)
    lw, lh = letter.size
    out_w, out_h = 1500, 2000

    # Table surface: warm grey-brown gradient with grain
    bg = Image.new("RGB", (out_w, out_h))
    px = bg.load()
    for y in range(out_h):
        for x in range(out_w):
            g = int(18 * ((x + y) / (out_w + out_h)))
            grain = rnd.randint(-6, 6) + (4 if (y // 9) % 7 == 0 else 0)
            px[x, y] = (112 - g + grain, 92 - g + grain, 74 - g + grain)

    # Where the four corners of the page land in the photo (slight keystone and rotation)
    quad = [(205, 170), (1335, 236), (1408, 1830), (118, 1762)]
    coeffs = perspective_coeffs(quad, [(0, 0), (lw, 0), (lw, lh), (0, lh)])
    warped = letter.transform((out_w, out_h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", (lw, lh), 255).transform((out_w, out_h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)

    # Soft drop shadow under the paper
    shadow = Image.new("L", (out_w, out_h), 0)
    ImageDraw.Draw(shadow).polygon([(x + 18, y + 22) for x, y in quad], fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    bg.paste((40, 32, 26), (0, 0), shadow)
    bg.paste(warped, (0, 0), mask)

    # Shadow of the phone and hand across the right half of the page, over the bill date
    cast = Image.new("L", (out_w, out_h), 0)
    ImageDraw.Draw(cast).polygon([(1500, 360), (1000, 700), (640, 2000), (1500, 2000)], fill=115)
    cast = cast.filter(ImageFilter.GaussianBlur(70))
    bg.paste((25, 25, 30), (0, 0), cast)

    # Uneven light: brighter top left
    light = Image.radial_gradient("L").resize((out_w * 2, out_h * 2)).crop((0, 0, out_w, out_h))
    bg = Image.composite(bg, Image.new("RGB", (out_w, out_h), (30, 30, 30)), light.point(lambda v: 255 - int(v * 0.35)))

    # Camera softness and sensor noise
    bg = bg.filter(ImageFilter.GaussianBlur(0.8))
    noise = Image.effect_noise((out_w, out_h), 10).convert("RGB")
    bg = Image.blend(bg, noise, 0.05)
    bg.save(path, "JPEG", quality=80, optimize=True)


def main():
    builders = {
        "01-electricity-bill.pdf": electricity_bill,
        "02-bank-statement.pdf": bank_statement,
        "03-council-tax-bill.pdf": council_tax_bill,
        "04-water-bill-photo.jpg": phone_photo,
        "05-old-broadband-bill.pdf": broadband_bill,
        "06-gas-bill-other-person.pdf": gas_bill,
    }
    for sample in SAMPLES:
        path = os.path.join(HERE, sample["file"])
        builders[sample["file"]](sample, path)
        print(f"wrote {sample['file']} ({os.path.getsize(path) // 1024} KB)")

    manifest = [
        {
            "file": s["file"],
            "title": s["title"],
            "applicant": s["applicant"],
            "expected": s["expected"],
            "truth": s["printed"],
        }
        for s in SAMPLES
    ]
    with open(os.path.join(HERE, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("wrote manifest.json")


if __name__ == "__main__":
    main()
