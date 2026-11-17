"""The types of the ids taken from a request."""

from typing import Annotated

from fastapi import Path
from pydantic import Field

RowId = Annotated[int, Field(ge=1, le=2**63 - 1)]
"""An id of a row in the database: positive, and no larger than SQLite's 64-bit INTEGER holds."""

ArtistIdPath = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]
"""The id of one of the Library's artists, taken from a request's path: 32 hex digits."""
