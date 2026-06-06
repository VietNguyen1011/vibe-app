"""Fargate task-size blocks — auto-derived from the scanned language runtime.
The employee never picks compute; the platform maps runtime -> a valid Fargate combo."""

from app.compute import VALID_FARGATE, task_size


def test_python_maps_to_one_vcpu_two_gb():
    s = task_size("python")
    assert s["cpu"] == 1024 and s["memory"] == 2048
    assert s["cpuLabel"] == "1 vCPU" and s["memoryLabel"] == "2 GB"


def test_static_is_smallest_block():
    s = task_size("static")
    assert (s["cpu"], s["memory"]) == (256, 512)


def test_node_block():
    s = task_size("node")
    assert (s["cpu"], s["memory"]) == (512, 1024)


def test_unknown_runtime_falls_back_to_safe_default():
    s = task_size("rust-something")
    assert (s["cpu"], s["memory"]) == (512, 1024)


def test_every_block_is_a_valid_fargate_combo():
    for runtime in ("static", "node", "python", "anything"):
        s = task_size(runtime)
        assert s["memory"] in VALID_FARGATE[s["cpu"]]
