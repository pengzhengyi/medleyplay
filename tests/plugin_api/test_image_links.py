"""An image link a model names: an address on a public site, over HTTPS, and nothing else."""

import pytest
from pydantic import ValidationError

from medleyplay.plugin_api import MAX_IMAGE_LINKS, ImageLink, SuggestedImages, is_public_https

COVER = "https://upload.wikimedia.org/wikipedia/en/b/ba/OK_Computer.png"


@pytest.mark.parametrize(
    "url",
    [
        COVER,
        "https://www.radiohead.com/images/okc.jpg?size=large",
        "https://upload.wikimedia.org:443/a.jpg",
        "https://ジャケット.example.jp/cover.jpg",
        "https://xn--eckwd4c7c.example.jp/cover.jpg",
        "https://cdn.example.com./cover.jpg",
    ],
    ids=["Wikimedia", "an official site", "the HTTPS port", "an IDN host", "punycode", "a FQDN"],
)
def test_an_https_address_on_a_named_public_host_is_public(url: str) -> None:
    assert is_public_https(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://upload.wikimedia.org/a.jpg",
        "ftp://upload.wikimedia.org/a.jpg",
        "file:///etc/passwd",
        "data:image/png;base64,AAAA",
        "https://user:secret@upload.wikimedia.org/a.jpg",
        "https://upload.wikimedia.org:8443/a.jpg",
        "https://127.0.0.1/a.jpg",
        "https://[::1]/a.jpg",
        "https://192.168.1.10/a.jpg",
        "https://127.1/a.jpg",
        "https://2130706433/a.jpg",
        "https://0x7f.0.0.1/a.jpg",
        "https://localhost/a.jpg",
        "https://localhost./a.jpg",
        "https://nas/a.jpg",
        "https://nas.local/a.jpg",
        "https://router.lan/a.jpg",
        "https://db.internal/a.jpg",
        "https://printer.home.arpa/a.jpg",
        "https://app.localhost/a.jpg",
        "https:///a.jpg",
        "https://upload.wikimedia.org/a b.jpg",
        "https://upload.wikimedia.org\\@evil.example/a.jpg",
        f"https://upload.wikimedia.org/{'a' * 2048}.jpg",
        "not an address",
    ],
    ids=[
        "plain http",
        "ftp",
        "a file",
        "inline data",
        "a login",
        "another port",
        "an IPv4 address",
        "an IPv6 address",
        "a private address",
        "a short IPv4 address",
        "a decimal IPv4 address",
        "a hex IPv4 address",
        "localhost",
        "localhost, fully qualified",
        "a single label",
        "mDNS",
        "a home network",
        "an internal name",
        "home.arpa",
        "under localhost",
        "no host",
        "a space",
        "a backslash",
        "too long",
        "words",
    ],
)
def test_an_address_off_https_or_on_a_private_host_is_not_public(url: str) -> None:
    assert not is_public_https(url)


def test_a_link_to_a_private_host_is_refused() -> None:
    with pytest.raises(ValidationError):
        ImageLink(url="https://192.168.1.10/cover.jpg")


def test_a_link_names_its_image_its_page_and_why() -> None:
    link = ImageLink(
        url=COVER,
        page="https://en.wikipedia.org/wiki/OK_Computer",
        why="the album's article uses it",
    )

    assert (link.url, link.page) == (COVER, "https://en.wikipedia.org/wiki/OK_Computer")


def test_no_more_links_than_the_most_are_taken() -> None:
    with pytest.raises(ValidationError):
        SuggestedImages(links=(ImageLink(url=COVER),) * (MAX_IMAGE_LINKS + 1))
