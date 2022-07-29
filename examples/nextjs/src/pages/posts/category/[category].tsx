import { GetStaticPaths, GetStaticProps } from "next";

export { default as default } from "@routes/Posts";

export const getStaticProps: GetStaticProps = async (context) => {
  const { getDocumentsByTag } = await import("@quiescent/server");
  if (typeof context.params.category !== "string")
    throw "Category was not provided";
  const docs = await getDocumentsByTag(
    "posts",
    "dynamic",
    context.params.category
  );
  return {
    props: {
      posts: Object.entries(docs).map(([, doc]) => doc),
    },
  };
};

export const getStaticPaths: GetStaticPaths = async (context) => {
  // Importing server code
  const { getManifest } = await import("@quiescent/server");
  const tags = (await getManifest("posts", "dynamic"))?.tags;

  return {
    paths: Object.keys(tags).map((category) => ({
      params: {
        category,
      },
    })),
    fallback: "blocking",
  };
};
