"""The cover suggested for an album: an AI model's pick, else the first that matches it."""

from medleyplay.domain.album_covers import FoundRelease, suggested_cover


def _release(title: str, artist: str, cover: str) -> FoundRelease:
    return FoundRelease(title=title, artist=artist, cover=cover)


HELP_VINYL = _release("Help!", "The Beatles", "vinyl")
HELP_CD = _release("Help!", "The Beatles", "cd")
HELP_REMASTER = _release("Help! (2009 Remaster)", "The Beatles", "remaster")
HELP_ANTHOLOGY = _release("Help! Anthology", "The Beatles", "anthology")


def test_the_first_found_whose_title_and_artist_are_the_albums_is_suggested() -> None:
    found = (HELP_ANTHOLOGY, HELP_CD, HELP_VINYL)

    assert suggested_cover("Help!", ["The Beatles"], found, None, ()) == "cd"


def test_the_cover_an_ai_model_picked_is_suggested_before_any_other() -> None:
    found = (HELP_CD, HELP_ANTHOLOGY)

    assert suggested_cover("Help!", ["The Beatles"], found, "anthology", ()) == "anthology"


def test_a_title_matches_with_an_edition_note_set_aside_on_either_side() -> None:
    assert suggested_cover("Help!", ["The Beatles"], (HELP_REMASTER,), None, ()) == "remaster"
    assert suggested_cover("Help! (Deluxe Edition)", ["The Beatles"], (HELP_CD,), None, ()) == "cd"


def test_an_artist_matches_by_any_name_it_goes_by() -> None:
    by_alias = _release("Help!", "披头士", "alias")

    assert suggested_cover("Help!", ["The Beatles", "披头士"], (by_alias,), None, ()) == "alias"


def test_an_artist_matches_when_one_name_holds_the_other() -> None:
    featuring = _release("Help!", "The Beatles feat. Billy Preston", "featuring")

    assert suggested_cover("Help!", ["The Beatles"], (featuring,), None, ()) == "featuring"


def test_a_near_miss_is_not_suggested() -> None:
    found = (HELP_ANTHOLOGY, _release("Help!", "Oasis", "oasis"))

    assert suggested_cover("Help!", ["The Beatles"], found, None, ()) is None


def test_a_dismissed_cover_is_never_suggested_not_even_when_picked() -> None:
    found = (HELP_CD, HELP_VINYL)

    assert suggested_cover("Help!", ["The Beatles"], found, "cd", ("cd",)) == "vinyl"
    assert suggested_cover("Help!", ["The Beatles"], found, None, ("cd", "vinyl")) is None
