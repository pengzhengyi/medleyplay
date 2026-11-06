"""The AI providers service: providers kept in order in the catalog, their keys in the Keychain."""

from collections.abc import Callable
from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.ai import AiService, SavedProvider, is_set_up, record_answers
from medleyplay.domain.ai import MAX_PROVIDERS, ProviderFailure, key_secret
from medleyplay.domain.errors import (
    ConflictError,
    ForbiddenError,
    InvalidInputError,
    KeychainUnavailableError,
    NotFoundError,
)
from medleyplay.persistence.schema import AiProviderRow
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


def _add_deepseek(ai: AiService, model: str = "deepseek-flash") -> SavedProvider:
    return ai.add(ADMIN, DEEPSEEK, model, KEY)


def _add_ollama(ai: AiService) -> SavedProvider:
    return ai.add(ADMIN, OLLAMA, "llama3.2", None)


def _models(ai: AiService) -> list[str]:
    return [each.model for each in ai.providers(ADMIN)]


def test_nothing_is_set_up_at_first(ai: AiService, units: sessionmaker[Session]) -> None:
    with units() as db:
        assert ai.providers(ADMIN) == []
        assert ai.endpoints() == ()
        assert not is_set_up(db)


def test_adding_keeps_the_key_in_the_keychain_and_the_address_and_model_in_the_catalog(
    ai: AiService, secrets: MemorySecrets, units: sessionmaker[Session], clock: FakeClock
) -> None:
    added = _add_deepseek(ai)

    assert added == SavedProvider(
        added.id, DEEPSEEK, "deepseek-flash", has_key=True, saved_at=clock.now
    )
    assert secrets.items == {key_secret(added.id): KEY}
    with units() as db:
        row = db.get_one(AiProviderRow, added.id)
        assert (row.base_url, row.model, row.key_secret) == (
            DEEPSEEK,
            "deepseek-flash",
            key_secret(added.id),
        )
        assert is_set_up(db)


def test_each_provider_keeps_its_key_under_a_name_of_its_own(
    ai: AiService, secrets: MemorySecrets
) -> None:
    flash = _add_deepseek(ai)
    reasoner = ai.add(ADMIN, DEEPSEEK, "deepseek-reasoner", "sk-other1234")

    assert secrets.items == {key_secret(flash.id): KEY, key_secret(reasoner.id): "sk-other1234"}


def test_the_key_is_in_no_table(ai: AiService, units: sessionmaker[Session]) -> None:
    _add_deepseek(ai)

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
            rows_when_keeping.append(len(db.execute(text("SELECT * FROM ai_provider")).all()))

    secrets.while_setting = count_rows

    _add_deepseek(ai)

    assert rows_when_keeping == [0]


def test_the_base_url_is_kept_without_its_trailing_slash(ai: AiService) -> None:
    added = ai.add(ADMIN, "https://api.openai.com/v1/", "gpt-4o-mini", KEY)

    assert added.base_url == "https://api.openai.com/v1"


def test_a_local_provider_is_added_without_a_key(ai: AiService, secrets: MemorySecrets) -> None:
    added = _add_ollama(ai)

    assert added.has_key is False
    assert secrets.items == {}
    assert ai.endpoints() == (AiEndpoint(id=added.id, base_url=OLLAMA, model="llama3.2"),)


def test_adding_trims_the_key(ai: AiService, secrets: MemorySecrets) -> None:
    added = ai.add(ADMIN, DEEPSEEK, "deepseek-flash", f"  {KEY}\n")

    assert secrets.items == {key_secret(added.id): KEY}


def test_providers_are_asked_in_the_order_they_were_added(ai: AiService) -> None:
    _add_deepseek(ai)
    _add_ollama(ai)

    assert _models(ai) == ["deepseek-flash", "llama3.2"]
    assert [each.model for each in ai.endpoints()] == ["deepseek-flash", "llama3.2"]


def test_the_same_address_and_model_is_refused_but_another_model_of_it_is_added(
    ai: AiService, secrets: MemorySecrets
) -> None:
    first = _add_deepseek(ai)

    with pytest.raises(ConflictError, match="set up already"):
        _add_deepseek(ai)
    ai.add(ADMIN, DEEPSEEK, "deepseek-reasoner", KEY)

    assert _models(ai) == ["deepseek-flash", "deepseek-reasoner"]
    assert key_secret(first.id) in secrets.items
    assert len(secrets.items) == 2


def test_one_provider_more_than_the_most_kept_is_refused(
    ai: AiService, secrets: MemorySecrets
) -> None:
    for each in range(MAX_PROVIDERS):
        ai.add(ADMIN, DEEPSEEK, f"model-{each}", KEY)

    with pytest.raises(ConflictError, match="remove one first"):
        ai.add(ADMIN, OLLAMA, "llama3.2", None)

    assert len(ai.providers(ADMIN)) == MAX_PROVIDERS
    assert len(secrets.items) == MAX_PROVIDERS


