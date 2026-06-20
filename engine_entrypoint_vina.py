"""Per-job entrypoint for the lightweight Vina test engine image. Same contract as
engine_entrypoint.py (reads /job/job_spec.json, writes /job/result.json) so the
orchestrator doesn't need to know which engine it's talking to.
"""
import json
import sys

import docking_worker_vina

JOB_DIR = "/job"


def main() -> int:
    try:
        with open(f"{JOB_DIR}/job_spec.json") as f:
            job_spec = json.load(f)
        result = docking_worker_vina.dock_job(job_spec, f"{JOB_DIR}/work")
        output = {"result": result}
    except Exception as exc:  # noqa: BLE001 -- must always write a result file
        output = {"error": str(exc)}

    with open(f"{JOB_DIR}/result.json", "w") as f:
        json.dump(output, f)

    return 0 if "result" in output else 1


if __name__ == "__main__":
    sys.exit(main())
