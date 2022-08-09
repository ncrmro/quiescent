import { useTempConfig } from "./test.utils";
import { useConfig } from "./config";

test("Config parsing throws error for missing type key on additionalKeys", async () => {
  const { configPath, config } = await useTempConfig({
    documentTypes: {
      posts: {
        directory: "can be blank for this test",
        // @ts-ignore
        additionalKeys: { description: { required: true } },
      },
    },
  });
  await expect(async () => await useConfig(configPath)).rejects.toThrow(
    "Error parsing config documentType posts, additional key description is missing type."
  );
});
