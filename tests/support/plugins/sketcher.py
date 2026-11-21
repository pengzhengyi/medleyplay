"""A thumbnailer that draws no picture: it answers as the image's label says.

An image is a cover's first bytes, then a label (see `tests.support.images`):

- `unreadable`, `no-tool`, or `timed-out`: answers with that status, writing nothing;
- `small`: writes only the smallest size, as for an image between two sizes;
- `tiny`: writes nothing, as for an image no larger than any size;
- any other label: writes every size, each a JPEG holding `<label> <size> <kind>`.
"""

from pathlib import Path

from medleyplay.plugin_api import (
    THUMBNAILER,
    ImageKind,
    MadeThumbnails,
    MakeThumbnails,
    Plugin,
    Registry,
    ThumbnailStatus,
)

_HEADS = {ImageKind.JPEG: 4, ImageKind.PNG: 8, ImageKind.WEBP: 12}
"""How long each kind's first bytes are in `tests.support.images`."""
_STATUSES = {
    "unreadable": ThumbnailStatus.UNREADABLE,
    "no-tool": ThumbnailStatus.NO_TOOL,
    "timed-out": ThumbnailStatus.TIMED_OUT,
}


class Sketcher:
    """Writes a labelled stand-in for each thumbnail."""

    def make_thumbnails(self, request: MakeThumbnails) -> MadeThumbnails:
        """Answer as the image's label says."""
        label = Path(request.source_path).read_bytes()[_HEADS[request.kind] :].decode()
        if label in _STATUSES:
            return MadeThumbnails(status=_STATUSES[label])
        sizes = {"tiny": (), "small": request.sizes[:1]}.get(label, request.sizes)
        for size in sizes:
            path = Path(request.folder) / f"{request.name}-{size.label}"
            path.write_bytes(
                b"\xff\xd8\xff\xe0" + f"{label} {size.label} {request.kind.value}".encode()
            )
        return MadeThumbnails(made=tuple(size.label for size in sizes))


def register(registry: Registry) -> None:
    """Add the thumbnailer `sketcher`."""
    registry.add(THUMBNAILER, "sketcher", Sketcher())


plugin = Plugin(api_version=1, register=register)
