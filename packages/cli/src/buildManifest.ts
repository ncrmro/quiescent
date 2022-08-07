import fs from "fs/promises";
import { useConfig, getManifest } from "@quiescent/server";
import { ArgumentsCamelCase } from "yargs";

/**
 * Iterates over each document type from the config file,
 * gets it's manifest and writes it to the disk.
 * @param args
 */
export default async function (args: ArgumentsCamelCase) {
  const config = useConfig();
  const documentConfigs = Object.entries(config.documentTypes);
  for (const [documentType, documentConfig] of documentConfigs) {
    const documentManifest = await getManifest(documentType, "dynamic");
    await fs.writeFile(
      `${documentConfig.directory}/manifest.json`,
      JSON.stringify(documentManifest)
    );
    await fs.writeFile(
      documentConfig.generatedTypesFile,
      `
interface ${documentType} extends Document {
  ${documentConfig.additionalKeys.}
}    
`
    );
  }
}
