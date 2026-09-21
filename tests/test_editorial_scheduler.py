import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("editorial_cron", Path(__file__).parents[1] / "ops/mainland/run-recommendation-cron.py")
cron = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cron)


class Response:
    status = 200

    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class SchedulerTests(unittest.TestCase):
    def run_driver(self, states):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "env"
            env.write_text("CRON_SECRET=test-only-not-a-real-secret", encoding="utf-8")
            replies = [Response({"ok": True, "result": {"targetAchieved": False}, "status": {"state": {"status": state, "lastCreatedCount": 26}}}) for state in states]
            with patch("sys.argv", ["cron", "--env", str(env), "--base-url", "https://example.invalid"]), patch.object(cron.urllib.request, "urlopen", side_effect=replies) as calls, patch.object(cron.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
                cron.main()
                return calls.call_count

    def test_partial_batch_does_not_stop_daily_queue(self):
        self.assertEqual(self.run_driver(["running", "running", "succeeded"]), 3)

    def test_terminal_failure_does_not_restart_paid_work(self):
        with self.assertRaisesRegex(SystemExit, "daily editorial stopped"):
            self.run_driver(["failed"])


if __name__ == "__main__":
    unittest.main()
