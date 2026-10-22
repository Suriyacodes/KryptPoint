
import sqlite3
from pathlib import Path

# Store the database inside the KryptPoint project folder
PROJECT_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = PROJECT_DIR / "kryptpoint.db"


def get_connection():
    """Create a connection to the SQLite database."""
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    """Create the analysis table if it does not already exist."""
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                file_sha256 TEXT NOT NULL,
                perceptual_hash TEXT,
                verdict TEXT NOT NULL,
                model_output TEXT,
                quality_warnings TEXT,
                findings TEXT,
                limitations TEXT
            )
            """
        )


def save_analysis(
    created_at,
    file_sha256,
    perceptual_hash,
    verdict,
    model_output,
    quality_warnings,
    findings,
    limitations,
):
    """Save one image analysis and return its database ID."""
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO analyses (
                created_at,
                file_sha256,
                perceptual_hash,
                verdict,
                model_output,
                quality_warnings,
                findings,
                limitations
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                file_sha256,
                perceptual_hash,
                verdict,
                model_output,
                quality_warnings,
                findings,
                limitations,
            ),
        )
        return cursor.lastrowid


def get_recent_analyses(limit=20):
    """Return recent analysis records without exposing local file paths."""
    limit = max(1, min(int(limit), 100))

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, created_at, file_sha256, verdict
            FROM analyses
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

        return [dict(row) for row in rows]


def get_analysis(analysis_id):
    """Return one analysis record, or None if it does not exist."""
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM analyses WHERE id = ?",
            (analysis_id,),
        ).fetchone()

        return dict(row) if row else None
