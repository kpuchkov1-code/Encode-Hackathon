"""Per-job entrypoint for the engine container: dock one job, write the result, exit.

Run by the orchestrator (worker_daemon.py) via `docker run`, never long-running itself --
one container per job. Reads /job/job_spec.json (volume-mounted by the orchestrator),
writes /job/result.json with either {"result": [...]} or {"error": "..."}.
"""
import json
import sys

import worker_setup
import docking_worker

JOB_DIR = "/job"


def main() -> int:
    try:
        worker_setup.run_setup()
        with open(f"{JOB_DIR}/job_spec.json") as f:
            job_spec = json.load(f)
        result = docking_worker.dock_job(job_spec, f"{JOB_DIR}/work")
        output = {"result": result}
    except Exception as exc:  # noqa: BLE001 -- must always write a result file, success or failure
        output = {"error": str(exc)}

    with open(f"{JOB_DIR}/result.json", "w") as f:
        json.dump(output, f)

    return 0 if "result" in output else 1


if __name__ == "__main__":
    sys.exit(main())
