"""The AI provider service: an admin's address and model in the catalog, the key in the Keychain."""

from collections.abc import Callable

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.ai import AiService, AiSetting, is_set_up
from medleyplay.domain.errors import (
    ForbiddenError,
    InvalidInputError,
    KeychainUnavailableError,
    NotFoundError,
)
from medleyplay.persistence.schema import AiSettingRow
from medleyplay.plugin_api import AiEndpoint
from tests.support.ai import KEY
from tests.support.factories import AccountFactory
from tests.support.fakes import FakeClock, MemorySecrets

ADMIN = AccountFactory.admin()
MEMBER = AccountFactory.member()
DEEPSEEK = "https://api.deepseek.com"
OLLAMA = "http://127.0.0.1:11434/v1"


@pytest.fixture
def ai(units: sessionmaker[Session], clock: FakeClock, secrets: MemorySecrets) -> AiService:
    return AiService(units, clock, secrets)


def _set_up_deepseek(ai: AiService) -> AiSetting:
    return ai.save(ADMIN, DEEPSEEK, "deepseek-chat", KEY)


def test_nothing_is_set_up_at_first(ai: AiService, units: sessionmaker[Session]) -> None:
    with units() as db:
        assert ai.get(ADMIN) is None
        assert ai.endpoint() is None
        assert not is_set_up(db)


def test_saving_keeps_the_key_in_the_keychain_and_the_address_and_model_in_the_catalog(
    ai: AiService, secrets: MemorySecrets, units: sessionmaker[Session], clock: FakeClock
) -> None:
    saved = _set_up_deepseek(ai)

    assert saved == AiSetting(DEEPSEEK, "deepseek-chat", has_key=True, saved_at=clock.now)
    assert secrets.items == {"ai:key": KEY}
    with units() as db:
        row = db.get_one(AiSettingRow, 1)
        assert (row.base_url, row.model, row.has_key) == (DEEPSEEK, "deepseek-chat", True)
        assert is_set_up(db)


def test_the_key_is_in_no_table(ai: AiService, units: sessionmaker[Session]) -> None:
    _set_up_deepseek(ai)

    with units() as db:
        tables = db.scalars(text("SELECT name FROM sqlite_master WHERE type = 'table'")).all()
        dump = [db.execute(text(f"SELECT * FROM {table}")).all() for table in tables]  # noqa: S608 -- names from sqlite_master

    assert KEY not in repr(dump)


def test_the_keychain_is_written_before_the_row(
    ai: AiService, secrets: MemorySecrets, units: sessionmaker[Session]
) -> None:
    rows_when_keeping: list[int] = []

    def count_rows() -> None:
        with units() as db:
            rows_when_keeping.append(len(db.execute(text("SELECT * FROM ai_setting")).all()))

    secrets.while_setting = count_rows

    _set_up_deepseek(ai)

    assert rows_when_keeping == [0]


def test_the_base_url_is_kept_without_its_trailing_slash(ai: AiService) -> None:
    saved = ai.save(ADMIN, "https://api.openai.com/v1/", "gpt-4o-mini", KEY)

    assert saved.base_url == "https://api.openai.com/v1"


def test_a_local_provider_is_set_up_without_a_key(ai: AiService, secrets: MemorySecrets) -> None:
    saved = ai.save(ADMIN, OLLAMA, "llama3.2", None)

    assert saved.has_key is False
    assert secrets.items == {}
    assert ai.endpoint() == AiEndpoint(base_url=OLLAMA, model="llama3.2")


def test_saving_again_without_a_key_keeps_the_key_it_has(
    ai: AiService, secrets: MemorySecrets
) -> None:
    _set_up_deepseek(ai)

    saved = ai.save(ADMIN, DEEPSEEK, "deepseek-reasoner", None)

    assert (saved.model, saved.has_key) == ("deepseek-reasoner", True)
    assert secrets.items == {"ai:key": KEY}


def test_saving_again_with_a_key_replaces_the_key(ai: AiService, secrets: MemorySecrets) -> None:
    _set_up_deepseek(ai)

    ai.save(ADMIN, DEEPSEEK, "deepseek-chat", "sk-newkey1234")

    assert secrets.items == {"ai:key": "sk-newkey1234"}


