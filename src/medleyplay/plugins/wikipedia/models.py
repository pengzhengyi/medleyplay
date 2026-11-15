"""The parts of Wikidata's answers the plugin reads; anything else in them is ignored."""

from pydantic import BaseModel, ConfigDict


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")


class Hit(_Model):
    """An item a search found, by its id, such as `Q1299`."""

    title: str


class Hits(_Model):
    """The items a search found, best first."""

    search: list[Hit] = []


class Search(_Model):
    """A search's answer."""

    query: Hits = Hits()


class Term(_Model):
    """A label or an alias, in one language."""

    language: str
    value: str


class Entity(_Model):
    """An item: its id, and its label and aliases in each language asked for.

    An id Wikidata doesn't have answers with `missing`.
    """

    id: str = ""
    missing: str | None = None
    labels: dict[str, Term] = {}
    aliases: dict[str, list[Term]] = {}


class Entities(_Model):
    """The items asked for, by id; an item merged into another answers as that one."""

    entities: dict[str, Entity] = {}


class DataValue(_Model):
    """A statement's value: for an image, the name of its file on Wikimedia Commons."""

    value: object = None


class Snak(_Model):
    """What a statement says: a value, or that there is none or none known."""

    snaktype: str = "value"
    datavalue: DataValue | None = None


class Statement(_Model):
    """One statement of an item, and its rank: `preferred`, `normal`, or `deprecated`."""

    mainsnak: Snak
    rank: str = "normal"


class Claims(_Model):
    """An item's statements, by property."""

    claims: dict[str, list[Statement]] = {}
