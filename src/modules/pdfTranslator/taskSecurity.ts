/** Remove credential files left by crashed jobs; translation outputs are retained. */
export async function clearExpiredTaskSecrets(
  jobsDir: string,
  now = Date.now(),
): Promise<void> {
  const maximumAge = 24 * 60 * 60 * 1000;
  let jobs: string[];
  try {
    jobs = await IOUtils.getChildren(jobsDir);
  } catch {
    return;
  }
  for (const job of jobs) {
    try {
      if ((await IOUtils.getFile(job)).isSymlink()) continue;
      const info = await IOUtils.stat(job);
      if (info.type !== "directory") continue;
      for (const name of ["task.json", "config.toml"]) {
        const path = PathUtils.join(job, name);
        if ((await IOUtils.getFile(path)).isSymlink()) continue;
        const file = await IOUtils.stat(path);
        if (
          file.type === "regular" &&
          typeof file.lastModified === "number" &&
          now - file.lastModified > maximumAge
        ) {
          await IOUtils.remove(path, { ignoreAbsent: true });
        }
      }
    } catch {
      /* absent files or another live controller cleaning a job */
    }
  }
}
