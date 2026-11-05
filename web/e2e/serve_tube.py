"""Start a medleyplay server whose Bilibili is the test plugin `tube`, with no music.

`tube` reads and downloads scripted videos (see `tests/support/plugins/tube.py`), so
Tracks can be added from links and have their Downloads succeed or fail, without
reaching Bilibili. Run from `web/` with `uv run --project .. python e2e/serve_tube.py`.
"""

import os
import shutil
import sys
from pathlib import Path

from medleyplay.plugin_host.client import HostCommand
from medleyplay.server import PluginSource

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from serve import serve  # noqa: E402 -- after the folder of this script is on the path

PORT = 4175
ROOT = HERE.parent / ".cache" / "e2e-tube"
REPOSITORY = HERE.parents[1]


def main() -> None:
    """Start with an empty data folder, and become the server."""
    shutil.rmtree(ROOT, ignore_errors=True)
    # The plugin host imports `e2e_plugins` from this folder, and `tube` from the repository.
    path = os.pathsep.join([str(HERE), str(REPOSITORY)])
    source = PluginSource("e2e_plugins", HostCommand(env={"PYTHONPATH": path}))
    serve(ROOT / "data", PORT, source)


if __name__ == "__main__":
    main()
