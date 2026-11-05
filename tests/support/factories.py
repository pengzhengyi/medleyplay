"""Object Mothers: one factory per type the suites build."""

from ipaddress import IPv4Network
from pathlib import Path

from medleyplay.application.accounts import NewAccount
from medleyplay.domain.accounts import Account, AccountId, Role, Username
from medleyplay.domain.catalog import SourceKey, TrackDetails
from medleyplay.domain.mode import Network, NetworkKind
from medleyplay.plugin_api import EnrichTrack, ShownDetail, Tags
from medleyplay.programs.info_json import InfoChapter, InfoText
from medleyplay.programs.scan_covers import CoverFile, CoverImage
from medleyplay.programs.scan_library import InfoJson, ScannedFile

PASSWORD = "correct horse battery"


class NewAccountFactory:
    """Builds the details an admin enters for a new Account."""

    @staticmethod
    def admin(username: str = "alice") -> NewAccount:
        """Return Alice, the household's admin, unless another username is given."""
        return NewAccount(username, username.title(), PASSWORD, Role.ADMIN)

    @staticmethod
    def member(username: str = "bob") -> NewAccount:
        """Return Bob, a member, unless another username is given."""
        return NewAccount(username, username.title(), PASSWORD, Role.MEMBER)


class AccountFactory:
    """Builds Accounts that exist only in memory, for checks that need no database."""

    @staticmethod
    def admin(account_id: int = 98) -> Account:
        """Return an admin Account."""
        return Account(AccountId(account_id), Username("admin"), "Admin", Role.ADMIN)

    @staticmethod
    def member(account_id: int = 99) -> Account:
        """Return a member Account."""
        return Account(AccountId(account_id), Username("member"), "Member", Role.MEMBER)


class SourceKeyFactory:
    """Builds Source keys."""

    @staticmethod
    def bilibili(video: str = "BV1Xx41117Tz", part: int = 1) -> SourceKey:
        """Return the key of one part of a Bilibili video."""
        return SourceKey("bilibili", f"{video}/p{part}")


class TrackDetailsFactory:
    """Builds the details a Source reports about its music."""

    @staticmethod
    def song(title: str = "Intro") -> TrackDetails:
        """Return a three-minute song by a fixed artist."""
        return TrackDetails(title=title, artist="The Band", album="Blue", duration_ms=180_000)

    @staticmethod
    def album_file(duration_ms: int | None = 3_600_000) -> TrackDetails:
        """Return a whole album uploaded as one hour-long video: *Bremen* by ハチ, 2015."""
        return TrackDetails(
            title="Bremen",
            artist="ハチ",
            album="Bremen",
            album_artist="ハチ",
            duration_ms=duration_ms,
            year=2015,
        )


class InfoJsonFactory:
    """Builds what a scan reports of the `.info.json` beside an audio file."""

    @staticmethod
    def read(
        title: str = "【初音ミク】メルト / ryo(supercell)【MV】",
        description: str = "",
        chapters: tuple[InfoChapter, ...] = (),
        *,
        modified_ns: int = 1,
    ) -> InfoJson:
        """Return a sidecar the scan read, saying `title`, which names a song and its artist."""
        text = InfoText(title=title, description=description, chapters=chapters)
        return InfoJson(size=200, modified_ns=modified_ns, text=text)

    @staticmethod
    def unchanged(*, modified_ns: int = 1) -> InfoJson:
        """Return a sidecar the scan listed but skipped, since it hasn't changed."""
        return InfoJson(size=200, modified_ns=modified_ns)

    @staticmethod
    def wordless() -> InfoJson:
        """Return a sidecar the scan read that has no title, description, or chapters.

        ```json
        {"id": "BV1dm4y1s7ak", "title": "", "chapters": []}
        ```
        """
        return InfoJson(size=200, modified_ns=1, text=InfoText())

    @staticmethod
    def unreadable_for_now(*, modified_ns: int = 1) -> InfoJson:
        """Return a sidecar the scan couldn't read this time, as from a drive too slow to answer."""
        error = "can't be read (PluginCallFailedError)"
        return InfoJson(size=200, modified_ns=modified_ns, error=error, retry=True)

    @staticmethod
    def malformed(*, modified_ns: int = 1) -> InfoJson:
        """Return a sidecar the scan couldn't read, as one cut short mid-object would be."""
        error = "isn't valid JSON (JSONDecodeError)"
        return InfoJson(size=200, modified_ns=modified_ns, error=error)


class CoverImageFactory:
    """Builds what a scan reports of the image beside an audio file."""

    @staticmethod
    def read(copy: CoverFile, *, extension: str = "jpg", modified_ns: int = 1) -> CoverImage:
        """Return an image the scan read and kept a copy of."""
        return CoverImage(extension=extension, size=100, modified_ns=modified_ns, cover=copy)

    @staticmethod
    def unchanged(*, extension: str = "jpg", modified_ns: int = 1) -> CoverImage:
        """Return an image the scan listed but skipped, since it hasn't changed."""
        return CoverImage(extension=extension, size=100, modified_ns=modified_ns)

    @staticmethod
    def not_a_cover(*, modified_ns: int = 1) -> CoverImage:
        """Return an image the scan read, whose bytes are a GIF's."""
        error = "isn't a JPEG, PNG, or WebP image"
        return CoverImage(extension="jpg", size=100, modified_ns=modified_ns, error=error)

    @staticmethod
    def unreadable_for_now(*, modified_ns: int = 1) -> CoverImage:
        """Return an image the scan couldn't read this time, as from a drive too slow to answer."""
        error = "can't be read (PluginCallFailedError)"
        return CoverImage(
            extension="jpg", size=100, modified_ns=modified_ns, error=error, retry=True
        )


