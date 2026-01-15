import os
import sys

(file, title) = sys.argv[1:3]
dir = os.path.dirname(__file__)

# Create a test file

with open(os.path.join(dir, file), "w") as html_file:
    html_file.write("""<!DOCTYPE html>
<html lang="en">
    <head>
        <title>{title}</title>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <link rel="stylesheet" href="style.css"/>
        <script type="module">

import test from "./test.js";
import {{ Scheduler, Fiber }} from "../lib/shell.js";

        </script>
    </head>
    <body>
        <h1>{title}</h1>
        <div class="tests"></div>
        <p>
            <a href="index.html">Back</a>
        </p>
    </body>
</html>""".format(title=title))

# Link from index
# 5E04 Tool: better stub link insert

with open(os.path.join(dir, "index.html"), "a") as html_file:
    html_file.write("<li>{file}</li>".format(file=file))
