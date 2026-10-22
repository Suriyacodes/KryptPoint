
import io
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
)


def generate_pdf_report(analysis: dict) -> bytes:
    """Generate a PDF report for an image analysis."""
    buffer = io.BytesIO()

    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="KryptPoint Evidence Analysis Report",
    )

    styles = getSampleStyleSheet()
    story = []

    story.append(
        Paragraph("KryptPoint Evidence Analysis Report", styles["Title"])
    )
    story.append(Spacer(1, 8 * mm))

    created_at = analysis.get("created_at") or datetime.now(
        timezone.utc
    ).isoformat()

    fields = [
        ("Analysis ID", analysis.get("id", "Not assigned")),
        ("Timestamp (UTC)", created_at),
        ("SHA-256", analysis.get("file_sha256", "Unavailable")),
        ("Perceptual Hash", analysis.get("perceptual_hash", "Unavailable")),
        ("Verdict", analysis.get("verdict", "Inconclusive")),
        ("Model Output", analysis.get("model_output", "Unavailable")),
        ("Quality Warnings", analysis.get("quality_warnings", "None recorded")),
        ("Findings", analysis.get("findings", "None recorded")),
        ("Limitations", analysis.get("limitations", "Not specified")),
    ]

    for label, value in fields:
        safe_label = escape(str(label))
        safe_value = escape(str(value))
        story.append(
            Paragraph(
                f"<b>{safe_label}:</b> {safe_value}",
                styles["BodyText"],
            )
        )
        story.append(Spacer(1, 4 * mm))

    story.append(Spacer(1, 5 * mm))
    story.append(
        Paragraph(
            "<b>Important:</b> This report records an automated analysis. "
            "It does not independently prove that an image is authentic "
            "or manipulated. Results require appropriate human review.",
            styles["BodyText"],
        )
    )

    document.build(story)
    return buffer.getvalue()
