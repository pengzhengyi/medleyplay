"""Fixtures for the API suites that run a real plugin host."""

import dataclasses
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.web.app import create_app
from medleyplay.web.deps import Services
from tests.conftest import TEST_HOST
from tests.support.api import set_up_as_alice
from tests.support.fakes import FakeClock, MemorySecrets
from tests.support.sites import Site, running_site


@pytest.fixture
def site_services(
    units: sessionmaker[Session],
    clock: FakeClock,
    tmp_path: Path,
    secrets: MemorySecrets,
    services: Services,
) -> Iterator[tuple[Site, Services]]:
    """A running `tube` site, and the services of a server using its plugins and Jobs."""
    with running_site(units, clock, tmp_path / "data", secrets) as site:
        yield (
            site,
            dataclasses.replace(
                services,
                plugins=site.plugins,
                jobs=site.jobs,
                playback=site.playback,
                linked=site.linked,
                links=site.links,
                manual_downloads=site.manual,
            ),
        )


def signed_in_client(services: Services) -> Iterator[TestClient]:
    """A client of a server running `services`, signed in as Alice."""
    app = create_app(services, allowed_hosts=[TEST_HOST])
    with TestClient(app, base_url=f"http://{TEST_HOST}") as client:
        set_up_as_alice(client)
        yield client


@pytest.fixture
def site_client(site_services: tuple[Site, Services]) -> Iterator[TestClient]:
    """A client of a server with `tube` answering for `bilibili`, and real download Jobs."""
    yield from signed_in_client(site_services[1])
