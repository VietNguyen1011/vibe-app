"""Scanner inference, tested offline.

The real `scan_repo` reads the GitHub API; here we unit-test the pure inference
(`_detect`) with a fake file tree + file fetcher, plus the synthetic fallback. No
network — the live path is exercised manually / in the demo."""

from app.scanner import _detect, synthetic_scan


def _detector(paths, files):
    return _detect(paths, lambda name: files.get(name))


def test_detects_static_site():
    d = _detector(["index.html", "css/style.css", "README.md"], {})
    assert d["runtime"] == "static"
    assert d["framework"] == "Static site"
    assert d["entrypoint"] == "index.html"
    assert d["port"] == 80
    assert d["secret_keys"] == []


def test_detects_streamlit_with_dockerfile_and_secrets():
    d = _detector(
        ["app.py", "requirements.txt", "Dockerfile", ".env.example"],
        {
            "requirements.txt": "streamlit==1.40\nanthropic\n",
            ".env.example": "ANTHROPIC_API_KEY=\nSLACK_WEBHOOK_URL=\n# a comment\n",
        },
    )
    assert d["runtime"] == "python"
    assert d["framework"] == "Streamlit"
    assert d["dockerfile"] is True
    assert d["entrypoint"] == "app.py"
    assert d["port"] == 8501
    assert d["secret_keys"] == ["ANTHROPIC_API_KEY", "SLACK_WEBHOOK_URL"]


def test_detects_node_express():
    d = _detector(
        ["package.json", "server.js"],
        {"package.json": '{"main":"server.js","dependencies":{"express":"^4"}}'},
    )
    assert d["runtime"] == "node"
    assert d["framework"] == "Express"
    assert d["entrypoint"] == "server.js"


def test_detects_plain_python_no_framework():
    d = _detector(["main.py", "requirements.txt"], {"requirements.txt": "requests\nrich\n"})
    assert d["runtime"] == "python" and d["framework"] == "Python"
    assert d["entrypoint"] == "main.py"


def test_detects_node_next_and_vite():
    nxt = _detector(["package.json"], {"package.json": '{"dependencies":{"next":"14"}}'})
    assert nxt["framework"] == "Next.js" and nxt["port"] == 3000
    vite = _detector(["package.json"], {"package.json": '{"devDependencies":{"vite":"5"}}'})
    assert vite["framework"] == "Vite" and vite["port"] == 5173


def test_node_malformed_package_json_is_tolerated():
    d = _detector(["package.json"], {"package.json": "{not json"})
    assert d["runtime"] == "node" and d["framework"] == "Node"


def test_entrypoint_prefers_root_over_nested():
    d = _detector(["tests/app.py", "app.py", "requirements.txt"], {"requirements.txt": "flask"})
    assert d["framework"] == "Flask" and d["entrypoint"] == "app.py"


def test_synthetic_fallback_parses_repo_name():
    r = synthetic_scan("https://github.com/mdn/beginner-html-site-styled")
    assert r.owner == "mdn"
    assert r.name == "beginner-html-site-styled"
