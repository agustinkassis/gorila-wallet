import json
import os
import select
import signal
import subprocess
import sys
import time


def main():
    config = json.load(sys.stdin)
    master, slave = os.openpty()
    child = subprocess.Popen(
        config["command"], stdin=slave, stderr=slave, stdout=subprocess.PIPE,
        start_new_session=True,
    )
    os.close(slave)
    actions = iter(config["actions"])
    action = next(actions, None)
    terminal = bytearray()
    output = bytearray()
    descriptors = {master: terminal, child.stdout.fileno(): output}
    deadline = time.monotonic() + 45
    try:
        while descriptors:
            if time.monotonic() > deadline:
                raise TimeoutError("CLI terminal interaction exceeded 45 seconds")
            readable, _, _ = select.select(list(descriptors), [], [], 0.1)
            for fd in readable:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    if fd != master:
                        raise
                    chunk = b""
                if not chunk:
                    del descriptors[fd]
                    continue
                descriptors[fd].extend(chunk)
            if action and action["prompt"] in terminal.decode(errors="replace"):
                os.write(master, bytes.fromhex(action["hex"]))
                action = next(actions, None)
        code = child.wait(timeout=5)
        if action is not None:
            raise RuntimeError(f"Missing CLI prompt: {action['prompt']}")
        print(json.dumps({"code": code, "stdout": output.decode(), "terminal": terminal.decode()}))
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        os.close(master)
        child.stdout.close()


if __name__ == "__main__":
    main()
