import { GetStaticPaths, GetStaticProps } from "next";
import { Post } from "../../types";

export { default as default } from "../../routes/Post";

export const getStaticProps: GetStaticProps<{ post: Post }> = async (
  context
) => {
  const { getDocumentBySlug } = await import("@quiescent/server");
  if (typeof context.params.slug === "string") {
    return {
      props: { post: await getDocumentBySlug(context.params.slug) },
    };
  }
};

export const getStaticPaths: GetStaticPaths = async (context) => {
  // Importing server code
  const { getDocumentSlugs } = await import("@quiescent/server");

  return {
    paths: (await getDocumentSlugs()).map((slug) => ({
      params: {
        slug,
      },
    })),
    fallback: "blocking",
  };
};
