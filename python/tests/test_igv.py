from plotomics import IGV


def test_igv_assembles_config_from_convenience_args():
    w = IGV(
        genome="hg38",
        locus="chr8:127,736,588-127,739,371",
        tracks=[{"name": "t", "url": "t.bw", "format": "bigWig"}],
    )
    assert w.options["genome"] == "hg38"
    assert w.options["locus"] == "chr8:127,736,588-127,739,371"
    assert w.options["tracks"][0]["url"] == "t.bw"
    assert "config" not in w.options
    # Config-driven: no data columns.
    assert w.data["columns"] == {}


def test_igv_passes_full_config_through():
    cfg = {"genome": "hg19", "locus": "chr1:1-1000"}
    w = IGV(genome="hg38", locus="chr2", config=cfg)
    assert w.options["config"] == cfg
    assert "genome" not in w.options
    assert "locus" not in w.options


def test_igv_omits_tracks_when_none():
    w = IGV(genome="hg38")
    assert w.options["genome"] == "hg38"
    assert "tracks" not in w.options


def test_igv_defaults_to_hg38():
    w = IGV()
    assert w.options["genome"] == "hg38"
    assert w._height == 480
