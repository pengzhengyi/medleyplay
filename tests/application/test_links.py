"""Looking a link up and adding its parts, through the test plugin `tube`; see its table."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.links import LOOKUP_MEMORY, PartChoice, PartLookup, Reason
from medleyplay.domain.accounts import Account, AccountId
from medleyplay.domain.catalog import SourceState, TrackId
from medleyplay.domain.errors import InvalidInputError, OfflineError
from medleyplay.domain.jobs import JobState
from medleyplay.persistence.schema import SourceRow, TrackRow
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock, MemorySecrets
from tests.support.sites import Site, running_site

NIGHT_DRIVE = "https://www.bilibili.com/video/BV1Xx41117Tz"
MIXTAPE = "https://www.bilibili.com/video/BV17x411w7KC"


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def site(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, secrets: MemorySecrets
) -> Iterator[Site]:
    with running_site(units, clock, tmp_path / "data", secrets) as running:
        yield running


def _night_drive(title: str = "Night Drive") -> list[PartChoice]:
    return [PartChoice(1, title, "Blue Room")]


def _unreadable() -> list[PartChoice]:
    """The household's own details for a video the site could not be asked about."""
    return [PartChoice(1, "Night Drive", "Blue Room")]


def _duration_of(site: Site, track_id: int) -> int | None:
    return site.catalog.get_track(AccountId(1), TrackId(track_id)).details.duration_ms


def test_a_lookup_answers_the_videos_details_parts_and_qualities(
    site: Site, alice: Account
) -> None:
    lookup = site.links.lookup(alice, NIGHT_DRIVE)

    assert (lookup.kind, lookup.video, lookup.title, lookup.uploader) == (
        "bilibili",
        "BV1Xx41117Tz",
        "【MV】Night Drive",
        "Blue Room",
    )
    assert [(p.part, p.title, p.duration_ms, p.track_id) for p in lookup.parts] == [
        (1, "Night Drive", 1000, None)
    ]
    assert [q.id for q in lookup.qualities] == ["30280", "30232", "30216"]


def test_a_bare_video_code_looks_up_its_video(site: Site, alice: Account) -> None:
    assert site.links.lookup(alice, " BV1Xx41117Tz ").video == "BV1Xx41117Tz"


def test_a_short_link_looks_up_the_video_it_leads_to(site: Site, alice: Account) -> None:
    assert site.links.lookup(alice, "https://b23.tv/night").video == "BV1Xx41117Tz"


@pytest.mark.parametrize(
    "link",
    [
        "https://evil.example/video/BV1Xx41117Tz",
        "https://b23.tv/away",
        "https://b23.tv/liar",
        "https://www.bilibili.com/",
    ],
    ids=["another site", "a short link off the site", "a plugin naming another site", "no video"],
)
def test_a_link_that_is_not_a_bilibili_video_is_refused(
    site: Site, alice: Account, link: str
) -> None:
    with pytest.raises(InvalidInputError):
        site.links.lookup(alice, link)


@pytest.mark.parametrize(
    ("video", "reason", "why"),
    [
        ("BVgone", Reason.GONE, "removed"),
        ("BVmembers", Reason.NEEDS_LOGIN, "Members only"),
        ("BVdown", Reason.NETWORK, "couldn't be reached"),
        ("BVdenied", Reason.REFUSED, "refused the read"),
        ("BVbroken", Reason.FAULT, "The page changed"),
    ],
    ids=["gone", "needs a login", "network failure", "refusal", "fault"],
)
def test_a_video_that_cannot_be_read_still_answers_a_lookup_saying_why(
    site: Site, alice: Account, video: str, reason: Reason, why: str
) -> None:
    lookup = site.links.lookup(alice, f"https://www.bilibili.com/video/{video}")

    assert lookup.unreadable is not None
    assert lookup.unreadable.reason is reason
    assert why in lookup.unreadable.message
    assert (lookup.kind, lookup.video, lookup.title, lookup.uploader) == ("bilibili", video, "", "")
    assert lookup.qualities == ()


@pytest.mark.parametrize(
    ("link", "part"),
    [
        ("https://www.bilibili.com/video/BVdown?p=3", 3),
        ("https://www.bilibili.com/video/BVdown", 1),
    ],
    ids=["a part the link names", "part 1 when it names none"],
)
def test_an_unreadable_lookup_names_the_part_the_link_did_or_part_1(
    site: Site, alice: Account, link: str, part: int
) -> None:
    lookup = site.links.lookup(alice, link)

    assert lookup.parts == (PartLookup(part, "", None, None),)


def test_an_unreadable_lookup_shows_the_track_a_part_already_has(
    site: Site, alice: Account
) -> None:
    added = site.links.add(alice, "https://www.bilibili.com/video/BVdown", "best", _unreadable())

    lookup = site.links.lookup(alice, "https://www.bilibili.com/video/BVdown")

    assert lookup.parts[0].track_id == added[0].track_id


def test_a_readable_lookup_has_no_reason_it_could_not_be_read(site: Site, alice: Account) -> None:
    assert site.links.lookup(alice, NIGHT_DRIVE).unreadable is None


def test_a_failed_read_is_remembered_so_the_add_that_follows_does_not_read_again(
    site: Site, alice: Account
) -> None:
    flaky = "https://www.bilibili.com/video/BVflaky"
    site.links.lookup(alice, flaky)

    added = site.links.add(alice, flaky, "best", [PartChoice(1, "Night Drive", "Blue Room")])

    assert _duration_of(site, added[0].track_id) is None


def test_a_failed_read_is_forgotten_after_the_lookup_memory(
    site: Site, alice: Account, clock: FakeClock
) -> None:
    flaky = "https://www.bilibili.com/video/BVflaky"
    assert site.links.lookup(alice, flaky).unreadable is not None

    clock.advance(LOOKUP_MEMORY)

    assert site.links.lookup(alice, flaky).unreadable is None


