"""The local album encoder joins inputs without exceeding its resource limits."""

# cspell:ignore alac getrlimit NOFILE RLIMIT setrlimit

import resource
import shutil
from pathlib import Path

import pytest

from medleyplay.plugin_host.job import AnswerFailedError
from medleyplay.programs.joined_audio import join_audio, join_tools
from tests.support.audio import m4a_tone


def test_sixty_parts_join_with_fewer_than_sixty_available_file_descriptors(tmp_path: Path) -> None:
    tools = join_tools()
    if tools is None:
        pytest.skip("Synthetic concatenation requires FFmpeg and ffprobe.")
    clip = tmp_path / "tone.m4a"
    m4a_tone(tools[0], clip, frequency=440, sample_rate=44100, channels=1, codec="alac")
    inputs = [tmp_path / f"part-{index}.m4a" for index in range(60)]
    for path in inputs:
        shutil.copyfile(clip, path)
    output = tmp_path / "album.m4a"
    old_limits = resource.getrlimit(resource.RLIMIT_NOFILE)
    resource.setrlimit(resource.RLIMIT_NOFILE, (40, old_limits[1]))
    try:
        duration = join_audio(tools, inputs, output, 3_000_000)
    finally:
        resource.setrlimit(resource.RLIMIT_NOFILE, old_limits)

    assert duration == pytest.approx(60_000, abs=75)


def test_an_encode_stopped_at_the_byte_limit_is_not_a_complete_album(tmp_path: Path) -> None:
    tools = join_tools()
    if tools is None:
        pytest.skip("Synthetic concatenation requires FFmpeg and ffprobe.")
    clip = tmp_path / "tone.m4a"
    m4a_tone(tools[0], clip, frequency=440, sample_rate=44100, channels=1, codec="alac")
    output = tmp_path / "album.m4a"
    limit = 4096

    with pytest.raises(AnswerFailedError, match="album file limit"):
        join_audio(tools, [clip, clip], output, limit)

    assert output.stat().st_size == limit
