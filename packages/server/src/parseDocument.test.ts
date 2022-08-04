import fs from "fs/promises";

/**
 * TODO parse document should prob be broken
 * into smaller function that accept file content
 * This test would be better for the file system based manifest
 *
 */
test("parse document correctly parases", async () => {
  const tempDir = `/temp/quiescent-tests-${Date.now().toString()}`;
  const documentsFolder = `${tempDir}/posts`;
  const configFile = `${tempDir}/quiescent.json`;
  await fs.rmdir(tempDir);
  await fs.mkdir(tempDir);
  await fs.mkdir(documentsFolder);
  const config = { documentTypes: { posts: {} } };
  await fs.writeFile(configFile, JSON.stringify(config));
});
