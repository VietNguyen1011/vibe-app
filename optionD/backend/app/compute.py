"""Fargate task-size selection.

ECS Fargate (like App Runner) only accepts fixed CPU/memory combinations. The
employee never chooses compute — the platform derives a sensible, valid block from
the scanned language runtime. This keeps the wizard at five friendly questions.

CPU is in Fargate units (1024 = 1 vCPU); memory in MiB.
"""

from __future__ import annotations

# A subset of the Fargate-valid CPU -> allowed-memory matrix (enough for our blocks).
VALID_FARGATE: dict[int, set[int]] = {
    256: {512, 1024, 2048},
    512: {1024, 2048, 3072, 4096},
    1024: {2048, 3072, 4096, 5120, 6144, 7168, 8192},
    2048: {4096, 5120, 6144, 7168, 8192},
}

# runtime (from scanner) -> (cpu units, memory MiB)
_BLOCKS: dict[str, tuple[int, int]] = {
    "static": (256, 512),
    "node": (512, 1024),
    "python": (1024, 2048),
}
_DEFAULT = (512, 1024)

_LABEL = {256: "0.25 vCPU", 512: "0.5 vCPU", 1024: "1 vCPU", 2048: "2 vCPU"}


def task_size(runtime: str) -> dict:
    """Resolve a language runtime to a valid Fargate task size block."""
    cpu, memory = _BLOCKS.get(runtime, _DEFAULT)
    return {
        "cpu": cpu,
        "memory": memory,
        "cpuLabel": _LABEL[cpu],
        "memoryLabel": f"{memory // 1024} GB" if memory % 1024 == 0 else f"{memory} MB",
    }
