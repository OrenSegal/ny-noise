import json

import pytest

from nynoise import readme
from nynoise.data import DATA_DIR


def test_committed_readme_matches_committed_metrics():
    """The results blocks are generated: a Readme that disagrees with data/*.json fails here."""
    text = readme.README.read_text()
    assert readme.render(text, readme.blocks()) == text


def test_forecast_block_names_whichever_model_was_selected():
    m = json.loads((DATA_DIR / "metrics.json").read_text())
    for best in ("random_forest", "hist_gradient_boosting"):
        block = readme.forecast_block({**m, "best_model": best})
        selected = [line for line in block.splitlines() if "(selected)" in line]
        assert len(selected) == 1 and readme.LABELS[best] in selected[0]
        assert f"{m['holdout'][best]['wape']:.1%}" in selected[0]
    assert m["holdout_weeks"][0] in block and m["holdout_weeks"][1] in block


def test_render_replaces_only_between_markers_and_requires_them():
    text = "a\n<!-- results:x -->\nold\n<!-- /results:x -->\nz\n"
    out = readme.render(text, {"x": "new"})
    assert out == "a\n<!-- results:x -->\nnew\n<!-- /results:x -->\nz\n" and readme.render(out, {"x": "new"}) == out
    with pytest.raises(ValueError):
        readme.render("no markers", {"x": "new"})
