from pathlib import Path
import runpy


if __name__ == "__main__":
    runpy.run_path(
        str(Path(__file__).with_name("current-video-primary-text.mock-qa.py")),
        run_name="__main__",
    )
