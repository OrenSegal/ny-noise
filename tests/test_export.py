import pytest

pytest.importorskip("geopandas")
from nynoise import export  # noqa: E402


def test_committed_web_data_matches_committed_tables(tmp_path):
    """The site reads web/public/data/*.json; a table refreshed without re-running the export fails here."""
    export.main(out=tmp_path)
    built = sorted(p.name for p in tmp_path.glob("*.json"))
    assert built == sorted(p.name for p in export.WEB.glob("*.json"))
    stale = [name for name in built if (tmp_path / name).read_bytes() != (export.WEB / name).read_bytes()]
    assert not stale, f"re-run `python -m nynoise.export`: {stale} differ from data/"
