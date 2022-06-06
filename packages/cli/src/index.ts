import * as yargsInteractive from "yargs-interactive";

const options: yargsInteractive.Option = {
  interactive: { default: false },
  postTitle: {
    type: "input",
    describe: "Enter the name of the post",
  },
};

yargsInteractive()
  .usage("$0 <command> [args]")
  .interactive(options)
  .then((result) => {
    if (!result.postTitle) {
      console.error("Error: A post title is required");
      return;
    }
    console.log(result.postTitle);
  });
