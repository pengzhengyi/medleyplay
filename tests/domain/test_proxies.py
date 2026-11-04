"""A proxy URL is checked and rebuilt from its parts, never shown with its login, and redacted."""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from medleyplay.domain.errors import InvalidInputError, NotFoundError
from medleyplay.domain.proxies import (
    MAX_PROXY_LENGTH,
    ProxyScheme,
    ProxySummary,
    ProxyUrl,
    check_proxy_site,
    proxy_secret_name,
    redact_proxy,
)

PASSWORD = "hunter2"


@pytest.mark.parametrize(
    ("written", "canonical"),
    [
        ("http://127.0.0.1:7890", "http://127.0.0.1:7890"),
        ("https://proxy.lan:8443", "https://proxy.lan:8443"),
        ("socks5h://127.0.0.1:1080", "socks5h://127.0.0.1:1080"),
        ("https://proxy.lan:8443/", "https://proxy.lan:8443"),
        ("SOCKS5H://Proxy.LAN:1080", "socks5h://proxy.lan:1080"),
        ("http://[::1]:8080", "http://[::1]:8080"),
        ("socks5h://alice:swordfish@127.0.0.1:7890", "socks5h://alice:swordfish@127.0.0.1:7890"),
        ("socks5h://alice@127.0.0.1:7890", "socks5h://alice@127.0.0.1:7890"),
        ("socks5h://alice:@127.0.0.1:7890", "socks5h://alice@127.0.0.1:7890"),
        ("http://alice:p%40ss%3A1234@h:1", "http://alice:p%40ss%3A1234@h:1"),
        ("http://alice:p@ss@h:1", "http://alice:p%40ss@h:1"),
        ("http://al%69ce:pw@h:1", "http://alice:pw@h:1"),
        ("http://alice:pässword@h:1", "http://alice:p%C3%A4ssword@h:1"),
    ],
)
def test_a_proxy_is_rebuilt_canonically_from_its_parts(written: str, canonical: str) -> None:
    assert ProxyUrl.parse(written).url == canonical


def test_a_proxy_keeps_its_scheme_host_port_and_login_apart() -> None:
    proxy = ProxyUrl.parse("socks5h://alice:swordfish@proxy.lan:7890")

    assert (proxy.scheme, proxy.host, proxy.port, proxy.user, proxy.password) == (
        ProxyScheme.SOCKS5H,
        "proxy.lan",
        7890,
        "alice",
        "swordfish",
    )


def test_a_summary_shows_the_address_and_whether_there_is_a_login() -> None:
    summary = ProxyUrl.parse("socks5h://alice:swordfish@127.0.0.1:7890").summary

    assert summary == ProxySummary(ProxyScheme.SOCKS5H, "127.0.0.1", 7890, has_login=True)
    assert summary.display == "socks5h://127.0.0.1:7890"
    assert ProxyUrl.parse("http://[::1]:3128").summary.display == "http://[::1]:3128"
    assert not ProxyUrl.parse("http://127.0.0.1:3128").summary.has_login


def test_a_proxy_shows_no_login_when_printed() -> None:
    proxy = ProxyUrl.parse(f"http://alice:{PASSWORD}@127.0.0.1:3128")

    assert PASSWORD not in repr(proxy)
    assert "alice" not in repr(proxy)


@pytest.mark.parametrize("scheme", ["socks5", "socks4", "socks4a"])
def test_a_socks_scheme_that_looks_names_up_outside_the_proxy_says_to_use_socks5h(
    scheme: str,
) -> None:
    with pytest.raises(InvalidInputError, match="Use socks5h, which looks names up through"):
        ProxyUrl.parse(f"{scheme}://127.0.0.1:1080")


REFUSED = [
    "",
    "127.0.0.1:7890",
    "//127.0.0.1:7890",
    "ftp://127.0.0.1:21",
    "http://",
    "http://:7890",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:port",
    "http://-bad-.example:1",
    "http://bad host:1",
    "http://bäd.example:1",
    "http://[::1:80",
    "http://[fe80::1%en0]:80",
    "http://127.0.0.1:1/proxy",
    "http://127.0.0.1:1/?",
    "http://127.0.0.1:1?mode=fast",
    "http://127.0.0.1:1#top",
    "http://:pw@127.0.0.1:1",
    " http://127.0.0.1:1",
    "http://127.0.0.1:1\n",
    "http://127.0.0.1:1\t",
    "http://127.0.0.1:1\x07",
    "http://127.0.0.1\x00:1",
    "http://alice:p%0Aw@127.0.0.1:1",
    "http://127.0.0.1:" + "1" * MAX_PROXY_LENGTH,
]


@pytest.mark.parametrize("written", REFUSED)
def test_a_proxy_of_another_shape_is_refused(written: str) -> None:
    with pytest.raises(InvalidInputError):
        ProxyUrl.parse(written)


