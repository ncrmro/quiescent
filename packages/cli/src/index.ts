import yargs, { ArgumentsCamelCase } from "yargs";
import buildManifest from "./buildManifest";
import inquirer from "inquirer";

const createPost = async (args: ArgumentsCamelCase) => {
  const answers = await inquirer.prompt(
    [
      {
        message: "What is the title of the post?",
        name: "title",
        type: "string",
      },
    ],
    {
      title: args.title,
    }
  );

  console.log(`Post title, ${answers.title}!`);
};

yargs(process.argv.splice(2))
  .command("build", "use inquirer to prompt for your name", {}, buildManifest)
  .command("post", "use inquirer to prompt for your name", {}, createPost)
  .options({
    title: {
      description: "The post title",
      requiresArg: true,
      alias: "t",
    },
  })
  .strict()
  .help("h").argv;