class ScannedFileFactory:
    """Builds the files a Library scan reports."""

    @staticmethod
    def song(
        path: str = "Blue/01 Intro.wav",
        title: str = "Intro",
        *,
        fingerprint: str = "",
        info_json: InfoJson | None = None,
        cover_image: CoverImage | None = None,
        embedded_cover: CoverFile | None = None,
    ) -> ScannedFile:
        """Return a new or changed file whose tags were read, fingerprinted by its path."""
        return ScannedFile(
            path=path,
            size=1000,
            modified_ns=1,
            changed=True,
            fingerprint=fingerprint or f"1000:{path}",
            tags=Tags(title=title, artist="The Band", album="Blue", duration_ms=180_000),
            info_json=info_json,
            cover_image=cover_image,
            embedded_cover=embedded_cover,
        )

    @staticmethod
    def untagged(
        path: str = "BV1dm4y1s7ak.m4a",
        *,
        fingerprint: str = "",
        info_json: InfoJson | None = None,
        cover_image: CoverImage | None = None,
        embedded_cover: CoverFile | None = None,
    ) -> ScannedFile:
        """Return a new or changed file whose tags said nothing, as a video download's do."""
        return ScannedFile(
            path=path,
            size=1000,
            modified_ns=1,
            changed=True,
            fingerprint=fingerprint or f"1000:{path}",
            tags=Tags(),
            info_json=info_json,
            cover_image=cover_image,
            embedded_cover=embedded_cover,
        )

    @staticmethod
    def unchanged(
        path: str = "Blue/01 Intro.wav",
        *,
        info_json: InfoJson | None = None,
        cover_image: CoverImage | None = None,
    ) -> ScannedFile:
        """Return a file the scan skipped because it hasn't changed."""
        return ScannedFile(
            path=path,
            size=1000,
            modified_ns=1,
            changed=False,
            info_json=info_json,
            cover_image=cover_image,
        )


class NetworkFactory:
    """Builds the networks the server finds itself on."""

    @staticmethod
    def home_wifi(router: str | None = "a2:b3:c4:d5:e6:f7") -> Network:
        """The household's Wi-Fi: router `192.168.31.1`, at `a2:b3:c4:d5:e6:f7`, on a /24.

        With `router=None`, the router's hardware address couldn't be read.
        """
        return Network(NetworkKind.WIFI, IPv4Network("192.168.31.0/24"), router)

    @staticmethod
    def iphone_hotspot() -> Network:
        """An iPhone's Personal Hotspot: router `172.20.10.1`, on the iPhone's usual /28."""
        return Network(NetworkKind.WIFI, IPv4Network("172.20.10.0/28"), "02:0f:c4:d5:e6:07")


class EnrichTrackFactory:
    """Builds what the core asks an enricher about a Track."""

    @staticmethod
    def let_down(
        folder: Path, *, album: str | None = "OK Computer", duration_ms: int | None = 299_000
    ) -> EnrichTrack:
        """Return the ask about a song whose file says what it is.

        ```text
        title "Let Down" (files), artist "Radiohead" (files), album "OK Computer" (files), 4:59
        ```
        """
        shown = [
            ShownDetail(field="title", value="Let Down", origin="files"),
            ShownDetail(field="artist", value="Radiohead", origin="files"),
        ]
        if album is not None:
            shown.append(ShownDetail(field="album", value=album, origin="files"))
        return EnrichTrack(shown=tuple(shown), duration_ms=duration_ms, folder=str(folder))

    @staticmethod
    def untitled(folder: Path) -> EnrichTrack:
        """Return the ask about a file that only its name titles.

        ```text
        title "Night Drive" (file_name)
        ```
        """
        shown = (ShownDetail(field="title", value="Night Drive", origin="file_name"),)
        return EnrichTrack(shown=shown, file_name="Night Drive.m4a", folder=str(folder))

    @staticmethod
    def long_album_file(folder: Path, *, duration_ms: int = 2_961_237) -> EnrichTrack:
        """Return the ask about a whole album in one file, not split, as a video gives it.

        ```text
        【HR 24/48】朴树2003《生如夏花》专辑歌词版            49:21
        title "生如夏花", artist "朴树", album "生如夏花", album_artist "朴树" (video)
        ```
        """
        shown = (
            ShownDetail(field="title", value="生如夏花", origin="video"),
            ShownDetail(field="artist", value="朴树", origin="video"),
            ShownDetail(field="album", value="生如夏花", origin="video"),
            ShownDetail(field="album_artist", value="朴树", origin="video"),
        )
        return EnrichTrack(shown=shown, duration_ms=duration_ms, folder=str(folder))

    @staticmethod
    def album_file(folder: Path) -> EnrichTrack:
        """Return the ask about a long file split into the songs of an album.

        ```text
        album "生如夏花" (video), album_artist "朴树" (video)
        ```
        """
        shown = (
            ShownDetail(field="album", value="生如夏花", origin="video"),
            ShownDetail(field="album_artist", value="朴树", origin="video"),
        )
        return EnrichTrack(shown=shown, whole_album=True, folder=str(folder))