def test_adding_makes_a_track_per_part_and_starts_each_download(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = site.links.add(
        alice,
        MIXTAPE,
        "30232",
        [PartChoice(1, "Side A", "Blue Room"), PartChoice(3, "Side C", "")],
    )

    with units() as db:
        tracks = {row.id: (row.title, row.artist) for row in db.scalars(select(TrackRow))}
        sources = {row.id: (row.locator, row.details) for row in db.scalars(select(SourceRow))}
    assert [tracks[each.track_id] for each in added] == [("Side A", "Blue Room"), ("Side C", "")]
    assert [sources[each.source_id] for each in added] == [
        ("BV17x411w7KC/p1", {"quality": "30232"}),
        ("BV17x411w7KC/p3", {"quality": "30232"}),
    ]
    assert [each.job.target if each.job else None for each in added] == [
        f"source:{added[0].source_id}",
        f"source:{added[1].source_id}",
    ]


def test_adding_again_returns_the_same_tracks_and_jobs(site: Site, alice: Account) -> None:
    first = site.links.add(alice, NIGHT_DRIVE, "best", _night_drive())

    again = site.links.add(alice, "https://b23.tv/night", "30216", _night_drive("Other"))

    assert [(a.track_id, a.source_id) for a in again] == [(f.track_id, f.source_id) for f in first]
    assert again[0].job is not None
    assert first[0].job is not None
    assert again[0].job.id == first[0].job.id


def test_a_lookup_shows_a_part_already_added(site: Site, alice: Account) -> None:
    added = site.links.add(alice, NIGHT_DRIVE, "best", _night_drive())

    lookup = site.links.lookup(alice, NIGHT_DRIVE)

    assert lookup.parts[0].track_id == added[0].track_id


@pytest.mark.parametrize(
    ("quality", "parts"),
    [
        ("best", [PartChoice(4, "Side D", "")]),
        ("99999", [PartChoice(1, "Side A", "")]),
        ("best", [PartChoice(1, "Side A", ""), PartChoice(1, "Again", "")]),
        ("best", []),
        ("best", [PartChoice(1, "  ", "")]),
        ("best", [PartChoice(1, "x" * 513, "")]),
    ],
    ids=["no such part", "no such quality", "a part twice", "no parts", "no title", "long title"],
)
def test_a_choice_the_video_does_not_offer_is_refused_and_adds_nothing(
    site: Site,
    alice: Account,
    units: sessionmaker[Session],
    quality: str,
    parts: list[PartChoice],
) -> None:
    with pytest.raises(InvalidInputError):
        site.links.add(alice, MIXTAPE, quality, parts)

    with units() as db:
        assert db.scalars(select(TrackRow)).all() == []


def test_offline_a_link_is_neither_looked_up_nor_added(site: Site, alice: Account) -> None:
    site.online.online = False

    with pytest.raises(OfflineError):
        site.links.lookup(alice, NIGHT_DRIVE)
    with pytest.raises(OfflineError):
        site.links.add(alice, NIGHT_DRIVE, "best", _night_drive())


def test_a_video_that_cannot_be_read_is_added_with_the_details_the_household_gave(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = site.links.add(
        alice,
        "https://www.bilibili.com/video/BVdown",
        "best",
        [PartChoice(2, "Side B", "Blue Room")],
    )

    with units() as db:
        track = db.get_one(TrackRow, added[0].track_id)
        source = db.get_one(SourceRow, added[0].source_id)
    assert (track.title, track.artist, track.duration_ms) == ("Side B", "Blue Room", None)
    assert (source.locator, source.details) == ("BVdown/p2", {"quality": "best"})
    assert added[0].job is not None


def test_a_video_the_site_says_is_gone_gets_one_attempt_and_its_source_becomes_unavailable(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = site.links.add(alice, "https://www.bilibili.com/video/BVgone", "best", _unreadable())

    assert added[0].job is not None
    assert site.wait_for(added[0].job.id, JobState.SUCCEEDED).job.state is JobState.SUCCEEDED
    with units() as db:
        assert db.get_one(SourceRow, added[0].source_id).state == SourceState.UNAVAILABLE


@pytest.mark.parametrize(
    ("quality", "parts"),
    [
        ("30280", [PartChoice(1, "Side A", "")]),
        ("best", [PartChoice(10_000, "Side A", "")]),
        ("best", [PartChoice(1, "Side A", ""), PartChoice(1, "Again", "")]),
        ("best", []),
        ("best", [PartChoice(1, "  ", "")]),
        ("best", [PartChoice(n, f"Side {n}", "") for n in range(1, 52)]),
    ],
    ids=["a quality", "no such part number", "a part twice", "no parts", "no title", "51 parts"],
)
def test_a_choice_for_an_unreadable_video_breaks_a_rule_and_adds_nothing(
    site: Site,
    alice: Account,
    units: sessionmaker[Session],
    quality: str,
    parts: list[PartChoice],
) -> None:
    with pytest.raises(InvalidInputError):
        site.links.add(alice, "https://www.bilibili.com/video/BVdown", quality, parts)

    with units() as db:
        assert db.scalars(select(TrackRow)).all() == []


def test_offline_an_unreadable_video_is_neither_looked_up_nor_added(
    site: Site, alice: Account
) -> None:
    site.online.online = False

    with pytest.raises(OfflineError):
        site.links.lookup(alice, "https://www.bilibili.com/video/BVdown")
    with pytest.raises(OfflineError):
        site.links.add(alice, "https://www.bilibili.com/video/BVdown", "best", _unreadable())
