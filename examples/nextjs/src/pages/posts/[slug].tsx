import { GetStaticPaths, GetStaticProps } from "next";
import { Post } from "../../types";
import { getDocumentSlugs, getDocumentBySlug } from "@quiescent/server";

export { default as default } from "../../routes/Post";

export const getStaticProps: GetStaticProps<{ post: Post }> = async (
  context
) => {
  if (typeof context.params.slug !== "string")
    throw "Slug was not defined or not string";
  const document = await getDocumentBySlug<Post>("posts", context.params.slug);
  return {
    props: { post: document },
  };
};

export const getStaticPaths: GetStaticPaths = async (context) => {
  const slugs = await getDocumentSlugs<Post>("posts", "dynamic");
  return {
    paths: slugs.map((slug) => ({
      params: {
        slug,
      },
    })),
    fallback: "blocking",
  };
};