@pytest.mark.parametrize(
    "written",
    [
        f"socks5://alice:{PASSWORD}@127.0.0.1:1080",
        f"gopher://alice:{PASSWORD}@127.0.0.1:1080",
        f"alice:{PASSWORD}@127.0.0.1:1080",
        f"http://alice:{PASSWORD}@127.0.0.1",
        f"http://alice:{PASSWORD}@127.0.0.1:0",
        f"http://alice:{PASSWORD}@127.0.0.1:1/path",
        f"http://alice:{PASSWORD}@127.0.0.1:1?x=1",
        f"http://alice:{PASSWORD}@127.0.0.1:1#x",
        f"http://alice:{PASSWORD}@127.0.0.1:1 ",
        f"http://alice:{PASSWORD}@127.0.0.1:1\x07",
        f"http://alice:{PASSWORD}@[::1:80",
        f"http://alice:{PASSWORD}@127.0.0.1:{'1' * MAX_PROXY_LENGTH}",
        f"http://alice:{PASSWORD}@bäd.example:1",
        f"http://alice:{PASSWORD}%0A@127.0.0.1:1",
    ],
)
def test_a_refusal_never_includes_the_password(written: str) -> None:
    with pytest.raises(InvalidInputError) as refused:
        ProxyUrl.parse(written)

    assert PASSWORD not in str(refused.value)
    assert "alice" not in str(refused.value)


def test_a_proxy_of_exactly_the_longest_length_is_accepted_and_one_more_is_refused() -> None:
    def written(password_length: int) -> str:
        return f"http://alice:{'p' * password_length}@127.0.0.1:1"

    fits = MAX_PROXY_LENGTH - len(written(0))

    assert ProxyUrl.parse(written(fits)).password == "p" * fits
    with pytest.raises(InvalidInputError, match="at most 512"):
        ProxyUrl.parse(written(fits + 1))


_NAMES = st.text(st.characters(codec="utf-8", categories=["L", "N", "P", "S"]), min_size=1)


@given(
    scheme=st.sampled_from(list(ProxyScheme)),
    host=st.from_regex(r"[a-z0-9]([a-z0-9-]{0,20}[a-z0-9])?", fullmatch=True),
    port=st.integers(min_value=1, max_value=65535),
    login=st.none() | st.tuples(_NAMES, st.none() | _NAMES),
)
def test_a_canonical_proxy_parses_back_to_the_same_parts(
    scheme: ProxyScheme, host: str, port: int, login: tuple[str, str | None] | None
) -> None:
    user, password = login if login is not None else (None, None)
    built = ProxyUrl(scheme, host, port, user, password)

    again = ProxyUrl.parse(built.url)

    assert again == built
    assert again.url == built.url


@pytest.mark.parametrize("site", ["bilibili"])
def test_a_site_whose_plugin_takes_a_proxy_keeps_it_in_the_keychain_under_its_name(
    site: str,
) -> None:
    assert check_proxy_site(site) == site
    assert proxy_secret_name(site) == "proxy:bilibili"


@pytest.mark.parametrize("site", ["youtube", "", "Bilibili", "../x", "a" * 65])
def test_a_site_no_plugin_takes_a_proxy_for_is_not_found(site: str) -> None:
    with pytest.raises(NotFoundError):
        check_proxy_site(site)


PROXY = f"socks5h://alice:{PASSWORD}@127.0.0.1:7890"


def test_the_whole_login_is_redacted_where_it_is_written_in_a_url() -> None:
    message = f"Unable to connect to proxy {PROXY} for www.bilibili.com"

    assert redact_proxy(message, PROXY) == (
        "Unable to connect to proxy socks5h://<redacted>@127.0.0.1:7890 for www.bilibili.com"
    )


def test_the_login_is_redacted_as_written_and_as_url_decoded() -> None:
    proxy = "http://al%40ice:p%40ss%3A1234@127.0.0.1:3128"
    message = "failed as al%40ice:p%40ss%3A1234 and al@ice:p@ss:1234 and p@ss:1234"

    assert redact_proxy(message, proxy) == "failed as <redacted> and <redacted> and <redacted>"


def test_a_short_password_is_redacted_with_its_user_but_not_on_its_own() -> None:
    proxy = "http://alice:pw@127.0.0.1:3128"

    assert redact_proxy("via alice:pw@127.0.0.1 and alice:pw, not pw", proxy) == (
        "via <redacted>@127.0.0.1 and <redacted>, not pw"
    )


def test_a_long_password_is_redacted_wherever_it_appears() -> None:
    assert redact_proxy(f"the password {PASSWORD} was refused", PROXY) == (
        "the password <redacted> was refused"
    )


def test_a_basic_authorization_header_is_redacted() -> None:
    header = "Proxy-Authorization: Basic YWxpY2U6cHc="

    assert redact_proxy(header, "http://alice:pw@127.0.0.1:1") == (
        "Proxy-Authorization: Basic <redacted>"
    )


def test_a_user_with_no_password_is_redacted_before_its_at_sign() -> None:
    assert redact_proxy("via alice@127.0.0.1", "http://alice@127.0.0.1:1") == (
        "via <redacted>@127.0.0.1"
    )


@pytest.mark.parametrize("proxy", [None, "", "http://127.0.0.1:3128"])
def test_a_proxy_without_a_login_redacts_nothing(proxy: str | None) -> None:
    assert redact_proxy("via 127.0.0.1:3128", proxy) == "via 127.0.0.1:3128"