@pytest.mark.parametrize(
    ("base_url", "model", "key"),
    [
        ("http://api.deepseek.com", "deepseek-flash", KEY),
        ("https://alice:pw@api.deepseek.com", "deepseek-flash", KEY),
        (DEEPSEEK, "", KEY),
        (DEEPSEEK, "deepseek chat", KEY),
        (DEEPSEEK, "deepseek-flash", "k"),
        (DEEPSEEK, "deepseek-flash", "sk-with a space"),
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
def test_a_provider_that_breaks_a_rule_is_refused_and_changes_nothing(
    ai: AiService, secrets: MemorySecrets, base_url: str, model: str, key: str
) -> None:
    with pytest.raises(InvalidInputError):
        ai.add(ADMIN, base_url, model, key)

    assert (ai.providers(ADMIN), secrets.items) == ([], {})


def test_a_refused_key_is_not_repeated_in_the_reason(ai: AiService) -> None:
    with pytest.raises(InvalidInputError) as refused:
        ai.add(ADMIN, DEEPSEEK, "deepseek-flash", "sk-with a space")

    assert "sk-with" not in str(refused.value)


def test_replacing_the_key_keeps_the_providers_place_and_forgets_how_it_failed(
    ai: AiService, secrets: MemorySecrets, units: sessionmaker[Session], clock: FakeClock
) -> None:
    deepseek = _add_deepseek(ai)
    _add_ollama(ai)
    with units.begin() as db:
        record_answers(db, None, [(deepseek.id, ProviderFailure.REFUSED)], clock.now)

    replaced = ai.replace_key(ADMIN, deepseek.id, "sk-replaced1234")

    assert (replaced.has_key, replaced.failure, replaced.failed_at) == (True, None, None)
    assert secrets.items == {key_secret(deepseek.id): "sk-replaced1234"}
    assert _models(ai) == ["deepseek-flash", "llama3.2"]


def test_a_provider_without_a_key_can_be_given_one(ai: AiService, secrets: MemorySecrets) -> None:
    ollama = _add_ollama(ai)

    given = ai.replace_key(ADMIN, ollama.id, KEY)

    assert given.has_key
    assert secrets.items == {key_secret(ollama.id): KEY}


def test_changing_the_model_keeps_the_providers_place_and_key(
    ai: AiService, secrets: MemorySecrets
) -> None:
    deepseek = _add_deepseek(ai)
    _add_ollama(ai)

    changed = ai.change_model(ADMIN, deepseek.id, "deepseek-reasoner")

    assert (changed.model, changed.has_key) == ("deepseek-reasoner", True)
    assert _models(ai) == ["deepseek-reasoner", "llama3.2"]
    assert secrets.items == {key_secret(deepseek.id): KEY}


def test_changing_to_a_model_another_provider_of_the_address_asks_is_refused(
    ai: AiService,
) -> None:
    flash = _add_deepseek(ai)
    _add_deepseek(ai, "deepseek-reasoner")

    with pytest.raises(ConflictError):
        ai.change_model(ADMIN, flash.id, "deepseek-reasoner")

    assert _models(ai) == ["deepseek-flash", "deepseek-reasoner"]


def test_changing_a_provider_that_is_gone_is_not_found(ai: AiService) -> None:
    with pytest.raises(NotFoundError, match="no longer set up"):
        ai.change_model(ADMIN, "gone", "deepseek-flash")
    with pytest.raises(NotFoundError, match="no longer set up"):
        ai.replace_key(ADMIN, "gone", KEY)


def test_reordering_asks_the_providers_in_the_new_order(ai: AiService) -> None:
    deepseek, ollama = _add_deepseek(ai), _add_ollama(ai)

    shown = ai.reorder(ADMIN, [ollama.id, deepseek.id])

    assert [each.model for each in shown] == ["llama3.2", "deepseek-flash"]
    assert _models(ai) == ["llama3.2", "deepseek-flash"]
    assert [each.id for each in ai.endpoints()] == [ollama.id, deepseek.id]


@pytest.mark.parametrize(
    "order",
    [
        lambda deepseek, _: [deepseek],
        lambda deepseek, ollama: [deepseek, ollama, "gone"],
        lambda deepseek, _: [deepseek, deepseek],
    ],
    ids=["one left out", "one more", "one twice"],
)
def test_an_order_that_names_other_providers_than_there_are_is_refused(
    ai: AiService, order: Callable[[str, str], list[str]]
) -> None:
    deepseek, ollama = _add_deepseek(ai), _add_ollama(ai)

    with pytest.raises(ConflictError, match="changed since"):
        ai.reorder(ADMIN, order(deepseek.id, ollama.id))

    assert _models(ai) == ["deepseek-flash", "llama3.2"]


def test_removing_a_provider_forgets_its_key_and_keeps_the_others(
    ai: AiService, secrets: MemorySecrets
) -> None:
    deepseek = _add_deepseek(ai)
    reasoner = _add_deepseek(ai, "deepseek-reasoner")

    ai.remove(ADMIN, deepseek.id)
    ai.remove(ADMIN, deepseek.id)

    assert _models(ai) == ["deepseek-reasoner"]
    assert secrets.items == {key_secret(reasoner.id): KEY}


def test_the_row_is_removed_before_the_key(
    ai: AiService, secrets: MemorySecrets, units: sessionmaker[Session]
) -> None:
    deepseek = _add_deepseek(ai)
    secrets.unavailable = True

    ai.remove(ADMIN, deepseek.id)

    secrets.unavailable = False
    assert ai.providers(ADMIN) == []
    with units() as db:
        assert not is_set_up(db)


@pytest.mark.parametrize(
    "act",
    [
        lambda ai: ai.providers(MEMBER),
        lambda ai: ai.add(MEMBER, DEEPSEEK, "deepseek-flash", KEY),
        lambda ai: ai.replace_key(MEMBER, "any", KEY),
        lambda ai: ai.change_model(MEMBER, "any", "deepseek-flash"),
        lambda ai: ai.reorder(MEMBER, []),
        lambda ai: ai.remove(MEMBER, "any"),
    ],
    ids=[
        "showing them",
        "adding one",
        "replacing a key",
        "changing a model",
        "reordering them",
        "removing one",
    ],
)
def test_only_an_admin_manages_the_providers(
    ai: AiService, act: Callable[[AiService], object]
) -> None:
    with pytest.raises(ForbiddenError):
        act(ai)


def test_a_job_is_lent_each_providers_address_model_and_key_in_order(ai: AiService) -> None:
    deepseek, ollama = _add_deepseek(ai), _add_ollama(ai)

    assert ai.endpoints() == (
        AiEndpoint(id=deepseek.id, base_url=DEEPSEEK, model="deepseek-flash", key=KEY),
        AiEndpoint(id=ollama.id, base_url=OLLAMA, model="llama3.2"),
    )


def test_a_provider_whose_key_the_keychain_no_longer_holds_is_left_out_and_marked(
    ai: AiService, secrets: MemorySecrets, clock: FakeClock
) -> None:
    deepseek, ollama = _add_deepseek(ai), _add_ollama(ai)
    secrets.items.clear()

    lent = ai.endpoints()

    assert [each.id for each in lent] == [ollama.id]
    marked = ai.providers(ADMIN)[0]
    assert (marked.id, marked.failure, marked.failed_at) == (
        deepseek.id,
        ProviderFailure.KEY_MISSING,
        clock.now,
    )


def test_keys_the_keychain_no_longer_holds_for_any_provider_must_be_replaced(
    ai: AiService, secrets: MemorySecrets
) -> None:
    _add_deepseek(ai)
    secrets.items.clear()

    with pytest.raises(KeychainUnavailableError, match="replace them"):
        ai.endpoints()


def test_a_locked_keychain_is_reported_when_the_keys_are_lent(
    ai: AiService, secrets: MemorySecrets
) -> None:
    _add_deepseek(ai)
    secrets.unavailable = True

    with pytest.raises(KeychainUnavailableError):
        ai.endpoints()


def test_a_locked_keychain_keeps_an_add_from_adding_a_row(
    ai: AiService, secrets: MemorySecrets
) -> None:
    secrets.unavailable = True

    with pytest.raises(KeychainUnavailableError):
        _add_deepseek(ai)

    secrets.unavailable = False
    assert ai.providers(ADMIN) == []


def test_a_provider_that_answers_forgets_how_it_last_failed_and_those_before_it_keep_why(
    ai: AiService, units: sessionmaker[Session], clock: FakeClock
) -> None:
    deepseek, ollama = _add_deepseek(ai), _add_ollama(ai)
    with units.begin() as db:
        record_answers(db, None, [(ollama.id, ProviderFailure.BUSY)], clock.now)
    clock.advance(timedelta(hours=2))

    with units.begin() as db:
        record_answers(db, ollama.id, [(deepseek.id, ProviderFailure.REFUSED)], clock.now)
        record_answers(db, None, [("gone", ProviderFailure.REFUSED)], clock.now)

    shown = {each.id: (each.failure, each.failed_at) for each in ai.providers(ADMIN)}
    assert shown == {deepseek.id: (ProviderFailure.REFUSED, clock.now), ollama.id: (None, None)}
