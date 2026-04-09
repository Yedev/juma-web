将本地所有未提交的改动生成 patch 文件并保存到 Downloads 目录。

步骤：先执行 `git add .`，再用 Python 生成 patch 文件。

请执行以下 Python 脚本：

```python
import subprocess
import os
from datetime import datetime

repo_dir = os.getcwd()
timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
patch_file = f"D:/Users/W9095286/Downloads/deepread-{timestamp}.patch"

# Step 1: git add .
subprocess.run(["git", "add", "."], cwd=repo_dir, check=True)

# Step 2: git diff HEAD (includes all staged changes)
result = subprocess.run(
    ["git", "diff", "HEAD"],
    cwd=repo_dir,
    capture_output=True,
    text=True,
    encoding="utf-8"
)

if not result.stdout.strip():
    print("没有检测到任何改动，patch 未生成。")
else:
    with open(patch_file, "w", encoding="utf-8") as f:
        f.write(result.stdout)
    lines = result.stdout.count("\n")
    print(f"Patch 已保存：{patch_file}（{lines} 行）")
```

用 Bash tool 执行：`python -c "<上方脚本内容>"`，然后告知用户保存路径。