def test_saving_trims_the_key(ai: AiService, secrets: MemorySecrets) -> None:
    ai.save(ADMIN, DEEPSEEK, "deepseek-chat", f"  {KEY}\n")

    assert secrets.items == {"ai:key": KEY}


@pytest.mark.parametrize(
    ("base_url", "model", "key"),
    [
        ("http://api.deepseek.com", "deepseek-chat", KEY),
        ("https://alice:pw@api.deepseek.com", "deepseek-chat", KEY),
        (DEEPSEEK, "", KEY),
        (DEEPSEEK, "deepseek chat", KEY),
        (DEEPSEEK, "deepseek-chat", "k"),
        (DEEPSEEK, "deepseek-chat", "sk-with a space"),
    ],
    ids=[
        "plain http",
        "a login",
        "no model",
        "a model with a space",
        "a short key",
        "a spaced key",
    ],
)
def test_a_setting_that_breaks_a_rule_is_refused_and_changes_nothing(
    ai: AiService, secrets: MemorySecrets, base_url: str, model: str, key: str
) -> None:
    with pytest.raises(InvalidInputError):
        ai.save(ADMIN, base_url, model, key)

    assert (ai.get(ADMIN), secrets.items) == (None, {})


def test_a_refused_key_is_not_repeated_in_the_reason(ai: AiService) -> None:
    with pytest.raises(InvalidInputError) as refused:
        ai.save(ADMIN, DEEPSEEK, "deepseek-chat", "sk-with a space")

    assert "sk-with" not in str(refused.value)


def test_removing_the_key_keeps_the_address_and_model(
    ai: AiService, secrets: MemorySecrets
) -> None:
    _set_up_deepseek(ai)

    removed = ai.remove_key(ADMIN)

    assert (removed.base_url, removed.model, removed.has_key) == (DEEPSEEK, "deepseek-chat", False)
    assert secrets.items == {}


def test_removing_the_key_of_a_provider_never_set_up_is_refused(ai: AiService) -> None:
    with pytest.raises(NotFoundError, match="not set up"):
        ai.remove_key(ADMIN)


def test_removing_the_provider_forgets_its_key_too(
    ai: AiService, secrets: MemorySecrets, units: sessionmaker[Session]
) -> None:
    _set_up_deepseek(ai)

    ai.remove(ADMIN)
    ai.remove(ADMIN)

    assert (ai.get(ADMIN), secrets.items) == (None, {})
    with units() as db:
        assert not is_set_up(db)


@pytest.mark.parametrize(
    "act",
    [
        lambda ai: ai.get(MEMBER),
        lambda ai: ai.save(MEMBER, DEEPSEEK, "deepseek-chat", KEY),
        lambda ai: ai.remove_key(MEMBER),
        lambda ai: ai.remove(MEMBER),
    ],
    ids=["showing it", "saving it", "removing the key", "removing it"],
)
def test_only_an_admin_manages_the_provider(
    ai: AiService, act: Callable[[AiService], object]
) -> None:
    with pytest.raises(ForbiddenError):
        act(ai)


def test_a_job_is_lent_the_address_the_model_and_the_key(ai: AiService) -> None:
    _set_up_deepseek(ai)

    assert ai.endpoint() == AiEndpoint(base_url=DEEPSEEK, model="deepseek-chat", key=KEY)


def test_a_key_the_keychain_no_longer_holds_is_a_keychain_that_must_be_set_again(
    ai: AiService, secrets: MemorySecrets
) -> None:
    _set_up_deepseek(ai)
    secrets.items.clear()

    with pytest.raises(KeychainUnavailableError, match="enter it again"):
        ai.endpoint()


def test_a_locked_keychain_is_reported_when_the_key_is_lent(
    ai: AiService, secrets: MemorySecrets
) -> None:
    _set_up_deepseek(ai)
    secrets.unavailable = True

    with pytest.raises(KeychainUnavailableError):
        ai.endpoint()


def test_a_locked_keychain_keeps_a_save_from_changing_the_row(
    ai: AiService, secrets: MemorySecrets
) -> None:
    secrets.unavailable = True

    with pytest.raises(KeychainUnavailableError):
        _set_up_deepseek(ai)

    secrets.unavailable = False
    assert ai.get(ADMIN) is None
